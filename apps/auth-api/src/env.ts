import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /** Path to an ES256 private key in PKCS8 PEM format (preferred). */
  JWT_PRIVATE_KEY_FILE: z.string().optional(),
  /** Inline ES256 private key (PKCS8 PEM); alternative to the file. */
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_ISSUER: z.string().default('bank-auth'),
  JWT_AUDIENCE: z.string().default('bank-internal-api'),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
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
