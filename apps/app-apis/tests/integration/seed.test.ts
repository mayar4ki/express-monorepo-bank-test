import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { customers, seed, seedCustomerIds } from '@bank/db';
import { createTestContext, resetDb } from '../helpers/test-app.js';

const ctx = createTestContext();

afterAll(() => ctx.close());
beforeEach(() => resetDb(ctx.db));

describe('seed', () => {
  it('is idempotent: running it again changes nothing', async () => {
    await seed(ctx.db);
    await seed(ctx.db);
    const rows = await ctx.db.select().from(customers);
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.id).sort()).toEqual(Object.values(seedCustomerIds).sort());
  });

  it('does not collide with newly created customers', async () => {
    await seed(ctx.db);
    const [created] = await ctx.db.insert(customers).values({ name: 'Fifth' }).returning();
    expect(created?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.values(seedCustomerIds)).not.toContain(created?.id);
  });
});
