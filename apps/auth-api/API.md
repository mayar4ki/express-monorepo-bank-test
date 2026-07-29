# Bank Auth API — Reference

Authentication service for the internal banking platform. Issues **ES256 JWTs** that the banking API verifies through this service's JWKS endpoint.

Interactive documentation (Swagger UI) is served by the running API at **`/docs`** (spec: `/docs/openapi.json`).

## Conventions

- **Errors** use the platform envelope: `{ "error": { "code", "message", "details?" } }`.
- Passwords are stored as bcrypt hashes; minimum length 8.
- Tokens carry `sub` (user id), `email`, `name`, `iss`, `aud`, `iat`, `exp` and a `kid` header matching the JWKS key. Default TTL: 1 hour (`JWT_TTL_SECONDS`).

### Error codes

| Code                  | HTTP | Meaning                            |
| --------------------- | ---- | ---------------------------------- |
| `VALIDATION_ERROR`    | 400  | Body/headers failed validation     |
| `INVALID_CREDENTIALS` | 401  | Wrong email or password (login)    |
| `UNAUTHORIZED`        | 401  | Invalid/expired token (`/auth/me`) |
| `EMAIL_TAKEN`         | 409  | Email already registered           |

## Routes

#### `GET /health` — liveness check (public)

#### `POST /auth/register` — create an employee account

```bash
curl -X POST http://localhost:3000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"jane.doe@bank.local","password":"super-secret-1","name":"Jane Doe"}'
# 201 {"id":"<uuid>","email":"jane.doe@bank.local","name":"Jane Doe","createdAt":"…"}
# 409 EMAIL_TAKEN when the email exists (case-insensitive)
```

#### `POST /auth/login` — exchange credentials for a JWT

The compose stack seeds an admin: `admin@bank.local` / `admin12345` (override via `ADMIN_*` env vars).

```bash
curl -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@bank.local","password":"admin12345"}'
# 200 {"token":"eyJ…","tokenType":"Bearer","expiresIn":3600}
```

Use it against the banking API: `Authorization: Bearer <token>`.

#### `GET /auth/me` — who am I

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/auth/me
# 200 {"id":"<uuid>","email":"admin@bank.local","name":"Admin"}
```

#### `GET /.well-known/jwks.json` — public signing keys

Consumed by resource services (e.g. app-apis) to verify tokens. Keys carry `kid` (JWK thumbprint), `alg: ES256`, `use: sig`. Key rotation: deploy the new key here; verifiers refetch automatically on unknown `kid`.

## Signing key configuration

Priority order:

1. `JWT_PRIVATE_KEY_FILE` — path to an ES256 private key (PKCS8 PEM). docker-compose mounts the committed **dev-only** key from [dev/](dev/).
2. `JWT_PRIVATE_KEY` — the PEM inline.
3. Outside production: an ephemeral keypair is generated at boot (all tokens die on restart).

Production refuses to start without a configured key. Generate one:

```bash
pnpm --filter @bank/auth-api generate-dev-key
```
