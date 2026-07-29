import { z } from 'zod';

/**
 * All monetary amounts are integer minor units (cents). JSON numbers are safe
 * up to Number.MAX_SAFE_INTEGER (~$90 trillion) — enforced here so values
 * survive the JS number round-trip exactly.
 */
export const positiveCents = z
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER)
  .meta({ description: 'Amount in cents (integer minor units)', example: 12550 });

export const nonNegativeCents = z
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .meta({ description: 'Amount in cents (integer minor units), zero allowed', example: 10000 });
