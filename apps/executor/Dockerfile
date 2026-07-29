# syntax=docker/dockerfile:1
# Build from the repo root: docker build -f apps/executor/Dockerfile .

FROM node:24-alpine AS build
ENV HUSKY=0
RUN npm install -g pnpm@11.17.0
WORKDIR /repo

# Manifests first so dependency resolution is cached across code changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/executor/package.json apps/executor/
COPY packages/db/package.json packages/db/
COPY packages/queue/package.json packages/queue/
COPY packages/shared/package.json packages/shared/
COPY tooling/ tooling/
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN pnpm --filter @bank/executor build
RUN pnpm --filter @bank/executor --prod --legacy deploy /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /out .

USER node
EXPOSE 3002

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3002)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "dist/main.js"]
