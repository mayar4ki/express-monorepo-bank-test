import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Db } from '@bank/db';
import { transfers } from '@bank/db';
import type { TransferJob } from '@bank/queue';

import { UnprocessableError } from '../errors.js';
import { TransferExecutor } from './executor.js';

/**
 * Job processor shared by the executor app and the in-process test worker.
 *
 * Business rejections (insufficient funds, locked account) are already
 * persisted on the transfer row by the executor, so the job completes
 * normally — only infrastructure errors are rethrown for BullMQ to retry.
 */
export function createTransferProcessor({ db, logger }: { db: Db; logger?: Logger }) {
  const executor = new TransferExecutor(db);

  return async (job: TransferJob): Promise<void> => {
    const { transferId } = job.data;
    const [row] = await db.select().from(transfers).where(eq(transfers.id, transferId));

    if (!row) {
      // Nothing to execute and nothing a retry could fix.
      logger?.error({ transferId }, 'transfer job references a missing row');
      return;
    }
    if (row.status !== 'pending') {
      // Idempotent re-delivery of an already-executed transfer.
      return;
    }

    try {
      await executor.execute(row);
      logger?.info({ transferId }, 'transfer completed');
    } catch (err) {
      if (err instanceof UnprocessableError) {
        logger?.info({ transferId, reason: err.code }, 'transfer rejected');
        return;
      }
      throw err;
    }
  };
}
