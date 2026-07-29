import { defineRoute } from '@bank/shared';
import { errorEnvelope } from '@bank/shared';
import type { CommentService } from './service.js';
import {
  commentListResponse,
  commentParams,
  commentResponse,
  createCommentBody,
} from './schemas.js';

export function commentRoutes(service: CommentService) {
  return [
    defineRoute({
      method: 'post',
      path: '/accounts/:accountId/comments',
      summary: 'Add an internal comment to an account',
      tags: ['Comments'],
      request: { params: commentParams, body: createCommentBody },
      responses: {
        201: { description: 'Comment created', schema: commentResponse },
        400: { description: 'Validation error', schema: errorEnvelope },
        404: { description: 'Account not found', schema: errorEnvelope },
      },
      handler: async ({ params, body }) => ({
        status: 201,
        body: await service.create(params.accountId, body.body),
      }),
    }),

    defineRoute({
      method: 'get',
      path: '/accounts/:accountId/comments',
      summary: 'List internal comments of an account',
      tags: ['Comments'],
      request: { params: commentParams },
      responses: {
        200: { description: 'Comments, newest first', schema: commentListResponse },
        404: { description: 'Account not found', schema: errorEnvelope },
      },
      handler: async ({ params }) => ({ status: 200, body: await service.list(params.accountId) }),
    }),
  ];
}
