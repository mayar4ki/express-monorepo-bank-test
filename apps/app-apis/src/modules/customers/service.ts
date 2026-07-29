import { asc, eq } from 'drizzle-orm';

import type { Db } from '@bank/db';
import { accounts, customers } from '@bank/db';
import { NotFoundError } from '@bank/shared';

export class CustomerService {
  constructor(private readonly db: Db) {}

  async list() {
    return this.db.select().from(customers).orderBy(asc(customers.seq));
  }

  async getById(customerId: string) {
    const [customer] = await this.db.select().from(customers).where(eq(customers.id, customerId));
    if (!customer) {
      throw new NotFoundError('CUSTOMER_NOT_FOUND', `Customer ${customerId} does not exist`);
    }
    return customer;
  }

  async create(name: string) {
    const [customer] = await this.db.insert(customers).values({ name }).returning();
    if (!customer) throw new Error('insert returned no row');
    return customer;
  }

  async listAccounts(customerId: string) {
    await this.getById(customerId);
    return this.db
      .select()
      .from(accounts)
      .where(eq(accounts.customerId, customerId))
      .orderBy(asc(accounts.seq));
  }
}
