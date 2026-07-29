import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  UNKNOWN_ID,
  createAccount,
  createTestContext,
  resetDb,
  seedCustomerIds,
} from '../helpers/test-app.js';

const ctx = createTestContext();

afterAll(() => ctx.close());
beforeEach(() => resetDb(ctx.db));

describe('account comments', () => {
  it('adds and lists internal comments, newest first', async () => {
    const accountId = await createAccount(ctx.db, seedCustomerIds.arishaBarron, 0);

    const first = await ctx.api
      .post(`/accounts/${accountId}/comments`)
      .send({ body: 'Customer called about a disputed charge.' });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      accountId,
      body: 'Customer called about a disputed charge.',
    });

    await ctx.api.post(`/accounts/${accountId}/comments`).send({ body: 'Follow-up done.' });

    const list = await ctx.api.get(`/accounts/${accountId}/comments`);
    expect(list.status).toBe(200);
    expect(list.body.map((c: { body: string }) => c.body)).toEqual([
      'Follow-up done.',
      'Customer called about a disputed charge.',
    ]);
  });

  it('404s on unknown accounts and 400s on empty bodies', async () => {
    const missing = await ctx.api.post(`/accounts/${UNKNOWN_ID}/comments`).send({ body: 'x' });
    expect(missing.status).toBe(404);

    const missingList = await ctx.api.get(`/accounts/${UNKNOWN_ID}/comments`);
    expect(missingList.status).toBe(404);

    const accountId = await createAccount(ctx.db, seedCustomerIds.arishaBarron, 0);
    const empty = await ctx.api.post(`/accounts/${accountId}/comments`).send({ body: ' ' });
    expect(empty.status).toBe(400);
  });
});
