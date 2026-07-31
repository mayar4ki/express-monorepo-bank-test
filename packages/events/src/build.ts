import { normalizeRecord } from '@bank/teltonika';
import type { AvlRecord, CodecId } from '@bank/teltonika';

import { TELEMETRY_SCHEMA_VERSION } from './schemas.js';
import type { TelemetryEvent } from './schemas.js';

/**
 * Turns the records of one decoded AVL packet into Kafka events: the device's
 * IO elements become named fields (via `@bank/teltonika`) and this adds the
 * transport envelope.
 */
export function buildTelemetryEvents(params: {
  imei: string;
  codec: CodecId;
  records: AvlRecord[];
  receivedAt: Date;
}): TelemetryEvent[] {
  return params.records.map((record, index) => {
    const payload = normalizeRecord(params.imei, record, params.receivedAt);
    return {
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
      // Position in the packet disambiguates two records sharing a timestamp.
      dedupKey: `${params.imei}:${record.timestampMs}:${index}`,
      imei: payload.imei,
      codec: params.codec,
      recordedAt: payload.recordedAt.toISOString(),
      receivedAt: payload.receivedAt.toISOString(),
      priority: payload.priority,
      eventIoId: payload.eventIoId,
      gps: payload.gps,
      ignition: payload.ignition,
      movement: payload.movement,
      fuel: payload.fuel,
      externalVoltageMv: payload.externalVoltageMv,
      batteryVoltageMv: payload.batteryVoltageMv,
      odometerM: payload.odometerM,
      rawIo: payload.rawIo,
      rawIoVariable: payload.rawIoVariable,
    };
  });
}
