import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createTestContext,
  mintToken,
  resetDb,
  seedCustomerIds,
  testUser,
} from '../helpers/test-app.js';

const ctx = createTestContext();

afterAll(() => ctx.close());
beforeEach(() => resetDb(ctx.db));

describe('JWT protection', () => {
  it('rejects requests without a token', async () => {
    const res = await request(ctx.app).get('/customers');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects garbage and expired tokens', async () => {
    const garbage = await request(ctx.app)
      .get('/customers')
      .set('Authorization', 'Bearer not-a-jwt');
    expect(garbage.status).toBe(401);

    const expired = await mintToken(testUser, { expiresIn: '-1h' });
    const res = await request(ctx.app).get('/customers').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it('accepts a valid token on every module', async () => {
    for (const path of ['/customers', `/customers/${seedCustomerIds.arishaBarron}/accounts`]) {
      const res = await ctx.api.get(path);
      expect(res.status).toBe(200);
    }
  });

  it('keeps /health and /docs public', async () => {
    const health = await request(ctx.app).get('/health');
    expect(health.status).toBe(200);

    const docs = await request(ctx.app).get('/docs/openapi.json');
    expect(docs.status).toBe(200);
    expect(docs.body.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });
});
