import { z } from 'zod';

import { idSchema } from '@bank/shared';

export const lockParams = z.object({ accountId: idSchema, lockId: idSchema });

export const createLockBody = z
  .object({
    reason: z.string().trim().min(1).max(1000).meta({
      description: 'Free-text reason for locking the account',
      example: 'Suspected fraudulent activity — case #4821',
    }),
  })
  .meta({ id: 'CreateLock' });

export const lockListQuery = z.object({
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional()
    .meta({ description: 'true = only active locks, false = only released, omitted = all' }),
});

export const lockResponse = z
  .object({
    id: z.uuid(),
    accountId: z.uuid(),
    reason: z.string().meta({ example: 'Suspected fraudulent activity — case #4821' }),
    createdAt: z.iso.datetime(),
    releasedAt: z.iso.datetime().nullable().meta({ description: 'null while the lock is active' }),
  })
  .meta({ id: 'Lock' });

export const lockListResponse = z.array(lockResponse);
