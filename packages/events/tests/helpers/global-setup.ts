import { startKafkaForTests } from '../../src/testing.js';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    kafkaBrokers: string[];
  }
}

/** One broker for the whole integration run; topics are isolated per test. */
export default async function setup(project: TestProject) {
  const kafka = await startKafkaForTests();
  project.provide('kafkaBrokers', kafka.brokers);

  return async () => {
    await kafka.stop();
  };
}
