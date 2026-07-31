import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { accounts } from './accounts.js';
import { createdAt, id, seq } from '@bank/db-kit';

export const accountComments = pgTable(
  'account_comments',
  {
    id: id(),
    seq: seq(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    body: text().notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('account_comments_account_id_idx').on(table.accountId)],
);
