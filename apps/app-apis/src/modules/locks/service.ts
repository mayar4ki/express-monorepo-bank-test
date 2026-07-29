import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';

import type { Db } from '@bank/db';
import { accountLocks, accounts } from '@bank/db';
import { ConflictError, NotFoundError } from '@bank/shared';

export class LockService {
  constructor(private readonly db: Db) {}

  /**
   * Locks an account. The account row is taken FOR UPDATE first, so lock
   * creation serializes against in-flight transfers: once this commits, any
   * transfer that has not yet passed its lock check will be rejected.
   */
  async create(accountId: string, reason: string) {
    return this.db.transaction(async (tx) => {
      const [account] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.id, accountId))
        .for('update');
      if (!account) {
        throw new NotFoundError('ACCOUNT_NOT_FOUND', `Account ${accountId} does not exist`);
      }
      const [lock] = await tx.insert(accountLocks).values({ accountId, reason }).returning();
      if (!lock) throw new Error('insert returned no row');
      return lock;
    });
  }

  async list(accountId: string, active?: boolean) {
    await this.assertAccountExists(accountId);
    const filters = [eq(accountLocks.accountId, accountId)];
    if (active === true) filters.push(isNull(accountLocks.releasedAt));
    if (active === false) filters.push(isNotNull(accountLocks.releasedAt));
    return this.db
      .select()
      .from(accountLocks)
      .where(and(...filters))
      .orderBy(desc(accountLocks.seq));
  }

  /** Releases a lock (soft delete: sets released_at, the row is kept for audit). */
  async release(accountId: string, lockId: string) {
    await this.assertAccountExists(accountId);

    const [released] = await this.db
      .update(accountLocks)
      .set({ releasedAt: new Date() })
      .where(
        and(
          eq(accountLocks.id, lockId),
          eq(accountLocks.accountId, accountId),
          isNull(accountLocks.releasedAt),
        ),
      )
      .returning();
    if (released) return released;

    const [lock] = await this.db
      .select()
      .from(accountLocks)
      .where(and(eq(accountLocks.id, lockId), eq(accountLocks.accountId, accountId)));
    if (!lock) {
      throw new NotFoundError('LOCK_NOT_FOUND', `Lock ${lockId} does not exist on this account`);
    }
    throw new ConflictError('LOCK_ALREADY_RELEASED', `Lock ${lockId} was already released`);
  }

  private async assertAccountExists(accountId: string): Promise<void> {
    const [account] = await this.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    if (!account) {
      throw new NotFoundError('ACCOUNT_NOT_FOUND', `Account ${accountId} does not exist`);
    }
  }
}
