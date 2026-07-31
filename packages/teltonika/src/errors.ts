/**
 * Thrown when a frame is structurally impossible to decode (truncated,
 * unknown codec, bad preamble). A CRC mismatch is *not* a parse error — it
 * is reported as `crcOk: false` so the caller can ask the device to resend.
 */
export class TeltonikaParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TeltonikaParseError';
  }
}
