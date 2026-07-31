import { createPool, DRIZZLE_OPTIONS } from '@bank/db-kit';
import { drizzle } from 'drizzle-orm/node-postgres';

import * as schema from './schema/index.js';

export type TelemetryDb = ReturnType<typeof createTelemetryDb>['db'];

/**
 * Connects to the telemetry cluster — a different Postgres instance from the
 * banking one. The two are deliberately separate packages so nothing can join
 * across the boundary: such a query would typecheck but find no table.
 */
export function createTelemetryDb(databaseUrl: string) {
  const pool = createPool(databaseUrl);
  const db = drizzle(pool, { schema, ...DRIZZLE_OPTIONS });
  return { db, pool };
}
