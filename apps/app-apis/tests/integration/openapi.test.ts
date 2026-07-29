import { afterAll, describe, expect, it } from 'vitest';

import { createTestContext } from '../helpers/test-app.js';

const ctx = createTestContext();

afterAll(() => ctx.close());

describe('OpenAPI documentation', () => {
  it('serves a spec that covers every mounted route', async () => {
    const res = await ctx.api.get('/docs/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');

    const paths = Object.keys(res.body.paths as Record<string, unknown>);
    for (const expected of [
      '/health',
      '/customers',
      '/customers/{customerId}',
      '/customers/{customerId}/accounts',
      '/accounts',
      '/accounts/{accountId}',
      '/accounts/{accountId}/balance',
      '/accounts/{accountId}/transfers',
      '/transfers',
      '/transfers/{transferId}',
      '/accounts/{accountId}/comments',
      '/accounts/{accountId}/locks',
      '/accounts/{accountId}/locks/{lockId}',
    ]) {
      expect(paths).toContain(expected);
    }
  });

  it('serves the Swagger UI', async () => {
    const res = await ctx.api.get('/docs/').redirects(1);
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger-ui');
  });
});
