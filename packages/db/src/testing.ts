import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';

import { createDb } from './client.js';
import { runMigrations } from './migrate.js';

export interface TestPostgres {
  databaseUrl: string;
  stop: () => Promise<void>;
}

/**
 * Starts a disposable Postgres for tests (or reuses TEST_DATABASE_URL if
 * set) and applies all migrations once.
 */
export async function startPostgresForTests(): Promise<TestPostgres> {
  let container: StartedPostgreSqlContainer | undefined;
  let databaseUrl = process.env.TEST_DATABASE_URL;

  if (!databaseUrl) {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    databaseUrl = container.getConnectionUri();
  }

  const { db, pool } = createDb(databaseUrl);
  await runMigrations(db);
  await pool.end();

  return {
    databaseUrl,
    stop: async () => {
      await container?.stop();
    },
  };
}
