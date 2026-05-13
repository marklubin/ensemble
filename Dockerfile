# Multi-stage Bun image. Builder installs deps + builds the web app;
# runner ships server source + built React assets + production deps.
#
# bun:sqlite database file MUST live on the mounted Fly volume at
# /data/ensemble.sqlite (not in the container FS, which is ephemeral).
# The server reads MEMORY_SQLITE_PATH; fly.toml sets that to /data/...

# ---- builder ----
FROM oven/bun:1 AS builder
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY apps/channel-bridge/package.json ./apps/channel-bridge/
COPY packages/shared/package.json ./packages/shared/
COPY packages/spi-conformance/package.json ./packages/spi-conformance/

RUN bun install --frozen-lockfile

COPY . .

# Build the React frontend → apps/web/dist
RUN cd apps/web && bun run build


# ---- runner ----
FROM oven/bun:1-slim AS runner
WORKDIR /app

# Server source + built assets + production deps only
COPY --from=builder /app/package.json /app/bun.lock ./
COPY --from=builder /app/tsconfig.base.json ./
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/server ./apps/server
COPY --from=builder /app/apps/web/dist ./apps/web/dist

# Stub package.json files for every workspace, so `bun install` doesn't
# see a lockfile drift in the runner stage.
COPY --from=builder /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder /app/apps/channel-bridge/package.json ./apps/channel-bridge/package.json

RUN bun install --frozen-lockfile --production

USER bun

ENV NODE_ENV=production
EXPOSE 4111

CMD ["bun", "run", "apps/server/src/index.ts"]
