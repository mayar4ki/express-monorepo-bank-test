import { pgTable, text } from 'drizzle-orm/pg-core';

import { createdAt, id, seq } from './common.js';

export const customers = pgTable('customers', {
  id: id(),
  seq: seq(),
  name: text().notNull(),
  createdAt: createdAt(),
});
