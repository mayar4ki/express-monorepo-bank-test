import { TeltonikaParseError } from './errors.js';

/**
 * Bounds-checked sequential reader. Every read names what it is reading so a
 * truncated frame produces an error that points at the exact field.
 */
export class Cursor {
  readonly #buf: Buffer;
  #offset = 0;

  constructor(buf: Buffer) {
    this.#buf = buf;
  }

  get offset(): number {
    return this.#offset;
  }

  get remaining(): number {
    return this.#buf.length - this.#offset;
  }

  /** Reserves `bytes` and returns the offset they start at. */
  #take(bytes: number, field: string): number {
    if (this.remaining < bytes) {
      throw new TeltonikaParseError(
        `truncated frame: ${field} needs ${bytes} byte(s) at offset ${this.#offset}, only ${this.remaining} left`,
      );
    }
    const start = this.#offset;
    this.#offset += bytes;
    return start;
  }

  u8(field: string): number {
    return this.#buf.readUInt8(this.#take(1, field));
  }

  u16(field: string): number {
    return this.#buf.readUInt16BE(this.#take(2, field));
  }

  u32(field: string): number {
    return this.#buf.readUInt32BE(this.#take(4, field));
  }

  u64(field: string): bigint {
    return this.#buf.readBigUInt64BE(this.#take(8, field));
  }

  i16(field: string): number {
    return this.#buf.readInt16BE(this.#take(2, field));
  }

  i32(field: string): number {
    return this.#buf.readInt32BE(this.#take(4, field));
  }

  /** Copies out `length` bytes so the returned value does not pin the frame. */
  bytes(length: number, field: string): Buffer {
    const start = this.#take(length, field);
    return Buffer.from(this.#buf.subarray(start, start + length));
  }
}
