import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';

export interface TestRedis {
  redisUrl: string;
  stop: () => Promise<void>;
}

/**
 * Starts a disposable Redis for tests (or reuses TEST_REDIS_URL if set).
 */
export async function startRedisForTests(): Promise<TestRedis> {
  let container: StartedRedisContainer | undefined;
  let redisUrl = process.env.TEST_REDIS_URL;

  if (!redisUrl) {
    container = await new RedisContainer('redis:7-alpine').start();
    redisUrl = container.getConnectionUrl();
  }

  return {
    redisUrl,
    stop: async () => {
      await container?.stop();
    },
  };
}
