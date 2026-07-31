import { describe, expect, it } from 'vitest';

import { parseAvlPacket } from '../src/avl.js';
import { crc16ibm } from '../src/crc.js';
import { TeltonikaParseError } from '../src/errors.js';
import { encodeAvlFrame } from '../src/testing.js';
import { CODEC8E_SINGLE_RECORD_DATA_HEX, CODEC8_SINGLE_RECORD_HEX } from './fixtures.js';

/** Wraps a captured data field in a header and a freshly computed CRC. */
function frameFromDataField(dataHex: string): Buffer {
  const dataField = Buffer.from(dataHex, 'hex');
  const header = Buffer.alloc(8);
  header.writeUInt32BE(0, 0);
  header.writeUInt32BE(dataField.length, 4);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc16ibm(dataField), 0);
  return Buffer.concat([header, dataField, crc]);
}

describe('parseAvlPacket — real device output', () => {
  it('decodes the captured Codec 8 packet field by field', () => {
    const packet = parseAvlPacket(Buffer.from(CODEC8_SINGLE_RECORD_HEX, 'hex'));

    expect(packet.crcOk).toBe(true);
    if (!packet.crcOk) return;
    expect(packet.codec).toBe('codec8');
    expect(packet.records).toHaveLength(1);

    const [record] = packet.records;
    expect(record).toBeDefined();
    if (!record) return;

    expect(new Date(record.timestampMs).toISOString()).toBe('2019-06-10T10:04:46.000Z');
    expect(record.priority).toBe(1);
    expect(record.eventIoId).toBe(1);
    // No fix: the device sent an all-zero GPS element.
    expect(record.gps.valid).toBe(false);
    expect(record.gps.satellites).toBe(0);
    expect(record.gps.latitude).toBe(0);
    expect(record.gps.longitude).toBe(0);
    // One element of each width: 21=1B, 66=2B, 241=4B, 78=8B (plus 1=1B).
    expect(Object.fromEntries([...record.io].map(([id, v]) => [id, v.toString()]))).toEqual({
      1: '1',
      21: '3',
      66: '24079',
      78: '0',
      241: '24602',
    });
    expect(record.ioVariable.size).toBe(0);
  });

  it('decodes the captured Codec 8 Extended data field with its wider ids', () => {
    const packet = parseAvlPacket(frameFromDataField(CODEC8E_SINGLE_RECORD_DATA_HEX));

    expect(packet.crcOk).toBe(true);
    if (!packet.crcOk) return;
    expect(packet.codec).toBe('codec8e');
    expect(packet.records).toHaveLength(1);

    const [record] = packet.records;
    expect(record).toBeDefined();
    if (!record) return;

    expect(new Date(record.timestampMs).toISOString()).toBe('2019-06-10T11:36:32.000Z');
    expect(record.eventIoId).toBe(1);
    expect(record.gps.valid).toBe(false);
    // Five elements across all four widths, and an empty variable section —
    // this is what pins the two-byte id/count widening of Codec 8E.
    expect(Object.fromEntries([...record.io].map(([id, v]) => [id, v.toString()]))).toEqual({
      1: '1',
      11: '893700218',
      14: '500686954',
      16: '22949000',
      17: '29',
    });
    expect(record.ioVariable.size).toBe(0);
  });
});

describe('parseAvlPacket — round trips', () => {
  it('preserves a decoded GPS element', () => {
    const frame = encodeAvlFrame([
      {
        timestampMs: 1_700_000_000_000,
        priority: 2,
        gps: {
          latitude: 54.712345,
          longitude: 25.279652,
          altitudeM: 143,
          angleDeg: 271,
          satellites: 11,
          speedKph: 64,
        },
        eventIoId: 239,
        io: [{ id: 239, value: 1, widthBytes: 1 }],
      },
    ]);

    const packet = parseAvlPacket(frame);
    expect(packet.crcOk).toBe(true);
    if (!packet.crcOk) return;

    const [record] = packet.records;
    expect(record).toBeDefined();
    if (!record) return;

    expect(record.timestampMs).toBe(1_700_000_000_000);
    expect(record.priority).toBe(2);
    expect(record.gps.valid).toBe(true);
    expect(record.gps.latitude).toBeCloseTo(54.712345, 6);
    expect(record.gps.longitude).toBeCloseTo(25.279652, 6);
    expect(record.gps.altitudeM).toBe(143);
    expect(record.gps.angleDeg).toBe(271);
    expect(record.gps.satellites).toBe(11);
    expect(record.gps.speedKph).toBe(64);
  });

  it('preserves negative coordinates', () => {
    const frame = encodeAvlFrame([
      {
        timestampMs: 1_700_000_000_000,
        gps: {
          latitude: -33.918861,
          longitude: -70.60271,
          altitudeM: -12,
          angleDeg: 0,
          satellites: 9,
          speedKph: 0,
        },
      },
    ]);

    const packet = parseAvlPacket(frame);
    if (!packet.crcOk) throw new Error('expected a valid CRC');
    const [record] = packet.records;
    if (!record) throw new Error('expected one record');

    expect(record.gps.latitude).toBeCloseTo(-33.918861, 6);
    expect(record.gps.longitude).toBeCloseTo(-70.60271, 6);
    expect(record.gps.altitudeM).toBe(-12);
  });

  it('decodes every IO width, including full 64-bit values', () => {
    const frame = encodeAvlFrame([
      {
        timestampMs: 1_700_000_000_000,
        io: [
          { id: 1, value: 0xff, widthBytes: 1 },
          { id: 2, value: 0xffff, widthBytes: 2 },
          { id: 3, value: 0xffffffff, widthBytes: 4 },
          { id: 4, value: 0xffffffffffffffffn, widthBytes: 8 },
        ],
      },
    ]);

    const packet = parseAvlPacket(frame);
    if (!packet.crcOk) throw new Error('expected a valid CRC');
    const [record] = packet.records;
    if (!record) throw new Error('expected one record');

    expect(record.io.get(1)).toBe(255n);
    expect(record.io.get(2)).toBe(65535n);
    expect(record.io.get(3)).toBe(4294967295n);
    expect(record.io.get(4)).toBe(18446744073709551615n);
  });

  it('decodes multiple records in one packet', () => {
    const frame = encodeAvlFrame([
      { timestampMs: 1_700_000_000_000, io: [{ id: 239, value: 1, widthBytes: 1 }] },
      { timestampMs: 1_700_000_060_000, io: [{ id: 239, value: 0, widthBytes: 1 }] },
      { timestampMs: 1_700_000_120_000, io: [{ id: 240, value: 1, widthBytes: 1 }] },
    ]);

    const packet = parseAvlPacket(frame);
    if (!packet.crcOk) throw new Error('expected a valid CRC');

    expect(packet.records.map((r) => r.timestampMs)).toEqual([
      1_700_000_000_000, 1_700_000_060_000, 1_700_000_120_000,
    ]);
  });

  it('decodes Codec 8E variable-length IO elements', () => {
    const frame = encodeAvlFrame(
      [
        {
          timestampMs: 1_700_000_000_000,
          eventIoId: 385,
          io: [{ id: 300, value: 7, widthBytes: 2 }],
          ioVariable: [
            { id: 10_800, value: Buffer.from('deadbeef', 'hex') },
            { id: 10_801, value: Buffer.alloc(0) },
          ],
        },
      ],
      { codec: 'codec8e' },
    );

    const packet = parseAvlPacket(frame);
    if (!packet.crcOk) throw new Error('expected a valid CRC');
    expect(packet.codec).toBe('codec8e');

    const [record] = packet.records;
    if (!record) throw new Error('expected one record');

    // Ids above 255 only fit because Codec 8E widens id fields to two bytes.
    expect(record.eventIoId).toBe(385);
    expect(record.io.get(300)).toBe(7n);
    expect(record.ioVariable.get(10_800)?.toString('hex')).toBe('deadbeef');
    expect(record.ioVariable.get(10_801)?.length).toBe(0);
  });

  it('does not keep the frame buffer alive through variable IO values', () => {
    const frame = encodeAvlFrame(
      [
        {
          timestampMs: 1_700_000_000_000,
          ioVariable: [{ id: 1, value: Buffer.from('0102', 'hex') }],
        },
      ],
      { codec: 'codec8e' },
    );

    const packet = parseAvlPacket(frame);
    if (!packet.crcOk) throw new Error('expected a valid CRC');
    const value = packet.records[0]?.ioVariable.get(1);
    frame.fill(0);

    expect(value?.toString('hex')).toBe('0102');
  });

  it('decodes a packet with no records', () => {
    const packet = parseAvlPacket(encodeAvlFrame([]));
    if (!packet.crcOk) throw new Error('expected a valid CRC');
    expect(packet.records).toEqual([]);
  });
});

describe('parseAvlPacket — rejections', () => {
  it('reports a CRC mismatch instead of throwing', () => {
    const frame = encodeAvlFrame([{ timestampMs: 1_700_000_000_000 }], { crcOverride: 0x1234 });
    const packet = parseAvlPacket(frame);

    expect(packet.crcOk).toBe(false);
    if (packet.crcOk) return;
    expect(packet.declaredCrc).toBe(0x1234);
    expect(packet.computedCrc).not.toBe(0x1234);
  });

  it('does not interpret the body of a corrupted packet', () => {
    // A wrong CRC must short-circuit before the codec byte is trusted.
    const frame = encodeAvlFrame([{ timestampMs: 1_700_000_000_000 }], { crcOverride: 0 });
    frame.writeUInt8(0x99, 8);

    expect(parseAvlPacket(frame).crcOk).toBe(false);
  });

  it('rejects a non-zero preamble', () => {
    const frame = encodeAvlFrame([{ timestampMs: 1 }], { preambleOverride: 1 });
    expect(() => parseAvlPacket(frame)).toThrow(TeltonikaParseError);
    expect(() => parseAvlPacket(frame)).toThrow(/preamble/);
  });

  it('rejects an unknown codec', () => {
    const frame = encodeAvlFrame([{ timestampMs: 1 }]);
    const dataField = frame.subarray(8, frame.length - 4);
    dataField.writeUInt8(0x07, 0);
    frame.writeUInt32BE(crc16ibm(dataField), frame.length - 4);

    expect(() => parseAvlPacket(frame)).toThrow(/unsupported codec id 0x07/);
  });

  it('rejects a trailing record count that disagrees with the header', () => {
    const frame = encodeAvlFrame([{ timestampMs: 1 }], { trailingCountOverride: 9 });
    expect(() => parseAvlPacket(frame)).toThrow(/record count mismatch/);
  });

  it('rejects a data field shorter than its declared length', () => {
    const frame = encodeAvlFrame([{ timestampMs: 1 }], { dataLengthOverride: 4096 });
    expect(() => parseAvlPacket(frame)).toThrow(/data field/);
  });

  it('rejects a frame truncated mid-record', () => {
    const full = encodeAvlFrame([{ timestampMs: 1_700_000_000_000 }]);
    // Keep the header (so the declared length is read) but cut the body.
    const truncated = full.subarray(0, full.length - 6);
    expect(() => parseAvlPacket(truncated)).toThrow(TeltonikaParseError);
  });

  it('rejects an empty buffer', () => {
    expect(() => parseAvlPacket(Buffer.alloc(0))).toThrow(TeltonikaParseError);
  });
});
