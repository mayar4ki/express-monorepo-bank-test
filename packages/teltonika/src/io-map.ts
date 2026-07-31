/**
 * The AVL ids this pipeline understands. Ids are a device-configuration
 * concern: a vehicle only reports what its firmware profile enables, and the
 * fuel ids in particular depend on whether a CAN adapter, OBD, or an LLS
 * sensor is fitted. Everything not listed here still reaches Kafka in the
 * event's `rawIo`, so a new rule never needs a device reconfiguration.
 *
 * Reference: Teltonika FMB/FMC AVL id list.
 */
export const AVL_ID = {
  /** Total odometer, metres. */
  totalOdometer: 16,
  /** GSM signal strength, 1-5. */
  gsmSignal: 21,
  /** Fuel level from OBD, percent. */
  fuelLevelObdPct: 48,
  /** External (vehicle) power, millivolts. */
  externalVoltage: 66,
  /** Internal battery, millivolts. */
  batteryVoltage: 67,
  /** Fuel level from a CAN adapter, in tenths of a litre. */
  fuelLevelCanLiters: 84,
  /** Fuel level from a CAN adapter, percent. */
  fuelLevelCanPct: 89,
  /** Position dilution of precision, tenths. */
  pdop: 181,
  /** Horizontal dilution of precision, tenths. */
  hdop: 182,
  /** Trip odometer, metres. */
  tripOdometer: 199,
  /** LLS sensor 1 fuel level. */
  fuelLevelLls1: 201,
  /** LLS sensor 2 fuel level. */
  fuelLevelLls2: 203,
  /** Ignition state, 0 or 1. */
  ignition: 239,
  /** Movement state, 0 or 1. */
  movement: 240,
} as const;

/**
 * Where a fuel reading came from. A vehicle can report several at once (a CAN
 * percentage plus a tank sensor), so readings are kept per source rather than
 * collapsed into one number. Mirrored by the `fuel_source` Postgres enum in
 * `@bank/db`.
 */
export const FUEL_SOURCES = ['can_pct', 'can_liters', 'obd_pct', 'lls1', 'lls2'] as const;

export type FuelSource = (typeof FUEL_SOURCES)[number];

/** CAN adapters report litres in tenths. */
export const FUEL_LITERS_SCALE = 0.1;
