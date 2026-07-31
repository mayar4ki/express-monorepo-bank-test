import { randomUUID } from 'node:crypto';

import { parseAvlPacket } from '@bank/teltonika';
import { encodeAvlFrame } from '@bank/teltonika/testing';
import type { Producer } from 'kafkajs';
import { pino } from 'pino';
import { afterEach, beforeAll, describe, expect, inject, it } from 'vitest';

import { buildTelemetryEvents } from '../../src/build.js';
import {
  createKafka,
  createTelemetryConsumer,
  createTelemetryProducer,
  publishTelemetry,
} from '../../src/client.js';
import type { TelemetryConsumer } from '../../src/client.js';
import type { TelemetryEvent } from '../../src/schemas.js';
import { createTestTopics } from '../../src/testing.js';

const IMEI = '356938035643809';
const brokers = inject('kafkaBrokers');
const logger = pino({ level: 'silent' });

let producer: Producer;
const started: TelemetryConsumer[] = [];

/** Fresh topic names per test so groups never see another test's messages. */
function topicSet() {
  const suffix = randomUUID();
  return {
    live: `test.telemetry.live.${suffix}`,
    backfill: `test.telemetry.backfill.${suffix}`,
    dlq: `test.telemetry.dlq.${suffix}`,
    groupId: `test.group.${suffix}`,
  };
}

function eventsFor(options: { ageMs: number; count?: number }): TelemetryEvent[] {
  const receivedAt = new Date();
  const records = Array.from({ length: options.count ?? 1 }, (_, index) => ({
    timestampMs: receivedAt.getTime() - options.ageMs - index * 1_000,
    gps: {
      latitude: 54.712345,
      longitude: 25.279652,
      altitudeM: 143,
      angleDeg: 271,
      satellites: 11,
      speedKph: 64,
    },
  }));
  const packet = parseAvlPacket(encodeAvlFrame(records));
  if (!packet.crcOk) throw new Error('expected a valid CRC');
  return buildTelemetryEvents({
    imei: IMEI,
    codec: packet.codec,
    records: packet.records,
    receivedAt,
  });
}

/** Total messages on a topic, across partitions. */
async function messageCount(topic: string): Promise<number> {
  const admin = createKafka({ brokers, clientId: 'test-admin' }).admin();
  await admin.connect();
  try {
    const offsets = await admin.fetchTopicOffsets(topic);
    return offsets.reduce((total, partition) => total + Number(partition.high), 0);
  } finally {
    await admin.disconnect();
  }
}

/** Runs a consumer that collects events until `count` have arrived. */
async function collect(
  options: { topics: string[]; backfillTopic: string; groupId: string; dlqTopic?: string },
  count: number,
  timeoutMs = 20_000,
): Promise<{ events: TelemetryEvent[]; topics: string[] }> {
  const events: TelemetryEvent[] = [];
  const topics: string[] = [];
  let resolveDone: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const consumer = createTelemetryConsumer(createKafka({ brokers, clientId: 'test-consumer' }), {
    groupId: options.groupId,
    topics: options.topics,
    backfillTopic: options.backfillTopic,
    logger,
    fromBeginning: true,
    ...(options.dlqTopic ? { dlq: { producer, topic: options.dlqTopic } } : {}),
    handler: (batch, context) => {
      events.push(...batch);
      topics.push(...batch.map(() => context.topic));
      if (events.length >= count) resolveDone();
      return Promise.resolve();
    },
  });

  started.push(consumer);
  await consumer.start();

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`only ${events.length}/${count} events arrived`)), timeoutMs),
  );
  await Promise.race([done, timeout]);

  return { events, topics };
}

beforeAll(async () => {
  producer = createTelemetryProducer(createKafka({ brokers, clientId: 'test-producer' }));
  await producer.connect();
  return async () => {
    await producer.disconnect();
  };
});

afterEach(async () => {
  await Promise.all(started.splice(0).map((consumer) => consumer.stop()));
});

describe('telemetry over Kafka', () => {
  it('round-trips an event through the live topic unchanged', async () => {
    const { live, backfill, groupId } = topicSet();
    await createTestTopics(brokers, [live, backfill]);

    const published = eventsFor({ ageMs: 0 });
    await publishTelemetry(producer, published, { liveTopic: live, backfillTopic: backfill });

    const { events } = await collect({ topics: [live], backfillTopic: backfill, groupId }, 1);
    expect(events).toEqual(published);
  });

  it('routes buffered records to backfill and fresh ones to live', async () => {
    const { live, backfill, groupId } = topicSet();
    await createTestTopics(brokers, [live, backfill]);

    // The no-coverage case: a reconnecting device flushes old records
    // alongside its current position, in one packet.
    const stale = eventsFor({ ageMs: 4 * 60 * 60 * 1000, count: 2 });
    const fresh = eventsFor({ ageMs: 0 });
    await publishTelemetry(producer, [...stale, ...fresh], {
      liveTopic: live,
      backfillTopic: backfill,
      backfillThresholdMs: 5 * 60 * 1000,
    });

    const { events, topics } = await collect(
      { topics: [live, backfill], backfillTopic: backfill, groupId },
      3,
    );

    const byTopic = new Map(events.map((event, index) => [event.dedupKey, topics[index]]));
    for (const event of stale) expect(byTopic.get(event.dedupKey)).toBe(backfill);
    for (const event of fresh) expect(byTopic.get(event.dedupKey)).toBe(live);
  });

  it('lets a live-only consumer ignore a backlog flush entirely', async () => {
    const { live, backfill, groupId } = topicSet();
    await createTestTopics(brokers, [live, backfill]);

    const stale = eventsFor({ ageMs: 6 * 60 * 60 * 1000, count: 5 });
    const fresh = eventsFor({ ageMs: 0 });
    await publishTelemetry(producer, [...stale, ...fresh], {
      liveTopic: live,
      backfillTopic: backfill,
    });

    // This is what keeps alerting real-time while backfill catches up.
    const { events } = await collect({ topics: [live], backfillTopic: backfill, groupId }, 1);
    expect(events.map((e) => e.dedupKey)).toEqual(fresh.map((e) => e.dedupKey));
  });

  it('sends an undecodable message to the dead-letter topic and keeps going', async () => {
    const { live, backfill, dlq, groupId } = topicSet();
    await createTestTopics(brokers, [live, backfill, dlq]);

    await producer.send({
      topic: live,
      messages: [{ key: IMEI, value: '{"schemaVersion":99,"garbage":true}' }],
    });
    const good = eventsFor({ ageMs: 0 });
    await publishTelemetry(producer, good, { liveTopic: live, backfillTopic: backfill });

    // The poison message must not wedge the partition ahead of good data.
    const { events } = await collect(
      { topics: [live], backfillTopic: backfill, groupId, dlqTopic: dlq },
      1,
    );
    expect(events.map((e) => e.dedupKey)).toEqual(good.map((e) => e.dedupKey));

    // And it must have been kept for triage rather than dropped. Counting via
    // the admin API rather than consuming, because the dead-lettered payload is
    // the original bytes and so still fails the schema by design.
    expect(await messageCount(dlq)).toBe(1);
  });

  it('resumes from its committed offset after the consumer was down', async () => {
    const { live, backfill, groupId } = topicSet();
    await createTestTopics(brokers, [live, backfill]);

    const before = eventsFor({ ageMs: 0 });
    await publishTelemetry(producer, before, { liveTopic: live, backfillTopic: backfill });

    const first = await collect({ topics: [live], backfillTopic: backfill, groupId }, 1);
    expect(first.events).toHaveLength(1);
    // Take the consumer down, committing where it got to.
    await Promise.all(started.splice(0).map((consumer) => consumer.stop()));

    // Events published while nothing was consuming.
    const during = eventsFor({ ageMs: 0, count: 3 });
    await publishTelemetry(producer, during, { liveTopic: live, backfillTopic: backfill });

    // Same group id: it must pick up the missed events, not skip to the end.
    const second = await collect({ topics: [live], backfillTopic: backfill, groupId }, 3);
    expect(second.events.map((e) => e.dedupKey).sort()).toEqual(
      during.map((e) => e.dedupKey).sort(),
    );
  });

  it('keeps one vehicle on a single partition so its records stay ordered', async () => {
    const { live, backfill, groupId } = topicSet();
    await createTestTopics(brokers, [live, backfill], { partitions: 6 });

    const events = eventsFor({ ageMs: 0, count: 10 });
    await publishTelemetry(producer, events, { liveTopic: live, backfillTopic: backfill });

    const received = await collect({ topics: [live], backfillTopic: backfill, groupId }, 10);
    // Keyed by IMEI: same partition, so publish order is preserved.
    expect(received.events.map((e) => e.dedupKey)).toEqual(events.map((e) => e.dedupKey));
  });
});
