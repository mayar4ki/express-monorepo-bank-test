import { vehicleLocations } from '@bank/db-telemetry';
import type { TelemetryDb } from '@bank/db-telemetry';
import type { TelemetryBatchHandler } from '@bank/events';
import type { Logger } from 'pino';

import type { VehicleRegistry } from '../vehicles.js';

/**
 * Writes positions. Records without a satellite fix are skipped rather than
 * stored: a device with no fix reports zeroes, which would otherwise plot every
 * such reading in the Gulf of Guinea and drag route history through it.
 *
 * Reads both the live and backfill topics — a vehicle's history is worth having
 * whenever it arrives.
 */
export function createLocationsHandler(deps: {
  db: TelemetryDb;
  logger: Logger;
  vehicles: VehicleRegistry;
}): TelemetryBatchHandler {
  return async (events) => {
    const positioned = events.filter((event) => event.gps !== null);
    if (positioned.length === 0) return;

    const vehicleIds = await deps.vehicles.resolveAll(positioned.map((event) => event.imei));

    const rows = positioned.flatMap((event) => {
      const vehicleId = vehicleIds.get(event.imei);
      if (!vehicleId || !event.gps) return [];
      return [
        {
          vehicleId,
          recordedAt: new Date(event.recordedAt),
          receivedAt: new Date(event.receivedAt),
          latitude: event.gps.latitude,
          longitude: event.gps.longitude,
          altitudeM: event.gps.altitudeM,
          angleDeg: event.gps.angleDeg,
          satellites: event.gps.satellites,
          speedKph: event.gps.speedKph,
        },
      ];
    });
    if (rows.length === 0) return;

    // Delivery is at-least-once, so a redelivered position must be a no-op
    // rather than a duplicate row.
    await deps.db.insert(vehicleLocations).values(rows).onConflictDoNothing();
    deps.logger.debug(
      { rows: rows.length, skipped: events.length - rows.length },
      'positions written',
    );
  };
}
