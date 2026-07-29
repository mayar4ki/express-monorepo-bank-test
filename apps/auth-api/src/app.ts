import cors from 'cors';
import express from 'express';
import { sql } from 'drizzle-orm';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import { z } from 'zod';

import type { Db } from '@bank/db';
import {
  createDocsRouter,
  defineRoute,
  errorHandler,
  mountRoutes,
  notFoundHandler,
} from '@bank/shared';

import type { SigningKeys } from './lib/keys.js';
import type { TokenConfig } from './lib/tokens.js';
import { authRoutes } from './modules/auth/router.js';
import { AuthService } from './modules/auth/service.js';

export interface AppDeps {
  db: Db;
  keys: SigningKeys;
  tokenConfig: TokenConfig;
  logger?: Logger;
  /** Origins allowed to make cross-origin requests; empty or omitted denies all. */
  corsAllowedOrigins?: string[];
}

const healthResponse = z.object({ status: z.literal('ok') }).meta({ id: 'Health' });

export function createApp({ db, keys, tokenConfig, logger, corsAllowedOrigins = [] }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: corsAllowedOrigins, maxAge: 600 }));
  app.use(express.json());
  if (logger) {
    app.use(pinoHttp({ logger }));
  }

  const healthRoute = defineRoute({
    method: 'get',
    path: '/health',
    summary: 'Liveness check (verifies database connectivity)',
    tags: ['System'],
    responses: { 200: { description: 'Service is healthy', schema: healthResponse } },
    handler: async () => {
      await db.execute(sql`SELECT 1`);
      return { status: 200, body: { status: 'ok' } };
    },
  });

  const routes = [healthRoute, ...authRoutes(new AuthService(db), keys, tokenConfig)];

  app.use(mountRoutes(routes));
  app.use(
    createDocsRouter(routes, {
      title: 'Bank Auth API',
      version: '1.0.0',
      description:
        'Authentication service for the internal banking platform. Issues ES256 JWTs; ' +
        'resource services verify them via /.well-known/jwks.json.',
    }),
  );
  app.use(notFoundHandler);
  app.use(errorHandler);

  return { app };
}
