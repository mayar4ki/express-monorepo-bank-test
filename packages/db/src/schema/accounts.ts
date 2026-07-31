import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, uuid } from 'drizzle-orm/pg-core';

import { createdAt, id, seq } from '@bank/db-kit';
import { customers } from './customers.js';

export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    seq: seq(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    balanceCents: bigint('balance_cents', { mode: 'number' }).notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    index('accounts_customer_id_idx').on(table.customerId),
    check('accounts_balance_non_negative', sql`${table.balanceCents} >= 0`),
  ],
);
