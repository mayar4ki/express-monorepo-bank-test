import cors from 'cors';
import express from 'express';
import { sql } from 'drizzle-orm';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import { z } from 'zod';

import type { Db } from '@bank/db';
import type { TransfersQueue } from '@bank/queue';
import {
  createDocsRouter,
  defineRoute,
  errorHandler,
  mountRoutes,
  notFoundHandler,
} from '@bank/shared';

import { requireAuth } from './middleware/auth.js';
import type { TokenVerifier } from './middleware/auth.js';
import { accountRoutes } from './modules/accounts/router.js';
import { AccountService } from './modules/accounts/service.js';
import { commentRoutes } from './modules/comments/router.js';
import { CommentService } from './modules/comments/service.js';
import { customerRoutes } from './modules/customers/router.js';
import { CustomerService } from './modules/customers/service.js';
import { lockRoutes } from './modules/locks/router.js';
import { LockService } from './modules/locks/service.js';
import { transferRoutes } from './modules/transfers/router.js';
import { TransferService } from './modules/transfers/service.js';

export interface AppDeps {
  db: Db;
  transfersQueue: TransfersQueue;
  verifier: TokenVerifier;
  logger?: Logger;
  /** Origins allowed to make cross-origin requests; empty or omitted denies all. */
  corsAllowedOrigins?: string[];
  /** Other services' OpenAPI spec URLs merged into /docs (gateway view). */
  docsMergeSpecUrls?: string[];
}

/** Routes reachable without a token. */
const PUBLIC_PATH_PREFIXES = ['/health', '/docs'];

const healthResponse = z
  .object({
    status: z.literal('ok'),
    queue: z
      .record(z.string(), z.number())
      .meta({ description: 'Transfer job counts by state (waiting, active, failed, ...)' }),
  })
  .meta({ id: 'Health' });

export function createApp({
  db,
  transfersQueue,
  verifier,
  logger,
  corsAllowedOrigins = [],
  docsMergeSpecUrls = [],
}: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: corsAllowedOrigins, maxAge: 600 }));
  app.use(express.json());
  if (logger) {
    app.use(pinoHttp({ logger }));
  }
  app.use(requireAuth(verifier, { publicPathPrefixes: PUBLIC_PATH_PREFIXES }));

  const healthRoute = defineRoute({
    method: 'get',
    path: '/health',
    summary: 'Liveness check (verifies database and queue connectivity)',
    tags: ['System'],
    responses: { 200: { description: 'Service is healthy', schema: healthResponse } },
    handler: async () => {
      await db.execute(sql`SELECT 1`);
      const queue = await transfersQueue.getJobCounts('waiting', 'active', 'delayed', 'failed');
      return { status: 200, body: { status: 'ok', queue } };
    },
  });

  const routes = [
    healthRoute,
    ...customerRoutes(new CustomerService(db)),
    ...accountRoutes(new AccountService(db)),
    ...transferRoutes(new TransferService(db, transfersQueue)),
    ...lockRoutes(new LockService(db)),
    ...commentRoutes(new CommentService(db)),
  ];

  app.use(mountRoutes(routes));
  app.use(
    createDocsRouter(
      routes,
      {
        title: 'Internal Banking API',
        version: '1.0.0',
        description:
          'Internal API for bank employees: customers, accounts, transfers, comments and locks. ' +
          'All monetary amounts are integer cents. All routes except /health and /docs require ' +
          'a Bearer JWT issued by the auth API.',
        bearerAuth: { publicPaths: ['/health'] },
      },
      { mergeSpecUrls: docsMergeSpecUrls },
    ),
  );
  app.use(notFoundHandler);
  app.use(errorHandler);

  return { app };
}
