import { z } from 'zod';

import { nonNegativeCents } from '@bank/shared';
import { idSchema } from '@bank/shared';

export const accountParams = z.object({ accountId: idSchema });

export const createAccountBody = z
  .object({
    customerId: idSchema.meta({ description: 'Owner of the new account' }),
    initialDepositCents: nonNegativeCents.meta({
      description: 'Opening balance in cents; zero opens an empty account',
      example: 100_000,
    }),
  })
  .meta({ id: 'CreateAccount' });

export const accountResponse = z
  .object({
    id: z.uuid(),
    customerId: z.uuid(),
    balanceCents: z.number().meta({ example: 100_000 }),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Account' });

export const accountDetailResponse = accountResponse
  .extend({
    locked: z
      .boolean()
      .meta({ description: 'True while the account has at least one active lock' }),
  })
  .meta({ id: 'AccountDetail' });

export const accountListResponse = z.array(accountResponse);

export const balanceResponse = z
  .object({
    accountId: z.uuid(),
    balanceCents: z.number().meta({ example: 100_000 }),
  })
  .meta({ id: 'Balance' });

export const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50).meta({
    description: 'Page size (max 200)',
  }),
  cursor: z.coerce.number().int().positive().optional().meta({
    description: 'Opaque pagination cursor: pass the nextCursor of the previous page',
  }),
});
