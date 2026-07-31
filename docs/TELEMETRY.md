# Vehicle telemetry

The bank's cash-in-transit vehicles carry Teltonika trackers (FMB/FMC series) reporting
position, fuel level and engine state. This pipeline takes what they send, puts it on
Kafka, and has separate consumers write each kind of reading where it belongs and raise
alerts.

```
  vehicles ──tcp:5027──▶ telemetry-ingest ─────▶ Kafka ─────▶ telemetry-consumers ──▶ Postgres
  (Codec 8 / 8E)         framing, CRC,      vehicle.telemetry.live      locations-writer
                         decode, ack        vehicle.telemetry.backfill  fuel-writer
                                            vehicle.telemetry.dlq       engine-writer
                                            (key = IMEI)                alerting  (live only)
```

## Ingest

Devices connect directly to TCP 5027 — the protocol is binary, so nginx cannot route it.

The protocol is stop-and-wait: the device sends a packet, waits for our reply, then sends
the next. Two consequences shape the implementation:

- **The acknowledgement is a durability promise.** A device deletes acknowledged records
  from its flash buffer, so ingest only acks after Kafka has accepted the data. If the
  publish fails it drops the connection _without_ acking and the device resends. Losing a
  connection is therefore free; acking early would lose data.
- **It gives backpressure for free.** Pausing the socket while publishing stops that
  device sending more, so a slow broker throttles the fleet instead of queueing in memory.

A packet that fails its CRC is answered with an ack of `0`, which asks the device to
resend it. `packages/teltonika` does the decoding as pure functions over buffers, so it is
tested without any sockets.

## Why two topics

Split by **freshness**, not by event type.

A vehicle that drives out of coverage keeps recording and flushes the whole backlog on
reconnect — hours of history, from many vehicles at once. On a single topic that burst
sits in front of live traffic and delays every consumer behind it, which for alerting
means hearing about a low tank long after it mattered.

Splitting by event type would not help: one AVL record carries position, fuel and ignition
_together_, so a backlog fills every per-type topic equally, and splitting a record apart
would also discard the per-vehicle ordering the engine and alert state machines rely on.

So ingest classifies each record by how old it is on arrival
(`BACKFILL_THRESHOLD_MS`, default 5 min) and routes it to the live or the backfill topic.
Writers read both — history is worth storing whenever it turns up. Alerting reads only
live, plus an `ALERT_MAX_AGE_MS` guard in case a device's clock is badly wrong.

Both topics are keyed by IMEI, so one vehicle's records always land on the same partition
and stay in order.

## Recovering from a consumer outage

No replay script: **committed consumer-group offsets are the recovery mechanism.** A
consumer that was down resumes exactly where it stopped and works through the backlog.
Three settings make that dependable:

| Setting                         | Default | Why                                                      |
| ------------------------------- | ------- | -------------------------------------------------------- |
| topic `retention.ms`            | 7 days  | The window in which a downed consumer can still catch up |
| `offsets.retention.minutes`     | 14 days | A dead group's offsets must outlive the topic retention  |
| `KAFKA_LOG_DIRS` → named volume | —       | Otherwise the broker writes to `/tmp` and loses both     |

A timestamp-based "replay everything since the newest row" script would actually be
_wrong_ here: backfilled records arrive out of `recordedAt` order, so the newest stored
row is not a safe watermark. Offsets have no such problem.

Delivery is at-least-once, so every reading table has a unique key over its natural
identity and writers insert with `onConflictDoNothing` — a redelivery is a no-op rather
than a duplicate row. Watch **consumer lag** to know a consumer is behind.

Messages that fail schema validation go to `vehicle.telemetry.dlq` with the rejection
reason in the headers, so one bad message never wedges a partition.

## Consumers

| Group                        | Topics         | Writes                  |
| ---------------------------- | -------------- | ----------------------- |
| `telemetry.locations-writer` | live, backfill | `vehicle_locations`     |
| `telemetry.fuel-writer`      | live, backfill | `vehicle_fuel_readings` |
| `telemetry.engine-writer`    | live, backfill | `vehicle_engine_events` |
| `telemetry.alerting`         | live           | `vehicle_alerts`        |

They run in one process by default. Each has its own offsets, so narrowing `CONSUMERS`
(e.g. `CONSUMERS=alerting`) is all it takes to split one into its own deployment.

Notes on the trickier two:

- **Locations** skips records with no satellite fix. A device without a fix reports
  zeroes, which would otherwise plot the vehicle in the Gulf of Guinea.
- **Engine** writes one row per _change_, not per reading. A transition is recognised
  either because the device said so (the record's triggering IO id is ignition/movement,
  which is self-describing and so trusted on backlog too) or because it differs from the
  last known state — the latter only on live data, since comparing a three-hour-old record
  against the current state would invent transitions. Both paths may fire; the unique key
  makes that a no-op.
- **Alerting** is edge-triggered via `vehicle_alert_states`. A van below the fuel
  threshold satisfies the rule on every reading for the rest of its shift, so a row is
  written when the condition _starts_ holding, and again only after `ALERT_COOLDOWN_MS`.
  Vehicles are auto-registered on first contact, so a newly fitted device is never turned
  away; naming it is an operator's job afterwards.

## Configuration

| Variable                 | Default   | Meaning                                         |
| ------------------------ | --------- | ----------------------------------------------- |
| `TELEMETRY_TCP_PORT`     | 5027      | Where devices connect                           |
| `BACKFILL_THRESHOLD_MS`  | 300000    | Older than this on arrival ⇒ backfill topic     |
| `IDLE_TIMEOUT_MS`        | 300000    | Drop a silent device connection                 |
| `CONSUMERS`              | all       | Which consumers this process runs               |
| `LOW_FUEL_PCT`           | 15        | Low-fuel alert threshold                        |
| `SPEED_LIMIT_KPH`        | 90        | Speeding alert threshold                        |
| `ALERT_COOLDOWN_MS`      | 900000    | Re-fire interval for a still-active condition   |
| `ALERT_MAX_AGE_MS`       | 600000    | Never alert on a reading older than this        |
| `GEOFENCE_REFRESH_MS`    | 60000     | Geofence cache reload interval                  |
| `TELEMETRY_RETENTION_MS` | 604800000 | Topic retention = outage recovery window        |
| `KAFKA_HOST_PORT`        | 29092     | Host-side broker listener, for `pnpm dev`/tests |

Geofences are circular zones in the `geofences` table; with none configured, no
geofence-exit alert can fire.

## Trying it

```bash
docker compose up --build
```

Then send a packet as a device would. `packages/teltonika/src/testing.ts` builds valid
frames (correct lengths and CRCs), which is also how the tests avoid hand-written hex:

```ts
import net from 'node:net';
import { encodeAvlFrame, encodeImeiFrame } from '@bank/teltonika/testing';

const socket = net.createConnection(5027, '127.0.0.1');
socket.on('data', (reply) => console.log('ack:', reply.toString('hex')));
socket.on('connect', () => {
  socket.write(encodeImeiFrame('356938035643809')); // → 01 (accepted)
  setTimeout(() => {
    socket.write(
      encodeAvlFrame([
        {
          timestampMs: Date.now(),
          gps: {
            latitude: 54.6872,
            longitude: 25.2797,
            altitudeM: 120,
            angleDeg: 90,
            satellites: 9,
            speedKph: 45,
          },
          eventIoId: 239,
          io: [
            { id: 239, value: 1, widthBytes: 1 }, // ignition on
            { id: 89, value: 8, widthBytes: 1 }, // fuel 8% → low-fuel alert
          ],
        },
      ]),
    ); // → 00000001 (one record accepted)
  }, 500);
});
```

The rows land in `vehicle_locations`, `vehicle_fuel_readings`, `vehicle_engine_events`
and `vehicle_alerts`.

## Tests

Unit tests cover the codec (against a real captured device packet, plus generated
frames), the alert rules and the ingest socket behaviour. Integration tests run against
real Kafka and Postgres containers and cover the live/backfill split, dead-lettering,
idempotent redelivery, alert cooldown, backlog raising no alarms, and a consumer
resuming after being down.

```bash
pnpm test:unit
pnpm test:integration     # needs Docker

# Or reuse the compose containers instead of starting new ones:
TEST_KAFKA_BROKERS=localhost:29092 TEST_DATABASE_URL=postgres://bank:bank@localhost:5432/bank \
  pnpm test:integration
```
