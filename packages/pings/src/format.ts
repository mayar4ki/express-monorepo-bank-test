import type { DevicePing } from '@acme/types';
import { summarizeByDevice } from './summarize.js';

/**
 * How a speed is rendered, in one place. The unit is not carried in the data —
 * `DevicePing.speedKph` already asserts it — so this module is the single source
 * of truth for the unit label, the decimal precision and the column alignment.
 */
export const SPEED_UNIT = 'km/h';

export function formatSpeedKph(kph: number): string {
  return `${kph.toFixed(1)} ${SPEED_UNIT}`;
}

/**
 * Max speed per device as ready-to-print lines, e.g. `d1: 61.2 km/h`. Returns
 * finished lines rather than values because alignment is a property of the whole
 * set, not of any single speed. Empty input yields no lines — what a CLI says in
 * that case is the CLI's business.
 */
export function formatDeviceMaxSpeeds(pings: readonly DevicePing[]): string[] {
  const rows = summarizeByDevice(pings).map((summary) => ({
    deviceId: summary.deviceId,
    speed: formatSpeedKph(summary.maxSpeed),
  }));

  if (rows.length === 0) {
    return [];
  }

  const labelWidth = Math.max(...rows.map((row) => row.deviceId.length));
  const speedWidth = Math.max(...rows.map((row) => row.speed.length));

  return rows.map((row) => `${row.deviceId.padEnd(labelWidth)}: ${row.speed.padStart(speedWidth)}`);
}
