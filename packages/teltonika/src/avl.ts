import { crc16ibm } from './crc.js';
import { Cursor } from './cursor.js';
import { TeltonikaParseError } from './errors.js';

const CODEC_8 = 0x08;
const CODEC_8_EXTENDED = 0x8e;

/** Zero preamble (4 bytes) + data field length (4 bytes). */
export const FRAME_HEADER_BYTES = 8;
/** Trailing CRC-16, zero-padded to 4 bytes. */
export const FRAME_CRC_BYTES = 4;

/** Coordinates arrive as int32 in units of 1e-7 degrees. */
const COORDINATE_SCALE = 1e-7;

export type CodecId = 'codec8' | 'codec8e';

export interface GpsElement {
  longitude: number;
  latitude: number;
  altitudeM: number;
  angleDeg: number;
  satellites: number;
  speedKph: number;
  /** False when the device had no fix — coordinates are then meaningless zeros. */
  valid: boolean;
}

export interface AvlRecord {
  /** Device clock, milliseconds since the Unix epoch. */
  timestampMs: number;
  priority: number;
  gps: GpsElement;
  /** AVL id that triggered this record, or 0 for a periodic one. */
  eventIoId: number;
  /** Fixed-width IO elements (1/2/4/8 byte) as unsigned values, keyed by AVL id. */
  io: Map<number, bigint>;
  /** Codec 8E variable-length IO elements, keyed by AVL id. */
  ioVariable: Map<number, Buffer>;
}

/**
 * A decoded AVL packet. The CRC verdict is part of the type so callers cannot
 * forget to handle it: on `crcOk: false` there are no trustworthy records and
 * the device must be asked to resend.
 */
export type AvlPacket =
  | { crcOk: true; codec: CodecId; records: AvlRecord[] }
  | { crcOk: false; declaredCrc: number; computedCrc: number };

function toCodecId(byte: number): CodecId {
  if (byte === CODEC_8) return 'codec8';
  if (byte === CODEC_8_EXTENDED) return 'codec8e';
  throw new TeltonikaParseError(`unsupported codec id 0x${byte.toString(16).padStart(2, '0')}`);
}

function readIoValue(cursor: Cursor, widthBytes: 1 | 2 | 4 | 8): bigint {
  switch (widthBytes) {
    case 1:
      return BigInt(cursor.u8('io value'));
    case 2:
      return BigInt(cursor.u16('io value'));
    case 4:
      return BigInt(cursor.u32('io value'));
    case 8:
      return cursor.u64('io value');
  }
}

function readRecord(cursor: Cursor, extended: boolean): AvlRecord {
  const timestampMs = Number(cursor.u64('record timestamp'));
  const priority = cursor.u8('record priority');

  // Read sequentially into locals: the wire order is fixed and must not be
  // accidentally rearranged by reordering an object literal.
  const longitude = cursor.i32('gps longitude');
  const latitude = cursor.i32('gps latitude');
  const altitudeM = cursor.i16('gps altitude');
  const angleDeg = cursor.u16('gps angle');
  const satellites = cursor.u8('gps satellites');
  const speedKph = cursor.u16('gps speed');

  // Codec 8E widens every id and count field from one byte to two.
  const readId = (field: string) => (extended ? cursor.u16(field) : cursor.u8(field));
  const readCount = (field: string) => (extended ? cursor.u16(field) : cursor.u8(field));

  const eventIoId = readId('event io id');
  // Total IO count is redundant with the per-width counts below, and some
  // firmwares compute it differently — trust the per-width counts instead.
  readCount('total io count');

  const io = new Map<number, bigint>();
  for (const widthBytes of [1, 2, 4, 8] as const) {
    const count = readCount(`${widthBytes}-byte io count`);
    for (let i = 0; i < count; i += 1) {
      const avlId = readId(`${widthBytes}-byte io id`);
      io.set(avlId, readIoValue(cursor, widthBytes));
    }
  }

  const ioVariable = new Map<number, Buffer>();
  if (extended) {
    const count = readCount('variable io count');
    for (let i = 0; i < count; i += 1) {
      const avlId = cursor.u16('variable io id');
      const length = cursor.u16('variable io length');
      ioVariable.set(avlId, cursor.bytes(length, 'variable io value'));
    }
  }

  return {
    timestampMs,
    priority,
    gps: {
      longitude: longitude * COORDINATE_SCALE,
      latitude: latitude * COORDINATE_SCALE,
      altitudeM,
      angleDeg,
      satellites,
      speedKph,
      valid: satellites > 0,
    },
    eventIoId,
    io,
    ioVariable,
  };
}

/**
 * Decodes one complete AVL frame: preamble, length, data field, CRC.
 * `frame` must be exactly one frame — use {@link TeltonikaFramer} to carve
 * frames out of a TCP stream.
 */
export function parseAvlPacket(frame: Buffer): AvlPacket {
  const header = new Cursor(frame);
  const preamble = header.u32('preamble');
  if (preamble !== 0) {
    throw new TeltonikaParseError(`preamble 0x${preamble.toString(16)} is not zero`);
  }

  const dataLength = header.u32('data field length');
  const dataStart = header.offset;
  const crcStart = dataStart + dataLength;
  if (frame.length < crcStart + FRAME_CRC_BYTES) {
    throw new TeltonikaParseError(
      `frame declares a ${dataLength}-byte data field but only ${frame.length - dataStart} byte(s) follow the header`,
    );
  }

  const dataField = frame.subarray(dataStart, crcStart);
  const declaredCrc = frame.readUInt32BE(crcStart);
  const computedCrc = crc16ibm(dataField);
  if (declaredCrc !== computedCrc) {
    // Corrupted in transit — the bytes below cannot be trusted, so do not
    // even try to interpret them.
    return { crcOk: false, declaredCrc, computedCrc };
  }

  const data = new Cursor(dataField);
  const codec = toCodecId(data.u8('codec id'));
  const declaredCount = data.u8('record count');

  const records: AvlRecord[] = [];
  for (let i = 0; i < declaredCount; i += 1) {
    records.push(readRecord(data, codec === 'codec8e'));
  }

  const trailingCount = data.u8('trailing record count');
  if (trailingCount !== declaredCount) {
    throw new TeltonikaParseError(
      `record count mismatch: header says ${declaredCount}, trailer says ${trailingCount}`,
    );
  }

  return { crcOk: true, codec, records };
}
