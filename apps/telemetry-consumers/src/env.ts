import { consumerGroups } from '@bank/events';
import { z } from 'zod';

const consumerNames = Object.keys(consumerGroups) as [keyof typeof consumerGroups];

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3004),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TELEMETRY_DATABASE_URL: z.string().min(1, 'TELEMETRY_DATABASE_URL is required'),
  KAFKA_BROKERS: z.string().min(1, 'KAFKA_BROKERS is required'),
  KAFKA_CLIENT_ID: z.string().min(1).default('telemetry-consumers'),
  /**
   * Which consumers this process runs. They already have independent offsets,
   * so narrowing this is all it takes to split one of them into its own
   * deployment — for instance to scale alerting separately.
   */
  CONSUMERS: z
    .string()
    .default('all')
    .transform((value, ctx) => {
      if (value.trim() === 'all') return [...consumerNames];
      const names = value
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
      const unknown = names.filter((name) => !(name in consumerGroups));
      if (unknown.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message: `unknown consumer(s) ${unknown.join(', ')}; expected any of ${consumerNames.join(', ')} or "all"`,
        });
        return z.NEVER;
      }
      return names as (keyof typeof consumerGroups)[];
    }),

  /** Fire a low-fuel alert below this percentage. */
  LOW_FUEL_PCT: z.coerce.number().int().min(0).max(100).default(15),
  SPEED_LIMIT_KPH: z.coerce.number().int().positive().default(90),
  /** Do not re-fire an alert that is still active until this has elapsed. */
  ALERT_COOLDOWN_MS: z.coerce.number().int().positive().default(900_000),
  /**
   * Never alert on a reading older than this. Alerting reads only the live
   * topic, so this is a second line of defence against a backlog flush raising
   * alarms about conditions that have long since passed.
   */
  ALERT_MAX_AGE_MS: z.coerce.number().int().positive().default(600_000),
  GEOFENCE_REFRESH_MS: z.coerce.number().int().positive().default(60_000),
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
