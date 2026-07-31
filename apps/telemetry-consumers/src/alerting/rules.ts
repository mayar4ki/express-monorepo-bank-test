import type { TelemetryEvent } from '@bank/events';

export type VehicleAlertType = 'low_fuel' | 'geofence_exit' | 'speeding';

export interface Geofence {
  id: string;
  name: string;
  centerLatitude: number;
  centerLongitude: number;
  radiusM: number;
}

export interface AlertRuleConfig {
  lowFuelPct: number;
  speedLimitKph: number;
  geofences: Geofence[];
}

export interface AlertCandidate {
  alertType: VehicleAlertType;
  /** What the rule matched on: threshold, observed value, which zone. */
  details: Record<string, unknown>;
}

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in metres. */
export function haversineMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLng = toRadians(b.longitude - a.longitude);
  const chord =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(chord)));
}

/**
 * Which alert conditions this reading satisfies. Pure and stateless — deciding
 * whether a satisfied condition is *newsworthy* (has it only just started? has
 * it already been reported?) is the consumer's job, because that needs state.
 */
export function evaluateRules(event: TelemetryEvent, config: AlertRuleConfig): AlertCandidate[] {
  const candidates: AlertCandidate[] = [];

  // Any sensor reading below the threshold counts; vehicles can carry more than
  // one and we would rather act on the pessimistic figure.
  const lowest = event.fuel
    .filter((reading) => reading.pct !== undefined)
    .reduce<{ source: string; pct: number } | undefined>((worst, reading) => {
      const pct = reading.pct;
      if (pct === undefined) return worst;
      return worst === undefined || pct < worst.pct ? { source: reading.source, pct } : worst;
    }, undefined);

  if (lowest && lowest.pct < config.lowFuelPct) {
    candidates.push({
      alertType: 'low_fuel',
      details: { levelPct: lowest.pct, thresholdPct: config.lowFuelPct, source: lowest.source },
    });
  }

  const { gps } = event;
  if (gps) {
    if (gps.speedKph > config.speedLimitKph) {
      candidates.push({
        alertType: 'speeding',
        details: { speedKph: gps.speedKph, limitKph: config.speedLimitKph },
      });
    }

    // A cash vehicle is expected inside at least one of its zones; being
    // outside every one of them is the exception worth reporting.
    if (config.geofences.length > 0) {
      const distances = config.geofences.map((geofence) => ({
        geofence,
        distanceM: haversineMeters(gps, {
          latitude: geofence.centerLatitude,
          longitude: geofence.centerLongitude,
        }),
      }));

      const inside = distances.some(({ geofence, distanceM }) => distanceM <= geofence.radiusM);
      if (!inside) {
        const nearest = distances.reduce((best, current) =>
          current.distanceM < best.distanceM ? current : best,
        );
        candidates.push({
          alertType: 'geofence_exit',
          details: {
            nearestGeofenceId: nearest.geofence.id,
            nearestGeofenceName: nearest.geofence.name,
            distanceM: Math.round(nearest.distanceM),
            radiusM: nearest.geofence.radiusM,
          },
        });
      }
    }
  }

  return candidates;
}
