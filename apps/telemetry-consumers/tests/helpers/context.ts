import { randomUUID } from 'node:crypto';

import { createTelemetryDb } from '@bank/db-telemetry';
import type { TelemetryDb } from '@bank/db-telemetry';
import {
  buildTelemetryEvents,
  createKafka,
  createTelemetryProducer,
  publishTelemetry,
} from '@bank/events';
import type { ConsumerName, TelemetryEvent } from '@bank/events';
import { createTestTopics } from '@bank/events/testing';
import { parseAvlPacket } from '@bank/teltonika';
import { encodeAvlFrame } from '@bank/teltonika/testing';
import type { EncodableRecord } from '@bank/teltonika/testing';
import { sql } from 'drizzle-orm';
import type { Producer } from 'kafkajs';
import { pino } from 'pino';

import { buildConsumers } from '../../src/consumers/index.js';
import type { AlertingConfig } from '../../src/alerting/consumer.js';

export const IMEI = '356938035643809';
const logger = pino({ level: 'silent' });

const DEFAULT_ALERTING: AlertingConfig = {
  lowFuelPct: 15,
  speedLimitKph: 90,
  cooldownMs: 900_000,
  maxAgeMs: 600_000,
  geofenceRefreshMs: 60_000,
};

/**
 * Runs the real consumers against a real broker and database, so the tests
 * cover the wiring (topic subscriptions, group ids, idempotent writes) and not
 * just the handlers.
 */
export async function createConsumerContext(options: {
  databaseUrl: string;
  brokers: string[];
  names: ConsumerName[];
  alerting?: Partial<AlertingConfig>;
}) {
  const suffix = randomUUID();
  const topics = {
    live: `test.consumers.live.${suffix}`,
    backfill: `test.consumers.backfill.${suffix}`,
    dlq: `test.consumers.dlq.${suffix}`,
  };
  await createTestTopics(options.brokers, [topics.live, topics.backfill, topics.dlq]);

  const { db, pool } = createTelemetryDb(options.databaseUrl);
  const kafka = createKafka({ brokers: options.brokers, clientId: `test-consumers-${suffix}` });
  const producer: Producer = createTelemetryProducer(kafka);
  await producer.connect();

  const consumers = buildConsumers({
    kafka,
    db,
    logger,
    dlqProducer: producer,
    names: options.names,
    groupIdSuffix: `.${suffix}`,
    topics,
    alerting: { ...DEFAULT_ALERTING, ...options.alerting },
  });

  await Promise.all(Object.values(consumers).map((consumer) => consumer.start()));

  return {
    db,
    topics,
    consumers,

    /** Publishes records as a device would, through the real encoder. */
    async publish(
      records: EncodableRecord[],
      overrides: { imei?: string; receivedAt?: Date } = {},
    ) {
      const receivedAt = overrides.receivedAt ?? new Date();
      const packet = parseAvlPacket(encodeAvlFrame(records));
      if (!packet.crcOk) throw new Error('expected a valid CRC');
      const events = buildTelemetryEvents({
        imei: overrides.imei ?? IMEI,
        codec: packet.codec,
        records: packet.records,
        receivedAt,
      });
      await publishTelemetry(producer, events, {
        liveTopic: topics.live,
        backfillTopic: topics.backfill,
        backfillThresholdMs: 5 * 60 * 1000,
      });
      return events;
    },

    /** Publishes pre-built events, for cases the encoder cannot express. */
    async publishEvents(events: TelemetryEvent[]) {
      await publishTelemetry(producer, events, {
        liveTopic: topics.live,
        backfillTopic: topics.backfill,
        backfillThresholdMs: 5 * 60 * 1000,
      });
    },

    /** Polls until `read` returns a value passing `until`, or times out. */
    async waitFor<T>(read: () => Promise<T>, until: (value: T) => boolean, timeoutMs = 20_000) {
      const deadline = Date.now() + timeoutMs;
      let last: T = await read();
      while (!until(last)) {
        if (Date.now() > deadline) {
          throw new Error(`condition not met, last value: ${JSON.stringify(last)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
        last = await read();
      }
      return last;
    },

    /** Lets any further writes settle, to catch rows that should NOT appear. */
    async settle(ms = 750) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    },

    async close() {
      await Promise.all(Object.values(consumers).map((consumer) => consumer.stop()));
      await producer.disconnect();
      await pool.end();
    },
  };
}

export type ConsumerContext = Awaited<ReturnType<typeof createConsumerContext>>;

/** Telemetry tables only; the banking seed data is left alone. */
export async function resetTelemetry(db: TelemetryDb): Promise<void> {
  await db.execute(sql`
    truncate table
      vehicle_locations,
      vehicle_fuel_readings,
      vehicle_engine_events,
      vehicle_alerts,
      vehicle_alert_states,
      geofences,
      vehicles
    restart identity cascade
  `);
}
