# Single-source server port — Design

**Date:** 2026-07-09
**Status:** Approved (design), pending implementation plan
**Scope owner:** krisz@eyssen.com

## Problem

The backend listen port (`3000`) is currently declared in multiple places, and one of
them silently overrides `config/default.yaml`. Concretely:

- `config/default.yaml:5` → `server.port: 3000` (intended source of truth)
- `src/core/config/schema.ts:7` → Zod `.default(3000)` (fallback when key absent)
- `src/cli/commands/serve.ts:29` → CLI arg `port` with `default: '3000'`
- `src/cli/commands/serve.ts:38` → `parseInt(args.port, 10)` — **always wins over config**
- `src/web/vite.config.ts:17-18` → dev proxy targets hard-coded to `localhost:3000`

Because the `eyas serve` CLI arg has a hard default of `'3000'`, `args.port` is never
absent, so `serve.ts` uses it unconditionally and **ignores `ctx.config.server.port`**.
The `// Override config with CLI args if provided` comment is misleading — the arg is
always "provided" by its default. Result: editing `config/default.yaml` alone does not
change the port under `eyas serve`. Separately, the Vite dev proxy hard-codes `3000`, so
even a working backend port change would break the dev frontend's `/api` and `/ws` calls.

`src/main.ts:24` already reads `ctx.config.server` correctly — it is the `bun dev` entry
point and is not affected by the bug.

## Goal

Make `config/default.yaml` the single edit point for the server port across the
**application runtime** (`bun dev` via `main.ts`, `eyas serve` via `serve.ts`) **and the
Vite dev proxy**. The CLI `--port` / `--host` flags remain as explicit ad-hoc overrides.

### Out of scope (deliberate)

- `docker-compose.yml` (`"3000:3000"`) and `deploy/k8s/*` manifests. These are static
  infra files evaluated by Docker Compose / Helm and cannot import the app config. The
  container-internal app still reads `default.yaml`, so if the yaml port changes, the
  compose right-hand side must be followed manually. This is documented, not automated.
  (Full env-var interpolation — `${EYAS_PORT}` — was considered and rejected to keep a
  single yaml source rather than introducing an env-var source.)
- `schema.ts` Zod `.default(3000)` stays. It is a code-level fallback for a missing key,
  not a competing runtime source: when `default.yaml` sets the key explicitly (it does),
  the yaml value always wins. Left untouched intentionally.

## Design

Three focused changes.

### 1. Backend — `src/cli/commands/serve.ts` (root-cause fix)

Drop the hard CLI defaults so the flags become pure overrides, and fall back to config:

```ts
args: {
  port: { type: 'string', description: 'Server port (overrides config)' },  // no default
  host: { type: 'string', description: 'Server host (overrides config)' },   // no default
  config: { type: 'string', description: 'Config file path', default: 'config/default.yaml' },
},
// ...
const port = args.port ? parseInt(args.port, 10) : ctx.config.server.port
const host = args.host ?? ctx.config.server.host
```

- `--port` / `--host` omitted → value comes from `ctx.config.server` (i.e. `default.yaml`).
- `--port 3100` → explicit override, unchanged behavior.
- `main.ts` already derives from config; no change needed there.
- `host` is fixed alongside `port` because it is the same class of bug (CLI default
  shadowing config) — same two lines, correct root-cause fix, not scope creep.

### 2. Vite dev proxy — `src/web/vite.config.ts`

Read the backend port from `config/default.yaml` at config-eval time and use it for both
proxy targets. The `yaml` package resolves from the repo-root `node_modules` via upward
module resolution (it is a `dependencies` entry, `yaml ^2.7.0`; `src/web/node_modules`
does not have its own copy).

```ts
import { readFileSync, existsSync } from 'fs'
import { parse as parseYaml } from 'yaml'
import { resolve } from 'path'

function backendPort(): number {
  const cfgPath = resolve(__dirname, '../../config/default.yaml')
  if (!existsSync(cfgPath)) return 3000
  const parsed = parseYaml(readFileSync(cfgPath, 'utf-8')) ?? {}
  return parsed?.server?.port ?? 3000
}

const apiPort = backendPort()
// ...
server: {
  port: 5173, // Vite's own dev server — unrelated to the backend port
  proxy: {
    '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true },
    '/ws':  { target: `ws://localhost:${apiPort}`, ws: true },
  },
},
```

- Approach A (small standalone helper) chosen over reusing `loadConfig()`: it keeps the
  frontend build isolated from backend-core modules and avoids fragile `@core` alias /
  `.js`→`.ts` resolution inside the Vite config bundle. Cost: one duplicated `3000`
  fallback literal, accepted.
- Vite's own dev port (`5173`) is the frontend dev server and stays separate.
- In production there is no proxy — `main.ts` serves the built frontend from
  `src/web/dist` same-origin — so this change only affects the `bun dev:web` flow.

### 3. `config/default.yaml`

No structural change; it remains the single edit point. `server.port` stays at `3000` by
default. Editing this one value now propagates to `bun dev`, `eyas serve` (when `--port`
is not passed), and the Vite dev proxy.

## Error handling / fallback

- Missing/unreadable `config/default.yaml` in the Vite helper → fall back to `3000` (dev
  never hard-fails on a missing config).
- Missing `server.port` key → schema `.default(3000)` (backend) / helper `?? 3000` (Vite).
- Invalid config (Zod) → `loadConfig` throws as today; unchanged.

## Testing

- `serve.ts`:
  - `--port` omitted → resolved port equals `ctx.config.server.port`.
  - `--port 3100` → resolved port is `3100` (override wins).
  - same two cases for `--host`.
- Vite helper `backendPort()`:
  - reads the port from a fixture `default.yaml`.
  - returns `3000` when the file is absent.
  - returns `3000` when `server.port` is absent.

## Observations (not addressed here)

`main.ts` and `serve.ts` both stand up the HTTP/WS server via near-duplicate bootstrap
code (two entry paths). This design aligns them on config-derived port/host but does not
merge them — that consolidation is tangential to this change and left for a separate task.
