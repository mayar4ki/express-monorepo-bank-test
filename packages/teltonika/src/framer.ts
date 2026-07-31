import { FRAME_CRC_BYTES, FRAME_HEADER_BYTES, parseAvlPacket } from './avl.js';
import type { AvlPacket } from './avl.js';
import { tryParseImeiFrame } from './imei.js';

/** Guards against a bogus length field making us buffer unbounded data. */
const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;

export type FramerErrorReason = 'invalid-imei' | 'bad-preamble' | 'frame-too-large' | 'parse-error';

export type FramerEvent =
  | { type: 'imei'; imei: string }
  | { type: 'packet'; packet: AvlPacket }
  | { type: 'error'; reason: FramerErrorReason; detail: string };

/**
 * Reassembles one device's TCP stream into protocol events. TCP gives no
 * message boundaries, so bytes are buffered until a whole frame is present:
 * first the IMEI handshake, then AVL packets for the rest of the connection.
 *
 * One instance per connection. After an `error` event the framer is spent and
 * ignores further input — the caller is expected to drop the connection.
 */
export class TeltonikaFramer {
  #buffer: Buffer = Buffer.alloc(0);
  #state: 'awaiting-imei' | 'streaming' | 'failed' = 'awaiting-imei';
  readonly #maxFrameBytes: number;

  constructor(options: { maxFrameBytes?: number } = {}) {
    this.#maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
  }

  /** True once the handshake has been read and AVL packets are expected. */
  get handshakeComplete(): boolean {
    return this.#state === 'streaming';
  }

  /**
   * Feeds a chunk of received bytes and returns every event it completed.
   * A chunk may complete none (partial frame) or several (batched frames).
   */
  push(chunk: Buffer): FramerEvent[] {
    if (this.#state === 'failed') return [];
    this.#buffer = Buffer.concat([this.#buffer, chunk]);

    const events: FramerEvent[] = [];
    for (;;) {
      const event = this.#next();
      if (!event) break;
      events.push(event);
      if (event.type === 'error') {
        this.#state = 'failed';
        this.#buffer = Buffer.alloc(0);
        break;
      }
    }
    return events;
  }

  /** Decodes the next complete frame, or null while more bytes are needed. */
  #next(): FramerEvent | null {
    if (this.#state === 'awaiting-imei') return this.#nextHandshake();
    return this.#nextPacket();
  }

  #nextHandshake(): FramerEvent | null {
    const result = tryParseImeiFrame(this.#buffer);
    switch (result.status) {
      case 'need-more':
        return null;
      case 'invalid':
        return { type: 'error', reason: 'invalid-imei', detail: result.reason };
      case 'ok':
        this.#consume(result.bytesConsumed);
        this.#state = 'streaming';
        return { type: 'imei', imei: result.imei };
    }
  }

  #nextPacket(): FramerEvent | null {
    if (this.#buffer.length < FRAME_HEADER_BYTES) return null;

    const preamble = this.#buffer.readUInt32BE(0);
    if (preamble !== 0) {
      // The stream is out of sync; resynchronising is not safe, so give up.
      return {
        type: 'error',
        reason: 'bad-preamble',
        detail: `preamble 0x${preamble.toString(16)} is not zero`,
      };
    }

    const dataLength = this.#buffer.readUInt32BE(4);
    const frameLength = FRAME_HEADER_BYTES + dataLength + FRAME_CRC_BYTES;
    if (frameLength > this.#maxFrameBytes) {
      return {
        type: 'error',
        reason: 'frame-too-large',
        detail: `frame of ${frameLength} bytes exceeds the ${this.#maxFrameBytes} byte limit`,
      };
    }
    if (this.#buffer.length < frameLength) return null;

    const frame = this.#buffer.subarray(0, frameLength);
    this.#consume(frameLength);
    try {
      return { type: 'packet', packet: parseAvlPacket(frame) };
    } catch (err) {
      return {
        type: 'error',
        reason: 'parse-error',
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  #consume(bytes: number): void {
    this.#buffer = this.#buffer.subarray(bytes);
  }
}
