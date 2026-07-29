import { Redis } from 'ioredis';

/**
 * Redis connection factory for queues and workers.
 * `maxRetriesPerRequest: null` is required by BullMQ.
 */
export function createRedisConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}

export type { Redis };
