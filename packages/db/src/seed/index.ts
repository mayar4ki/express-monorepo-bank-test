import type { Db } from '../client.js';
import { seedCustomers } from './customers.js';

/** Runs every seed module. Safe to run on each application start. */
export async function seed(db: Db): Promise<void> {
  await seedCustomers(db);
}
