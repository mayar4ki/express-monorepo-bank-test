import { randomUUID } from 'node:crypto';

import {
  createKafka,
  createTelemetryConsumer,
  createTelemetryProducer,
  publishTelemetry,
} from '@bank/events';
import type { TelemetryConsumer, TelemetryEvent } from '@bank/events';
import { createTestTopics } from '@bank/events/testing';
import type { Producer } from 'kafkajs';
import { pino } from 'pino';
import { afterEach, beforeAll, describe, expect, inject, it } from 'vitest';

import { createIngestServer } from '../../src/server.js';
import type { IngestServer } from '../../src/server.js';
import { FakeDevice } from '../helpers/fake-device.js';

const IMEI = '356938035643809';
const BACKFILL_THRESHOLD_MS = 5 * 60 * 1000;
const brokers = inject('kafkaBrokers');
const logger = pino({ level: 'silent' });

let producer: Producer;
const cleanups: (() => Promise<void> | void)[] = [];

const GPS = {
  latitude: 54.712345,
  longitude: 25.279652,
  altitudeM: 143,
  angleDeg: 271,
  satellites: 11,
  speedKph: 64,
};

/** Ingest wired to real topics, plus a consumer collecting what lands there. */
async function startPipeline() {
  const suffix = randomUUID();
  const live = `test.ingest.live.${suffix}`;
  const backfill = `test.ingest.backfill.${suffix}`;
  await createTestTopics(brokers, [live, backfill]);

  const received: { event: TelemetryEvent; topic: string }[] = [];
  const consumer: TelemetryConsumer = createTelemetryConsumer(
    createKafka({ brokers, clientId: 'test-consumer' }),
    {
      groupId: `test.ingest.${suffix}`,
      topics: [live, backfill],
      backfillTopic: backfill,
      logger,
      fromBeginning: true,
      handler: (events, context) => {
        for (const event of events) received.push({ event, topic: context.topic });
        return Promise.resolve();
      },
    },
  );
  await consumer.start();
  cleanups.push(() => consumer.stop());

  const server: IngestServer = createIngestServer({
    logger,
    idleTimeoutMs: 60_000,
    publish: (events) =>
      publishTelemetry(producer, events, {
        liveTopic: live,
        backfillTopic: backfill,
        backfillThresholdMs: BACKFILL_THRESHOLD_MS,
      }),
  });
  const port = await server.listen(0, '127.0.0.1');
  cleanups.push(() => server.close());

  return {
    port,
    live,
    backfill,
    received,
    connect: async () => {
      const device = new FakeDevice(IMEI);
      cleanups.push(() => device.destroy());
      await device.connect(port);
      return device;
    },
    waitFor: async (count: number, timeoutMs = 20_000) => {
      const deadline = Date.now() + timeoutMs;
      while (received.length < count) {
        if (Date.now() > deadline) {
          throw new Error(`only ${received.length}/${count} events reached Kafka`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return received;
    },
  };
}

beforeAll(async () => {
  producer = createTelemetryProducer(createKafka({ brokers, clientId: 'test-producer' }));
  await producer.connect();
  return async () => {
    await producer.disconnect();
  };
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe('device to Kafka', () => {
  it('carries a packet from the socket through to the live topic', async () => {
    const pipeline = await startPipeline();
    const device = await pipeline.connect();

    expect(await device.handshake()).toEqual(Buffer.from([0x01]));
    const ack = await device.sendRecords([{ timestampMs: Date.now(), priority: 1, gps: GPS }]);
    expect(ack.readUInt32BE(0)).toBe(1);

    const [entry] = await pipeline.waitFor(1);
    expect(entry?.topic).toBe(pipeline.live);
    expect(entry?.event.imei).toBe(IMEI);
    expect(entry?.event.gps?.speedKph).toBe(64);
  });

  it("splits a reconnecting device's backlog from its live position", async () => {
    const pipeline = await startPipeline();
    const device = await pipeline.connect();
    await device.handshake();

    // What a vehicle sends after being out of coverage: hours of buffered
    // history in the same packet as where it is right now.
    const now = Date.now();
    const ack = await device.sendRecords([
      { timestampMs: now - 4 * 60 * 60 * 1000, gps: GPS },
      { timestampMs: now - 3 * 60 * 60 * 1000, gps: GPS },
      { timestampMs: now, gps: GPS },
    ]);
    expect(ack.readUInt32BE(0)).toBe(3);

    const entries = await pipeline.waitFor(3);
    const byTopic = new Map(entries.map((entry) => [entry.event.recordedAt, entry.topic]));
    expect(byTopic.get(new Date(now - 4 * 60 * 60 * 1000).toISOString())).toBe(pipeline.backfill);
    expect(byTopic.get(new Date(now - 3 * 60 * 60 * 1000).toISOString())).toBe(pipeline.backfill);
    expect(byTopic.get(new Date(now).toISOString())).toBe(pipeline.live);
  });

  it('keeps a whole packet out of Kafka when its checksum fails', async () => {
    const pipeline = await startPipeline();
    const device = await pipeline.connect();
    await device.handshake();

    const bad = await device.sendRecords([{ timestampMs: Date.now(), gps: GPS }], {
      crcOverride: 0xdead,
    });
    expect(bad.readUInt32BE(0)).toBe(0);

    // The resend goes through, and only it reaches Kafka.
    const good = await device.sendRecords([{ timestampMs: Date.now(), gps: GPS }]);
    expect(good.readUInt32BE(0)).toBe(1);

    const entries = await pipeline.waitFor(1);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(entries).toHaveLength(1);
  });

  it('takes a whole fleet reconnecting at once', async () => {
    const pipeline = await startPipeline();
    const imeis = Array.from({ length: 5 }, (_, i) => `35693803564380${i}`);

    const devices = await Promise.all(
      imeis.map(async (imei) => {
        const device = new FakeDevice(imei);
        cleanups.push(() => device.destroy());
        await device.connect(pipeline.port);
        await device.handshake();
        return device;
      }),
    );

    // Each flushes two buffered records and one current one.
    const now = Date.now();
    const acks = await Promise.all(
      devices.map((device) =>
        device.sendRecords([
          { timestampMs: now - 2 * 60 * 60 * 1000, gps: GPS },
          { timestampMs: now - 1 * 60 * 60 * 1000, gps: GPS },
          { timestampMs: now, gps: GPS },
        ]),
      ),
    );
    for (const ack of acks) expect(ack.readUInt32BE(0)).toBe(3);

    const entries = await pipeline.waitFor(15);
    expect(new Set(entries.map((e) => e.event.imei)).size).toBe(5);
    expect(entries.filter((e) => e.topic === pipeline.backfill)).toHaveLength(10);
    expect(entries.filter((e) => e.topic === pipeline.live)).toHaveLength(5);
  });
});
