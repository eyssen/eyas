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
# src/web is its own package (not a workspace). Root node_modules does not
# contain Vite or @vitejs/plugin-react. Nested install also skips `link:`
# packages that are not bun-linked in this image (e.g. @saker/*).
FROM oven/bun:1 AS build-web
WORKDIR /app
COPY scripts/install-nested-package.ts ./scripts/install-nested-package.ts
COPY src/web/package.json src/web/bun.lock* ./src/web/
RUN bun scripts/install-nested-package.ts src/web
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

# Chromium, for design canvas export (PNG/PDF) and reading a brand off a live
# URL. Roughly 350 MB installed, and entirely optional: playwright-core is a
# real dependency but the BROWSER is not, and every feature that wants one
# reports "unavailable" with a remedy instead of failing. Delete this block for
# a smaller image and those two features switch themselves off.
#
# The fonts are not padding. A headless Chromium with no fonts installed
# renders every glyph as a box, and the export looks broken rather than absent.
#
# Note what is NOT set here: EYAS_CHROMIUM_NO_SANDBOX. Chromium's namespace
# sandbox works under Docker's default seccomp profile, and the renderer is
# what executes AI-authored artboard JavaScript, so it stays on. A host that
# forbids unprivileged user namespaces can set that variable explicitly and
# accept the trade-off.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      fonts-dejavu-core \
      fonts-noto-core \
      fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*
ENV EYAS_CHROMIUM_PATH=/usr/bin/chromium

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
