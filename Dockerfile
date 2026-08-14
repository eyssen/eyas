# ─── Stage 1: Install dependencies ───────────────────────────────────────────
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# ─── Stage 2: Install ALL deps (including devDependencies for build) ─────────
FROM oven/bun:1 AS build-deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# ─── Stage 3: Build backend ─────────────────────────────────────────────────
FROM oven/bun:1 AS build
WORKDIR /app
COPY --from=build-deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

# ─── Stage 4: Build frontend ────────────────────────────────────────────────
FROM oven/bun:1 AS build-web
WORKDIR /app
COPY --from=build-deps /app/node_modules ./node_modules
COPY . .
RUN bun run build:web

# ─── Stage 4b: Build docs (Starlight → static /docs) ────────────────────
FROM oven/bun:1 AS build-docs
WORKDIR /app
COPY packages/docs/package.json packages/docs/bun.lock* ./packages/docs/
WORKDIR /app/packages/docs
RUN bun install --frozen-lockfile || bun install
WORKDIR /app
COPY packages/docs ./packages/docs
WORKDIR /app/packages/docs
RUN bun run build

# ─── Stage 5: Runtime ───────────────────────────────────────────────────────
FROM oven/bun:1-slim AS runtime

RUN addgroup --system eyas && adduser --system --ingroup eyas eyas

WORKDIR /app

# Backend build output
COPY --from=build /app/dist ./dist

# Frontend: serve.ts / main.ts look for src/web/dist OR dist/web
COPY --from=build-web /app/src/web/dist ./src/web/dist
COPY --from=build-web /app/src/web/dist ./dist/web

# Docs: packages/docs/dist OR dist/docs
COPY --from=build-docs /app/packages/docs/dist ./packages/docs/dist
COPY --from=build-docs /app/packages/docs/dist ./dist/docs

# Production dependencies only
COPY --from=deps /app/node_modules ./node_modules

# Config and package.json
COPY --from=build /app/package.json ./
COPY --from=build /app/config ./config

# Data volume for SQLite, documents, vault
VOLUME ["/app/data"]

# Run as non-root
USER eyas

# Canonical listen port (config/default.yaml DEFAULT_SERVER_PORT = 3100)
ENV EYAS_PORT=3100
ENV EYAS_HOST=0.0.0.0
ENV EYAS_INSTALL_ROOT=/app
EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun run dist/main.js --health-check || exit 1

CMD ["bun", "run", "dist/main.js"]
