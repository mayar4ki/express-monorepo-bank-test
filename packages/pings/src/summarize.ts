import type { DevicePing } from '@acme/types';

export interface PingSummary {
  count: number;
  maxSpeed: number;
}

export interface DeviceSummary extends PingSummary {
  deviceId: string;
}

/**
 * Summarise any set of pings. Deliberately agnostic about *which* pings it gets:
 * callers wanting a per-device view group first and call this per group.
 *
 * Empty input yields `maxSpeed: 0` rather than null/-Infinity, which keeps the
 * return type plain `number` for every caller. Speeds are non-negative by
 * schema, so 0 is a safe identity for the reduction.
 */
export function summarizePings(pings: readonly DevicePing[]): PingSummary {
  return {
    count: pings.length,
    maxSpeed: pings.reduce((max, ping) => (ping.speedKph > max ? ping.speedKph : max), 0),
  };
}

/**
 * One summary per device, sorted by device id so output is deterministic and
 * diffable. Grouping only decides *which* pings each `summarizePings` call sees.
 */
export function summarizeByDevice(pings: readonly DevicePing[]): DeviceSummary[] {
  const byDevice = new Map<string, DevicePing[]>();

  for (const ping of pings) {
    const group = byDevice.get(ping.deviceId);
    if (group) {
      group.push(ping);
    } else {
      byDevice.set(ping.deviceId, [ping]);
    }
  }

  return [...byDevice]
    .map(([deviceId, devicePings]) => ({ deviceId, ...summarizePings(devicePings) }))
    .sort((a, b) => a.deviceId.localeCompare(b.deviceId));
}
