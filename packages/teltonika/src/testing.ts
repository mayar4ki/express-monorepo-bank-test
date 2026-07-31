import type { CodecId } from './avl.js';
import { crc16ibm } from './crc.js';

/**
 * Frame encoder for tests and local device simulation. Hand-transcribed hex
 * fixtures are error-prone (a wrong length or CRC digit looks like a parser
 * bug), so tests build packets from this and round-trip them through
 * `parseAvlPacket`. `tests/fixtures.ts` keeps one real-device packet as the
 * ground truth that pins the encoder to actual Teltonika output.
 */

export type IoWidth = 1 | 2 | 4 | 8;

export interface EncodableIo {
  id: number;
  value: bigint | number;
  widthBytes: IoWidth;
}

export interface EncodableGps {
  latitude: number;
  longitude: number;
  altitudeM: number;
  angleDeg: number;
  satellites: number;
  speedKph: number;
}

export interface EncodableRecord {
  timestampMs: number;
  priority?: number;
  /** Omit for a record with no satellite fix (all-zero GPS element). */
  gps?: EncodableGps;
  eventIoId?: number;
  io?: EncodableIo[];
  /** Codec 8E only. */
  ioVariable?: { id: number; value: Buffer }[];
}

export interface EncodeOptions {
  codec?: CodecId;
  /** Writes a deliberately wrong CRC, to exercise the resend path. */
  crcOverride?: number;
  /** Writes a trailing record count that disagrees with the header. */
  trailingCountOverride?: number;
  /** Writes a data-field length that disagrees with the payload. */
  dataLengthOverride?: number;
  /** Writes a non-zero preamble. */
  preambleOverride?: number;
}

const COORDINATE_SCALE = 1e7;

function encodeGps(gps: EncodableGps | undefined): Buffer {
  const buf = Buffer.alloc(15);
  if (!gps) return buf;
  buf.writeInt32BE(Math.round(gps.longitude * COORDINATE_SCALE), 0);
  buf.writeInt32BE(Math.round(gps.latitude * COORDINATE_SCALE), 4);
  buf.writeInt16BE(gps.altitudeM, 8);
  buf.writeUInt16BE(gps.angleDeg, 10);
  buf.writeUInt8(gps.satellites, 12);
  buf.writeUInt16BE(gps.speedKph, 13);
  return buf;
}

function encodeIoValue(value: bigint | number, widthBytes: IoWidth): Buffer {
  const buf = Buffer.alloc(widthBytes);
  const big = BigInt(value);
  switch (widthBytes) {
    case 1:
      buf.writeUInt8(Number(big), 0);
      break;
    case 2:
      buf.writeUInt16BE(Number(big), 0);
      break;
    case 4:
      buf.writeUInt32BE(Number(big), 0);
      break;
    case 8:
      buf.writeBigUInt64BE(big, 0);
      break;
  }
  return buf;
}

function encodeRecord(record: EncodableRecord, extended: boolean): Buffer {
  const id = (value: number): Buffer => {
    const buf = Buffer.alloc(extended ? 2 : 1);
    if (extended) buf.writeUInt16BE(value, 0);
    else buf.writeUInt8(value, 0);
    return buf;
  };
  const count = id;

  const timestamp = Buffer.alloc(8);
  timestamp.writeBigUInt64BE(BigInt(record.timestampMs), 0);

  const parts: Buffer[] = [
    timestamp,
    Buffer.from([record.priority ?? 0]),
    encodeGps(record.gps),
    id(record.eventIoId ?? 0),
  ];

  const io = record.io ?? [];
  const ioVariable = record.ioVariable ?? [];
  parts.push(count(io.length + ioVariable.length));

  for (const widthBytes of [1, 2, 4, 8] as const) {
    const group = io.filter((element) => element.widthBytes === widthBytes);
    parts.push(count(group.length));
    for (const element of group) {
      parts.push(id(element.id), encodeIoValue(element.value, widthBytes));
    }
  }

  if (extended) {
    parts.push(count(ioVariable.length));
    for (const element of ioVariable) {
      const header = Buffer.alloc(4);
      header.writeUInt16BE(element.id, 0);
      header.writeUInt16BE(element.value.length, 2);
      parts.push(header, element.value);
    }
  }

  return Buffer.concat(parts);
}

/** Builds a complete AVL frame: preamble, length, data field, CRC. */
export function encodeAvlFrame(records: EncodableRecord[], options: EncodeOptions = {}): Buffer {
  const codec = options.codec ?? 'codec8';
  const extended = codec === 'codec8e';

  const dataField = Buffer.concat([
    Buffer.from([extended ? 0x8e : 0x08]),
    Buffer.from([records.length]),
    ...records.map((record) => encodeRecord(record, extended)),
    Buffer.from([options.trailingCountOverride ?? records.length]),
  ]);

  const header = Buffer.alloc(8);
  header.writeUInt32BE(options.preambleOverride ?? 0, 0);
  header.writeUInt32BE(options.dataLengthOverride ?? dataField.length, 4);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(options.crcOverride ?? crc16ibm(dataField), 0);

  return Buffer.concat([header, dataField, crc]);
}

/** Builds the opening handshake frame: uint16BE digit count + ASCII IMEI. */
export function encodeImeiFrame(imei: string): Buffer {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(imei.length, 0);
  return Buffer.concat([length, Buffer.from(imei, 'ascii')]);
}
