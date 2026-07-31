import { vehicles } from '@bank/db-telemetry';
import type { TelemetryDb } from '@bank/db-telemetry';
import { eq } from 'drizzle-orm';

/**
 * Resolves an IMEI to a vehicle row, registering it on first sight.
 *
 * Ingest deliberately knows nothing about the database — it accepts any
 * well-formed IMEI so a newly fitted device is never turned away and its data
 * never dropped. Naming the vehicle is an operator's job afterwards.
 *
 * The cache matters: every reading needs this lookup, and a vehicle's id never
 * changes once assigned.
 */
export function createVehicleRegistry(db: TelemetryDb) {
  const cache = new Map<string, string>();

  return {
    async resolve(imei: string): Promise<string> {
      const cached = cache.get(imei);
      if (cached) return cached;

      // Two consumers can race on a new device; whoever loses the unique index
      // still reads the winner's row back.
      await db.insert(vehicles).values({ imei }).onConflictDoNothing();
      const [row] = await db
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(eq(vehicles.imei, imei))
        .limit(1);

      if (!row) throw new Error(`vehicle for IMEI ${imei} vanished after upsert`);
      cache.set(imei, row.id);
      return row.id;
    },

    /** Resolves many IMEIs at once, keeping one entry per distinct device. */
    async resolveAll(imeis: Iterable<string>): Promise<Map<string, string>> {
      const resolved = new Map<string, string>();
      for (const imei of new Set(imeis)) resolved.set(imei, await this.resolve(imei));
      return resolved;
    },
  };
}

export type VehicleRegistry = ReturnType<typeof createVehicleRegistry>;
