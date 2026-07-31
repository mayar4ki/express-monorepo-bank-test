import type { TelemetryDb } from '@bank/db-telemetry';
import {
  consumerGroups,
  createTelemetryConsumer,
  telemetryLiveTopic,
  telemetryTopics,
} from '@bank/events';
import type { ConsumerName, TelemetryBatchHandler, TelemetryConsumer } from '@bank/events';
import type { Kafka, Producer } from 'kafkajs';
import type { Logger } from 'pino';

import { createAlertingHandler } from '../alerting/consumer.js';
import type { AlertingConfig } from '../alerting/consumer.js';
import { createVehicleRegistry } from '../vehicles.js';
import { createEngineHandler } from './engine.js';
import { createFuelHandler } from './fuel.js';
import { createLocationsHandler } from './locations.js';

export interface BuildConsumersOptions {
  kafka: Kafka;
  db: TelemetryDb;
  logger: Logger;
  /** Where undecodable messages go. */
  dlqProducer: Producer;
  alerting: AlertingConfig;
  names: ConsumerName[];
  /** Overridden by tests to isolate topics. */
  topics?: { live: string; backfill: string; dlq?: string };
  /** Appended to each group id, so tests get their own offsets. */
  groupIdSuffix?: string;
}

/**
 * Builds the requested consumers, each with its own group so their offsets,
 * failures and lag stay independent.
 *
 * The writers read live and backfill alike — a vehicle's history is worth
 * storing whenever it turns up. Alerting reads only live, so a device
 * reconnecting with hours of buffered data can never raise alarms about
 * conditions that have already passed, nor delay a genuine one behind them.
 */
export function buildConsumers(options: BuildConsumersOptions): Record<string, TelemetryConsumer> {
  const vehicles = createVehicleRegistry(options.db);
  const writerTopics = options.topics
    ? [options.topics.live, options.topics.backfill]
    : [...telemetryTopics];
  const liveOnly = options.topics ? [options.topics.live] : [telemetryLiveTopic];

  const shared = {
    logger: options.logger,
    dlq: {
      producer: options.dlqProducer,
      ...(options.topics?.dlq ? { topic: options.topics.dlq } : {}),
    },
    ...(options.topics ? { backfillTopic: options.topics.backfill } : {}),
  };
  const deps = { db: options.db, logger: options.logger, vehicles };

  const definitions: Record<ConsumerName, { topics: string[]; handler: TelemetryBatchHandler }> = {
    locations: { topics: writerTopics, handler: createLocationsHandler(deps) },
    fuel: { topics: writerTopics, handler: createFuelHandler(deps) },
    engine: { topics: writerTopics, handler: createEngineHandler(deps) },
    alerting: {
      topics: liveOnly,
      handler: createAlertingHandler({ ...deps, config: options.alerting }),
    },
  };

  return Object.fromEntries(
    options.names.map((name) => [
      name,
      createTelemetryConsumer(options.kafka, {
        ...shared,
        groupId: `${consumerGroups[name]}${options.groupIdSuffix ?? ''}`,
        topics: definitions[name].topics,
        handler: definitions[name].handler,
      }),
    ]),
  );
}
