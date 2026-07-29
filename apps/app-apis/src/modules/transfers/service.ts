import { createHash } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';

import type { Db } from '@bank/db';
import { accounts, transfers } from '@bank/db';
import { enqueueTransfer } from '@bank/queue';
import type { TransfersQueue } from '@bank/queue';
import { ConflictError, NotFoundError, UnprocessableError } from '@bank/shared';
import type { TransferRow } from '@bank/shared';

export interface CreateTransferInput {
  idempotencyKey: string;
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
}

export interface CreateTransferResult {
  transfer: TransferRow;
  /** true = a new transfer was accepted; false = idempotent replay. */
  created: boolean;
}

const PG_UNIQUE_VIOLATION = '23505';

/** Drizzle wraps pg errors (DrizzleQueryError), so walk the cause chain. */
function isUniqueViolation(err: unknown): boolean {
  for (let current = err; typeof current === 'object' && current !== null;) {
    if ((current as { code?: string }).code === PG_UNIQUE_VIOLATION) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function hashRequest(input: CreateTransferInput): string {
  return createHash('sha256')
    .update(JSON.stringify([input.fromAccountId, input.toAccountId, input.amountCents]))
    .digest('hex');
}

/**
 * Accepts transfers asynchronously: the request creates a pending transfer
 * row and enqueues it; the executor service performs the actual money
 * movement one job at a time. Clients poll GET /transfers/:id for the
 * outcome.
 *
 * Idempotency: the transfer row is the idempotency record (unique key
 * index) and the idempotency key doubles as the BullMQ job id, so neither
 * a duplicate request nor a duplicate job can execute a transfer twice.
 */
export class TransferService {
  constructor(
    private readonly db: Db,
    private readonly queue: TransfersQueue,
  ) {}

  async create(input: CreateTransferInput): Promise<CreateTransferResult> {
    if (input.fromAccountId === input.toAccountId) {
      throw new UnprocessableError('SAME_ACCOUNT', 'Cannot transfer an amount to the same account');
    }

    const requestHash = hashRequest(input);
    await this.assertAccountsExist(input);

    let pending: TransferRow;
    try {
      const [inserted] = await this.db
        .insert(transfers)
        .values({
          idempotencyKey: input.idempotencyKey,
          requestHash,
          fromAccountId: input.fromAccountId,
          toAccountId: input.toAccountId,
          amountCents: input.amountCents,
          status: 'pending',
        })
        .returning();
      if (!inserted) throw new Error('insert returned no row');
      pending = inserted;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      return this.replay(input.idempotencyKey, requestHash);
    }

    await enqueueTransfer(this.queue, pending.id, input.idempotencyKey);
    return { transfer: pending, created: true };
  }

  async getById(transferId: string): Promise<TransferRow> {
    const [row] = await this.db.select().from(transfers).where(eq(transfers.id, transferId));
    if (!row) {
      throw new NotFoundError('TRANSFER_NOT_FOUND', `Transfer ${transferId} does not exist`);
    }
    return row;
  }

  /** The key already exists: return the stored state instead of re-executing. */
  private async replay(idempotencyKey: string, requestHash: string): Promise<CreateTransferResult> {
    const [row] = await this.db
      .select()
      .from(transfers)
      .where(eq(transfers.idempotencyKey, idempotencyKey));
    if (!row) throw new Error(`Transfer with idempotency key ${idempotencyKey} not found`);

    if (row.requestHash !== requestHash) {
      throw new ConflictError(
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was already used with a different payload',
      );
    }

    if (row.status === 'pending') {
      // Covers a crash between insert and enqueue: jobId = key makes this a
      // no-op when the job already exists.
      await enqueueTransfer(this.queue, row.id, idempotencyKey);
    }
    return { transfer: row, created: false };
  }

  private async assertAccountsExist(input: CreateTransferInput): Promise<void> {
    const rows = await this.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(inArray(accounts.id, [input.fromAccountId, input.toAccountId]));
    const found = new Set(rows.map((row) => row.id));
    for (const [label, accountId] of [
      ['Source', input.fromAccountId],
      ['Destination', input.toAccountId],
    ] as const) {
      if (!found.has(accountId)) {
        throw new NotFoundError(
          'ACCOUNT_NOT_FOUND',
          `${label} account ${accountId} does not exist`,
          { accountId },
        );
      }
    }
  }
}
