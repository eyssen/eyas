# eYssen EYAS 1.0 — Modularis Architektura Refaktor

> **Az EYAS egy modularis AI platform, amely autonom agenseket, team-orkesztraciot, computer use-t es multi-channel kommunikaciot egyesit egyetlen rendszerben — self-hosted vagy online, barmilyen AI motorral, a te szabalyaiddal.**

Az EYAS egy szemelyes AI operacios rendszer, amely barhol fut — a sajat laptopodtol a felhoig, barmilyen operacios rendszeren. Barmely AI motort hasznalja: cloud API-kat, elofizeteses szolgaltatasokat vagy akar lokalis modelleket. Teljesen modularis: minden funkcio onallo, cserelheto modul, amelyeket igeny szerint kapcsolhatsz ki-be. Agent team-eket allit ossze es orkesztral parhuzamosan, vezerli a bongeszot es az asztalt, 5 retegu memoriaval es ontanulo rendszerrel folyamatosan fejleszti onmagat. Proaktivan figyeli a feladataidat, javaslatokat tesz, es onalloan cselekszik amikor kell. Nem egy chatbot — egy valodi asszisztens, aki tenyleg mindenhez ert: kutatas, kodolas, dokumentacio, kommunikacio, utemezes, dontestamogatas. Az adat es az iranyitas mindig a tied marad.

---

> **Ez a dokumentum egy teljes implementacios utmutato.** A jelenlegi monolitikus Eyas projektet (~16,000 LOC) alakitjuk at modularis, platformfuggetlen, bovitheto rendszerre.
> A munkat fazisokra bontva, minden fazist tesztelhetoen, mukodo allapotban kell tartani.
> **Platformfuggetlen:** macOS, Linux, Windows (WSL2), Docker, Kubernetes.

---

## Implementation status

Utolso frissites: 2026-04-17. Reszletek a `CHANGELOG.md`-ben es a
`.claude/plans/eyas-full-scope-roadmap.md`-ben.

| Fazis | Statusz | Megjegyzes |
|---|---|---|
| Phase 0 — Scaffolding | ✅ done | bun init, CLI skeleton, config loader |
| Phase 1 — Core infrastructure | ✅ done | types, logger, config, SQLite+Drizzle, bus, Hono, i18n, bootstrap |
| Phase 1 — Security hardening (S1–S9) | ✅ done | Wave 1c (S5/S7/S8) keszen van |
| Phase 2 — Security gate (CaMeL, blocklist, LLM judge) | ✅ done | 3-checkpoint validalas, aktiv |
| Phase 3 — Model module | ✅ done | 5 provider + Ollama, router, budget, cache, gateway retry + tier failover (F2, dormant until a tier fallback is configured) |
| Phase 4 — Board | ✅ done | project-type → project → stage → conversation, automation, events |
| Phase 5 — Memory (5-tier + vault + semantic) | ✅ done | working/episodic/archive/vault/procedural + consolidator |
| Phase 6 — Agent + Skills + Docs + Notifications | ✅ done | agent-runner, skill ecosystem, documents, notifications |
| Phase 7 — Scheduler + Search + Chat | ✅ done | advisory-lock scheduler, graph-rank search, chat streaming |
| Phase 8 — Extra modules | ✅ done | telegram, self-learning, backup, remote-node, a2a, hand-hub |
| Phase 9 — Frontend + Observability | ✅ partial | React shell, Prometheus `/metrics`, OTel tracing live; dynamic module registration in frontend still static |
| Phase 10 — CLI + Deploy + Polish | ✅ partial | CLI commands, Docker, K8s manifests; load test harness pending |

### Roadmap patterns (Phase 3/4/5 of `eyas-full-scope-roadmap.md`)

| Item | File(s) | Statusz |
|---|---|---|
| 3A Event sourcing | `src/modules/event-store/` | ✅ done |
| 3B Checkpoint / resume | `src/modules/agent/checkpoint/` | ✅ done |
| 3C Sleep-time consolidator | `src/modules/memory/consolidation/` | ✅ done |
| 3D Graph-rank context selector | `src/modules/search/graph-rank/` | ✅ done |
| 3E Interactive planning | `src/modules/agent/planning.ts` + `planning-runner.ts` | ✅ done |
| 3F Approval tier mode | `src/modules/security-gate/approval-tiers.ts` | ✅ done + runner integration |
| 3G Flow vs Crew | `src/modules/agent/flow.ts` | ✅ done |
| 3H Artifact-driven handoff | `src/modules/artifacts/` | ✅ done |
| 3I Mission Control | `src/modules/mission-control/` | ✅ done (backend); frontend page pending |
| 3J Skill auto-generation | `src/modules/skill-generation/` | ✅ done |
| 3K Signed metrics | `src/modules/observability/signed-metrics/` | ✅ done |
| 3L Docker-per-tool sandbox | `src/modules/tools/sandbox/docker-runner.ts` | ✅ done |
| 3M ACI output truncation | `src/modules/tools/aci-layer.ts` | ✅ done (opt-in; tool-executor wiring pending) |
| 4A Ops agent | `src/modules/ops/` | ✅ done |
| 4B K8s manifests | `deploy/k8s/` | ✅ done |
| 4C Email triage agent | `src/modules/agent-templates/email-triage/` | ✅ done |
| 4D Ticket-to-code pipeline | `src/modules/pipelines/ticket-to-code/` | ✅ done |
| 4E Client DeepWiki | `src/modules/client-wiki/` | ✅ done |
| 4F Internal benchmark suite | `tests/benchmarks/` | ✅ done |
| 5 Prometheus `/metrics` | `src/modules/observability/prometheus/` | ✅ done + wired |
| 5 OTel distributed tracing | `src/modules/observability/otel/` | ✅ done + wired |
| 5 Frontend dynamic module reg | `src/web/` | ⏳ pending |
| 5 Load test harness | `tests/load/` | ⏳ pending |
| 5 i18n pass | `src/core/i18n/locales/` | ✅ parity guard + approval/planning namespaces |

### Current health

- **Tests:** 259 files / 2346 passing / 3 skipped / 0 failing
- **TypeScript:** 0 errors
- **MIT-compatible deps:** audited; no GPL/LGPL/AGPL/SSPL

---

## Tartalomjegyzek

1. [Kontextus es celok](#1-kontextus-es-celok)
2. [Jelenlegi allapot](#2-jelenlegi-allapot)
3. [Celarchitektura](#3-celarchitektura)
4. [Tech stack](#4-tech-stack)
5. [Konyvtarstruktura](#5-konyvtarstruktura)
6. [Core rendszer](#6-core-rendszer)
7. [Modul rendszer](#7-modul-rendszer)
8. [Model Gateway modul](#8-model-gateway-modul)
9. [Permissions modul](#9-permissions-modul)
10. [Auth modul](#10-auth-modul)
11. [Secret management](#11-secret-management)
12. [Audit modul](#12-audit-modul)
13. [Memory modul](#13-memory-modul)
14. [Agent modul](#14-agent-modul)
15. [Skills modul](#15-skills-modul)
16. [Self-Learning modul](#16-self-learning-modul)
17. [Scheduler modul](#17-scheduler-modul)
18. [Search engine](#18-search-engine)
19. [Communication modul](#19-communication-modul)
20. [Remote Node modul](#20-remote-node-modul)
21. [Research modul](#21-research-modul)
22. [Board modul](#22-board-modul)
23. [Documents modul](#23-documents-modul)
24. [Notifications modul](#24-notifications-modul)
25. [Ingress modul](#25-ingress-modul)
26. [Disaster Recovery modul](#26-disaster-recovery-modul)
27. [Szemelyiseg rendszer](#27-szemelyiseg-rendszer)
28. [CLI interface](#28-cli-interface)
29. [Frontend architektura](#29-frontend-architektura)
30. [Verziozas es upgrade](#30-verziozas-es-upgrade)
31. [Implementacios fazisok](#31-implementacios-fazisok)
32. [Migracios strategia](#32-migracios-strategia)
33. [Tesztelesi strategia](#33-tesztelesi-strategia)
34. [Platformfuggetlenseg](#34-platformfuggetlenseg)
35. [Concurrency es locking](#35-concurrency-es-locking)
36. [API versioning](#36-api-versioning)
37. [Config hot-reload](#37-config-hot-reload)
38. [WebSocket real-time](#38-websocket-real-time)
39. [User module sandboxing](#39-user-module-sandboxing)
40. [Privacy modul](#40-privacy-modul)
41. [Security Gate](#41-security-gate)
42. [Workflow: Guardrails, not rails](#42-workflow-guardrails-not-rails)
43. [Meeting Processing modul](#43-meeting-processing-modul)
44. [Prompt Wizard](#44-prompt-wizard)
45. [Context Engineering Pipeline](#45-context-engineering-pipeline)
46. [AI Observability](#46-ai-observability)
47. [Proaktiv Asszisztens](#47-proaktiv-asszisztens)
48. [A2UI — Agent-to-User Interface](#48-a2ui--agent-to-user-interface)
49. [A2A Protocol — Google Agent-to-Agent](#49-a2a-protocol--google-agent-to-agent)
50. [Conversations modul](#50-conversations-modul)
51. [Knowledge modul](#51-knowledge-modul)
52. [Activity modul](#52-activity-modul)
53. [Chatter modul](#53-chatter-modul)
54. [Tools modul](#54-tools-modul)
55. [Skill Evolution modul](#55-skill-evolution-modul)
56. [Hand Hub modul](#56-hand-hub-modul)

---

## 1. Kontextus es celok
> **Status: [DONE]** — Implemented — project context and goals defined

### Mi az EYAS?
Az EYAS egy modularis AI platform, amely autonom agenseket, team-orkesztraciot, computer use-t es multi-channel kommunikaciot egyesit egyetlen rendszerben — self-hosted vagy online, barmilyen AI motorral, a te szabalyaiddal.

Szemelyes AI operacios rendszer, amely barhol fut — a sajat laptopodtol a felhoig, barmilyen operacios rendszeren. Barmely AI motort hasznalja: cloud API-kat, elofizeteses szolgaltatasokat vagy akar lokalis modelleket. Teljesen modularis: minden funkcio onallo, cserelheto modul, amelyeket igeny szerint kapcsolhatsz ki-be. Agent team-eket allit ossze es orkesztral parhuzamosan, vezerli a bongeszot es az asztalt, 5 retegu memoriaval es ontanulo rendszerrel folyamatosan fejleszti onmagat. Proaktivan figyeli a feladataidat, javaslatokat tesz, es onalloan cselekszik amikor kell. Nem egy chatbot — egy valodi asszisztens, aki tenyleg mindenhez ert: kutatas, kodolas, dokumentacio, kommunikacio, utemezes, dontestamogatas. Az adat es az iranyitas mindig a tied marad.

### Miert kell refaktoralni?
- **Monolitikus**: 30+ fajl a src/ gyokereben, 0 alkonyvtar
- **God file-ok**: admin-api.ts (44K sor), board-api.ts (33K sor)
- **Platform-fuggo**: Docker dependency (MeiliSearch)
- **Nem bovitheto**: nincs modul rendszer, nincs plugin API
- **Nincs koltsegkovetes**: AI model hivasok koltsege kovethetetlen
- **Nincs user kezeles**: egyfelhasznalos, nincs auth
- **Frontend monolitikus**: egyetlen app.js, nincs build pipeline
- **Nincs ontanulas**: nem tanul a sajat tevekenysegebol
- **Nincs audit rollback**: hibak eseten nincs visszaallitasi lehetoseg

### Celok
1. **Modularis architektura** -- core/extra/user modulok, ki-be kapcsolhato
2. **Platformfuggetlen** -- fut macOS, Linux, Windows (WSL2), Docker, K8s-en egyarant
3. **Zero external services** -- minden embedded, egyetlen process
4. **Koltseghatekony AI** -- model gateway budget tracking-gel + funkcio-kotessel
5. **Multi-user ready** -- RBAC jogosultsag kezeles oroklessel
6. **Bovitheto** -- user modulok, provider-ek, temak, skill-ek
7. **i18n** -- tobbnyelvuseg tamogatas
8. **Megoszthat** -- kod es adat elkulonitve, GitHub-ready
9. **Ontanulo** -- sajat tevekenysegebol tanul, javit, javasol
10. **Auditalhato** -- minden muvelet logolhato es visszaallithato
11. **Multi-channel** -- Telegram, Slack, Discord, Email, MCP, stb.
12. **Remote-ready** -- tavoli node-ok elerhesege, cloud-native deployment
13. **Agent-first** -- bonyolult feladatokra automatikus agent team osszeallitas

---

## 2. Jelenlegi allapot
> **Status: [DONE]** — Implemented — legacy state documented, clean slate applied

### Forraskod elhelyezkedes

A teljes projekt a ~/eyas/ konyvtarban talalhato.

Jelenlegi struktura:
- src/ -- MINDEN TypeScript fajl flat strukturaban (30+ fajl, 0 alkonyvtar)
- public/ -- Frontend (vanilla JS): index.html, admin.html, app.js (8.6K), style.css
- store/ -- Runtime data (DB, lock, cache)
- logs/ -- Log fajlok
- scripts/ -- Setup scriptek
- docker-compose.yml -- MeiliSearch container

Fo fajlok es meretuk:
- index.ts -- Entry point + scheduler + lock
- db.ts -- SQLite singleton + inline schema
- config.ts -- Config + lazy secrets
- web.ts -- HTTP szerver (nativ http, kezi routing) -- 14.5K sor
- admin-api.ts -- Admin REST endpoints -- 44.6K sor (!)
- board-api.ts -- Board REST endpoints -- 33K sor
- board-tasks.ts -- Task CRUD logic -- 31.7K sor
- board-db.ts -- Board schema + queries -- 24.1K sor
- chat-api.ts -- Chat SSE streaming -- 12.5K sor
- memory.ts -- 5-tier memory system -- 22K sor
- telegram-bot.ts -- Grammy bot -- 10.9K sor
- bot-executor.ts -- Bot task runner -- 9.9K sor
- model-router.ts -- Model selection (keyword + haiku classifier)
- agent.ts -- Claude Agent SDK wrapper
- sdk-runner.ts -- Masodik SDK wrapper (duplikalt!)
- scheduler.ts -- Tick-based job scheduler
- code-indexer.ts -- MeiliSearch code indexer -- 17.2K sor
- docs-indexer.ts -- MeiliSearch docs indexer -- 19.2K sor
- policy.ts -- RBAC policy engine
- audit.ts -- Audit logging
- backup.ts -- B2 backup -- 13K sor

### Jelenlegi tech stack
- Runtime: Node.js 20+, TypeScript strict mode
- HTTP: Nativ Node.js http modul, kezi routing
- DB: better-sqlite3 (WAL mode), inline schema
- Search: MeiliSearch (Docker container!)
- Bot: Grammy (Telegram)
- AI: @anthropic-ai/claude-agent-sdk
- Logger: Pino
- Secrets: file-based encrypted storage
- Test: Vitest
- Frontend: Vanilla JS, no build

### Git branch
A refaktor a feat/dark-observatory-redesign branch-rol indul. Utolso commit: 9e1ad25.

---

## 3. Celarchitektura
> **Status: [DONE]** — Implemented — modular architecture realized in src/

### Architektura diagram

```
+------------------------------------------------------------------------+
|                        eYssen EYAS 1.0 Process                         |
|                                                                        |
|  +--- CORE / BASE (mindig fut, nem kapcsolhato ki) ----------------+  |
|  | bootstrap - module-loader - gateway                              |  |
|  | config(YAML+Zod+hot-reload) - secrets - auth - permissions       |  |
|  | db(SQLite+FTS5+Vec) - bus(Local/NATS) - http(Hono+WS)           |  |
|  | logger(Pino) - i18n - locking                                    |  |
|  +-----------------------------+------------------------------------+  |
|                                | module API + submodule API             |
|  +-----------------------------v------------------------------------+  |
|  |                         MODULES                                  |  |
|  |                                                                  |  |
|  |  CORE MODULES (ki/be)     EXTRA MODULES (ki/be)  USER MODULES   |  |
|  |  +-----------------+     +-----------------+     config/         |  |
|  |  | model           |     | telegram        |     user-modules/   |  |
|  |  |  ├ claude-api    |     | slack           |                     |  |
|  |  |  ├ claude-code   |     | discord         |                     |  |
|  |  |  ├ ollama        |     | email           |                     |  |
|  |  |  └ openai        |     | backup          |                     |  |
|  |  | board            |     | webhooks        |                     |  |
|  |  | memory (hybrid)  |     | siri            |                     |  |
|  |  | scheduler (adv)  |     | remote-node     |                     |  |
|  |  | search           |     | research        |                     |  |
|  |  | chat             |     | meeting         |                     |  |
|  |  | audit (rollback) |     | odoo            |                     |  |
|  |  | agent (teams)    |     | ingress         |                     |  |
|  |  | skills           |     | disaster-rec    |                     |  |
|  |  | self-learning    |     +-----------------+                     |  |
|  |  | communication    |                                             |  |
|  |  | privacy          |     Almodul rendszer:                       |  |
|  |  | security-gate    |     Minden modul tartalmazhat submodules/    |  |
|  |  | documents        |     amelyek sajat manifest.ts-sel, sajat    |  |
|  |  | notifications    |     frontend/ mappaval rendelkeznek es      |  |
|  |  +-----------------+     onalloan ki/be kapcsolhatok.             |  |
|  +------------------------------------------------------------------+  |
|                                                                        |
|  +--- EMBEDDED SERVICES -------------------------------------------+  |
|  | SQLite (relational + FTS5) | Orama (FTS + vector) | sqlite-vec  |  |
|  +------------------------------------------------------------------+  |
|                                                                        |
|  +--- FRONTEND (modularis, bovitheto) -----------------------------+  |
|  | Shell (layout, navigation, module-slot)                          |  |
|  | UI Registry: modulok regisztraljak pages/widgets/settings-jukat  |  |
|  | Web: Vite + React 19 + shadcn/ui + Tailwind                     |  |
|  | Desktop: Electron/Tauri wrapper (ugyanaz a React kod)            |  |
|  | Mobile: React Native (megosztott uzleti logika, nativ UI)        |  |
|  +------------------------------------------------------------------+  |
+------------------------------------------------------------------------+
          |                    |                    |
     Remote Nodes         MCP Servers         Comm Channels
     (SSH/WS/Tailscale)   (external tools)    (TG/Slack/Email)
```

### Alapelvek
1. **Single process** -- minden embedded, nincs kulso service dependency
2. **Module-first** -- minden funkcio modul, modulok az event bus-on kommunikalnak
3. **Submodule pattern** -- modulok tartalmazhatnak almodulokat (submodules/), amelyek onalloan ki/be kapcsolhatok, sajat manifest-tel es frontend kiegeszitessel rendelkeznek
4. **Provider pattern** -- AI, backup, secrets, auth, search, vector, permissions mind cserelheto provider-ekkel
5. **Code vs data** -- tiszta szeparacio, a src/ megoszthato GitHub-on
6. **Config as YAML** -- emberileg olvashato, Zod-dal validalt konfiguracio
7. **Personality files** -- Eyas viselkedese szerkesztheto YAML fajlokbol
8. **Platform-agnostic** -- nulla platform-specifikus fugges a core-ban; provider pattern-nel kezeljuk az OS-specifikus dolgokat (pl. Keychain vs encrypted-file)
9. **Extensible frontend** -- a frontend egy shell (layout + navigation + module-slot), amelyet minden modul es almodul bovithet sajat pages/widgets/settings komponensekkel egy kozponti UI Registry-n keresztul
10. **Cross-platform frontend** -- ugyanaz a React kodban web (Vite), desktop (Electron/Tauri) es mobil (React Native) alkalmazaskent is futhat
11. **Open source first** -- ahol van jo, aktivan karbantartott open source megoldas, azt hasznaljuk
12. **Audit-first** -- minden AI altal kiadott parancs logolva, adatmodositas elott eredeti adat mentve
13. **Self-improving** -- a rendszer elemzi sajat hatekonysagat es javaslatokat tesz
14. **MIT license** -- a projekt MIT licence alatt jon ki, MINDEN fuggoseg MIT-kompatibilis kell legyen (MIT, BSD-2, BSD-3, ISC, Apache-2.0 elfogadott; GPL, LGPL, AGPL, SSPL TILTOTT)

---

## 4. Tech stack
> **Status: [DONE]** — Implemented — full tech stack as specified

### Runtime es nyelv

- Runtime: Bun 1.x (elsodleges), Node.js 22+ (tamogatott fallback)
- Nyelv: TypeScript 5.9+ (strict mode, nativ Bun tamogatas — nincs transpile lepes)
- Package manager: bun (Bun nativ), pnpm (Node.js fallback)
- Test: Vitest
- ORM: Drizzle ORM (type-safe, DB-swap tamogatas: SQLite → PostgreSQL)
- SQLite: bun:sqlite + Drizzle (elsodleges), better-sqlite3 + Drizzle (Node.js fallback)
- i18n: i18next + react-i18next (namespace-ek modulonkent)

### Licence

- Projekt licence: **MIT**
- Fuggoseg licence kovetelmeny: **MIT-kompatibilis** (MIT, BSD-2, BSD-3, ISC, Apache-2.0)
- **TILTOTT licencek**: GPL, LGPL, AGPL, SSPL, CC-BY-SA — ezek nem kompatibilisek az MIT licence-szel
- Uj fuggoseg hozzaadasakor MINDIG ellenorizni kell a licencet!

### Library-k

| Lib | Meret | Cel |
|-----|-------|-----|
| Hono | ~14KB | HTTP: Route groups, middleware, SSE, WebSocket |
| Drizzle ORM | ~50KB | ORM: Type-safe queries, DB-swap (SQLite → PostgreSQL) |
| better-sqlite3 | ~2MB | Relacios DB (Node.js fallback) |
| @orama/orama | ~50KB | Search: Full-text + vector search, embedded |
| sqlite-vec | ~1MB | Vector: SQLite extension, vector similarity |
| CASL (@casl/ability) | ~15KB | Permissions: Attribute-based, hierarchikus, isomorphic |
| Zod | ~2KB | Validation: API + config schema |
| i18next | ~40KB | i18n: Runtime translations, namespace-ek modulonkent |
| react-i18next | ~10KB | i18n: React integraciok (useTranslation hook) |
| unified + remark | ~30KB | Markdown: Vault parsing, [[wikilink]] felismeres |
| Vite | dev-only | Frontend build: HMR, TypeScript |
| React 19 | ~40KB | Frontend UI: Component library |
| shadcn/ui + Tailwind | dev-only | UI kit: copy-paste components, utility CSS |
| Zustand | ~2KB | State management: lightweight store |
| TanStack Router | ~20KB | Routing: type-safe, file-based |
| React Flow | ~150KB | Agent graph: org chart, agent connections |
| dnd-kit | ~30KB | Drag-and-drop: team builder |
| Recharts | ~100KB | Charts: token usage dashboards |
| Croner | ~8KB | Cron: parsing + execution |
| age (rage) | ~3MB | Encryption: Cross-platform secret encryption |
| Pino | ~30KB | Logging: Fast structured JSON logger |
| Grammy | ~100KB | Telegram bot framework |
| @anthropic-ai/claude-agent-sdk | ~200KB | Claude Code CLI provider |
| streamdown | ~60KB | Markdown: Streaming-aware rendering (Vercel), GFM, Shiki syntax highlight |

### Marado library-k (nem valtoznak)

- Drizzle ORM -- Type-safe DB reteg (SQLite es PostgreSQL tamogatas)
- better-sqlite3 -- Relacios adat (Node.js fallback)
- Pino -- Logging
- Grammy -- Telegram bot
- @anthropic-ai/claude-agent-sdk -- Claude Code CLI provider

### Valtozasok az eredeti tervhez kepest

- meilisearch (npm) -- Orama valtja ki
- MeiliSearch (Docker) -- Nincs tobbe Docker dependency
- cron-parser -- Croner valtja ki
- Nativ http szerver kod -- Hono valtja ki
- Lit -- React 19 + shadcn/ui valtja ki (frontend ujrairva)
- typesafe-i18n -- i18next valtja ki (nagyobb okoszisztema, namespace-ek modulonkent)
- Raw SQL -- Drizzle ORM valtja ki (type-safe, DB-swap tamogatas)

### Provider-pattern konyvtarak (minden cserelheto)

| Terulet | Default provider | Alternativ provider(k) |
|---------|-----------------|----------------------|
| Secret storage | encrypted-file (age) | env vars, K8s secrets |
| Vector search | Orama vectors | sqlite-vec |
| Full-text search | Orama FTS | SQLite FTS5 |
| AI model | Claude API | Claude Code CLI, Ollama, OpenAI |
| Backup | Local | Backblaze B2, AWS S3 |
| Auth | Local (jelszo/PIN) | Telegram, API key, OAuth |
| Comm channel | Telegram | Slack, Discord, Email, WebChat |
| Remote access | SSH | WebSocket, Tailscale |

---

## 5. Konyvtarstruktura
> **Status: [DONE]** — Implemented — directory structure in src/core/, src/modules/, src/web/

```
eyas/
|-- src/
|   |-- core/                              # Core / Base motor (mindig fut, nem kapcsolhato ki)
|   |   |-- bootstrap.ts                   # Entry point, lifecycle, module loading
|   |   |-- module-loader.ts               # Module + submodule discovery, dependency resolution, lifecycle
|   |   |-- types.ts                       # EyasModule, SubmoduleManifest, FrontendManifest, Hook, Provider interfaces
|   |   |-- db/
|   |   |   |-- connection.ts              # Drizzle + bun:sqlite / better-sqlite3, WAL mode
|   |   |   |-- schema.ts                 # Drizzle schema definiciok (core tablak)
|   |   |   +-- migrations/               # drizzle-kit altal generalt migraciok
|   |   |-- config/
|   |   |   |-- config.ts                  # Config registry + Zod schemas
|   |   |   |-- env.ts                     # .env parser (platform-agnostic)
|   |   |   |-- loader.ts                  # YAML config loader
|   |   |   +-- watcher.ts                # Config hot-reload (fs.watch + Zod validation)
|   |   |-- http/
|   |   |   |-- server.ts                  # Hono app factory (/api/v1/ prefix)
|   |   |   |-- websocket.ts              # WebSocket manager (real-time updates)
|   |   |   |-- middleware/
|   |   |   |   |-- auth.ts               # JWT/API-key/Telegram verification
|   |   |   |   |-- cors.ts
|   |   |   |   |-- rate-limit.ts
|   |   |   |   +-- error-handler.ts
|   |   |   +-- static.ts                 # Static file serving (prod build)
|   |   |-- bus/
|   |   |   |-- local-bus.ts              # EventEmitter-based (default, single instance)
|   |   |   +-- types.ts                  # Bus interface definitions
|   |   |-- i18n/
|   |   |   |-- setup.ts                  # i18next inicializalas
|   |   |   |-- locales/
|   |   |   |   |-- hu/common.json        # Magyar (default)
|   |   |   |   +-- en/common.json        # English
|   |   |   +-- types.ts                  # Namespace tipusok
|   |   +-- logger.ts                      # Pino setup
|   |
|   |-- modules/                           # Beepitett modulok
|   |   |-- secrets/                       # Secret management (CORE)
|   |   |   |-- manifest.ts
|   |   |   |-- manager.ts                # get/set/delete/list unified API
|   |   |   +-- providers/
|   |   |   |-- crypto.ts                  # Encryption utilities
|   |   |   |-- master-key.ts             # Master key management (file-based)
|   |   |   |-- registry.ts              # Secret provider registry
|   |   |   |-- schema.ts                # Drizzle schema
|   |   |   +-- types.ts                  # SecretProvider interface
|   |   |
|   |   |-- auth/                          # User management (CORE)
|   |   |   |-- manifest.ts
|   |   |   |-- users.ts                  # User CRUD + profil
|   |   |   |-- tokens.ts                # JWT session + API key management
|   |   |   |-- middleware.ts             # Hono auth middleware
|   |   |   +-- providers/
|   |   |       |-- types.ts              # AuthProvider interface
|   |   |       |-- local.ts             # Jelszo/PIN (single user)
|   |   |       |-- telegram.ts          # Telegram chat_id based
|   |   |       |-- api-key.ts           # API key (external integrations)
|   |   |       +-- oauth.ts             # OAuth2 (GitHub, Google, stb.)
|   |   |
|   |   |-- permissions/                   # Permission management (CORE)
|   |   |   |-- manifest.ts
|   |   |   |-- engine.ts                # CASL-based permission engine
|   |   |   |-- roles.ts                 # Role definitions
|   |   |   |-- inheritance.ts           # Global -> Project -> Task orokles
|   |   |   |-- constraints.ts           # Resource constraints
|   |   |   |-- middleware.ts             # Hono permission middleware
|   |   |   +-- tests/
|   |   |
|   |   |-- model/                          # AI provider routing (CORE, ki/be kapcsolhato)
|   |   |   |-- manifest.ts
|   |   |   |-- gateway.ts               # Egyetlen entry point; same-provider retry + tier
|   |   |   |                            #   failover inline (F2 D10) — no separate fallback.ts
|   |   |   |-- router.ts                # Model + provider selection
|   |   |   |-- decision-engine.ts       # Multi-signal dontes
|   |   |   |-- function-binding.ts      # Funkciokhoz kotott model konfiguracio
|   |   |   |-- budget.ts                # Cost tracking + limits + alerts
|   |   |   |-- tracker.ts               # Token counting + analytics
|   |   |   |-- cache.ts                 # Response cache
|   |   |   |-- queue.ts                 # Request queue + rate limiting
|   |   |   |-- strategies/
|   |   |   |   |-- types.ts             # RoutingStrategy interface
|   |   |   |   |-- keyword.ts           # Keyword-based (0 cost)
|   |   |   |   |-- metadata.ts          # Message metadata analysis (0 cost)
|   |   |   |   |-- function-match.ts    # Function binding lookup (0 cost)
|   |   |   |   |-- history-pattern.ts   # Past query pattern match (0 cost)
|   |   |   |   |-- classifier.ts        # LLM-based classification
|   |   |   |   |-- hybrid.ts            # Multi-signal cascade
|   |   |   |   +-- fixed.ts             # Always same model (debug/test)
|   |   |   |-- submodules/               # AI provider almodulok (onalloan ki/be kapcsolhato)
|   |   |   |   |-- claude-api/
|   |   |   |   |   |-- manifest.ts      # Almodul manifest
|   |   |   |   |   |-- provider.ts      # AIProvider implementacio
|   |   |   |   |   +-- frontend/
|   |   |   |   |       +-- claude-api-settings.tsx
|   |   |   |   |-- claude-code/
|   |   |   |   |   |-- manifest.ts
|   |   |   |   |   +-- provider.ts
|   |   |   |   |-- ollama/
|   |   |   |   |   |-- manifest.ts
|   |   |   |   |   |-- provider.ts
|   |   |   |   |   +-- frontend/
|   |   |   |   |       +-- ollama-settings.tsx
|   |   |   |   +-- openai/
|   |   |   |       |-- manifest.ts
|   |   |   |       +-- provider.ts
|   |   |   +-- frontend/
|   |   |       |-- register.ts          # UI Registry regisztracio
|   |   |       +-- pages/
|   |   |           +-- model-dashboard.tsx
|   |   |
|   |   |-- audit/                         # Audit logging + rollback (CORE)
|   |   |   |-- manifest.ts
|   |   |   |-- logger.ts                # Action logging
|   |   |   |-- snapshots.ts             # Pre-action adatmentes
|   |   |   |-- rollback.ts              # Visszaallitas audit logbol
|   |   |   |-- replay.ts                # Tevekenyseg visszajatszas
|   |   |   |-- diff-tracker.ts          # Fajl valtozasok elotte/utana
|   |   |   |-- retention.ts             # Audit log megorzesi szabalyok
|   |   |   +-- tests/
|   |   |
|   |   |-- memory/                        # Hybrid memory system (CORE)
|   |   |   |-- manifest.ts
|   |   |   |-- memory-service.ts         # Save, retrieve, search (unified API mindket backend-re)
|   |   |   |-- tiers/
|   |   |   |   |-- working-memory.ts     # Session-scoped short-term (DB)
|   |   |   |   |-- episodic-memory.ts    # Event-based memories (DB)
|   |   |   |   +-- archive-memory.ts     # Low-salience compressed (DB)
|   |   |   |-- vault/                     # Markdown-alapu tudasbazis
|   |   |   |   |-- vault-service.ts      # Vault CRUD (read/write/delete .md fajlok)
|   |   |   |   |-- vault-indexer.ts      # Markdown → DB index (FTS + metadata + linkek)
|   |   |   |   |-- vault-watcher.ts      # fs.watch — fajl valtozas → ujraindexeles
|   |   |   |   |-- wikilink-parser.ts    # [[wikilink]] felismeres + graf epites
|   |   |   |   +-- frontmatter.ts        # YAML frontmatter parse/serialize
|   |   |   |-- search/
|   |   |   |   |-- hybrid-search.ts      # FTS + vector kombinalas (DB + Vault)
|   |   |   |   |-- graph-search.ts       # [[wikilink]] graf traversal
|   |   |   |   +-- context-builder.ts    # Relevans emlekek injektalasa AI query-kbe
|   |   |   |-- vector/
|   |   |   |   |-- types.ts              # VectorProvider interface
|   |   |   |   |-- orama-vectors.ts      # Orama beepitett vector search
|   |   |   |   +-- sqlite-vec.ts         # SQLite vec extension
|   |   |   |-- embeddings/
|   |   |   |   |-- types.ts              # EmbeddingProvider interface
|   |   |   |   |-- ollama-embeddings.ts  # Lokalis embedding (Ollama)
|   |   |   |   +-- api-embeddings.ts     # API embedding (OpenAI/Voyage/Claude)
|   |   |   |-- decay.ts                  # Salience decay + archival (DB tiers)
|   |   |   |-- consolidation.ts          # Duplicate merge + clustering (weekly)
|   |   |   +-- tests/
|   |   |
|   |   |-- agent/                         # Agent orchestrator + teams (CORE)
|   |   |   |-- manifest.ts
|   |   |   |-- orchestrator.ts           # Task routing, team assembly
|   |   |   |-- agent-registry.ts         # Agent definiciok kezelese (YAML)
|   |   |   |-- team-builder.ts           # Automatikus team javaslat
|   |   |   |-- parallel-executor.ts      # Parhuzamos agent futtatas
|   |   |   |-- agent-to-agent.ts         # Agent-ek kozotti kommunikacio
|   |   |   |-- worktree.ts              # Git worktree izolacio
|   |   |   |-- executor.ts              # Task execution engine
|   |   |   |-- qc-loop.ts              # Self-validating QA loop
|   |   |   |-- merge-resolver.ts        # AI-powered conflict resolution
|   |   |   +-- tests/
|   |   |
|   |   |-- skills/                        # Skill management (CORE)
|   |   |   |-- manifest.ts
|   |   |   |-- skill-registry.ts         # Skill regisztralas/kereses
|   |   |   |-- skill-loader.ts           # .md fajl alapu skill betoltes
|   |   |   |-- skill-matcher.ts          # Automatikus skill aktivalas relevancia alapjan
|   |   |   |-- skill-creator.ts          # Skill generalas ismetlodo feladatokbol
|   |   |   |-- skill-hub.ts             # Tavoli skill registry (import/export)
|   |   |   +-- tests/
|   |   |
|   |   |-- self-learning/                 # Ontanulo rendszer (CORE)
|   |   |   |-- manifest.ts
|   |   |   |-- activity-analyzer.ts      # Elmult X nap elemzese
|   |   |   |-- pattern-detector.ts       # Ismetlodo mintak felismerese
|   |   |   |-- ai-news-scanner.ts        # AI hirek + relevans javaslatok
|   |   |   |-- efficiency-reporter.ts    # Token hatekonsag, ido-megtakaritas
|   |   |   |-- skill-recommender.ts      # Skill javaslat ismetlodo feladatokbol
|   |   |   |-- agent-recommender.ts      # Agent javaslat hianytipusokra
|   |   |   |-- config-optimizer.ts       # Routing, budget finomhangolas javaslatok
|   |   |   +-- tests/
|   |   |
|   |   |-- scheduler/                     # Advanced job scheduler (CORE)
|   |   |   |-- manifest.ts
|   |   |   |-- scheduler.ts              # Croner-based job registry
|   |   |   |-- cron-db.ts               # Job history + metadata
|   |   |   |-- recurring.ts             # Recurring task templates
|   |   |   |-- triggers/
|   |   |   |   |-- types.ts             # Trigger interface
|   |   |   |   |-- time-trigger.ts      # Cron expression
|   |   |   |   |-- event-trigger.ts     # Bus event triggerel
|   |   |   |   |-- webhook-trigger.ts   # Kulso webhook triggerel
|   |   |   |   |-- file-trigger.ts      # Fajl valtozas (fs.watch)
|   |   |   |   +-- condition-trigger.ts # Feltetel teljesul
|   |   |   |-- chains/
|   |   |   |   |-- chain-builder.ts     # A-B-C feladat lanc
|   |   |   |   |-- chain-executor.ts    # Lanc vegrehaitas hibakezelesselel
|   |   |   |   +-- chain-templates.ts   # Elodefinialt lanc sablonok
|   |   |   |-- retry-policy.ts          # Retry strategia hiba eseten
|   |   |   |-- dead-letter.ts           # Tobbszor hiba kezeles
|   |   |   +-- tests/
|   |   |
|   |   |-- search/                        # Search engine (CORE)
|   |   |   |-- manifest.ts
|   |   |   |-- engine.ts                 # Unified search interface
|   |   |   |-- providers/
|   |   |   |   |-- types.ts             # SearchProvider interface
|   |   |   |   |-- orama.ts             # Orama embedded (full-text + vector)
|   |   |   |   +-- sqlite-fts5.ts       # SQLite FTS5 (board/tasks)
|   |   |   |-- indexers/
|   |   |   |   |-- code-indexer.ts
|   |   |   |   +-- docs-indexer.ts
|   |   |   +-- tests/
|   |   |
|   |   |-- chat/                          # Web chat SSE streaming (CORE)
|   |   |   |-- manifest.ts
|   |   |   |-- api.ts                   # POST /api/chat/stream
|   |   |   |-- session-manager.ts       # Chat session lifecycle
|   |   |   +-- tests/
|   |   |
|   |   |-- communication/                 # MCP + channel routing (CORE)
|   |   |   |-- manifest.ts
|   |   |   |-- mcp/
|   |   |   |   |-- mcp-server.ts        # Eyas mint MCP szerver
|   |   |   |   |-- mcp-client.ts        # Eyas MCP klienskent
|   |   |   |   +-- mcp-registry.ts      # Elerheto MCP szerverek
|   |   |   |-- channel-router.ts        # Uzenet routing csatornak kozott
|   |   |   |-- channel-types.ts         # Channel interface
|   |   |   +-- tests/
|   |   |
|   |   |-- board/                         # Kanban task management (CORE)
|   |   |   |-- manifest.ts
|   |   |   |-- db/
|   |   |   |   |-- schema.ts            # tasks, task_messages, task_summaries, task_messages_archive
|   |   |   |   +-- queries.ts
|   |   |   |-- api/
|   |   |   |   |-- projects.ts
|   |   |   |   |-- stages.ts
|   |   |   |   |-- tasks.ts
|   |   |   |   |-- subtasks.ts
|   |   |   |   |-- tags.ts
|   |   |   |   +-- assignees.ts
|   |   |   |-- services/
|   |   |   |   |-- task-service.ts
|   |   |   |   |-- event-service.ts
|   |   |   |   |-- conversation-service.ts
|   |   |   |   +-- message-archiver.ts   # Message tomorites + archivalas
|   |   |   +-- tests/
|   |   |
|   |   |-- documents/                     # Document management (CORE)
|   |   |   |-- manifest.ts
|   |   |   |-- document-service.ts       # Upload, download, delete, list
|   |   |   |-- retention.ts             # Local cache retention policy
|   |   |   |-- cleanup.ts              # Torles kezeles (local + remote)
|   |   |   |-- thumbnail.ts            # Thumbnail generalas
|   |   |   |-- storage/
|   |   |   |   |-- types.ts             # StorageProvider interface
|   |   |   |   |-- local.ts            # Local filesystem
|   |   |   |   +-- s3.ts               # S3-kompatibilis (B2, AWS S3, MinIO)
|   |   |   +-- tests/
|   |   |
|   |   |-- notifications/                # Notification system (CORE)
|   |   |   |-- manifest.ts
|   |   |   |-- notification-service.ts   # Kozponti ertesites kuldes
|   |   |   |-- router.ts               # Melyik csatornara, kinek
|   |   |   |-- preferences.ts          # User preferenciak kezelese
|   |   |   |-- templates.ts            # Ertesites sablonok (i18n)
|   |   |   +-- tests/
|   |   |
|   |   |-- telegram/                      # Telegram bot (EXTRA)
|   |   |   |-- manifest.ts
|   |   |   |-- bot.ts
|   |   |   |-- commands/
|   |   |   +-- tests/
|   |   |
|   |   |-- slack/                         # Slack integration (EXTRA)
|   |   |   |-- manifest.ts
|   |   |   |-- bot.ts
|   |   |   +-- tests/
|   |   |
|   |   |-- discord/                       # Discord integration (EXTRA)
|   |   |   |-- manifest.ts
|   |   |   |-- bot.ts
|   |   |   +-- tests/
|   |   |
|   |   |-- email/                         # Email integration (EXTRA)
|   |   |   |-- manifest.ts
|   |   |   |-- imap-listener.ts
|   |   |   |-- smtp-sender.ts
|   |   |   +-- tests/
|   |   |
|   |   |-- remote-node/                   # Remote node management (EXTRA)
|   |   |   |-- manifest.ts
|   |   |   |-- node-registry.ts
|   |   |   |-- node-client.ts
|   |   |   |-- node-server.ts           # Lightweight daemon tavoli gepen
|   |   |   |-- capabilities.ts
|   |   |   |-- node-invoke.ts
|   |   |   |-- providers/
|   |   |   |   |-- types.ts
|   |   |   |   |-- ssh.ts
|   |   |   |   |-- ws.ts
|   |   |   |   +-- tailscale.ts
|   |   |   +-- tests/
|   |   |
|   |   |-- research/                      # AI news + tech research (EXTRA)
|   |   |   |-- manifest.ts
|   |   |   |-- web-search.ts
|   |   |   |-- news-aggregator.ts
|   |   |   |-- trend-analyzer.ts
|   |   |   |-- competitor-watch.ts
|   |   |   +-- tests/
|   |   |
|   |   |-- backup/                        # Backup system (EXTRA)
|   |   |   |-- manifest.ts
|   |   |   |-- manager.ts
|   |   |   +-- providers/
|   |   |       |-- types.ts
|   |   |       |-- b2.ts
|   |   |       |-- s3.ts
|   |   |       +-- local.ts
|   |   |
|   |   |-- webhooks/                      # Webhook handling (EXTRA)
|   |   |   |-- manifest.ts
|   |   |   |-- handler.ts
|   |   |   +-- tests/
|   |   |
|   |   |-- ingress/                       # Remote access gateway (EXTRA)
|   |   |   |-- manifest.ts
|   |   |   |-- ingress-manager.ts       # Tunnel lifecycle
|   |   |   |-- auth-proxy.ts           # Extra auth layer
|   |   |   |-- providers/
|   |   |   |   |-- types.ts
|   |   |   |   |-- cloudflare-tunnel.ts
|   |   |   |   |-- tailscale.ts
|   |   |   |   +-- wireguard.ts
|   |   |   +-- tests/
|   |   |
|   |   |-- privacy/                        # Szenzitiv adat vedelem (CORE)
|   |   |   |-- manifest.ts
|   |   |   |-- privacy-engine.ts          # Scanner chain orchestrator
|   |   |   |-- scanners/
|   |   |   |   |-- types.ts              # PiiScanner interface
|   |   |   |   |-- regex-scanner.ts      # Beepitett regex mintak (magyar + nemzetkozi PII)
|   |   |   |   |-- ner-scanner.ts        # Opcionalis NER modell (GLiNER-PII, Ollama)
|   |   |   |   +-- custom-scanner.ts     # User-defined YAML szabalyok
|   |   |   |-- policies/
|   |   |   |   |-- policy-engine.ts      # YAML policy betoltes + dontes
|   |   |   |   +-- actions.ts            # auto_local, warn, block, sanitize
|   |   |   +-- tests/
|   |   |
|   |   |-- security-gate/                 # 3-checkpoint parancs-validacio (CORE)
|   |   |   |-- manifest.ts
|   |   |   |-- gate-orchestrator.ts       # Pipeline vezerlo (Green/Yellow/Red tier routing)
|   |   |   |-- checkpoints/
|   |   |   |   |-- deterministic-gate.ts  # CP1: Regex blocklist, attack patterns, Rule of Two, rate limit
|   |   |   |   |-- llm-judge.ts          # CP2: Kulon AI kontextus, sandwich prompt, policy eval
|   |   |   |   +-- runtime-monitor.ts    # CP3: CoT auditor, action validator, output PII check
|   |   |   |-- rate-limiter.ts           # Progressziv csuszo ablakos limitek
|   |   |   |-- risk-classifier.ts        # Green/Yellow/Red besorolas
|   |   |   |-- admin-unlock.ts           # Admin-only block feloldas
|   |   |   +-- tests/
|   |   |
|   |   |-- meeting/                        # Meeting feldolgozas (EXTRA)
|   |   |   |-- manifest.ts
|   |   |   |-- meeting-service.ts         # Unified meeting processing
|   |   |   |-- providers/
|   |   |   |   |-- types.ts              # MeetingProvider interface
|   |   |   |   |-- fireflies.ts          # Fireflies.ai (default, GraphQL + webhook)
|   |   |   |   |-- zoom.ts              # Zoom AI Companion 3.0
|   |   |   |   |-- recall.ts            # Recall.ai infrastructure API
|   |   |   |   +-- local.ts             # Jitsi + Whisper + Ollama (self-hosted)
|   |   |   +-- tests/
|   |   |
|   |   |-- disaster-recovery/             # Disaster Recovery (EXTRA) — TODO
|   |   |   |-- manifest.ts
|   |   |   +-- README.md
|   |   |
|   |   |-- odoo/                           # Odoo integracio (EXTRA)
|   |   |   |-- manifest.ts
|   |   |   |-- odoo-webhook.ts            # Odoo-specifikus webhook handler
|   |   |   |-- odoo-partner-sync.ts       # Assignee <-> res.partner linking
|   |   |   |-- odoo-ticket-import.ts      # Project.task import
|   |   |   +-- tests/
|   |   |
|   |   +-- siri/                          # Siri Shortcuts (EXTRA)
|   |       |-- manifest.ts
|   |       +-- endpoint.ts
|   |
|   |-- cli/                               # CLI interface
|   |   |-- index.ts                       # Main CLI router
|   |   +-- commands/
|   |       |-- serve.ts                  # eyas serve
|   |       |-- doctor.ts                # eyas doctor
|   |       |-- status.ts               # eyas status
|   |       |-- agent.ts                # eyas agent run/list/stop
|   |       |-- task.ts                 # eyas task create/list/update
|   |       |-- memory.ts              # eyas memory search/save/stats
|   |       |-- config.ts              # eyas config get/set/reload
|   |       |-- module.ts              # eyas module list/enable/disable
|   |       |-- skill.ts               # eyas skill list/import/create
|   |       |-- node.ts                # eyas node list/add/invoke
|   |       |-- notify.ts              # eyas notify send
|   |       +-- backup.ts              # eyas backup create/restore/list
|   |
|   |-- shared/                            # Megosztott logika (web + desktop + mobile)
|   |   |-- api-client.ts                 # HTTP + WS kliens
|   |   |-- stores/                       # Zustand stores
|   |   |   |-- auth-store.ts
|   |   |   |-- theme-store.ts
|   |   |   +-- module-store.ts
|   |   |-- types/                        # Megosztott tipusok
|   |   +-- utils.ts
|   |
|   +-- web/                               # Frontend (Vite + React + shadcn/ui)
|       |-- vite.config.ts
|       |-- package.json
|       |-- tailwind.config.ts
|       |-- src/
|       |   |-- main.tsx
|       |   |-- app.tsx
|       |   |-- shell/                      # Alap keret (mindig betolt)
|       |   |   |-- layout.tsx             # Sidebar + header + content area
|       |   |   |-- navigation.ts          # Navigacios registry
|       |   |   +-- module-slot.tsx        # Dinamikus modul slot renderer
|       |   |-- registry/                  # Kozponti UI Registry
|       |   |   +-- ui-registry.ts         # Modulok itt regisztraljak pages/widgets/settings-jukat
|       |   |-- components/                # shadcn/ui + sajat komponensek
|       |   |   |-- ui/                    # shadcn/ui base components
|       |   |   +-- shared/
|       |   |       |-- toast.tsx
|       |   |       +-- loading.tsx
|       |   +-- routes.tsx                 # TanStack Router definiciok (dinamikus, registry alapjan)
|       |   #
|       |   # MEGJEGYZES: Modul-specifikus oldalak, widgetek es beallitasok
|       |   # NEM itt vannak, hanem az egyes modulok frontend/ mappajaban.
|       |   # Peldaul: src/modules/board/frontend/pages/kanban-view.tsx
|       |   # A shell/module-slot.tsx rendereli oket a UI Registry alapjan.
|       +-- assets/
|           +-- eyas-logo.png
|
|   # Jovobeli cross-platform csomagok (meg nem implementalt):
|   # |-- desktop/                         # Electron/Tauri wrapper
|   # |   |-- main.ts                     # Desktop shell
|   # |   +-- package.json
|   # +-- mobile/                          # React Native
|   #     |-- App.tsx
|   #     +-- package.json
|
|-- config/
|   |-- default.env
|   |-- .env                               # GITIGNORE
|   |-- modules.json
|   |-- agents/                            # Agent definiciok (YAML)
|   |   |-- code-reviewer.yaml
|   |   |-- product-owner.yaml
|   |   |-- qa-engineer.yaml
|   |   |-- devils-advocate.yaml
|   |   +-- researcher.yaml
|   |-- skills/                            # User skill-ek (.md fajlok)
|   |   +-- .gitkeep
|   |-- personality/
|   |   |-- identity.yaml
|   |   |-- rules.yaml
|   |   |-- boundaries.yaml
|   |   |-- communication.yaml
|   |   |-- model-gateway.yaml
|   |   |-- permissions.yaml
|   |   |-- documents.yaml                # Storage, retention, thumbnails config
|   |   |-- notifications.yaml            # Event routing, quiet hours
|   |   |-- ingress.yaml                  # Remote access, tunnel, auth config
|   |   +-- overrides/
|   |       |-- telegram.yaml
|   |       |-- web.yaml
|   |       +-- agent-mode.yaml
|   +-- user-modules/
|       +-- .gitkeep
|
|-- data/                                  # TELJES GITIGNORE (kiveve vault/ opcionalis git)
|   |-- sqlite/
|   |   +-- eyas.db
|   |-- orama/
|   |-- vault/                             # Markdown tudasbazis (opcionalis sajat git repo)
|   |   |-- semantic/                     # Tudas jegyzetek ([[wikilink]] graf)
|   |   |-- procedural/                   # Receptek, "hogyan" guide-ok
|   |   |-- projects/                     # Projekt-specifikus tudas
|   |   +-- .vault-index.json            # Link graf cache (regeneralhato)
|   |-- secrets.age
|   |-- cache/
|   |-- logs/
|   |   |-- daemon/
|   |   +-- snapshots/
|   +-- backups/
|
|-- hooks/
|   |-- pre-install.ts
|   |-- post-install.ts
|   |-- pre-upgrade.ts
|   +-- post-upgrade.ts
|
|-- eyas.json
|-- package.json
|-- pnpm-workspace.yaml
|-- tsconfig.json
|-- tsconfig.web.json
|-- vitest.config.ts
|-- Dockerfile
|-- docker-compose.yml
|-- .gitignore
|-- CLAUDE.md
+-- README.md
```

---

## 6. Core rendszer
> **Status: [DONE]** — Implemented in src/core/ — bootstrap, config, bus, db, http, i18n, logger

### 6.1. Bootstrap (core/bootstrap.ts)

```typescript
async function main() {
  // 1. Platform detection (macOS/Linux/Windows/Docker/K8s)
  const platform = detectPlatform()

  // 2. Process lock (data/eyas.lock)
  await acquireLock()

  // 3. Config betoltes + validalas (Zod)
  const config = await loadConfig()

  // 4. Logger inicializalas
  initLogger(config.logLevel)

  // 5. Adatbazis inicializalas
  await initSqlite(config)           // data/sqlite/eyas.db

  // 6. Migracio engine futtatas
  await runMigrations()

  // 7. Event bus inicializalas (LocalBus default, NatsBus ha BUS_MODE=nats)
  const bus = createBus(config.bus)

  // 8. Secret manager inicializalas (auto-detect provider by platform)
  await initSecrets(config, platform)

  // 9. Module discovery + dependency resolution
  const modules = await discoverModules(config)

  // 10. Module lifecycle: onRegister
  for (const mod of modules) await mod.onRegister(ctx)

  // 11. HTTP szerver inditas (Hono)
  await startHttpServer(config)

  // 12. Module lifecycle: onStart
  for (const mod of modules) await mod.onStart(ctx)

  // 13. Graceful shutdown handler
  setupGracefulShutdown(modules)
}
```

### 6.2. Module Loader (core/module-loader.ts)

```typescript
interface ModuleContext {
  config: EyasConfig
  platform: PlatformInfo
  db: Database
  bus: EyasBus
  http: Hono
  secrets: SecretManager
  auth: AuthManager
  permissions: PermissionEngine
  i18n: TranslationFunctions
  logger: Logger
  hasModule(id: string): boolean
  getModule<T>(id: string): T
}
```

### 6.3. Modul interface (core/types.ts)

```typescript
interface EyasModule {
  id: string
  name: string
  version: string
  type: 'core' | 'extra' | 'user'
  required?: boolean                // true = base, nem kapcsolhato ki
  description: string
  dependencies: string[]
  optional?: string[]
  capabilities?: string[]
  platforms?: ('darwin' | 'linux' | 'win32' | 'docker' | 'k8s')[]

  // Almodul rendszer
  submodules?: SubmoduleManifest[]

  // Frontend bovites
  frontend?: FrontendManifest

  onRegister(ctx: ModuleContext): Promise<void>
  onStart(ctx: ModuleContext): Promise<void>
  onStop(ctx: ModuleContext): Promise<void>

  routes?(app: Hono): void
  jobs?: JobDefinition[]
  subscriptions?: EventSubscription[]
  migrations?: Migration[]
  personalityExtensions?: Record<string, unknown>
  healthCheck?(): Promise<HealthStatus>
  permissionDefinitions?: PermissionDefinition[]
}

interface SubmoduleManifest {
  id: string                        // 'claude-api'
  name: string                      // 'Claude API Provider'
  parentModule: string              // 'model'
  enabled: boolean                  // ki/be kapcsolhato
  dependencies?: string[]
  frontend?: FrontendManifest

  onRegister?(ctx: ModuleContext): Promise<void>
  onStart?(ctx: ModuleContext): Promise<void>
  onStop?(ctx: ModuleContext): Promise<void>
}

interface FrontendManifest {
  pages?: PageRegistration[]        // Teljes oldalak a navigacioban
  widgets?: WidgetRegistration[]    // Dashboard widget-ek
  settings?: SettingsRegistration[] // Beallitasok panel
  toolbarActions?: ActionRegistration[]
  contextMenu?: MenuRegistration[]
}

interface JobDefinition {
  id: string
  cron: string
  handler: () => Promise<void>
  description: string
  runOnStart?: boolean
}

interface EventSubscription {
  subject: string
  handler: (msg: BusMessage) => Promise<void>
}

interface Migration {
  version: number
  description: string
  up(db: Database): Promise<void>
  down(db: Database): Promise<void>
}
```

### 6.4. Event Bus (core/bus/) — provider pattern

Subject naming: eyas.\<module\>.\<entity\>.\<action\>

```typescript
interface EyasBus {
  emit(subject: string, data: unknown): void
  on(subject: string, handler: (data: unknown) => Promise<void>): Subscription
  request<T>(subject: string, data: unknown, timeout?: number): Promise<T>
  reply(subject: string, handler: (data: unknown) => Promise<unknown>): Subscription
  off(subscription: Subscription): void
}

// Ket implementacio:
// - LocalBus: EventEmitter-based (default, single instance, 0 dependency)
// - NatsBus: NATS wrapper (multi-instance, optional, persistent messaging)
//
// Config: BUS_MODE=local | nats
// Ha BUS_MODE=nats: NATS_URL=nats://localhost:4222
//
// NatsBus a lokalis emit-et IS megtartja (gyors, process-en beluli),
// plusz NATS-ra is elkuldi (mas instance-ok is megkapjak).
```

### 6.5. HTTP Server (core/http/)

Hono app factory. API verzio prefix: `/api/v1/`. WebSocket manager a real-time frissitesekhez.

```typescript
// API versioning: /api/v1/ prefix
// Fallback: /api/* -> /api/v1/* redirect (backward compat)
// WebSocket: /ws endpoint (auth JWT query param-ben)
```

### 6.6. Database layer (core/db/)

Drizzle ORM + SQLite (bun:sqlite / better-sqlite3), WAL mode. A Drizzle lehetove teszi a kesobbi PostgreSQL-re valtas -- ugyanaz a schema, csak a driver valtozik. Minden adat SQLite-ban (relacios + FTS5 + JSON mezok). Vector search: Orama + sqlite-vec. Optimistic locking: `version` mezo a fontos tablakban. Migraciok: drizzle-kit.

### 6.7. i18n (core/i18n/)

i18next + react-i18next. Magyar (default) + English. Minden modul sajat namespace-t hasznal (pl. `board:task.title`), igy a forditasok modulokkal egyutt toltodnek be. Modulok a sajat `locales/` mappajukban taroljak a forditasaikat.

### 6.8. Doctor CLI (core/doctor.ts)

Validalja az egesz rendszert: platform, config, DB, modulok, secrets, permissions, budget, nodes, skills.

---

## 7. Modul rendszer
> **Status: [DONE]** — Implemented in src/core/module-loader/ — manifest, lifecycle, health

### 7.1. Modul kategoriak

| Tipus | Ki/be kapcsolhato | Leiras |
|-------|-------------------|--------|
| core/base | NEM | Mindig fut, nem kapcsolhato ki. Az EYAS alapja: bootstrap, config, db, bus, http, logger, i18n, locking |
| core | IGEN | Alap modulok, az eYssen fejleszti, de ki/be kapcsolhatok: model, board, memory, search, scheduler, chat, audit, agent, skills, self-learning, communication, privacy, security-gate, documents, notifications |
| extra | IGEN | Opcionalis modulok, az eYssen fejleszti, a rendszer resze: telegram, slack, discord, email, backup, webhooks, siri, remote-node, research, meeting, odoo, ingress, disaster-recovery |
| user | IGEN | Barki keszithet sajat modulokat (config/user-modules/) |

### 7.2. Almodul (submodule) rendszer

Minden modul tartalmazhat almodulokat a `submodules/` mappaban. Az almodulok:
- **Sajat manifest.ts** fajllal rendelkeznek (ki/be kapcsolhato, sajat dependencies)
- **Sajat frontend/ mappaval** bovithetik a UI-t (pages, widgets, settings)
- **Onalloan ki/be kapcsolhatok** a szulo modul engedelyezese mellett

Pelda: a `model` modul almoduljai az egyes AI provider-ek (claude-api, claude-code, ollama, openai).
Pelda: a `backup` modul almoduljai a storage provider-ek (b2, s3, local).

```typescript
// Almodul manifest
interface SubmoduleManifest {
  id: string                        // 'claude-api'
  name: string                      // 'Claude API Provider'
  parentModule: string              // 'model'
  enabled: boolean                  // ki/be kapcsolhato
  dependencies?: string[]           // fuggosegek
  frontend?: FrontendManifest       // UI kiegeszites
}
```

### 7.3. Frontend bovithetoseg (UI Registry)

A frontend egy **shell** (layout + navigation + module-slot), amelyet minden modul es almodul bovithet. A modulok egy kozponti **UI Registry**-ben regisztraljak a komponenseiket:

```typescript
interface FrontendManifest {
  pages?: PageRegistration[]        // Teljes oldalak a navigacioban
  widgets?: WidgetRegistration[]    // Dashboard widget-ek
  settings?: SettingsRegistration[] // Beallitasok panel
  toolbarActions?: ActionRegistration[]  // Toolbar gombok
  contextMenu?: MenuRegistration[]  // Jobb klikk menu elemek
}

interface PageRegistration {
  id: string
  path: string                      // '/board', '/agents'
  title: string                     // Navigacios cim
  icon: string                      // Ikon
  component: () => Promise<ComponentType>  // Lazy load
  order: number                     // Sorrend a navigacioban
}

interface WidgetRegistration {
  id: string          // '<module>.<widget>', pl. 'scheduler.upcoming'
  titleKey: string    // i18n kulcs -- NEM megjelenitendo string (a drawer forditja)
  capability?: string // CASL subject gate; ha hianyzik, a modul-gate eleg
}
```

Minden modul es almodul a sajat `frontend/register.ts` fajljaban regisztralja a UI elemeit.

### 7.3.1 Widget contract -- ket felben, contract test-tel osszekotve (2026-08-25, `home` modul)

A `widgets` mezo evekig deklaralva es tipizalva volt (`FrontendManifest.widgets`,
`WidgetRegistration`), de **egyetlen modul sem toltotte fel, es egyetlen kod sem olvasta** -- pontosan
ugyanaz a hiba-osztaly, mint amit a torolt `AutonomyNudgeCard` mutatott. A 2026-08-25-i home widget
grid (`/` -- lasd 22. Board modul mellett most mar kulon `home` modul is) elevenitette fel.

A kontraktus ket felre oszlik, mert a modulok a backend processzben elnek, a React komponensek pedig
a Vite bundle-ben -- nincs dinamikus modul-betoltes, egy modul nem tud sajat komponenst szallitani:

- **Backend fel -- deklaracio.** A modul manifestje (`WidgetRegistration`, fent) csak azt mondja
  meg, hogy a widget *letezik*. A `home` modul a modul loaderbol gyujti ossze ezeket es szolgalja ki:
  `GET /api/v1/home/widgets`. Letiltott modul vagy CASL-tiltas eseten a widget `available: false`-kent,
  de tovabbra is listazva jon vissza -- a drawer elhalványitva mutatja, igy lathato, mi lenne
  elerheto.
- **Frontend fel -- implementacio.** `src/web/src/pages/home/widget-registry.ts`-ben minden
  widget-id-hez tartozik egy `WidgetDef`: ikon, grid layout (`w/h/minW/minH`), `refresh` deklaracio
  (WS topic(ok) es/vagy poll intervallum -- lasd 6.4 Event Bus, a WS keret vekony marad, csak
  refetch-pinget hordoz), opcionalis `configSchema` (pl. Board widget: `{ projectId }`), es a
  ténylegesen renderelt `Component`.
- **Contract test tiltja az egyoldalu bekotest.** `tests/contracts/widgets.contract.test.ts` --
  minden manifest-deklaralt widgethez van frontend komponens, es forditva. Ugyanaz a minta, mint a
  `ws-topics.contract.test.ts`, es ez az egyetlen dolog, ami megakadalyozza, hogy a widget-rendszer
  visszasüllyedjen abba az allapotba, amiben a `WidgetRegistration` evekig volt.

Reszletek (adattaroloas, layout-verziozas, D1-D5 dontesek, koltsegelemzes):
`docs/superpowers/specs/2026-08-25-home-widget-grid-design.md`.

### 7.4. Cross-platform frontend

```
src/shared/           # Megosztott logika (API client, store-ok, utils)
src/web/              # React web app (Vite + shadcn/ui)
src/desktop/          # Electron/Tauri wrapper (ugyanaz a React kod)
src/mobile/           # React Native (megosztott uzleti logika, nativ UI)
```

---

## 8. Model modul (korabban Model Gateway)
> **Status: [DONE]** — Implemented in src/modules/model/ — 5 providers + Ollama

### Egyetlen belepes pont

Semmi mas modul nem hivja kozvetlenul az AI SDK-t.

### Decision engine -- multi-signal cascade

1. Function binding (0 cost) -> 2. Keyword rules (0 cost) -> 3. Message metadata (0 cost) -> 4. History pattern (0 cost) -> 5. Local classifier / Ollama (0 cost) -> 6. Haiku classifier (minimal cost)

### Function binding

```yaml
# config/personality/model-gateway.yaml
routing:
  function_binding:
    code_review: { provider: claude-api, model: opus }
    quick_chat: { provider: ollama, model: llama3, fallback: claude-api/haiku }
    code_generation: { provider: claude-code, model: sonnet }
    data_analysis: { provider: claude-api, model: sonnet }
    translation: { provider: claude-api, model: haiku }
    security_audit: { provider: claude-api, model: opus }
    summarization: { provider: ollama, model: llama3, fallback: claude-api/haiku }

  decision:
    cache_decisions: true
    log_decisions: true
    learn_from_feedback: true
```

### Budget tracking + enforcement

80% warning -> 100% soft limit (downgrade) -> 120% hard limit (stop)

### Koltsegkontroll bovitesek (2026-03-23)

**Per-entity koltseg tracking:** session, agent, task, user szinten kulon nyilvantartva.

**Budget limit viselkedes konfiguralhato:**
- `auto_downgrade` — automatikus atiranyitas olcsobb modellre
- `ask_user` — user-t kerdezi mielott tovabb megy
- `both` (default) — 80% warn, 100% downgrade, 120% stop — de felulbiralhato

**Prompt caching kihasznalasa:** Anthropic cached token: 90% kedvezmeny. A model-gateway automatikusan kihasznlja a prompt caching lehetoseget ahol elerheto.

**Automatikus komplexitas-osztalyozas:** A decision engine reszenek a query bonyolultsag alapu routing: egyszeru kerdes -> olcso modell, komplex reasoning -> draga modell. A self-learning modul figyeli es finomhangolja az osztalyozast.

**Koltseg dashboard:** Frontend oldalon napi/heti/havi bontas, model eloszlas, cache hit rate, per-entity koltseg.

### Providers

claude-code, claude-api, ollama, openai -- mind AIProvider interface-t implemental.

---

## 9. Permissions modul
> **Status: [DONE]** — Implemented in src/modules/permissions/ — CASL engine, 30 subjects, 5 roles

CASL-based (@casl/ability) -- kulon az auth modultol.

### Oroklesi hierarchia

```
Global defaults (permissions.yaml)
  -> Project-level override (can only restrict)
    -> Task-level override (can only restrict further)
      -> Session-level (runtime, most restrictive)
```

### AI action jogosultsagok

```yaml
ai_actions:
  file_read: auto
  file_write: ask
  file_delete: ask_always
  git_commit: ask
  git_push: ask_always
  db_read: auto
  db_write: ask
  shell_command: ask
  network_request: auto

  auto_approve_patterns:
    - "read-only queries"
    - "gitignored files"
    - "test execution"

  always_ask_patterns:
    - "production database"
    - "force push"
    - "delete branch"
    - "modify permissions"
```

### Project-level instructions + tool policy (v0.5-bol athelyezve, bovitve)

Haromszintu oroklesi lanc, ahol minden szint finomithatja az elozot — de **soha nem bovitheti**:

```
Global defaults (permissions.yaml + model-gateway.yaml)
  -> Project-level (project.instructions + project.toolPolicy)
    -> Task-level (task.toolPolicy — felulbiralhat, de CSAK korlatozhat)
```

**Projekt szinten:**
- `instructions`: Projekt-specifikus system prompt kiegeszites (pl. "Ez egy Odoo modul, hasznald az ORM-et")
- `toolPolicy`: Allow/deny tool patterns (pl. `{ allow: ["grep", "read"], deny: ["git push --force"] }`)
- Ha nincs projekt-szintu config, a globalis ervenyes

**Task szinten:**
- A projekt tool policy-jet orokli
- Felulbiralahto, de CSAK korltozhat (nem adhat tobb jogot mint a projekt)
- **Jogosultsag ellenorzes:** Csak olyan felhasznalo (role: owner/admin) modosithatja a task tool policy-t aki szinten rendelkezik a megfelelo jogosultasokkal. Agent role soha nem bovitheti sajat jogait.

```yaml
# Pelda: project config
projects:
  - id: odoo-dev
    instructions: "Odoo 18 CE modul fejlesztes. Hasznald az ORM API-t, ne irj nyers SQL-t."
    toolPolicy:
      allow: ["grep", "read", "git-diff", "odoo-*"]
      deny: ["rm -rf", "git push --force", "DROP TABLE"]
```

### Roles

owner (full) > admin > user > agent > guest (read-only)

---

## 10. Auth modul
> **Status: [DONE]** — Implemented in src/modules/auth/ — users, JWT, sessions, API keys

User CRUD, login, JWT session + refresh, API keys, auth providers (local, telegram, api-key, oauth).

---

## 11. Secret management
> **Status: [DONE]** — Implemented in src/core/secrets/ — file-based master key

Provider-based: keychain (macOS auto), encrypted-file (cross-platform default), env (Docker/K8s), k8s-secret (K8s auto).

---

## 12. Audit modul
> **Status: [DONE]** — Implemented in src/modules/audit/ — entries, snapshots, rollback, retention

### Core funkciok

- **Action logging**: Minden AI parancs, minden adatmodositas
- **Pre-action snapshots**: Eredeti adat mentese modositas elott
- **Rollback**: Egyetlen action vagy idopontig visszaallitas
- **Replay**: Tevekenyseg visszajatszas (readonly)
- **Diff tracking**: Fajl valtozasok elotte/utana
- **Retention policy**: Hot (30d) -> Warm (90d) -> Cold (365d)

```typescript
interface AuditEntry {
  id: string
  timestamp: Date
  userId: string
  action: string               // 'file.write' | 'db.update' | 'git.commit' | 'shell.exec'
  module: string
  target: string
  details: Record<string, unknown>
  result: 'success' | 'error' | 'denied' | 'rolled-back'
  snapshotId?: string
  reversible: boolean
  costUsd?: number
}

interface AuditSnapshot {
  id: string
  auditEntryId: string
  type: 'file' | 'db_record' | 'config' | 'git_state'
  originalData: string
  path: string
  timestamp: Date
  restorable: boolean
  restoredAt?: Date
}
```

---

## 13. Memory modul
> **Status: [DONE]** — Implemented in src/modules/memory/ — 5-tier, vault, hybrid search

### Hibrid 5-tier rendszer — DB + Vault

A memoria rendszer ket storage backend-et hasznal:
- **DB Storage** (Drizzle/SQLite): strukturalt, gyors, rovid eletu es archiv adatok
- **Vault Storage** (markdown fajlok): tudas es proceduralis emlekek, emberileg olvashato, git-verziokezeltu

| Tier | Storage | Formatum | Cel | Elettartam | Kereses |
|------|---------|----------|-----|------------|---------|
| working | DB | JSON rekord | Session kontextus | 24h auto-expiry | Kozvetlen lookup |
| episodic | DB | JSON rekord | Mi tortent (esemenyek, beszalgetesek) | Decay-alapu | FTS + vector |
| semantic | **Vault (markdown)** | `.md` + frontmatter + `[[linkek]]` | Mit tudok (tudas) | Hosszu tavu | FTS + vector + graph |
| procedural | **Vault (markdown)** | `.md` receptek/sablonok | Hogyan csinalitam | Hosszu tavu | FTS + vector |
| archive | DB | Tomoritetett JSON | Alacsony relevancia | Vegtelen | FTS |

### Vault struktura

```
data/vault/                           # Markdown tudasbazis (git-tracked opcionalis)
|-- semantic/                         # Tudas jegyzetek
|   |-- typescript-patterns.md        # [[react-hooks]] [[zod-validation]]
|   |-- kubernetes-networking.md
|   +-- odoo-workflow-engine.md
|-- procedural/                       # Receptek, "hogyan" guide-ok
|   |-- deploy-to-oke.md
|   |-- debug-sqlite-locks.md
|   +-- odoo-module-creation.md
|-- projects/                         # Projekt-specifikus tudas
|   +-- eyas/
|       |-- architecture-decisions.md
|       +-- known-issues.md
+-- .vault-index.json                 # Link graf cache (regeneralhato)
```

### Vault fajl formatum

```markdown
---
title: TypeScript Patterns
tags: [typescript, patterns, best-practices]
created: 2026-03-31
updated: 2026-03-31
tier: semantic
links: [react-hooks, zod-validation]
embedding_hash: abc123    # cache, ujraszamolas ha fajl valtozott
---

# TypeScript Patterns
...szoveg [[react-hooks]] linkekkel...
```

### Miert hibrid (DB + Vault)?

1. **Emberileg olvashato** — A tudas markdown fajlokban van, barmilyen editorban szerkesztheto
2. **Git-verziokezelt** — A tudas fejlodese nyomon kovetheto
3. **AI + ember egyarant szerkeszti** — Az EYAS tanul es ir a vault-ba, de a user is szerkesztheti
4. **Gyors kereses** — A fajlok indexelve vannak DB-ben (FTS5 + vector), de az adat forrasa a fajlrendszer
5. **Hordozhato** — A vault mappa masolasaval az osszes tudas atviheto
6. **Hatekony** — Working/episodic/archive a DB-ben marad (sok kis rekord, decay, tomoritest)

### Hybrid search

1. FTS5 kereses (pontos szoveges egyezes) — DB + Vault index
2. Vector search (szemantikus hasonlosag) — Orama + sqlite-vec
3. Graph traversal (kapcsolodo emlekek) — `[[wikilink]]` graf a DB-ben
4. Score fusion (RRF) — mindket backend eredmenyeit egyesiti
5. Top-K visszaadas

### Embedding providers

Lokalis (0 cost): Ollama embeddings. API: OpenAI/Voyage. Fallback: FTS-only.

### Context builder

AI query elott automatikusan injekalja a relevans emlekeket a system prompt-ba.
Mindket backend-bol (DB + Vault) kerit relevans tartalmat.

---

## 14. Agent modul
> **Status: [DONE]** — Implemented in src/modules/agent/ — registry, runner, orchestrator, budget

### Dinamikus Agent Registry (Paperclip-inspiralt)

Az agent registry DB-backed: SQLite a source of truth, YAML fajlok csak seed/bootstrap.
Indulaskor a YAML-bol hianyzo agent-ek beszurodnak a DB-be (`INSERT OR IGNORE`),
utana minden a DB-bol jon. Az agent-ek az admin UI-bol kezelhetok (CRUD + toggle).

**Source of truth**: `agent_definitions` SQLite tabla
**Seed**: `config/agents/*.yaml` — indulaskor merge-olve a DB-be
**Seed agent-ek nem torolhetok**, csak letilthatok (enabled=false)

```
AgentRegistry
├── seedFromDirectory(dir)  — startup: YAML → DB merge (INSERT OR IGNORE)
├── get(id)                 — DB lookup
├── list(filter?)           — DB query (enabled, source, capability szures)
├── getByCapability(cap)    — DB query
├── create(agent)           — UI-bol letrehozva (source='user')
├── update(id, patch)       — barmelyik agent szerkesztheto
├── delete(id)              — csak source='user' agent-ek torolhetok
├── toggle(id)              — enabled flip
├── addTokenUsage(id, n)    — executor hivja minden futtatas utan
└── isWithinBudget(id)      — executor hivja minden futtatas elott
```

### Agent definicio (kibovitett YAML sema)

```yaml
# config/agents/code-reviewer.yaml
id: code-reviewer
name: "Code Reviewer"
role: "Senior code reviewer with security focus"
description: "Reviews code for quality, security, and performance issues"
systemPrompt: |
  You are a senior code reviewer with deep security expertise.
  Focus on OWASP top 10, input validation, and authentication flows.
model: opus
capabilities: [code-analysis, security-audit, performance-check]
tools: [grep, read, git-diff, semgrep]
constraints:
  - "Never modify files directly"
  - "Max 10 minutes per review"
maxTurns: 20
# --- Paperclip-inspiralt uj mezok ---
enabled: true
source: seed                # seed | user — seed = YAML-bol, user = UI-bol
avatar: "🔍"               # emoji vagy ikon azonosito az UI-hoz
tags: [security, review, quality]
monthlyTokenBudget: 500000  # havi token keret, 0 = korlatlan
```

### AgentDefinition interface (bovitett)

```typescript
interface AgentDefinition {
  // --- meglevo mezok ---
  id: string
  name: string
  role: string
  description: string
  systemPrompt: string
  capabilities: string[]
  tools: string[]
  constraints: string[]
  model?: string
  maxTurns?: number
  // --- uj mezok (Paperclip-inspiralt) ---
  enabled: boolean              // UI toggle
  source: 'seed' | 'user'      // YAML-bol vs UI-bol
  avatar?: string               // emoji/ikon
  tags?: string[]               // kereshetoseg, szures
  monthlyTokenBudget?: number   // 0 = korlatlan
  tokensUsedThisMonth?: number  // runtime tracking
  createdAt?: string
  updatedAt?: string
}
```

### AgentTask bovites — Goal Ancestry (Paperclip-inspiralt)

Minden feladat visszamutat a magasabb szintu celra. Az agent tudja a "miert"-et.

```typescript
interface AgentTask {
  // ... meglevo mezok ...
  parentGoal?: string  // magasabb szintu cel kontextus
}
```

Team execution soran az ancestral context automatikusan propagalodik.

### Koltsegkezeles (Paperclip-inspiralt)

- **Per-agent havi token budget**: `monthlyTokenBudget` mezo, 0 = korlatlan
- **Budget check az executor-ban**: minden vegrehajtas elott `registry.isWithinBudget(agentId)`
- **Automatikus throttle**: ha elerje a limitet, az agent nem kap tobb feladatot
- **Token tracking**: az executor minden futtatas utan hivja `registry.addTokenUsage(id, tokens)`
- **Havi reset**: scheduler job a honap elejen nullazza a `tokensUsedThisMonth` ertekeket
- **Token dashboard**: React UI-ban valos ideju megjelenitesnel/heti/havi bontasban

### DB sema (agent_definitions tabla — bovitett)

```sql
CREATE TABLE agent_definitions (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  role                  TEXT,
  description           TEXT,
  system_prompt         TEXT,
  capabilities          TEXT,  -- JSON array
  tools                 TEXT,  -- JSON array
  constraints           TEXT,  -- JSON array
  model                 TEXT,
  max_turns             INTEGER,
  enabled               INTEGER NOT NULL DEFAULT 1,
  source                TEXT NOT NULL DEFAULT 'seed',  -- 'seed' | 'user'
  avatar                TEXT,
  tags                  TEXT,  -- JSON array
  monthly_token_budget  INTEGER DEFAULT 0,
  tokens_used_month     INTEGER DEFAULT 0,
  budget_reset_at       TEXT,  -- utolso reset idopontja
  config                TEXT,  -- JSON egyeb konfiguracio
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Team Sessions (DONE)

Provider-agnosztikus multi-agent team koordinacio. Egy `team_sessions` entitas kovet egy teljes
team eletciklust: javaslat → jovahagyas → futtatas (parhuzamos fazisokkal) → befejezés.

**DB tablak:**
- `team_sessions` — status (proposing/running/paused/completed/failed), config, token/cost tracking
- `team_memory` — ket retegu (system + agent), role-based visibility, kategorizalt (finding/decision/blocker)

**Backend szolgaltatasok:**
- `TeamSessionService` — CRUD, checkpoint await/resume (race-safe `pendingResumes` pattern)
- `orchestrator.analyzeAndPropose()` — LLM-alapu team javaslat AgentGap detektálással
- `orchestrator.executeTeam()` — parhuzamos streaming count-based completion queue-vel
- `propose_team` tool — agent hivja, letrehoz team session-t, frontend kartyat renderel
- `write_team_memory` / `read_team_memory` tools — agent-ek megosztott memoriaval dolgoznak

**Frontend:**
- `TeamProposalCard` — inline chat kartya fazislistával, agent gap detektálás, approve/reject
- `TeamDashboard` — teljes szelessegu agent kártyák + team memory szekció
- `SubConversationTree` — real-time agent progress per child conversation
- `team-session-store` — Zustand store WebSocket event handler-ekkel

**AgentGap self-improvement loop:**
A team javaslat LLM-alapu elemzessel azonositja a hianyzo specialistakat (`AgentGap`).
A felhasznalo az Agent Wizard-dal rogton letrehozhatja az uj agentet → a rendszer
a kovetkezo feladatnal mar hasznalja.

### MCP Tool Bridge (PLANNED)

A Claude Code SDK sajat agentic loop-ot futtat, kikeruljve az EYAS tool rendszeret.
Megoldas: EYAS tool-okat MCP szerveren keresztul injektaljuk az SDK-ba `createSdkMcpServer()`
segitsegevel. Igy az SDK használja az EYAS tool-okat (delegation, team, memory) es minden
EYAS UI komponens (SubConversationTree, TeamDashboard) automatikusan mukodik.

Design spec: `docs/superpowers/specs/2026-04-14-mcp-tool-bridge.md`

### Parallel executor

Max N parhuzamos agent (konfiguralhato). Fazis-alapu vegrehaitas.
Completion queue pattern (count-based) biztositja az azonnali event yield-et.

### Agent-to-Agent kommunikacio

Session-alapu uzenetvatas agent-ek kozott + ket retegu team memory (system + agent layer)
role-based visibility filterrel.

### Self-validating QA loop

Build -> validate (lint, test, security scan, diff review) -> fix -> repeat (max N). Ha nem javithato: escalation.

### AI-powered merge

Automatikus conflict resolution git merge eseten.

### Spec runner workflow (Auto Claude inspired)

Formalizalt spec -> plan -> build -> review -> merge pipeline:

```
1. User megirja a spec-et (YAML vagy Markdown):
   - Cel, acceptance criteria, constraintek, teszteles elvraasai

2. Eyas tervet keszit (agent: product-owner):
   - Feladat bontas, agent team javaslat, scope becsles
   - User jovahagyja a tervet

3. Build fazis (agent team: developer + tarsak):
   - Parhuzamos vegrehaitas worktree-kben
   - Checkpoint-ok a terv szerint

4. Review fazis (agent: code-reviewer + devils-advocate):
   - QC loop: lint, test, security scan
   - Ha hiba: vissza a build fazisba

5. Merge (agent: orchestrator):
   - AI-powered conflict resolution
   - Final test suite
   - Merge a main branch-be (user jovahagyas utan)
```

CLI: `eyas spec run ./spec.yaml` vagy `eyas spec create --interactive`

### Browser control capability

Az agent kepes bongeszt vezerelni Playwright-on keresztul (helyi vagy remote node-on):

```typescript
// Agent tool: browser_navigate, browser_click, browser_fill, browser_screenshot
// Biztonsag: URL allowlist, max session ido, screenshot audit log
// Hasznalat: kutatas, teszteles, web scraping, form kitoltes
```

---

## 15. Skills modul
> **Status: [DONE]** — Implemented in src/modules/skills/ — markdown loader, matcher

### Skill formatum (.md, Perplexity Computer kompatibilis)

```markdown
---
name: kubernetes-debug
description: Debug Kubernetes pods, deployments, and services
trigger_patterns: ["k8s debug", "pod not starting"]
capabilities: [kubectl-access, log-analysis]
version: "1.0.0"
---
[Skill content...]
```

### Skill lifecycle

Betoltes: config/skills/*.md + bundled + remote hub. Automatikus aktivalas relevancia alapjan. Generalas ismetlodo feladatokbol (self-learning hivja).

### Super-skill konyvtar (Perplexity inspired)

Elodefinialt domain-specifikus skill-ek, amik a Eyas-szal egyutt szallitodnak:

| Skill | Domain | Tartalom |
|-------|--------|----------|
| devops-k8s | DevOps | Kubernetes debug, deploy, monitoring |
| odoo-dev | Odoo | Modul fejlesztes, debug, upgrade |
| git-workflow | Git | Branch strategia, PR review, merge |
| security-audit | Security | CVE check, dependency scan, code audit |
| database-ops | DB | SQLite/PostgreSQL optimalizalas, migracio |
| api-design | API | REST/GraphQL tervezes, OpenAPI spec |
| docker-ops | Docker | Image build, compose, multi-stage |
| monitoring | Ops | Log elemzes, alerting, troubleshooting |

Tobb skill keszitheto: a self-learning modul javasol ujakat a hasznalati mintak alapjan.

---

## 16. Self-Learning modul
> **Status: [DONE]** — Implemented in src/modules/self-learning/ — activity analysis, patterns

### Ontanulo rendszer

Periodikusan elemzi a tevekenyseget es javaslatokat tesz.

### Cron jobok

- **Napi** (22:00): Activity analysis, pattern detection
- **Heti** (hetfo 9:00): Efficiency report
- **Heti** (szerda 10:00): AI news scan + relevans javaslatok
- **Havi** (1-je 9:00): Atfogo onjavitasi terv

### Reszmodulok

- **Activity analyzer**: Audit logbol ismetlodo mintak, hiba-mintak, koltseg-optimalizalas
- **Pattern detector**: Skill javaslat ("Ezt 5x csinalitad"), Agent javaslat ("Nincs agent ehhez")
- **AI news scanner**: Heti hirek, uj modellek, uj eszkozok, security advisory-k
- **Config optimizer**: Routing dontesek elemzese, budget hangolas, cache optimalizalas
- **Efficiency reporter**: Token hatekonsag, ido-megtakaritas, cost/benefit elemzes

### Roadmap / Ideation (Auto Claude inspired)

A self-learning modul sajat mukodeset elemzi, az ideation modul a **felhasznalo kodbazisait**:

- **Codebase analysis**: Kod minoseg, security problomak, performance javitasi lehetosegek
- **Vulnerability discovery**: Ismert CVE-k a dependency-kben, elavult API hasznalat
- **Improvement suggestions**: Refactoring lehetosegek, dead code, duplikacio
- **Roadmap javaslat**: Az osszes insight-bol prioritizalt fejlesztesi terv

Cron: heti (szombat reggel), vagy `eyas ideation run --project <path>` CLI-bol.

---

## 17. Scheduler modul
> **Status: [DONE]** — Implemented in src/modules/scheduler/ — croner, cron/event/webhook triggers

### Fejlett cron rendszer

Croner-based, de bovitett trigger tipusokkal:

| Trigger | Pelda |
|---------|-------|
| time | Cron expression: "0 9 * * 1-5" |
| event | Bus event: "eyas.board.task.created" |
| webhook | POST /api/webhooks/trigger/:name |
| file | Fajl valtozas: fs.watch("/path") |
| condition | Feltetel: "budget.daily.used > 80%" |

### Feladat lancok (chains)

A->B->C feladat lanc. Error strategy: stop | skip | retry. Dead letter queue: N hiba utan kikapcsolas + ertesites.

---

## 18. Search engine
> **Status: [DONE]** — Implemented in src/modules/search/ — Orama, AST indexer, docs, files

Orama (full-text + vector, embedded) + SQLite FTS5 (board/tasks). Code indexer + docs indexer.

---

### Task-fuggetlen conversationok (v0.5-bol athelyezve)

A chat modul nem csak task-hez kotott beszelgeteseket tamogat. **Onallo conversationt** is lehet inditani (pl. gyors kerdes, brainstorming, amibol nem lesz task):

```sql
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  project_id TEXT REFERENCES projects(id),   -- Opcionalis projekt kontextus
  task_id TEXT REFERENCES tasks(id),          -- NULL ha onallo
  user_id TEXT NOT NULL REFERENCES users(id),
  activity_state TEXT DEFAULT 'idle',         -- working | waiting | idle
  thinking TEXT NOT NULL DEFAULT 'off',      -- 'off' | 'on' — Extended Thinking mode
  thinking_budget INTEGER,                   -- thinking token budget (5k/10k/25k/100k)
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL,                          -- 'user' | 'assistant' | 'system' | 'tool'
  content TEXT NOT NULL,
  attachments TEXT,                            -- JSON: [{filename, path, mime, size}]
  model TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  cost_usd REAL,
  tool_calls TEXT,                             -- JSON
  feedback TEXT,                               -- 'good' | 'bad' | null
  created_at TEXT DEFAULT (datetime('now'))
);
```

Ha a user egy conversationbol taskot akar csinalni, a rendszer automatikusan linkelhe a task-hoz (task_id kitoltese). A `task_messages` tabla a board modul resze marad — de a megjelenses mindketto szal megjelenithetoen is.

---

## 19. Communication modul
> **Status: [DONE]** — Implemented in src/modules/communication/ — Telegram, MCP stubs, A2A

### MCP integraciok

- **MCP Server**: Eyas mint MCP szerver (mas eszkozok elerhik: search, task.create, memory.save, agent.run)
- **MCP Client**: Kulso MCP szerverek elerese (filesystem, browser, database, custom)

### Channel router

Infrastruktura modul -- a konkret csatornak (Telegram, Slack, stb.) onallo extra modulok. A router kezeli az uzenet routing-ot es broadcast-ot.

### Unified Channel interface (2026-03-23, Claude Code Channels inspiracio)

A Claude Code Channels architektura mintajat adaptaljuk, de **motor-fuggetlenul**. Minden csatorna adapter egyforma interfeszt implemental:

```typescript
interface Channel {
  readonly id: string
  readonly type: 'telegram' | 'slack' | 'discord' | 'email' | 'webchat' | 'mcp'

  receive(handler: (msg: ChannelMessage) => Promise<void>): void
  send(target: string, content: ChannelContent): Promise<void>
  reply(originalMsg: ChannelMessage, content: ChannelContent): Promise<void>
}
```

**Push event modell:** A csatorna adapter push modellben kuldi az uzeneteket a gateway fele (nem polling).

**Permission relay pattern:** Barmelyik aktiv csatornarol approve/deny muveletek vegezhetok. Ha a Eyas fajl irast ker jovahagyast es a user Telegram-on van, onnan is jovahagyhatja — nem kell a web UI-ra menni.

### A2UI — Agent-to-User Interface (2026-03-23, Google A2UI inspiracio)

Az agent strukturalt JSON-t kuld szoveg helyett, a kliens nativ widgetekke rendereli. Reszletek: [48. szekci](#48-a2ui--agent-to-user-interface).

### DM pairing (OpenClaw inspired)

Ismeretlen kuldok biztonsagos kezelese. Ha valaki ismeretlen Telegram/Slack/Discord-on ir:

```
1. Ismeretlen kuldo uzenetet kuld
2. Eyas NEM dolgozza fel az uzenetet
3. Visszakuld egy egyedi pairing kodot: "EYAS-A7X9"
4. Owner kap ertesitest: "Ismeretlen kuldo: @username, kod: EYAS-A7X9"
5. Owner jovaahagyja: `eyas pairing approve telegram EYAS-A7X9`
6. Kuldo bekeruel az allowlist-re (DB: paired_senders tabla)
7. Ezutan minden uzenete feldolgozasra kerul
```

Config:
```yaml
# config/personality/communication.yaml
dm_policy:
  default: pairing               # 'pairing' | 'open' | 'block'
  per_channel:
    telegram: pairing
    slack: pairing
    webchat: open                 # Web chat-en mindig open (auth utan)
```

### Presence + typing indicators

"Eyas epp gepel..." jelzes a csatornakkon. A communication modul a bus event-ek alapjan kuldi:

```
bus.emit('eyas.presence.typing', { channel: 'telegram', chatId: '123' })
bus.emit('eyas.presence.idle', { channel: 'telegram', chatId: '123' })
```

Channel modulok ezt kezeli platform-specifikusan (Telegram: sendChatAction('typing'), Slack: typing indicator API, WebSocket: presence event).

---

## 20. Remote Node modul
> **Status: [PARTIAL]** — Registry + invoke endpoint, no actual remote execution yet

### Node architecture (OpenClaw inspired)

Lightweight daemon tavoli gepekre. WebSocket/SSH/Tailscale csatlakozas. Capabilities: shell, docker, k8s, odoo, file-system. Permission ellenorzes helyi es tavoli oldalon.

Hasznalati peldak: K8s cluster eleres, tavoli Odoo dev, otthoni gep elerese munkahelyrol, CI/CD triggereles.

### Computer use (Perplexity inspired)

Az agent kepes a tavoli (vagy helyi) gepen bongeszt / kepernyot vezerelni. Ket mod:

1. **Browser control (CDP)** — Playwright/Puppeteer a node-on. Agent utasitasokat kuld, bongeszo vegrehajtja.
   - Hasznalat: web scraping, automatizalt teszteles, form kitoltes, kutatás
   - A remote-node `capabilities`-ben: `browser-control`
   - Biztonsag: URL allowlist, max session ido, screenshot audit log

2. **Screen control** — Kepernyokep + eger/billentyuzet vezerles (jovoben, nativ app-pal).
   - Hasznalat: desktop alkalmazasok automatizalasa
   - Fugg a nativ app fejlesztestol (macOS/iOS/Android node)

```typescript
// Browser control a remote-node-on keresztul:
await nodeInvoke.exec('server1', 'browser', {
  action: 'navigate',
  url: 'https://odoo.example.com/web/login',
})
await nodeInvoke.exec('server1', 'browser', {
  action: 'fill',
  selector: '#login',
  value: 'admin',
})
await nodeInvoke.exec('server1', 'browser', {
  action: 'screenshot',
})
```

---

## 21. Research modul
> **Status: [PARTIAL]** — Engine + workflow implemented, web search uses mock provider

### Web kereses + AI hirek + trend elemzes

A self-learning modul hivja periodikusan, de onalloan is hasznalhato.

### Deep research workflow (Perplexity inspired)

Strukturalt kutatasi folyamat:

```
1. Kerdes/tema megadasa
2. Web kereses (tobb forrasbol)
3. Forrasok relevancia ertkelese (AI)
4. Informacio extrakcio + osszefoglalo
5. Cross-referencing (forrasok egymassal valo osszehasonlitasa)
6. Fact-check (ellentmondas detektatas)
7. Vegso jelentes + forrasjegyzek
8. Mentes: memoria (semantic tier) + dokumentum (documents modul)
```

Hasznalati peldak:
- "Kutasd ki milyen Odoo modulok leteznek warehouse management-re"
- "Mi a legjobb gyakorlat K8s secret management-re 2026-ban?"
- "Hasonlitsd ossze a CASL es Casbin permission library-kat"

---

## 22. Board modul
> **Status: [DONE]** — Implemented in src/modules/board/ — kanban, projects, stages, conversations

Alap: step-04-board.md. Bovitesek:

### Pinned tasks (v0.5-bol athelyezve)

Task-ek "pinnelhetok" — a board tetejen kulon szekcioban jelennek meg, fuggetlenul a stage-uktol. Hasznos a kiemelt/aktualis feladatokhoz. A `tasks` tablaban `pinned BOOLEAN DEFAULT 0` mezo, frontend-en kulon "Pinned" szekci a board tetejen.

### Task messages bovites

```sql
-- task_messages bovitett mezokkkel
CREATE TABLE IF NOT EXISTS task_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  role TEXT NOT NULL,              -- 'user' | 'assistant' | 'system' | 'tool'
  content TEXT NOT NULL,
  model TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  cost_usd REAL,
  tool_calls TEXT,                 -- JSON: [{name, input, result, duration_ms}]
  feedback TEXT,                   -- 'good' | 'bad' | null (user feedback, self-learning-hez)
  created_at TEXT DEFAULT (datetime('now'))
);

-- Tomorites: regi uzenetek 10-es blokkokban osszefoglalva
CREATE TABLE IF NOT EXISTS task_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  summary TEXT NOT NULL,           -- AI-generalt osszefoglalo
  message_range TEXT NOT NULL,     -- "42-51" (melyik uzenetek)
  created_at TEXT DEFAULT (datetime('now'))
);

-- Archiv: eredeti uzenetek megorzese (read-only)
CREATE TABLE IF NOT EXISTS task_messages_archive (
  id INTEGER PRIMARY KEY,          -- Eredeti ID
  task_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  model TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  cost_usd REAL,
  tool_calls TEXT,
  created_at TEXT
);
```

### Message archivalasi flow

Ha task_messages.count > 50: legregebbi 10 osszefoglalasa (haiku) -> task_summaries, eredeti -> task_messages_archive, torles task_messages-bol. Igy a context builder mindig eleri: friss ~50 uzenet (teljes) + korabbi osszefoglalok (tomor) + archivbol visszakeresneto.

### Agent session tablak

```sql
CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  team_config TEXT NOT NULL,        -- JSON: agent team osszeallitas
  status TEXT DEFAULT 'running',    -- running | waiting_approval | completed | max_turns | failed | stuck | cancelled
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  total_cost_usd REAL DEFAULT 0
);
```

> **F2 update (2026-07-29):** the status vocabulary above is current, but this sketch
> predates the shipped `agent_sessions` table (`src/modules/agent/run-supervisor.ts`),
> which carries additional supervision columns not shown here — `conversation_id`,
> `agent_id`, `kind` (`interactive|background|team|delegation`), `heartbeat_at`,
> `deadline_at`, `attempts`, `checkpoint_ref`, `parent_run_id`, `error_kind`,
> `next_attempt_at`, `verification` (`passed|failed|unverified`), `critic_rounds`. See
> "Park-and-resume approval lifecycle (F2)" below for how `waiting_approval` and
> `verification` are actually driven.

```sql

CREATE TABLE IF NOT EXISTS agent_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id),
  from_agent TEXT NOT NULL,
  to_agent TEXT,                    -- NULL = broadcast
  type TEXT NOT NULL,               -- 'request' | 'response' | 'handoff' | 'review' | 'approval'
  content TEXT NOT NULL,
  tool_calls TEXT,
  model TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  cost_usd REAL,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### Park-and-resume approval lifecycle (F2, 2026-07-29)

An autonomous supervised run (background/team/delegation/pipeline) that escalates a gated
tool call no longer denies-and-continues — it **parks**: `agent_sessions.status` and the
owning conversation's status both move to `waiting_approval`, the run loop exits without
finalizing, and the pending call is queued in `autonomy_approvals`
(`src/modules/security-gate/autonomy-policy.ts`) with its arguments, an arg hash, and the
run id. Interactive (non-autonomous) chat is out of scope for parking — it keeps the
existing deny-and-continue + queued-approval flow.

The approval row **is** the grant: an operator's approve consumes it exactly once via a CAS
`UPDATE … WHERE consumed_at IS NULL`, before the tool is allowed to re-run with the same
arguments — a changed argument set never matches a stale grant and re-escalates instead.
Approve, reject, and TTL expiry (`security.approvalTtlHours`, default 72h) all drive a
warm-resume from the run's last checkpoint (`src/modules/agent/approval-resume.ts`):
approved runs re-issue the call, rejected/expired runs get an injected denial message
instead. A run lineage that re-parks 5 times fails outright with
`error_kind='approval_loop'` rather than looping forever.

### Session pruning

Regi, inaktiv session-ok automatikus tomorites/torlese (memoria + teljesitmeny):

- Lezart task-ok: 30 nap utan task_messages archivalas (ha meg nem tortent)
- Elhagyott task-ok (nincs aktivitas 90 napja): automatikus lezaras + archivalas
- Agent session-ok: befejezett session-ok 30 nap utan agent_messages archivalas
- Cron job: `session-pruning`, hetente

### Changelog generation (Auto Claude inspired)

Befejezett task-okbol automatikus release notes generalas:

```
1. Lekerdezi az utolso changelog ota lezart task-okat
2. AI osszefoglalo generálás (model-gateway, haiku — olcso)
3. Csoportositas: features, fixes, improvements
4. Markdown kimenet -> dokumentum (documents modul)
5. Opcionalis: Telegram/Slack ertesites
```

CLI: `eyas changelog generate [--since 2026-03-01] [--format markdown|html]`

### GitHub/GitLab issue import (Auto Claude inspired)

Issue-k behuzasa a board-ra, AI-val vizsgalat:

```
1. eyas board import github --repo owner/repo --labels "bug,feature"
2. Issue-k lekerdezese GitHub/GitLab API-n
3. Minden issue -> uj task a board-on (metadata: issue URL, labels, assignee)
4. AI elemzes: prioritas javaslat, scope becsles, agent team javaslat
5. Ket irany szinkron: task lezaras -> issue close (opcionalis)
```

Szukseges: GitHub/GitLab API token (secrets modul).

---

## 23. Documents modul
> **Status: [DONE]** — Implemented in src/modules/documents/ — local + S3, retention

### Document management (CORE)

Fajl mellekletek kezelese task-okhoz, local + S3-kompatibilis tarolas, retention policy.

### Storage strategia

```
Upload: Fajl -> local mentes -> S3 feltoltes (async) -> DB rekord
Letoltes: Local cache-ben van? -> igen: visszaadas, nem: S3-rol letoltes -> cache -> visszaadas
Task lezaras: retention timer indul -> X nap mulva local torles, S3-en MINDIG megmarad
Torles: local + S3 + DB soft-delete + audit log
```

### DB

```sql
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  module TEXT,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  local_path TEXT,
  remote_key TEXT,
  remote_provider TEXT,
  uploaded_at TEXT,
  retain_local_until TEXT,
  deleted_at TEXT,
  thumbnail_path TEXT,
  metadata TEXT,                   -- JSON
  created_by TEXT REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
```

### Config

```yaml
# config/personality/documents.yaml
storage:
  local_dir: data/documents
  max_file_size_mb: 50
  allowed_types: ["image/*", "application/pdf", "text/*", "application/zip"]
  remote:
    enabled: true
    provider: b2                   # 's3' | 'b2'
    bucket: eyas-documents
    upload_immediately: true
  retention:
    local_after_task_close_days: 14
    remote_retention_days: 0       # 0 = vegtelen
  thumbnails:
    enabled: true
    max_width: 200
    max_height: 200
```

---

## 24. Notifications modul
> **Status: [DONE]** — Implemented in src/modules/notifications/ — routing, preferences, 3 channels

### Egyseeges ertesitesi rendszer (CORE)

Kozponti ertesites routing, user preferenciak, severity szures, rate limiting.

### Flow

```
Barmely modul -> bus.emit('eyas.notify', { event, severity, userId, title, body, data })
  -> Notification router:
    1. User preference check (melyik csatornan akar ertesitest)
    2. Severity filter (kritikus mindig megy, info csak ha engedelyezte)
    3. Rate limiting (max N ertesites / ora)
    4. Csatorna kuldes (Telegram, Web push, Email, stb.)
    5. DB mentes (olvasott/olvasatlan)
```

### DB

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  event TEXT NOT NULL,
  severity TEXT NOT NULL,           -- 'info' | 'warning' | 'error' | 'critical'
  title TEXT NOT NULL,
  body TEXT,
  data TEXT,                        -- JSON
  read_at TEXT,
  channels_sent TEXT,               -- JSON: ["telegram", "web"]
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id TEXT NOT NULL REFERENCES users(id),
  event_pattern TEXT NOT NULL,      -- 'budget.*' | 'board.task.*' | '*'
  channel TEXT NOT NULL,
  min_severity TEXT DEFAULT 'info',
  quiet_hours TEXT,                 -- JSON: {"from":"22:00","to":"07:00"}
  PRIMARY KEY (user_id, event_pattern, channel)
);
```

### Beepitett esemenyek

| Esemeny | Severity | Default csatorna |
|---------|----------|-----------------|
| budget.warning | warning | telegram + web |
| budget.exceeded | critical | telegram + web |
| agent.team.completed | info | web |
| agent.team.failed | error | telegram + web |
| scheduler.job.failed | error | telegram |
| self-learning.recommendation | info | web |
| remote-node.offline | warning | telegram |
| audit.rollback.executed | warning | telegram + web |
| board.task.assigned | info | web |
| system.upgrade.available | info | web |

---

## 25. Ingress modul
> **Status: [PARTIAL]** — Cloudflare Tunnel provider stub

### Remote access gateway (EXTRA)

Biztonsagos tavoli eleres bongeszobol es nativ desktop/mobil alkalmazasbol. Provider pattern: Cloudflare Tunnel (default), Tailscale, WireGuard, manual reverse proxy.

### Konyvtar

```
modules/ingress/
  manifest.ts
  ingress-manager.ts               # Tunnel lifecycle management
  auth-proxy.ts                    # Extra auth layer a tunnel elott
  providers/
    types.ts                       # IngressProvider interface
    cloudflare-tunnel.ts           # Cloudflare Tunnel (cloudflared)
    tailscale.ts                   # Tailscale Serve/Funnel
    wireguard.ts                   # WireGuard
    manual.ts                      # Kezi config (reverse proxy mogott)
  tests/
```

### Cloudflare Tunnel flow

```
Tavoli kliens (bongeszo/app)
  -> Cloudflare Edge (DDoS, SSL, WAF)
    -> cloudflared daemon (helyi gepen)
      -> Eyas auth-proxy (JWT/API-key)
        -> Hono HTTP server (localhost:3000)
```

Cloudflared lifecycle: Eyas indulaskor child process, leallaskor graceful shutdown, auto-restart ha meghal.

### Nativ app tamogatas

REST API + WebSocket a CF Tunnelen keresztul:

```
App -> HTTPS (CF Tunnel) -> /api/v1/* (REST)
App -> WSS  (CF Tunnel) -> /ws (real-time)
Auth: JWT token (login) vagy API key (app-specifikus)
```

MCP over tunnel (Claude Desktop integracio):

```
Claude Desktop -> HTTPS (CF Tunnel) -> /mcp (MCP Server endpoint)
```

### Nativ app API contract

```
Auth:
  POST /api/v1/auth/login             -> JWT token
  POST /api/v1/auth/refresh           -> Uj JWT

Core:
  GET  /api/v1/board/tasks            -> Task lista
  POST /api/v1/chat/stream            -> AI chat (SSE)
  WS   /ws                            -> Real-time updates
  GET  /api/v1/notifications          -> Ertesitesek
  POST /api/v1/agent/run              -> Agent inditas
  GET  /api/v1/memory/search          -> Memoria kereses
  GET  /api/v1/status                 -> Rendszer allapot

Push (mobil):
  POST /api/v1/notifications/register-device -> FCM/APNs token
```

### Biztonsagi retegek

1. Cloudflare: DDoS, WAF, bot protection, SSL
2. Auth-proxy: JWT/API-key validacio
3. CASL permissions: user jogosultsagok
4. Rate limiting: per-user, per-IP
5. Audit log: minden tavoli muvelet logolva
6. Notification: bejelentkezes ertesites (Telegram)

### Config

```yaml
# config/personality/ingress.yaml
ingress:
  enabled: true
  provider: cloudflare
  auth:
    mode: both                     # 'jwt' | 'api-key' | 'both'
    allowed_origins: ["https://eyas.mydomain.com", "eyas-app://*"]
    rate_limit:
      anonymous: 10
      authenticated: 120
  cloudflare:
    tunnel_name: eyas
    domain: eyas.mydomain.com    # Opcionalis (egyebkent *.trycloudflare.com)
    auto_start: true
  notify_on_disconnect: true
```

---

## 26. Disaster Recovery modul
> **Status: [PARTIAL]** — Local tar.gz backup/restore, no S3 backend

TODO -- kidolgozando. Lasd: modules/disaster-recovery/README.md

Tervezett funkciok:
- Full backup restore flow (SQLite DB + documents + config)
- Point-in-time recovery (audit log + snapshots alapjan)
- Partial restore (csak egy tabla / modul)
- Backup verification (integrity check)
- Automated restore testing (cron: havonta)
- Remote backup-bol restore (S3/B2)
- CLI: `eyas backup restore <id> [--point-in-time <timestamp>]`
- Web UI: Admin > Backup & Recovery oldal

---

## 27. Szemelyiseg rendszer
> **Status: [PLANNED]** — YAML config exists, no full personality engine

YAML-based personality fajlok: identity, rules, boundaries, communication. Channel-specifikus overrides. Zod validacio. System prompt injection a model-gateway-en keresztul.

---

## 28. CLI interface
> **Status: [PARTIAL]** — 6 commands implemented (serve, doctor, status, config, module, version)

### Parancsok

```bash
eyas serve [--port 3000]           # HTTP szerver inditas (default)
eyas doctor                         # Rendszer diagnozis
eyas status                         # Modulok, budget, nodes, uptime

eyas task create "Review PR #42"    # Task CRUD
eyas task list [--project X]
eyas task update <id> --stage done
eyas task close <id>

eyas agent run "feladat leiras"     # Agent inditas
eyas agent run --team "code-reviewer,qa" "Review auth"
eyas agent list                     # Futo agent-ek
eyas agent stop <session-id>

eyas memory search "kulcsszo"       # Memoria kereses
eyas memory save "teny"             # Emlek mentes
eyas memory stats                   # Tier meretek, embedding coverage

eyas config get model-gateway.budget.daily
eyas config set model-gateway.budget.daily.limit 10.00
eyas config reload                  # Hot-reload trigger
eyas config validate                # Zod validacio

eyas module list                    # Modulok allapota
eyas module enable slack
eyas module disable siri

eyas skill list                     # Skill-ek
eyas skill import ./my-skill.md
eyas skill create --from-pattern

eyas node list                      # Remote node-ok
eyas node add server1 --ssh user@host
eyas node invoke server1 "kubectl get pods"

eyas backup create [--full]         # Backup
eyas backup list
eyas backup restore <id>

eyas notify send "Deploy kesz" --channel telegram
```

### Package.json

```json
{ "bin": { "eyas": "./dist/cli/index.js" } }
```

---

## 29. Frontend architektura
> **Status: [PARTIAL]** — React 19 + shadcn/ui + TanStack Router, no Lit components

Vite + Lit + CSS Custom Properties. Multi-page app: board, admin, chat, search.

Admin oldalak: Model Analytics, Users, Modules, Permissions, Audit Log (rollback), Skills, Agents, Self-Learning, Remote Nodes, Cron, Notifications, Documents, Backup & Recovery.

WebSocket kapcsolat a real-time frissitesekhez (board, notifications, agent progress).

### Live Canvas (OpenClaw inspired, jovoben)

Agent altal vezerelt vizualis workspace a bongeszloben:
- Agent rajzol diagramot, dashboardot, vizualizaciot real-time
- WebSocket-en keresztul push/reset/eval/snapshot muveletek
- Hasznalat: architektura diagram, adatvizualizacio, monitoring dashboard
- Implementacio: kulon Lit web component (`eyas-canvas`), canvas API

### Voice Wake + Talk Mode (OpenClaw inspired, jovoben — nativ app)

Hangvezerles macOS/iOS/Android nativ alkalmazasbol:
- Wake word detektalas ("Hey Eyas")
- Continuous voice mode (beszelgetes hang alapjan)
- TTS valasz (ElevenLabs vagy rendszer TTS)
- Fugg a nativ app fejlesztestol (Fazis 10+)

---

## 30. Verziozas es upgrade
> **Status: [PLANNED]** — No upgrade hooks implemented

eyas.json (verzio + schemaVersion + modul verziok). Pre/post upgrade hooks: backup, migracio, doctor.

---

## 31. Implementacios fazisok
> **Status: [DONE]** — All 10 implementation phases defined and tracked

### Fazis 0: Scaffolding
Projekt vaz, pnpm, config, gitignore, Dockerfile, CLI skeleton.

### Fazis 1: Core infrastruktura
Types, logger, config (+ hot-reload watcher), SQLite, migration, bus (LocalBus + NatsBus provider), Hono HTTP (+ WebSocket + API v1 prefix), i18n, locking, bootstrap, module-loader, doctor.

### Fazis 2: Security infrastruktura
Secrets (providers), auth (users, JWT), permissions (CASL, inheritance, sandboxing), audit (logging, snapshots, rollback, retention), privacy (scanner chain, policy engine), security-gate (3 checkpoint, rate limiting, tiered risk).

### Fazis 3: Model Gateway
Gateway, providers (claude-code, claude-api, ollama, openai), decision engine, function binding, budget, cache, queue, gateway retry + tier failover (F2 D10 — same-provider retry always on, cross-provider hop only when a tier's fallback provider/model is configured; no separate fallback.ts module).

### Fazis 4: Board modul
DB (+ task_messages bovites: tool_calls, feedback, task_summaries, task_messages_archive, agent_sessions, agent_messages), API, services, message archiver, events.

### Fazis 5: Memory modul
5-tier memory, vector providers (Orama + sqlite-vec), embedding providers, hybrid search, context builder, decay, consolidation.

### Fazis 6: Agent + Skills + Communication + Documents + Notifications
Agent orchestrator, team builder, parallel executor, QC loop. Skill registry, loader, matcher, prompt wizard. MCP server/client, channel router, unified channel interface, A2UI. Document storage (local + S3). Notification system (routing, preferences). Context engineering pipeline.

### Fazis 7: Scheduler + Search + Chat
Advanced triggers, chains, dead letter. Orama search, indexers. Web chat SSE/WS.

### Fazis 8: Extra modulok
Telegram, self-learning, backup, remote-node, ingress (CF Tunnel), research, webhooks, siri, meeting (MeetingProvider, Fireflies), proaktiv asszisztens, disaster-recovery (TODO).

### Fazis 9: Frontend + Observability
Vite, Lit, themes, board, admin (minden oldal), chat, search. WebSocket integracio. AI observability dashboard (trace, quality scoring, anomalia-detektalas, dontesi lanc vizualizacio). Koltseg dashboard.

### Fazis 10: CLI + Polish + Deploy
CLI parancsok, doctor teljes, upgrade hooks, Dockerfile, docker-compose, K8s manifests, README, CLAUDE.md, tests, performance.

---

## 32. Migracios strategia
> **Status: [DONE]** — Migration strategy documented and executed

Friss start, nincs migracio a regi rendszerbol. A regi branch megmarad referencanak.

---

## 33. Tesztelesi strategia
> **Status: [DONE]** — Vitest suite — 948+ tests, 112 files

### Unit tesztek (Vitest)
Minden modul sajat tests/. Mock AI provider: elodefinialt valaszok, 0 API hivas.

### Integration tesztek
Bus, HTTP, auth+permissions, gateway, audit rollback, memory hybrid search.

### AI komponens teszteles

3 szintu megkozelites:
1. **Mock provider** — MockAIProvider class, elodefinialt valaszokkal, unit tesztekhez
2. **Fixture valaszok** — test/fixtures/ai-responses/*.json, tipikus AI valasz strukturak
3. **Snapshot testing** — AI-fuggo komponensek kimenetenek snapshotolasa (regression)

```typescript
// vitest.config.ts
env: {
  EYAS_AI_PROVIDER: 'mock',    // Tesztekben mindig mock
  EYAS_SECRET_PROVIDER: 'env', // Env-bol, nem Keychain-bol
}
```

### E2E tesztek
Bootstrap-shutdown, telegram-gateway-response, chat WS, board CRUD, agent team. Opcionalis valos AI: `TEST_USE_REAL_AI=true`.

---

## 34. Platformfuggetlenseg
> **Status: [DONE]** — Bun primary + Node.js fallback, cross-platform compatibility verified

### Tamogatott platformok

| Platform | Secret provider | Megjegyzes |
|----------|----------------|------------|
| macOS | encrypted-file (age) | Teljes tamogatas |
| Linux | encrypted-file (age) | Teljes tamogatas |
| Windows (WSL2) | encrypted-file (age) | WSL2-n javasolt |
| Docker | env provider | Compose/secrets |
| Kubernetes | k8s-secret provider | Native secret integracio |

### Platform detection

```typescript
interface PlatformInfo {
  os: 'darwin' | 'linux' | 'win32'
  arch: 'x64' | 'arm64'
  runtime: 'node' | 'bun'
  container: 'none' | 'docker' | 'k8s'
  isCI: boolean
}
```

### Docker support

Multi-stage, multi-platform Dockerfile. Non-root user. Volumes: /app/data, /app/config.

### Kubernetes support

Deployment + Service + PVC. readinessProbe + livenessProbe (/api/health). securityContext: runAsNonRoot, readOnlyRootFilesystem. k8s-secret provider.

---

## 35. Concurrency es locking
> **Status: [IMPLEMENTED]** — Distributed advisory locks via `scheduler_locks` table (`src/modules/scheduler/scheduler-lock.ts`). Scheduler acquires a per-job lock before firing a cron handler; expired locks are reclaimed via heartbeat timestamp.

### DB concurrency

SQLite WAL mode: parhuzamos olvasas, szekvencialis iras. Optimistic locking: `version` mezo.

```sql
-- Update csak ha a version egyezik:
UPDATE tasks SET title = ?, version = version + 1
  WHERE id = ? AND version = ?;
-- Ha 0 row affected -> ConflictError -> retry
```

### Advisory locks

```sql
CREATE TABLE IF NOT EXISTS advisory_locks (
  resource TEXT PRIMARY KEY,       -- 'task:abc123' | 'file:/src/config.ts'
  owner TEXT NOT NULL,             -- Agent session ID
  acquired_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL         -- Auto-expire (max 5 perc)
);
```

### Agent szabalyok

1. Worktree agent-ek: sajat git worktree, nincs fajl konfliktus
2. Non-worktree: advisory lock fajl modositasnal
3. DB iras: mindig optimistic locking (version mezo)
4. Merge: AI-powered conflict resolution
5. Deadlock prevention: lock ordering (resource nev ABC sorrend) + TTL

---

## 36. API versioning
> **Status: [PLANNED]** — /api/v1/ only, no v2 mechanism

URL prefix: `/api/v1/`. Fallback: `/api/*` -> `/api/v1/*` redirect (301). Breaking change eseten: v2 route-ok 12 honapig parhuzamosan, v1 `Deprecation` header-rel. User modulok `apiVersion` mezot kapnak manifest-ben.

---

## 37. Config hot-reload
> **Status: [DONE]** — Implemented — fs.watch + 300ms debounce + Zod validation + bus events

### Mely config fajlok reload-olhatok restart nelkul?

| Config | Hot-reload? |
|--------|-------------|
| model-gateway.yaml | Igen |
| permissions.yaml | Igen |
| identity/rules/boundaries/communication.yaml | Igen |
| overrides/*.yaml | Igen |
| documents.yaml | Igen |
| notifications.yaml | Igen |
| Agent YAML-ok | Igen |
| modules.json | Nem (restart) |
| .env | Nem (restart) |

### Mechanizmus

`core/config/watcher.ts`: fs.watch a config/personality/ konyvtaron. Debounce (300ms). YAML betoltes -> Zod validalas -> ha hibas: SKIP + warning + notification, regi config marad. Ha jo: config registry frissites -> bus event `eyas.config.reloaded` -> erintett modulok ujratoltik.

CLI: `eyas config reload` (kezi trigger), `eyas config validate` (Zod check).

---

## 38. WebSocket real-time
> **Status: [DONE]** — Implemented in src/core/websocket/ — connection registry, bus bridge, JWT auth

### Architektúra

`core/http/websocket.ts`: Hono WS tamogatas. Auth: JWT query param. Topic-alapu subscribe.

```
Topic-ok:
  board:<projectId>           -- Board valtozasok (task CRUD, stage move)
  notifications:<userId>      -- User ertesitesek
  agent:<sessionId>          -- Agent progress (real-time)
  chat:<taskId>              -- Chat uzenetek
  system                      -- Rendszer esemenyek (module status, budget)
```

### Bus -> WebSocket bridge

Bus event-ek automatikus tovabbitasa WS-en a feliratkozott klienseknek. A board, notifications, agent modulok bus event-jei automatikusan megjelennek a megfelelo WS topic-on.

---

## 39. User module sandboxing
> **Status: [PLANNED]** — Not implemented

User modulok (`config/user-modules/`) korlatozott `SandboxedModuleContext`-et kapnak:

| Eroforras | Korlat |
|-----------|--------|
| DB | Csak `usermod_<moduleId>_*` tablak |
| Secrets | Csak `USERMOD_<moduleId>_*` kulcsok |
| Bus | Csak `eyas.usermod.<moduleId>.*` emit/on |
| HTTP | Csak `/api/v1/usermod/<moduleId>/*` route-ok |
| File system | Csak `data/user-modules/<moduleId>/` |
| Auth/Permissions | Nincs hozzaferes |
| Mas modulok | getModule tiltott |

Config: `permissions.yaml` > `user_modules` szekci (sandbox: true/false, max_db_tables, max_routes, allowed_bus_patterns).

---

## 40. Privacy modul
> **Status: [DONE]** — Implemented in src/modules/privacy/ — PII scanner chain, policy engine

### Szenzitiv adat vedelem (CORE, 2026-03-23, NemoClaw inspired)

Minden adat, mielott elagyja a rendszert (cloud AI motor, kulso API, csatorna), athalad a privacy modulon. Ha van lokalis motor, automatikusan oda iranyit. Ha nincs, figyelmeztet.

### Scanner chain (szekvencialis)

```typescript
interface PiiScanner {
  id: string
  scan(text: string): Promise<PiiMatch[]>
}

interface PiiMatch {
  type: string          // 'personal_id' | 'tax_number' | 'iban' | 'email' | 'phone' | 'custom'
  value: string         // A talalt szenzitiv adat
  start: number         // Pozicio a szovegben
  end: number
  confidence: number    // 0-1
  scanner: string       // Melyik scanner talalta
}
```

1. **RegexScanner** — beepitett mintak, mindig elerheto. Magyar PII (szemelyi szam, TAJ, adoszam, IBAN) + nemzetkozi (SSN, bankkaryta, email, telefon).
2. **NerScanner** — opcionalis, Ollama/lokalis NER modell szukseges (GLiNER-PII kompatibilis). Magasabb pontossag, lassabb.
3. **CustomScanner** — felhasznalo-definalt YAML szabalyok (pattern + action parok). Pl. ceges projekt nevek, belso kodok.

### Policy muveletek

| Muvelet | Leiras |
|---------|--------|
| `auto_local` | Ha van lokalis motor (Ollama), automatikusan oda iranyitja a kerest. Ha nincs, figyelmeztet. |
| `warn` | Figyelmezteti a felhasznalot, o dont |
| `block` | Soha nem megy cloud-ba, azonnali blokk |
| `sanitize` | PII maszkalas (csillagokkal), utana cloud OK |

### YAML policy konfiguracio

```yaml
# config/personality/privacy.yaml
privacy:
  enabled: true
  scanners:
    - regex       # Mindig aktiv
    - ner         # Ha van Ollama
    - custom      # Ha van custom rules
  rules:
    - pattern: "personal_id|tax_number|iban"
      action: "block"
    - pattern: "internal_project_name"
      action: "warn"
    - pattern: "source_code"
      action: "auto_local"
    - pattern: "generic_pii"
      action: "sanitize"
  audit: true     # Minden PII detektcio es routing dontes logolva
```

### Integracio

A privacy modul a `communication/` es `ai-engine/` kozott ul — minden adat athalad rajta. A model-gateway hivja a kuldos elott, a communication modul hivja a fogadas utan.

---

## 41. Security Gate
> **Status: [DONE]** — Implemented in src/modules/security-gate/ — 3 checkpoints

### 3 checkpoint-os parancs-validacio (CORE, 2026-03-23, CaMeL/LlamaFirewall inspired)

Overhead elfogadott, biztonsag prioritas. Minden parancs 3 fuggetlen ellenorzesi ponton megy at.

### Checkpoint 1 — Deterministic Gate

Nem LLM, nem manipulalhato. <5ms.

- **Regex blocklist**: ismert veszelyes parancsok, injection mintak
- **Attack pattern matching**: ismert tamadasi mintak (prompt injection, jailbreak)
- **Rule of Two check** (Meta): Max 2 teljesulhet egyszerren: (1) nem megbizhato input, (2) szenzitiv adat hozzaferes, (3) kulso akcio. Ha mind 3 kell -> kotelezo human approval.
- **Rate limit check**: progressziv limitek ellenorzese

### Checkpoint 2 — LLM Security Judge

Kulon AI kontextus (NEM az executor AI). Fuggetlen, nem manipulalhato az executor altal.

- Policy-k alapjan dontest hoz
- **Sandwich prompt**: szabalyok a keres ELOTT es UTAN (szabalyok fogjak kozre a kerest)
- Ha megfelel: osszallitja az executor prompt-ot (szabalyok + keres + tiltasok)
- Ha NEM felel meg: visszakuldi a chat-be magyarazattal + rate limit szamlalo novelese

### Checkpoint 3 — Runtime Monitor

Az executor futasa kozben parhuzamosan:
- **Chain-of-Thought auditor**: eszreveszi ha az AI elter a feladattol
- **Action validator**: valos ido ellenorzes a vegrehajtott muveletekre
- **Output PII check**: eredmeny szures a privacy modulon

### Tiered risk (CaMeL-inspired)

| Szint | Pipeline | Pelda |
|-------|----------|-------|
| Green | Csak Deterministic Gate | Fajl olvasas, kereses |
| Yellow | Det. Gate + LLM Judge | Fajl iras, config modositas |
| Red | Teljes pipeline + Human approval | Torles, penzugyi muvelet, deploy |

### Progressziv rate limiting

Visszautasitott parancsokra csuoszo ablakos limitek:

| Ablak | Max | Hatas |
|-------|-----|-------|
| Streak | 3 | Azonnali block |
| 1 ora | 5 | Azonnali block |
| 1 nap | 10 | Azonnali block |
| 1 het | 20 | Azonnali block |
| 1 honap | 30 | Azonnali block |
| Lifetime | 50 | Vegleges block |

Minden kuszboertek konfiguralhato. **Nincs automatikus lejarat** -- admin ertesitest kap es csak o oldhatja fel.

### Config

```yaml
# config/personality/security-gate.yaml
security_gate:
  enabled: true
  risk_tiers:
    green: [file.read, search, memory.read]
    yellow: [file.write, config.update, git.commit]
    red: [file.delete, db.drop, deploy, financial_action]
  rate_limits:
    streak: 3
    hour: 5
    day: 10
    week: 20
    month: 30
    lifetime: 50
  rule_of_two:
    enabled: true
    factors: [untrusted_input, sensitive_data, external_action]
```

### Referenciak

CaMeL (Google DeepMind), LlamaFirewall (Meta), Rule of Two (Meta), NeMo Guardrails (NVIDIA), Firewalled Agentic Networks (Microsoft).

---

## 42. Workflow: Guardrails, not rails
> **Status: [PARTIAL]** — Approval-tier policy (Phase 3F, `src/modules/security-gate/approval-tiers.ts`) and security-gate 3-checkpoint validation (`src/modules/security-gate/`) implement the "limits + goals, not steps" pattern for tool calls. The 3-layer conceptual framework (sandbox limits / goal-deviation detection / escalation) is not yet fully codified as a single module.

### Megkozelites (2026-03-23)

Nem hagyomanyos merev workflow-k, hanem 3 retegu hibrid. Nem a lepeseket drotozzuk be, hanem a **korlatokat es a celokat**. Az AI szabadon dont a hogyanrol -- de a hatarokat nem lepheti at.

### 3 reteg

#### 1. Recipe (laza sablon)

Celok listaja, opcionalis sorrend, kotelezo checkpoint-ok. A "mit" definialt, a "hogyan" AI-ra bizva.

```yaml
# config/recipes/deploy-production.yaml
recipe:
  name: "Production Deploy"
  goals:
    - "Run full test suite"
    - "Build production artifacts"
    - "Deploy to staging, verify"
    - "Deploy to production"
  checkpoints:
    - after: "test suite"
      require: "all_tests_pass"
    - after: "staging deploy"
      require: "human_approval"
  depends_on:
    staging_deploy: ["test_suite", "build"]
    production_deploy: ["staging_deploy"]
```

#### 2. Guardrails (korlatok)

Nem athahato szabalyok, mindig aktivak (recipe-vel es anelkul is):

- `financial_action_requires_approval` -- penzugyi muvelet mindig jovahagyas
- `pii_in_external_call` -- PII soha nem mehet cloud-ba szures nelkul
- `destructive_action_confirm` -- torles, deploy mindig megerosites
- A permissions/ es privacy/ modul biztositja

#### 3. AI szabadsag

A recept es a guardrail-ek kozott az AI **szabadon dont** a lepesekrol, sorrendrol, eszkozokrol. Ez teszi lehetove a kreativitast es az alkalmazkodast — nem kell minden lehetseges utat elore beprogramozni.

### Implementacio — nem kulon modul

Meglevo modulok kombinacioja:
- **Recipe-k** -> skills/ modul (YAML sablon)
- **Guardrails** -> permissions/ + privacy/ modul
- **Checkpoint** -> communication/ (permission relay pattern)
- **Execution** -> agent/ modul
- **Tanulas** -> self-learning/ modul
- **Audit** -> audit/ modul

Nyitott kerdes: kell-e vekony orchestrator reteg (scheduler/ bovites vagy dedikalt).

---

## 43. Meeting Processing modul
> **Status: [PARTIAL]** — MeetingProvider interface + Fireflies adapter stub

### Pluggable MeetingProvider pattern (EXTRA, 2026-03-23)

Egyscges meeting feldolgoazs rendszer, provider pattern-nel cserelheto backend-del.

### MeetingProvider interface

```typescript
interface MeetingProvider {
  id: string
  connect(): Promise<void>
  getTranscript(meetingId: string): Promise<Transcript>
  getSummary(meetingId: string): Promise<MeetingSummary>
  getActionItems(meetingId: string): Promise<ActionItem[]>
  onNewMeeting?(handler: (meeting: MeetingEvent) => Promise<void>): void
}

interface Transcript {
  segments: {
    speaker: string
    text: string
    startTime: number
    endTime: number
  }[]
  language: string
}

interface MeetingSummary {
  memo: string
  keyPoints: string[]
  decisions: string[]
}

interface ActionItem {
  description: string
  assignee?: string
  deadline?: Date
  priority?: 'high' | 'medium' | 'low'
}
```

### Providerek

| Provider | Tipus | Jellemzok |
|----------|-------|-----------|
| **FirefliesProvider** (default) | SaaS | GraphQL API, MCP server, webhook, magyar transzkripci. Auto-join: Zoom, Google Meet, MS Teams, Webex, Slack Huddles, GoTo Meeting, stb. |
| **ZoomProvider** | SaaS | AI Companion 3.0, nativ MCP integraci |
| **RecallProvider** | SaaS | Infastruktura API ($0.50/hr), sajat Whisper pipeline |
| **LocalProvider** | Self-hosted | Jitsi + Whisper + Ollama, teljes self-hosted |

### Egyscges kimenet

Minden provider ugyanazt az output formtumot adja:
- **Transcript**: beszelo + idobelyeg
- **Summary**: memo (AI-generalt)
- **Action items** -> automatikusan a scheduler/ modulba kerulnek

### Integracio

- Meeting tartalom a **privacy/** modulon megy at (szenzitiv adat szures)
- Action item-ek a **scheduler/** modulba kerulnek (automatikus feladat letrehozas)
- Osszefoglalo a **memory/** modulba (semantic tier, keresheto)
- Ertesites a **notifications/** modulon (meeting kesz, action item-ek)

### Magyar nyelv

- Fireflies es Zoom AI Companion: tamogatja a magyar transzkripicot
- Self-hosted (LocalProvider): fine-tuned Whisper szukseges (pl. Trendency/whisper-large-v3-hu)

### Config

```yaml
# config/personality/meeting.yaml
meeting:
  enabled: true
  provider: fireflies
  auto_process: true
  action_items:
    auto_create_tasks: true
    default_project: "meetings"
  privacy:
    scan_transcript: true
  language: "hu"
```

---

## 44. Prompt Wizard (v2 — Autonomous Agent Prompt Architecture)
> **Status: [DONE v2]** — File-based workspace system. Design spec: `docs/superpowers/plans/2026-04-26-autonomous-agent-prompt-architecture.md`

### v2 architektura

Az agensek promptja nem adatbazisban tarolt szoveg, hanem fajl-alapu munkater (`data/agents/<id>/`) amelybol a rendszer cache-tudatos, strukturalt promptot allitas ossze minden hivashoz.

#### Munkater fajlok (AgentWorkspace)

| Fajl | Tartalom |
|------|----------|
| `IDENTITY.md` | Ki vagyok, misszio, proaktiv feladatok, eskalacio |
| `SOUL.md` | Hang profil — cim, stilus, tiltott szavak (human-readable) |
| `SOUL.style.json` | Hang profil — gepilvaszhato JSON (8 preset + custom) |
| `AGENTS.md` | Agens-specifikus szabalyok, csapat-koordinacios jegyzetek |
| `TOOLS.md` | Eszkoz-hasznalati megjegyzesek |
| `MEMORY.md` | Alando memoria (napi fajlok: `memory/YYYY-MM-DD.md`) |

#### Assembler pipeline (`src/modules/prompt-wizard/assembler.ts`)

```
buildForPrimary(opts) →
  workspaceLoader.load(agentId)          — fajl-cache (SHA-256 invalidation)
  projectContextLoader.cascade(projectId) — project-type + project AGENTS.md merge
  resolveSkillsFor / resolveToolsFor     — elerheto skillak + eszkozok listaja
  resolveActiveVoice                     — 5-szintu scope-feloldas (per-msg > ephemeral > conv > channel > auto)
  buildCachePrefix(...)                  — stabil cache-elohato resz
  buildCacheSuffix(...)                  — dinamikus per-turn resz
  → AssembledPrompt { prefix, suffix, reminders, cacheBoundaryHint, prefixHash, tokenEstimate }
```

#### Cache hatar

- `prefix` = stabil: CORE_IDENTITY + CORE_RULES + cascade + IDENTITY + SOUL + AGENTS + TOOLS + skillak
- `suffix` = dinamikus: team kontextus, memoria, runtime, aktiv hang profil
- Anthropic: `cache_control: { type: 'ephemeral' }` a prefix blokkra
- OpenAI: automatikus prompt caching (prefix + suffix concatenalva)
- Ollama: nincs cache tamogatas

#### Voice rendszer (6 dimenzio, 8 preset)

- Dimeziok: cim (tegező/magázó/önöző/kontextus-érzékeny), hang, reszletesseg, direktseg, humor, emoji
- Presetek: `jarvis`, `best-buddy`, `senior-ceo`, `pajtas-dev`, `standup`, `diplomata`, `coach`, `tutor`
- Scope: `internal` (tulajdonos/csapat) vs `external` (kulso felel)
- Override hierarchia: per-message > ephemeral-session > per-conversation > per-channel > auto

#### Subagent delegalas (`src/modules/prompt-wizard/subagent-prompt-builder.ts`)

A subagent `ParentSnapshot`-ot kap az originating agenttol — tartalmazza annak hang profilajat. Ez biztositja, hogy a vegeredmeny a megbizo agens hangjat koveti, nem a kozvetito agenset.

#### Workspace bootstrap + self-edit

- `bootstrapAgentWorkspaceFromSeed()` — template seedbol materializalja a munkater fajlokat
- `workspace_update_identity` eszköz — az agens sajat IDENTITY.md-jet modosithatja (rate limit: 3/nap, ertesites kuldes diff-fel)
- `forge_propose_soul_change` eszköz — hang profil valtoztatasi javaslat, tulajdonosi jovahaggyas utan alkalmazza a `SoulProposalApplier`

#### Tesztek

- `tests/integration/end-to-end-primary-agent.test.ts` — E2E: workspace bootstrap + assembler
- `tests/integration/sub-agent-delegation.test.ts` — delegalasi lanc hang-megorzessel
- `tests/integration/voice-scope-override.test.ts` — 5-szintu prioritas hierarchia
- `tests/integration/cascade-merge.test.ts` — project-type + project + agens AGENTS.md sorrendiseg
- `tests/performance/prompt-cache-anthropic.test.ts` — cache_control plumbing + gated 80% hit-ratio gate

---

## 45. Context Engineering Pipeline
> **Status: [DONE]** — Implemented in src/modules/memory/context-builder-v2.ts — merged into memory module

### Futasideju kontextus-osszeallitas (2026-03-23, ai-engine bovites)

A memory/ es az ai-engine/ kozott ulo dontesi motor: az eltarolt informaciobol (5-tier memory) **mi** kerul a promptba, **mikor**, **milyen strukturaban**.

### Funkciok

- **Szelektalas**: relevancia alapjan valogatja a memoriat (nem minden emlek kerul a promptba)
- **Tomorites**: hosszu emlekek osszefoglalasa, redundancia kiikttatasa
- **Prioritizalas**: friss, gyakran hasznalt, magas relevancia -> elore
- **Formazas**: model elvarasai szerint (Claude XML tags, OpenAI JSON, stb.)
- **Verziozott strategiak**: kulonbozo context assembly strategiak task tipusonkent

### Audit

Minden context assembly logolva -- visszanezhetho hogy egy adott AI hivasnal milyen kontextust kapott a modell:
- Milyen memory tier-ekbol jott az informcio
- Mi lett kihagyva es miert
- Tomorites aranyok
- Debug + optimalizalas lehetoseg

### Implementacio

A memory/ modul context-builder.ts-enek bovitese, a model-gateway hivja minden AI keres elott.

---

## 46. AI Observability
> **Status: [DONE]** — Implemented in src/modules/observability/ — trace collector, anomaly detector, cost dashboard

### Tokn-szintu megfigyeles (2026-03-23, audit/ modul bovites)

Ez **tobb mint audit log**. Az audit a "mi tortent", az observability a "miert es mennyire jol".

### Telemetria retegio

```typescript
interface AITrace {
  id: string
  timestamp: Date
  requestId: string
  model: string
  provider: string

  // Input
  inputContext: {
    memoryTiers: string[]       // Melyik tier-ekbol jott az info
    contextTokens: number
    systemPromptTokens: number
    toolDefinitions: string[]
  }

  // Execution
  toolCalls: {
    name: string
    input: unknown
    output: unknown
    durationMs: number
  }[]

  // Output
  outputTokens: number
  costUsd: number
  latencyMs: number

  // Quality
  qualityScore?: {
    auto: number              // Kis modell ertekel (0-1)
    userFeedback?: 'good' | 'bad'
    evaluatorModel?: string
  }
}
```

### Anomalia-detektalas

- **Koltseg kiugrasok**: hirtelen megnovekedett koltseg detektalasa + riasztas
- **Szokatlan viselkedes**: tul sok tool call, rendellenes valasz meret
- **Hallucination patterns**: ismetlodo teves valaszok felismerese
- **Latency drift**: lassulas detektalasa

### Dontesi lanc vizualizacio

Frontend oldalon interaktiv vizualizacio: adott feladat kapcsan milyen AI dontesek torttek, milyen kontextussal, milyen eredmennyel. Hasznos debug es optimalizacios eszkoz.

### Quality scoring

Ket megkozelites egyutt:
1. **Automatikus**: kis/olcso modell ertekel (pl. Haiku) a nagy modell valaszat (0-1 skor)
2. **User feedback**: thumbs up/down a chat-ben, osszekapcsolva a trace-szel

---

## 47. Proaktiv Asszisztens
> **Status: [DONE]** — Implemented in src/modules/proactive/ — source adapters, lesson learner

### Nem csak reaktiv (2026-03-23, scheduler/ + self-learning/ + communication/ kombinacio)

Eyas nem csak var, hanem **maga kezdemenyez** ha eszrevesz valamit.

### Forrasok (pluggable source adapters)

| Tipus | Forrasok |
|-------|----------|
| **Belso** | Taskok, meetingek, git, audit log |
| **Kulso** | Email (IMAP), naptar (CalDAV/Google), Slack, GitHub -- pluggable adapter-ek |

### Idozites

| Tipus | Pelda |
|-------|-------|
| **Fix idopontu** | Reggeli brief (8:00), heti osszefoglalo (hetfo 9:00) — scheduler/ integracio |
| **Valos ideju** | Amint eszrevesz valamit, szol — event-driven |

### Lesson Learner (v0.5-bol athelyezve)

Korabban oranekent futott kulon modul, most a proaktiv asszisztens resze. **Hetente** elemzi a lezart task-ok es conversationok tartalmat, es kinyeri a visszahasznositahto tudast:
- Ismetlodo mintak felismerese
- Megoldasi strategiak dokumentalsa
- Hiba-tanulsagok archivalasa a memory/ semantic tier-be
- Skill javaslat ha ismetlodo minta latszik

Cron: heti (pentek 18:00), a self-learning/ modul hivja.

### Bot Executor — Autonomus task feldolgozas (v0.5-bol athelyezve)

A v0.5-ben kulon `bot-executor.ts` volt, a v2-ben a proaktiv asszisztens es az agent/ modul egyutt latja el. Mukodes:
- Stage-ek `bot_listen` flag-gel jelolhetok (board config)
- Ha egy task ilyen stage-be kerul es a task `activity_state` = `waiting`, az agent automatikusan feldolgozza
- Stage progresszio: a bot maga lepes az elore definialt pipeline-ban
- Subtask letrehozas automata modban
- A security-gate/ modul ellenorzi minden autonomus muveletet (Yellow/Red tier)

### Peldak

- "3 megvalaszolatlan email, 2 surgos -- keszitettem piszkozatokat"
- "30 perc mulva meeting X-szel -- itt az elozmeny es a nyitott taskok"
- "3 PR var merge-re 2+ napja"
- "A mai deadline-hoz meg 2 task van nyitva"
- "Tegnap esti deploy utan megnott a hiba-arat az audit logban"

### Konfiguracio

```yaml
# config/personality/proactive.yaml
proactive:
  enabled: true
  sources:
    internal:
      tasks: true
      meetings: true
      git: true
      audit: true
    external:
      email:
        enabled: true
        check_interval: "*/15 * * * *"    # 15 percenkent
      calendar:
        enabled: true
        provider: google                    # 'google' | 'caldav'
        prep_before_minutes: 30
      github:
        enabled: true
        stale_pr_days: 2
      slack:
        enabled: false
  schedules:
    morning_brief: "0 8 * * 1-5"          # Hetfotol pentekig 8:00
    weekly_summary: "0 9 * * 1"           # Hetfo 9:00
  channels:
    morning_brief: ["telegram"]
    real_time: ["web"]
    urgent: ["telegram", "web"]
  quiet_hours:
    from: "22:00"
    to: "07:00"
    except: ["critical"]
```

---

## 48. A2UI -- Agent-to-User Interface
> **Status: [DONE]** — Implemented in src/web/src/components/a2ui/ — 7 widget types (frontend only, no backend module)

### Strukturalt UI valaszok (2026-03-23, Google A2UI inspiracio)

Az agent nem csak szoveget kuld, hanem **interaktiv UI elemeket**: datumvalaszto, form, tablazat, gombok, diagramok.

### Univerzalis A2UI formatum

```typescript
interface A2UIMessage {
  type: 'text' | 'form' | 'table' | 'buttons' | 'chart' | 'date_picker' | 'progress' | 'card'
  content: unknown          // Tipus-fugg tartalom
  fallback_text: string     // Szoveges visszaeses, ha a csatorna nem tamogatja
}

// Pelda: gomb-sor
const buttonsMsg: A2UIMessage = {
  type: 'buttons',
  content: {
    prompt: 'Melyik deploymentet inditsd ujra?',
    buttons: [
      { label: 'web-app', action: 'restart_deployment', params: { name: 'web-app' } },
      { label: 'api-server', action: 'restart_deployment', params: { name: 'api-server' } },
      { label: 'Mindketto', action: 'restart_all', params: {} },
    ]
  },
  fallback_text: 'Melyik deploymentet inditsd ujra? (1) web-app (2) api-server (3) Mindketto'
}
```

### Csatornanke tnt rendering

| Csatorna | Widget tamogatas |
|----------|-----------------|
| **Web UI** | Teljes widget keszlet (React/Lit komponensek) |
| **Telegram** | Inline keyboard gombok, markdown tablazat |
| **Discord** | Embed + buttons, markdown |
| **CLI** | Szoveges fallback, szinezes |
| **Email** | HTML tablazat, linkek |
| **Slack** | Block Kit (buttons, selects, datepicker) |

### Graceful fallback

Ha a csatorna nem tamogat egy widget tipust, automatikusan a `fallback_text` mezot hasznalja. A Channel adapter felelossege az univerzalis formatumot a csatorna kepessegeihez igazitani.

### Implementacio

A communication/ modul channel-types.ts bovitese az A2UIMessage tipussal. Minden channel adapter implementalja a renderelest.

---

## 49. A2A Protocol — Google Agent-to-Agent
> **Status: [DONE]** — Implemented in src/modules/communication/submodules/a2a/

A Google Agent-to-Agent (A2A) protokoll implementacioja, amely lehetove teszi az EYAS agent-ek kommunikaciojat mas A2A-kompatibilis rendszerekkel.

### Fo komponensek

1. **Agent Card** — `/.well-known/agent-card.json` endpoint, amely leirja az EYAS kepessegeit (skills, capabilities, supported content types)
2. **JSON-RPC Server** — Task lifecycle kezeles: `tasks/send`, `tasks/get`, `tasks/cancel`. Streaming tamogatas SSE-n keresztul.
3. **A2A Client** — Tavoli agent-ek felfedezese agent card alapjan, task delegalas es eredmeny fogadas.
4. **Delegate Tools** — 4 agent tool a kommunikaciohoz:
   - `a2a_discover` — tavoli agent card lekerdezese
   - `a2a_send_task` — task kuldese tavoli agent-nek
   - `a2a_get_task` — task allapot lekerdezese
   - `a2a_cancel_task` — task torlese

### Integracios pontok

- Communication modul submodule-kent fut
- Agent modul hasznalja a delegate tool-okat
- Security Gate validalja a bejovo A2A kereseket

---

## Fontos szabalyok a fejleszteshez

1. Ne hasznalj MeiliSearch-ot -- Orama + SQLite FTS5
2. Ne hasznalj Docker-t development-ben -- minden embedded
3. Semmi mas modul ne hivja kozvetlenul az AI SDK-t -- csak a model-gateway-en keresztul
4. Minden personality config YAML -- Zod-dal validalva, hot-reloadable
5. CSS-ben soha ne hardkodolj szint -- mindig CSS variable
6. Minden action audit logba -- snapshot-tal modositasok elott
7. Secret-ek soha nem jelennek meg log-ban vagy outputon
8. Core modulok nem kapcsolhatok ki
9. TypeScript strict mode mindenhol
10. Minden fazis vegen mukodo rendszer
11. CASL permission check minden vedett endpoint-on
12. Platform-specifikus kod CSAK provider-ekben (soha nem core-ban)
13. Ahol jo open source megoldas van, azt hasznaljuk
14. Agent team javaslat bonyolult feladatoknal
15. Self-learning javaslatok ismetlodo mintaknal
16. User modulok MINDIG sandboxed ModuleContext-et kapnak
17. Optimistic locking (version mezo) minden parhuzamos DB irasnal
18. API endpoint-ok /api/v1/ prefix alatt
19. WebSocket real-time a board es notifications moduloknal
20. Dokumentumok S3-re azonnal, local retention konfiguralhato

## Module authoring szabalyok

Minden uj modul: manifest.ts, tests/ (min. 1 test), health check, migraciok (ha DB), event subject-ek eyas.\<module\>. prefix-szel, permission definiciok, platform requirements. User modulok SandboxedModuleContext-et kapnak.

## Kod stilus

TypeScript strict, ESM, Pino logging, Zod validation, magyar business logic kommentek, angol technical kod.

## Inspiracio forrasok

- **OpenClaw**: Gateway, Skills registry, Node capabilities, Doctor, Multi-channel, Agent-to-Agent sessions
- **Auto Claude**: Git worktree, 3-layer security, Parallel agents (12 max), Self-validating QA, AI merge, Memory Layer, Kanban
- **Perplexity Computer**: Skill-based assistant, domain-specific super-skills (.md), automatic skill activation
- **CaMeL (Google DeepMind)**: Tiered risk, deterministic pre-checks before LLM execution
- **LlamaFirewall (Meta)**: Multi-checkpoint command validation, Rule of Two
- **NeMo Guardrails (NVIDIA)**: Programmable guardrails, policy-driven AI behavior
- **NemoClaw**: Privacy-first PII scanning, auto-routing to local models
- **Claude Code Channels**: Unified channel interface, push event model, permission relay
- **Google A2UI**: Structured agent-to-user responses, native widget rendering
- **Fireflies.ai**: Meeting transcription, action item extraction, webhook integration
- **CASL**: Isomorphic attribute-based access control for JS/TS

---

## 50. Conversations modul
> **Status: [DONE]** — Implemented in src/modules/conversations/

Kozponti beszelgetes modul, amely a korabbi `chat` modult valtja le. Kezeli a user-agent, agent-agent es team beszelgeteseket. Fullscreen megjelenit, atmeretezheto split panel, tag/activity/chatter integracioval.

### Funkciok
- Beszelgetes CRUD (create, list, get, archive)
- Uzenet kezeles (text, multimodal, streaming)
- Routing tier tamogatas (normal, complex)
- Conversation-board szinkronizalas

---

## 51. Knowledge modul
> **Status: [DONE]** — Implemented in src/modules/knowledge/

Wiki-szeru tudastart es dokumentum-szerkeszto. Plate editor 17 pluginnel, kategoriak, cimkek, kereshetoseg.

### Funkciok
- Wiki oldalak CRUD, hierarchikus kategoriak
- Plate (rich text) editor frontend integracio
- Kereshetoseg a Search modullal
- Frontend oldal (knowledge page)

---

## 52. Activity modul
> **Status: [DONE]** — Implemented in src/modules/activity/

Altalanos tevekenysegtipus-rendszer, amelyet tobb modul hasznal (board, conversations, documents). Strukturalt tipusok (email, call, todo, note, stb.) es allapotkovetes.

---

## 53. Chatter modul
> **Status: [DONE]** — Implemented in src/modules/chatter/

Odoo-stilusu chatter komponens: megjegyzesek, naplouzenet, uzenetszal. Barmely entitashoz (task, document, conversation) csatolhato.

---

## 54. Tools modul
> **Status: [DONE]** — Implemented in src/modules/tools/

Agent eszkoztar: regisztracios rendszer, eszkoz-definiciok (JSON schema), eszkoz-vegrehajtasi motor. Az agent modul ezen keresztul hivja meg a rendelkezesre allo eszkozoket.

---

## 55. Skill Evolution modul
> **Status: [DONE]** — Implemented in src/modules/skill-evolution/

Skillok teljesitmenykovehtese es automatikus fejlesztese. Gyujti a skill-hasznalati statisztikat, sikerességi aranyokat, es javaslatokat tesz a skill promptok finomhangolasara.

---

## 56. Hand Hub modul
> **Status: [DONE]** — Implemented in src/modules/hand-hub/

EYAS Hand companion alkalmazasok kozponti kezelese. WebSocket (WSS) kapcsolat tavoli gepekhez, auth hardening, node registry. Az EYAS Hand egy kulon repo (eyas-hand), cross-platform companion app amely remote machine hozzaferst biztosit.
