import { resolveMigrationsFolder, runMigrations } from '@bank/db-kit';

import type { TelemetryDb } from './client.js';

/**
 * The migrations folder ships inside this package. TELEMETRY_MIGRATIONS_DIR
 * overrides it for the Docker image, which places the folder next to the
 * bundle. Separate from the banking cluster's MIGRATIONS_DIR so the two can be
 * pointed at different locations.
 */
export function resolveTelemetryMigrationsFolder(): string {
  return resolveMigrationsFolder(
    new URL('../migrations', import.meta.url),
    'TELEMETRY_MIGRATIONS_DIR',
  );
}

export async function runTelemetryMigrations(db: TelemetryDb): Promise<void> {
  await runMigrations(db, resolveTelemetryMigrationsFolder());
}
