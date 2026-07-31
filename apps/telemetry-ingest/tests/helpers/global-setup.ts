import { startKafkaForTests } from '@bank/events/testing';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    kafkaBrokers: string[];
  }
}

/**
 * One Kafka container for the whole integration run. Set TEST_KAFKA_BROKERS to
 * reuse an existing broker (e.g. the docker-compose one) instead.
 */
export default async function setup(project: TestProject) {
  const kafka = await startKafkaForTests();
  project.provide('kafkaBrokers', kafka.brokers);

  return async () => {
    await kafka.stop();
  };
}
