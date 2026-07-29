import { Queue, Worker } from 'bullmq';
import type { Job, Processor, WorkerOptions } from 'bullmq';
import type { Redis } from 'ioredis';

/**
 * Everything about the transfers queue lives here — name, payload shape,
 * job options, enqueue helper and worker factory — so producers (app-apis)
 * and consumers (executor, tests) can never drift apart.
 */

export const transfersQueueName = 'transfers';

export interface TransferJobData {
  transferId: string;
}

export type TransferJob = Job<TransferJobData>;
export type TransfersQueue = Queue<TransferJobData>;

export function createTransfersQueue(
  connection: Redis,
  queueName: string = transfersQueueName,
): TransfersQueue {
  return new Queue<TransferJobData>(queueName, {
    connection,
    defaultJobOptions: {
      // Retries cover infrastructure errors only; business rejections are
      // persisted on the transfer row and complete the job normally.
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  });
}

/**
 * Enqueues a transfer for execution. The idempotency key doubles as the
 * BullMQ job id, so re-adding the same transfer is a queue-level no-op.
 */
export async function enqueueTransfer(
  queue: TransfersQueue,
  transferId: string,
  idempotencyKey: string,
): Promise<void> {
  await queue.add('execute', { transferId }, { jobId: idempotencyKey });
}

/**
 * Worker factory pinning the queue name and single-job concurrency
 * (the assignment requires transfers to execute one by one).
 */
export function createTransfersWorker(
  connection: Redis,
  processor: Processor<TransferJobData>,
  options?: { queueName?: string } & Pick<WorkerOptions, 'autorun'>,
): Worker<TransferJobData> {
  return new Worker<TransferJobData>(options?.queueName ?? transfersQueueName, processor, {
    connection,
    concurrency: 1,
    autorun: options?.autorun ?? true,
  });
}
