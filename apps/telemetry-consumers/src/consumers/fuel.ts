import { vehicleFuelReadings } from '@bank/db';
import type { Db } from '@bank/db';
import type { TelemetryBatchHandler } from '@bank/events';
import type { Logger } from 'pino';

import type { VehicleRegistry } from '../vehicles.js';

/**
 * Writes fuel levels, one row per sensor. A vehicle can report a CAN percentage
 * and a tank sensor at the same time and they will disagree; storing both keeps
 * that visible instead of silently picking a winner.
 */
export function createFuelHandler(deps: {
  db: Db;
  logger: Logger;
  vehicles: VehicleRegistry;
}): TelemetryBatchHandler {
  return async (events) => {
    const withFuel = events.filter((event) => event.fuel.length > 0);
    if (withFuel.length === 0) return;

    const vehicleIds = await deps.vehicles.resolveAll(withFuel.map((event) => event.imei));

    const rows = withFuel.flatMap((event) => {
      const vehicleId = vehicleIds.get(event.imei);
      if (!vehicleId) return [];
      return event.fuel.map((reading) => ({
        vehicleId,
        recordedAt: new Date(event.recordedAt),
        receivedAt: new Date(event.receivedAt),
        source: reading.source,
        levelPct: reading.pct ?? null,
        // numeric columns take strings to avoid float rounding on the way in.
        levelLiters: reading.liters === undefined ? null : reading.liters.toFixed(2),
      }));
    });
    if (rows.length === 0) return;

    await deps.db.insert(vehicleFuelReadings).values(rows).onConflictDoNothing();
    deps.logger.debug({ rows: rows.length }, 'fuel readings written');
  };
}
