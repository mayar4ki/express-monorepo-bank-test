import { sql } from 'drizzle-orm';
import { inject } from 'vitest';

import { createDb } from '@bank/db';
import type { Db } from '@bank/db';

import { createApp } from '../../src/app.js';
import { loadSigningKeys } from '../../src/lib/keys.js';
import type { TokenConfig } from '../../src/lib/tokens.js';

export const testTokenConfig: TokenConfig = {
  issuer: 'bank-auth-test',
  audience: 'bank-internal-api-test',
  ttlSeconds: 3600,
};

export async function createTestContext() {
  const { db, pool } = createDb(inject('databaseUrl'));
  // Ephemeral dev-fallback keypair: exactly the non-production path.
  const keys = await loadSigningKeys({ NODE_ENV: 'test' });
  const { app } = createApp({ db, keys, tokenConfig: testTokenConfig });
  return {
    db,
    app,
    keys,
    close: () => pool.end(),
  };
}

export async function resetUsers(db: Db): Promise<void> {
  await db.execute(sql`TRUNCATE users RESTART IDENTITY CASCADE`);
}
