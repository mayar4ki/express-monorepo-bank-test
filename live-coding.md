Build a small pnpm workspace monorepo from this empty folder. Use your AI for everything — but I'll ask you to explain your decisions.

Part 1:

packages/types (name it @acme/types): exports the schema I paste below.
packages/pings (@acme/pings): exports summarizePings(pings) → { count, maxSpeed }. Depends on @acme/types.
applications/ingest: small CLI that reads the JSON file below, validates it with the schema, and prints: count=3 maxSpeed=61.2
Rules:

TypeScript, strict mode.
Packages import each other BY NAME (@acme/types), never by file path.
Each package builds to its own dist/ folder.
ONE root command builds everything in the correct order.
Done when this works: pnpm install && pnpm build && node apps/ingest/dist/index.js <test-fixture-path>

Part 2:

Add apps/report that prints max speed per device — WITHOUT changing anything inside packages/. Format the output nicely, like d1: 61.2 km/h per device.

Note:

You can use below to not spend time on generating domain code

```
// Schema for @acme/types
import { z } from 'zod';
export const DevicePingSchema = z.object({
    deviceId: z.string(),
    speedKph: z.number().nonnegative(),
    ts: z.string().datetime(),
});
export type DevicePing = z.infer<typeof DevicePingSchema>;
```

```
[
  { "deviceId": "d1", "speedKph": 42.5, "ts": "2026-07-01T10:00:00Z" },
  { "deviceId": "d1", "speedKph": 61.2, "ts": "2026-07-01T10:05:00Z" },
  { "deviceId": "d2", "speedKph": 0,    "ts": "2026-07-01T10:05:00Z" }
]
```
