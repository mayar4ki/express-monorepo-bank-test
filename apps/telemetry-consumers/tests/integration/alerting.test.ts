import { geofences, vehicleAlertStates, vehicleAlerts } from '@bank/db-telemetry';
import { AVL_ID } from '@bank/teltonika';
import { asc } from 'drizzle-orm';
import { afterEach, describe, expect, inject, it } from 'vitest';

import { createConsumerContext, resetTelemetry } from '../helpers/context.js';
import type { ConsumerContext } from '../helpers/context.js';
import type { AlertingConfig } from '../../src/alerting/consumer.js';

const databaseUrl = inject('databaseUrl');
const brokers = inject('kafkaBrokers');

const DEPOT = {
  name: 'Central depot',
  centerLatitude: 54.6872,
  centerLongitude: 25.2797,
  radiusM: 500,
};

const INSIDE_DEPOT = {
  latitude: DEPOT.centerLatitude,
  longitude: DEPOT.centerLongitude,
  altitudeM: 100,
  angleDeg: 0,
  satellites: 10,
  speedKph: 40,
};

const FAR_AWAY = { ...INSIDE_DEPOT, latitude: 54.8985, longitude: 23.9036 };

let ctx: ConsumerContext;

/** Fresh context per test so the geofence cache and alert state start clean. */
async function start(options: { alerting?: Partial<AlertingConfig>; withDepot?: boolean } = {}) {
  ctx = await createConsumerContext({
    databaseUrl,
    brokers,
    names: ['alerting'],
    alerting: options.alerting,
  });
  await resetTelemetry(ctx.db);
  // Inserted before anything is published: the geofence cache loads lazily on
  // the first batch, so it will see this row.
  if (options.withDepot !== false) await ctx.db.insert(geofences).values(DEPOT);
  return ctx;
}

const listAlerts = () => ctx.db.select().from(vehicleAlerts).orderBy(asc(vehicleAlerts.seq));
const listStates = () => ctx.db.select().from(vehicleAlertStates);

const fuelRecord = (timestampMs: number, pct: number) => ({
  timestampMs,
  gps: INSIDE_DEPOT,
  io: [{ id: AVL_ID.fuelLevelCanPct, value: pct, widthBytes: 1 as const }],
});

afterEach(async () => {
  await ctx.close();
});

describe('low fuel', () => {
  it('raises one alert when the tank drops below the threshold', async () => {
    await start();
    await ctx.publish([fuelRecord(Date.now(), 9)]);

    const alerts = await ctx.waitFor(listAlerts, (rows) => rows.length === 1);
    expect(alerts[0]?.alertType).toBe('low_fuel');
    expect(alerts[0]?.details).toMatchObject({ levelPct: 9, thresholdPct: 15 });
  });

  it('does not repeat while the tank stays low', async () => {
    await start();
    const base = Date.now();

    // A van below the threshold reports it on every reading for the rest of the
    // shift; only the first is news.
    await ctx.publish([
      fuelRecord(base, 9),
      fuelRecord(base + 1_000, 8),
      fuelRecord(base + 2_000, 7),
      fuelRecord(base + 3_000, 6),
    ]);

    await ctx.waitFor(listAlerts, (rows) => rows.length >= 1);
    await ctx.settle();
    expect(await listAlerts()).toHaveLength(1);
  });

  it('raises again after a refuel and a second drop', async () => {
    await start();
    const base = Date.now();

    await ctx.publish([fuelRecord(base, 9)]);
    await ctx.waitFor(listAlerts, (rows) => rows.length === 1);

    // Refuelled: the condition stops holding, which re-arms the alert.
    await ctx.publish([fuelRecord(base + 1_000, 80)]);
    await ctx.waitFor(listStates, (rows) => rows.some((row) => !row.active));

    await ctx.publish([fuelRecord(base + 2_000, 5)]);
    const alerts = await ctx.waitFor(listAlerts, (rows) => rows.length === 2);
    expect(alerts.map((row) => row.alertType)).toEqual(['low_fuel', 'low_fuel']);
  });

  it('re-fires a still-low tank once the cooldown has elapsed', async () => {
    // Cooldown is measured on the device clock, so spacing the records is
    // enough to exercise it deterministically.
    await start({ alerting: { cooldownMs: 5_000 } });
    const base = Date.now();

    await ctx.publish([fuelRecord(base, 9)]);
    await ctx.waitFor(listAlerts, (rows) => rows.length === 1);

    await ctx.publish([fuelRecord(base + 1_000, 9)]);
    await ctx.settle();
    expect(await listAlerts()).toHaveLength(1);

    await ctx.publish([fuelRecord(base + 10_000, 9)]);
    await ctx.waitFor(listAlerts, (rows) => rows.length === 2);
  });

  it('stays quiet for a healthy tank', async () => {
    await start();
    await ctx.publish([fuelRecord(Date.now(), 80)]);

    await ctx.settle();
    expect(await listAlerts()).toHaveLength(0);
  });
});

describe('speeding and geofences', () => {
  it('raises a speeding alert above the limit', async () => {
    await start({ alerting: { speedLimitKph: 90 } });
    await ctx.publish([{ timestampMs: Date.now(), gps: { ...INSIDE_DEPOT, speedKph: 130 } }]);

    const alerts = await ctx.waitFor(listAlerts, (rows) => rows.length === 1);
    expect(alerts[0]?.alertType).toBe('speeding');
    expect(alerts[0]?.details).toMatchObject({ speedKph: 130, limitKph: 90 });
  });

  it('raises a geofence exit when the vehicle leaves every zone', async () => {
    await start();
    await ctx.publish([{ timestampMs: Date.now(), gps: FAR_AWAY }]);

    const alerts = await ctx.waitFor(listAlerts, (rows) => rows.length === 1);
    expect(alerts[0]?.alertType).toBe('geofence_exit');
    expect(alerts[0]?.details).toMatchObject({ nearestGeofenceName: DEPOT.name, radiusM: 500 });
  });

  it('stays quiet inside the depot', async () => {
    await start();
    await ctx.publish([{ timestampMs: Date.now(), gps: INSIDE_DEPOT }]);

    await ctx.settle();
    expect(await listAlerts()).toHaveLength(0);
  });

  it('does not fire a geofence exit when no zones are configured', async () => {
    await start({ withDepot: false });
    await ctx.publish([{ timestampMs: Date.now(), gps: FAR_AWAY }]);

    await ctx.settle();
    expect(await listAlerts()).toHaveLength(0);
  });

  it('raises each condition separately for one bad reading', async () => {
    await start();
    await ctx.publish([
      {
        timestampMs: Date.now(),
        gps: { ...FAR_AWAY, speedKph: 130 },
        io: [{ id: AVL_ID.fuelLevelCanPct, value: 4, widthBytes: 1 }],
      },
    ]);

    const alerts = await ctx.waitFor(listAlerts, (rows) => rows.length === 3);
    expect(new Set(alerts.map((row) => row.alertType))).toEqual(
      new Set(['low_fuel', 'speeding', 'geofence_exit']),
    );
  });
});

describe('backlog must not raise alarms', () => {
  it('ignores a reconnecting device flushing hours of low-fuel history', async () => {
    await start();
    const now = Date.now();

    // The whole reason alerting is on its own topic: this is history, not news.
    await ctx.publish([
      fuelRecord(now - 6 * 60 * 60 * 1000, 5),
      fuelRecord(now - 5 * 60 * 60 * 1000, 4),
      fuelRecord(now - 4 * 60 * 60 * 1000, 3),
    ]);

    await ctx.settle(1_500);
    expect(await listAlerts()).toHaveLength(0);
  });

  it('still reacts to the live reading in the same packet as the backlog', async () => {
    await start();
    const now = Date.now();

    await ctx.publish([fuelRecord(now - 6 * 60 * 60 * 1000, 5), fuelRecord(now, 6)]);

    // Exactly one alert, from the current reading — the backlog behind it
    // neither fires nor delays it.
    const alerts = await ctx.waitFor(listAlerts, (rows) => rows.length === 1);
    expect(alerts[0]?.details).toMatchObject({ levelPct: 6 });
  });

  it('ignores a stale reading a wrong device clock presented as current', async () => {
    // maxAgeMs is the second line of defence behind the live/backfill split.
    await start({ alerting: { maxAgeMs: 2_000 } });
    await ctx.publish([fuelRecord(Date.now() - 60_000, 5)]);

    await ctx.settle(1_500);
    expect(await listAlerts()).toHaveLength(0);
  });
});
