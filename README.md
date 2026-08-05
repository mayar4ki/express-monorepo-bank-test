# Internal Banking Platform

A Turborepo/pnpm monorepo implementing an internal banking platform for bank employees:

```
                              employees ──── :3000 (single port)
                                   │
                          ┌────────▼────────┐
                          │  nginx gateway  │  /auth/*, /.well-known/* → auth-api
                          │                 │  everything else → app-apis
                          └───┬─────────┬───┘  (/docs = combined Swagger UI)
             /auth/login etc. │         │ accounts, transfers, …
                      ┌───────▼─────┐   ┌─▼───────────┐
                      │  auth-api   │◀──│  app-apis   │
                      │  :3001      │   │  :3000      │
                      └──────┬──────┘ JWKS verify─┬───┘
                             │                    │ enqueue (BullMQ)
                          Postgres ◀──────────┐  Redis
                             ▲                │   │ consume
                             └────────────────┴──┌▼────────────┐
                                    execute      │  executor   │
                                  (FOR UPDATE tx)│  :3002      │
                                                 └─────────────┘
```

| Workspace                  | What it is                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `apps/app-apis`            | Banking API: customers, accounts, transfers, comments, locks — JWT-protected ([API.md](apps/app-apis/API.md))           |
| `apps/auth-api`            | Auth service: register / login / me, ES256 JWTs, JWKS ([API.md](apps/auth-api/API.md))                                  |
| `apps/executor`            | BullMQ worker executing transfers one at a time; scale it independently                                                 |
| `apps/telemetry-ingest`    | TCP listener for the cash vehicles' Teltonika devices → Kafka ([TELEMETRY.md](docs/TELEMETRY.md))                       |
| `apps/telemetry-consumers` | Four consumer groups writing telemetry to Postgres and raising vehicle alerts                                           |
| `apps/ping-ingest`         | Device-ping CLI exercise: validate a pings file, print `count` / `maxSpeed` ([PING-PIPELINE.md](docs/PING-PIPELINE.md)) |
| `apps/ping-report`         | Same fixture, max speed per device (`@acme/ping-report`)                                                                |
| `packages/db`              | Drizzle schema, SQL migrations, seeds (`@bank/db`)                                                                      |
| `packages/queue`           | Single source of truth for the BullMQ queue: name, payload types, options, worker factory (`@bank/queue`)               |
| `packages/events`          | Single source of truth for Kafka telemetry: topics, event schema, producer/consumer factories (`@bank/events`)          |
| `packages/teltonika`       | Teltonika Codec 8 / 8E codec: framing, CRC, AVL parsing, IO map — pure functions (`@bank/teltonika`)                    |
| `packages/shared`          | Errors, route/validation/OpenAPI machinery, transfer executor domain logic (`@bank/shared`)                             |
| `packages/types`           | Device-ping zod schema and inferred types (`@acme/types`)                                                               |
| `packages/pings`           | `summarizePings` → `{ count, maxSpeed }` over any set of pings (`@acme/pings`)                                          |
| `infra/nginx`              | Gateway config: maps every service onto one port with a combined Swagger UI                                             |
| `tooling/*`                | Shared tsconfig / ESLint / Prettier configs                                                                             |

### Vehicle telemetry

The bank's cash-in-transit vehicles carry Teltonika trackers reporting position, fuel
and engine state. They speak a binary protocol over raw TCP, so they connect straight
to `telemetry-ingest` on port 5027 rather than through the HTTP gateway:

```
  vehicles ──tcp:5027──▶ telemetry-ingest ──▶ Kafka ──▶ telemetry-consumers ──▶ Postgres
   (Codec 8/8E)          decode + ack           live │              locations / fuel / engine
                                            backfill ┘              alerting (live only)
```

Telemetry is split across two topics by **freshness**, not by event type. A vehicle
that loses coverage keeps recording to flash and dumps hours of backlog when it
reconnects; keeping that off the live path is what stops a backlog flush from delaying
a genuine low-fuel alert. See [docs/TELEMETRY.md](docs/TELEMETRY.md).

## Run it

```bash
docker compose up --build
```

Zero configuration needed: migrations run, the four assignment customers and an **admin user** are seeded automatically. Everything is served through the nginx gateway on a **single port** (`GATEWAY_PORT`, default 3000). Then:

```bash
# 1. Log in (seeded admin — override via ADMIN_* in a root .env)
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@bank.local","password":"admin12345"}' | jq -r .token)

# 2. Open two accounts for the seeded customers (ids are UUIDs; the four
#    assignment customers have fixed ids ending 01–04)
ARISHA=00000000-0000-4000-8000-000000000001
BRANDEN=00000000-0000-4000-8000-000000000002
FROM=$(curl -s -X POST http://localhost:3000/accounts \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"customerId\":\"$ARISHA\",\"initialDepositCents\":100000}" | jq -r .id)
TO=$(curl -s -X POST http://localhost:3000/accounts \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"customerId\":\"$BRANDEN\",\"initialDepositCents\":0}" | jq -r .id)

# 3. Submit a transfer (async: 202 → poll the Location header)
curl -si -X POST http://localhost:3000/transfers \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d "{\"fromAccountId\":\"$FROM\",\"toAccountId\":\"$TO\",\"amountCents\":2500}"
```

Swagger UI: [http://localhost:3000/docs](http://localhost:3000/docs) — one combined spec covering both the banking and the auth API, as if they were a single app (the banking API merges the auth API's spec via `DOCS_MERGE_SPEC_URLS`).

Compose defaults (admin credentials, Postgres password, JWT issuer/audience, …) can be overridden via a root `.env` — see [.env.example](.env.example). The stack mounts a **committed dev-only JWT key** ([apps/auth-api/dev/](apps/auth-api/dev/)); use your own key in any real deployment.

## Local development

Requirements: Node ≥ 24 (see .nvmrc), pnpm 11, Docker (Postgres/Redis + tests).

```bash
pnpm install
docker compose up -d postgres redis kafka kafka-init
cp apps/app-apis/.env.example apps/app-apis/.env      # each app has a documented .env.example
cp apps/auth-api/.env.example apps/auth-api/.env
cp apps/executor/.env.example apps/executor/.env
cp apps/telemetry-ingest/.env.example apps/telemetry-ingest/.env
cp apps/telemetry-consumers/.env.example apps/telemetry-consumers/.env
cp packages/db/.env.example packages/db/.env
pnpm db:migrate                                        # migrate + seed
pnpm dev                                               # turbo runs every app in watch mode
```

The broker publishes a second listener for the host (`KAFKA_HOST_PORT`, default 29092),
so the telemetry apps can run from source against the compose Kafka.

Common commands (all via turbo): `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm format`, `pnpm db:generate` (new migration after schema changes).

## Tests

```bash
pnpm test
```

- **Banking**: unit (queue-free schema/CORS checks) + integration against **real Postgres and Redis** (testcontainers), running the **same BullMQ worker code** the executor app ships.
- Highlights: idempotent replay (completed _and_ failed transfers), lock semantics in both directions, JWT 401 paths, a 100-request concurrent transfer storm asserting total-balance conservation, and a queue-bypass storm proving the row-locking transaction alone prevents double-spending.
- **Telemetry**: the Codec 8/8E codec is pinned to a real captured device packet (all other frames are generated, so no hand-written hex can drift), and integration tests run against **real Kafka and Postgres** covering the live/backfill split, dead-lettering, idempotent redelivery, alert cooldown, a backlog flush raising no alarms, and a consumer resuming after being down.
- Set `TEST_DATABASE_URL` / `TEST_REDIS_URL` / `TEST_KAFKA_BROKERS` to reuse existing instances instead of testcontainers.

A Husky pre-commit hook runs Prettier + ESLint (lint-staged) and typechecks the workspace.

## Design notes

- **Async transfers**: `POST /transfers` validates, stores a `pending` row and enqueues a BullMQ job — **202 + Location**; clients poll `GET /transfers/:id` for the outcome. Idempotency: the transfer row is the idempotency record (unique key index), the key doubles as the BullMQ job id (queue-level dedup), and replays return the current state with `200`.
- **Double-spend protection is layered**: the executor consumes jobs with **concurrency 1** (the brief's "one by one" queue), _and_ every transfer runs in a Postgres transaction with `SELECT … FOR UPDATE` on both accounts in deterministic (lexicographic UUID) order, with a `CHECK (balance_cents >= 0)` backstop — correct even with multiple workers.
- **Business failures vs infrastructure failures**: insufficient funds / locked accounts are persisted on the row (`failed` + reason) and the job _succeeds_; only infrastructure errors trigger BullMQ retries (5 attempts, exponential backoff).
- **Auth**: auth-api signs ES256 JWTs (kid = JWK thumbprint); app-apis verifies via `createRemoteJWKSet` against `/.well-known/jwks.json` — key rotation needs no redeploy of app-apis. Everything except `/health` and `/docs` requires a token.
- **Money** is integer cents everywhere (`bigint` in Postgres, safe-integer-guarded in JSON).
- **Vehicle telemetry** splits Kafka topics by _freshness_ (live vs backfill) rather than by event type, so a vehicle flushing hours of flash-buffered data after losing coverage cannot delay a live low-fuel alert; consumer-group offsets — not a replay script — are what lets a consumer that was down catch up. Full rationale in [docs/TELEMETRY.md](docs/TELEMETRY.md).
- **Ids are UUIDs** (`gen_random_uuid()`); tables that need stable ordering or keyset pagination carry an internal `seq` identity column that never leaves the API (the pagination cursor is derived from it).
- Rate limiting on login is out of scope (internal network); noted for future work.

## Environment variables

Each app validates its environment at boot (Zod) and each has a fully commented `.env.example`:
[app-apis](apps/app-apis/.env.example) · [auth-api](apps/auth-api/.env.example) · [executor](apps/executor/.env.example) · [telemetry-ingest](apps/telemetry-ingest/.env.example) · [telemetry-consumers](apps/telemetry-consumers/.env.example) · [db](packages/db/.env.example) · [compose overrides](.env.example)
