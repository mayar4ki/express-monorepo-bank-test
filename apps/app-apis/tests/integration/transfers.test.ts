import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { transfers } from '@bank/db';
import {
  UNKNOWN_ID,
  createAccount,
  createTestContext,
  resetDb,
  seedCustomerIds,
  waitForTransfer,
} from '../helpers/test-app.js';

const ctx = createTestContext();

afterAll(() => ctx.close());
beforeEach(() => resetDb(ctx.db));

async function twoAccounts(balanceA = 100_000, balanceB = 0) {
  const a = await createAccount(ctx.db, seedCustomerIds.arishaBarron, balanceA);
  const b = await createAccount(ctx.db, seedCustomerIds.brandenGibson, balanceB);
  return { a, b };
}

function postTransfer(key: string, body: Record<string, unknown>) {
  return ctx.api.post('/transfers').set('Idempotency-Key', key).send(body);
}

/** Submits a transfer (expects 202) and polls until it is terminal. */
async function transferAndWait(key: string, body: Record<string, unknown>) {
  const accepted = await postTransfer(key, body);
  expect(accepted.status).toBe(202);
  expect(accepted.body.status).toBe('pending');
  return waitForTransfer(ctx.api, accepted.body.id as string);
}

async function balanceOf(accountId: string): Promise<number> {
  const res = await ctx.api.get(`/accounts/${accountId}/balance`);
  return res.body.balanceCents as number;
}

describe('POST /transfers (async)', () => {
  it('accepts a transfer with 202 + Location and completes it via the worker', async () => {
    const { a, b } = await twoAccounts();
    const accepted = await postTransfer('t-1', {
      fromAccountId: a,
      toAccountId: b,
      amountCents: 25_000,
    });

    expect(accepted.status).toBe(202);
    expect(accepted.headers.location).toBe(`/transfers/${accepted.body.id}`);
    expect(accepted.body).toMatchObject({
      type: 'transfer',
      fromAccountId: a,
      toAccountId: b,
      amountCents: 25_000,
      status: 'pending',
      idempotencyKey: 't-1',
    });

    const final = await waitForTransfer(ctx.api, accepted.body.id as string);
    expect(final).toMatchObject({ status: 'completed' });
    expect(final.completedAt).not.toBeNull();

    expect(await balanceOf(a)).toBe(75_000);
    expect(await balanceOf(b)).toBe(25_000);
  });

  it('appears in the history of both accounts', async () => {
    const { a, b } = await twoAccounts();
    await transferAndWait('t-2', { fromAccountId: a, toAccountId: b, amountCents: 100 });

    for (const accountId of [a, b]) {
      const history = await ctx.api.get(`/accounts/${accountId}/transfers`);
      const entry = history.body.items.find((t: { type: string }) => t.type === 'transfer');
      expect(entry).toMatchObject({
        fromAccountId: a,
        toAccountId: b,
        amountCents: 100,
        status: 'completed',
      });
    }
  });

  it('requires the Idempotency-Key header', async () => {
    const { a, b } = await twoAccounts();
    const res = await ctx.api
      .post('/transfers')
      .send({ fromAccountId: a, toAccountId: b, amountCents: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects insufficient funds asynchronously with a durable failed transfer', async () => {
    const { a, b } = await twoAccounts(50, 0);
    const final = await transferAndWait('t-3', {
      fromAccountId: a,
      toAccountId: b,
      amountCents: 100,
    });

    expect(final).toMatchObject({ status: 'failed', failureReason: 'INSUFFICIENT_FUNDS' });
    expect(await balanceOf(a)).toBe(50);
    expect(await balanceOf(b)).toBe(0);
  });

  it('rejects a transfer to the same account synchronously', async () => {
    const { a } = await twoAccounts();
    const res = await postTransfer('t-4', { fromAccountId: a, toAccountId: a, amountCents: 100 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SAME_ACCOUNT');
  });

  it('404s on unknown source or destination without storing a transfer', async () => {
    const { a } = await twoAccounts();
    const missingTo = await postTransfer('t-5', {
      fromAccountId: a,
      toAccountId: UNKNOWN_ID,
      amountCents: 100,
    });
    expect(missingTo.status).toBe(404);

    const missingFrom = await postTransfer('t-6', {
      fromAccountId: UNKNOWN_ID,
      toAccountId: a,
      amountCents: 100,
    });
    expect(missingFrom.status).toBe(404);

    const rows = await ctx.db.select().from(transfers).where(eq(transfers.idempotencyKey, 't-5'));
    expect(rows).toHaveLength(0);
  });

  it('rejects zero, negative, fractional and unsafe amounts', async () => {
    const { a, b } = await twoAccounts();
    for (const amountCents of [0, -100, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const res = await postTransfer(`bad-${amountCents}`, {
        fromAccountId: a,
        toAccountId: b,
        amountCents,
      });
      expect(res.status).toBe(400);
    }
  });
});

describe('idempotency', () => {
  it('replays a completed transfer with 200 without moving money twice', async () => {
    const { a, b } = await twoAccounts();
    const body = { fromAccountId: a, toAccountId: b, amountCents: 10_000 };

    const final = await transferAndWait('idem-1', body);
    const replay = await postTransfer('idem-1', body);

    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(final);

    expect(await balanceOf(a)).toBe(90_000);
    expect(await balanceOf(b)).toBe(10_000);

    const rows = await ctx.db
      .select()
      .from(transfers)
      .where(eq(transfers.idempotencyKey, 'idem-1'));
    expect(rows).toHaveLength(1);
  });

  it('replays a failed transfer with 200 and the stored failure', async () => {
    const { a, b } = await twoAccounts(10, 0);
    const body = { fromAccountId: a, toAccountId: b, amountCents: 5_000 };

    const final = await transferAndWait('idem-2', body);
    expect(final.status).toBe('failed');

    const replay = await postTransfer('idem-2', body);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(final);

    const rows = await ctx.db
      .select()
      .from(transfers)
      .where(eq(transfers.idempotencyKey, 'idem-2'));
    expect(rows).toHaveLength(1);
  });

  it('409s when the same key is reused with a different payload', async () => {
    const { a, b } = await twoAccounts();
    await transferAndWait('idem-3', { fromAccountId: a, toAccountId: b, amountCents: 100 });
    const res = await postTransfer('idem-3', {
      fromAccountId: a,
      toAccountId: b,
      amountCents: 200,
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await balanceOf(a)).toBe(99_900);
  });

  it('executes exactly once when the same key arrives concurrently', async () => {
    const { a, b } = await twoAccounts();
    const body = { fromAccountId: a, toAccountId: b, amountCents: 1_000 };

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => postTransfer('idem-4', body)),
    );

    // Exactly one request created the transfer; the rest replayed it.
    const statuses = responses.map((res) => res.status);
    expect(statuses.filter((status) => status === 202)).toHaveLength(1);
    expect(statuses.filter((status) => status === 200)).toHaveLength(9);
    const ids = new Set(responses.map((res) => res.body.id));
    expect(ids.size).toBe(1);

    await waitForTransfer(ctx.api, [...ids][0] as string);
    expect(await balanceOf(a)).toBe(99_000);
    expect(await balanceOf(b)).toBe(1_000);

    const rows = await ctx.db
      .select()
      .from(transfers)
      .where(eq(transfers.idempotencyKey, 'idem-4'));
    expect(rows).toHaveLength(1);
  });
});

describe('GET /transfers/:id', () => {
  it('returns a stored transfer and 404s on unknown ids', async () => {
    const { a, b } = await twoAccounts();
    const final = await transferAndWait('t-7', {
      fromAccountId: a,
      toAccountId: b,
      amountCents: 42,
    });

    const found = await ctx.api.get(`/transfers/${final.id}`);
    expect(found.status).toBe(200);
    expect(found.body).toEqual(final);

    const missing = await ctx.api.get(`/transfers/${UNKNOWN_ID}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('TRANSFER_NOT_FOUND');
  });
});
