import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';

import type { Db } from '@bank/db';
import { users } from '@bank/db';
import { ConflictError, UnauthorizedError } from '@bank/shared';

const BCRYPT_ROUNDS = 11;
// Compared against when the email is unknown, so login timing does not
// reveal whether an account exists.
const DUMMY_HASH = bcrypt.hashSync('definitely-not-a-real-password', BCRYPT_ROUNDS);

const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  for (let current = err; typeof current === 'object' && current !== null;) {
    if ((current as { code?: string }).code === PG_UNIQUE_VIOLATION) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export class AuthService {
  constructor(private readonly db: Db) {}

  async register(input: { email: string; password: string; name: string }) {
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    try {
      const [user] = await this.db
        .insert(users)
        .values({ email: input.email.toLowerCase(), passwordHash, name: input.name })
        .returning();
      if (!user) throw new Error('insert returned no row');
      return user;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError('EMAIL_TAKEN', 'A user with this email already exists');
      }
      throw err;
    }
  }

  async verifyCredentials(email: string, password: string) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(sql`lower(${users.email})`, email.toLowerCase()));

    const matches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !matches) {
      throw new UnauthorizedError('INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    return user;
  }

  async getById(userId: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user) {
      throw new UnauthorizedError('UNAUTHORIZED', 'User no longer exists');
    }
    return user;
  }
}
