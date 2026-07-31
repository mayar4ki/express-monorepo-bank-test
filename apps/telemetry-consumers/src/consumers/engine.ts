import { vehicleEngineEvents } from '@bank/db';
import type { Db } from '@bank/db';
import type { TelemetryBatchHandler, TelemetryEvent } from '@bank/events';
import { AVL_ID } from '@bank/teltonika';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { VehicleRegistry } from '../vehicles.js';

type EngineEventType = 'ignition_on' | 'ignition_off' | 'movement_start' | 'movement_stop';

interface VehicleState {
  ignition?: boolean;
  movement?: boolean;
}

const IGNITION_EVENTS = ['ignition_on', 'ignition_off'] as const;
const MOVEMENT_EVENTS = ['movement_start', 'movement_stop'] as const;

/**
 * Writes ignition and movement transitions — one row per state change, not per
 * reading, so "when did this van start moving" is a lookup rather than a scan.
 *
 * A transition is recognised two ways, and both are allowed to fire because the
 * table's unique key makes a duplicate a no-op:
 *
 *  1. The device says so. A record whose triggering id is ignition or movement
 *     was generated *because* that input changed, so its value is the new
 *     state. This is self-describing, so it works on backlog too.
 *  2. We notice. Comparing against the last known state catches devices not
 *     configured to report those inputs on change. This only runs on live data:
 *     backlog arrives out of order relative to live, so comparing a
 *     three-hour-old record against the current state would invent
 *     transitions that never happened.
 *
 * The last known state is seeded from the newest stored transition, so a change
 * that happens across a restart is still noticed.
 */
export function createEngineHandler(deps: {
  db: Db;
  logger: Logger;
  vehicles: VehicleRegistry;
}): TelemetryBatchHandler {
  const states = new Map<string, VehicleState>();

  async function loadState(vehicleId: string): Promise<VehicleState> {
    const cached = states.get(vehicleId);
    if (cached) return cached;

    const [latestIgnition, latestMovement] = await Promise.all([
      lastTransition(deps.db, vehicleId, IGNITION_EVENTS),
      lastTransition(deps.db, vehicleId, MOVEMENT_EVENTS),
    ]);

    const state: VehicleState = {
      ignition: latestIgnition === undefined ? undefined : latestIgnition === 'ignition_on',
      movement: latestMovement === undefined ? undefined : latestMovement === 'movement_start',
    };
    states.set(vehicleId, state);
    return state;
  }

  return async (events, context) => {
    const relevant = events.filter(
      (event) => event.ignition !== undefined || event.movement !== undefined,
    );
    if (relevant.length === 0) return;

    const vehicleIds = await deps.vehicles.resolveAll(relevant.map((event) => event.imei));
    const isLive = context.freshness === 'live';
    const rows: (typeof vehicleEngineEvents.$inferInsert)[] = [];

    for (const event of relevant) {
      const vehicleId = vehicleIds.get(event.imei);
      if (!vehicleId) continue;
      const state = await loadState(vehicleId);

      for (const transition of transitionsFor(event, state, isLive)) {
        rows.push({
          vehicleId,
          recordedAt: new Date(event.recordedAt),
          receivedAt: new Date(event.receivedAt),
          eventType: transition,
        });
      }
    }
    if (rows.length === 0) return;

    await deps.db.insert(vehicleEngineEvents).values(rows).onConflictDoNothing();
    deps.logger.debug({ rows: rows.length, freshness: context.freshness }, 'engine events written');
  };
}

/** The newest stored transition of one kind, or undefined if there is none. */
async function lastTransition(
  db: Db,
  vehicleId: string,
  types: readonly EngineEventType[],
): Promise<EngineEventType | undefined> {
  const [row] = await db
    .select({ eventType: vehicleEngineEvents.eventType })
    .from(vehicleEngineEvents)
    .where(
      and(
        eq(vehicleEngineEvents.vehicleId, vehicleId),
        inArray(vehicleEngineEvents.eventType, [...types]),
      ),
    )
    .orderBy(desc(vehicleEngineEvents.recordedAt))
    .limit(1);

  return row?.eventType;
}

/**
 * Which transitions this record represents. Mutates `state` for live records
 * only — a backlog record describes the past and must not overwrite what we
 * know about now.
 */
function transitionsFor(
  event: TelemetryEvent,
  state: VehicleState,
  isLive: boolean,
): EngineEventType[] {
  const transitions: EngineEventType[] = [];

  if (event.ignition !== undefined) {
    const deviceReportedChange = event.eventIoId === AVL_ID.ignition;
    const differsFromKnown = state.ignition !== undefined && state.ignition !== event.ignition;
    if (deviceReportedChange || (isLive && differsFromKnown)) {
      transitions.push(event.ignition ? 'ignition_on' : 'ignition_off');
    }
    if (isLive) state.ignition = event.ignition;
  }

  if (event.movement !== undefined) {
    const deviceReportedChange = event.eventIoId === AVL_ID.movement;
    const differsFromKnown = state.movement !== undefined && state.movement !== event.movement;
    if (deviceReportedChange || (isLive && differsFromKnown)) {
      transitions.push(event.movement ? 'movement_start' : 'movement_stop');
    }
    if (isLive) state.movement = event.movement;
  }

  return transitions;
}
