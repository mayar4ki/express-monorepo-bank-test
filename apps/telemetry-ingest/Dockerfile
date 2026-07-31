# syntax=docker/dockerfile:1
# Build from the repo root: docker build -f apps/telemetry-ingest/Dockerfile .

FROM node:24-alpine AS build
ENV HUSKY=0
RUN npm install -g pnpm@11.17.0
WORKDIR /repo

# Manifests first so dependency resolution is cached across code changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/telemetry-ingest/package.json apps/telemetry-ingest/
COPY packages/events/package.json packages/events/
COPY packages/teltonika/package.json packages/teltonika/
COPY tooling/ tooling/
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN pnpm --filter @bank/telemetry-ingest build
RUN pnpm --filter @bank/telemetry-ingest --prod --legacy deploy /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /out .

USER node
# 3003 serves /health; 5027 is where the devices connect.
EXPOSE 3003 5027

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3003)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "dist/main.js"]
