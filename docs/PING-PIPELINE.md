# Ping pipeline (`@acme/*`) — design decisions

The exercise in [`live-coding.md`](../live-coding.md) asked for a small pnpm workspace: a schema
package, a summarising package that depends on it, a CLI that validates a JSON file and prints
`count=3 maxSpeed=61.2`, and — without touching `packages/` — a second app printing max speed per
device. It assumed an empty folder; this implementation lands it **inside the existing `@bank`
monorepo** instead, so the guiding rule was _fit this repo's conventions, and be explicit wherever
that means departing from the brief_.

## What was added

| Workspace          | Name                | Role                                                      |
| ------------------ | ------------------- | --------------------------------------------------------- |
| `packages/types`   | `@acme/types`       | `DevicePingSchema`, `DevicePing`, `DevicePingsSchema`     |
| `packages/pings`   | `@acme/pings`       | `summarizePings` / `summarizeByDevice` + speed formatting |
| `apps/ping-ingest` | `@acme/ping-ingest` | Part 1 CLI + `fixtures/pings.json`                        |
| `apps/ping-report` | `@acme/ping-report` | Part 2 CLI, max speed per device                          |

Run it:

```bash
pnpm install && pnpm build
node apps/ping-ingest/dist/index.js apps/ping-ingest/fixtures/pings.json   # count=3 maxSpeed=61.2
node apps/ping-report/dist/index.js apps/ping-ingest/fixtures/pings.json   # d1: 61.2 km/h ...
```

`pnpm ping:ingest` / `pnpm ping:report` are shortcuts for exactly those two commands, and
`pnpm ping:all` builds both apps and runs them back to back. (It is not called `pnpm ping` because that
collides with pnpm's built-in registry-ping command.)

## Decision 1 — no per-package `dist/`, deliberately

**The brief says each package builds to its own `dist/`. This repo does the opposite, and the repo
won.**

Every workspace under `packages/` here follows the _internal packages_ pattern: it exports raw
TypeScript (`"exports": { ".": "./src/index.ts" }`), has no `build` script, and its only `tsc` call is
`typecheck: tsc --noEmit`. Nothing is emitted. The compilation happens **inside each consuming app**,
because every app's tsup config carries `noExternal: [/^@bank\//]` — tsup follows the import through
the workspace symlink, reads the TS source, and inlines it. `apps/telemetry-ingest/dist/main.js`
physically contains the compiled `@bank/events` code.

(`packages/db` and `packages/db-telemetry` do have `build: tsup`, but their entry is
`scripts/migrate.ts` — a runnable migration script for Docker. Their library entry is still
`./src/index.ts`, so they are not exceptions.)

Why the pattern is worth keeping:

- no lib build step to order, and no stale `dist/` to debug;
- a cross-package edit is visible immediately under `tsx watch`, with no rebuild;
- each app ships one self-contained bundle — small Docker images, no workspace symlinks needed at
  runtime.

What it costs, honestly: a library is recompiled into every app that consumes it; the packages are
consumable only by something that can compile TypeScript (fine internally, not publishable); and no
package has a `dist/index.js` that `node` can execute. That last point is exactly the rule the brief
wanted, so it is the thing being given up.

The brief's acceptance path still holds, because the _apps_ build to `dist/`. **If these packages were
ever published externally, this decision flips** — they would then need real `dist/` output plus
`.d.ts` declarations, since consumers could not compile our source.

## Decision 2 — how "one root command, correct order" is satisfied

`pnpm build` → `turbo run build`. Ordering comes from [`turbo.json`](../turbo.json), where the `build`
task declares `dependsOn: ["^build"]` — turbo derives the graph from the `workspace:*` dependencies in
each `package.json` and builds upstream first.

Worth being straight about: because the libraries are inlined rather than built, **there is no
separate lib build step to order here.** `@acme/types` → `@acme/pings` → apps is a real dependency
chain for type-checking and for resolution, but at build time tsup reads the packages' source directly.
The ordering guarantee that the brief was probing for lives in tsup's resolution, not in a sequence of
`tsc` invocations. Under Decision 1's alternative (real `dist/`), `dependsOn: ["^build"]` would be
what makes it correct — the config is already there either way.

No change was needed to [`pnpm-workspace.yaml`](../pnpm-workspace.yaml): its `apps/*` and `packages/*`
globs pick the four new workspaces up automatically.

## Decision 3 — imports by name, enforced not just intended

Every cross-package import uses the package name (`@acme/types`, `@acme/pings`); there is not a single
relative path crossing a package boundary. Three things hold that in place:

1. each package declares its public surface through the `exports` map, so deep paths into another
   package's `src/` are not reachable;
2. dependencies are declared as `workspace:*`, so pnpm creates the symlink that makes the name
   resolvable (`apps/ping-ingest/node_modules/@acme/pings → ../../../../packages/pings`);
3. pnpm's isolated `node_modules` means an undeclared package is simply not resolvable — a missing
   dependency fails fast instead of working by accident.

Third-party versions all go through the workspace `catalog:` (`zod: "catalog:"`), which keeps one zod
version across the repo and keeps the `sherif` check in `postinstall` green.

Note that both apps declare `zod` themselves even though they never import it directly. That is a
consequence of Decision 1: the inlined `@acme/types` source carries an `import { z } from 'zod'` into
the app's bundle, where zod stays external and must resolve from the app's own `node_modules`. The
existing `@bank` apps declare their transitive third-party deps for the same reason.

## Decision 4 — the schema, kept verbatim plus one addition

`DevicePingSchema` is exactly as supplied. Added alongside it:

```ts
export const DevicePingsSchema = z.array(DevicePingSchema);
```

A CLI validates a _file_, which is an array, so something has to own "what a valid pings document
looks like". Putting it in `@acme/types` means neither app hand-rolls `z.array(...)` and neither needs
to touch zod directly to validate.

On zod v4 (the catalog version): `z.string().datetime()` still works — it produces
`Invalid ISO datetime` on bad input — but it is soft-deprecated in favour of `z.iso.datetime()`. The
supplied form was kept as given; `z.iso.datetime()` is the modern spelling if we ever migrate.

## Decision 5 — `summarizePings` and the empty case

```ts
export function summarizePings(pings: readonly DevicePing[]): PingSummary {
  return {
    count: pings.length,
    maxSpeed: pings.reduce((max, ping) => (ping.speedKph > max ? ping.speedKph : max), 0),
  };
}
```

- `readonly` input: the function has no business mutating its argument.
- `reduce` rather than `Math.max(...pings.map(…))`: no spread of an unbounded array onto the stack, and
  no indexed access to appease `noUncheckedIndexedAccess`.
- Empty input returns `{ count: 0, maxSpeed: 0 }`. `Math.max()` of nothing is `-Infinity`, which is a
  bad thing to print; `null` would be more honest but forces every caller to handle `number | null`.
  Speeds are non-negative by schema, so `0` is a safe identity for the reduction and the return type
  stays plainly `number`. This is the one judgement call in the package worth arguing about.

## Decision 6 — Part 2 needed no change inside `packages/`, by design

As first delivered, `ping-report` grouped the validated pings by `deviceId` in the app and called the
**unchanged** `summarizePings` once per group:

```ts
const rows = [...groupByDevice(pings)].map(([deviceId, devicePings]) => ({
  deviceId,
  maxSpeed: summarizePings(devicePings).maxSpeed.toFixed(1),
}));
```

That is the whole point of the constraint, and it held: `summarizePings` summarises _any_ set of pings,
not "all the pings", so who decides which subset it sees is a caller concern. A version that had grouped
internally — returning per-device data — would have had to change for Part 2.

Output is sorted by device id (deterministic, so it is diffable) and column-aligned:

```
d1: 61.2 km/h
d2:  0.0 km/h
```

## Decision 7 — one source of truth for rendering a speed (follow-up)

Having demonstrated Decision 6, the constraint was **deliberately retired** so that formatting could
stop living in the app. `packages/pings` now splits into two modules behind the same barrel:

- `summarize.ts` — domain: `summarizePings`, plus `summarizeByDevice(pings) → DeviceSummary[]` (grouped,
  sorted, still built _on top of_ `summarizePings`, so the composition point survives);
- `format.ts` — presentation: `SPEED_UNIT`, `formatSpeedKph`, `formatDeviceMaxSpeeds`.

`ping-report` is now load-and-print, with no formatting decisions of its own:

```ts
const lines = formatDeviceMaxSpeeds(pings);
```

Three points worth defending:

- **The unit is not in the data.** Carrying `"unit": "km/h"` in the fixture was considered and rejected:
  `DevicePing.speedKph` already asserts the unit, a second field can contradict it, it is the wrong
  cardinality (a unit belongs to the field, not to each row), and it would not have removed formatting
  from the app anyway — precision and alignment would have stayed there. `format.ts` is the single
  source of truth instead, so the unit cannot drift between consumers. If multi-unit devices ever
  arrive, the answer is still to normalise to km/h at ingest and convert in this module.
- **`formatDeviceMaxSpeeds` returns finished lines, not values,** because alignment is a property of the
  whole set — a per-value `formatSpeedKph(61.2)` cannot know the widest row. That is also why grouping
  had to move into the package alongside the formatter.
- **Part 1 is untouched.** `count=3 maxSpeed=61.2` is a machine-readable line specified exactly, so
  `ping-ingest` prints the raw number and never goes through `formatSpeedKph`. Only the report renders
  `0.0` rather than `0`.

Empty input returns no lines; what a CLI prints in that case (`no pings`) stays the CLI's business.

## Known wart: the duplicated loader

`src/load-pings.ts` is duplicated between the two apps. Part 2 forbade changes inside `packages/`, and
a shared loader has no other home, so the CLI plumbing (argument handling, file read, JSON parse,
schema validation, exit codes) stays app-local. Given the constraint, duplicating ~40 lines beats
either violating it or contorting `@acme/pings` into an I/O package. Lift it to an `@acme/pings-io`
package the moment the constraint goes away.

Both CLIs fail loudly rather than silently: missing argument, unreadable file, malformed JSON, and
schema violations each print a specific message to stderr and exit `1`. Validation errors list the
offending path, e.g. `0.speedKph: Too small: expected number to be >=0`.

## Verified

```
pnpm install     # 20 workspace projects linked; sherif: no issues
pnpm build       # 9 tasks, turbo-ordered
pnpm typecheck   # 16 tasks green
pnpm lint        # 16 tasks green
```

Plus the two acceptance commands above, and the failure paths (no argument, missing file, broken JSON,
negative `speedKph`, invalid `ts`, empty array) — each with the expected message and exit code.
