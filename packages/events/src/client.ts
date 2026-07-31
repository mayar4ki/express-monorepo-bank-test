import { Kafka, logLevel } from 'kafkajs';
import type {
  Consumer,
  KafkaMessage,
  LogEntry,
  Producer,
  TopicMessages,
  logCreator,
} from 'kafkajs';
import type { Logger as PinoLogger } from 'pino';

import { decodeTelemetryEvent } from './schemas.js';
import type { TelemetryEvent } from './schemas.js';
import {
  DEFAULT_BACKFILL_THRESHOLD_MS,
  telemetryBackfillTopic,
  telemetryDlqTopic,
  telemetryLiveTopic,
  telemetryTopics,
} from './topics.js';

/**
 * Everything that touches kafkajs lives in this file, so swapping the client
 * later is a change to one module rather than to every service.
 */

const PINO_LEVEL_BY_KAFKA_LEVEL: Record<logLevel, 'error' | 'warn' | 'info' | 'debug'> = {
  [logLevel.NOTHING]: 'debug',
  [logLevel.ERROR]: 'error',
  [logLevel.WARN]: 'warn',
  [logLevel.INFO]: 'info',
  [logLevel.DEBUG]: 'debug',
};

/** Routes kafkajs' own diagnostics into the service's pino logger. */
function pinoLogCreator(logger: PinoLogger): logCreator {
  return () =>
    (entry: LogEntry): void => {
      const { message, ...details } = entry.log;
      const level = PINO_LEVEL_BY_KAFKA_LEVEL[entry.level] ?? 'info';
      logger[level]({ kafka: { namespace: entry.namespace, ...details } }, message);
    };
}

export function createKafka(options: {
  brokers: string[];
  clientId: string;
  logger?: PinoLogger;
}): Kafka {
  return new Kafka({
    clientId: options.clientId,
    brokers: options.brokers,
    retry: { retries: 8, initialRetryTime: 300 },
    ...(options.logger
      ? { logCreator: pinoLogCreator(options.logger), logLevel: logLevel.WARN }
      : {}),
  });
}

/**
 * Idempotent producer: a retry cannot duplicate a record inside the broker, and
 * it implies acks=all so an accepted write survives a broker restart. That
 * matters because the device is told its data is safe as soon as we ack it.
 */
export function createTelemetryProducer(kafka: Kafka): Producer {
  return kafka.producer({ idempotent: true });
}

export type Freshness = 'live' | 'backfill';

export interface PublishOptions {
  liveTopic?: string;
  backfillTopic?: string;
  backfillThresholdMs?: number;
}

/**
 * Whether a record came off the wire live or out of a device's flash buffer.
 * A device clock running ahead of ours gives a negative lag, which counts as
 * live — such a record is certainly not backlog.
 */
export function classifyFreshness(
  event: TelemetryEvent,
  thresholdMs: number = DEFAULT_BACKFILL_THRESHOLD_MS,
): Freshness {
  const lagMs = Date.parse(event.receivedAt) - Date.parse(event.recordedAt);
  return lagMs > thresholdMs ? 'backfill' : 'live';
}

/**
 * Publishes one packet's records, splitting them between the live and backfill
 * topics. Keyed by IMEI so a vehicle's records always land on the same
 * partition and stay in order for the consumers that track per-vehicle state.
 *
 * Resolves only once the broker has acknowledged every message. The caller acks
 * the device afterwards, so a failure here leaves the data on the device.
 */
export async function publishTelemetry(
  producer: Producer,
  events: TelemetryEvent[],
  options: PublishOptions = {},
): Promise<void> {
  if (events.length === 0) return;

  const liveTopic = options.liveTopic ?? telemetryLiveTopic;
  const backfillTopic = options.backfillTopic ?? telemetryBackfillTopic;
  const thresholdMs = options.backfillThresholdMs ?? DEFAULT_BACKFILL_THRESHOLD_MS;

  const byTopic = new Map<string, TopicMessages>();
  for (const event of events) {
    const topic = classifyFreshness(event, thresholdMs) === 'backfill' ? backfillTopic : liveTopic;
    const batch = byTopic.get(topic) ?? { topic, messages: [] };
    batch.messages.push({ key: event.imei, value: JSON.stringify(event) });
    byTopic.set(topic, batch);
  }

  // One request even when a packet straddles both topics.
  await producer.sendBatch({ topicMessages: [...byTopic.values()] });
}

export interface TelemetryBatchContext {
  topic: string;
  partition: number;
  /** Lets a handler treat backlog differently from live data. */
  freshness: Freshness;
  /** Call during long batches to avoid being evicted from the group. */
  heartbeat: () => Promise<void>;
}

export type TelemetryBatchHandler = (
  events: TelemetryEvent[],
  context: TelemetryBatchContext,
) => Promise<void>;

export interface TelemetryConsumerOptions {
  groupId: string;
  handler: TelemetryBatchHandler;
  logger: PinoLogger;
  /** Defaults to the live and backfill topics. Overridden to isolate tests. */
  topics?: readonly string[];
  /** Which subscribed topic carries backlog, for the `freshness` context. */
  backfillTopic?: string;
  /** Where undecodable messages go. Without it they are logged and dropped. */
  dlq?: { producer: Producer; topic?: string };
  /**
   * Only affects a group with no committed offset — a first deploy, or one
   * whose offsets expired. An existing group always resumes from its committed
   * offset, which is what lets a consumer that was down catch up on its own.
   */
  fromBeginning?: boolean;
}

export interface TelemetryConsumer {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** For health checks: false before start, after stop, and after a crash. */
  isRunning: () => boolean;
}

/**
 * Consumes telemetry for one destination.
 *
 * Errors split the way the transfer processor splits them. A message that
 * cannot be decoded is a data problem: it goes to the dead-letter topic and the
 * batch carries on, because one bad message must never wedge a partition. A
 * failure inside the handler is an infrastructure problem: it propagates, so
 * kafkajs retries the batch and nothing is quietly lost.
 */
export function createTelemetryConsumer(
  kafka: Kafka,
  options: TelemetryConsumerOptions,
): TelemetryConsumer {
  const topics = [...(options.topics ?? telemetryTopics)];
  const backfill = options.backfillTopic ?? telemetryBackfillTopic;
  const dlqTopic = options.dlq?.topic ?? telemetryDlqTopic;
  const logger = options.logger.child({ consumerGroup: options.groupId });
  const consumer: Consumer = kafka.consumer({ groupId: options.groupId });

  let running = false;
  consumer.on(consumer.events.CRASH, ({ payload }) => {
    running = false;
    logger.error({ err: payload.error, restarting: payload.restart }, 'kafka consumer crashed');
  });

  async function deadLetter(message: KafkaMessage, source: string, reason: string): Promise<void> {
    logger.warn({ reason, source, offset: message.offset }, 'telemetry message rejected');
    if (!options.dlq) return;

    // A failure here propagates on purpose: silently dropping undeliverable
    // data is worse than stalling the partition, which shows up as lag.
    await options.dlq.producer.send({
      topic: dlqTopic,
      messages: [
        {
          key: message.key,
          value: message.value,
          headers: {
            'x-rejection-reason': reason,
            'x-source-topic': source,
            'x-source-offset': message.offset,
            'x-consumer-group': options.groupId,
          },
        },
      ],
    });
  }

  return {
    async start() {
      await consumer.connect();
      await consumer.subscribe({ topics, fromBeginning: options.fromBeginning ?? true });
      await consumer.run({
        eachBatchAutoResolve: true,
        eachBatch: async (payload) => {
          const { batch } = payload;
          const events: TelemetryEvent[] = [];
          for (const message of batch.messages) {
            // A rebalance mid-batch means another member owns these offsets.
            if (!payload.isRunning() || payload.isStale()) return;
            const decoded = decodeTelemetryEvent(message.value);
            if (decoded.ok) events.push(decoded.event);
            else await deadLetter(message, batch.topic, decoded.reason);
          }
          if (events.length === 0) return;

          await options.handler(events, {
            topic: batch.topic,
            partition: batch.partition,
            freshness: batch.topic === backfill ? 'backfill' : 'live',
            heartbeat: () => payload.heartbeat(),
          });
        },
      });
      running = true;
      logger.info({ topics }, 'kafka consumer running');
    },

    async stop() {
      running = false;
      await consumer.disconnect();
    },

    isRunning: () => running,
  };
}
