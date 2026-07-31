import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Health endpoint. */
  PORT: z.coerce.number().int().positive().default(3003),
  /** Where the devices connect. 5027 is Teltonika's usual TCP port. */
  TCP_PORT: z.coerce.number().int().positive().default(5027),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  KAFKA_BROKERS: z.string().min(1, 'KAFKA_BROKERS is required'),
  KAFKA_CLIENT_ID: z.string().min(1).default('telemetry-ingest'),
  /**
   * Devices report every minute or two and hold the connection open between
   * packets, so a quiet socket for this long is a dead one.
   */
  IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  /** Records older than this on arrival came out of a device's flash buffer. */
  BACKFILL_THRESHOLD_MS: z.coerce.number().int().positive().default(300_000),
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

/** KAFKA_BROKERS is a comma-separated list. */
export function parseBrokers(value: string): string[] {
  return value
    .split(',')
    .map((broker) => broker.trim())
    .filter((broker) => broker.length > 0);
}
