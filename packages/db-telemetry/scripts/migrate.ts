/**
 * One-shot migrate entrypoint for the telemetry cluster (the
 * `migrate-telemetry` service in docker-compose, `pnpm db:migrate` locally).
 * Idempotent, so it is safe to run on every stack start.
 *
 * There is no seed step: vehicles register themselves the first time their
 * device reports, and geofences are operator-configured.
 */
import 'dotenv/config';

import { createTelemetryDb, runTelemetryMigrations } from '../src/index.js';

const { TELEMETRY_DATABASE_URL } = process.env;

if (!TELEMETRY_DATABASE_URL) {
  throw new Error('TELEMETRY_DATABASE_URL is required (see packages/db-telemetry/.env.example)');
}

const { db, pool } = createTelemetryDb(TELEMETRY_DATABASE_URL);

await runTelemetryMigrations(db);
await pool.end();
console.log('telemetry migrations applied');
