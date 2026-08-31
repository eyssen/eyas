# eYssen EYAS 1.0 — Project Instructions

## Overview
EYAS is a personal AI assistant built with TypeScript. Modular architecture, single-process, embedded database. Combines autonomous agent execution, team orchestration, computer use, and multi-channel communication in a single self-hosted platform.

## License
- Project license: **MIT**
- All dependencies MUST be MIT-compatible (MIT, BSD-2, BSD-3, ISC, Apache-2.0)
- **FORBIDDEN licenses**: GPL, LGPL, AGPL, SSPL, CC-BY-SA — always check before adding a new dependency!

## Tech Stack
- Runtime: Bun 1.x (primary), Node.js 22+ (supported fallback)
- Language: TypeScript 5.9+ (strict, ESM, native Bun support)
- HTTP: Hono
- ORM: Drizzle ORM (type-safe, DB-swap: SQLite → PostgreSQL)
- DB: bun:sqlite + Drizzle (primary), better-sqlite3 + Drizzle (Node.js fallback), WAL mode
- Search: Orama (FTS + vector)
- Permissions: CASL
- Config: YAML + Zod validation
- i18n: i18next + react-i18next (namespaces per module)
- Test: Vitest
- Frontend: Vite + React 19 + shadcn/ui + Tailwind + Zustand + TanStack Router
- Memory: Hybrid — DB (working/episodic/archive) + Vault markdown files (semantic/procedural)
- Bot: Grammy (Telegram)

## Code Style
- TypeScript strict mode, ESM modules
- English code and comments
- Hungarian business logic comments where helpful
- Pino for logging (never console.log in production code)
- Zod for all external input validation
- No direct AI SDK calls — always through model module

## Internationalization (i18n) — MANDATORY
- English is the source language; **every** new user-facing string (field, label, button, placeholder, description, toast, error message, etc.) MUST be added in **all six** supported languages: **English (`en`) + Hungarian (`hu`) + German (`de`) + Spanish (`es`) + French (`fr`) + Klingon (`tlh`)**.
- Never hardcode user-facing text in components — route it through the module's i18n `t()` helper and add the key to `en.json`, `hu.json`, `de.json`, `es.json`, `fr.json`, and `tlh.json` in that module's `locales/`.
- The active language is a single explicit choice stored in `stores/language-store.ts`, applied to `document.documentElement.lang`; the per-module `t()` helpers read it and fall back to English for any missing key. First run auto-detects the browser language (if supported), otherwise English.
- Language is user-switchable in the setup wizard (step 1) and in Settings → Appearance.
- Backend-supplied strings that reach the UI (e.g. setup-step titles/descriptions) must likewise provide translations or be routed through i18n; do not leave them English-only.

## Architecture Rules
1. No external service dependencies — everything embedded
2. Module-first — all functionality in modules, communicating via event bus
3. Submodule pattern — modules can contain submodules/ with own manifest, independently toggleable
4. Provider pattern — AI, backup, secrets, auth, search all swappable
5. Extensible frontend — shell + UI Registry, modules register pages/widgets/settings
6. Audit-first — every AI command logged, data snapshots before modifications
7. CASL permission check on every protected endpoint
8. Platform-specific code ONLY in providers/submodules, never in core
9. CSS variables only, never hardcoded colors
10. /api/v1/ prefix for all API endpoints
11. WebSocket for real-time (board, notifications, agent progress)
12. MIT-compatible dependencies only — check license before adding any package

## Current State
**0.8.18-beta** — A desk of its own: new chats pick a project grouped by type; domain notes rank with the type; working directories and catalog connections pin from type to conversation; `search_memory` defaults to current project+type; wiki auto-updates (opt-in) from closed tickets and decisions; conversations stream tool traces, diffs, stop, and plan first; git status/diff skip approval; extra skill/persona roots import without host Claude config; Telegram `/new` + Approve/Deny; data-port copies into the vault (never mounts). See `CHANGELOG.md`.

Previous wave (0.8.17-beta): Hands that make things — Media is optional SaaS prompt→pixel (Magnific, Higgsfield, fal behind five `media_*` tools, none default); Studio is local production (Hyperframes HTML→MP4, Video Use transcript-first cuts); headless `browser_*` tools share EYAS's Chromium with numbered snapshot indexes, a persistent EYAS-owned profile, action cache + TOTP; optional agent-browser / Playwright MCP / Chrome DevTools MCP sidecars fail closed; Recordly is an AGPL third-party catalogue card, never bundled. Handbook rewritten around a first-hour path.

**Headless browser.** `playwright-core` is a real dependency; the browser binary is not. It is resolved from `EYAS_CHROMIUM_PATH`, then Playwright's own registry, then known system paths. Everything that needs one degrades to "unavailable with a remedy" — never a crash, never a silent `--no-sandbox` retry (the renderer runs AI-authored JavaScript; disabling its sandbox takes an explicit `EYAS_CHROMIUM_NO_SANDBOX=1`). Agent `browser_*` tools share that Chromium: numbered snapshot indexes (invalidated on navigation), tabs/back/wait/hover/select/dialog/upload/evaluate/download→Documents, Playwright `storageState`, and an EYAS-owned `userDataDir` (`data/browser/profile` or `EYAS_BROWSER_USER_DATA_DIR`) — never the daily Chrome profile (Chrome 136+ blocks Default-profile CDP). Optional **agent-browser** sidecar (Apache-2.0, not vendored): `EYAS_AGENT_BROWSER_BIN` → PATH, fail-closed doctor, `agent_browser_status` / `agent_browser_run`, MCP `--tools core,state`. Own profile under `data/browser/agent-browser/profile`. Never `chat`. Python `browser_use_exec` stays as a legacy sidecar. Optional **Chrome DevTools MCP** (Google, Apache-2.0, not vendored): coding/debug lane (console, network, Lighthouse, WebMCP) — not form-filling. Catalog `npx chrome-devtools-mcp@latest --isolated`; tools `mcp_chrome-devtools_*`. WebMCP tools only if the sidecar advertises them. `--autoConnect` / daily Chrome profile refused.

### Documentation
- `docs/eyas-architecture.md` — full 57-section architecture spec (with implementation status)
- `docs/eyas-overview.html` — bilingual product overview page
- `packages/docs/` — user/admin product documentation (Astro Starlight, en/hu/de/es/fr/tlh); served by main server at `/docs/`; `bun run docs:build` (auto on start)
- `CHANGELOG.md` — wave-by-wave implementation log

### Implemented Modules
**Core:** config, secrets, auth, permissions, db, bus, http, i18n, logger, websocket, module-loader
**Core Modules:** model (5 providers + Ollama), board, memory, scheduler, search, conversations, audit, agent, skills, self-learning, communication, privacy, security-gate, documents, notifications, prompt-wizard, observability, proactive, knowledge, activity, chatter, tools, skill-evolution, home, design, media, studio
**Extra Modules:** telegram, research, ingress, remote-node, meeting, disaster-recovery, a2a, hand-hub, browser-use

### CLI Commands
- `eyas serve` — Start server
- `eyas doctor` — System diagnostics
- `eyas status` — Query running server
- `eyas config validate|reload` — Config management
- `eyas module list|enable|disable` — Module management
- `eyas version` — Version info

### Docker
- `docker compose up` — Start EYAS (+ optional Ollama with `--profile gpu`)
- `deploy/k8s/` — Kubernetes manifests

### Implementation Phases (from architecture spec)
- Phase 0: Scaffolding (bun init, config, Dockerfile, CLI skeleton)
- Phase 1: Core infrastructure (types, logger, config, SQLite, migration, bus, Hono, i18n, bootstrap)
- Phase 2: Security (secrets, auth, permissions, audit, privacy, security-gate)
- Phase 3: Model module (submodules/providers, decision engine, budget, cache, fallback)
- Phase 4: Board (kanban, task chat, automation, events)
- Phase 5: Memory (5-tier, vector, hybrid search, context builder)
- Phase 6: Agent + Skills + Communication + Documents + Notifications
- Phase 7: Scheduler + Search + Chat
- Phase 8: Extra modules (telegram, self-learning, backup, remote-node, etc.)
- Phase 9: Frontend (Vite + React 19 + shadcn/ui) + Observability
- Phase 10: CLI + Deploy + Polish
