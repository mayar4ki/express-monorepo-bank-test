import { startPostgresForTests as startKitPostgres } from '@bank/db-kit/testing';
import type { TestPostgres } from '@bank/db-kit/testing';

import { createDb } from './client.js';
import { runMigrations } from './migrate.js';

export type { TestPostgres };

/**
 * Starts a disposable banking Postgres for tests (or reuses TEST_DATABASE_URL
 * if set) and applies all migrations once.
 */
export async function startPostgresForTests(): Promise<TestPostgres> {
  return startKitPostgres({
    reuseEnvVar: 'TEST_DATABASE_URL',
    applyMigrations: async (databaseUrl) => {
      const { db, pool } = createDb(databaseUrl);
      await runMigrations(db);
      await pool.end();
    },
  });
}
