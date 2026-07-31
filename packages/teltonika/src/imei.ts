/** Teltonika devices always announce a 15-digit IMEI. */
const IMEI_DIGITS = 15;
const LENGTH_PREFIX_BYTES = 2;

export type ImeiFrameResult =
  | { status: 'ok'; imei: string; bytesConsumed: number }
  | { status: 'need-more' }
  | { status: 'invalid'; reason: string };

export function isValidImei(value: string): boolean {
  return new RegExp(`^\\d{${IMEI_DIGITS}}$`).test(value);
}

/**
 * Reads the opening handshake frame: a uint16BE digit count followed by the
 * IMEI as ASCII. Returns 'need-more' while the frame is still incomplete, so
 * the framer can call this again as bytes arrive.
 */
export function tryParseImeiFrame(buf: Buffer): ImeiFrameResult {
  if (buf.length < LENGTH_PREFIX_BYTES) return { status: 'need-more' };

  const declaredLength = buf.readUInt16BE(0);
  if (declaredLength !== IMEI_DIGITS) {
    return {
      status: 'invalid',
      reason: `handshake declared ${declaredLength} IMEI digits, expected ${IMEI_DIGITS}`,
    };
  }

  const frameLength = LENGTH_PREFIX_BYTES + declaredLength;
  if (buf.length < frameLength) return { status: 'need-more' };

  const imei = buf.subarray(LENGTH_PREFIX_BYTES, frameLength).toString('ascii');
  if (!isValidImei(imei)) {
    return { status: 'invalid', reason: 'IMEI is not 15 ASCII digits' };
  }

  return { status: 'ok', imei, bytesConsumed: frameLength };
}
