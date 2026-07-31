# syntax=docker/dockerfile:1
# Build from the repo root: docker build -f packages/db-telemetry/Dockerfile .
# One-shot migrate job for the telemetry cluster (the `migrate-telemetry`
# service in docker-compose). No seed step — vehicles self-register.

FROM node:24-alpine AS build
ENV HUSKY=0
RUN npm install -g pnpm@11.17.0
WORKDIR /repo

# Manifests first so dependency resolution is cached across code changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/db-telemetry/package.json packages/db-telemetry/
COPY packages/db-kit/package.json packages/db-kit/
COPY tooling/ tooling/
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN pnpm --filter @bank/db-telemetry build
# The deploy includes the package's migrations/ folder, which dist/migrate.js
# resolves relative to itself (see src/migrate.ts).
RUN pnpm --filter @bank/db-telemetry --prod --legacy deploy /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /out .

USER node
CMD ["node", "dist/migrate.js"]
