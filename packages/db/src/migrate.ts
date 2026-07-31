import {
  resolveMigrationsFolder as resolveKitMigrationsFolder,
  runMigrations as runKitMigrations,
} from '@bank/db-kit';

import type { Db } from './client.js';

/**
 * The migrations folder ships inside this package (packages/db/migrations).
 * When an app is bundled for Docker, the MIGRATIONS_DIR env var overrides
 * the location (the images place the folder next to the bundle).
 */
export function resolveMigrationsFolder(): string {
  return resolveKitMigrationsFolder(new URL('../migrations', import.meta.url), 'MIGRATIONS_DIR');
}

export async function runMigrations(db: Db): Promise<void> {
  await runKitMigrations(db, resolveMigrationsFolder());
}
