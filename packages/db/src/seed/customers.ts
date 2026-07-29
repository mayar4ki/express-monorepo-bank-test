import { sql } from 'drizzle-orm';

import type { Db } from '../client.js';

/**
 * Fixed, well-known ids for the four assignment customers so the seed is
 * idempotent and the ids are predictable in docs and tests.
 */
export const seedCustomerIds = {
  arishaBarron: '00000000-0000-4000-8000-000000000001',
  brandenGibson: '00000000-0000-4000-8000-000000000002',
  rhondaChurch: '00000000-0000-4000-8000-000000000003',
  georginaHazel: '00000000-0000-4000-8000-000000000004',
} as const;

/**
 * Inserts the four assignment customers with fixed ids. Idempotent —
 * safe to run on every application start.
 */
export async function seedCustomers(db: Db): Promise<void> {
  await db.execute(sql`
    INSERT INTO customers (id, name)
    VALUES
      (${seedCustomerIds.arishaBarron}, 'Arisha Barron'),
      (${seedCustomerIds.brandenGibson}, 'Branden Gibson'),
      (${seedCustomerIds.rhondaChurch}, 'Rhonda Church'),
      (${seedCustomerIds.georginaHazel}, 'Georgina Hazel')
    ON CONFLICT (id) DO NOTHING
  `);
}
