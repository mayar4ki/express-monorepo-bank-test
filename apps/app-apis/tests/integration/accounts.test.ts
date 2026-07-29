import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  UNKNOWN_ID,
  createAccount,
  createTestContext,
  resetDb,
  seedCustomerIds,
  waitForNoPending,
} from '../helpers/test-app.js';

const ctx = createTestContext();

afterAll(() => ctx.close());
beforeEach(() => resetDb(ctx.db));

describe('POST /accounts', () => {
  it('opens an account with an initial deposit that shows up in history', async () => {
    const created = await ctx.api
      .post('/accounts')
      .send({ customerId: seedCustomerIds.arishaBarron, initialDepositCents: 100_000 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      customerId: seedCustomerIds.arishaBarron,
      balanceCents: 100_000,
    });

    const accountId = created.body.id as string;
    const history = await ctx.api.get(`/accounts/${accountId}/transfers`);
    expect(history.status).toBe(200);
    expect(history.body.items).toHaveLength(1);
    expect(history.body.items[0]).toMatchObject({
      type: 'deposit',
      fromAccountId: null,
      toAccountId: accountId,
      amountCents: 100_000,
      status: 'completed',
    });
  });

  it('opens an empty account when the deposit is zero (no history entry)', async () => {
    const created = await ctx.api
      .post('/accounts')
      .send({ customerId: seedCustomerIds.brandenGibson, initialDepositCents: 0 });
    expect(created.status).toBe(201);
    expect(created.body.balanceCents).toBe(0);

    const history = await ctx.api.get(`/accounts/${created.body.id}/transfers`);
    expect(history.body.items).toHaveLength(0);
  });

  it('allows a customer to own multiple accounts', async () => {
    const first = await ctx.api
      .post('/accounts')
      .send({ customerId: seedCustomerIds.rhondaChurch, initialDepositCents: 1 });
    const second = await ctx.api
      .post('/accounts')
      .send({ customerId: seedCustomerIds.rhondaChurch, initialDepositCents: 2 });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.id).not.toBe(second.body.id);
  });

  it('404s for an unknown customer and 400s for bad deposits', async () => {
    const missing = await ctx.api
      .post('/accounts')
      .send({ customerId: UNKNOWN_ID, initialDepositCents: 100 });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('CUSTOMER_NOT_FOUND');

    for (const initialDepositCents of [-1, 10.5, Number.MAX_SAFE_INTEGER + 1]) {
      const bad = await ctx.api
        .post('/accounts')
        .send({ customerId: seedCustomerIds.arishaBarron, initialDepositCents });
      expect(bad.status).toBe(400);
    }
  });
});

describe('GET /accounts/:id and /balance', () => {
  it('returns account details with lock status', async () => {
    const accountId = await createAccount(ctx.db, seedCustomerIds.arishaBarron, 2_500);
    const res = await ctx.api.get(`/accounts/${accountId}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: accountId, balanceCents: 2_500, locked: false });
  });

  it('returns the balance', async () => {
    const accountId = await createAccount(ctx.db, seedCustomerIds.arishaBarron, 7_777);
    const res = await ctx.api.get(`/accounts/${accountId}/balance`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accountId, balanceCents: 7_777 });
  });

  it('404s on unknown accounts', async () => {
    for (const path of [
      `/accounts/${UNKNOWN_ID}`,
      `/accounts/${UNKNOWN_ID}/balance`,
      `/accounts/${UNKNOWN_ID}/transfers`,
    ]) {
      const res = await ctx.api.get(path);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
    }
  });
});

describe('GET /accounts/:id/transfers pagination', () => {
  it('paginates with a keyset cursor, newest first', async () => {
    const a = await createAccount(ctx.db, seedCustomerIds.arishaBarron, 100_000);
    const b = await createAccount(ctx.db, seedCustomerIds.brandenGibson, 0);
    for (let i = 0; i < 5; i += 1) {
      await ctx.api
        .post('/transfers')
        .set('Idempotency-Key', `page-${i}`)
        .send({ fromAccountId: a, toAccountId: b, amountCents: 10 + i });
    }
    await waitForNoPending(ctx.db);

    const firstPage = await ctx.api.get(`/accounts/${a}/transfers?limit=3`);
    expect(firstPage.status).toBe(200);
    // 5 transfers + 1 opening deposit = 6 entries, newest first
    expect(firstPage.body.items).toHaveLength(3);
    expect(firstPage.body.items[0].amountCents).toBe(14);
    expect(firstPage.body.nextCursor).not.toBeNull();

    const secondPage = await ctx.api.get(
      `/accounts/${a}/transfers?limit=3&cursor=${firstPage.body.nextCursor}`,
    );
    expect(secondPage.body.items).toHaveLength(3);
    expect(secondPage.body.items.at(-1)).toMatchObject({ type: 'deposit' });
    expect(secondPage.body.nextCursor).toBeNull();

    // Newest first across both pages: transfer amounts 14..10, then the deposit.
    const amounts = [...firstPage.body.items, ...secondPage.body.items].map(
      (t: { amountCents: number }) => t.amountCents,
    );
    expect(amounts).toEqual([14, 13, 12, 11, 10, 100_000]);
  });
});
