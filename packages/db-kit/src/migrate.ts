import { fileURLToPath } from 'node:url';

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

/**
 * Each cluster ships its own migrations folder and its own override variable,
 * so they can be pointed at different locations independently — the Docker
 * images place the folder next to the bundle rather than inside the package.
 */
export function resolveMigrationsFolder(packageFolder: URL, overrideEnvVar: string): string {
  return process.env[overrideEnvVar] ?? fileURLToPath(packageFolder);
}

export async function runMigrations<TSchema extends Record<string, unknown>>(
  db: NodePgDatabase<TSchema>,
  migrationsFolder: string,
): Promise<void> {
  await migrate(db, { migrationsFolder });
}
