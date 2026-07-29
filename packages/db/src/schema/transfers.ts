import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { accounts } from './accounts.js';
import { createdAt, id, seq } from './common.js';

export const transferStatus = pgEnum('transfer_status', ['pending', 'completed', 'failed']);

export const transfers = pgTable(
  'transfers',
  {
    id: id(),
    // Insert-order for history sorting and keyset pagination cursors.
    seq: seq(),
    // NULL for initial deposits, which need no idempotency key.
    idempotencyKey: text('idempotency_key'),
    requestHash: text('request_hash'),
    // NULL = external money in (the account-opening deposit).
    fromAccountId: uuid('from_account_id').references(() => accounts.id),
    toAccountId: uuid('to_account_id')
      .notNull()
      .references(() => accounts.id),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    status: transferStatus().notNull(),
    failureReason: text('failure_reason'),
    createdAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('transfers_idempotency_key_uq')
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    uniqueIndex('transfers_seq_uq').on(table.seq),
    index('transfers_from_account_id_idx').on(table.fromAccountId),
    index('transfers_to_account_id_idx').on(table.toAccountId),
    check('transfers_amount_positive', sql`${table.amountCents} > 0`),
    check(
      'transfers_distinct_accounts',
      sql`${table.fromAccountId} IS DISTINCT FROM ${table.toAccountId}`,
    ),
  ],
);
