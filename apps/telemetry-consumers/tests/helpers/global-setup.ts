import { startPostgresForTests } from '@bank/db/testing';
import { startKafkaForTests } from '@bank/events/testing';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    kafkaBrokers: string[];
  }
}

/**
 * Starts one Postgres (migrated) and one Kafka for the whole integration run.
 * Set TEST_DATABASE_URL / TEST_KAFKA_BROKERS to reuse existing instances (the
 * docker-compose ones, say) instead.
 */
export default async function setup(project: TestProject) {
  const [postgres, kafka] = await Promise.all([startPostgresForTests(), startKafkaForTests()]);
  project.provide('databaseUrl', postgres.databaseUrl);
  project.provide('kafkaBrokers', kafka.brokers);

  return async () => {
    await Promise.all([postgres.stop(), kafka.stop()]);
  };
}
