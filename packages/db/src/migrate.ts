import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import type { Db } from './client.js';

/**
 * The migrations folder ships inside this package (packages/db/migrations).
 * When an app is bundled for Docker, the MIGRATIONS_DIR env var overrides
 * the location (the images place the folder next to the bundle).
 */
export function resolveMigrationsFolder(): string {
  return process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL('../migrations', import.meta.url));
}

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: resolveMigrationsFolder() });
}
