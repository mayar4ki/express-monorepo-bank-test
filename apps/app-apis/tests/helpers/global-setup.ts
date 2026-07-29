import { startPostgresForTests } from '@bank/db/testing';
import { startRedisForTests } from '@bank/queue/testing';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
  }
}

/**
 * Starts one Postgres and one Redis container for the whole integration run
 * and applies migrations once. Set TEST_DATABASE_URL / TEST_REDIS_URL to
 * reuse existing instances (e.g. the docker-compose ones) instead.
 */
export default async function setup(project: TestProject) {
  const [postgres, redis] = await Promise.all([startPostgresForTests(), startRedisForTests()]);
  project.provide('databaseUrl', postgres.databaseUrl);
  project.provide('redisUrl', redis.redisUrl);

  return async () => {
    await Promise.all([postgres.stop(), redis.stop()]);
  };
}
