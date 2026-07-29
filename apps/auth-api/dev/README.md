This ES256 private key is for LOCAL DEVELOPMENT / docker-compose only.
It is intentionally committed so `docker compose up` works with zero setup.
NEVER use it in any real deployment — generate a fresh key with:
pnpm --filter @bank/auth-api generate-dev-key
