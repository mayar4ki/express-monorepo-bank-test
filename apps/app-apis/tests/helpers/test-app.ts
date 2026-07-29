import { randomUUID } from 'node:crypto';

import { count, eq, sql } from 'drizzle-orm';
import { SignJWT, generateKeyPair, jwtVerify } from 'jose';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { inject } from 'vitest';

import { createDb, seed, transfers } from '@bank/db';
import type { Db } from '@bank/db';
import { createRedisConnection, createTransfersQueue, createTransfersWorker } from '@bank/queue';
import { UnauthorizedError, createTransferProcessor } from '@bank/shared';

import { createApp } from '../../src/app.js';
import type { AuthUser, TokenVerifier } from '../../src/middleware/auth.js';
import { AccountService } from '../../src/modules/accounts/service.js';
import type { TransferDto } from '../../src/modules/transfers/schemas.js';

const ISSUER = 'bank-auth-test';
const AUDIENCE = 'bank-internal-api-test';

// One keypair for the whole test module graph: tokens are minted with the
// private key, the injected verifier checks them with the public key —
// the same shape as production (auth-api signs, app-apis verifies via JWKS).
const { publicKey, privateKey } = await generateKeyPair('ES256');

export const testUser: AuthUser = {
  id: '00000000-0000-4000-8000-0000000000aa',
  email: 'teller@bank.local',
  name: 'Test Teller',
};

export async function mintToken(
  user: AuthUser = testUser,
  opts?: { expiresIn?: string },
): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name })
    .setProtectedHeader({ alg: 'ES256' })
    .setSubject(String(user.id))
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(opts?.expiresIn ?? '1h')
    .sign(privateKey);
}

export const localVerifier: TokenVerifier = {
  async verify(token) {
    try {
      const { payload } = await jwtVerify(token, publicKey, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['ES256'],
      });
      return {
        id: String(payload.sub),
        email: String(payload.email),
        name: String(payload.name),
      };
    } catch {
      throw new UnauthorizedError('UNAUTHORIZED', 'Invalid or expired token');
    }
  },
};

const defaultToken = await mintToken();
/** For tests that need bare `request(app)` calls (e.g. high-concurrency storms). */
export const defaultAuthHeader = `Bearer ${defaultToken}`;

/**
 * One app + db + queue + in-process worker per test file. The worker runs
 * the exact processor the executor app runs in production; a unique queue
 * name per context keeps test files isolated on the shared Redis.
 *
 * `api` is a supertest agent that sends the Authorization header on every
 * request; use bare `request(ctx.app)` to make unauthenticated calls.
 */
export function createTestContext() {
  const { db, pool } = createDb(inject('databaseUrl'));
  // Queue and worker get their own connections (BullMQ recommendation) so
  // teardown can't strand one entity on a connection another already quit.
  const queueRedis = createRedisConnection(inject('redisUrl'));
  const workerRedis = createRedisConnection(inject('redisUrl'));
  const queueName = `transfers-test-${randomUUID()}`;
  const transfersQueue = createTransfersQueue(queueRedis, queueName);
  const worker = createTransfersWorker(workerRedis, createTransferProcessor({ db }), {
    queueName,
  });
  const { app } = createApp({ db, transfersQueue, verifier: localVerifier });

  const api = request.agent(app).set('Authorization', `Bearer ${defaultToken}`);

  return {
    db,
    pool,
    app,
    api,
    transfersQueue,
    close: async () => {
      // Closing a worker that is still connecting races its blocking
      // command; wait for readiness first.
      await worker.waitUntilReady().catch(() => undefined);
      await worker.close();
      await transfersQueue.close();
      await Promise.allSettled([queueRedis.quit(), workerRedis.quit()]);
      await pool.end();
    },
  };
}

export type Api = TestAgent;

/** Syntactically valid UUID that never exists — for 404 assertions. */
export const missingId = '00000000-0000-4000-8000-00000000dead';

/** Wipes all data and re-seeds the four assignment customers. */
export async function resetDb(db: Db): Promise<void> {
  await db.execute(
    sql`TRUNCATE account_comments, account_locks, transfers, accounts, customers RESTART IDENTITY CASCADE`,
  );
  await seed(db);
}

/** Shortcut used by most integration tests to set up funded accounts. */
export async function createAccount(
  db: Db,
  customerId: string,
  balanceCents: number,
): Promise<string> {
  const account = await new AccountService(db).create(customerId, balanceCents);
  return account.id;
}

const POLL_INTERVAL_MS = 20;
const POLL_TIMEOUT_MS = 10_000;

/** Polls GET /transfers/:id until the transfer reaches a terminal state. */
export async function waitForTransfer(api: Api, transferId: string): Promise<TransferDto> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const res = await api.get(`/transfers/${transferId}`);
    if (res.status === 200 && res.body.status !== 'pending') {
      return res.body as TransferDto;
    }
    if (Date.now() > deadline) {
      throw new Error(`transfer ${transferId} still pending after ${POLL_TIMEOUT_MS}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/** Resolves once no transfer row is left in 'pending' (storm tests). */
export async function waitForNoPending(db: Db): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const [row] = await db
      .select({ pending: count() })
      .from(transfers)
      .where(eq(transfers.status, 'pending'));
    if ((row?.pending ?? 0) === 0) return;
    if (Date.now() > deadline) {
      throw new Error(`transfers still pending after ${POLL_TIMEOUT_MS}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

export { seedCustomerIds } from '@bank/db';

/** Syntactically valid UUID that never exists in the database. */
export const UNKNOWN_ID = '00000000-0000-4000-8000-00000000dead';
