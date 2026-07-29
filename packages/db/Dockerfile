# syntax=docker/dockerfile:1
# Build from the repo root: docker build -f packages/db/Dockerfile .
# One-shot migrate + seed job (the `migrate` service in docker-compose).

FROM node:24-alpine AS build
ENV HUSKY=0
RUN npm install -g pnpm@11.17.0
WORKDIR /repo

# Manifests first so dependency resolution is cached across code changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/db/package.json packages/db/
COPY packages/queue/package.json packages/queue/
COPY packages/shared/package.json packages/shared/
COPY tooling/ tooling/
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN pnpm --filter @bank/db build
# The deploy includes the package's migrations/ folder, which dist/migrate.js
# resolves relative to itself (see src/migrate.ts).
RUN pnpm --filter @bank/db --prod --legacy deploy /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /out .

USER node
CMD ["node", "dist/migrate.js"]
