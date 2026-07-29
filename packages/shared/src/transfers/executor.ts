import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { Db } from '@bank/db';
import { accountLocks, accounts, transfers } from '@bank/db';
import type { AppError } from '../errors.js';
import { NotFoundError, UnprocessableError } from '../errors.js';
import type { TransferRow } from './dto.js';

export function transferFailureError(reason: string, transferId: string): AppError {
  const details = { transferId };
  switch (reason) {
    case 'INSUFFICIENT_FUNDS':
      return new UnprocessableError(
        'INSUFFICIENT_FUNDS',
        'The source account balance is lower than the transfer amount',
        details,
      );
    case 'ACCOUNT_LOCKED':
      return new UnprocessableError(
        'ACCOUNT_LOCKED',
        'One of the accounts is locked; the transfer was rejected',
        details,
      );
    default:
      return new UnprocessableError('INSUFFICIENT_FUNDS', `Transfer failed: ${reason}`, details);
  }
}

/**
 * Executes a single pending transfer inside a database transaction.
 *
 * Both account rows are locked with SELECT ... FOR UPDATE in ascending id
 * order (deterministic ordering prevents deadlocks), so the executor is safe
 * even if multiple processes run concurrently — the SerialQueue in front of
 * it is the first line of defence, this transaction is the second.
 *
 * Business rejections are persisted on the transfer row (status='failed')
 * and re-thrown as 422 errors, which makes failed transfers replayable
 * through their idempotency key.
 */
export class TransferExecutor {
  constructor(private readonly db: Db) {}

  async execute(transfer: TransferRow): Promise<TransferRow> {
    const { id, fromAccountId, toAccountId, amountCents } = transfer;
    if (fromAccountId === null) {
      throw new Error(`Transfer ${id} has no source account; deposits are not queued`);
    }

    try {
      return await this.db.transaction(async (tx) => {
        const rowById = new Map<string, { id: string; balanceCents: number }>();
        // Deterministic lock order: lexicographic UUID sort prevents deadlocks.
        for (const accountId of [fromAccountId, toAccountId].sort()) {
          const [row] = await tx
            .select({ id: accounts.id, balanceCents: accounts.balanceCents })
            .from(accounts)
            .where(eq(accounts.id, accountId))
            .for('update');
          if (!row) {
            throw new NotFoundError('ACCOUNT_NOT_FOUND', `Account ${accountId} does not exist`);
          }
          rowById.set(row.id, row);
        }

        const lockedRows = await tx
          .select({ accountId: accountLocks.accountId })
          .from(accountLocks)
          .where(
            and(
              inArray(accountLocks.accountId, [fromAccountId, toAccountId]),
              isNull(accountLocks.releasedAt),
            ),
          );
        if (lockedRows.length > 0) {
          throw transferFailureError('ACCOUNT_LOCKED', id);
        }

        const source = rowById.get(fromAccountId);
        if (!source || source.balanceCents < amountCents) {
          throw transferFailureError('INSUFFICIENT_FUNDS', id);
        }

        await tx
          .update(accounts)
          .set({ balanceCents: sql`${accounts.balanceCents} - ${amountCents}` })
          .where(eq(accounts.id, fromAccountId));
        await tx
          .update(accounts)
          .set({ balanceCents: sql`${accounts.balanceCents} + ${amountCents}` })
          .where(eq(accounts.id, toAccountId));

        const [completed] = await tx
          .update(transfers)
          .set({ status: 'completed', completedAt: new Date() })
          .where(eq(transfers.id, id))
          .returning();
        if (!completed) throw new Error(`Transfer row ${id} disappeared mid-transaction`);
        return completed;
      });
    } catch (err) {
      if (err instanceof UnprocessableError) {
        await this.db
          .update(transfers)
          .set({ status: 'failed', failureReason: err.code, completedAt: new Date() })
          .where(eq(transfers.id, id));
      }
      throw err;
    }
  }
}
