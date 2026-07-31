import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, id, seq } from '@bank/db-kit';

/**
 * Telemetry from the Teltonika devices fitted to cash-in-transit vehicles.
 *
 * Two clocks are stored on every reading. `recordedAt` is the device clock —
 * what the vehicle was doing. `receivedAt` is ours — when we heard about it.
 * They diverge whenever a vehicle drives out of coverage and later flushes its
 * buffer, which is normal and expected, so nothing may assume they are close.
 *
 * Ingestion is at-least-once: Kafka can redeliver, and a device resends
 * anything we failed to acknowledge. Every reading table therefore carries a
 * unique index over its natural key so writers can insert with
 * `onConflictDoNothing` and a replay becomes a no-op instead of a duplicate.
 */

/** Vehicles are registered on first contact, keyed by the device IMEI. */
export const vehicles = pgTable(
  'vehicles',
  {
    id: id(),
    seq: seq(),
    imei: text('imei').notNull(),
    /** Fleet-facing name, filled in by an operator after auto-registration. */
    label: text('label'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('vehicles_imei_uq').on(table.imei),
    check('vehicles_imei_digits', sql`${table.imei} ~ '^[0-9]{15}$'`),
  ],
);

export const vehicleLocations = pgTable(
  'vehicle_locations',
  {
    id: id(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    altitudeM: integer('altitude_m').notNull(),
    angleDeg: integer('angle_deg').notNull(),
    satellites: smallint('satellites').notNull(),
    speedKph: integer('speed_kph').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    // One position per vehicle per device timestamp: the dedup key for
    // replays, and — being a btree on (vehicle_id, recorded_at) — also the
    // index that serves "where is it now" and history windows, so no separate
    // read index is needed. Once this table outgrows btree, the scaling lever
    // is partitioning or BRIN on recorded_at.
    uniqueIndex('vehicle_locations_dedup_uq').on(table.vehicleId, table.recordedAt),
    check(
      'vehicle_locations_coordinates_in_range',
      sql`${table.latitude} between -90 and 90 and ${table.longitude} between -180 and 180`,
    ),
  ],
);

/**
 * Which sensor a fuel reading came from. A vehicle may report several at once
 * (a CAN percentage plus a tank sensor), so readings are stored per source
 * rather than reconciled into one number. Mirrors `FUEL_SOURCES` in
 * `@bank/teltonika` — the fuel writer's insert fails to typecheck if they drift.
 */
export const fuelSource = pgEnum('fuel_source', [
  'can_pct',
  'can_liters',
  'obd_pct',
  'lls1',
  'lls2',
]);

export const vehicleFuelReadings = pgTable(
  'vehicle_fuel_readings',
  {
    id: id(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    source: fuelSource('source').notNull(),
    /** Percent full, when the source reports a percentage. */
    levelPct: integer('level_pct'),
    /** Litres in the tank, when the source reports a volume. */
    levelLiters: numeric('level_liters', { precision: 8, scale: 2 }),
    createdAt: createdAt(),
  },
  (table) => [
    // Its (vehicle_id, recorded_at) prefix also serves history queries.
    uniqueIndex('vehicle_fuel_readings_dedup_uq').on(
      table.vehicleId,
      table.recordedAt,
      table.source,
    ),
    check(
      'vehicle_fuel_readings_has_a_value',
      sql`${table.levelPct} is not null or ${table.levelLiters} is not null`,
    ),
    check(
      'vehicle_fuel_readings_pct_in_range',
      sql`${table.levelPct} is null or ${table.levelPct} between 0 and 100`,
    ),
  ],
);

export const engineEventType = pgEnum('engine_event_type', [
  'ignition_on',
  'ignition_off',
  'movement_start',
  'movement_stop',
]);

/** Ignition and movement transitions, one row per state change. */
export const vehicleEngineEvents = pgTable(
  'vehicle_engine_events',
  {
    id: id(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    eventType: engineEventType('event_type').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    // Its (vehicle_id, recorded_at) prefix also serves history queries, and
    // the engine writer's "last known state" seed query.
    uniqueIndex('vehicle_engine_events_dedup_uq').on(
      table.vehicleId,
      table.recordedAt,
      table.eventType,
    ),
  ],
);

/** Circular zones a vehicle is expected to stay inside. */
export const geofences = pgTable(
  'geofences',
  {
    id: id(),
    seq: seq(),
    name: text('name').notNull(),
    centerLatitude: doublePrecision('center_latitude').notNull(),
    centerLongitude: doublePrecision('center_longitude').notNull(),
    radiusM: integer('radius_m').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [
    index('geofences_active_idx').on(table.active),
    check('geofences_radius_positive', sql`${table.radiusM} > 0`),
    check(
      'geofences_center_in_range',
      sql`${table.centerLatitude} between -90 and 90 and ${table.centerLongitude} between -180 and 180`,
    ),
  ],
);

export const vehicleAlertType = pgEnum('vehicle_alert_type', [
  'low_fuel',
  'geofence_exit',
  'speeding',
]);

/** One row per time a condition started holding, not per offending reading. */
export const vehicleAlerts = pgTable(
  'vehicle_alerts',
  {
    id: id(),
    seq: seq(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    alertType: vehicleAlertType('alert_type').notNull(),
    /** Device clock of the reading that tripped the rule. */
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    /** Threshold, observed value, geofence — whatever the rule matched on. */
    details: jsonb('details').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('vehicle_alerts_vehicle_seq_idx').on(table.vehicleId, table.seq),
    index('vehicle_alerts_type_seq_idx').on(table.alertType, table.seq),
  ],
);

/**
 * Whether each alert condition is currently holding for a vehicle. The
 * alerting consumer edge-triggers off this: an alert fires when a condition
 * turns on, not on every reading while it stays on.
 */
export const vehicleAlertStates = pgTable(
  'vehicle_alert_states',
  {
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    alertType: vehicleAlertType('alert_type').notNull(),
    active: boolean('active').notNull(),
    lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.vehicleId, table.alertType] })],
);
