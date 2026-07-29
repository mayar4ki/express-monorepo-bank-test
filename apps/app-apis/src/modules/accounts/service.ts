import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';

import type { Db } from '@bank/db';
import { accountLocks, accounts, customers, transfers } from '@bank/db';
import { NotFoundError } from '@bank/shared';
import { toTransferDto } from '@bank/shared';

export class AccountService {
  constructor(private readonly db: Db) {}

  /**
   * Creates an account and applies the initial deposit atomically. The
   * deposit is recorded as a completed transfer with no source account, so
   * it appears in the account's transfer history. A zero deposit opens an
   * empty account with no history entry.
   */
  async create(customerId: string, initialDepositCents: number) {
    return this.db.transaction(async (tx) => {
      const [customer] = await tx.select().from(customers).where(eq(customers.id, customerId));
      if (!customer) {
        throw new NotFoundError('CUSTOMER_NOT_FOUND', `Customer ${customerId} does not exist`);
      }

      const [account] = await tx
        .insert(accounts)
        .values({ customerId, balanceCents: initialDepositCents })
        .returning();
      if (!account) throw new Error('insert returned no row');

      if (initialDepositCents > 0) {
        await tx.insert(transfers).values({
          fromAccountId: null,
          toAccountId: account.id,
          amountCents: initialDepositCents,
          status: 'completed',
          completedAt: new Date(),
        });
      }
      return account;
    });
  }

  async getById(accountId: string) {
    const [account] = await this.db.select().from(accounts).where(eq(accounts.id, accountId));
    if (!account) {
      throw new NotFoundError('ACCOUNT_NOT_FOUND', `Account ${accountId} does not exist`);
    }
    return account;
  }

  async getDetail(accountId: string) {
    const account = await this.getById(accountId);
    const [activeLock] = await this.db
      .select({ id: accountLocks.id })
      .from(accountLocks)
      .where(and(eq(accountLocks.accountId, accountId), isNull(accountLocks.releasedAt)))
      .limit(1);
    return { ...account, locked: activeLock !== undefined };
  }

  async getBalance(accountId: string) {
    const account = await this.getById(accountId);
    return { accountId: account.id, balanceCents: account.balanceCents };
  }

  /** Transfer history (both directions, incl. the opening deposit), newest first. */
  async getHistory(accountId: string, limit: number, cursor?: number) {
    await this.getById(accountId);
    const direction = or(
      eq(transfers.fromAccountId, accountId),
      eq(transfers.toAccountId, accountId),
    );
    const rows = await this.db
      .select()
      .from(transfers)
      .where(cursor === undefined ? direction : and(direction, lt(transfers.seq, cursor)))
      .orderBy(desc(transfers.seq))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const nextCursor = rows.length > limit ? (page.at(-1)?.seq ?? null) : null;
    return { items: page.map(toTransferDto), nextCursor };
  }

  /** Total balance across all accounts — used by tests to assert conservation. */
  async totalBalanceCents(): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<string>`coalesce(sum(${accounts.balanceCents}), 0)` })
      .from(accounts);
    return Number(row?.total ?? 0);
  }
}
