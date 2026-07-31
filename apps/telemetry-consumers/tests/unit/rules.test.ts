import type { TelemetryEvent } from '@bank/events';
import { describe, expect, it } from 'vitest';

import { evaluateRules, haversineMeters } from '../../src/alerting/rules.js';
import type { AlertRuleConfig, Geofence } from '../../src/alerting/rules.js';

const DEPOT: Geofence = {
  id: 'depot',
  name: 'Central depot',
  centerLatitude: 54.6872,
  centerLongitude: 25.2797,
  radiusM: 500,
};

const CONFIG: AlertRuleConfig = { lowFuelPct: 15, speedLimitKph: 90, geofences: [DEPOT] };

function event(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    schemaVersion: 1,
    dedupKey: 'test:1:0',
    imei: '356938035643809',
    codec: 'codec8',
    recordedAt: '2026-07-31T12:00:00.000Z',
    receivedAt: '2026-07-31T12:00:01.000Z',
    priority: 1,
    eventIoId: 0,
    gps: {
      latitude: DEPOT.centerLatitude,
      longitude: DEPOT.centerLongitude,
      altitudeM: 100,
      angleDeg: 0,
      satellites: 10,
      speedKph: 40,
    },
    fuel: [],
    rawIo: {},
    rawIoVariable: {},
    ...overrides,
  };
}

const typesOf = (config: AlertRuleConfig, e: TelemetryEvent) =>
  evaluateRules(e, config).map((candidate) => candidate.alertType);

describe('haversineMeters', () => {
  it('is zero for the same point', () => {
    expect(
      haversineMeters({ latitude: 54.7, longitude: 25.3 }, { latitude: 54.7, longitude: 25.3 }),
    ).toBe(0);
  });

  it('matches a known distance (Vilnius to Kaunas, ~92 km)', () => {
    const distance = haversineMeters(
      { latitude: 54.6872, longitude: 25.2797 },
      { latitude: 54.8985, longitude: 23.9036 },
    );
    expect(distance).toBeGreaterThan(90_000);
    expect(distance).toBeLessThan(95_000);
  });

  it('is about 111 km per degree of latitude', () => {
    const distance = haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });
    expect(distance).toBeCloseTo(111_195, -2);
  });
});

describe('low fuel', () => {
  it('fires below the threshold', () => {
    const candidates = evaluateRules(event({ fuel: [{ source: 'can_pct', pct: 9 }] }), CONFIG);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.alertType).toBe('low_fuel');
    expect(candidates[0]?.details).toMatchObject({
      levelPct: 9,
      thresholdPct: 15,
      source: 'can_pct',
    });
  });

  it('stays quiet at or above the threshold', () => {
    expect(typesOf(CONFIG, event({ fuel: [{ source: 'can_pct', pct: 15 }] }))).toEqual([]);
    expect(typesOf(CONFIG, event({ fuel: [{ source: 'can_pct', pct: 80 }] }))).toEqual([]);
  });

  it('uses the lowest reading when sensors disagree', () => {
    // Better to send someone to a tank that turns out to be fine than to trust
    // the optimistic sensor and strand a cash vehicle.
    const candidates = evaluateRules(
      event({
        fuel: [
          { source: 'can_pct', pct: 40 },
          { source: 'lls1', pct: 8 },
        ],
      }),
      CONFIG,
    );
    expect(candidates[0]?.details).toMatchObject({ levelPct: 8, source: 'lls1' });
  });

  it('ignores a volume-only reading, having no threshold for litres', () => {
    expect(typesOf(CONFIG, event({ fuel: [{ source: 'can_liters', liters: 3 }] }))).toEqual([]);
  });
});

describe('speeding', () => {
  it('fires above the limit', () => {
    const candidates = evaluateRules(event({ gps: { ...event().gps!, speedKph: 120 } }), CONFIG);
    expect(candidates.map((c) => c.alertType)).toEqual(['speeding']);
    expect(candidates[0]?.details).toMatchObject({ speedKph: 120, limitKph: 90 });
  });

  it('stays quiet at the limit', () => {
    expect(typesOf(CONFIG, event({ gps: { ...event().gps!, speedKph: 90 } }))).toEqual([]);
  });

  it('cannot fire without a position fix', () => {
    expect(typesOf(CONFIG, event({ gps: null }))).toEqual([]);
  });
});

describe('geofence exit', () => {
  it('stays quiet inside the zone', () => {
    expect(typesOf(CONFIG, event())).toEqual([]);
  });

  it('fires outside every zone', () => {
    const candidates = evaluateRules(
      event({ gps: { ...event().gps!, latitude: 54.8985, longitude: 23.9036 } }),
      CONFIG,
    );
    expect(candidates.map((c) => c.alertType)).toEqual(['geofence_exit']);
    expect(candidates[0]?.details).toMatchObject({
      nearestGeofenceId: 'depot',
      radiusM: 500,
    });
  });

  it('stays quiet when inside any one of several zones', () => {
    const far: Geofence = {
      ...DEPOT,
      id: 'branch',
      name: 'Branch',
      centerLatitude: 10,
      centerLongitude: 10,
    };
    const config = { ...CONFIG, geofences: [far, DEPOT] };
    expect(typesOf(config, event())).toEqual([]);
  });

  it('reports the nearest zone when outside all of them', () => {
    const near: Geofence = { ...DEPOT, id: 'near', name: 'Near', radiusM: 10 };
    const far: Geofence = {
      ...DEPOT,
      id: 'far',
      name: 'Far',
      centerLatitude: 10,
      centerLongitude: 10,
      radiusM: 10,
    };
    // Roughly 110 m north of the depot: outside both tiny zones.
    const outside = event({
      gps: { ...event().gps!, latitude: DEPOT.centerLatitude + 0.001 },
    });

    const candidates = evaluateRules(outside, { ...CONFIG, geofences: [far, near] });
    expect(candidates[0]?.alertType).toBe('geofence_exit');
    expect(candidates[0]?.details).toMatchObject({ nearestGeofenceId: 'near', radiusM: 10 });
  });

  it('does not fire when no zones are configured', () => {
    // Nothing has been declared out of bounds, so nothing is.
    expect(
      typesOf(
        { ...CONFIG, geofences: [] },
        event({ gps: { ...event().gps!, latitude: 0, longitude: 0 } }),
      ),
    ).toEqual([]);
  });
});

describe('combinations', () => {
  it('reports every condition a single reading satisfies', () => {
    const candidates = typesOf(
      CONFIG,
      event({
        fuel: [{ source: 'can_pct', pct: 5 }],
        gps: { ...event().gps!, latitude: 54.8985, longitude: 23.9036, speedKph: 130 },
      }),
    );
    expect(new Set(candidates)).toEqual(new Set(['low_fuel', 'speeding', 'geofence_exit']));
  });

  it('reports nothing for a healthy reading', () => {
    expect(typesOf(CONFIG, event({ fuel: [{ source: 'can_pct', pct: 75 }] }))).toEqual([]);
  });
});
