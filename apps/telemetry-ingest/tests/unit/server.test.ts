import type { TelemetryEvent } from '@bank/events';
import { encodeAvlFrame, encodeImeiFrame } from '@bank/teltonika/testing';
import { pino } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createIngestServer } from '../../src/server.js';
import type { IngestServer } from '../../src/server.js';
import { FakeDevice } from '../helpers/fake-device.js';

const IMEI = '356938035643809';
const RECEIVED_AT = new Date('2026-07-31T12:00:00.000Z');
const logger = pino({ level: 'silent' });

const running: { server: IngestServer; devices: FakeDevice[] }[] = [];

interface Harness {
  port: number;
  published: TelemetryEvent[][];
  connect: () => Promise<FakeDevice>;
  server: IngestServer;
}

async function startServer(
  overrides: {
    publish?: (events: TelemetryEvent[]) => Promise<void>;
    idleTimeoutMs?: number;
  } = {},
): Promise<Harness> {
  const published: TelemetryEvent[][] = [];
  const server = createIngestServer({
    logger,
    idleTimeoutMs: overrides.idleTimeoutMs ?? 60_000,
    now: () => RECEIVED_AT,
    publish:
      overrides.publish ??
      ((events) => {
        published.push(events);
        return Promise.resolve();
      }),
  });

  const port = await server.listen(0, '127.0.0.1');
  const entry = { server, devices: [] as FakeDevice[] };
  running.push(entry);

  return {
    port,
    published,
    server,
    connect: async () => {
      const device = new FakeDevice(IMEI);
      entry.devices.push(device);
      await device.connect(port);
      return device;
    },
  };
}

afterEach(async () => {
  for (const { server, devices } of running.splice(0)) {
    for (const device of devices) device.destroy();
    await server.close();
  }
});

const RECORD = {
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
  io: [{ id: 239, value: 1, widthBytes: 1 as const }],
};

describe('handshake', () => {
  it('accepts a device with a well-formed IMEI', async () => {
    const harness = await startServer();
    const device = await harness.connect();

    expect(await device.handshake()).toEqual(Buffer.from([0x01]));
  });

  it('rejects and hangs up on a malformed IMEI', async () => {
    const harness = await startServer();
    const device = await harness.connect();

    const reply = await device.sendRaw(encodeImeiFrame('12345'), 1);
    expect(reply).toEqual(Buffer.from([0x00]));
    await device.waitForClose();
  });
});

describe('packet acknowledgement', () => {
  it('acknowledges the number of records it took', async () => {
    const harness = await startServer();
    const device = await harness.connect();
    await device.handshake();

    const ack = await device.sendRecords([RECORD, RECORD, RECORD]);

    expect(ack.readUInt32BE(0)).toBe(3);
    expect(harness.published).toHaveLength(1);
    expect(harness.published[0]).toHaveLength(3);
  });

  it('publishes decoded events with the arrival clock attached', async () => {
    const harness = await startServer();
    const device = await harness.connect();
    await device.handshake();
    await device.sendRecords([RECORD]);

    const [event] = harness.published[0] ?? [];
    expect(event).toBeDefined();
    expect(event?.imei).toBe(IMEI);
    expect(event?.receivedAt).toBe(RECEIVED_AT.toISOString());
    expect(event?.ignition).toBe(true);
    expect(event?.gps?.speedKph).toBe(64);
  });

  it('acknowledges zero and keeps the connection on a checksum failure', async () => {
    const harness = await startServer();
    const device = await harness.connect();
    await device.handshake();

    const ack = await device.sendRecords([RECORD], { crcOverride: 0xdead });

    // Zero tells the device to resend rather than discard.
    expect(ack.readUInt32BE(0)).toBe(0);
    expect(harness.published).toHaveLength(0);

    // The link is still good, so the resend succeeds.
    expect((await device.sendRecords([RECORD])).readUInt32BE(0)).toBe(1);
  });

  it('handles several packets in sequence on one connection', async () => {
    const harness = await startServer();
    const device = await harness.connect();
    await device.handshake();

    for (let i = 0; i < 5; i += 1) {
      const ack = await device.sendRecords([{ ...RECORD, timestampMs: RECEIVED_AT.getTime() + i }]);
      expect(ack.readUInt32BE(0)).toBe(1);
    }

    expect(harness.published).toHaveLength(5);
  });

  it('reassembles a packet that arrives one byte at a time', async () => {
    const harness = await startServer();
    const device = await harness.connect();

    const stream = Buffer.concat([encodeImeiFrame(IMEI), encodeAvlFrame([RECORD])]);
    // 1 handshake byte + 4 ack bytes.
    const reply = await device.sendRaw(stream, 5, 1);

    expect(reply[0]).toBe(0x01);
    expect(reply.readUInt32BE(1)).toBe(1);
    expect(harness.published).toHaveLength(1);
  });
});

describe('durability', () => {
  it('does not acknowledge a packet it failed to publish', async () => {
    const publish = vi.fn().mockRejectedValue(new Error('broker unreachable'));
    const harness = await startServer({ publish });
    const device = await harness.connect();
    await device.handshake();

    device.sendRecords([RECORD]).catch(() => undefined);

    // No ack and a dropped connection: the device keeps the records in flash
    // and resends them, so a broker outage costs nothing but a reconnect.
    await device.waitForClose();
    expect(publish).toHaveBeenCalledOnce();
  });

  it('acknowledges only after publishing resolves', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = await startServer({ publish: () => gate });
    const device = await harness.connect();
    await device.handshake();

    const ack = device.sendRecords([RECORD]);
    const raced = await Promise.race([
      ack.then(() => 'acked' as const),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 150)),
    ]);
    expect(raced).toBe('pending');

    release();
    expect((await ack).readUInt32BE(0)).toBe(1);
  });
});

describe('stream faults', () => {
  it('hangs up on a device that sends a bad preamble', async () => {
    const harness = await startServer();
    const device = await harness.connect();
    await device.handshake();

    device.sendRaw(Buffer.from('deadbeef00000010', 'hex'), 4).catch(() => undefined);

    await device.waitForClose();
  });

  it('closes an idle connection', async () => {
    const harness = await startServer({ idleTimeoutMs: 150 });
    const device = await harness.connect();
    await device.handshake();

    await device.waitForClose();
  });

  it('stops tracking a connection once it closes', async () => {
    const harness = await startServer();
    const device = await harness.connect();
    await device.handshake();
    expect(harness.server.connectionCount()).toBe(1);

    device.destroy();
    await vi.waitFor(() => expect(harness.server.connectionCount()).toBe(0));
  });

  it('serves several devices at once', async () => {
    const harness = await startServer();
    const devices = await Promise.all([harness.connect(), harness.connect(), harness.connect()]);

    await Promise.all(devices.map((device) => device.handshake()));
    const acks = await Promise.all(devices.map((device) => device.sendRecords([RECORD])));

    for (const ack of acks) expect(ack.readUInt32BE(0)).toBe(1);
    expect(harness.published).toHaveLength(3);
  });
});
