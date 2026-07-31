import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';

export interface TestPostgres {
  databaseUrl: string;
  stop: () => Promise<void>;
}

/**
 * Starts a disposable Postgres for tests, or reuses an existing one when the
 * given environment variable is set. Each cluster passes its own variable name
 * so a test run can point the two clusters at different instances.
 *
 * `applyMigrations` is a callback rather than a fixed step, because which
 * migrations to apply is the calling package's business.
 */
export async function startPostgresForTests(options: {
  reuseEnvVar: string;
  applyMigrations: (databaseUrl: string) => Promise<void>;
}): Promise<TestPostgres> {
  let container: StartedPostgreSqlContainer | undefined;
  let databaseUrl = process.env[options.reuseEnvVar];

  if (!databaseUrl) {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    databaseUrl = container.getConnectionUri();
  }

  await options.applyMigrations(databaseUrl);

  return {
    databaseUrl,
    stop: async () => {
      await container?.stop();
    },
  };
}
