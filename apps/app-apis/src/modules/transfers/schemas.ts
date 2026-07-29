import { z } from 'zod';

import { positiveCents } from '@bank/shared';
import { idSchema } from '@bank/shared';

export const transferParams = z.object({ transferId: idSchema });

export const idempotencyHeaders = z.object({
  'idempotency-key': z
    .string()
    .min(1)
    .max(255)
    .meta({
      description:
        'Client-generated unique key. Retrying with the same key and payload returns the ' +
        'original result instead of executing a second transfer.',
      example: '9f2a7c4e-0b1d-4a6e-8f3c-2d5e7a9b1c3d',
    }),
});

export const createTransferBody = z
  .object({
    fromAccountId: idSchema.meta({ description: 'Account to debit' }),
    toAccountId: idSchema.meta({ description: 'Account to credit' }),
    amountCents: positiveCents,
  })
  .meta({ id: 'CreateTransfer' });

export const transferResponse = z
  .object({
    id: z.uuid(),
    type: z.enum(['transfer', 'deposit']).meta({
      description: 'deposit = the account-opening credit (no source account)',
    }),
    fromAccountId: z.uuid().nullable(),
    toAccountId: z.uuid(),
    amountCents: z.number().meta({ example: 12_550 }),
    status: z.enum(['pending', 'completed', 'failed']),
    failureReason: z.string().nullable().meta({ example: null }),
    idempotencyKey: z.string().nullable(),
    createdAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'Transfer' });

export const transferHistoryResponse = z
  .object({
    items: z.array(transferResponse),
    nextCursor: z.number().nullable().meta({
      description: 'Pass as ?cursor= to fetch the next page; null when there are no more',
    }),
  })
  .meta({ id: 'TransferHistory' });

export type TransferDto = z.infer<typeof transferResponse>;
