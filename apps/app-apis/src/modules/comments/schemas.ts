import { z } from 'zod';

import { idSchema } from '@bank/shared';

export const commentParams = z.object({ accountId: idSchema });

export const createCommentBody = z
  .object({
    body: z.string().trim().min(1).max(5000).meta({
      description: 'Internal free-text note, visible to bank employees only',
      example: 'Customer called about a disputed charge; follow up next week.',
    }),
  })
  .meta({ id: 'CreateComment' });

export const commentResponse = z
  .object({
    id: z.uuid(),
    accountId: z.uuid(),
    body: z.string(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Comment' });

export const commentListResponse = z.array(commentResponse);
