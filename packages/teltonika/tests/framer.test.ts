import { describe, expect, it } from 'vitest';

import { crc16ibm } from '../src/crc.js';
import { TeltonikaFramer } from '../src/framer.js';
import type { FramerEvent } from '../src/framer.js';
import { encodeAvlFrame, encodeImeiFrame } from '../src/testing.js';

const IMEI = '356938035643809';

/** Feeds a buffer in fixed-size slices, collecting every event produced. */
function pushInChunks(framer: TeltonikaFramer, data: Buffer, chunkSize: number): FramerEvent[] {
  const events: FramerEvent[] = [];
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    events.push(...framer.push(data.subarray(offset, offset + chunkSize)));
  }
  return events;
}

describe('TeltonikaFramer — handshake', () => {
  it('emits the IMEI once the handshake frame is complete', () => {
    const framer = new TeltonikaFramer();
    expect(framer.handshakeComplete).toBe(false);

    const events = framer.push(encodeImeiFrame(IMEI));

    expect(events).toEqual([{ type: 'imei', imei: IMEI }]);
    expect(framer.handshakeComplete).toBe(true);
  });

  it('waits for the rest of a split handshake', () => {
    const framer = new TeltonikaFramer();
    const frame = encodeImeiFrame(IMEI);

    expect(framer.push(frame.subarray(0, 1))).toEqual([]);
    expect(framer.push(frame.subarray(1, 9))).toEqual([]);
    expect(framer.push(frame.subarray(9))).toEqual([{ type: 'imei', imei: IMEI }]);
  });

  it('rejects a handshake that does not declare 15 digits', () => {
    const framer = new TeltonikaFramer();
    const events = framer.push(encodeImeiFrame('12345'));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error', reason: 'invalid-imei' });
  });

  it('rejects a 15-byte IMEI that is not digits', () => {
    const framer = new TeltonikaFramer();
    const events = framer.push(encodeImeiFrame('35693803564380X'));

    expect(events[0]).toMatchObject({ type: 'error', reason: 'invalid-imei' });
  });
});

describe('TeltonikaFramer — packets', () => {
  it('emits a packet after the handshake', () => {
    const framer = new TeltonikaFramer();
    framer.push(encodeImeiFrame(IMEI));

    const events = framer.push(encodeAvlFrame([{ timestampMs: 1_700_000_000_000 }]));

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('packet');
  });

  it('reassembles a packet delivered one byte at a time', () => {
    const framer = new TeltonikaFramer();
    const stream = Buffer.concat([
      encodeImeiFrame(IMEI),
      encodeAvlFrame([
        {
          timestampMs: 1_700_000_000_000,
          gps: {
            latitude: 54.7,
            longitude: 25.2,
            altitudeM: 100,
            angleDeg: 90,
            satellites: 8,
            speedKph: 50,
          },
        },
      ]),
    ]);

    const events = pushInChunks(framer, stream, 1);

    expect(events.map((e) => e.type)).toEqual(['imei', 'packet']);
  });

  it('produces the same events at every chunk boundary', () => {
    const stream = Buffer.concat([
      encodeImeiFrame(IMEI),
      encodeAvlFrame([{ timestampMs: 1_700_000_000_000 }]),
      encodeAvlFrame([{ timestampMs: 1_700_000_060_000 }]),
    ]);

    for (let chunkSize = 1; chunkSize <= stream.length; chunkSize += 1) {
      const events = pushInChunks(new TeltonikaFramer(), stream, chunkSize);
      expect(
        events.map((e) => e.type),
        `chunk size ${chunkSize}`,
      ).toEqual(['imei', 'packet', 'packet']);
    }
  });

  it('emits every packet when several arrive in one chunk', () => {
    const framer = new TeltonikaFramer();
    const events = framer.push(
      Buffer.concat([
        encodeImeiFrame(IMEI),
        encodeAvlFrame([{ timestampMs: 1 }]),
        encodeAvlFrame([{ timestampMs: 2 }]),
        encodeAvlFrame([{ timestampMs: 3 }]),
      ]),
    );

    expect(events.map((e) => e.type)).toEqual(['imei', 'packet', 'packet', 'packet']);
  });

  it('reports a corrupted packet without failing the connection', () => {
    const framer = new TeltonikaFramer();
    framer.push(encodeImeiFrame(IMEI));

    const bad = framer.push(encodeAvlFrame([{ timestampMs: 1 }], { crcOverride: 0xdead }));
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({ type: 'packet' });
    if (bad[0]?.type === 'packet') expect(bad[0].packet.crcOk).toBe(false);

    // A bad CRC means "ask the device to resend", so the stream stays usable.
    const good = framer.push(encodeAvlFrame([{ timestampMs: 2 }]));
    expect(good[0]).toMatchObject({ type: 'packet' });
    if (good[0]?.type === 'packet') expect(good[0].packet.crcOk).toBe(true);
  });
});

describe('TeltonikaFramer — stream faults', () => {
  it('fails on a non-zero preamble instead of trying to resynchronise', () => {
    const framer = new TeltonikaFramer();
    framer.push(encodeImeiFrame(IMEI));

    const events = framer.push(Buffer.from('deadbeef00000010', 'hex'));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error', reason: 'bad-preamble' });
  });

  it('rejects a frame larger than the limit without buffering it', () => {
    const framer = new TeltonikaFramer({ maxFrameBytes: 512 });
    framer.push(encodeImeiFrame(IMEI));

    // Header only: the length field alone is enough to refuse the frame.
    const header = Buffer.alloc(8);
    header.writeUInt32BE(0, 0);
    header.writeUInt32BE(10_000, 4);

    expect(framer.push(header)[0]).toMatchObject({
      type: 'error',
      reason: 'frame-too-large',
    });
  });

  it('reports a structurally broken frame as a parse error', () => {
    const framer = new TeltonikaFramer();
    framer.push(encodeImeiFrame(IMEI));

    // Declared length and CRC are self-consistent, but the codec id is not.
    const dataField = Buffer.from([0x07, 0x00, 0x00]);
    const header = Buffer.alloc(8);
    header.writeUInt32BE(0, 0);
    header.writeUInt32BE(dataField.length, 4);
    const frame = Buffer.concat([header, dataField, Buffer.alloc(4)]);
    // The CRC has to match, otherwise the frame is rejected before the parser
    // ever looks at the codec id.
    frame.writeUInt32BE(crc16ibm(dataField), frame.length - 4);

    expect(framer.push(frame)[0]).toMatchObject({ type: 'error', reason: 'parse-error' });
  });

  it('ignores further input after a fault', () => {
    const framer = new TeltonikaFramer();
    framer.push(encodeImeiFrame('bad'));

    expect(framer.push(encodeAvlFrame([{ timestampMs: 1 }]))).toEqual([]);
  });
});
