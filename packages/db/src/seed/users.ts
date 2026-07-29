import { sql } from 'drizzle-orm';

import type { Db } from '../client.js';

export interface AdminSeed {
  email: string;
  /** Already hashed (the db package stays hashing-algorithm agnostic). */
  passwordHash: string;
  name: string;
}

/**
 * Seeds the admin user (credentials come from ADMIN_* env vars, hashed by
 * the caller). Idempotent: an existing user with the same email is left
 * untouched — changing ADMIN_PASSWORD later does not overwrite it.
 */
export async function seedAdminUser(db: Db, admin: AdminSeed): Promise<void> {
  await db.execute(sql`
    INSERT INTO users (email, password_hash, name)
    VALUES (${admin.email}, ${admin.passwordHash}, ${admin.name})
    ON CONFLICT DO NOTHING
  `);
}
