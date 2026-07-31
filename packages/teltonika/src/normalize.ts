import type { AvlRecord } from './avl.js';
import { AVL_ID, FUEL_LITERS_SCALE } from './io-map.js';
import type { FuelSource } from './io-map.js';

export interface NormalizedGps {
  latitude: number;
  longitude: number;
  altitudeM: number;
  angleDeg: number;
  satellites: number;
  speedKph: number;
}

export interface FuelReading {
  source: FuelSource;
  /** Percent full, when the source reports a percentage. */
  pct?: number;
  /** Litres in the tank, when the source reports a volume. */
  liters?: number;
}

/**
 * One AVL record with the ids this pipeline knows about pulled out into named
 * fields. Transport concerns (topic, dedup key, schema version) are added on
 * top of this by `@bank/events`.
 */
export interface TelemetryPayload {
  imei: string;
  /** Device clock. */
  recordedAt: Date;
  /** Our clock when the packet arrived — the two differ for buffered data. */
  receivedAt: Date;
  priority: number;
  eventIoId: number;
  /** Null when the device had no satellite fix. */
  gps: NormalizedGps | null;
  ignition?: boolean;
  movement?: boolean;
  fuel: FuelReading[];
  externalVoltageMv?: number;
  batteryVoltageMv?: number;
  odometerM?: number;
  /** Every fixed-width IO element as a decimal string, keyed by AVL id. */
  rawIo: Record<string, string>;
  /** Every variable-length (Codec 8E) IO element as hex, keyed by AVL id. */
  rawIoVariable: Record<string, string>;
}

function readNumber(io: Map<number, bigint>, avlId: number): number | undefined {
  const value = io.get(avlId);
  return value === undefined ? undefined : Number(value);
}

function readBoolean(io: Map<number, bigint>, avlId: number): boolean | undefined {
  const value = io.get(avlId);
  return value === undefined ? undefined : value !== 0n;
}

function readFuel(io: Map<number, bigint>): FuelReading[] {
  const readings: FuelReading[] = [];

  const canPct = readNumber(io, AVL_ID.fuelLevelCanPct);
  if (canPct !== undefined) readings.push({ source: 'can_pct', pct: canPct });

  const canLiters = readNumber(io, AVL_ID.fuelLevelCanLiters);
  if (canLiters !== undefined) {
    readings.push({ source: 'can_liters', liters: canLiters * FUEL_LITERS_SCALE });
  }

  const obdPct = readNumber(io, AVL_ID.fuelLevelObdPct);
  if (obdPct !== undefined) readings.push({ source: 'obd_pct', pct: obdPct });

  // LLS tank sensors report a level percentage once calibrated to the tank.
  const lls1 = readNumber(io, AVL_ID.fuelLevelLls1);
  if (lls1 !== undefined) readings.push({ source: 'lls1', pct: lls1 });

  const lls2 = readNumber(io, AVL_ID.fuelLevelLls2);
  if (lls2 !== undefined) readings.push({ source: 'lls2', pct: lls2 });

  return readings;
}

export function normalizeRecord(
  imei: string,
  record: AvlRecord,
  receivedAt: Date,
): TelemetryPayload {
  const rawIo: Record<string, string> = {};
  for (const [avlId, value] of record.io) {
    rawIo[String(avlId)] = value.toString(10);
  }

  const rawIoVariable: Record<string, string> = {};
  for (const [avlId, value] of record.ioVariable) {
    rawIoVariable[String(avlId)] = value.toString('hex');
  }

  const { gps } = record;

  return {
    imei,
    recordedAt: new Date(record.timestampMs),
    receivedAt,
    priority: record.priority,
    eventIoId: record.eventIoId,
    gps: gps.valid
      ? {
          latitude: gps.latitude,
          longitude: gps.longitude,
          altitudeM: gps.altitudeM,
          angleDeg: gps.angleDeg,
          satellites: gps.satellites,
          speedKph: gps.speedKph,
        }
      : null,
    ignition: readBoolean(record.io, AVL_ID.ignition),
    movement: readBoolean(record.io, AVL_ID.movement),
    fuel: readFuel(record.io),
    externalVoltageMv: readNumber(record.io, AVL_ID.externalVoltage),
    batteryVoltageMv: readNumber(record.io, AVL_ID.batteryVoltage),
    odometerM: readNumber(record.io, AVL_ID.totalOdometer),
    rawIo,
    rawIoVariable,
  };
}
