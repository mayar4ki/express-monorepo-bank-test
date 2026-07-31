import net from 'node:net';

import { buildTelemetryEvents } from '@bank/events';
import type { TelemetryEvent } from '@bank/events';
import { TeltonikaFramer, buildImeiAck, buildRecordAck } from '@bank/teltonika';
import type { AvlPacket } from '@bank/teltonika';
import type { Logger } from 'pino';

export interface IngestServerOptions {
  logger: Logger;
  /** Must resolve only once the data is durably stored. */
  publish: (events: TelemetryEvent[]) => Promise<void>;
  idleTimeoutMs: number;
  /** Injectable so tests can pin the arrival clock. */
  now?: () => Date;
}

export interface IngestServer {
  /** Resolves with the port actually bound (useful when passing 0). */
  listen: (port: number, host?: string) => Promise<number>;
  close: () => Promise<void>;
  isListening: () => boolean;
  connectionCount: () => number;
}

/**
 * Accepts Teltonika devices over raw TCP and forwards what they report.
 *
 * The protocol is stop-and-wait: a device sends one packet, waits for our
 * acknowledgement, and only then sends the next. Two things follow from that.
 *
 * The acknowledgement is a durability promise — a device deletes acknowledged
 * records from its flash buffer, so we must only ack after Kafka has the data.
 * If publishing fails we drop the connection without acking and the device
 * resends everything, which is why losing a connection is safe but acking
 * early is not.
 *
 * It also gives us backpressure for free: pausing the socket while we publish
 * stops that device from sending more, so a slow broker throttles the fleet
 * instead of piling up in memory here.
 */
export function createIngestServer(options: IngestServerOptions): IngestServer {
  const now = options.now ?? (() => new Date());
  const connections = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    connections.add(socket);
    const framer = new TeltonikaFramer();
    const peer = `${socket.remoteAddress ?? 'unknown'}:${socket.remotePort ?? 0}`;
    let logger = options.logger.child({ peer });
    let imei: string | undefined;

    socket.setNoDelay(true);
    socket.setTimeout(options.idleTimeoutMs);

    const drop = (reason: string, detail?: string): void => {
      logger.warn({ reason, detail }, 'dropping device connection');
      socket.destroy();
    };

    async function handlePacket(packet: AvlPacket): Promise<void> {
      if (!imei) {
        // The framer enforces handshake-first, so this is unreachable.
        drop('packet-before-handshake');
        return;
      }

      if (!packet.crcOk) {
        // Corrupted in transit. Acking zero records asks for a resend.
        logger.warn(
          { declaredCrc: packet.declaredCrc, computedCrc: packet.computedCrc },
          'packet failed its checksum, requesting resend',
        );
        socket.write(buildRecordAck(0));
        return;
      }

      const events = buildTelemetryEvents({
        imei,
        codec: packet.codec,
        records: packet.records,
        receivedAt: now(),
      });

      try {
        await options.publish(events);
      } catch (err) {
        // Deliberately no ack: the device keeps the data and resends it.
        logger.error({ err, records: events.length }, 'publish failed, not acknowledging packet');
        socket.destroy();
        return;
      }

      socket.write(buildRecordAck(packet.records.length));
      logger.debug({ records: packet.records.length, codec: packet.codec }, 'packet accepted');
    }

    async function handleChunk(chunk: Buffer): Promise<void> {
      for (const event of framer.push(chunk)) {
        if (socket.destroyed) return;

        switch (event.type) {
          case 'imei':
            imei = event.imei;
            logger = options.logger.child({ peer, imei });
            // Any well-formed IMEI is accepted; the consumers register the
            // vehicle on first sight, so ingest needs no database.
            socket.write(buildImeiAck(true));
            logger.info('device authenticated');
            break;

          case 'packet':
            await handlePacket(event.packet);
            break;

          case 'error':
            if (event.reason === 'invalid-imei') socket.write(buildImeiAck(false));
            drop(event.reason, event.detail);
            break;
        }
      }
    }

    socket.on('data', (chunk: Buffer | string) => {
      // Pause first: it stops further 'data' events, which both serialises
      // packet handling and backpressures the device while we publish.
      socket.pause();
      // No encoding is set on the socket, so chunks are always binary.
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'binary') : chunk;
      void handleChunk(bytes).finally(() => {
        if (!socket.destroyed) socket.resume();
      });
    });

    socket.on('timeout', () => drop('idle-timeout'));
    socket.on('error', (err) => logger.warn({ err }, 'device socket error'));
    socket.on('close', () => {
      connections.delete(socket);
      logger.info('device disconnected');
    });
  });

  return {
    listen: (port, host) =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          const address = server.address();
          resolve(typeof address === 'object' && address ? address.port : port);
        });
      }),

    close: () =>
      new Promise((resolve, reject) => {
        // Stop accepting, then hang up on the devices still connected. They
        // reconnect and resend anything we had not acknowledged.
        server.close((err) => (err ? reject(err) : resolve()));
        for (const socket of connections) socket.end();
      }),

    isListening: () => server.listening,
    connectionCount: () => connections.size,
  };
}
