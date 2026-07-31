import { parseAvlPacket } from '@bank/teltonika';
import { encodeAvlFrame } from '@bank/teltonika/testing';
import { describe, expect, it } from 'vitest';

import { buildTelemetryEvents } from '../../src/build.js';
import { classifyFreshness } from '../../src/client.js';
import { decodeTelemetryEvent, telemetryEventSchema } from '../../src/schemas.js';
import type { TelemetryEvent } from '../../src/schemas.js';

const IMEI = '356938035643809';
const RECEIVED_AT = new Date('2026-07-31T12:00:00.000Z');

function buildFrom(records: Parameters<typeof encodeAvlFrame>[0]): TelemetryEvent[] {
  const packet = parseAvlPacket(encodeAvlFrame(records));
  if (!packet.crcOk) throw new Error('expected a valid CRC');
  return buildTelemetryEvents({
    imei: IMEI,
    codec: packet.codec,
    records: packet.records,
    receivedAt: RECEIVED_AT,
  });
}

describe('buildTelemetryEvents', () => {
  it('produces an event that satisfies the wire schema', () => {
    const [event] = buildFrom([
      {
        timestampMs: RECEIVED_AT.getTime(),
        priority: 1,
        gps: {
          latitude: 54.712345,
          longitude: 25.279652,
          altitudeM: 143,
          angleDeg: 271,
          satellites: 11,
          speedKph: 64,
        },
        io: [{ id: 239, value: 1, widthBytes: 1 }],
      },
    ]);

    expect(event).toBeDefined();
    expect(telemetryEventSchema.safeParse(event).success).toBe(true);
    expect(event?.imei).toBe(IMEI);
    expect(event?.codec).toBe('codec8');
    expect(event?.schemaVersion).toBe(1);
    expect(event?.ignition).toBe(true);
    expect(event?.recordedAt).toBe(RECEIVED_AT.toISOString());
  });

  it('gives records in one packet distinct dedup keys even at the same instant', () => {
    const events = buildFrom([
      { timestampMs: RECEIVED_AT.getTime() },
      { timestampMs: RECEIVED_AT.getTime() },
    ]);

    expect(new Set(events.map((e) => e.dedupKey)).size).toBe(2);
  });

  it('is stable across a resend of the same packet', () => {
    const records = [{ timestampMs: RECEIVED_AT.getTime() }, { timestampMs: 1_700_000_000_000 }];

    expect(buildFrom(records).map((e) => e.dedupKey)).toEqual(
      buildFrom(records).map((e) => e.dedupKey),
    );
  });

  it('survives the JSON round trip it makes through Kafka', () => {
    const [event] = buildFrom([
      {
        timestampMs: RECEIVED_AT.getTime(),
        io: [{ id: 78, value: 2n ** 64n - 1n, widthBytes: 8 }],
      },
    ]);

    const decoded = decodeTelemetryEvent(JSON.stringify(event));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.event).toEqual(event);
    expect(decoded.event.rawIo['78']).toBe('18446744073709551615');
  });
});

describe('decodeTelemetryEvent', () => {
  const valid = (): TelemetryEvent => {
    const [event] = buildFrom([{ timestampMs: RECEIVED_AT.getTime() }]);
    if (!event) throw new Error('expected an event');
    return event;
  };

  it('rejects a message with no value rather than throwing', () => {
    const result = decodeTelemetryEvent(null);
    expect(result).toEqual({ ok: false, reason: 'message has no value' });
  });

  it('rejects malformed JSON with a readable reason', () => {
    const result = decodeTelemetryEvent(Buffer.from('{"not json'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/invalid JSON/);
  });

  it('rejects an unknown schema version', () => {
    // Producers and consumers must agree on the shape; an unrecognised version
    // belongs in the dead-letter topic, not half-applied to a table.
    const result = decodeTelemetryEvent(JSON.stringify({ ...valid(), schemaVersion: 2 }));
    expect(result.ok).toBe(false);
  });

  it('rejects an IMEI that is not 15 digits', () => {
    const result = decodeTelemetryEvent(JSON.stringify({ ...valid(), imei: '123' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/imei/);
  });

  it('rejects out-of-range coordinates', () => {
    const event = valid();
    const result = decodeTelemetryEvent(
      JSON.stringify({
        ...event,
        gps: {
          latitude: 91,
          longitude: 0,
          altitudeM: 0,
          angleDeg: 0,
          satellites: 5,
          speedKph: 0,
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a fuel reading carrying neither a percentage nor a volume', () => {
    const result = decodeTelemetryEvent(
      JSON.stringify({ ...valid(), fuel: [{ source: 'can_pct' }] }),
    );
    expect(result.ok).toBe(false);
  });

  it('accepts a record with no GPS fix', () => {
    const result = decodeTelemetryEvent(JSON.stringify({ ...valid(), gps: null }));
    expect(result.ok).toBe(true);
  });
});

describe('classifyFreshness', () => {
  const eventAgedBy = (lagMs: number): TelemetryEvent => {
    const [event] = buildFrom([{ timestampMs: RECEIVED_AT.getTime() - lagMs }]);
    if (!event) throw new Error('expected an event');
    return event;
  };

  it('treats a record that arrived promptly as live', () => {
    expect(classifyFreshness(eventAgedBy(1_000), 300_000)).toBe('live');
  });

  it('treats a record older than the threshold as backfill', () => {
    // The no-coverage case: hours of flash-buffered history arriving at once.
    expect(classifyFreshness(eventAgedBy(4 * 60 * 60 * 1000), 300_000)).toBe('backfill');
  });

  it('keeps a record exactly at the threshold on the live path', () => {
    expect(classifyFreshness(eventAgedBy(300_000), 300_000)).toBe('live');
  });

  it('treats a device clock running ahead of ours as live, not backlog', () => {
    expect(classifyFreshness(eventAgedBy(-60_000), 300_000)).toBe('live');
  });
});
