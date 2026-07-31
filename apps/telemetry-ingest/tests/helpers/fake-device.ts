import net from 'node:net';

import { encodeAvlFrame, encodeImeiFrame } from '@bank/teltonika/testing';
import type { EncodableRecord, EncodeOptions } from '@bank/teltonika/testing';

/**
 * A Teltonika device as far as the ingest server can tell: connects over TCP,
 * announces its IMEI, then sends AVL packets and waits for each reply. Sending
 * real bytes over a real socket is the point — it exercises framing, acking and
 * backpressure the way a vehicle in the field would.
 */
export class FakeDevice {
  readonly #socket = new net.Socket();
  #buffer: Buffer = Buffer.alloc(0);
  #waiter: { bytes: number; resolve: (reply: Buffer) => void } | undefined;
  #closed = false;

  constructor(readonly imei: string) {
    this.#socket.on('data', (chunk: Buffer | string) => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'binary') : chunk;
      this.#buffer = Buffer.concat([this.#buffer, bytes]);
      this.#settle();
    });
    this.#socket.on('close', () => {
      this.#closed = true;
    });
    this.#socket.on('error', () => {
      this.#closed = true;
    });
  }

  get closed(): boolean {
    return this.#closed;
  }

  async connect(port: number, host = '127.0.0.1'): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.#socket.once('error', reject);
      this.#socket.connect(port, host, () => {
        this.#socket.off('error', reject);
        resolve();
      });
    });
  }

  /** Sends the handshake and returns the single-byte accept/reject reply. */
  async handshake(): Promise<Buffer> {
    return this.#exchange(encodeImeiFrame(this.imei), 1);
  }

  /** Sends a packet and returns the four-byte record-count acknowledgement. */
  async sendRecords(records: EncodableRecord[], options?: EncodeOptions): Promise<Buffer> {
    return this.#exchange(encodeAvlFrame(records, options), 4);
  }

  /** Sends raw bytes, optionally split into chunks to test reassembly. */
  async sendRaw(data: Buffer, expectedReplyBytes: number, chunkSize?: number): Promise<Buffer> {
    if (!chunkSize) return this.#exchange(data, expectedReplyBytes);

    const reply = this.#expect(expectedReplyBytes);
    for (let offset = 0; offset < data.length; offset += chunkSize) {
      this.#socket.write(data.subarray(offset, offset + chunkSize));
      // Let the server process each chunk before the next arrives.
      await new Promise((resolve) => setImmediate(resolve));
    }
    return reply;
  }

  /** Resolves once the server hangs up. */
  async waitForClose(timeoutMs = 5_000): Promise<void> {
    if (this.#closed) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('server did not close the connection')),
        timeoutMs,
      );
      this.#socket.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  destroy(): void {
    this.#socket.destroy();
  }

  async #exchange(data: Buffer, expectedReplyBytes: number): Promise<Buffer> {
    const reply = this.#expect(expectedReplyBytes);
    this.#socket.write(data);
    return reply;
  }

  #expect(bytes: number, timeoutMs = 10_000): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`expected ${bytes} reply byte(s), got ${this.#buffer.length}`)),
        timeoutMs,
      );
      this.#waiter = {
        bytes,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
      };
      this.#socket.once('close', () => {
        clearTimeout(timer);
        reject(new Error('connection closed while awaiting a reply'));
      });
      this.#settle();
    });
  }

  #settle(): void {
    const waiter = this.#waiter;
    if (!waiter || this.#buffer.length < waiter.bytes) return;
    this.#waiter = undefined;
    const reply = this.#buffer.subarray(0, waiter.bytes);
    this.#buffer = this.#buffer.subarray(waiter.bytes);
    waiter.resolve(reply);
  }
}
