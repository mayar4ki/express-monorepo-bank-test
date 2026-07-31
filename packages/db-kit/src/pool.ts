import pg from 'pg';

/** Connection settings every cluster in the platform shares. */
export const POOL_MAX_CONNECTIONS = 20;

/** Drizzle options every cluster shares — snake_case columns in SQL. */
export const DRIZZLE_OPTIONS = { casing: 'snake_case' } as const;

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: POOL_MAX_CONNECTIONS });
}
