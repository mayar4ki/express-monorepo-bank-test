import { decodeJwt, decodeProtectedHeader } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { seedAdminUser } from '@bank/db';
import { createTestContext, resetUsers, testTokenConfig } from '../helpers/test-app.js';

let ctx: Awaited<ReturnType<typeof createTestContext>>;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());
beforeEach(() => resetUsers(ctx.db));

const jane = { email: 'jane.doe@bank.local', password: 'super-secret-1', name: 'Jane Doe' };

async function registerJane() {
  const res = await request(ctx.app).post('/auth/register').send(jane);
  expect(res.status).toBe(201);
  return res.body;
}

async function loginJane(): Promise<string> {
  const res = await request(ctx.app)
    .post('/auth/login')
    .send({ email: jane.email, password: jane.password });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

describe('POST /auth/register', () => {
  it('creates a user without leaking the password hash', async () => {
    const user = await registerJane();
    expect(user).toMatchObject({ email: jane.email, name: jane.name });
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user.passwordHash).toBeUndefined();
  });

  it('rejects a duplicate email (case-insensitive) with 409', async () => {
    await registerJane();
    const res = await request(ctx.app)
      .post('/auth/register')
      .send({ ...jane, email: 'Jane.Doe@Bank.Local' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('rejects invalid emails and short passwords', async () => {
    for (const body of [
      { ...jane, email: 'not-an-email' },
      { ...jane, password: 'short' },
      { email: jane.email, password: jane.password },
    ]) {
      const res = await request(ctx.app).post('/auth/register').send(body);
      expect(res.status).toBe(400);
    }
  });
});

describe('POST /auth/login', () => {
  it('returns a valid ES256 JWT with the expected claims', async () => {
    await registerJane();
    const token = await loginJane();

    const header = decodeProtectedHeader(token);
    expect(header.alg).toBe('ES256');
    expect(header.kid).toBe(ctx.keys.kid);

    const claims = decodeJwt(token);
    expect(String(claims.sub)).toMatch(/^[0-9a-f-]{36}$/);
    expect(claims.email).toBe(jane.email);
    expect(claims.name).toBe(jane.name);
    expect(claims.iss).toBe(testTokenConfig.issuer);
    expect(claims.aud).toBe(testTokenConfig.audience);
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(testTokenConfig.ttlSeconds);
  });

  it('401s on wrong password and unknown email with the same error', async () => {
    await registerJane();
    const wrongPassword = await request(ctx.app)
      .post('/auth/login')
      .send({ email: jane.email, password: 'wrong-password-1' });
    const unknownEmail = await request(ctx.app)
      .post('/auth/login')
      .send({ email: 'ghost@bank.local', password: 'whatever-123' });

    for (const res of [wrongPassword, unknownEmail]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    }
  });

  it('lets the seeded admin log in', async () => {
    const bcrypt = (await import('bcryptjs')).default;
    await seedAdminUser(ctx.db, {
      email: 'admin@bank.local',
      passwordHash: await bcrypt.hash('admin12345', 11),
      name: 'Admin',
    });

    const res = await request(ctx.app)
      .post('/auth/login')
      .send({ email: 'admin@bank.local', password: 'admin12345' });
    expect(res.status).toBe(200);
    expect(res.body.tokenType).toBe('Bearer');
  });
});

describe('GET /auth/me', () => {
  it('returns the user behind a valid token', async () => {
    await registerJane();
    const token = await loginJane();

    const res = await request(ctx.app).get('/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: jane.email, name: jane.name });
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects a missing or invalid token', async () => {
    const missing = await request(ctx.app).get('/auth/me');
    expect(missing.status).toBe(400);

    const invalid = await request(ctx.app)
      .get('/auth/me')
      .set('Authorization', 'Bearer not-a-token');
    expect(invalid.status).toBe(401);
    expect(invalid.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('GET /.well-known/jwks.json', () => {
  it('serves the public key with kid/alg/use and no private material', async () => {
    const res = await request(ctx.app).get('/.well-known/jwks.json');
    expect(res.status).toBe(200);
    expect(res.body.keys).toHaveLength(1);
    expect(res.body.keys[0]).toMatchObject({
      kid: ctx.keys.kid,
      alg: 'ES256',
      use: 'sig',
      kty: 'EC',
      crv: 'P-256',
    });
    expect(res.body.keys[0].d).toBeUndefined();
  });
});

describe('docs', () => {
  it('serves its own OpenAPI document', async () => {
    const res = await request(ctx.app).get('/docs/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.info.title).toBe('Bank Auth API');
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining([
        '/auth/register',
        '/auth/login',
        '/auth/me',
        '/.well-known/jwks.json',
      ]),
    );
  });
});
