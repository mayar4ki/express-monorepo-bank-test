/**
 * Telemetry is split by freshness rather than by event type.
 *
 * A vehicle that drives out of coverage keeps recording to flash and dumps the
 * whole backlog when it reconnects — hours of history, from many vehicles at
 * once. On a single topic that burst sits in front of live traffic and delays
 * every consumer behind it, which for alerting means finding out about a low
 * tank long after it mattered. Two topics keep the burst off the live path:
 * writers read both and simply lag on backfill, alerting reads only live.
 *
 * Splitting by event type instead would not help — one AVL record carries
 * position, fuel and ignition together, so a backlog fills every per-type
 * topic equally, and splitting it would also throw away the per-vehicle
 * ordering the engine and alert state machines depend on.
 */
export const telemetryLiveTopic = 'vehicle.telemetry.live';
export const telemetryBackfillTopic = 'vehicle.telemetry.backfill';

/** Messages that failed validation, kept for triage instead of dropped. */
export const telemetryDlqTopic = 'vehicle.telemetry.dlq';

export const telemetryTopics = [telemetryLiveTopic, telemetryBackfillTopic] as const;

/**
 * One group per destination, so each consumer keeps its own offsets: a writer
 * that was down resumes from where it stopped, and a slow one never holds the
 * others back.
 */
export const consumerGroups = {
  locations: 'telemetry.locations-writer',
  fuel: 'telemetry.fuel-writer',
  engine: 'telemetry.engine-writer',
  alerting: 'telemetry.alerting',
} as const;

export type ConsumerName = keyof typeof consumerGroups;

/**
 * A record older than this when it reaches us came out of a device's flash
 * buffer rather than off the wire live. Five minutes is comfortably above the
 * usual reporting interval and network jitter.
 */
export const DEFAULT_BACKFILL_THRESHOLD_MS = 5 * 60 * 1000;
