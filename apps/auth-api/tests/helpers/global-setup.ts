import { startPostgresForTests } from '@bank/db/testing';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

export default async function setup(project: TestProject) {
  const postgres = await startPostgresForTests();
  project.provide('databaseUrl', postgres.databaseUrl);

  return async () => {
    await postgres.stop();
  };
}
