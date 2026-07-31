# syntax=docker/dockerfile:1
# Build from the repo root: docker build -f apps/telemetry-consumers/Dockerfile .

FROM node:24-alpine AS build
ENV HUSKY=0
RUN npm install -g pnpm@11.17.0
WORKDIR /repo

# Manifests first so dependency resolution is cached across code changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/telemetry-consumers/package.json apps/telemetry-consumers/
COPY packages/db-telemetry/package.json packages/db-telemetry/
COPY packages/db-kit/package.json packages/db-kit/
COPY packages/events/package.json packages/events/
COPY packages/teltonika/package.json packages/teltonika/
COPY tooling/ tooling/
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN pnpm --filter @bank/telemetry-consumers build
RUN pnpm --filter @bank/telemetry-consumers --prod --legacy deploy /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /out .

USER node
EXPOSE 3004

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3004)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "dist/main.js"]
