import { createPool, DRIZZLE_OPTIONS } from '@bank/db-kit';
import { drizzle } from 'drizzle-orm/node-postgres';

import * as schema from './schema/index.js';

export type Db = ReturnType<typeof createDb>['db'];

/**
 * Connects to the banking cluster. Vehicle telemetry lives on a separate
 * instance behind `@bank/db-telemetry` — see docs/TELEMETRY.md for why.
 */
export function createDb(databaseUrl: string) {
  const pool = createPool(databaseUrl);
  const db = drizzle(pool, { schema, ...DRIZZLE_OPTIONS });
  return { db, pool };
}
