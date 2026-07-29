# Internal Banking API — Reference

Internal HTTP API for bank employees. It manages customers, bank accounts, transfers between accounts, internal comments and account locks.

Interactive documentation (Swagger UI) is served by the running API at **`/docs`** (spec: `/docs/openapi.json`).

## Quickstart

```bash
docker compose up --build        # from the repo root
# Everything on one port behind the nginx gateway (default :3000)
```

Migrations and seeds (customers 1–4 + the admin user) run automatically on stack start; both are idempotent. See the [root README](../../README.md) for a full login → transfer walkthrough and local development setup.

## Conventions

- **Authentication**: every route except `GET /health` and `/docs` requires a JWT from the auth API:

  ```
  Authorization: Bearer <token from POST /auth/login>
  ```

  Missing/invalid tokens → `401 UNAUTHORIZED`.

- **Money is integer cents.** Every amount field (`amountCents`, `balanceCents`, `initialDepositCents`) is an integer number of minor units. `12550` = $125.50. Fractions and non-numeric values are rejected.
- **Errors** always use one envelope:

  ```json
  { "error": { "code": "INSUFFICIENT_FUNDS", "message": "…", "details": {} } }
  ```

- Timestamps are ISO-8601 UTC strings.

### Error codes

| Code                     | HTTP | Meaning                                              |
| ------------------------ | ---- | ---------------------------------------------------- |
| `VALIDATION_ERROR`       | 400  | Request body/params/query/headers failed validation  |
| `UNAUTHORIZED`           | 401  | Missing, invalid or expired bearer token             |
| `CUSTOMER_NOT_FOUND`     | 404  | Unknown customer id                                  |
| `ACCOUNT_NOT_FOUND`      | 404  | Unknown account id                                   |
| `TRANSFER_NOT_FOUND`     | 404  | Unknown transfer id                                  |
| `LOCK_NOT_FOUND`         | 404  | Lock does not exist on that account                  |
| `NOT_FOUND`              | 404  | Unknown route                                        |
| `IDEMPOTENCY_KEY_REUSED` | 409  | Same `Idempotency-Key` sent with a different payload |
| `LOCK_ALREADY_RELEASED`  | 409  | The lock was released earlier                        |
| `SAME_ACCOUNT`           | 422  | Source and destination account are identical         |
| `INTERNAL_ERROR`         | 500  | Unexpected failure                                   |

`ACCOUNT_LOCKED` and `INSUFFICIENT_FUNDS` appear as the **`failureReason`** of a failed transfer (see below), not as HTTP errors.

## Transfers: asynchronous, idempotent, queued

`POST /transfers` requires an **`Idempotency-Key`** header (any unique string ≤ 255 chars, e.g. a UUID) and is **asynchronous**:

1. The request is validated synchronously (400/404/409/422 for bad input, unknown accounts, key reuse with a different payload, self-transfer).
2. A `pending` transfer is stored and queued — response **`202 Accepted`** with the pending transfer and a `Location: /transfers/{id}` header.
3. A dedicated executor service consumes the queue **one job at a time** and moves the money inside a database transaction that row-locks both accounts — double-spending is impossible even with concurrent requests or multiple API replicas.
4. **Poll `GET /transfers/{id}`** until `status` is `completed` or `failed` (`failureReason`: `INSUFFICIENT_FUNDS` or `ACCOUNT_LOCKED`).

Idempotency:

- Retrying with the **same key and payload** returns the transfer's **current state** with `200` — money never moves twice. Failed outcomes replay too: a transfer that failed with `INSUFFICIENT_FUNDS` stays failed under that key — use a new key to try again.
- The same key with a **different payload** → `409 IDEMPOTENCY_KEY_REUSED`.
- Concurrent duplicates: exactly one request gets `202` (created); the rest get `200` with the same transfer.

## Locks

A lock freezes an account with a free-text reason. While **any** lock on an account is active, the account can neither **send nor receive** transfers (they fail with `failureReason: "ACCOUNT_LOCKED"`). An account can hold several locks; releasing one keeps the account frozen until all are released. Released locks are kept (with `releasedAt`) as an audit trail.

---

## Routes

All examples assume `TOKEN` holds a JWT from the auth API:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@bank.local","password":"admin12345"}' | jq -r .token)
AUTH="Authorization: Bearer $TOKEN"
```

### System

#### `GET /health` — public

Liveness check; verifies database + queue connectivity and reports transfer-job counts.

```bash
curl http://localhost:3000/health
# {"status":"ok","queue":{"waiting":0,"active":0,"delayed":0,"failed":0}}
```

### Customers

#### `GET /customers` — list all customers

```bash
curl -H "$AUTH" http://localhost:3000/customers
```

#### `POST /customers` — create a customer

```bash
curl -X POST http://localhost:3000/customers -H "$AUTH" \
  -H 'Content-Type: application/json' -d '{"name":"Ada Lovelace"}'
# 201 {"id":"<uuid>","name":"Ada Lovelace","createdAt":"…"}
```

#### `GET /customers/{customerId}` — get one customer (404 if unknown)

#### `GET /customers/{customerId}/accounts` — list a customer's accounts

### Accounts

#### `POST /accounts` — open an account with an initial deposit

A customer may have any number of accounts. The initial deposit (≥ 0) is credited atomically and recorded in the transfer history as a `deposit`; a `0` deposit opens an empty account.

```bash
curl -X POST http://localhost:3000/accounts -H "$AUTH" \
  -H 'Content-Type: application/json' \
  -d '{"customerId":"00000000-0000-4000-8000-000000000001","initialDepositCents":100000}'
# 201 {"id":"<uuid>","customerId":"00000000-0000-4000-8000-000000000001","balanceCents":100000,"createdAt":"…"}
```

#### `GET /accounts/{accountId}` — account details

Includes `locked: true|false` (whether any active lock exists).

#### `GET /accounts/{accountId}/balance` — current balance

```bash
curl -H "$AUTH" http://localhost:3000/accounts/$ACCOUNT_ID/balance
# {"accountId":"<uuid>","balanceCents":100000}
```

#### `GET /accounts/{accountId}/transfers` — transfer history

Both directions, including the opening deposit, newest first. Keyset-paginated: `?limit=` (default 50, max 200) and `?cursor=` (the `nextCursor` from the previous page).

```bash
curl -H "$AUTH" "http://localhost:3000/accounts/$ACCOUNT_ID/transfers?limit=2"
# {"items":[{"id":"<uuid>","type":"transfer","fromAccountId":"<uuid>","toAccountId":"<uuid>",
#            "amountCents":2500,"status":"completed","failureReason":null,
#            "idempotencyKey":"…","createdAt":"…","completedAt":"…"}, …],
#  "nextCursor":8}
```

### Transfers

#### `POST /transfers` — submit a transfer (async)

Requires the `Idempotency-Key` header (see above). Works across customers.

```bash
curl -si -X POST http://localhost:3000/transfers -H "$AUTH" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: 4be0a5e0-1f2c-4c1d-9d3e-8a7b6c5d4e3f" \
  -d "{\"fromAccountId\":\"$FROM\",\"toAccountId\":\"$TO\",\"amountCents\":2500}"
# 202 Accepted / Location: /transfers/<uuid>  → body: pending transfer
# 200 on idempotent replay              → body: current state
```

#### `GET /transfers/{transferId}` — poll for the outcome

```bash
curl -H "$AUTH" http://localhost:3000/transfers/$TRANSFER_ID
# {"id":"<uuid>","status":"completed", …}   or   {"status":"failed","failureReason":"INSUFFICIENT_FUNDS", …}
```

### Comments

#### `POST /accounts/{accountId}/comments` — add an internal note

```bash
curl -X POST http://localhost:3000/accounts/$ACCOUNT_ID/comments -H "$AUTH" \
  -H 'Content-Type: application/json' \
  -d '{"body":"Customer called about a disputed charge."}'
```

#### `GET /accounts/{accountId}/comments` — list notes, newest first

### Locks

#### `POST /accounts/{accountId}/locks` — lock an account

```bash
curl -X POST http://localhost:3000/accounts/$ACCOUNT_ID/locks -H "$AUTH" \
  -H 'Content-Type: application/json' \
  -d '{"reason":"Suspected fraudulent activity — case #4821"}'
# 201 {"id":"<uuid>","accountId":"<uuid>","reason":"…","createdAt":"…","releasedAt":null}
```

#### `GET /accounts/{accountId}/locks` — list locks

`?active=true` → only active, `?active=false` → only released, omitted → all.

#### `DELETE /accounts/{accountId}/locks/{lockId}` — release a lock

```bash
curl -X DELETE -H "$AUTH" http://localhost:3000/accounts/$ACCOUNT_ID/locks/$LOCK_ID
# 200 → lock with releasedAt set
# 409 LOCK_ALREADY_RELEASED on a second release
```
