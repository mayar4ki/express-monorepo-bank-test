import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  UNKNOWN_ID,
  createAccount,
  createTestContext,
  resetDb,
  seedCustomerIds,
} from '../helpers/test-app.js';

const ctx = createTestContext();

afterAll(() => ctx.close());
beforeEach(() => resetDb(ctx.db));

describe('GET /health', () => {
  it('reports ok with queue counts', async () => {
    const res = await ctx.api.get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.queue).toBeTypeOf('object');
  });
});

describe('customers', () => {
  it('lists the four pre-seeded customers in seed order', async () => {
    const res = await ctx.api.get('/customers');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(4);
    expect(res.body.map((c: { id: string; name: string }) => [c.id, c.name])).toEqual([
      [seedCustomerIds.arishaBarron, 'Arisha Barron'],
      [seedCustomerIds.brandenGibson, 'Branden Gibson'],
      [seedCustomerIds.rhondaChurch, 'Rhonda Church'],
      [seedCustomerIds.georginaHazel, 'Georgina Hazel'],
    ]);
  });

  it('gets a single customer and 404s on unknown ids', async () => {
    const found = await ctx.api.get(`/customers/${seedCustomerIds.arishaBarron}`);
    expect(found.status).toBe(200);
    expect(found.body.name).toBe('Arisha Barron');

    const missing = await ctx.api.get(`/customers/${UNKNOWN_ID}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('CUSTOMER_NOT_FOUND');
  });

  it('creates a customer with a fresh uuid', async () => {
    const res = await ctx.api.post('/customers').send({ name: 'Ada Lovelace' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Ada Lovelace' });
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.values(seedCustomerIds)).not.toContain(res.body.id);
  });

  it('rejects an empty name', async () => {
    const res = await ctx.api.post('/customers').send({ name: '  ' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('lists the accounts of a customer in creation order', async () => {
    await createAccount(ctx.db, seedCustomerIds.arishaBarron, 5_000);
    await createAccount(ctx.db, seedCustomerIds.arishaBarron, 0);
    await createAccount(ctx.db, seedCustomerIds.brandenGibson, 100);

    const res = await ctx.api.get(`/customers/${seedCustomerIds.arishaBarron}/accounts`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({
      customerId: seedCustomerIds.arishaBarron,
      balanceCents: 5_000,
    });
  });

  it('404s when listing accounts of an unknown customer', async () => {
    const res = await ctx.api.get(`/customers/${UNKNOWN_ID}/accounts`);
    expect(res.status).toBe(404);
  });

  it('validates path params (non-uuid ids are rejected)', async () => {
    for (const bad of ['abc', '123', '1.5']) {
      const res = await ctx.api.get(`/customers/${bad}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});
