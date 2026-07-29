import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ZodType } from 'zod';

import { buildOpenApiDocument, defineRoute, mergeOpenApiDocuments } from '../../src/index.js';

function makeDoc(path: string, tag: string, schema: ZodType) {
  const route = defineRoute({
    method: 'get',
    path,
    summary: `Get ${path}`,
    tags: [tag],
    responses: { 200: { description: 'ok', schema } },
    handler: () => Promise.resolve({ status: 200, body: {} }),
  });
  return buildOpenApiDocument([route], {
    title: `${tag} API`,
    version: '1.0.0',
    description: tag,
  });
}

describe('mergeOpenApiDocuments', () => {
  it('adds paths and schemas from the extra documents', () => {
    const base = makeDoc(
      '/customers',
      'Customers',
      z.object({ name: z.string() }).meta({ id: 'Customer' }),
    );
    const extra = makeDoc(
      '/auth/login',
      'Auth',
      z.object({ token: z.string() }).meta({ id: 'Login' }),
    );

    const merged = mergeOpenApiDocuments(base, [extra]);

    expect(Object.keys(merged.paths ?? {})).toEqual(
      expect.arrayContaining(['/customers', '/auth/login']),
    );
    expect(Object.keys(merged.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(['Customer', 'Login']),
    );
  });

  it('keeps the base path and info on collisions', () => {
    const base = makeDoc('/health', 'System', z.object({ ok: z.boolean() }).meta({ id: 'Ok' }));
    const extra = makeDoc('/health', 'Other', z.object({ ok: z.boolean() }).meta({ id: 'Ok' }));
    extra.paths!['/health']!.get!.summary = 'remote health';

    const merged = mergeOpenApiDocuments(base, [extra]);

    expect(merged.paths?.['/health']?.get?.summary).toBe('Get /health');
    expect(merged.info.title).toBe('System API');
  });

  it('deduplicates identical schemas and renames conflicting ones with $refs rewritten', () => {
    const base = makeDoc(
      '/health',
      'System',
      z.object({ status: z.string() }).meta({ id: 'Health' }),
    );
    // Same schema id, different shape -> must be renamed, not dropped or overwritten.
    const extra = makeDoc(
      '/auth/health',
      'Auth',
      z.object({ status: z.string(), uptime: z.number() }).meta({ id: 'Health' }),
    );

    const merged = mergeOpenApiDocuments(base, [extra]);
    const schemas = merged.components?.schemas ?? {};

    expect(Object.keys(schemas)).toEqual(expect.arrayContaining(['Health', 'Health_2']));
    expect(schemas['Health']).toEqual(base.components?.schemas?.['Health']);
    expect(JSON.stringify(merged.paths?.['/auth/health'])).toContain(
      '#/components/schemas/Health_2',
    );
  });

  it('does not mutate the input documents', () => {
    const base = makeDoc(
      '/customers',
      'Customers',
      z.object({ name: z.string() }).meta({ id: 'Customer' }),
    );
    const extra = makeDoc(
      '/auth/login',
      'Auth',
      z.object({ token: z.string() }).meta({ id: 'Login' }),
    );

    mergeOpenApiDocuments(base, [extra]);

    expect(base.paths?.['/auth/login']).toBeUndefined();
    expect(Object.keys(extra.components?.schemas ?? {})).toEqual(['Login']);
  });
});
