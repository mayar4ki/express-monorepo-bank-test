import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema/index.js';

export type Db = ReturnType<typeof createDb>['db'];

export function createDb(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 20 });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { db, pool };
}
