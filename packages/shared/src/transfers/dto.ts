import type { transfers } from '@bank/db';

export type TransferRow = typeof transfers.$inferSelect;

export function toTransferDto(row: TransferRow) {
  return {
    id: row.id,
    type: row.fromAccountId === null ? ('deposit' as const) : ('transfer' as const),
    fromAccountId: row.fromAccountId,
    toAccountId: row.toAccountId,
    amountCents: row.amountCents,
    status: row.status,
    failureReason: row.failureReason,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}
