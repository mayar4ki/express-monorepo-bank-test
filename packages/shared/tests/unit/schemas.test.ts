import { describe, expect, it } from 'vitest';

import { positiveCents, nonNegativeCents, idSchema } from '../../src/index.js';

describe('money schemas', () => {
  it('accepts positive integer cents', () => {
    expect(positiveCents.parse(1)).toBe(1);
    expect(positiveCents.parse(12_550)).toBe(12_550);
  });

  it('rejects zero, negatives, floats and unsafe integers', () => {
    expect(() => positiveCents.parse(0)).toThrow();
    expect(() => positiveCents.parse(-5)).toThrow();
    expect(() => positiveCents.parse(10.5)).toThrow();
    expect(() => positiveCents.parse(Number.MAX_SAFE_INTEGER + 1)).toThrow();
    expect(() => positiveCents.parse('100')).toThrow();
  });

  it('nonNegativeCents allows zero (empty account opening)', () => {
    expect(nonNegativeCents.parse(0)).toBe(0);
    expect(() => nonNegativeCents.parse(-1)).toThrow();
  });
});

describe('idSchema', () => {
  it('accepts UUIDs from path params', () => {
    const uuid = '00000000-0000-4000-8000-000000000001';
    expect(idSchema.parse(uuid)).toBe(uuid);
  });

  it('rejects everything that is not a UUID', () => {
    expect(() => idSchema.parse('abc')).toThrow();
    expect(() => idSchema.parse('42')).toThrow();
    expect(() => idSchema.parse('')).toThrow();
    expect(() => idSchema.parse('00000000-0000-4000-8000')).toThrow();
  });
});
