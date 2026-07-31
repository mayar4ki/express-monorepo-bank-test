import 'dotenv/config';
import { pino } from 'pino';

import { createTelemetryDb } from '@bank/db-telemetry';
import { createKafka, createTelemetryProducer } from '@bank/events';

import { buildConsumers } from './consumers/index.js';
import { loadEnv, parseBrokers } from './env.js';
import { startHealthServer } from './health.js';

const SHUTDOWN_TIMEOUT_MS = 30_000;

const env = loadEnv();
const logger = pino({ level: env.LOG_LEVEL });
const { db, pool } = createTelemetryDb(env.TELEMETRY_DATABASE_URL);

const kafka = createKafka({
  brokers: parseBrokers(env.KAFKA_BROKERS),
  clientId: env.KAFKA_CLIENT_ID,
  logger,
});

// Rejected messages are republished to the dead-letter topic rather than lost.
const dlqProducer = createTelemetryProducer(kafka);
await dlqProducer.connect();

const consumers = buildConsumers({
  kafka,
  db,
  logger,
  dlqProducer,
  names: env.CONSUMERS,
  alerting: {
    lowFuelPct: env.LOW_FUEL_PCT,
    speedLimitKph: env.SPEED_LIMIT_KPH,
    cooldownMs: env.ALERT_COOLDOWN_MS,
    maxAgeMs: env.ALERT_MAX_AGE_MS,
    geofenceRefreshMs: env.GEOFENCE_REFRESH_MS,
  },
});

await Promise.all(Object.values(consumers).map((consumer) => consumer.start()));

let running = true;
const healthServer = startHealthServer({
  port: env.PORT,
  db,
  isRunning: () => running,
  consumersRunning: () =>
    Object.fromEntries(
      Object.entries(consumers).map(([name, consumer]) => [name, consumer.isRunning()]),
    ),
});

logger.info({ port: env.PORT, consumers: Object.keys(consumers) }, 'telemetry consumers running');

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

  // Disconnecting commits the offsets reached, so a restart resumes here
  // rather than reprocessing (which would be harmless, just wasteful).
  await Promise.all(Object.values(consumers).map((consumer) => consumer.stop()));
  healthServer.close();
  await dlqProducer.disconnect();
  await pool.end();
  logger.info('shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
