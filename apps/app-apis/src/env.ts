import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  /** Where to fetch the auth API's public signing keys. */
  AUTH_JWKS_URL: z.url({ message: 'AUTH_JWKS_URL must be a URL' }),
  /** Must match the auth API's JWT_ISSUER / JWT_AUDIENCE. */
  AUTH_ISSUER: z.string().default('bank-auth'),
  AUTH_AUDIENCE: z.string().default('bank-internal-api'),
  /** Comma-separated origin allowlist; empty means no cross-origin access. */
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  /**
   * Comma-separated URLs of other services' OpenAPI specs to merge into
   * /docs. Set behind the gateway so the whole platform documents as one API.
   */
  DOCS_MERGE_SPEC_URLS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((url) => url.trim())
        .filter(Boolean),
    ),
});

export type Env = z.output<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
