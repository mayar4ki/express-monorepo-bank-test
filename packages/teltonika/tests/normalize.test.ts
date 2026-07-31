import { describe, expect, it } from 'vitest';

import { parseAvlPacket } from '../src/avl.js';
import type { AvlRecord } from '../src/avl.js';
import { AVL_ID } from '../src/io-map.js';
import { normalizeRecord } from '../src/normalize.js';
import { encodeAvlFrame } from '../src/testing.js';
import type { EncodableRecord } from '../src/testing.js';

const IMEI = '356938035643809';
const RECEIVED_AT = new Date('2026-07-31T12:00:00.000Z');

/** Encodes then decodes one record, so tests exercise the real wire format. */
function decode(record: EncodableRecord, codec: 'codec8' | 'codec8e' = 'codec8'): AvlRecord {
  const packet = parseAvlPacket(encodeAvlFrame([record], { codec }));
  if (!packet.crcOk) throw new Error('expected a valid CRC');
  const [decoded] = packet.records;
  if (!decoded) throw new Error('expected one record');
  return decoded;
}

const FIXED_GPS = {
  latitude: 54.712345,
  longitude: 25.279652,
  altitudeM: 143,
  angleDeg: 271,
  satellites: 11,
  speedKph: 64,
};

describe('normalizeRecord', () => {
  it('carries both clocks so buffered data can be told apart from live', () => {
    const payload = normalizeRecord(
      IMEI,
      decode({ timestampMs: Date.parse('2026-07-31T09:30:00.000Z') }),
      RECEIVED_AT,
    );

    expect(payload.imei).toBe(IMEI);
    expect(payload.recordedAt.toISOString()).toBe('2026-07-31T09:30:00.000Z');
    expect(payload.receivedAt).toBe(RECEIVED_AT);
  });

  it('keeps a GPS element that had a fix', () => {
    const payload = normalizeRecord(
      IMEI,
      decode({ timestampMs: 1_700_000_000_000, gps: FIXED_GPS }),
      RECEIVED_AT,
    );

    expect(payload.gps).not.toBeNull();
    expect(payload.gps?.latitude).toBeCloseTo(FIXED_GPS.latitude, 6);
    expect(payload.gps?.longitude).toBeCloseTo(FIXED_GPS.longitude, 6);
    expect(payload.gps?.satellites).toBe(11);
    expect(payload.gps?.speedKph).toBe(64);
  });

  it('drops coordinates when the device had no fix', () => {
    // Without satellites the device sends zeroes, which would otherwise be
    // stored as a position off the coast of Africa.
    const payload = normalizeRecord(IMEI, decode({ timestampMs: 1_700_000_000_000 }), RECEIVED_AT);

    expect(payload.gps).toBeNull();
  });

  it('reads ignition and movement as booleans', () => {
    const on = normalizeRecord(
      IMEI,
      decode({
        timestampMs: 1,
        io: [
          { id: AVL_ID.ignition, value: 1, widthBytes: 1 },
          { id: AVL_ID.movement, value: 1, widthBytes: 1 },
        ],
      }),
      RECEIVED_AT,
    );
    expect(on.ignition).toBe(true);
    expect(on.movement).toBe(true);

    const off = normalizeRecord(
      IMEI,
      decode({
        timestampMs: 1,
        io: [
          { id: AVL_ID.ignition, value: 0, widthBytes: 1 },
          { id: AVL_ID.movement, value: 0, widthBytes: 1 },
        ],
      }),
      RECEIVED_AT,
    );
    expect(off.ignition).toBe(false);
    expect(off.movement).toBe(false);
  });

  it('leaves ignition and movement undefined when the device does not report them', () => {
    const payload = normalizeRecord(IMEI, decode({ timestampMs: 1 }), RECEIVED_AT);

    expect(payload.ignition).toBeUndefined();
    expect(payload.movement).toBeUndefined();
  });

  it('collects every fuel source the vehicle reports', () => {
    const payload = normalizeRecord(
      IMEI,
      decode({
        timestampMs: 1,
        io: [
          { id: AVL_ID.fuelLevelCanPct, value: 42, widthBytes: 1 },
          { id: AVL_ID.fuelLevelCanLiters, value: 375, widthBytes: 2 },
          { id: AVL_ID.fuelLevelObdPct, value: 41, widthBytes: 1 },
          { id: AVL_ID.fuelLevelLls1, value: 39, widthBytes: 2 },
          { id: AVL_ID.fuelLevelLls2, value: 38, widthBytes: 2 },
        ],
      }),
      RECEIVED_AT,
    );

    expect(payload.fuel).toEqual([
      { source: 'can_pct', pct: 42 },
      // CAN adapters report tenths of a litre.
      { source: 'can_liters', liters: 37.5 },
      { source: 'obd_pct', pct: 41 },
      { source: 'lls1', pct: 39 },
      { source: 'lls2', pct: 38 },
    ]);
  });

  it('reports no fuel readings when no fuel id is present', () => {
    const payload = normalizeRecord(IMEI, decode({ timestampMs: 1 }), RECEIVED_AT);
    expect(payload.fuel).toEqual([]);
  });

  it('reads voltages and the odometer', () => {
    const payload = normalizeRecord(
      IMEI,
      decode({
        timestampMs: 1,
        io: [
          { id: AVL_ID.externalVoltage, value: 24079, widthBytes: 2 },
          { id: AVL_ID.batteryVoltage, value: 4012, widthBytes: 2 },
          { id: AVL_ID.totalOdometer, value: 128_450_000, widthBytes: 4 },
        ],
      }),
      RECEIVED_AT,
    );

    expect(payload.externalVoltageMv).toBe(24079);
    expect(payload.batteryVoltageMv).toBe(4012);
    expect(payload.odometerM).toBe(128_450_000);
  });

  it('keeps every IO element in rawIo so unmapped ids are never lost', () => {
    const payload = normalizeRecord(
      IMEI,
      decode({
        timestampMs: 1,
        eventIoId: AVL_ID.ignition,
        io: [
          { id: AVL_ID.ignition, value: 1, widthBytes: 1 },
          // Not in AVL_ID: must still survive the trip to Kafka.
          { id: 253, value: 2, widthBytes: 1 },
          { id: 78, value: 0xffffffffffffffffn, widthBytes: 8 },
        ],
      }),
      RECEIVED_AT,
    );

    expect(payload.eventIoId).toBe(AVL_ID.ignition);
    expect(payload.rawIo).toEqual({
      239: '1',
      253: '2',
      // Decimal strings keep 64-bit values exact through JSON.
      78: '18446744073709551615',
    });
  });

  it('hex-encodes Codec 8E variable-length elements', () => {
    const payload = normalizeRecord(
      IMEI,
      decode(
        {
          timestampMs: 1,
          ioVariable: [{ id: 10_800, value: Buffer.from('cafe01', 'hex') }],
        },
        'codec8e',
      ),
      RECEIVED_AT,
    );

    expect(payload.rawIoVariable).toEqual({ 10800: 'cafe01' });
  });

  it('survives JSON round-tripping, which is how it reaches Kafka', () => {
    const payload = normalizeRecord(
      IMEI,
      decode({
        timestampMs: 1_700_000_000_000,
        gps: FIXED_GPS,
        io: [{ id: 78, value: 0xffffffffffffffffn, widthBytes: 8 }],
      }),
      RECEIVED_AT,
    );

    expect(() => JSON.stringify(payload)).not.toThrow();
    expect(JSON.parse(JSON.stringify(payload)).rawIo['78']).toBe('18446744073709551615');
  });
});
