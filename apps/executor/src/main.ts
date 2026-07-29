import 'dotenv/config';
import { pino } from 'pino';

import { createDb } from '@bank/db';
import { createRedisConnection, createTransfersWorker } from '@bank/queue';
import { createTransferProcessor } from '@bank/shared/transfers';

import { loadEnv } from './env.js';
import { startHealthServer } from './health.js';

const SHUTDOWN_TIMEOUT_MS = 30_000;

const env = loadEnv();
const logger = pino({ level: env.LOG_LEVEL });
const { db, pool } = createDb(env.DATABASE_URL);
const redis = createRedisConnection(env.REDIS_URL);

const worker = createTransfersWorker(redis, createTransferProcessor({ db, logger }));
worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'transfer job failed (will retry if attempts remain)');
});
worker.on('error', (err) => {
  logger.error({ err }, 'worker error');
});

let running = true;
const healthServer = startHealthServer({
  port: env.PORT,
  redis,
  isRunning: () => running,
});

logger.info({ port: env.PORT }, 'transfer executor running');

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

  // close() waits for the in-flight job; each job is one atomic transaction.
  await worker.close();
  healthServer.close();
  await redis.quit();
  await pool.end();
  logger.info('shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
