import { startPostgresForTests } from '@bank/db-kit/testing';
import type { TestPostgres } from '@bank/db-kit/testing';

import { createTelemetryDb } from './client.js';
import { runTelemetryMigrations } from './migrate.js';

export type { TestPostgres };

/**
 * Starts a disposable telemetry Postgres for tests (or reuses
 * TEST_TELEMETRY_DATABASE_URL) and applies the telemetry migrations once.
 */
export async function startTelemetryPostgresForTests(): Promise<TestPostgres> {
  return startPostgresForTests({
    reuseEnvVar: 'TEST_TELEMETRY_DATABASE_URL',
    applyMigrations: async (databaseUrl) => {
      const { db, pool } = createTelemetryDb(databaseUrl);
      await runTelemetryMigrations(db);
      await pool.end();
    },
  });
}
