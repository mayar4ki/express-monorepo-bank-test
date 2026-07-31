import { geofences, vehicleAlertStates, vehicleAlerts } from '@bank/db';
import type { Db } from '@bank/db';
import type { TelemetryBatchHandler, TelemetryEvent } from '@bank/events';
import { and, eq } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { VehicleRegistry } from '../vehicles.js';
import { evaluateRules } from './rules.js';
import type { AlertCandidate, Geofence, VehicleAlertType } from './rules.js';

const ALERT_TYPES: VehicleAlertType[] = ['low_fuel', 'geofence_exit', 'speeding'];

export interface AlertingConfig {
  lowFuelPct: number;
  speedLimitKph: number;
  cooldownMs: number;
  /** Readings older than this never raise an alarm. */
  maxAgeMs: number;
  geofenceRefreshMs: number;
}

/**
 * Raises alerts on live telemetry.
 *
 * Alerts are edge-triggered. A van below the fuel threshold satisfies the rule
 * on every reading for the rest of its shift, so firing per reading would bury
 * the one that mattered. Instead a row is written when a condition starts
 * holding, and again only after the cooldown while it continues to hold.
 * `vehicle_alert_states` keeps that per vehicle and condition, so it survives
 * restarts and is shared across replicas.
 *
 * Stale readings are ignored outright. This consumer is subscribed to the live
 * topic only, but a device with a badly wrong clock could still present old data
 * as current, and nobody wants to be paged about a tank that was refilled hours
 * ago.
 */
export function createAlertingHandler(deps: {
  db: Db;
  logger: Logger;
  vehicles: VehicleRegistry;
  config: AlertingConfig;
  now?: () => Date;
}): TelemetryBatchHandler {
  const now = deps.now ?? (() => new Date());
  let cache: { geofences: Geofence[]; loadedAt: number } | undefined;

  async function activeGeofences(): Promise<Geofence[]> {
    const age = cache ? now().getTime() - cache.loadedAt : Infinity;
    if (cache && age < deps.config.geofenceRefreshMs) return cache.geofences;

    const rows = await deps.db
      .select({
        id: geofences.id,
        name: geofences.name,
        centerLatitude: geofences.centerLatitude,
        centerLongitude: geofences.centerLongitude,
        radiusM: geofences.radiusM,
      })
      .from(geofences)
      .where(eq(geofences.active, true));

    cache = { geofences: rows, loadedAt: now().getTime() };
    return rows;
  }

  /**
   * Records the condition's new state and answers whether it is worth
   * reporting: either it has just started, or it has been holding since before
   * the cooldown elapsed.
   */
  async function shouldFire(
    vehicleId: string,
    alertType: VehicleAlertType,
    holding: boolean,
    at: Date,
  ): Promise<boolean> {
    const [existing] = await deps.db
      .select({ active: vehicleAlertStates.active, lastFiredAt: vehicleAlertStates.lastFiredAt })
      .from(vehicleAlertStates)
      .where(
        and(
          eq(vehicleAlertStates.vehicleId, vehicleId),
          eq(vehicleAlertStates.alertType, alertType),
        ),
      )
      .limit(1);

    if (!holding) {
      if (existing?.active) {
        await deps.db
          .update(vehicleAlertStates)
          .set({ active: false, updatedAt: at })
          .where(
            and(
              eq(vehicleAlertStates.vehicleId, vehicleId),
              eq(vehicleAlertStates.alertType, alertType),
            ),
          );
      }
      return false;
    }

    const cooledDown =
      existing?.lastFiredAt != null &&
      at.getTime() - existing.lastFiredAt.getTime() >= deps.config.cooldownMs;
    const fire = !existing?.active || cooledDown;

    await deps.db
      .insert(vehicleAlertStates)
      .values({
        vehicleId,
        alertType,
        active: true,
        lastFiredAt: fire ? at : (existing?.lastFiredAt ?? at),
        updatedAt: at,
      })
      .onConflictDoUpdate({
        target: [vehicleAlertStates.vehicleId, vehicleAlertStates.alertType],
        set: {
          active: true,
          ...(fire ? { lastFiredAt: at } : {}),
          updatedAt: at,
        },
      });

    return fire;
  }

  return async (events) => {
    const cutoff = now().getTime() - deps.config.maxAgeMs;
    const fresh = events.filter((event) => Date.parse(event.recordedAt) >= cutoff);
    if (fresh.length === 0) return;

    const config = {
      lowFuelPct: deps.config.lowFuelPct,
      speedLimitKph: deps.config.speedLimitKph,
      geofences: await activeGeofences(),
    };
    const vehicleIds = await deps.vehicles.resolveAll(fresh.map((event) => event.imei));

    for (const event of fresh) {
      const vehicleId = vehicleIds.get(event.imei);
      if (!vehicleId) continue;

      const candidates = evaluateRules(event, config);
      const byType = new Map(candidates.map((candidate) => [candidate.alertType, candidate]));

      // Every rule is evaluated, not just the ones that matched: a condition
      // that no longer holds has to be cleared, or it would never fire again.
      for (const alertType of ALERT_TYPES) {
        const candidate = byType.get(alertType);
        const recordedAt = new Date(event.recordedAt);
        if (!(await shouldFire(vehicleId, alertType, candidate !== undefined, recordedAt))) {
          continue;
        }
        await raise(deps, vehicleId, event, candidate, recordedAt);
      }
    }
  };
}

async function raise(
  deps: { db: Db; logger: Logger },
  vehicleId: string,
  event: TelemetryEvent,
  candidate: AlertCandidate | undefined,
  recordedAt: Date,
): Promise<void> {
  if (!candidate) return;

  await deps.db.insert(vehicleAlerts).values({
    vehicleId,
    alertType: candidate.alertType,
    recordedAt,
    details: candidate.details,
  });

  // Logged at warn so it is visible without a dashboard; a notification
  // channel can hang off this table later.
  deps.logger.warn(
    { vehicleId, imei: event.imei, alertType: candidate.alertType, ...candidate.details },
    'vehicle alert raised',
  );
}
