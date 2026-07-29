import request from 'supertest';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { transfers } from '@bank/db';
import { TransferExecutor, UnprocessableError } from '@bank/shared';
import {
  createAccount,
  defaultAuthHeader,
  createTestContext,
  resetDb,
  seedCustomerIds,
  waitForNoPending,
} from '../helpers/test-app.js';

const ctx = createTestContext();

afterAll(() => ctx.close());
beforeEach(() => resetDb(ctx.db));

async function balanceOf(accountId: string): Promise<number> {
  const res = await ctx.api.get(`/accounts/${accountId}/balance`);
  return res.body.balanceCents as number;
}

describe('concurrency safety', () => {
  it('conserves the total balance under a storm of 100 concurrent API transfers', async () => {
    const a = await createAccount(ctx.db, seedCustomerIds.arishaBarron, 100_000);
    const b = await createAccount(ctx.db, seedCustomerIds.brandenGibson, 100_000);

    const responses = await Promise.all(
      Array.from({ length: 100 }, (_, i) => {
        const forward = i % 2 === 0;
        return request(ctx.app)
          .post('/transfers')
          .set('Authorization', defaultAuthHeader)
          .set('Idempotency-Key', `storm-${i}`)
          .send({
            fromAccountId: forward ? a : b,
            toAccountId: forward ? b : a,
            // Deliberately large relative to the balances so that some
            // transfers fail with INSUFFICIENT_FUNDS under contention.
            amountCents: 1 + ((i * 7919) % 20_000),
          });
      }),
    );

    for (const res of responses) {
      expect(res.status).toBe(202);
    }

    await waitForNoPending(ctx.db);

    const balanceA = await balanceOf(a);
    const balanceB = await balanceOf(b);
    expect(balanceA).toBeGreaterThanOrEqual(0);
    expect(balanceB).toBeGreaterThanOrEqual(0);
    expect(balanceA + balanceB).toBe(200_000);

    // Every transfer reached a terminal state.
    const rows = await ctx.db
      .select()
      .from(transfers)
      .where(inArray(transfers.status, ['pending']));
    expect(rows).toHaveLength(0);
  });

  it('conserves the total balance even when the queue is bypassed (FOR UPDATE alone)', async () => {
    const a = await createAccount(ctx.db, seedCustomerIds.arishaBarron, 50_000);
    const b = await createAccount(ctx.db, seedCustomerIds.brandenGibson, 50_000);

    // Insert pending rows directly and execute them all in parallel against
    // the pool — no queue involved. This proves the row-locking transaction
    // alone prevents double-spending (defence in depth).
    const executor = new TransferExecutor(ctx.db);
    const pendingRows = await ctx.db
      .insert(transfers)
      .values(
        Array.from({ length: 40 }, (_, i) => ({
          fromAccountId: i % 2 === 0 ? a : b,
          toAccountId: i % 2 === 0 ? b : a,
          amountCents: 1 + ((i * 104_729) % 5_000),
          status: 'pending' as const,
        })),
      )
      .returning();

    const outcomes = await Promise.allSettled(pendingRows.map((row) => executor.execute(row)));
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        expect(outcome.reason).toBeInstanceOf(UnprocessableError);
      }
    }

    expect((await balanceOf(a)) + (await balanceOf(b))).toBe(100_000);
    expect(await balanceOf(a)).toBeGreaterThanOrEqual(0);
    expect(await balanceOf(b)).toBeGreaterThanOrEqual(0);
  });

  it('never lets a transfer slip past a concurrently created lock inconsistently', async () => {
    const a = await createAccount(ctx.db, seedCustomerIds.arishaBarron, 100_000);
    const b = await createAccount(ctx.db, seedCustomerIds.brandenGibson, 0);

    const [lockRes, ...transferResults] = await Promise.all([
      ctx.api.post(`/accounts/${a}/locks`).send({ reason: 'race check' }),
      ...Array.from({ length: 20 }, (_, i) =>
        request(ctx.app)
          .post('/transfers')
          .set('Authorization', defaultAuthHeader)
          .set('Idempotency-Key', `lock-race-${i}`)
          .send({ fromAccountId: a, toAccountId: b, amountCents: 1_000 }),
      ),
    ]);
    expect(lockRes.status).toBe(201);
    for (const res of transferResults) {
      expect(res.status).toBe(202);
    }

    await waitForNoPending(ctx.db);

    // Transfers either completed before the lock landed or failed with
    // ACCOUNT_LOCKED — in every case the books must balance exactly.
    // (Filter on the source account: the opening deposit is also a
    // completed transfer row.)
    const completed = await ctx.db
      .select({ id: transfers.id })
      .from(transfers)
      .where(and(eq(transfers.status, 'completed'), eq(transfers.fromAccountId, a)));
    expect(await balanceOf(a)).toBe(100_000 - completed.length * 1_000);
    expect(await balanceOf(b)).toBe(completed.length * 1_000);
  });
});
