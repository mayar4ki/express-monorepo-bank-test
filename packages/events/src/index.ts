export { buildTelemetryEvents } from './build.js';
export {
  classifyFreshness,
  createKafka,
  createTelemetryConsumer,
  createTelemetryProducer,
  publishTelemetry,
  type Freshness,
  type PublishOptions,
  type TelemetryBatchContext,
  type TelemetryBatchHandler,
  type TelemetryConsumer,
  type TelemetryConsumerOptions,
} from './client.js';
export {
  decodeTelemetryEvent,
  telemetryEventSchema,
  TELEMETRY_SCHEMA_VERSION,
  type DecodeResult,
  type TelemetryEvent,
  type TelemetryFuelReading,
  type TelemetryGps,
} from './schemas.js';
export {
  consumerGroups,
  DEFAULT_BACKFILL_THRESHOLD_MS,
  telemetryBackfillTopic,
  telemetryDlqTopic,
  telemetryLiveTopic,
  telemetryTopics,
  type ConsumerName,
} from './topics.js';
