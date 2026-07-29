import { desc, eq } from 'drizzle-orm';

import type { Db } from '@bank/db';
import { accountComments, accounts } from '@bank/db';
import { NotFoundError } from '@bank/shared';

export class CommentService {
  constructor(private readonly db: Db) {}

  async create(accountId: string, body: string) {
    await this.assertAccountExists(accountId);
    const [comment] = await this.db.insert(accountComments).values({ accountId, body }).returning();
    if (!comment) throw new Error('insert returned no row');
    return comment;
  }

  async list(accountId: string) {
    await this.assertAccountExists(accountId);
    return this.db
      .select()
      .from(accountComments)
      .where(eq(accountComments.accountId, accountId))
      .orderBy(desc(accountComments.seq));
  }

  private async assertAccountExists(accountId: string): Promise<void> {
    const [account] = await this.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    if (!account) {
      throw new NotFoundError('ACCOUNT_NOT_FOUND', `Account ${accountId} does not exist`);
    }
  }
}
