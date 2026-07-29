import 'dotenv/config';
import { pino } from 'pino';

import { createDb } from '@bank/db';

import { createApp } from './app.js';
import { loadEnv } from './env.js';
import { loadSigningKeys } from './lib/keys.js';

const SHUTDOWN_TIMEOUT_MS = 15_000;

const env = loadEnv();
const logger = pino({ level: env.LOG_LEVEL });
const { db, pool } = createDb(env.DATABASE_URL);
const keys = await loadSigningKeys({ ...env, logger });

const { app } = createApp({
  db,
  keys,
  tokenConfig: {
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    ttlSeconds: env.JWT_TTL_SECONDS,
  },
  logger,
  corsAllowedOrigins: env.CORS_ALLOWED_ORIGINS,
});

const server = app.listen(env.PORT, () => {
  logger.info(`auth-api listening on port ${env.PORT} (docs at /docs)`);
});

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  const hardExit = setTimeout(() => {
    logger.error('graceful shutdown timed out, exiting');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  hardExit.unref();

  server.close(() => {
    void pool.end().then(() => {
      logger.info('shutdown complete');
      process.exit(0);
    });
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
