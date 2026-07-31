export { buildImeiAck, buildRecordAck } from './ack.js';
export {
  parseAvlPacket,
  FRAME_CRC_BYTES,
  FRAME_HEADER_BYTES,
  type AvlPacket,
  type AvlRecord,
  type CodecId,
  type GpsElement,
} from './avl.js';
export { crc16ibm } from './crc.js';
export { TeltonikaParseError } from './errors.js';
export { TeltonikaFramer, type FramerErrorReason, type FramerEvent } from './framer.js';
export { isValidImei, tryParseImeiFrame, type ImeiFrameResult } from './imei.js';
export { AVL_ID, FUEL_LITERS_SCALE, FUEL_SOURCES, type FuelSource } from './io-map.js';
export {
  normalizeRecord,
  type FuelReading,
  type NormalizedGps,
  type TelemetryPayload,
} from './normalize.js';
