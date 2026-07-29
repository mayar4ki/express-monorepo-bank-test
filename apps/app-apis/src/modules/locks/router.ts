import { z } from 'zod';

import { defineRoute } from '@bank/shared';
import { errorEnvelope, idSchema } from '@bank/shared';
import type { LockService } from './service.js';
import {
  createLockBody,
  lockListQuery,
  lockListResponse,
  lockParams,
  lockResponse,
} from './schemas.js';

const accountOnlyParams = z.object({ accountId: idSchema });

export function lockRoutes(service: LockService) {
  return [
    defineRoute({
      method: 'post',
      path: '/accounts/:accountId/locks',
      summary: 'Lock an account (blocks incoming and outgoing transfers)',
      tags: ['Locks'],
      request: { params: accountOnlyParams, body: createLockBody },
      responses: {
        201: { description: 'Lock created and active', schema: lockResponse },
        400: { description: 'Validation error', schema: errorEnvelope },
        404: { description: 'Account not found', schema: errorEnvelope },
      },
      handler: async ({ params, body }) => ({
        status: 201,
        body: await service.create(params.accountId, body.reason),
      }),
    }),

    defineRoute({
      method: 'get',
      path: '/accounts/:accountId/locks',
      summary: 'List locks of an account',
      tags: ['Locks'],
      request: { params: accountOnlyParams, query: lockListQuery },
      responses: {
        200: { description: 'Locks, newest first', schema: lockListResponse },
        404: { description: 'Account not found', schema: errorEnvelope },
      },
      handler: async ({ params, query }) => ({
        status: 200,
        body: await service.list(params.accountId, query.active),
      }),
    }),

    defineRoute({
      method: 'delete',
      path: '/accounts/:accountId/locks/:lockId',
      summary: 'Release a lock',
      tags: ['Locks'],
      request: { params: lockParams },
      responses: {
        200: { description: 'Lock released', schema: lockResponse },
        404: { description: 'Account or lock not found', schema: errorEnvelope },
        409: { description: 'Lock already released', schema: errorEnvelope },
      },
      handler: async ({ params }) => ({
        status: 200,
        body: await service.release(params.accountId, params.lockId),
      }),
    }),
  ];
}
