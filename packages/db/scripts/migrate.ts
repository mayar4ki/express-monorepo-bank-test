/**
 * One-shot migrate + seed entrypoint (the `migrate` service in
 * docker-compose, `pnpm db:migrate` locally). Applies all migrations,
 * seeds the four assignment customers and the admin user from ADMIN_* env
 * vars. Every step is idempotent, so it is safe to run on every stack start.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';

import { createDb, runMigrations, seed, seedAdminUser } from '../src/index.js';

const {
  DATABASE_URL,
  ADMIN_EMAIL = 'admin@bank.local',
  ADMIN_PASSWORD = 'admin12345',
  ADMIN_NAME = 'Admin',
} = process.env;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required (see packages/db/.env.example)');
}
if (ADMIN_PASSWORD.length < 8) {
  throw new Error('ADMIN_PASSWORD must be at least 8 characters');
}

const { db, pool } = createDb(DATABASE_URL);

await runMigrations(db);
await seed(db);
await seedAdminUser(db, {
  email: ADMIN_EMAIL.toLowerCase(),
  passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 11),
  name: ADMIN_NAME,
});
await pool.end();
console.log('migrations and seed applied');
