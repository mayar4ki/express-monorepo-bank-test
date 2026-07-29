import 'dotenv/config';
import { pino } from 'pino';

import { createDb } from '@bank/db';
import { createRedisConnection, createTransfersQueue } from '@bank/queue';

import { createApp } from './app.js';
import { loadEnv } from './env.js';
import { createRemoteJwksVerifier } from './middleware/auth.js';

const SHUTDOWN_TIMEOUT_MS = 15_000;

export function startServer() {
  const env = loadEnv();
  const logger = pino({ level: env.LOG_LEVEL });
  const { db, pool } = createDb(env.DATABASE_URL);
  const redis = createRedisConnection(env.REDIS_URL);
  const transfersQueue = createTransfersQueue(redis);
  const { app } = createApp({
    db,
    transfersQueue,
    verifier: createRemoteJwksVerifier({
      jwksUrl: env.AUTH_JWKS_URL,
      issuer: env.AUTH_ISSUER,
      audience: env.AUTH_AUDIENCE,
    }),
    logger,
    corsAllowedOrigins: env.CORS_ALLOWED_ORIGINS,
    docsMergeSpecUrls: env.DOCS_MERGE_SPEC_URLS,
  });

  const server = app.listen(env.PORT, () => {
    logger.info(`listening on port ${env.PORT} (docs at /docs)`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    const hardExit = setTimeout(() => {
      logger.error('graceful shutdown timed out, exiting');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    hardExit.unref();

    // Execution is the executor service's job; the API only needs to stop
    // taking requests and release its connections.
    server.close(() => {
      void transfersQueue
        .close()
        .then(() => redis.quit())
        .then(() => pool.end())
        .then(() => {
          logger.info('shutdown complete');
          process.exit(0);
        });
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return { server };
}

const entryHref = process.argv[1] ? new URL(`file://${process.argv[1]}`).href : '';
if (import.meta.url === entryHref) {
  startServer();
}
