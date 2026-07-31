import { FUEL_SOURCES } from '@bank/teltonika';
import { z } from 'zod';

/**
 * The wire contract for telemetry on Kafka. Producers and consumers share this
 * schema, and consumers validate every message against it: a device firmware
 * change or a bad deploy shows up as a message on the dead-letter topic rather
 * than as a half-written row.
 *
 * `schemaVersion` is checked, not just recorded. To change the shape, add a
 * version and let consumers accept both until the old one has aged out of the
 * topic retention window.
 */

export const TELEMETRY_SCHEMA_VERSION = 1;

const fuelReadingSchema = z
  .object({
    source: z.enum(FUEL_SOURCES),
    pct: z.number().optional(),
    liters: z.number().optional(),
  })
  .refine((reading) => reading.pct !== undefined || reading.liters !== undefined, {
    message: 'a fuel reading must carry a percentage or a volume',
  });

const gpsSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  altitudeM: z.number().int(),
  angleDeg: z.number().int(),
  satellites: z.number().int().nonnegative(),
  speedKph: z.number().int().nonnegative(),
});

export const telemetryEventSchema = z.object({
  schemaVersion: z.literal(TELEMETRY_SCHEMA_VERSION),
  /**
   * Identifies one physical AVL record for tracing and dead-letter triage.
   * Storage dedup does not rely on this — the reading tables have their own
   * unique keys, which stay correct even if a device repacks its records.
   */
  dedupKey: z.string().min(1),
  imei: z.string().regex(/^\d{15}$/),
  codec: z.enum(['codec8', 'codec8e']),
  /** Device clock — when the vehicle was in this state. */
  recordedAt: z.iso.datetime(),
  /** Our clock — when we received it. Later than `recordedAt` for backlog. */
  receivedAt: z.iso.datetime(),
  priority: z.number().int().nonnegative(),
  eventIoId: z.number().int().nonnegative(),
  /** Null when the device had no satellite fix. */
  gps: gpsSchema.nullable(),
  ignition: z.boolean().optional(),
  movement: z.boolean().optional(),
  fuel: z.array(fuelReadingSchema),
  externalVoltageMv: z.number().int().optional(),
  batteryVoltageMv: z.number().int().optional(),
  odometerM: z.number().int().optional(),
  /** Every fixed-width IO element as a decimal string, keyed by AVL id. */
  rawIo: z.record(z.string(), z.string()),
  /** Every variable-length IO element as hex, keyed by AVL id. */
  rawIoVariable: z.record(z.string(), z.string()),
});

export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;
export type TelemetryGps = z.infer<typeof gpsSchema>;
export type TelemetryFuelReading = z.infer<typeof fuelReadingSchema>;

export type DecodeResult = { ok: true; event: TelemetryEvent } | { ok: false; reason: string };

/**
 * Decodes a Kafka message body. Never throws: a malformed message is a routing
 * decision (send it to the dead-letter topic and carry on), not a crash.
 */
export function decodeTelemetryEvent(value: Buffer | string | null): DecodeResult {
  if (value === null) return { ok: false, reason: 'message has no value' };

  let json: unknown;
  try {
    json = JSON.parse(typeof value === 'string' ? value : value.toString('utf8'));
  } catch (err) {
    return {
      ok: false,
      reason: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const parsed = telemetryEventSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return { ok: false, reason: `schema mismatch: ${issues}` };
  }

  return { ok: true, event: parsed.data };
}
