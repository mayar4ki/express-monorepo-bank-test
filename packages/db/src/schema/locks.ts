import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { accounts } from './accounts.js';
import { createdAt, id, seq } from './common.js';

export const accountLocks = pgTable(
  'account_locks',
  {
    id: id(),
    seq: seq(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    reason: text().notNull(),
    createdAt: createdAt(),
    // NULL = lock is active; releasing sets the timestamp (kept for audit).
    releasedAt: timestamp('released_at', { withTimezone: true }),
  },
  (table) => [
    index('account_locks_active_idx')
      .on(table.accountId)
      .where(sql`${table.releasedAt} IS NULL`),
  ],
);
