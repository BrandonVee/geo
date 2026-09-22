# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24.12.0
ARG PNPM_VERSION=10.33.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/publication/package.json packages/publication/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM base AS release-dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json packages/config/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @geo/db...

FROM dependencies AS builder
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    APP_URL=http://127.0.0.1:3000 \
    APP_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
    REDIS_URL=redis://127.0.0.1:6379/0 \
    BETTER_AUTH_SECRET=container-build-only-auth-secret \
    BETTER_AUTH_URL=http://127.0.0.1:3000 \
    pnpm build

FROM release-dependencies AS release
ENV NODE_ENV=production
ENV DB_APPLICATION_NAME=answerbit-geo-release
COPY --chown=node:node scripts/release-database.mjs ./scripts/release-database.mjs
COPY --chown=node:node packages/config ./packages/config
COPY --chown=node:node packages/core ./packages/core
COPY --chown=node:node packages/db ./packages/db
USER node
CMD ["node", "scripts/release-database.mjs"]

FROM node:${NODE_VERSION}-bookworm-slim AS web
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV DB_APPLICATION_NAME=answerbit-geo-web
WORKDIR /app
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]

FROM node:${NODE_VERSION}-bookworm-slim AS worker
ENV NODE_ENV=production
ENV DB_APPLICATION_NAME=answerbit-geo-worker
WORKDIR /app
COPY --from=builder --chown=node:node /app/apps/worker/dist/index.mjs ./worker.mjs
COPY --from=builder --chown=node:node /app/apps/worker/dist/index.mjs.map ./worker.mjs.map
USER node
CMD ["node", "--enable-source-maps", "worker.mjs"]
