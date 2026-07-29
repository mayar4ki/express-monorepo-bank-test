import { afterAll, beforeEach, describe, expect, it } from 'vitest';

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

async function lockAccount(accountId: string, reason = 'Suspected fraud'): Promise<string> {
  const res = await ctx.api.post(`/accounts/${accountId}/locks`).send({ reason });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

/** Submits a transfer (expects 202) and polls until it is terminal. */
async function transferAndWait(
  key: string,
  fromAccountId: string,
  toAccountId: string,
  amountCents = 100,
) {
  const accepted = await ctx.api
    .post('/transfers')
    .set('Idempotency-Key', key)
    .send({ fromAccountId, toAccountId, amountCents });
  expect(accepted.status).toBe(202);
  return waitForTransfer(ctx.api, accepted.body.id as string);
}

describe('POST /accounts/:id/locks', () => {
  it('creates an active lock with a freetext reason', async () => {
    const accountId = await createAccount(ctx.db, seedCustomerIds.arishaBarron, 1_000);
    const res = await ctx.api
      .post(`/accounts/${accountId}/locks`)
      .send({ reason: 'Court order #123' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ accountId, reason: 'Court order #123', releasedAt: null });

    const detail = await ctx.api.get(`/accounts/${accountId}`);
    expect(detail.body.locked).toBe(true);
  });

  it('404s on unknown accounts and 400s without a reason', async () => {
    const missing = await ctx.api.post(`/accounts/${UNKNOWN_ID}/locks`).send({ reason: 'x' });
    expect(missing.status).toBe(404);

    const accountId = await createAccount(ctx.db, seedCustomerIds.arishaBarron, 0);
    const noReason = await ctx.api.post(`/accounts/${accountId}/locks`).send({});
    expect(noReason.status).toBe(400);
  });
});

describe('locks block transfers', () => {
  it('blocks outgoing transfers from a locked account', async () => {
    const a = await createAccount(ctx.db, seedCustomerIds.arishaBarron, 10_000);
    const b = await createAccount(ctx.db, seedCustomerIds.brandenGibson, 0);
    await lockAccount(a);

    const final = await transferAndWait('lock-out', a, b);
    expect(final).toMatchObject({ status: 'failed', failureReason: 'ACCOUNT_LOCKED' });

    const balance = await ctx.api.get(`/accounts/${a}/balance`);
    expect(balance.body.balanceCents).toBe(10_000);
  });

  it('blocks incoming transfers to a locked account', async () => {
    const a = await createAccount(ctx.db, seedCustomerIds.arishaBarron, 10_000);
    const b = await createAccount(ctx.db, seedCustomerIds.brandenGibson, 0);
    await lockAccount(b);

    const final = await transferAndWait('lock-in', a, b);
    expect(final).toMatchObject({ status: 'failed', failureReason: 'ACCOUNT_LOCKED' });
  });

  it('allows the transfer again after the lock is released', async () => {
    const a = await createAccount(ctx.db, seedCustomerIds.arishaBarron, 10_000);
    const b = await createAccount(ctx.db, seedCustomerIds.brandenGibson, 0);
    const lockId = await lockAccount(a);

    const blocked = await transferAndWait('lock-retry-1', a, b);
    expect(blocked.status).toBe('failed');

    const release = await ctx.api.delete(`/accounts/${a}/locks/${lockId}`);
    expect(release.status).toBe(200);
    expect(release.body.releasedAt).not.toBeNull();

    // New key: the failed transfer is a durable, replayable outcome by design.
    const retried = await transferAndWait('lock-retry-2', a, b);
    expect(retried.status).toBe('completed');
  });

  it('stays locked while any of several locks is active', async () => {
    const a = await createAccount(ctx.db, seedCustomerIds.arishaBarron, 10_000);
    const b = await createAccount(ctx.db, seedCustomerIds.brandenGibson, 0);
    const first = await lockAccount(a, 'reason one');
    await lockAccount(a, 'reason two');

    await ctx.api.delete(`/accounts/${a}/locks/${first}`);
    const final = await transferAndWait('multi-lock', a, b);
    expect(final).toMatchObject({ status: 'failed', failureReason: 'ACCOUNT_LOCKED' });
  });
});

describe('DELETE /accounts/:id/locks/:lockId', () => {
  it('409s when releasing an already-released lock', async () => {
    const accountId = await createAccount(ctx.db, seedCustomerIds.arishaBarron, 0);
    const lockId = await lockAccount(accountId);

    await ctx.api.delete(`/accounts/${accountId}/locks/${lockId}`);
    const again = await ctx.api.delete(`/accounts/${accountId}/locks/${lockId}`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('LOCK_ALREADY_RELEASED');
  });

  it('404s for a lock that does not belong to the account', async () => {
    const a = await createAccount(ctx.db, seedCustomerIds.arishaBarron, 0);
    const b = await createAccount(ctx.db, seedCustomerIds.brandenGibson, 0);
    const lockId = await lockAccount(a);

    const res = await ctx.api.delete(`/accounts/${b}/locks/${lockId}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('LOCK_NOT_FOUND');
  });
});

describe('GET /accounts/:id/locks', () => {
  it('filters by active state', async () => {
    const accountId = await createAccount(ctx.db, seedCustomerIds.arishaBarron, 0);
    const first = await lockAccount(accountId, 'first');
    await lockAccount(accountId, 'second');
    await ctx.api.delete(`/accounts/${accountId}/locks/${first}`);

    const all = await ctx.api.get(`/accounts/${accountId}/locks`);
    expect(all.body).toHaveLength(2);

    const active = await ctx.api.get(`/accounts/${accountId}/locks?active=true`);
    expect(active.body).toHaveLength(1);
    expect(active.body[0].reason).toBe('second');

    const released = await ctx.api.get(`/accounts/${accountId}/locks?active=false`);
    expect(released.body).toHaveLength(1);
    expect(released.body[0].reason).toBe('first');
  });
});
