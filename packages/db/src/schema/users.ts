import { sql } from 'drizzle-orm';
import { pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { createdAt, id } from '@bank/db-kit';

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text().notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text().notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('users_email_uq').on(sql`lower(${table.email})`)],
);
