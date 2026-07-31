import { vehicleEngineEvents, vehicleFuelReadings, vehicleLocations, vehicles } from '@bank/db';
import { AVL_ID } from '@bank/teltonika';
import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';

import { IMEI, createConsumerContext, resetTelemetry } from '../helpers/context.js';
import type { ConsumerContext } from '../helpers/context.js';

const databaseUrl = inject('databaseUrl');
const brokers = inject('kafkaBrokers');

const GPS = {
  latitude: 54.712345,
  longitude: 25.279652,
  altitudeM: 143,
  angleDeg: 271,
  satellites: 11,
  speedKph: 64,
};

let ctx: ConsumerContext;

beforeEach(async () => {
  ctx = await createConsumerContext({
    databaseUrl,
    brokers,
    names: ['locations', 'fuel', 'engine'],
  });
  await resetTelemetry(ctx.db);
});

afterEach(async () => {
  await ctx.close();
});

const countLocations = () => ctx.db.select().from(vehicleLocations);
const countFuel = () => ctx.db.select().from(vehicleFuelReadings);
const listEngine = () =>
  ctx.db.select().from(vehicleEngineEvents).orderBy(asc(vehicleEngineEvents.recordedAt));

describe('vehicle registration', () => {
  it('registers a vehicle the first time its device reports', async () => {
    await ctx.publish([{ timestampMs: Date.now(), gps: GPS }]);

    const rows = await ctx.waitFor(
      () => ctx.db.select().from(vehicles).where(eq(vehicles.imei, IMEI)),
      (r) => r.length === 1,
    );
    expect(rows[0]?.imei).toBe(IMEI);
    // Naming is an operator's job; ingest must not need to know the fleet.
    expect(rows[0]?.label).toBeNull();
  });

  it('registers each device exactly once across many packets', async () => {
    for (let i = 0; i < 3; i += 1) {
      await ctx.publish([{ timestampMs: Date.now() + i, gps: GPS }]);
    }

    await ctx.waitFor(countLocations, (r) => r.length === 3);
    expect(await ctx.db.select().from(vehicles)).toHaveLength(1);
  });
});

describe('locations writer', () => {
  it('stores a position with both clocks', async () => {
    const receivedAt = new Date();
    const recordedAt = new Date(receivedAt.getTime() - 1_000);
    await ctx.publish([{ timestampMs: recordedAt.getTime(), gps: GPS }], { receivedAt });

    const [row] = await ctx.waitFor(countLocations, (r) => r.length === 1);
    expect(row?.latitude).toBeCloseTo(GPS.latitude, 6);
    expect(row?.longitude).toBeCloseTo(GPS.longitude, 6);
    expect(row?.speedKph).toBe(64);
    expect(row?.satellites).toBe(11);
    expect(row?.recordedAt.toISOString()).toBe(recordedAt.toISOString());
    expect(row?.receivedAt.toISOString()).toBe(receivedAt.toISOString());
  });

  it('skips records with no satellite fix', async () => {
    // A device without a fix reports zeroes; storing them would put the vehicle
    // in the Gulf of Guinea.
    await ctx.publish([{ timestampMs: Date.now() }, { timestampMs: Date.now() + 1, gps: GPS }]);

    const rows = await ctx.waitFor(countLocations, (r) => r.length === 1);
    expect(rows[0]?.latitude).toBeCloseTo(GPS.latitude, 6);
  });

  it('stores backfilled positions as well as live ones', async () => {
    const now = Date.now();
    await ctx.publish([
      { timestampMs: now - 4 * 60 * 60 * 1000, gps: GPS },
      { timestampMs: now, gps: GPS },
    ]);

    // History is worth keeping whenever it arrives, so the writers read both
    // topics — only alerting is live-only.
    await ctx.waitFor(countLocations, (r) => r.length === 2);
  });

  it('ignores a redelivered position instead of duplicating it', async () => {
    const timestampMs = Date.now();
    const events = await ctx.publish([{ timestampMs, gps: GPS }]);
    await ctx.waitFor(countLocations, (r) => r.length === 1);

    // Exactly what an at-least-once redelivery looks like.
    await ctx.publishEvents(events);
    await ctx.settle();

    expect(await countLocations()).toHaveLength(1);
  });
});

describe('fuel writer', () => {
  it('stores one row per sensor', async () => {
    await ctx.publish([
      {
        timestampMs: Date.now(),
        gps: GPS,
        io: [
          { id: AVL_ID.fuelLevelCanPct, value: 42, widthBytes: 1 },
          { id: AVL_ID.fuelLevelCanLiters, value: 375, widthBytes: 2 },
          { id: AVL_ID.fuelLevelLls1, value: 39, widthBytes: 2 },
        ],
      },
    ]);

    const rows = await ctx.waitFor(countFuel, (r) => r.length === 3);
    const bySource = new Map(rows.map((row) => [row.source, row]));
    expect(bySource.get('can_pct')?.levelPct).toBe(42);
    // CAN adapters report tenths of a litre.
    expect(bySource.get('can_liters')?.levelLiters).toBe('37.50');
    expect(bySource.get('lls1')?.levelPct).toBe(39);
  });

  it('writes nothing when the vehicle reports no fuel sensor', async () => {
    await ctx.publish([{ timestampMs: Date.now(), gps: GPS }]);

    await ctx.waitFor(countLocations, (r) => r.length === 1);
    expect(await countFuel()).toHaveLength(0);
  });

  it('keeps disagreeing sensors side by side rather than picking one', async () => {
    await ctx.publish([
      {
        timestampMs: Date.now(),
        io: [
          { id: AVL_ID.fuelLevelCanPct, value: 40, widthBytes: 1 },
          { id: AVL_ID.fuelLevelLls1, value: 8, widthBytes: 2 },
        ],
      },
    ]);

    const rows = await ctx.waitFor(countFuel, (r) => r.length === 2);
    expect(new Set(rows.map((row) => row.levelPct))).toEqual(new Set([40, 8]));
  });

  it('ignores a redelivered reading', async () => {
    const events = await ctx.publish([
      { timestampMs: Date.now(), io: [{ id: AVL_ID.fuelLevelCanPct, value: 30, widthBytes: 1 }] },
    ]);
    await ctx.waitFor(countFuel, (r) => r.length === 1);

    await ctx.publishEvents(events);
    await ctx.settle();

    expect(await countFuel()).toHaveLength(1);
  });
});

describe('engine writer', () => {
  it('records a transition the device explicitly reported', async () => {
    await ctx.publish([
      {
        timestampMs: Date.now(),
        eventIoId: AVL_ID.ignition,
        io: [{ id: AVL_ID.ignition, value: 1, widthBytes: 1 }],
      },
    ]);

    const rows = await ctx.waitFor(listEngine, (r) => r.length === 1);
    expect(rows[0]?.eventType).toBe('ignition_on');
  });

  it('writes one row per change, not per reading', async () => {
    const base = Date.now();
    // Periodic records with no explicit trigger: on, on, on, off.
    await ctx.publish([
      { timestampMs: base, io: [{ id: AVL_ID.ignition, value: 1, widthBytes: 1 }] },
      { timestampMs: base + 1_000, io: [{ id: AVL_ID.ignition, value: 1, widthBytes: 1 }] },
      { timestampMs: base + 2_000, io: [{ id: AVL_ID.ignition, value: 1, widthBytes: 1 }] },
      { timestampMs: base + 3_000, io: [{ id: AVL_ID.ignition, value: 0, widthBytes: 1 }] },
    ]);

    const rows = await ctx.waitFor(listEngine, (r) => r.length >= 1);
    await ctx.settle();
    const final = await listEngine();

    // The first record only establishes the state; the change to off is the
    // single event worth storing.
    expect(final.map((row) => row.eventType)).toEqual(['ignition_off']);
    expect(rows.length).toBeLessThanOrEqual(final.length);
  });

  it('tracks ignition and movement independently', async () => {
    const base = Date.now();
    await ctx.publish([
      {
        timestampMs: base,
        eventIoId: AVL_ID.ignition,
        io: [
          { id: AVL_ID.ignition, value: 1, widthBytes: 1 },
          { id: AVL_ID.movement, value: 0, widthBytes: 1 },
        ],
      },
      {
        timestampMs: base + 1_000,
        eventIoId: AVL_ID.movement,
        io: [
          { id: AVL_ID.ignition, value: 1, widthBytes: 1 },
          { id: AVL_ID.movement, value: 1, widthBytes: 1 },
        ],
      },
    ]);

    const rows = await ctx.waitFor(listEngine, (r) => r.length === 2);
    expect(rows.map((row) => row.eventType)).toEqual(['ignition_on', 'movement_start']);
  });

  it('ignores a redelivered transition', async () => {
    const events = await ctx.publish([
      {
        timestampMs: Date.now(),
        eventIoId: AVL_ID.ignition,
        io: [{ id: AVL_ID.ignition, value: 1, widthBytes: 1 }],
      },
    ]);
    await ctx.waitFor(listEngine, (r) => r.length === 1);

    await ctx.publishEvents(events);
    await ctx.settle();

    expect(await listEngine()).toHaveLength(1);
  });

  it('trusts explicit triggers on backfill but does not infer from it', async () => {
    const now = Date.now();
    await ctx.publish([
      // Backlog with an explicit trigger: self-describing, so it is trusted.
      {
        timestampMs: now - 4 * 60 * 60 * 1000,
        eventIoId: AVL_ID.ignition,
        io: [{ id: AVL_ID.ignition, value: 1, widthBytes: 1 }],
      },
      // Backlog with no trigger: comparing this against current state would
      // invent a transition that never happened.
      {
        timestampMs: now - 3 * 60 * 60 * 1000,
        io: [{ id: AVL_ID.ignition, value: 0, widthBytes: 1 }],
      },
    ]);

    const rows = await ctx.waitFor(listEngine, (r) => r.length === 1);
    await ctx.settle();

    expect(rows[0]?.eventType).toBe('ignition_on');
    expect(await listEngine()).toHaveLength(1);
  });
});

describe('outage recovery', () => {
  it('writes what it missed while it was down', async () => {
    await ctx.publish([{ timestampMs: Date.now(), gps: GPS }]);
    await ctx.waitFor(countLocations, (r) => r.length === 1);

    // Take the consumers down, committing the offsets reached so far.
    await Promise.all(Object.values(ctx.consumers).map((consumer) => consumer.stop()));

    const missedAt = Date.now() + 60_000;
    await ctx.publish([
      { timestampMs: missedAt, gps: GPS },
      { timestampMs: missedAt + 1_000, gps: GPS },
    ]);
    await ctx.settle();
    expect(await countLocations()).toHaveLength(1);

    // Restarting the same groups picks up from the committed offsets: no replay
    // script, and nothing skipped.
    await Promise.all(Object.values(ctx.consumers).map((consumer) => consumer.start()));
    await ctx.waitFor(countLocations, (r) => r.length === 3);
  });
});
