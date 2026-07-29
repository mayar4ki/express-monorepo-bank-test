import { describe, expect, it } from 'vitest';

import { createTransferBody, idempotencyHeaders } from '../../src/modules/transfers/schemas.js';

const from = '00000000-0000-4000-8000-000000000101';
const to = '00000000-0000-4000-8000-000000000102';

describe('transfer request schemas', () => {
  it('accepts a valid body', () => {
    expect(
      createTransferBody.parse({ fromAccountId: from, toAccountId: to, amountCents: 500 }),
    ).toEqual({
      fromAccountId: from,
      toAccountId: to,
      amountCents: 500,
    });
  });

  it('rejects missing fields, non-uuid ids and bad amounts', () => {
    expect(() => createTransferBody.parse({ fromAccountId: from, toAccountId: to })).toThrow();
    expect(() =>
      createTransferBody.parse({ fromAccountId: 1, toAccountId: 2, amountCents: 500 }),
    ).toThrow();
    expect(() =>
      createTransferBody.parse({ fromAccountId: from, toAccountId: to, amountCents: 0 }),
    ).toThrow();
  });

  it('requires a non-empty idempotency-key header', () => {
    expect(idempotencyHeaders.parse({ 'idempotency-key': 'abc' })['idempotency-key']).toBe('abc');
    expect(() => idempotencyHeaders.parse({})).toThrow();
    expect(() => idempotencyHeaders.parse({ 'idempotency-key': '' })).toThrow();
  });
});
