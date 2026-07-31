import 'dotenv/config';
import { pino } from 'pino';

import { createKafka, createTelemetryProducer, publishTelemetry } from '@bank/events';

import { loadEnv, parseBrokers } from './env.js';
import { startHealthServer } from './health.js';
import { createIngestServer } from './server.js';

const SHUTDOWN_TIMEOUT_MS = 30_000;

const env = loadEnv();
const logger = pino({ level: env.LOG_LEVEL });

const kafka = createKafka({
  brokers: parseBrokers(env.KAFKA_BROKERS),
  clientId: env.KAFKA_CLIENT_ID,
  logger,
});
const producer = createTelemetryProducer(kafka);

// Devices are told their data is safe only after Kafka accepts it, so the
// health check has to fail while the producer is disconnected.
let producerConnected = false;
producer.on(producer.events.CONNECT, () => {
  producerConnected = true;
});
producer.on(producer.events.DISCONNECT, () => {
  producerConnected = false;
  logger.error('kafka producer disconnected');
});

const ingest = createIngestServer({
  logger,
  idleTimeoutMs: env.IDLE_TIMEOUT_MS,
  publish: (events) =>
    publishTelemetry(producer, events, { backfillThresholdMs: env.BACKFILL_THRESHOLD_MS }),
});

await producer.connect();
await ingest.listen(env.TCP_PORT);

let running = true;
const healthServer = startHealthServer({
  port: env.PORT,
  checks: {
    running: () => running,
    listening: () => ingest.isListening(),
    kafka: () => producerConnected,
  },
});

logger.info(
  { tcpPort: env.TCP_PORT, healthPort: env.PORT },
  'telemetry ingest listening for devices',
);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  running = false;
  logger.info({ signal }, 'shutting down');

  const hardExit = setTimeout(() => {
    logger.error('graceful shutdown timed out, exiting');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  hardExit.unref();

  // Devices reconnect and resend whatever was not acknowledged, so closing
  // their connections loses nothing.
  await ingest.close();
  healthServer.close();
  await producer.disconnect();
  logger.info('shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
