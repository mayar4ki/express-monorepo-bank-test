import { bigint, timestamp, uuid } from 'drizzle-orm/pg-core';

export const id = () => uuid().defaultRandom().primaryKey();

/**
 * Monotonic insert-order column. UUIDs are random, so tables that need a
 * stable ordering (lists, keyset pagination) order by this instead of id.
 */
export const seq = () => bigint('seq', { mode: 'number' }).notNull().generatedAlwaysAsIdentity();

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
