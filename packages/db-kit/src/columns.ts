import { bigint, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Column conventions shared by every database in the platform. They live here
 * rather than in one schema package so the banking and telemetry clusters
 * cannot drift apart on something as basic as what an id or a timestamp is.
 */

export const id = () => uuid().defaultRandom().primaryKey();

/**
 * Monotonic insert-order column. UUIDs are random, so tables that need a
 * stable ordering (lists, keyset pagination) order by this instead of id.
 */
export const seq = () => bigint('seq', { mode: 'number' }).notNull().generatedAlwaysAsIdentity();

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
