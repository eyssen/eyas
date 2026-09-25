# eYssen EYAS 1.0 — Modularis Architektura Refaktor

> **Az EYAS egy modularis AI platform, amely autonom agenseket, team-orkesztraciot, computer use-t es multi-channel kommunikaciot egyesit egyetlen rendszerben — self-hosted vagy online, barmilyen AI motorral, a te szabalyaiddal.**

Az EYAS egy szemelyes AI operacios rendszer, amely barhol fut — a sajat laptopodtol a felhoig, barmilyen operacios rendszeren. Barmely AI motort hasznalja: cloud API-kat, elofizeteses szolgaltatasokat vagy akar lokalis modelleket. Teljesen modularis: minden funkcio onallo, cserelheto modul, amelyeket igeny szerint kapcsolhatsz ki-be. Agent team-eket allit ossze es orkesztral parhuzamosan, vezerli a bongeszot es az asztalt, 5 retegu memoriaval es ontanulo rendszerrel folyamatosan fejleszti onmagat. Proaktivan figyeli a feladataidat, javaslatokat tesz, es onalloan cselekszik amikor kell. Nem egy chatbot — egy valodi asszisztens, aki tenyleg mindenhez ert: kutatas, kodolas, dokumentacio, kommunikacio, utemezes, dontestamogatas. Az adat es az iranyitas mindig a tied marad.

---

> **Ez a dokumentum egy teljes implementacios utmutato.** A jelenlegi monolitikus Eyas projektet (~16,000 LOC) alakitjuk at modularis, platformfuggetlen, bovitheto rendszerre.
> A munkat fazisokra bontva, minden fazist tesztelhetoen, mukodo allapotban kell tartani.
> **Platformfuggetlen:** macOS, Linux, Windows (WSL2), Docker, Kubernetes.

---

## Implementation status

Utolso frissites: 2026-09-24 (model & memory sovereignty program); a fazis-
es a roadmap-tabla allapota 2026-04-17-i. Reszletek a `CHANGELOG.md`-ben es a
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
| Model & memory sovereignty (W0–W3) | ✅ done, unreleased | Every provider runs isolated and reads/writes memory only through EYAS; one binding, stream contract, effort resolver, recall delivery and tool scope for every model. §8, §13, §14, §40, §41, §46; plan `docs/superpowers/plans/2026-09-22-model-memory-sovereignty-plan.md`; `CHANGELOG.md` [Unreleased]. Open: Kimi Code CLI not yet proven on a host; paid real-login canaries not yet run |

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

### Current health (2026-04-17)

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
57. [Design modul](#57-design-modul)
58. [Media modul](#58-media-modul)
59. [Studio modul](#59-studio-modul)
60. [Browser Use extra modul (Python CLI + agent-browser)](#60-browser-use-extra-modul-python-cli--agent-browser)

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
| @anthropic-ai/claude-agent-sdk | ~200KB | Claude Code CLI provider — kliens, 0.2.89-re pinnelve; a futtatott CLI a telepitett `claude` (§8 Claude Code runtime), a csomagolt `cli.js` csak vegso tartalek |
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
|   |   |   |-- index.ts                  # Modul: service, policy store, egress filter install
|   |   |   |-- types.ts                  # PiiScanner, PiiMatch, BUILTIN_PII_TYPES
|   |   |   |-- scanner-chain.ts          # Determinisztikus, sorhatarolt scanner lanc
|   |   |   |-- scanners/
|   |   |   |   |-- regex-scanner.ts      # Beepitett tipusok (magyar + nemzetkozi PII)
|   |   |   |   |-- validators.ts         # Tiszta checksumok + alak-predikatumok
|   |   |   |   |-- lines.ts              # splitLines (sorhatarolas)
|   |   |   |   +-- custom-scanner.ts     # Felhasznaloi mintak (ReDoS-vedett)
|   |   |   |-- policy.ts                 # PrivacyPolicySchema v2 (off/warn/mask/block)
|   |   |   |-- policy-store.ts           # privacy_policy tabla + YAML seed hot-reload
|   |   |   |-- service.ts                # PrivacyService (ctx.privacy): redact, redactToolOutput, maskAtRest, checkInbound, stats
|   |   |   |-- egress-filter.ts          # Gateway egress slot filter (celonkenti maszkolas)
|   |   |   |-- egress-audit.ts           # Aggregalt privacy.egress audit (D7)
|   |   |   |-- errors.ts                 # privacy_blocked tipusos elutasitas (D6)
|   |   |   |-- notice.ts                 # Lokalizalt csatorna-ertesites (D6)
|   |   |   |-- locales/                  # en/hu/de/es/fr/tlh ertesites-szovegek (D6)
|   |   |   +-- routes.ts                 # /api/v1/privacy/policy, /scan, /stats
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

Implementacio: `src/cli/commands/doctor.ts`. Az alabbi sorok kapcsolodnak a CLI futtatokornyezethez, a vault helyehez, az import rootokhoz es a memoria-beagyazohoz:

- **Claude Code runtime** (`checkClaudeRuntime`) — ugyanaz a feloldo, amit a provider hasznal: forras (`EYAS_CLAUDE_CODE_BIN` / `claude on PATH` / `SDK-bundled`), ut es verzio, SDK/CLI verzio-elteres, signed in igen/nem (identitas-mezok nelkul). Ervenytelen override = fail; az SDK-bundled vegso tartalek, a verzio-elteres es a kijelentkezett runtime = warn; az override altal eltakart host `claude` = info.
- **Vault** (`checkVaultLocation`) — a `<data dir>/vault` utvonal (ok); warn, ha a regi `<home>/data/vault` jegyzetei a kovetkezo indulaskor atmasolodnak (pending), vagy ha a regi mappa mar nem hasznalt, mert mindketto tartalmaz jegyzetet (diverged, orvossaggal). Csak olvas, soha nem masol.
- **Import roots** (A12) — a `selectImportRoots` (§15) iteletet mutatja: ok, ha nincs beallitva vagy minden root kozonseges mappa; warn a beallitas es a mappa nevevel, ha egy root idegen memoria-tar vagy CLI home belsejeben van vagy azt tartalmazza.
- **Memory embedder** (J3) — ok: `multilingual-e5-small, local (weights in <folder>)`, ha a `@huggingface/transformers` telepitve van es a sulyok a `data/models`-ban vannak; warn: a `stem5-fnv-384` hash fallback (a csomag hianyzik; orvossag: `bun add @huggingface/transformers`), vagy a csomag megvan, de a sulyok meg nincsenek letoltve (a kovetkezo indulas tolti le, ~130 MB).
- **CLI isolation** (`checkCliIsolation`, A14) — one line per CLI provider: 'CLI isolation (Claude Code)', '(Grok CLI)', '(Kimi Code CLI)'. It shows the executable from the cli-runtime resolver (source `EYAS_*_BIN` / `<cli> on PATH` / `SDK-bundled`, path, `--version`) and runs `isolationDrift()` against `CLI_VERIFIED_VERSIONS` (§8, Isolation release gate): match = ok ('isolation proven on this version (<date>)'); drift, unknown version or never proven (Kimi today) = warn, with the note that every session is still checked at start. Not installed = ok; an invalid override = fail with the remedy. For grok-cli and kimi-cli it also checks `<cliHomesDir>/<id>`: missing = ok (the first run creates it); a symlink or non-directory = fail; `mode & 077` = warn (`chmod 700`); managed files changed since EYAS wrote them (`readBackManagedFiles` for Grok, `evaluateKimiHome` for Kimi) = warn.
- **CLI sandbox** (`checkCliSandbox`, B5) — the kernel file sandbox of every installed CLI provider under `security.cliSandbox`: active, unavailable (reason + remedy: install bubblewrap / socat, allow unprivileged user namespaces) or not supported (Kimi). A missing sandbox is a warning.

Doctor is read-only: the only programs it starts are `<cli> --version` and `claude auth status`. Any `fail` line sets exit status 1; warnings alone do not.

---

## 7. Modul rendszer
> **Status: [DONE]** — Implemented in src/core/module-loader/ — manifest, lifecycle, health

### 7.1. Modul kategoriak

| Tipus | Ki/be kapcsolhato | Leiras |
|-------|-------------------|--------|
| core/base | NEM | Mindig fut, nem kapcsolhato ki. Az EYAS alapja: bootstrap, config, db, bus, http, logger, i18n, locking |
| core | IGEN | Alap modulok, az eYssen fejleszti, de ki/be kapcsolhatok: model, board, memory, search, scheduler, chat, audit, agent, skills, self-learning, communication, privacy, security-gate, documents, notifications, media, studio |
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

The routing budget's spend source is `readSpendTotals(db)` in
`model/routing/spending.ts`: the sum of `ai_traces.cost_usd` per day, week and
month. It includes background calls (§8 auxiliary service) and returns zeros
when `ai_traces` is absent.

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

Claude Code runs under one fixed isolation contract, with no opt-out.
`buildClaudeIsolationOptions({cwd, executable})` in
`src/modules/model/submodules/claude-code/isolation-options.ts` is the only
options builder. Chat, agent, background and isolated queries use it; `auth
status` uses its env (`buildClaudeIsolationEnv`); the discovery probe adds only
`tools: []`. It returns: `cwd` (absolute, from `resolveCliCwd`, never
`process.cwd()`); `pathToClaudeCodeExecutable` (the resolved runtime);
`persistSession: false`; `settingSources: []` (stated explicitly, because the
CLI reads an absent flag as 'load everything'); `strictMcpConfig: true`;
`enableFileCheckpointing: false`; and `env` = the claude-code allowlist
(`buildCliEnv`) plus `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`,
`CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`, `DISABLE_AUTOUPDATER=1`,
`CLAUDE_AGENT_SDK_CLIENT_APP=eyas` and `CLAUDE_CODE_TMPDIR` = the query's own
temp folder (required input `tmpDir`). That folder comes from
`cli-runtime/workspaces.ts` `cliQueryTmp()`: `<workspaces>/_runs/clitmp-<id>`,
so it is its own workspace unit; the provider appends it to the turn's roots
(memory-path hook, canUseTool, kernel sandbox allowWrite / deny-list keeps),
creates it right before `query()` and removes it in the stream's `finally`;
the discovery probe does the same, and `sweepRunScratch` removes `clitmp-*`
folders older than the current process. Without it Claude Code 2.1.281 keeps
`<slug of cwd>/<session>/tasks` (background command output) under
`/tmp/claude-<uid>` and never removes it; the live lane asserts nothing is
left there or in `_runs`. `auth status` gets no temp folder (no session). The host login is shared, while host
settings.json, CLAUDE.md, skills, filesystem/claude.ai MCP and auto-memory are
not. The CLI's enterprise-managed policy tier cannot be suppressed client-side.
The retired `loadClaudeMd` provider setting is stripped from
`provider_config.settings` on start (`stripRetiredClaudeSettings`). Host
CLAUDE.md/skills reach EYAS only through the one-way Data port import.

Grok CLI and Kimi Code CLI run in EYAS-owned homes under their own launch
profiles and are verified fail-closed before every turn (see the Grok / Kimi
CLI isolation contract and the ACP fail-closed verification below).

**One provider display source (G13).** `src/modules/model/provider-display.ts`
holds the product names (`PROVIDER_DISPLAY_NAMES`, `providerDisplayName`) and
the provider kind (`PROVIDER_KIND` / `providerKind(id)`): `cli` (claude-code,
grok-cli, kimi-cli), `local` (ollama, lmstudio and the openai-compat catalog
entries marked local, e.g. vLLM) or `api` (every hosted API and any unknown
id). Every row of `GET /api/v1/model/providers` and the
`GET /api/v1/model/providers/:id` detail serve `name` and `kind`. The web reads
them only through `lib/provider-display.ts` (§29); no page keeps its own name
map or CLI-id set.

**OpenAI data retention.** The native OpenAI provider (providerId `openai`, no
custom baseURL) sends `store: false` on every chat.completions request
(complete and stream), so stored completions are never enabled by an account or
project default. Providers built on the shared OpenAI provider with their own
baseURL (openai-compat catalogue, openrouter, kimi, lmstudio) never send the
key. `AIProvider` (`src/modules/model/types.ts`) is the only provider protocol;
the provider submodules keep only pure wire helpers in `adapter.ts` (plus
`createOllamaAdapter`, used by `ollama/provider.ts`), and
`tests/contracts/model-provider-layer.contract.test.ts` enforces this.

#### Continuity

EYAS replay is the only continuity. Every provider call carries the full
conversation from EYAS's store in `ModelRequest.messages`; there is no provider
session id on `ModelRequest`, `ModelResponse` or `ProviderRunError`.

- Claude Code queries run with `persistSession: false` and never set `resume`
  (no `getSessionInfo` lookup). The option is owned by
  `buildClaudeIsolationOptions()`.
- The Grok/Kimi ACP client (`grok-cli/acp-client.ts`) always sends
  `session/new` and never `session/load`.
- CLI providers always prepend a `<conversation-history>` block
  (`buildPromptWithHistory` / `buildPrompt`; for ACP, `acp-prompt.ts`
  `buildAcpPrompt`, see below).
- The `claude_code_sessions` table was removed (dropped on boot).
  `conversations.sdk_session_id` is a legacy inert column: fresh schemas no
  longer create it, `clearLegacyProviderSessionIds` sets it to NULL at boot, and
  it is in neither the Drizzle schema nor `UPDATE_FIELD_MAP`.

**Raw model endpoints.** `POST /api/v1/model/complete|stream` (`use Model`) are
validated by `RawModelRequestSchema` in `src/modules/model/routes.ts`: an
allowlist of `provider`, `model`, `messages` (`user`/`assistant`; string or
text/image blocks), `system`, `maxTokens`, `temperature` and `stopSequences`.
Unknown keys are stripped, so the call is classified autonomous. It also
accepts an optional `effort` (a ladder rung or `auto`), forwarded as a
request-level intent; the response and the stream's `done` event carry
`effortOutcome` (requested vs effective, source `request`).

#### CLI runtime seam

Every CLI provider (Claude Code, Grok, Kimi, OpenCode) spawns through
`src/modules/model/cli-runtime/`:

1. `env.ts` — `buildCliEnv(profile, {home, extra})` builds the child environment
   from an allowlist.
   - Base: PATH, LANG/LANGUAGE, LC_*, TZ, TMPDIR, TERM, USER, LOGNAME, SHELL,
     http(s)/no/all_proxy, SSL_CERT_FILE/DIR, NODE_EXTRA_CA_CERTS, and the
     Windows system variables.
   - The claude-code profile adds the host HOME and the
     Anthropic/OAuth/Bedrock/Vertex auth variables.
   - Everything else is dropped; `extra` is the only way a profile adds
     variables. `GIT_CEILING_DIRECTORIES` is set to the workspaces root.
2. `homes.ts` — EYAS-owned CLI homes at `<dataDir>/cli-homes/<id>` (0700), with
   content-hash-idempotent managed files and a session-store purge/sweep
   confined to the homes.
3. `workspaces.ts` — `resolveCliCwd(request)` is the only CLI cwd resolver: the
   first stored folder that passes validation (the same
   `validateWorkingDirectories` as a folder save — home, providerHome, vault,
   eyasData, sensitive, containsEyasData, containsProviderHome, containsVault,
   notAbsolute, notFound, notDirectory — judged by the installed path policy;
   a refused folder is skipped with a warning), then the
   conversation workspace,
   then `<workspaces>/_runs/<runId>` scratch. It never uses `process.cwd()`, the
   install root or the data dir. Run scratch is swept after 7 days by the model
   module. The agent runner screens a run's stored folders with the same
   validation (`tools/working-directories.ts` `screenToolWorkspaceFields`): a
   folder refused by a protection code (home, providerHome, vault, eyasData,
   sensitive, contains*) is left out of the tool context, the gate folders and
   the CLI metadata, and the run yields the notice `folderRefused {path,
   reason}`. Missing folders are kept (the file tools report them; a CLI cwd
   skips them).
4. `isolation.ts` — the per-provider `IsolationStatus` {verified | violation |
   unverified | auth-required, checks, runtime, checkedAt}, default unverified.
   `CliIsolationError` is a `CodedModelError` of kind `isolation` (terminal,
   never retried or failed over; code `cliIsolation`). Plus a Verify-now
   registry: `registerIsolationVerifier(id, fn|null)`,
   `canVerifyIsolation(id)`, `verifyIsolationNow(id)`. `verifyIsolationNow`
   runs the verifier (concurrent calls share one run) and resolves to the
   status it recorded, or returns null when none is registered. Only
   providers that can check themselves without a turn register one: the Grok
   and Kimi manifests register the load sequence (`verifyAcpIsolationAtLoad`,
   then zero-cost `session/new` discovery) and clear it on every reload.
   Claude Code registers none, because its tripwire reads the `system/init`
   of a real turn.
5. `executables.ts` — one policy row per provider. Source order: override env
   (absolute executable, Zod-checked; invalid fails closed with no fallback) →
   host PATH → sdk-bundled last resort (doctor warning).
   `findShadowedHostCli(resolution)`: for an override source, the PATH binary
   the override hides (another file); null otherwise. It is shared by
   `getClaudeRuntimeInfo` and the panel view (item 8).
6. `sign-in.ts` — sign-in into the EYAS-owned Grok/Kimi homes (`ctx.cliSignIn`,
   created in the model module's `onRegister`, disposed in `onStop`).
   - Device login: runs the CLI's own login through the provider's launch
     profile (grok `login --device-auth`, kimi `login --json`; env = profile
     env + `BROWSER=true`, stored API key removed), cwd = the EYAS home. Output
     from both streams is ANSI-stripped and parsed as JSON events or text. Only
     https links are accepted, the newest link/code wins, and the raw text is
     shown after a 5 s parse miss. States: pending | succeeded | failed |
     expired (15 min) | cancelled; one sign-in in flight per provider.
   - Signed-in check: the credential file exists (lstat only, never read; no
     symlinks): `.grok/auth.json`, `.kimi/credentials/kimi-code.json`.
   - Grok API key: secret `grok-cli-api-key` (system scope), cached in memory
     and injected as `XAI_API_KEY` only through the profile's `extraEnv`.
   - Sign-out: `grok logout` through the profile, then `homes.removeHomeFile`
     (unlinks links, refuses symlinked folders). Kimi deletes its credential
     directly (`kimi logout` also clears the OS keyring). The stored key is
     deleted.
   - Signed out: the reauth healer's `signInRequired` hook reports health
     auth_error with code `cliSignIn`, the isolation status becomes
     'auth-required' (a violation, or unverified-with-checks, is kept; a
     sign-in resets to unverified for the next acp-verify preflight), and the
     Grok/Kimi providers throw `CodedModelError('auth', 'cliSignIn')` before
     spawning. `classifyAuthError` counts coded auth errors as auth.
   - Routes: GET/POST/DELETE `/api/v1/model/providers/:id/sign-in` (Zod body
     `{method:'device'}` | `{method:'apiKey', apiKey}`; CASL read/manage Model).
7. `verified-versions.ts` (A14) — `CLI_VERIFIED_VERSIONS` {version,
   verifiedAt, paidCanary} per `IsolationCliId`: claude-code 2.1.281, grok-cli
   1.0.41 (both 2026-09-24, free cases only), kimi-cli null (never proven on a
   host). `isolationDrift(id, installed)` = match | drift | never-verified |
   unknown-version. It is the release gate's memory: updated only after the
   live lane passed on that version, and the lane fails until the record names
   the binary it ran. `eyas doctor` reads it (§6.8); the runtime checks
   (preflight, init tripwire) never depend on it.
8. `model/cli-isolation-view.ts` (K6) — `describeCliIsolation(id)` for an
   `IsolationCliId`. It returns runtime {available, path, version, source,
   expectedVersion, skew} | {available:false, error: override-invalid |
   not-found | no-policy}, hostCli (`findShadowedHostCli`), signedIn (Claude
   Code via `auth status` of the resolved binary, Grok/Kimi via
   `ctx.cliSignIn`), the `IsolationStatus`, proof = `CLI_VERIFIED_VERSIONS` +
   `isolationDrift`, and canVerify. Routes: `GET
   /api/v1/model/providers/:id/isolation` (CASL read Model; 404 for a
   non-isolation provider, 401 without a session) and `POST
   …/isolation/verify` (CASL manage Model; 409 `verifyUnavailable` when no
   verifier is registered — Claude Code, or a provider that is not loaded).
   This is the only runtime/isolation endpoint the web uses: `pages/providers/
   provider-cli-runtime.tsx` renders the Runtime line, the Isolation block and
   Verify now; `provider-isolation-labels.ts` is the pure id → key mapper (check
   ids = `ACP_ISOLATION_CHECKS` ∪ the Claude init tripwire ids). The panel's
   former host-login hints (`grokAcpHint`, `kimiAcpHint`,
   `cliAuthDescPre.grok/.kimi`) are removed.

`InstancePaths` gains `workspacesDir` and `cliHomesDir` (and `vaultDir`, see
§13). `workspacesDir` = `EYAS_WORKSPACES_DIR`, else `<dataDir>/workspaces` when
no git work tree encloses it, else
`<user app-data>/eyas/<homeName>-<hash(dataDir)>/workspaces` — a CLI started
inside a git work tree adopts that repository's instructions, rules and memory
scope. The conversations module migrates legacy `<dataDir>/workspaces/<id>`
folders once (idempotent; only when the migrated database lives in the instance
data dir) and assigns every conversation without Folders its own workspace. The
DR backup excludes `data/cli-homes/*/sessions`.

#### Claude Code runtime

One binary per install, resolved by `src/modules/model/cli-runtime/executables.ts`
(claude-code row): `EYAS_CLAUDE_CODE_BIN` (Zod: absolute, existing, executable;
set but invalid fails closed, no fallback) → `claude` on PATH → the
`@anthropic-ai/claude-agent-sdk` bundled `cli.js` as a last resort (doctor
warning). The SDK client stays pinned at 0.2.89; its `package.json`
`claudeCodeVersion` is the expected CLI version, and a different
`claude --version` is reported as version skew (doctor warning).

The same resolved path is used for availability/sign-in
(`<bin> auth status --json`: zero-cost, no session, Zod-parsed tolerantly,
identity fields dropped), fresh-install onboarding and every `query()` via an
explicit `pathToClaudeCodeExecutable` — never the SDK default lookup, which in
the bundled dist would point at `dist/cli.js`. The provider registers only when
the runtime is signed in.

There is no paid model probe: the `claude -p` probe and its boot trigger were
removed. The model list is discovered prompt-free from the runtime (F5, below);
the static alias table (Fable, Opus, Sonnet, Haiku) is only the seed. Thinking
is never forced `disabled` and no fixed `budgetTokens` is sent. `eyas doctor`
reports the runtime on its 'Claude Code runtime' line (§6.8).

**Discovery (F5).**
- `claude-code/discovery.ts` `probeClaudeRuntime()` runs one `query()` on the
  resolved runtime (the same binary as auth status and every turn), with
  `buildClaudeIsolationOptions` + `tools: []` and cwd = the `model-probe` run
  scratch folder.
- The prompt is a streaming-input iterable that never yields. The CLI answers
  the SDK `initialize` control request and the query is closed before any user
  message, so no model request is sent.
- The model list is read untyped and Zod-parsed tolerantly: `supportedModels()`,
  falling back to `init.models`. Fields read: value, resolvedModel, displayName,
  supportsEffort, supportedEffortLevels, supportsAdaptiveThinking, disabled.
  Account fields are never read.
- Rows are `claude-code-<slug(value)>`, including `claude-code-default`.
  Metadata: alias = value, realModelId = resolvedModel, cliVersion, and
  reasoning = DiscoveredReasoning {source:'sdk', param:'effort'|'none', levels,
  adaptiveThinking, runtime}.
- Discovery runs in the background on every provider load (manifest) and on
  Refresh models (`fetchModels`). Results are persisted by
  `reconcileDiscoveredModels`, and the registry is invalidated. A failure keeps
  the stored rows.
- Overlay rows (shared with the anthropic provider) supply what the runtime does
  not report: default level and can-disable.

**Effort wire (`claude-code/reasoning.ts`).**
- auto → nothing.
- none → `thinking:{type:'disabled'}`, only when capability.canDisable.
- a rung → `Options.effort` (the pinned SDK 0.2.89 forwards it verbatim as
  `--effort`), defensively clamped to the levels the running binary reported.
  No level is sent without a report, or when the report came from another CLI
  version.
- adaptive thinking only when the runtime reported it for the model.
- summarized display via `extraArgs {'thinking-display':'summarized'}`, only to
  runtimes ≥ 2.1.280 (`THINKING_DISPLAY_MIN_VERSION`, verified on the 2.1.280
  option table, fixture `tests/fixtures/cli/claude-code/2.1.280/
  thinking-display.json`; older ones, including the SDK-bundled 2.1.89, abort
  on unknown flags, and the versions in between are unverified). Discovery
  records `thinkingDisplay` from the version (`runtimeHasThinkingDisplay`);
  false makes the registry report those models' reasoning as hidden (E1,
  `applyRuntimeDisplay`). The live lane proves the flag becomes
  `thinking.display: 'summarized'` on the model request.

**Readback.** A Stop matcher and a PreToolUse matcher in `mergeHooks`'
`readback` slot (after the sovereignty slot) read the untyped hook-input
`effort.level`, which the runtime reports after its own silent downgrade.
`readbackOutcome()` turns the last reading into `response.effortOutcome`
(confirmed); no reading means no claim.

**Identity.** `ModelResponse.model` = request.model or `claude-code-default`.
`resolvedModelId` = the main-thread model (init/message_start), else the
busiest `result.modelUsage` key.

**Images (H7).** `buildPromptWithHistory` replays EYAS history as SDK content
blocks when any turn holds an image (earlier-turn images kept in place inside
`<conversation-history>`), and as one plain string otherwise.

The isolated options are complemented by the memory-policy PreToolUse hook
(below), so the reads Claude Code auto-allows inside its folders are covered
too. The double evaluation (hook, then `canUseTool`) is intentional and cheap:
the hook is deterministic and never calls the judge.

**One specialist mechanism (H8).** The Claude Code provider passes an explicit
`tools` list on every non-isolated query — the built-ins of the native
capabilities the turn's tool scope grants (`claudeCodeBuiltins`, K3, §14 Tool
scope; the rest go to `disallowedTools`; this replaces the old
`SDK_BUILTIN_TOOLS` constant), never the SDK default set — so the CLI's
native subagent spawner ('Agent', alias 'Task') is never offered and no
`options.agents` roster is built. `ClaudeCodeGovernance` carries no agent
registry. Isolated queries keep `tools: []`. Specialists on every provider run
through the EYAS engine (`run_specialist` → delegation service → child
conversation + supervised `agent_sessions` row), and the Deep directive
(`conversations/orchestration-directive.ts`, `buildOrchestrationDirective(mode)`)
is provider-neutral. Claude Code installs no orchestration hooks: the agent
runner emits the run tree for every provider (§14, Run tree). The
security-gate default green tier no longer lists 'Task'.

#### Claude Code isolation tripwire and hook composition

- **Init tripwire (`checkClaudeInit`).** The CLI's `system/init` message is
  Zod-parsed tolerantly (a missing or reshaped field fails its check) and must
  report four things: `mcp_servers` ⊆ the servers EYAS passed (`eyas`, or none
  on an isolated call); `plugins` none but `CLAUDE_INERT_BUILTIN_PLUGINS`
  (`agents-md`, `telemetry`), each accepted only as `<name>@builtin`;
  `permissionMode` 'default'; and `cwd` equal to the resolved cwd, compared
  realpathed. Claude Code 2.1.281 compiles those two plugins in. On that
  version `agents-md` loads AGENTS.md only through the instruction-file channel
  that `CLAUDE_CODE_DISABLE_CLAUDE_MDS` switches off, and the release gate
  (below) proves that no root or nested AGENTS.md reaches the model. Any other
  plugin, including a new builtin, stays a violation until it is proven and
  listed. A violation, or an
  assistant/result/stream_event/user message before init ('initMissing'),
  aborts the query and throws `CliIsolationError` (kind `isolation`, code
  `cliIsolation`: terminal, no retry, no failover), with no text yielded.
  `setIsolationStatus('claude-code', …)` records 'verified' with the
  CLI-reported `claude_code_version`, or 'violation' with the failed checks.
- **Hooks (`claude-code/hooks.ts`).** `mergeHooks({sovereignty, readback})`
  concatenates per-event matchers in that fixed order
  (`CLAUDE_HOOK_SLOT_ORDER = ['sovereignty','readback']`): the deterministic
  memory-policy hook first, then F5's effort readback. The orchestration
  observers and `includeHookEvents` are removed (G6). `applyHooks()` is the only
  writer of `queryOptions.hooks` and throws on a second write. No hook calls `validateToolCall`: `canUseTool` (the permission
  bridge) is the single LLM-judge path, which gives one judge call and one
  `security_events` row per tool call.
- **Memory-policy hook (`claude-code/memory-path-hook.ts`,
  `buildMemoryPathHook`).** Registered only through `mergeHooks`' `sovereignty`
  slot, so it is PreToolUse[0] on every query whose `tools` is not `[]`. It runs
  `gate.checkMemoryPath` (deterministic and audited, never `validateToolCall` or
  the judge, no streak); with no gate wired it runs the process
  `getPathPolicy()`. It answers `permissionDecision: 'deny'` with the shared
  `memoryPathReason` wording (`src/shared/memory-sovereignty/deny-reason.ts`),
  else `{continue:true}` and never 'allow'. Errors deny. The working
  directories it judges against come from `cli-runtime/workspaces.ts`
  `resolveCliRoots(request, cwd)` (valid stored folders + the resolved cwd,
  built server-side, never the CLI's reported cwd); the same list goes to the
  permission bridge ctx, the hook ctx and the in-process MCP bridge
  `ToolContext`. ACP's `resolveAcpRoots` is the same function.

#### Kernel file sandbox (B5)

`security.cliSandbox` (`auto` | `required`, no `off`) is enforced. The CLI
providers' own tools run inside the operating system's file sandbox; EYAS's
gate keeps checking every call it sees, and the sandbox also catches what a
shell reaches in ways the command text does not show.

- `src/modules/model/cli-runtime/sandbox/` holds one strategy per OS:
  `darwin-seatbelt.ts` (always available) and `linux-bubblewrap.ts` (`bwrap` on
  PATH, `socat` also for Claude Code, one cached `bwrap --ro-bind / / true`
  probe). `index.ts` is the facade: `detectKernelSandbox`, `getCliSandboxMode`
  (security.cliSandbox; the schema rejects any other value at load, so EYAS does not start — the 'required' fallback here is only a backstop), `planCliSandboxTurn`,
  `CliSandboxUnavailableError` (kind `isolation`, code `cliSandboxUnavailable`),
  and `exemptableDirs` / `sandboxDenyList` (keeps that hold a protected path are
  dropped). Detection is cached for 60 s. No platform code outside the
  strategies.
- Per turn **with tools**: sandbox available → sandboxed; `auto` without one →
  run, plus `notice cliSandboxUnavailable` once per conversation and CLI;
  `required` without one → refused before the spawn (terminal, never retried or
  failed over). Isolated (tool-less) turns need no sandbox and are never
  refused for lack of one.
- **Grok:** `grok-cli/sandbox-profile.ts` writes `[profiles.eyas-<sha256/16>]`
  into `$GROK_HOME/sandbox.toml` — extends 'workspace'; deny = the path
  policy's `kernelDenyList` with the whole CLI HOME and the grok binary folders
  kept usable; read_write = the turn's folders plus the CLI HOME, as written and
  through symlinks — atomically and synchronously, one profile per live session,
  pruned on release. The runner's `prepareSandbox` hook runs after the
  preflight; `GROK_SANDBOX`, `GROK_SANDBOX_AUTO_ALLOW_BASH=false` and the
  real-path `GROK_HOME` go on the spawn only. The acp-verify preflight cache
  keys GROK_HOME by entry names, ignoring `sandbox.toml`.
- **Claude Code:** `claude-code/sandbox-options.ts` sets the SDK `sandbox`
  option (flag settings): enabled; `failIfUnavailable` = required;
  `allowUnsandboxedCommands` = !required; `autoAllowBashIfSandboxed` false;
  filesystem `denyRead` = `denyWrite` = kernelDenyList; `allowWrite` = the
  turn's folders; `allowRead` = `~/.claude/shell-snapshots`,
  `~/.claude/session-env` and the binary folder. All paths are written `//abs`.
- **Unsandboxed-shell human gate.** `PermissionBridgeDeps.cliSandboxMode`
  ('auto' when a sandbox is applied). A Bash call with
  `dangerouslyDisableSandbox` → `validateToolCall` with `callCtx.requireHuman`.
  The security gate then runs only its deterministic checkpoint (a deny wins)
  and otherwise escalates (checkpoint deterministic, riskTier red, reason tagged
  `[unsandboxed-shell]`, `src/shared/cli-sandbox.ts`). No judge call, no streak
  change. A gate 'allow' is turned into an escalation in the bridge, so only a
  grant or an approval can run the call.
- **Kimi:** 'unsupported' (the CLI has none).
- **Surfaces:** `GET /api/v1/model/providers[/:id]` carry `fileSandbox
  {status: active|unavailable|unsupported, reason, mode}` for claude-code,
  grok-cli and kimi-cli; `eyas doctor` 'CLI sandbox' (a missing sandbox is a
  warning); the Security page's memory-policy card (§41).
- bubblewrap and socat are operator-installed; the Dockerfile is unchanged
  (bubblewrap is LGPL).
- **Limits:** on Linux, Grok's deny list covers files that exist when the
  session starts; a vault known only by its `.obsidian` marker is added once
  the policy has met a path inside it.

#### CLI turn watchdog (G8)

CLI turns (Claude Code, Grok, Kimi) are bounded by the turn watchdog
(`src/modules/model/cli-turn-watchdog.ts`), not by a whole-turn timer.

- One watchdog per stream, configured from `model.cli.{idleTimeoutMs,
  toolTimeoutMs}` (defaults 600000 / 1200000; positive integers, Zod) through a
  lazy getter each manifest passes.
- Every SDK message (Claude Code) or ACP stdout line (Grok/Kimi) calls
  `touch()`. Normalized `tool_use_start` / `tool_result` events move the
  watchdog between the idle budget and the tool budget.
- On expiry it aborts with `DOMException('…','TimeoutError')`, which
  `classifyModelError` maps to 'timeout' (retryable). The provider rethrows that
  reason instead of the SDK's or ACP's own abort text. Operator Stop
  (`request.signal`) stays 'aborted'.
- The CLI MCP bridge secret TTL (`BRIDGE_SECRET_TTL_MS`, 2 h) is sliding: each
  authenticated lookup refreshes it.

#### CLI isolation contract (A1 spike, 2026-09-22)

Source fixtures: `tests/fixtures/cli/<cli>/<version>/`, produced by
`scripts/cli-isolation-spike.ts` against a local fake model with dummy keys —
zero paid calls. The hostile temporary home is `tests/live/hostile-home.ts`.

| Switch | Observed effect | Verified on |
|---|---|---|
| Grok: EYAS-owned HOME + GROK_HOME with config.toml (permission_mode ask; `[permission]` ask Read/Edit/Grep/Bash/WebFetch/WebSearch, allow `MCPTool(eyas__*)`; memory, memory_v2, compat.*, telemetry, leader off) | Every native tool raises `session/request_permission`, including read_file, list_dir, grep, shell (even a read-only `ls`), write, spawn_subagent and search_tool. `use_tool` on `eyas__*` does not ask. No host rules, AGENTS, skills, hooks, MCP or memory load. The host HOME is untouched. | grok 1.0.40, 2026-09-22 |
| Grok: `$GROK_HOME/requirements.toml` (unsigned) | Honoured. `inspect` reports the always-approve lock as enforced. `enable_all_project_mcp_servers=false` + `[[allowed_mcp_servers]] server_name="eyas"` keeps the ACP-supplied eyas server and blocks every other one. | grok 1.0.40 |
| Grok: prompt text starting with `/always-approve on` | Runs locally (no model call, no session/update) and switches the session to always-approve even with the requirements lock. EYAS must never send ACP prompt text that begins with `/`. | grok 1.0.40 |
| Grok: folder trust, never granted | Project AGENTS.md/CLAUDE.md, `.grok/config.toml` MCP servers and permission rules, `.grok/hooks` and `.mcp.json` are not applied. `grok inspect` still lists the project MCP servers. `[folder_trust]` is not a valid config key; trust is on by default. | grok 1.0.40 |
| Grok: `session/new` | No `modes` field, so the permission mode is not observable at session start. `_meta.x.ai/memoryMode` is `legacy` when isolated and `v2` on the hostile host. | grok 1.0.40 |
| Grok: fs delegation | Only main-session read_file and write use `fs/read_text_file` and `fs/write_text_file` (after the permission). grep, list_dir, shell and subagent reads touch the disk directly. | grok 1.0.40 |
| Grok: `system_prompt.txt` | Holds the default prompt at `session/new`; the `systemPromptOverride` appears only by the first model request. EYAS therefore checks after the turn: acp-client `onSessionClosed` runs after the CLI exits and before the session-store purge, and `grok-cli/acp-system-prompt.ts` looks for a per-instance marker at the end of the override in `<GROK_HOME>/sessions/<cwd group>/<sessionId>/system_prompt.txt`. The file is found by scanning for the session id; the id is Zod-checked and symlinks are not followed. | grok 1.0.40 |
| Grok: `login --device-auth` (non-TTY) | Prints the link, the code and 'Waiting for authorization...' on STDERR with ANSI codes (stdout empty). There is no credential before confirmation. The credential is `$GROK_HOME/auth.json`, and grok prefers it over `XAI_API_KEY`. | grok 1.0.40 (prompt only; a confirmed sign-in is not yet part of the release gate) |
| Grok: EYAS refuses a `session/request_permission` (`reject_once`) | Ends the turn. The tool result is `User rejected the execution for tool <name>`, grok sends no further model request, and EYAS's refusal reason never reaches the model. The answer ends after the refused tool row. (Claude Code instead continues and receives the reason.) | grok 1.0.41 (B14) |
| Grok: `$GROK_HOME/managed_config.toml` | grok writes this vendor-managed cache during a session, empty for a normal account; `grok inspect` reports it as a config layer with role 'managed'. EYAS accepts it only while it holds no key or table (A6 preflight, below). | grok 1.0.41 (A14) |
| Grok: `GIT_CEILING_DIRECTORIES` | No effect on grok's git root discovery. | grok 1.0.40 |
| Claude Code: persistSession false, settingSources [], strictMcpConfig, enableFileCheckpointing false, CLAUDE_CODE_DISABLE_AUTO_MEMORY, CLAUDE_CODE_DISABLE_CLAUDE_MDS, DISABLE_AUTOUPDATER, allowlisted env (matches the recorded baseline's envKeys) | No transcript, todos, file history or plans. No host CLAUDE.md, skills, agents, hooks or MCP. Remaining host writes: `~/.claude.json` bookkeeping keys, `~/.claude/backups/.claude.json.backup.*`, an empty `~/.claude/sessions`, an empty `~/.claude/session-env/<id>`, an empty `~/.claude/shell-snapshots`. An init-only query sends no model request. | Claude Code 2.1.280 via Agent SDK 0.2.89, API-key auth, 2026-09-22; re-proved on 2.1.281 by the release gate (free cases, 2026-09-24; the real-login canary is pending) |
| Claude Code: keychain | The credential service name ignores HOME unless `CLAUDE_CONFIG_DIR` (or `CLAUDE_SECURESTORAGE_CONFIG_DIR`) is set. | Claude Code 2.1.280 |
| OpenCode: `XDG_{CONFIG,DATA,STATE,CACHE}_HOME` in the EYAS home + `OPENCODE_DISABLE_CLAUDE_CODE(_PROMPT,_SKILLS)`, `_EXTERNAL_SKILLS`, `_PROJECT_CONFIG`, `_AUTOUPDATE`, `_SHARE`, `_MODELS_FETCH`; `OPENCODE_PERMISSION` ask | No host OpenCode config, `~/.claude` or project instructions load. read, bash and out-of-workspace access raise `permission.asked`, answered via `POST /permission/{id}/reply`. Auth lives in `$XDG_DATA_HOME/opencode/auth.json`. An npm cache is still written under `$HOME/.npm`. `serve` is unauthenticated without `OPENCODE_SERVER_PASSWORD`. | OpenCode 1.18.29 |
| Kimi: `KIMI_SHARE_DIR` + HOME | Derived from the kimi-cli 1.52.0 source and unverified. `kimi acp` ignores options before `acp`. Project AGENTS.md is always loaded. Only write, replace, shell and background ask. | not run (binary absent) |
| Decision (Gate 0, 2026-09-22): project instruction files | Not auto-loaded on Claude Code (`settingSources []`) or Grok (folder never trusted); the model may read them with file tools. Open item for the owner: Kimi always auto-loads the conversation folder's AGENTS.md, so the rule cannot hold for Kimi without a code change or a disclosure. | — |

#### Grok / Kimi CLI isolation contract (A5)

- One launch profile per ACP provider, `src/modules/model/submodules/grok-cli/acp-profiles.ts`:
  `AcpCliProfile {providerId, home, homesDir, configDir, sessionStorePath, managedFiles, resolveExecutable(), buildArgs({model}), env(extra), ensureHome()}`.
  It is created pure. `runGrokAcpPrompt` requires a profile: it resolves the
  executable (cli-runtime `resolveCliExecutable`: `EYAS_GROK_BIN` /
  `EYAS_KIMI_BIN` → PATH, invalid override fails closed), runs `ensureHome()`
  (managed files through cli-runtime `writeManagedFiles`, symlink-safe), then
  spawns with `profile.env()` (cli-runtime `buildCliEnv` allowlist + HOME +
  switches + `extraEnv` + `extra`). Sign-in, discovery and the model probe use
  the same profile.
- Grok contract, verified on grok 1.0.40 by the A1 fixtures and re-proved on
  1.0.41 by the release gate (free cases, below).
  - argv: `agent --no-leader [--model X] stdio`.
  - env: `GROK_HOME=<home>/.grok`, `GROK_MEMORY=0`,
    `GROK_CLAUDE_{SKILLS,RULES,AGENTS,MCPS,HOOKS,SESSIONS}_ENABLED=false`,
    `GROK_CURSOR_{SKILLS,RULES,AGENTS,MCPS,HOOKS}_ENABLED=false`,
    `GROK_TELEMETRY_ENABLED=0`, `GROK_TELEMETRY_TRACE_UPLOAD=0`,
    `GROK_SESSION_SEARCH=0`, `GROK_REMEMBER_TOOL_APPROVALS=false`,
    `GROK_DISABLE_AUTOUPDATER=1`.
  - `config.toml`: [ui] permission_mode=ask, remember_tool_approvals=false;
    memory and memory_v2 off; storage.cleanup_ttl_days=1; [cli] auto_update,
    use_leader and session_registry false; features session_search and
    telemetry false; telemetry.trace_upload=false; compat.claude,
    compat.cursor and compat.codex all false; [permission]
    ask=[Read,Edit,Grep,Bash,WebFetch,WebSearch], allow=[MCPTool(eyas__*)].
  - `requirements.toml`: enable_all_project_mcp_servers=false,
    ui.disable_bypass_permissions_mode=true, pins for memory, memory_v2,
    trace_upload, use_leader and session_search,
    `[[allowed_mcp_servers]] server_name="eyas"`.
  - An empty `trusted_folders.toml`, rewritten every run.
  - Deliberately absent: [folder_trust] and session.save_on_end (unknown keys
    in 1.0.40), GROK_STORAGE_MODE (unverified), GIT_CEILING_DIRECTORIES as a
    protection (grok ignores it).
- Kimi contract (from the kimi-cli 1.52.0 source, unverified on a host).
  - argv exactly `['acp']`.
  - env `KIMI_SHARE_DIR=<home>/.kimi`, `KIMI_CLI_NO_AUTO_UPDATE=1`.
  - A text upsert of the top-level keys default_yolo, telemetry and
    merge_all_available_skills (all false) into `.kimi/config.toml`, validated
    with Bun.TOML when available.
  - An empty `.kimi/mcp.json`.
  - Residual: Kimi always loads AGENTS.md from the work dir up to the git root
    (no trust gate).
- Prompt channel: every session/prompt text block passes
  `neutralizeAcpCommandText`. A leading slash command, after whitespace or
  zero-width characters, is wrapped in `<message>…</message>`, because grok
  1.0.40 executes leading ACP slash commands locally, including
  `/always-approve on` under the requirements lock.
- Turn cap as data: the runner counts distinct toolCallIds from tool_call and
  request_permission. On call N+1 it sends `session/cancel`, answers pending
  and later permissions `cancelled`, refuses fs requests, waits up to 15 s for
  the cancelled stop, and returns `stopReason:'max_turns'` with the partial text
  and usage (`usage.reported:false` when none). `_meta.maxTurns` is not sent.
- Session store: `<home>/.grok/sessions` or `<home>/.kimi/sessions` is purged
  when the last run on it ends, after the child exits (SIGTERM, then SIGKILL
  after 3 s). The manifests start a boot plus hourly sweeper that skips busy
  stores.
- Remaining: Grok's shell runs with HOME = the EYAS Grok home, which holds the
  EYAS sign-in credential; shell commands always ask the EYAS gate.

#### ACP CLI isolation — fail-closed verification (Grok, Kimi) (A6)

`grok-cli/acp-verify.ts` implements three layers around every ACP session.
Each layer records its outcome in the cli-runtime `IsolationStatus` store, and
each failure raises `CliIsolationError` (ModelErrorKind 'isolation', never
retried or failed over).

1. **Preflight**, before the spawn, after `ensureHome`.
   - Grok: `grok inspect --json` in the turn cwd with the profile env, parsed
     by a tolerant Zod schema. A report missing a required section is
     'unverified' and refuses the turn. The preflight also reads back every
     managed file.
   - Grok violations: no enforced alwaysApprove=false lock; permission sources
     other than `$GROK_HOME/config.toml`; a config layer other than EYAS's
     config and requirements files; an MCP server without disabledReason;
     hooks, plugins, or language servers without disabledReason; instruction
     files, skills or agents outside the conversation roots (project-scope
     files inside the roots are allowed); an enabled compat cell; a project
     layer when projectTrusted.
   - Memory, leader and telemetry are proven by the config.toml read-back,
     because inspect does not report them.
   - Kimi: a read-back of default_yolo=false, merge_all_available_skills=false,
     no hooks and no extra_skill_dirs, an empty mcp.json, and no skills in the
     home. Kimi is marked 'verified' only by an on-host session/new.
   - Vendor-managed layer (A14): a config layer with role 'managed' whose path
     is `GROK_HOME/managed_config.toml` is accepted only while the file holds
     no key or table (`tomlHasNoSettings`). It is read through
     `readManagedFile`, so a symlink is refused. grok 1.0.41 writes this file
     during a session; before the rule, every turn after the first was refused.
   - Only passes are cached, for 10 min. The key is binary path/mtime/size +
     location (empty scratch folders share their parent's key) +
     managed-files hash + a stat fingerprint of the home + a content hash of
     `managed_config.toml` (`CONTENT_FINGERPRINT_PATHS`), so a same-bytes
     rewrite keeps a cached pass and any setting voids it at once.
2. **session/new check:** refuses a bypass, yolo or always-approve mode when a
   mode is reported (grok 1.0.40 reports none).
3. **Tripwire:** consumes `parseAcpSessionUpdate` events keyed on toolCallId. A
   governed call reaching in_progress/completed without an EYAS decision trips
   it; so does any `memory_*` tool. Governed calls are: ACP kinds
   read/edit/delete/move/search/execute/fetch, plus the grok tool names
   list_dir, spawn_subagent, search_tool, use_tool (except `eyas__*`), web_*,
   write/edit tools and monitor. Kimi's read kind is judged at completion and
   passes when served by the client fs.

`grok-cli/acp-governance.ts` owns permission answers and the client-fs jail:

- Permission answers pick allow_once or reject_once by kind only; anything
  else is cancelled.
- The jail is `tools/builtin/path-utils` `resolveToolPath` over roots = valid
  conversation folders + cwd (O_NOFOLLOW on open).
- After the jail comes the memory-path check (`gate.checkMemoryPath` when
  wired, else the path policy).
- Then one gate decision per operation, via coverage from the tool call's
  permission (rawInput paths and locations).

Grok/Kimi advertise `supportsIsolatedCompletion` through a getter on
`IsolationStatus === 'verified'`. Isolated requests run with no MCP bridge,
deny-all governance, a tool cap of 0 and the output cap (§8, Output cap of an
isolated completion). Manifests seed the status at load with a non-blocking
preflight in `<workspaces>/_runs/isolation-check`; the same load-time
verification is the provider panel's **Verify now** (K6, the cli-runtime
Verify-now registry).

**Native capability grants on ACP (K3).** `acp-governance.ts` refuses a
permission request that needs a native capability the turn's tool scope does
not grant (`nativeCapabilitiesFor(scope)`, §14 Tool scope) before the gate is
asked. The capability comes from the request's kind, else the tripwire's
record of the tool call, and from the tool's name (Grok's `_meta` `x.ai/tool`,
else the first `tool_call` title): execute/delete → shell, edit/move → write,
fetch → web, read/search → read. A kindless request (Kimi 1.52.0 sends none)
is refused while write or shell is withheld. A client-fs write needs write.

#### Isolation release gate (A14, B14)

One live lane, `tests/live/cli-isolation.live.test.ts`, built on
`tests/live/hostile-home.ts` (a throwaway HOME full of traps: allow-everything
host settings, hooks and MCP servers that leave a mark if they run, CLAUDE.md,
AGENTS.md, skills, an Obsidian-style vault, a project folder with its own
config) and `tests/live/live-lane.ts` (fake model, scripted tool sequences, env
patching). `bun run test:live-cli` (= `EYAS_LIVE_CLI_PROOF=1 bun vitest run
tests/live`) runs it; it is never part of the default vitest run. It drives the
real binaries through EYAS's own providers.

- **Free cases** (`EYAS_LIVE_CLI_PROOF=1`): a local fake Anthropic/xAI model on
  127.0.0.1 with dummy keys and a scripted tool sequence, so no tokens are
  spent. For Claude Code a keychain-redirect shim
  (`CLAUDE_SECURESTORAGE_CONFIG_DIR`) set as `EYAS_CLAUDE_CODE_BIN` execs the
  policy-resolved binary and logs every spawn.
- **Paid cases** (`EYAS_LIVE_CLI_PAID=1` in addition): real model turns on the
  operator's own sign-in, with owner approval per run.
- **Claude Code asserts:** auth status, the init-only query on
  `buildClaudeIsolationOptions` and discovery send no model request and load
  nothing from the host; full turns show the policy hook's deny, a
  Seatbelt/bubblewrap kernel deny of a read the hook cannot see, and a working
  workspace read; a folder holding only AGENTS.md files (root and nested) gets
  neither to the model; the init `claude_code_version` equals the resolver's
  version; host writes ⊆ `tests/live/claude-host-writes.allowlist.json`.
- **The host-write allowlist** is versioned: binaryVersion, verifiedAt, scope,
  claudeJsonKeys (start-up and bookkeeping keys of `~/.claude.json`) and
  entries {glob, rule, reason} with rules claude-json, claude-json-backup,
  lock, dir, empty-dir, bookkeeping-file, cache and credential. `lock` covers
  `~/.claude.json.lock`: an empty lock folder that `claude auth status` leaves
  behind and a later run that rewrites `~/.claude.json` clears as stale; its
  removal is allowed, every other removed host path fails. Content-bearing
  paths are always rejected (`projects/**`, `todos/`, `file-history/`,
  `plans/`, `history.jsonl`, files under `session-env/`), and so are canary and
  sentinel strings in any changed file except credentials, which are never
  read.
- **Grok asserts:** `grok inspect` is clean, discovery sends no model call, a
  full turn asks every `read_file` through EYAS with the fs jail, the system
  prompt arrives `meta-verified`, the MCP bridge works through the real auth
  stack, no session store is left and the host HOME is unchanged.
- **Memory-sovereignty matrix (B14)**, per CLI provider, through the real
  security-gate module (`securityGateModule.onRegister` on an in-memory DB,
  `security.foreignMemoryPaths` = a temp store with no `.obsidian` marker
  outside HOME; a precondition asserts that the unregistered policy allows
  it): (a) a native read of the store, (b) a shell `cat` of it, (c) a write into
  `<dataDir>/vault`, (d) a read of a workspace file. Asserted: exactly one
  `security_events` deny per refused call (checkpoint `deterministic`,
  `isMemoryPathReason`) with the reasons `Memory outside EYAS (protected path
  (security.foreignMemoryPaths)) …` for (a)/(b) and `EYAS data directory (vault)
  is read and written only by EYAS` for (c); no rate-limit deny; the tool rows
  of (a)–(c) settle `denied`; (d) succeeds after the three denies (no streak);
  the sentinel is in no model request body and no stream event; the store and
  the EYAS vault are unchanged. Channels proven: the Claude Code PreToolUse
  hook → `gate.checkMemoryPath` (one turn, four steps) and the Grok ACP
  `session/request_permission` → `validateToolCall` (one turn per step, because
  a refusal ends a Grok turn). Paid variants require (a) to be an audited deny,
  only memory-policy denies, the workspace marker in the reply and no sentinel
  anywhere.
- **Status:** free cases pass on Claude Code 2.1.281 and grok 1.0.41
  (2026-09-24), recorded in `verified-versions.ts`; the paid canaries have not
  run yet. Kimi Code CLI runs only when installed and has no matrix row: the
  binary is not on the proving host, and a free Kimi turn needs a model entry
  in the EYAS Kimi home's config.toml that is unverified.
- **When to re-run:** on every CLI version bump and on any change to how EYAS
  resolves or launches a binary. If Claude Code writes a content-bearing host
  file despite `persistSession:false`, the release is blocked until the owner
  decides on a `CLAUDE_CONFIG_DIR` redirect.

#### ACP system-prompt channel (I8)

Channels: `meta` (session/new `_meta.systemPromptOverride`), `prompt` (fenced
`<eyas-system-prompt>` as the first text block of session/prompt; runner
default), `meta+prompt` (both). Kimi: always `prompt`. Grok: per-process
verdict per binary (path, size, mtime). Unproven: `meta+prompt`. Marker found:
`meta`, checked every turn (`meta-verified`). Model answered without the
marker: `prompt` for the rest of the process, pino warn (that turn is `prompt`
or `meta-unverified`). No model output: no verdict.
`ModelResponse.systemPromptChannel: SystemPromptDelivery` = meta-verified |
meta-unverified | prompt. It is stored in `context_compositions.delivery_json`
(`systemPromptChannel`, I12, §46) and shown in the context inspector.

#### ACP prompt and images (H6)

The session/prompt is built by `grok-cli/acp-prompt.ts` `buildAcpPrompt(messages)`
as ACP content blocks (TextContent, ImageContent `{type:'image', mimeType, data}`).
It holds EYAS's full history in a `<conversation-history>` text frame with
earlier-turn images inline in turn order, then the last message's text and
images; a text-only conversation is a single text block. The runner reads
`initialize.agentCapabilities.promptCapabilities.image` (Zod, only explicit
true counts). Without it every image is replaced by
`helpers.imageOmittedText(mediaType)` before sending. The runner reports
`{image}` on every run via `onPromptCapabilities`; the grok-cli/kimi-cli
manifests persist it with `providerConfig.setImageSupport(providerId, supported)`
on `model_config.supports_images`, so the Vision flag reflects the installed
CLI. Every text block passes `neutralizeAcpCommandText`.

#### Grok CLI discovery and effort (F10)

Discovery runs through `runAcpProbe` in `grok-cli/acp-client.ts` on the A5
profile, with the A6 preflight and session/new check.

- The probe sends `initialize` and `session/new` (mcpServers []), then
  `session/set_config_option model=<id>` for each value of the `model` config
  option. It never sends session/prompt and refuses every client request.
- From each answer it reads `configOptions`: `reasoning_effort`, category
  `thought_level`, whose values are ladder rungs. The default level comes from
  the models-state `_meta` or from the fresh session's value for the default
  model.
- `grokModelsFromProbe` writes `model_config.metadata` `{realModelId,
  alias:'default' (default row), cliVersion, discoveredAt,
  reasoning:{source:'acp', param:'effort'|'none', levels, defaultLevel?, runtime}}`.
  A model without the option is `param 'none'`.
- The manifest rediscovers on every provider load (after the load-time
  isolation check, only when signed in), then calls
  `reconcileDiscoveredModels` and `reasoningRegistry.invalidate('grok-cli')`.

Per turn:

- The provider passes `sessionConfig {reasoning_effort: effortPlan.level}`;
  Auto sends none.
- The runner sets it after session/new and before session/prompt, with the
  value as a plain string (grok 1.0.41 rejects the documented `{value}` object).
- `GrokAcpRunResult.appliedConfig` and `resolvedModelId` are read back from
  session/new, the set answers and `config_option_update`. The provider turns
  them into `effortOutcome` via `readbackOutcome` and into `resolvedModelId`.
- An argv `--model` absent from the session's model option is refused with
  `CliModelIdError`, because grok silently substitutes its default.

**One parser.** `acp-events.ts` owns the ACP parsers: `parseAcpSessionNew`,
`parseAcpConfigOptions`, `parseAcpSessionModels`, and `config_option_update`
in the session/update union. acp-verify's `evaluateSessionNew` uses it.

#### Kimi Code CLI model selection (F11)

Kimi Code CLI is spawned as exactly `kimi acp`; it takes no `--model` /
`--thinking`. The model and thinking are selected in-session:

- `runGrokAcpPrompt`'s `sessionModel` option sends ACP `session/set_model` once,
  after the session/new isolation check and before any config option or prompt,
  and only when the chosen id differs from the current one.
- Kimi ids are `<model key>` (plain) and `<model key>,thinking` (the thinking
  variant). A refusal ends the turn with `CliModelIdError` ('does not offer
  it'); the switched id is the session's `resolvedModelId`.

Discovery (`fetchModels`) is `runAcpProbe` with enumerate 'none'; it reads
session/new's models state (no prompt, no model call), on every provider load
while signed in and on Refresh models.

- Rows: `kimi-cli-default` plus `kimi-cli-<key>`, with
  `metadata.realModelId` = key.
- `metadata.reasoning` (source 'acp'): toggle `['none','high']` when both
  variants are listed; toggle `['high']` with default 'high' when only the
  thinking variant is listed; param 'none' when only the plain variant is
  listed.
- There is no kimi-cli overlay row; without discovery the capability is
  'unknown', so effort resolves to Auto and nothing is sent (the provider panel
  says so).

Effort mapping: effortPlan 'none' → plain variant, any other level → thinking
variant, 'auto' → the session's current thinking state. The readback of the
variant that ran becomes a confirmed effortOutcome; `resolvedModelId` is the
key.

kimi-cli persists `set_model` into `<share>/config.toml`
(`default_model` / `default_thinking`), so `kimi-cli-default` runs the model
last selected. The Kimi preflight (`evaluateKimiHome`) therefore requires the
spawn env's share dir (`KIMI_SHARE_DIR`, else `HOME/.kimi`) to equal the
profile's configDir inside the EYAS CLI home; a mismatch is reported as the
tool-approval check, not as a separate ownership flag.

The retired seed ids (`kimi-cli-k3` / `-k2.7-code` / `-k2.6`) are repointed to
`kimi-cli-default` in `routing_tiers` and `provider_config` at submodule start
(`repointRetiredKimiCliModels`); new Kimi-only installs seed every tier with it,
the downgrade table has no Kimi Code CLI step, and discovered models are priced at
the default row's rate. Built from the kimi-cli 1.52.0 source; unverified on a
real binary.

#### OpenCode sidecar isolation (A10)

OpenCode (optional sidecar, module `opencode`). Home:
`<dataDir>/cli-homes/opencode` (cliHome). HOME = home;
`XDG_CONFIG_HOME=home/config`, `XDG_DATA_HOME=home/data` (auth.json, sessions),
`XDG_STATE_HOME=home/state`, `XDG_CACHE_HOME=home/cache`,
`npm_config_cache=home/cache/npm` (the 1.18.29 spike showed `~/.npm` writes
despite XDG). The env comes from `buildCliEnv('opencode')` (no host keys) plus
`OPENCODE_DISABLE_{CLAUDE_CODE, CLAUDE_CODE_PROMPT, CLAUDE_CODE_SKILLS, EXTERNAL_SKILLS, PROJECT_CONFIG, AUTOUPDATE, SHARE}=1`
and `OPENCODE_PERMISSION` = ask for
read/edit/glob/grep/list/bash/task/external_directory/webfetch/websearch/lsp/skill.
Managed files (always written): `config/opencode/opencode.json` (plugin list =
the EYAS memory plugin) and `config/opencode/eyas/eyas-memory.ts`. OpenCode
installs `@opencode-ai/plugin` into `config/opencode/node_modules`, and the
plugin's import resolves only below that folder; at the former
`plugins/eyas-memory.ts`, 1.18.29 skipped it silently (K4). `eyas/` is not
OpenCode's auto-loaded `plugin(s)/` folder, so the plugin loads exactly once.
`writeOpencodeManagedFiles` removes a leftover `plugins/eyas-memory.ts`.

`opencode serve` runs on 127.0.0.1 with a per-start `OPENCODE_SERVER_PASSWORD`
(Basic auth, user `opencode`), cwd = the workspaces root. Requests are routed
per task folder with `?directory=`. Permission path: developer-agent subscribes
to `/event` and handles `permission.asked` for its own session plus child
sessions (`session.created` parentID). Each request is mapped
(`opencode/permission-gate.ts`) to the canonical gate names (Read/Glob/Grep
green, Edit/WebFetch/WebSearch yellow, Bash red, Task, unknown →
`OpencodeUnmappedTool`), with worktree-relative patterns rebuilt into absolute
paths. Then `createPermissionBridge` (ctx.securityGate) makes one
`validateToolCall` and the reply is `POST /permission/{id}/reply` once|reject
(never always). No gate means reject. The session is deleted after capture
(`DELETE /session/{id}`). The TUI (`isolation.ts buildTuiCommand`) uses the
same home and isolated env but runs its own in-process server on a fresh
loopback port with a fresh `OPENCODE_SERVER_PASSWORD` — never the headless
server's, so a shell the TUI's model runs inherits nothing that opens EYAS
tasks' sessions (the runner hands its password to nobody). Its permission
prompts are answered by the human. Its folders pass the same K2 screening as
every CLI run (`path-guard.ts resolveTuiFolders` → `screenStoredWorkingDirectories`):
a refused stored folder or requested cwd is dropped, the TUI opens in the first
allowed folder, else the conversation workspace, and `POST
/api/v1/opencode/sessions` returns the drops as `notices` (`folderRefused`),
which the web terminal shows localized. attachUrl = external server, no
isolation (doctor warn). Task cwd: `resolveCliCwd`. Hydration: the recall block from
`ctx.memoryRecall` is sent as the `session.prompt` `system` field (drillDown
true when the session is bound to the serve key, false on an attached server),
sized for the task model's window (K10, §13 recall delivery item 4). The
developer-agent masks the task prompt and that `system` text with
one `redactToolOutput('opencode_run', …, transport 'opencode')` call before any
sidecar call (§40, D5); a failed scan fails the task. `opencode_run` refuses to
run outside a conversation.

**EYAS memory inside OpenCode (J10).** OpenCode reads memory the way every
other model does and cannot write it.

- The managed EYAS memory plugin exposes only `memory_search` and
  `memory_expand`, generated from the registered tool definitions (same names,
  descriptions and arguments). It posts to `POST
  /api/v1/opencode/memory/search|expand` with a one-time session proof (below)
  and only the tool's declared arguments. `eyas_query_memory` /
  `eyas_save_memory` and `/memory/query|save` are removed (404).
- Keys and proofs (`opencode/plugin-tokens.ts`, K4). One 32-byte key per
  `opencode serve` start (`opencode-runner.ts`, spawn stdio
  `['ignore','pipe','pipe','pipe']`) and per TUI PTY (`pty-manager.ts` →
  `PtySpawnOptions.pluginKey` → `unix-pty.ts` adds an fd-3 pipe). The key is
  revoked when that process exits or restarts. `deliverPluginKey` writes it
  into the child's fd 3, a socketpair end, and ends it; it is never in env,
  argv or a file. The environment gets only `EYAS_OPENCODE_KEY_FD=3`
  (`buildOpencodeEnv({ pluginKeyOnFd })`); an inherited marker or token is
  dropped. The plugin reads fd 3 in `EyasMemoryPlugin()`, only when the marker
  is set and fd 3 is a socket or FIFO, keeps the key in module memory and
  closes fd 3. OpenCode 1.18.29 loads plugins in-process through a cached
  `import()` (the TUI in its server Worker, same process), before any session
  shell exists; the model's bash then has no fd 3. Each call carries `Bearer
  eyas-ocs.<b64url JSON {s: sessionID, n: nonce, t: ms}>.<b64url
  HMAC-SHA256(key, 'eyas-opencode-memory-call/v1.' + payload)>`, where `s` comes
  from the tool context's `sessionID` (set by OpenCode). Only the declared tool
  arguments are sent. `PluginTokenRegistry.check` verifies the MAC in constant
  time over all live keys, freshness (±2 min, `SESSION_PROOF_MAX_AGE_MS`) and
  that the nonce is unused; `redeem` also marks the nonce used. The
  delegated-bearer verifier uses `check` (it does not use the proof up); the
  route redeems. The `shell.env` hook blanks `OPENCODE_SERVER_PASSWORD` and
  `EYAS_OPENCODE_KEY_FD`. An attached external server gets no key. The static
  `EYAS_OPENCODE_PLUGIN_TOKEN` is gone: EYAS neither reads nor sets it.
  Residuals: 1.18.29 reads `OPENCODE_SERVER_PASSWORD` only from its
  environment (Effect Config, built when the server starts listening, before
  any plugin runs), so a same-user process reading `/proc/<pid>/environ` or
  `ps eww` can drive that server's sessions through OpenCode's API. One serve
  per bound session (the spec's fallback) would not close this: every
  same-user process can read every other one's environment, so each serve's
  password would be as readable as the shared one; closing it needs OS-level
  separation (another OS user or a sandbox around OpenCode's shells). A process that may read another process's memory can reach
  the key. OpenCode has no kernel sandbox. Where the key cannot be handed over
  on fd 3, OpenCode runs without the EYAS memory tools.
- `auth/delegated-bearer.ts` (`registerDelegatedBearer`) lets a valid proof
  pass the deny-by-default middleware on those two exact paths only, without a
  user (§10). A signed-in caller needs `create OpenCode`; `/api/v1/opencode/*`
  is paired with authenticate + csrfProtection.
- The routes run the registered tools through `ToolExecutor.execute` +
  `renderForModel` (gate, CASL, drill budget, access log, privacy mask with
  transport 'opencode'). A plugin call acts for the session its proof names: a
  body `sessionId` that differs is 403, and a proof-shaped bearer that fails
  `redeem` is 401. The `ToolContext` comes from an in-process session binding
  (`opencode/memory-bridge.ts`: tokenId + sessionId → conversation, user,
  turn, run; 30-minute sliding TTL), looked up with (proof sessionId, proof
  tokenId) and created only by developer-agent for an `opencode_run` task, so
  the task reads its conversation's project, project type and global memory
  and shares the calling turn's 3-call budget. Signed-in callers keep the body
  `sessionId` plus the bound-user check. Unbound sessions (the TUI's),
  other-key proofs and a signed-in caller who is not the bound user are served
  as 'external' with global-only scope.
- Capture: `captureOpencodeToolEvent` (settled tool parts, deduplicated by
  callID: 'completed' as success, 'error' with its error text as
  `isError`/outcome 'error'; a refused call — permission rejected, a rule, a
  dismissed question — is not recorded) and `capturePtyOutput` (terminal output, only for the terminal user's
  own existing conversation) write `tool_result` / `ingested` units scoped via
  `resolveConversationScope`, only under `capturePolicy().toolResults`, with
  provenance origin 'opencode' / 'terminal'. The separate event/answer/diff
  saves are gone: the answer and diffs are the `opencode_run` result.

**Model and reasoning variant (F12).** OpenCode is a tool sidecar, not a chat
provider: its model and reasoning variant are operator settings
(`opencode_settings.json`: `model {providerID, modelID} | null`,
`variant | null`), not the conversation's effort.

- Discovery = `GET /config/providers` on the running server (zero-cost, no
  prompt), parsed tolerantly; provider `key` / `options` / `env` are never
  copied (the live payload carries API keys). Variant names on the canonical
  ladder carry their rung (`level`); others stay provider-specific.
- developer-agent forwards `model` and, only when OpenCode lists it for that
  model, `variant` on `POST /session/:id/message`; otherwise the variant is
  dropped with a warning.
- The effective model/variant is read back from the reply's AssistantMessage
  (providerID, modelID, variant) and returned as
  `DeveloperTaskResult.effective`.
- API: `GET /api/v1/opencode/models` (read:OpenCode; never spawns the server;
  `running:false` when idle, 502 `OPENCODE_MODELS_UNAVAILABLE` on failure).
  Each model may carry `contextWindow` (`OpencodeModelInfo.contextWindow`: its
  `limit` input, else context — the smaller when both), which sizes a task's
  recall (K10).
  `PUT /api/v1/opencode/settings` is Zod-validated (400 on a malformed body).
  Fixture: `tests/fixtures/cli/opencode/1.18.29/config-providers.json`.

#### Default binding and the auxiliary model service

`model/binding.ts` `resolveDefault` is the single install default: the Standard
tier (registered and enabled) → the `provider_config` default → the first
registered and enabled provider by id that has an enabled model. No provider is
preferred by id and registration order never matters. The gateway gets it
through the `getDefault` hook and binds a copy of an unpinned request before
the first attempt; with no binding it throws ('No default model binding').
This replaces the old "unpinned → anthropic, else first registered" rule.

`canRunIsolated(provider)` = `!isCliProviderId || supportsIsolatedCompletion`.
It gates both the isolated tier-fallback hop and background eligibility. The
gateway rejects any message role other than `user`/`assistant` (instructions go
in `request.system`). `routing/tier-store.ts` `readTiers` is the one
`routing_tiers` reader.

**Auxiliary model service** (`model/auxiliary.ts`, `ctx.auxiliaryModel`,
published in `onRegister`, lazy per call). Purposes map to the groups
memory | learning | title | safety | planning | research | triage, each with a
policy `{tiers, tierOnly, maxCandidates}`: memory/learning heartbeat; title
heartbeat only; safety heartbeat → quick with 2 candidates; planning
quick → standard; research standard; triage only. Ladder: policy tiers →
`resolveDefault` if eligible → API providers by id with a model they can name →
isolating CLIs by id (provider-only pin). Every request is isolated, with one
user message, the system text in `request.system`, metadata
purpose/auxRoute/origin and no `metadata.tier`. The service never throws: it
returns `none(no_eligible_provider | tier_not_configured | budget_stop)` with no
model call, and moves to the next candidate only after a retryable error. The
`supportsIsolatedCompletion` contract: no tools, one turn, output bounded by
`maxTokens`, no provider-native memory/config read or written, no session
persisted to host stores, never resumes. (`supportsHeadlessInvocation` from the
memory design spec is folded into `canRunIsolated`.) Consumers read
`ctx.auxiliaryModel` through a getter per call.

**Output cap of an isolated completion (`model/cli-output-cap.ts`, K5).** The
CLIs take no max-output setting from EYAS, so a provider that advertises
`supportsIsolatedCompletion` enforces `ModelRequest.maxTokens` on EYAS's side,
for isolated requests only. Once the streamed answer text passes
`floor(maxTokens) × 4` characters, the chunk is cut at the cap (never inside a
surrogate pair), later model output is dropped, and the CLI is stopped. Claude
Code: `Query.close()` and then abort, so a hook or permission control request
still in flight is dropped rather than answered on an aborted pipe. Grok/Kimi:
`session/cancel` through the ACP runner's shared cap path, which is also the
tool-call cap (`capped = 'max_turns' | 'max_tokens'`). The call ends as `done`
with stopReason `max_tokens` and the clipped answer, never an error. A Claude
answer reported only in the result message is clipped the same way. Reasoning
does not count. A turn with tools is not capped by `maxTokens`. This makes the
contract's "output bounded by `maxTokens`" true for all three CLIs (proven in
the free live lane on Claude Code 2.1.281 and Grok CLI 1.0.41; Kimi by the
fake-agent tests).

Fail-open passes use `ctx.auxiliaryModel.completeText({ purpose, system, user,
maxTokens, temperature, fallback })`, which never throws and returns the
fallback on none, error, empty output or a refusal. `model/cheap-pass.ts`
(`runCheapModelPass`) no longer exists. Callers on the service:

- **learning / title:** `conversations/auto-title.ts` ('title', tier-only
  Heartbeat; called from the chat route through the last positional parameter
  `getAuxiliaryModel` of `createConversationRoutes`, with conversationId);
  `proactive-assistant/heartbeat-composer.ts` ('heartbeat');
  `self-learning/execution-learner.ts` ('self_learning', `deps.aux`);
  `forge/proposal-engine.ts` ('forge', `deps.aux`);
  `skill-generation/skill-generator.ts` ('skill_generation',
  `BuildOptions.aux`); `data-port/pipeline/transform.ts` `enrichMemory`
  ('data_port_enrichment'; `useAi = enrich && aux present`, the service
  looked up when the job runs, not captured at start; only an ok, non-refusal
  answer is used, otherwise the item counts as aiFallback — B11). None of these
  reads `ctx.model` or `ctx.decisionEngine` any more.
- **memory:** capture ('capture', via `capture/index.ts`
  `completeViaAuxiliary`, maxTokens 2000), the semantic promoter
  ('consolidation', 800) and the reflection job ('reflection', 800).
  `memory/capture/completion.ts` and its `gateway-fallback` rung are deleted.
  `none` never becomes a model call: capture records `no_eligible_model` or
  `budget_stop`, the promoter returns null (the consolidator keeps the cluster,
  uninvalidated), and reflection keeps its deterministic digest.
- **safety:** `security_judge` (`security-gate/llm-judge.ts`,
  `createLlmJudge({getAux})`), `critic` (`agent/critic.ts`, `CriticDeps.aux`),
  `planner` (the conversation-runner's rubric plan via `planning.ts`
  `PlanCompletion`; `generatePlan` / `maybePlanTask` take
  `complete: ({system,user}) => {text}|{error}` instead of a gateway). Heartbeat
  → quick, at most 2 candidates, the next only after a retryable transport
  error.
- **planning:** `team_proposal` and `re_planner` (quick → standard).
- **research:** `research` (standard → default binding → API providers →
  isolating CLIs), see §21.
- **triage:** the decision engine's LLM triage, `ctx.auxiliaryModel.complete({
  purpose: 'triage', origin: 'interactive', conversationId, maxTokens: 60,
  temperature: 0 })`, tierOnly on the 'triage' tier (primary, then fallback
  row, `canRunIsolated`). The engine takes `gateway: Pick<ModelGateway,
  'getProvider'>` (built with `createLazyGateway(() => ctx.model)`) and
  `getAux: () => ctx.auxiliaryModel`, both read per call; candidate iteration
  belongs to the resolver, and the engine has no second fallback branch. The
  classifier's answer is Zod-validated against the known categories and
  complexities; anything else gives the keyword result. The conversation id
  travels `BindingInput.conversationId` → binding `route(text,
  {conversationId})` → `decisionEngine.route(message, {conversationId})` → aux
  `metadata.conversationId`, for trace attribution.

The isolated interactive one-shots stay on their interactive binding and do
not use the background resolver: plan-first uses the conversation's pinned
binding; the God Mode cross-review uses the reviewer's roster pair, with the
system/user split and peer results fenced as `<peer-result>` data; design uses
the gateway's unpinned default (`resolveDefault`).

**Status surface (C10).** `describe()` is exposed read-only as
`GET /api/v1/routing/auxiliary`. The route is registered by
`createRoutingRoutes(app, db, { getAuxiliaryModel })`, reads the service on
every request, is guarded by `requirePermission('read','Settings')` and returns
`AuxiliaryStatusResponse { groups: AuxGroupStatus[] }` in `AUX_POLICY` order
(`{group, purposes, target: {provider, model|null, route} | null, reason |
null}`), or 503 when the service is absent. It makes no model call. The
Providers → Routing Tiers tab renders it as the 'Background model calls' card
(`src/web/src/pages/providers/background-calls-card.tsx`), with the degraded
banner on reason `no_eligible_provider`.

**Effort intent (C11).** The service reads the effort of the purpose's primary
policy tier (`AUX_POLICY[group].tiers[0]`, through `routing/tier-store`
`getTierEffort`, the same reader the gateway uses). When that is a ladder rung,
it sets `request.effort = {level, source:'tier'}` on every candidate of the
call, whichever rung the candidate came from. Auto/null, anything that is not a
rung, or a failing lookup sends no intent. The service never clamps, never
reads capabilities and never sets `metadata.tier`: the gateway resolves the
intent per attempt against the model that answers (`resolveEffortPlan`), sends
effortPlan and records effortOutcome (requested/effective/source) in
`ai_traces`. A CLI candidate pinned by provider only names no model, so its
intent resolves to Auto (reason model-unknown) until the CLI's
runtime-verified model can be pinned.

**CLI tier models (F5).** `isRuntimeVerifiedModel` (`cli-model-id.ts`): a CLI
candidate is pinned to its tier model only when that row is enabled, carries
`discoveredAt` and has no `missingSince`; otherwise the candidate is
provider-only (the CLI's default model).

**Tracing (C9).** Every aux call reaches the tracing wrapper, because the
service resolves `ctx.model` on every call; `purpose` / `aux_route` are recorded
in `ai_traces` (§46) and the cost counts toward the routing budget
(`readSpendTotals`, below).

**Direct model calls (C12).** Only these call the gateway's
`complete`/`stream` directly: the agent runner, the conversation stream route,
`/api/v1/model/complete|stream` (`model/routes.ts`), the tracing wrapper
(`observability/trace-collector.ts`), the lazy gateway, the gateway's own
provider dispatch and the auxiliary service. The isolated interactive
one-shots do too, each with `isolated: true` on its request: plan-first in
`conversations/routes.ts`, the God Mode reviewer
(`agent/god-mode/orchestrator.ts`) and `design/design-ai.ts`. Every other model
call goes through `ctx.auxiliaryModel` (or runs as a conversation through the
agent runner). Narrow injected clients (planning's `PlanCompletion`, the ops
`LlmClient`, the email-triage `LLMClient`) must be backed by
`ctx.auxiliaryModel.completeText` when they are wired. Provider submodules may
call their own adapter, never the gateway.
`tests/modules/model/no-direct-model-calls.test.ts` enforces this by scanning
syntax (aliases, casts, getters, a destructured `ctx.model` and method
references included), requires `isolated: true` in the isolated one-shot
files, and fails on a stale allowlist entry. The unwired automatic trace scorer
(`quality-scorer.ts` `autoScoreTrace`, a hardcoded vendor model id, no caller)
and `TraceCollector.updateAutoScore` are deleted (§46).

#### Conversation/agent binding (D3)

`model/binding.ts` `createBindingResolver` (published as `ctx.modelBinding` in
the model module's `onRegister`; every input read per call through
`catalogBindingDeps`: gateway registrations, provider_config/model_config,
`readTiers`, the decision engine, `routing_budget.auto_routing_enabled` via
`tier-store.ts readAutoRoutingEnabled`) is the one answer to "which
provider+model runs this conversation turn". `conversations.model_binding` ∈
pinned | auto | inherit (additive column, default 'pinned'; one-time
migration: rows with agent_id or parent_conversation_id → 'inherit').

Precedence: one-turn request override (source `request`) > pinned pair
(`conversation`) > Auto — only on an 'auto' conversation and only while the
global switch is on; triage via the decision engine, `tier` set, and only then
is `metadata.tier` stamped (the gateway's failover licence) > inherit chain:
agent model (resolved to a concrete pair via `resolveModelRef`; source
`agent`) > stored pair (`parent` for sub-conversations, else `conversation`) >
`resolveDefault` with `materialize: true`.

- A pair without a stored model is fixed by
  `ConversationService.materializeBinding` (UPDATE … WHERE provider_id IS NULL
  OR model_id IS NULL, race-safe) before the provider call.
- A fixed pair that cannot be served (provider not registered or switched off,
  model row disabled) throws `BindingUnavailableError('model_binding_unavailable')`
  → coded 400; an agent pair that cannot be served falls back with note
  `agent-binding-unavailable`; Auto with the switch off / routing failure →
  stored pair with note `auto-routing-disabled` / `auto-routing-unavailable`;
  nothing configured → `no_model_configured`.
- `resolveStatic` (no triage; Auto shows the Standard tier; never writes) feeds
  GET `effectiveBinding`, the done frame and the context-window denominator;
  effort is resolved by the gateway against the model the binding picked.
- The decision engine skips triage when all enabled triage targets
  (quick/standard/complex/code) resolve to one pair.
- Chat stream: `agent_start.binding` = `TurnBindingSchema`
  (`shared/chat-stream.ts`: source request|conversation|auto|agent|parent|default,
  tier?, note?); the assistant message records the provider that answered
  (failover included).
- **Every entry path uses the resolver (H4).** Non-chat paths resolve through
  `resolveRunBinding` (`resolveRunBindingStatic` for team members, which are
  never triaged): executeAgent/delegation, team members, conversation-runner
  background cards and God Mode children, channel replies and A2A. It is the
  same resolver as the chat route; a conversation's missing default is
  materialized before the call, and provider and model always come from one
  binding. `BindingUnavailableError` is a `CodedModelError` (kind
  invalid-request). The gateway's unpinned path throws
  `BindingUnavailableError('no_model_configured')` when `getDefault` yields
  nothing (never retried).
- **Agent binding.** A colleague's binding is `provider` + `model` (column
  `agent_definitions.provider`, backfilled once from model_config where exactly
  one provider owns the id; ambiguous ids and tier aliases stay provider-less
  and resolve at run time). An unusable agent pair falls back to the stored or
  default pair with note `agent-binding-unavailable` (TurnMeta), never to a
  provider picked by name. The Anthropic-only team router (`model-router.ts`,
  `TeamConfig.modelRouting`) is deleted.
- **Sub-conversations.** `createSubConversation` stores the delegating turn's
  effective pair. That pair travels as `ToolContext.modelBinding`: the agent
  runner sets it; the request metadata carries it to the CLI bridges, which
  copy it (`BridgeBinding.modelBinding`, the claude-code bridge ToolContext). It
  is not the parent's raw row. A team member's conversation stores the lead's
  current binding (the parent's `resolveStatic`). A handoff home thread, channel
  and A2A conversations are colleague conversations (inherit), God Mode workers
  are pinned to their roster pair, and board-card creation stores a pair only
  when it is an enabled model of an active provider.
- **User-chosen pairs (H5).** `conversations.model_user_chosen` (INTEGER NOT
  NULL DEFAULT 0). Only `PATCH /api/v1/conversations/:id` with
  providerId+modelId (the top-bar model picker) sets it to 1; a client-sent
  value is stripped. The resolver input `BindingConversation.userChosen` (mapped
  by `conversationBindingInput` and `runConversationRow` from
  `modelUserChosen`, and read by conversation-runner's explicit SELECT) makes
  `storedOrDefault` fail closed for mode 'pinned': an unusable stored pair
  throws `BindingUnavailableError('model_binding_unavailable')` instead of
  falling back to `resolveDefault` with note 'stored-binding-unavailable'. Rows
  the system stamped keep the note fallback (the materialized default, pre-D3
  migrated rows, sub-conversation pairs), and so do the 'auto' and 'inherit'
  modes. `BindingResolver` exposes `autoRoutingEnabled()`, returned by GET
  /conversations/:id as `autoRoutingEnabled` for the picker.
- **Frontend (H5).** `src/web/src/pages/conversations/model-picker.ts` holds the
  picker's options, value and tooltip logic; a value encodes provider+model
  through `src/web/src/lib/model-pair.ts` (U+001F separator, because model ids
  may contain ':' or '/'). The per-reply 'answered by' caption is
  `components/answered-by.tsx`; the web store keeps `streamBinding` from
  `agent_start.binding`.

#### Egress slot (D2)

The raw gateway (`createModelGateway`) takes `options.egress`, an `EgressSlot`
from `src/modules/model/egress.ts`. It holds at most one
`EgressFilter { request(req, provider), embed(req, provider) }`; `install()`
returns an uninstall function, and a second concurrent install throws. The
model module creates the slot in `onRegister` and publishes it as
`ctx.modelEgress`.

`complete()` and `stream()` call the filter on EVERY attempt right after
`resolveProvider` and send its output to the provider. The raw attempt is kept
for `nextAttempt`, so the retry and the tier-fallback hop are each filtered
once, for the provider they actually reach. `embed()` filters for the resolved
embedding provider.

Filter contract: sync and pure; returns the same object when unchanged,
otherwise a shallow copy that spreads every untouched field (metadata, tools,
signal, effort/effortPlan); never mutates its input. A throw or a non-object
result fails the call closed and is not reported to the reauth healer. Gateway
merge order: default binding → egress → model-owner lookup → effort plan
(computed after the egress call).

`AIProvider.egressHost?()` gives the host prompts are sent to, read from the
configured base URL (ollama, lmstudio, openai and its spreads:
openai-compat/kimi/openrouter, anthropic-compat). `undefined` means unknown or
CLI and is treated as remote. The privacy filter is installed into this slot
(§40).

#### Stream contract (G1)

`src/shared/chat-stream.ts` is the single wire vocabulary shared by the model
layer, the chat route and the web. It holds:

- `StopReason`: end, tool_use, max_tokens, stop_sequence, max_turns, refusal.
- `ToolOutcome` (`TOOL_OUTCOMES`: success, error, denied, approval_required,
  skipped), `TurnOutcome` (`TURN_OUTCOMES`: completed, max_turns, max_tokens,
  refusal, tool_budget, cancelled, parked, failed), the canonical `ModelUsageSchema`
  (`inputTokens` = uncached), `CostSource` / `costSourceOf`,
  `NoticeCodeSchema` (owners extend it in place).
- The strict `TurnMetaSchema` (outcome, stopReason, usage, costSource,
  errorKind/Code, steps, toolCalls, approvals, binding, notices, effort) and
  the `ChatStreamFrame` union.

Providers yield `StreamEvent` = `ContractStreamEvent` (text, thinking,
tool_use_start{rawName}, tool_use_input, tool_result{outcome, executedBy},
approval_required, step, notice, done, error). A tool row settles only on
`tool_result`. `StreamEvent` is now exactly `ContractStreamEvent`: the
deprecated transitional union (`tool_use_end`, `context_compact`) is deleted,
and no provider emits either.

- `CodedModelError(kind, code, params)` is recognised by `classifyModelError`,
  directly or via `cause`.
- `canonicalToolName` / `normalizeToolInput`
  (`src/shared/canonical-tool-name.ts`) serve display and bookkeeping only;
  security-gate classification keeps raw names.
- `normalizeStopReason` (`model/stop-reason.ts`) is one table per backend family.
- `grok-cli/acp-events.ts` is the Zod parser for ACP `session/update`. It never
  throws; unknown kinds become `other`.

**API providers (G4).** The shared Anthropic consumer
(`consumeAnthropicStream`), the shared OpenAI provider (also openai-compat,
kimi, openrouter, lmstudio), Gemini and Ollama are typed as
`ContractStreamEvent` and no longer emit the pre-execution `tool_use_end`.

- Canonical usage is built in one place, `src/modules/model/usage.ts`
  (`toModelUsage`, `tokenCount`, `asRecord`), with one per-dialect mapper in
  each adapter: `fromAnthropicUsage`, `fromOpenAIUsage` (prompt − cached;
  reasoning from completion_tokens_details), `fromGeminiUsage` (prompt −
  cachedContent + toolUsePrompt; output = candidates + thoughts),
  `fromOllamaUsage`. No usage → `reported:false`.
- Stop reasons: every API adapter calls `normalizeStopReason`;
  `mapAnthropicStopReason` is removed. Adapter-level extras: `openAIStopReason`
  (the `refusal` field wins) and `geminiStopReason` (`promptFeedback.blockReason`
  → refusal).
- `estimateCost` (`src/shared/model-pricing.ts`) assumes the canonical
  semantics. A cache token without a configured cache rate is priced at the
  input rate.

**Claude Code (G2).** `claude-code/stream-normalizer.ts` maps the Agent SDK
messages onto the contract. Queries run with `includePartialMessages: true`,
and each SDK message is Zod-parsed tolerantly.

- `stream_event` `message_start` gives `step{n}` and `promptTokensLastCall`.
  Text and thinking deltas give text/thinking; the complete assistant message
  of an already-streamed id is skipped, and a message that was not streamed is
  emitted.
- `tool_use` gives `tool_use_start{canonical name, rawName, normalizeToolInput(input)}`.
- A user `tool_result` block gives `tool_result`: content through
  `model/tool-result-content.ts` (flattened, 64 KiB UTF-8 cap), `durationMs`,
  and `executedBy` = eyas for `mcp__eyas__*`, provider otherwise. The outcome
  comes from one refusal map, fed by the permission bridge's `onDecision` and
  the memory-policy hook's `onDeny`; without a refusal it is success or error.
- Refusals that wait on a human are sent as `approval_required` before the next
  SDK message, never before their row opened. Refused rows left open by an
  interrupting deny are settled on exit, including on the throw path.
- `compact_boundary` gives `notice{contextCompacted, {trigger, preTokens}}`.
- Result: success → done with `normalizeStopReason('claude-code', stop_reason)`
  (a raw `tool_use` becomes `end`); `error_max_turns` → done{stopReason
  'max_turns'} with the partial answer; other subtypes →
  `ProviderRunError(partialText, usage)`.
- Usage is canonical, with `reported:true` and the runtime's `costUsd`.
  `contextWindow` is the `modelUsage` entry of the main-thread / init model.
- Messages with a non-null `parent_tool_use_id` are dropped. The init tripwire
  also covers `stream_event` / `user` messages that arrive before init.

**Grok/Kimi (G3).** `grok-cli/acp-stream.ts` maps validated ACP session updates
(acp-events.ts) onto the contract.

- `tool_use_start` carries the canonical name (ACP kind → canonicalToolName;
  grok's first title; `eyas__` / `mcp__eyas__` → the EYAS tool with
  `executedBy 'eyas'`), with the CLI title as `rawName` and
  `normalizeToolInput(rawInput)` plus the first diff as `{path, old_string,
  new_string}`. It is re-emitted (upserted) when the name or input changes.
- Exactly one `tool_result` per call, on status completed/failed: content text
  or rawOutput capped at 64 KiB UTF-8, `durationMs`, outcome, `executedBy`.
- The outcome comes from EYAS refusals: acp-governance `onDecision` (with
  `outcome`/`reason`/`approvalId`, also for gate-refused client-fs operations),
  cap cancellations (`skipped`), and the MCP bridge binding's `onToolOutcome`
  relayed through `createAcpBridgeOutcomes`. `approval_required` is emitted
  when a call waits on a human.
- `normalizeAcpUsage` maps the ACP / grok `_meta` usage onto canonical
  ModelUsage, using the reported total to tell whether input includes cache and
  whether output includes reasoning. `reported:false` when absent.
- `AcpCanUseTool(toolName, input, {toolCallId})`. `createAcpCanUseTool` wraps
  the shared permission bridge and carries the bridge's decision outcome on the
  deny.
- The ACP providers forward bridged approvals to
  `metadata.onEscalatedApproval` (park parity) and pass `providerLabel` for
  error text.

**Adapters and stop reasons.** Every API adapter (anthropic; the openai family
incl. openai-compat/kimi/openrouter and lmstudio; gemini; ollama) derives
`ModelResponse.stopReason` only through
`normalizeStopReason(family, raw, content)`. A response whose content carries
`tool_use` blocks stops for `tool_use` even when the backend reports a plain
stop, but budget and safety stops (`max_tokens`, `refusal`) are never
overridden; adapters keep no per-provider finish-reason switch. `ToolUseBlock`
has an optional opaque `signature` replay token: Gemini stores the part-level
`thoughtSignature` there and replays it with the `functionCall`; other adapters
ignore it. Gemini tool-call ids are Gemini's `FunctionCall.id` when present,
otherwise a unique EYAS-synthesized `gemini-call-<uuid>` that is never sent
back to Gemini; `functionResponse` carries the function name and the call id,
and failed tools are sent as `{error}`. Ollama links tool results to their
calls by `tool_name`, because its native wire format has no call ids.
OpenAI-compatible streams that send a tool call without an id get one
`call_<uuid>` used by the chat row, the `tool_use` block and the result. CLI
providers never put `tool_use` blocks in content, so the runner's strict
`stopReason === 'tool_use'` check never runs a tool the CLI already executed.

`ContentBlock` includes a transient `ThinkingBlock` {type:'thinking', thinking,
signature?, redactedData?, origin ('anthropic' | 'openai-reasoning-content' |
'openrouter-reasoning-details'), providerId, modelId, raw?}. The Anthropic API
and anthropic-compat providers share one stream consumer,
`consumeAnthropicStream` (anthropic/adapter.ts). It keeps text, tool_use,
thinking and redacted_thinking blocks in API order by event index, captures
`signature_delta`, and reads cache usage (message_start, raised by cumulative
message_delta counts). `fromAnthropicResponse` maps the same blocks on the
non-streamed path. `toAnthropicMessages(messages, providerId)` replays a
ThinkingBlock byte-unchanged only when its origin is 'anthropic' and its
providerId equals the target provider, and never drops one for being empty.
Every other adapter (openai family incl. lmstudio/kimi/openrouter/openai-compat,
gemini, ollama) removes thinking blocks through `helpers.ts
stripThinkingBlocks`, dropping a message left empty. The block lives only
inside one agent-runner tool loop: it is not persisted with the conversation,
and `resumeRun` strips it from a checkpoint seed because the resumed prefix
differs. The agent runner keeps the system prompt and history append-only
across loop iterations, which preserved-thinking models require (a 400 on
edited history for accounts created on or after 2026-08-31).

The OpenAI wire family has three dialects (`openai/adapter.ts`
`OpenAIDialect`): openai (native OpenAI and every openai-compat gateway),
openrouter and kimi. `fromOpenAIResponse` and the stream turn
`reasoning_content` / `reasoning` / `reasoning_details` into thinking events
plus one ThinkingBlock, placed first. Its origin is
`openrouter-reasoning-details` (raw = the merged reasoning_details list) for
openrouter, else `openai-reasoning-content`, bound to providerId and the EYAS
modelId. `toOpenAIMessages(messages, system, {dialect, providerId, modelId})`
replays same-origin, same-provider, same-model blocks on assistant turns: kimi
as `reasoning_content`, openrouter as `reasoning_details` unmodified. The openai
dialect never replays; every other block is stripped (F7). Gemini `thought:true`
parts become thinking StreamEvents and are excluded from
`ModelResponse.content`; its replay token stays the functionCall part's
`thoughtSignature` (F8). Ollama `message.thinking` streams as thinking (F9).

#### Reasoning capability (E1)

`model/reasoning/` holds:

- `ladder.ts` — pure and web-importable: auto | none | minimal | low | medium |
  high | xhigh | max, `EffortSource`, `EffortIntent`.
- `capability.ts` — `ReasoningCapability` and `UNKNOWN_CAPABILITY`.
- `schemas.ts` — `DiscoveredReasoningSchema`, the single discovery shape stored
  in `model_config.metadata.reasoning`; `ReasoningCapabilitySchema` with its
  invariants; `OverlayFileSchema`.
- `overlay.json` — versioned; every row has a source, a verified date and
  evidence `verified-docs | verified-sdk`; an optional row-level
  `clampPolicy: 'server'` marks an endpoint that accepts a generic ladder and
  clamps to the upstream model itself (OpenRouter, gpt-oss on Ollama). For such
  a row the registry keeps the row's levels over the discovered generic ladder;
  discovery only proves a control exists (a discovered param none still yields
  no control). A kind-'none' overlay row wins over discovered levels
  (`lmstudio-no-control`). Rows cover Anthropic, OpenAI (incl. o-series),
  OpenRouter upstream families (Claude 4.6, GPT-5.x/o-series/GPT-6 Astra,
  Gemini 3.x), Gemini, xAI (no control over Chat Completions, except
  `xai-grok-3-mini`), Grok CLI, Kimi, Ollama gpt-oss and LM Studio. There is no
  kimi-cli row (F11: discovery only). Evidence notes (K8): rows for OpenAI
  models whose model pages mark Chat Completions 'Not supported'
  (pro/codex/deep-research) exist only for openrouter, because EYAS's openai
  provider uses Chat Completions. `xai-grok-3-mini` is the only xAI row with an
  effort control (Chat Completions `reasoning_effort` low | high).
- `registry.ts` — `ctx.reasoningRegistry.get(provider, model, realModelId?)`.
  Discovery wins on levels; the overlay supplies the default, can-disable,
  budget range, sampling lock and display. Unknown models resolve to
  `unknown`, so effort resolves to Auto and no parameter is sent. The registry
  is memoized and invalidated by the models refresh route.
  - **Overlay matching — one prefix rule (K8).** A row matches its anchored
    regex against the real model id and then the EYAS id. If nothing matches,
    the same is tried on the ids' release stems (`releaseStems`): trailing
    release stamps are stripped one by one, longest stem first. Release stamps
    are date snapshots (`-YYYY-MM-DD`, `-YYYYMMDD`, `-MMDD` with a real month
    and day), `-latest`, and a context marker `[Nk|Nm]`. Variant segments are
    never stripped; `-preview` is excluded because o1-preview is a different
    model from o1. An unknown family stays kind 'unknown' (Auto). Rows stay
    provider-scoped.
  - **Runtime display (K8).** `DiscoveredReasoning`
    (`model_config.metadata.reasoning`) has an optional `thinkingDisplay:
    boolean`: whether the runtime can be asked to stream thinking. Claude Code
    discovery sets it from its version (`runtimeHasThinkingDisplay`, minimum
    2.1.280). When a row is merged with a discovered record whose
    `thinkingDisplay === false`, the registry sets `displayParam` false and
    `reasoningVisible` 'hidden' (`applyRuntimeDisplay`). Absent means the
    overlay stands.

Providers read only the gateway's `effortPlan` (see Reasoning effort
resolution) and map it directly: the Anthropic API and Anthropic-compatible
providers (F6), the OpenAI family — openai, openrouter, kimi dialects (F7) —,
Gemini (F8), Ollama and LM Studio (F9), Claude Code (F5), Grok CLI (F10) and
Kimi Code CLI (F11); see the mapping table below. There is no legacy path:
`ThinkingConfig`, `ModelRequest.thinking` and `reasoning/legacy-shim.ts` are
deleted (E7). `tests/contracts/effort-plan-owner.contract.test.ts` pins that
every provider family maps from `effortPlan` (directly or through the OpenAI
wire), that no provider reads the raw effort intent or authors outcome fields,
and that the CLI runtimes (claude-code, grok-cli, kimi-cli) confirm the level
they ran only through `readbackOutcome()`. Only those three read the effective
level back; every other provider reports the level the gateway sent.

**Schema.** `model_config.metadata TEXT` (JSON, added in the table's single
additive-ALTER block, validated on read) is the only store of discovered
reasoning; see Model identity and discovered models (F2) below. `upsertModels`
is an `ON CONFLICT` upsert that never clobbers `metadata` or `enabled`; the
refresh and enable/disable responses include `metadata`.

#### Model identity and discovered models (F2)

- `model_config.metadata` (`ModelConfigMetadataSchema`) is the single store of
  provider-discovered facts: alias, realModelId, runtimeVersion, cliVersion,
  discoveredAt, reasoning, plus the reconcile bookkeeping missingSince and
  autoDisabled.
- `upsertModels` merges validated `ModelInfo.metadata` over what is stored. A
  provider cannot set the bookkeeping fields.
- `reconcileDiscoveredModels(providerId, models)` applies only a successful,
  non-empty discovery. Offered rows are upserted and unflagged. Rows no longer
  offered get enabled=0 and missingSince, plus autoDisabled when they were on.
  Rows are never deleted. autoDisabled rows are re-enabled when offered again,
  and a user toggle clears autoDisabled.
- `fetchModels` must throw on failure, never return a static list. The refresh
  route answers 502 `ModelDiscoveryFailed` / `ModelDiscoveryEmpty` and writes
  nothing.
- Gateway model-only resolution order: `provider.listModels()` cache →
  `options.lookupModelOwner` (binding.findModelOwner with `{exact:true}`: an
  enabled row of an enabled, registered provider; null when several own the
  id) → `normalizeModelAlias` → 'No provider found'. It is a single call site
  that E2/H4 preserve.
- CLI model names come from `cli-model-id.ts` `resolveCliModel`: persisted
  metadata (realModelId; alias for Claude Code) → id minus the provider prefix
  → pass-through. The provider default id (grok-cli-default,
  claude-code-default) and no model mean 'send no model'. A bare prefix or a
  name that fails `CliModelNameSchema` throws. There are no process-local
  EYAS-id → CLI-model maps; the seed catalogs (KNOWN_MODELS metadata) are the
  only fallback tables.
- `ModelResponse.model` is always the EYAS id that was requested.
  `ModelResponse.resolvedModelId` is the backend-reported concrete model,
  absent when none is reported (`helpers.ts` `withResolvedModel` /
  `resolvedModelField`). `AuxResult.model = resolvedModelId || model`.

#### Reasoning effort resolution (E2)

- One ladder (none, minimal, low, medium, high, xhigh, max, plus 'auto' = send
  nothing).
- A `ModelRequest` carries an `EffortIntent {level, source}`, picked by
  `reasoning/intent.ts` `pickEffortIntent` with precedence conversation > deep
  (max) > agent > inherited (nearest parent).

Per attempt, after provider resolution, the egress slot and any retry or
tier-failover hop, the gateway:

- strips any caller-supplied `effortPlan`;
- looks up the answering model's `ReasoningCapability` (registry: discovered
  metadata.reasoning over the overlay, matched on metadata.realModelId) and
  its catalog output cap (`model_config.max_output_tokens`);
- applies the routing tier's default (`routing_tiers.effort`, via tier-store
  `getTierEffort`) only when the request has no intent and carries
  `metadata.tier` (background calls carry their primary tier's effort as an
  explicit intent instead, §8 auxiliary service, C11);
- resolves `reasoning/resolve.ts` `resolveEffortPlan` → `EffortPlan {level,
  thinking omit|on|off, budgetTokens, maxTokensFloor, display, samplingLocked,
  capability}` + `EffortOutcome {requested, effective, source, clamped,
  reason}`;
- spreads `effortPlan` onto the filtered request.

Resolution details:

- `clampEffort`: nearest supported rung, ties down; the vendor clampMap wins;
  unsupported none → lowest; toggle → on-rung; no control or unknown model →
  auto.
- Budgets: `reasoning-wire.ts` `levelToBudget(level, {min,max,perLevel}, cap)`
  is the single level → budget translation: 10/20/50/80/95 % of the output cap
  (per-level value wins), within [min, min(max, cap − 4096)], non-streaming cap
  ≤ 21,333. The resolver puts the result in `EffortPlan.budgetTokens` /
  `maxTokensFloor`; providers never compute budgets.

Providers read only `effortPlan`; a provider may confirm the runtime's
effective level only via `reasoning/outcome.ts` `readbackOutcome()`. The
gateway attaches `mergeEffortOutcome(gateway, provider)` to `complete()` and to
the stream's done response (requested/source always from the gateway).

Persistence: `routing_tiers.effort TEXT` (NULL = Auto), added by an additive
ALTER with a one-time Low seed for triage/quick/heartbeat;
`ai_traces.effort_requested` / `effort_effective` / `effort_source`, in the
additive-ALTER block. A contract test (`tests/contracts/effort-plan-owner`)
pins single ownership: `effortPlan` is assigned only in `gateway.ts`, and
providers write `effortOutcome` only through `readbackOutcome`.

**Write-time validation (E3).**

- Every effort write (conversation PATCH/POST, agent POST/PATCH, raw
  `/model/complete|stream`) is Zod-validated on the canonical ladder
  ('auto'/null = NULL = Auto).
- For a target whose model is known, the rung must be in the model's
  capability `levels`: `model/reasoning/validate.ts` `unsupportedEffort`; 400
  `EFFORT_UNSUPPORTED {level, levels}`. Unknown models accept any rung, and the
  gateway still clamps per attempt.
- The conversation target comes from `conversations/effort-target.ts`
  `effortTargetFor`, which wraps `modelBinding.resolveStatic`: pinned when the
  binding source is request/conversation, or the mode is pinned/inherit; auto
  when model_binding is 'auto'.
- A colleague's model is resolved through `resolveModelRef` (alias-aware).
- The reasoning registry takes `getRealModelId` (model_config
  metadata.realModelId), so `registry.get(providerId, modelId)` matches an
  alias's concrete model; the gateway uses exactly that.
- Conversations data model: `conversations.thinking` / `thinking_budget` are
  migration-only. `conversations/effort-migration.ts` folds a legacy budget into
  effort once at boot and clears off-ladder values; the same repair runs on
  `agent_definitions.effort` (`model/reasoning/stored-effort.ts`).
  `conversations.effort` is a ladder rung or NULL.

**Intent loading (E4).** `conversations/effort-intent.ts`
`loadEffortIntent({db, getAgent}, conversationId, {agentId?, self?,
maxDepth=5})` is the ONLY loader of a run's EffortIntent. It reads
`conversations.effort / orchestration / agent_id / parent_conversation_id`,
walks the delegating parents (at most 5 conversations, cycle-safe, stops at the
first conversation that decides) and applies `model/reasoning/intent.ts`
`pickEffortIntent`: conversation > deep (max) > the agent the run speaks as >
inherited. Callers: the chat route (both branches), runConversation
(background, retry, resume, approval resume, boot recovery, God Mode racers),
orchestrator members, executeAgent (delegation, specialist, pipeline, A2A),
channel replies, and the God Mode review calls. Persisted replies record
`TurnMeta.effort {requested, effective, source, clamped}` via `turn-meta.ts`
`turnEffortOf(response.effortOutcome)`: the chat route through the turn sink's
`annotate()`, executeAgent and channels through `buildTurnMeta`. God Mode
copies the parent's explicit effort onto each child row. The legacy
`thinking-resolver` is deleted.

Full precedence: conversation > Deep (max) > agent > inherited parent chain
(≤ 5) > routing-tier default (`routing_tiers.effort`, when metadata.tier is set,
or as the aux intent of background calls; the Low seed for
triage/quick/heartbeat runs only when the column is created) > model default.

**Scheduler entry path (E6).** Scheduled `agent_run` jobs
(`scheduler/agent-run-handler.ts`) carry an optional `handlerConfig.effort`
(`EffortSettingSchema`; 'auto'/null → NULL). On every run the handler writes it
onto the created or reused run conversation (`conversations.effort`) before
calling `ctx.agents.runConversation`, so `loadEffortIntent` resolves it as
source 'conversation'. With no job effort the column is NULL and the chain
continues (Deep → agent → inherited). There is no separate scheduler effort
path.

**UI/API (E5).**
- `reasoning/options.ts` (pure) builds `EffortOptions` {mode pinned|auto|unknown,
  target, kind, levels, defaultLevel, canDisable, clampMap, reasoningVisible,
  source, verified, catalogVersion}. Auto mode is the union over the enabled
  quick/standard/complex/code tier models.
- `GET /api/v1/model/effort-options` (read:Model; a pair, a bare id/alias via
  `resolveModelRef`, or no model = tier union).
- `GET /api/v1/conversations/:id/effort-options` (read:Conversation +
  ownership; target via `effortTargetFor` → binding `resolveStatic`; adds
  `current` and `inherited` = `loadEffortIntent` without the stored level).
- `/model/models` and `/model/providers/:id` carry each model's effective
  `reasoning`.
- `PUT /routing/tiers/:tier` is Zod-validated (`TierConfigInputSchema`); an
  unknown tier → 404; an unsupported rung for the tier's model → 400
  `EFFORT_UNSUPPORTED` (shared `reasoning/validate.ts`, as conversation and
  agent writes use).
- Web: one `EffortSelect` (`components/effort-select.tsx`) with the helpers in
  `lib/effort-options.ts`, used by the conversation field bar, the colleague
  editor, the routing tiers and the scheduler. Its clamp preview imports the
  backend `clampEffort`, so the UI prediction equals the gateway. Replies show
  an effort chip from `TurnMeta.effort`.

#### Anthropic API reasoning mapping and discovery (F6)

- `anthropic/adapter.ts` `applyAnthropicReasoning(params, effortPlan)` is the
  only Messages API reasoning mapper (Anthropic API and anthropic-compat). It
  holds no model lists; it reads `plan.capability`:
  - auto → nothing, except adaptive + `display:'summarized'` when the plan
    carries `display` (always-on/default-on models with displayParam);
  - none → `{type:'disabled'}` only if canDisable;
  - effort kind → `output_config.effort` (low|medium|high|xhigh|max, only levels
    in capability.levels) + adaptive thinking (+ display);
  - budget thinkingParam → `{type:'enabled', budget_tokens: plan.budgetTokens}`;
  - `max_tokens` is raised to `plan.maxTokensFloor`;
  - temperature/top_p/top_k are deleted when `samplingLocked` or thinking is
    explicitly on. Providers set `temperature` first and then call the mapper.
- `anthropic/provider.ts` `fetchModels()` = `client.models.list({limit:100},
  {timeout:10s, maxRetries:0})` with SDK auto-pagination; entries are
  Zod-parsed tolerantly (`ModelsApiEntrySchema`): `max_input_tokens` →
  contextWindow; `max_tokens` → maxOutputTokens; `image_input` →
  supportsImages; `reasoningFromModelCapabilities` → DiscoveredReasoning
  (effort supported → param effort with the supported levels +
  adaptiveThinking; else thinking.types.enabled → param budget with all
  on-rungs; both reported unsupported → none; otherwise null, overlay only).
- `anthropic/manifest.ts` `seedAnthropicModels`: on a load with a key and no
  rows → discovery → `reconcileDiscoveredModels` +
  `reasoningRegistry.invalidate('anthropic')`; failure or an empty list →
  built-in `ANTHROPIC_MODELS`. Refresh uses the reconcile route.
- anthropic-compat catalog models carry no metadata.reasoning and have no
  overlay rows, so they resolve to `unknown` (Auto only) until a verified
  overlay row names the provider id and model.
- Pricing (`shared/model-pricing.ts`) and the budget downgrade table cover
  `claude-fable-5-1`, `claude-opus-5-5`, `claude-opus-5` and `claude-sonnet-5`.

**Prompt caching (I13).** The Anthropic API provider
(`submodules/anthropic/provider.ts`, `applyAnthropicPromptCaching`) sets up to
three of the Messages API's four cache breakpoints, all with the default
5-minute TTL:
1. The system prompt, sent as one text block with cache_control. It is
   turn-stable because the clock and recall ride on the user message as the
   turn block (§13 Recall delivery).
2. The last cacheable block before the user message that started the current
   turn. A tool_result-only user message continues a turn, and thinking blocks
   are never marked. This is the end of the byte-stable history: the turn block
   leaves that message once the turn is over.
3. Top-level automatic cache_control, only on requests that offer tools, so
   each tool iteration reads the previous request back.

A read lands only where an earlier request wrote a breakpoint, which is why the
system and history markers are explicit. Cache reads and writes map into
`ModelUsage.cacheReadTokens` / `cacheCreationTokens` and are priced by
`shared/model-pricing.ts` (write 1.25×, read about 0.1× or the model's own
rate). Anthropic-compatible endpoints (anthropic-compat) send no cache_control
because third-party endpoints may reject it.

#### Provider reasoning mapping (F5–F12)

| Provider | Wire mapper | Mapping |
|---|---|---|
| Anthropic API, anthropic-compat | `anthropic/adapter.ts` `applyAnthropicReasoning` | See F6 above. |
| OpenAI (native + openai-compat gateways) | `openai/adapter.ts` `applyOpenAIReasoning(params, plan, 'openai')` + `applyOpenAIGeneration` | `reasoning_effort` for kind effort; reasoning-controlled models get `max_completion_tokens` and no temperature; `maxTokensFloor` raises a smaller `request.maxTokens`. Gateways get nothing unless an overlay row for that provider verifies it (none today; xAI = always reasoning, no control). |
| OpenRouter | same, dialect `openrouter` | `reasoning: {effort}` for effort/budget/toggle; `reasoning_details` replayed unmodified in a tool loop. Discovery `openRouterReasoning(supported_parameters)` → `{source:'catalog-api', param 'effort' minimal…max}` or `{param 'none'}`; a missing list records nothing. |
| Kimi API | same, dialect `kimi` | `reasoning_effort` (kind effort, K3) or `thinking: {type}` (toggle, K2.6); K2.7 Code nothing; `reasoning_content` replayed on tool-call turns; temperature dropped when `samplingLocked`. |
| Gemini | `gemini/adapter.ts` `applyGeminiReasoning(config, plan)` | Gemini 3 (kind effort): `thinkingConfig.thinkingLevel` = MINIMAL/LOW/MEDIUM/HIGH + includeThoughts. Gemini 2.5 (kind budget): `thinkingBudget` = plan.budgetTokens + includeThoughts; 'none' → 0 only when canDisable. 'auto' → only includeThoughts for always-on/default-on models with reasoningVisible 'summary'. `maxOutputTokens` raised to maxTokensFloor; sampling dropped when samplingLocked. Discovery: models.list via Zod `geminiModelFromApi`; `{source:'models-api', param:'none'}` only when `thinking === false`. Seed pinned to `tests/fixtures/gemini/models-list.json`; default model gemini-3.8-flash. |
| Ollama (native `/api/chat`) | `ollama` provider | param `think`: auto → omitted; none → false (only when it can be switched off); toggle rung → true; effort rung → the level name. Discovery = `POST /api/show` per model (`capabilities` 'thinking', optional `thinking {values, default}`) → metadata.reasoning source 'models-api' (toggle, or effort when values are reported). Overlay `ollama-gpt-oss` (low/medium/high, clampPolicy server). `listModels` = `/api/tags` only; `fetchModels` = the enriched discovery; background rediscovery on provider load. An explicit level raises `num_predict`. |
| LM Studio | — | Capability 'none' (overlay `lmstudio-no-control`); the provider also drops `request.effortPlan`. `GET /api/v1/models` `capabilities.reasoning` → `model_config.metadata.runtimeReasoning`, display-only, never read by the registry. |
| Claude Code | `claude-code/reasoning.ts` | See F5 (§8 Claude Code runtime). |
| Grok CLI | ACP `session/set_config_option reasoning_effort` | See F10. |
| Kimi Code CLI | ACP `session/set_model` variant | See F11. |
| OpenCode (tool sidecar) | developer-agent `variant` | Operator setting, not the conversation's effort; see F12 (§8 OpenCode). |

#### Tool addressing (I6)

`AIProvider` gains an optional `toolAddressing`: native | mcp-prefix{prefix} |
meta-tool{via:'use_tool', qualify:'eyas__'} | mcp-server{server:'eyas'};
absent = native. `src/modules/model/tool-addressing.ts` is the only place that
renders an EYAS tool name for prompt text: `renderToolRef(addressing, name)`
for inline references and `toolAddressingNote(addressing)` for the one-line
footer of the prompt's available-tools inventory (cache prefix). Tool names stay
canonical everywhere else (registry, executor, `tool_executions`). Addressing is
read from the provider object via `toolAddressingOf`, never by provider id:
grok-cli = meta-tool (verified on grok 1.0.40: MCP tools are reached via
`search_tool` → `use_tool {tool_name, tool_input}`); kimi-cli = mcp-server
(naming unverified); claude-code = mcp-prefix `mcp__eyas__` (declared by the
provider, I15); API providers = native.

#### Local runtimes

LM Studio sits on the shared OpenAI-compatible provider (standard function
calling, temperature / max tokens / stop sequences passed through, the client
timeout instead of a fixed 120 s cap, abort signal honoured). Ollama derives
`num_ctx` from `ModelRequest.contextWindow` (only above its 4096 default, the
next power of two, capped at the window) and `supportsTools` and its thinking
control from `/api/show` capabilities (F9, reasoning mapping table above); Stop
aborts the in-flight request on both. LM Studio gets no reasoning parameter; its
own reasoning setting is shown display-only.

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

**Deny-by-default public lista — ket pontos-ut kivetel.** A `/api/v1/internal/cli-mcp/tools/list` es a `/api/v1/internal/cli-mcp/tools/call` nem session-nel, hanem a CLI-MCP bridge fordulonkenti titkaval (`x-eyas-bridge-secret`) + loopback-ellenorzessel hitelesit (lasd §14 CLI-MCP bridge). Minden mas `/api/v1/internal/*` ut tovabbra is bejelentkezest ker.

**Delegalt bearer (J10).** `auth/delegated-bearer.ts` `registerDelegatedBearer(paths, verify)`: egy modul a sajat, pontosan megnevezett `/api/v1/` utjaira sajat bearer-kulcsot fogadtathat el (soha prefixet; egy utnak egy verifiere van; dobo verifier = elutasitas). Egyetlen hasznaloja az OpenCode memoria-plugin: a `POST /api/v1/opencode/memory/search` es `/memory/expand` egy egyszer hasznalhato, egy OpenCode-munkamenetre szolo bizonyitassal (a folyamat fd 3-on kapott kulcsaval keszult HMAC) user nelkul is atmegy a middleware-en (§8 OpenCode). A middleware csak ellenorzi a bizonyitast (`check`, nem hasznalja el); a route valtja be (`redeem`), igy egy bizonyitas pontosan egy hivasra jo. Minden mas bearer ugyanazon az uton a szokasos modon hitelesit.

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

### Leltar-szekciok: mit adunk fel eloszor

A `available-tools` es a `available-skills` szekcio **nem dokumentacio, hanem
leltar**: azt mondja meg, MI LETEZIK. A sema a szolgaltato sajat tool API-jan
erkezik, es ezt a szekcio zarosora ki is mondja.

Elo peldanyon merve, javitas elott: **56 tool = 13 586 karakter egy 2 000
karakteres kereten** → a modell **nyolcat** latott, a vagas pedig mondat kozepen
tortent, tehat a zarosor is elveszett. A prompt egyik fele olyan toolokra
hivatkozott, amiket a masik fele nem sorolt fel. Megfigyelheto kovetkezmeny: az
ugynok azt irta, hogy „a design tool mas neven lehet, keresem", megirta a lapot
a csatolt design nelkul, majd — miutan a design-indexbol kiszedte a palettat —
**megirta megegyszer**.

A `renderInventory` (`prompt-wizard/inventory.ts`) ezert **sorrendet** definial
arra, mit adunk fel:
1. leiras + nev, ha befer;
2. csak nevek (56 tool ≈ 1 000 karakter — a TELJES lista ugyanabban a keretben);
3. ha meg a nevek sem ferenek be, annyi nev, amennyi belefer, **plusz a
   kimaradtak szama** — egy leltar, ami elhalkul, teljesnek olvasodik.

A zarosor minden meretben marad.

**Amit ez lathatova tett:** 228 skill van, aminek a puszta neve is ~3 700
karakter az 1 600-as keret ellen. Eddig ez nemán le volt vagva; mostantol a
harmada nev szerint van, a tobbi megszamolva. Egy 228 elemu leltar egy
rendszer-promptban sajat problema — de mar lathato.

### Tartos memoria: index a promptban

A memoria rendszer 24 beszelgetes utan **ures** volt minden retegben, es a kor
mindket fele nyitva allt: semmi nem irt, es ha irt volna, semmi nem olvasta
volna vissza. A `cache-suffix-builder` `memory-context` szekcioja csak a 24 oras
munka-scratchpadot vitte, ami mindig ures; az epizodikus es a vault reteg
semmilyen uton nem jutott a promptba, csak a `search_memory` toolon at, amit a
modell 24 beszelgetesbol nullaszor hivott meg (`tool_executions` = 0).

**Az egyseg a tervezesi dontes.** Az epizodikus reteg ESEMENYT tarol („mi
tortent"), az pedig zajos: hatart es konszolidalo futast igenyel, hogy jelle
valjon — ezert kellene hozza egy beszelgetes-veg, ami nem letezik. A tartos
jegyzet ezzel szemben mar a keletkezesekor jel: ki a tulajdonos, hogyan kell
dolgozni, mik egy projekt megszoritasai. Nem kell hozza se hatar, se
konszolidacio.

- **Tar: a vault, valtozatlanul.** Markdown + frontmatter + `[[linkek]]` + FTS
  index + graf + watcher — mind megvolt. Ket uj frontmatter mezo: `kind`
  (`user|feedback|project|reference`) es `summary`; a `vault_index` ket uj
  oszlopot kap (`ALTER ... ADD COLUMN` try/catch-ben).
- **Felidezes: derivalt index** (`memory-index.ts`), soronkent egy jegyzet.
  Rangsor: `user` es `feedback` elol (ezek minden valasz elkesziteset
  befolyasoljak), utana `reference`. A `kind` nelkuli jegyzet `procedural/`
  alatt `feedback`, egyebkent `reference` — **soha nem `user`**: egy be nem
  sorolt jegyzetet a tulajdonosrol szolo tenynek nyilvanitani annyi, mint minden
  prompt elejere tenni. `summary` hianyaban a jegyzet elso valodi sora kerul be,
  tehat egy kezzel irt Obsidian-fajl EYAS-specifikus frontmatter nelkul is mukodik.
- **Fordulonkent, nem cache-prefix szekciokent.** A felidezesi blokk
  fordulonkenti, es (I4) mar nem is a system promptban el: a `<turn-context>`
  keretben, az aktualis user uzenethez csatolva megy ki (lasd lent, Tartos
  memoria: felidezes kezbesitese). A keret mar nem egy fix 8400/8800-as zsugoritas: a
  `budgetForWindow(window)` (`prompt-wizard/token-budget.ts`) minden nem-zarolt
  szekciot a modell ablakahoz skalaz — 100k-nal pontosan az alapertek,
  ≥250k-nal legfeljebb 2,5×, ~29k alatt pedig az egesz keret az ablak legfeljebb
  35%-a. Egy uj szekcio ezert csak a kis-ablakos aranyt valtoztatja meg (lasd
  §44 Kezbesitesi profil). A `design-context` ugyanezen az uton ment.
- **Keret: `memory.index.budgetChars`**, alap 2400 karakter (~600 token) a
  semaban es a `default.yaml`-ben egyarant — ez a 100k-s ablakhoz tartozo meret.
  Az erteket hivasonkent a `ctx.config`-bol olvassuk, ami indulaskor egyszer
  toltodik be, tehat a valtoztatas restartot igenyel. I4 ota ez a TELJES
  `<eyas-memory>` blokk kerete (keret-szoveggel egyutt), es a valaszolo modell
  ablakahoz skalazodik (prompt-wizard token-budget `memoryRecall`). A `memory-index.ts` `DUMP_STEM`-je a
  data-port elnevezesi konvencioit koveti: `memory-index-*` / `INDEX`,
  `system_prompt*` / `prompt_*` / `segment_*`, es a `project_*` / `feedback_*`
  tipusos jegyzet-prefixek — ezek soha nem allo referencia-jegyzetek.
- **Minden index-sor azonositot visel.** `buildMemoryIndex` a `paths` mellett
  `ids`-t is ad (`vt:<path>` vault jegyzethez, `gs:<id>` gisthez), a sor vegen
  kiirva; a `memory_expand` ezt nyitja meg. A gist-kitoltes tier-1 a D1-en
  belul: pinned, a projekt gyoker-gistje es legfeljebb 5 friss testver-task
  (projekt nelkul: mas projekt nelkuli beszelgetesek), a jelenlegi
  beszelgetes, mas projektek es a karanten sorok nelkul. A `vaultNoteInScope`
  minden kind-ra D1-et alkalmaz. Az `assemble` atadja a `conversationId`-t, es
  az index id-ket valtozatlanul logolja.
- **Nincs nema levagas:** a budgetbe nem ferő sorok szama ki van irva a blokk
  aljan, es egesz sorokat dobunk — fel osszefoglalo olyan zaj, amit a modellnek
  kellene kitalalnia.
- **A blokk kimondja, hogy nem utasitas.** Egy jegyzet torzse beszelgetesbol
  szarmazo szoveg, amit kesobb egy rendszer-promptba jatszunk vissza; ez
  kesleltetett prompt-injection csatorna, tehat a cimke biztonsagi kontroll.
- **Egy termelo, egy elhelyezes (I4/I5).** A korabbi ket bekotes (a hatter-ut
  kozvetlen `buildMemoryIndex`-e es a chat route lusta accessora) megszunt: az
  indexet a `ctx.memoryRecall` epiti a felidezesi blokk reszekent, es minden
  belepesi pont ugyanazt a blokkot csatolja (lasd lent).

**Talalat, amit erdemes rogziteni:** a deklaralt budget NEM a prompt valodi
merete. A `code-search-context` es a `working-directories` elo szekciok, amelyek
a `memoryContext` *szamat* kolcsonzik egy `as any` casten at anelkul, hogy mezot
deklaralnanak — a `totalBudget()` nem latja oket.

**Amit a felidezes egyedul nem tud:** ha semmi nem ir, akkor egy tokeletes
index is ures marad. Az extraktor — determinisztikus kapu + olcso modellhivas +
dedup — kulon fazis volt, es a kovetkezo szekcio az; a kezzel irt fajl a
manualis ut, valtozatlanul. A `save_memory` tool nyugdijazva: nem ir semmit, es
a master prompt memoria-szerzodese (§44) szerint az agensek soha nem irnak
memoriat.

### Tartos memoria: rogzites

A kor masik fele. **Minden beszelgetesre fut, globalisan, alapertelmezetten
bekapcsolva** (`memory.capture.enabled`); egy **kicsi modellhivas** kapcsolodik
a minosito fordulokhoz, MIUTAN a valasz mar eljutott a felhasznalohoz. Soha nem
a valasz kritikus utjan van, es egy elbukott rogzites egy hianyzo jegyzet, nem
egy elbukott beszelgetes: a `capture()` sajat try/catch-e nyeli el. Minden
futasi ut EGY belepesi ponton at hivja (K11): `memory/capture/run-end.ts`
`captureRunEnd` (fire-and-forget, soha nem dob, valaszszoveg nelkul nincs hivas
es nincs sor) → `ctx.memoryCapture`. Utak:
- interaktiv SSE-route: author `owner`, entryPath `interactive`;
- `conversation-runner`: `background`. Author: tarolt `<untrusted-input>`
  blokk → `peer`; a goal, vagy uzenet al-beszelgetesben → `agent`; egyebkent
  `owner`;
- `executeAgent`: delegation/pipeline → `agent`, A2A → `peer`; a feladta-
  reszvalaszt is rogziti;
- csapattag (orchestrator): `team`, `agent`;
- csatorna-valasz (`channel-run-agent`): `channel`, `peer`.

A `CaptureInput.author` es `entryPath` kotelezo; a `memory_capture_runs.entry_path`
oszlop rogziti az utat. Nem-owner szerzonel AUTHOR szekcio kerul az extraktor
promptjaba. Peer szerzonel:
- a kapu az `<untrusted-input>` torzset meri, nem a keretet; az extraktor
  klippeles utan ujra-keritve kapja;
- a sema elutasitja a `user`/`feedback` kindot (`candidate-schema`
  `allowOwnerKinds:false`);
- a jegyzet frontmatter `trust: peer`;
- a note-writer (`WriteScope.trust`) alacsonyabb bizalmu irassal soha nem
  erosit meg nala jobban bizott jegyzetet: kulon fajlt ir.

A sapka (`maxPerConversation`) beszelgetesenkenti marad; delegacio es
csapattag sajat al-beszelgetesben fut. Az extrakcios hivas a
`ctx.auxiliaryModel`-en megy (purpose `capture`; csak API provider vagy
izolaltan futni kepes CLI; nincs gateway fallback, §8). **God Mode:** a God Mode
workerek a `conversation-runner`-en at futnak es ott rogzitenek (worker-enkent
egy, `background`, `agent`); csak a szulo-fordulo sajat post-turn blokkja marad
ki, mert a God Mode ag sajat streammel visszater, mielott az lefutna.

**A kapu strukturalis, nem lexikalis.** Egyetlen hosszellenorzes: `minUserChars`
(alap 40), **Unicode kodpontokban** szamolva (`[...str].length`), tehat egy
ekezetes uzenet ugyanugy kapuzodik, mint egy azonos hosszu ASCII. Kulcsszolista
egyik nyelven sincs — a termek hat nyelven megy, es ez a projekt mar ketszer
fizetett pontosan ezert a hibaosztalyert (a JS `\b` ASCII-ra van definialva,
ezert `\bűrlap` soha nem talal az „Űrlapelemek"-re; a magyar tobbes nyujtja a to
maganhangzojat, ezert a „minta" nem prefixe a „mintak"-nak). Annak eldontese,
hogy egy mondat MIT JELENT, a modell fele, nem a kapue.

**Elszabadulas-vedelem:** `maxPerConversation` (alap 20), es ez **kizarolag a
modell-koltest** szamolja — sikeres extrakcio, `unparsable`, `rejected-shape`,
`poison_gate` valasz es `error` futas fogyaszt belole, `too-short`, `cap-reached`,
`no_eligible_model` es `budget_stop` nem (az utobbi kettonel modellhivas sem
tortenik). Husz rovid nyugtazas
(„ok", „mehet") kulonben elhasznalta volna a keretet egyetlen hivas nelkul, es a
kovetkezo tenygazdag fordulot mar visszautasitotta volna. Sor minden esetben
irodik; csak az valtozik, mire megy el a budget.

**A modell 0–2 jelolt jegyzetet ad vissza,** szigoru sema ellen
(`candidate-schema.ts`): `kind` a negy ertek egyike, cim-, osszefoglalo- es
torzshossz korlatozva. A `feedback` jelolt csak `why` + `howToApply` mezovel
ervenyes (ezek `**Why:**` / `**How to apply:**` sorkent kerulnek a fajlba); a
`project` kind pedig a `CANDIDATE_KINDS`-ban es a promptban MINDIG ott van, de
ha a beszelgetesnek nincs valodi projektje, a sema `refine`-ja **jegyzetenkent
visszautasitja** — egy projekt-teny projekt nelkul olyan fajl, amit semmi nem tud
elhelyezni. Mivel a refine egyetlen tomb-parse-on belul fut, **egy darab
teves `project` jelolt az EGESZ batch-et elbuktatja**: a batch eldobodik, es
`unparsable`-kent rogzul. Az ures batch (`{"notes":[]}`) a gyakori es helyes
valasz.

**Iras: dedup, sanitizalas, majd fajl.** A cimbol slug lesz
(`<mappa>/<slug>.md`). Ha az ut mar letezik, vagy egy cimre menő FTS-talalat
ugyanazt a jegyzetet jelenti (szohalmaz-atfedes ≥ 0,4, mert egy megerosites
altalaban atfogalmaz: „Magyarul valaszol" → „Mindig magyarul valaszol"), akkor
**frissites tortenik — datumozott bullet a `## History` ala, felulirni soha nem
irunk felul**. Ha a slug foglalt, de a tartalom mas teny, `-2`, `-3` … szabad
utra megy. A privacy modul a szoveget **lemezre iras elott** maszkolja
(`ctx.privacy.maskAtRest` — ugyanaz a fuggveny es ugyanazok a szabalyok, mint
az egress-nel: a datumok maradnak, a mask- es block-osztalyu ertekek `[TYPE]`
helyorzore cserelodnek, tehat egy IBAN `[IBAN]`-kent kerul a jegyzetbe), nem
olvasaskor: egy olvasas-ideju redakcio sem a fajlt, sem a belole epulo FTS
indexet nem erne el. A modul hianyaban a fuggveny identitas. Az extrakcios
hivas egy tavoli modell fele maga is maszkolt bemenetet kap (block-osztaly
maszkolva, datumok epen), igy egy IBAN-t emlito fordulo sem buktatja el a
rogzitest. Az izolalt extrakcios hivas soha nem esik at olyan CLI-re, ami nem
tud izolaltan futni — lasd §8 `canRunIsolated` es az auxiliary service.

**Model-written notes pass the instruction filter (J9).** Every candidate note
(title, summary, body, after privacy masking) passes `admitModelAuthoredText`
(`memory/v2/model-write-gate.ts`, the same `scanForInjection` as arbitrate).
Any hit (high, medium or low) refuses the write, because a vault note has no
gist fallback and no quarantine tier honoured by every reader. The run row then
gets `skipped_reason='poison_gate'` while `notes_written` / `kinds` keep
counting the notes that were written. The log names the detector, never the
text. A written note gets frontmatter `origin {by:'capture', provider, model,
conversationId}` (the first author is kept on reinforcement), which the indexer
turns into trust_tier 'derived'. The same gate applies to consolidation and
team-session promotion: the semantic promoter returns null on a refusal
(cluster kept, retried nightly) and writes `origin {by:'consolidation',
provider, model}`; the team-session promoter gates each finding/decision
separately and writes `origin {by:'team', conversationId}`. Project-scoped team
sessions that go to the client wiki are not yet gated (follow-up).

**Scoping — D1 es D2.**
- `feedback` → `procedural/`, `user` es `reference` → `semantic/`, `project` →
  `projects/<project-id>/`, es a frontmatterbe bekerul egy `project` mezo, ami
  **a rogzites pillanataban befagy** (egy kesobbi frissites szandekosan nem nyul
  hozza).
- **D1 — rangsor a promptban:** globalis `user` es `feedback` elol, utana az
  AKTIV projekt `project` jegyzetei, vegul `reference`. Mas projektek jegyzetei
  **soha nem jelennek meg**: a szures a `vault_index.project_id` es az aktiv
  projekt egyezesere megy, nem rangsor-buntetesre.
- **D2 — a seed gyujto-projekt (`general-general`) „nincs projekt".** Minden
  beszelgetes ebbe esik alapertelmezesben, tehat valodi projektnek venni annyi,
  mint a tulajdonosrol szolo altalanos tenyeket egy projekt ala rejteni. A
  szabaly **egyetlen FUGGVENYBEN** el — `effectiveProjectId()` —, es minden
  belepesi pont ezt hivja: a capture, mindket felidezesi ut es a memoria-toolok.
  Igy az iro es az olvaso fel nem mondhat mast arrol, mi szamit projektnek.

**Provenancia.** Minden rogzitett jegyzet feljegyzi, melyik beszelgetesbol
szuletett vagy melyik erositette meg: `memory_note_links (note_path,
owner_module, owner_id, source)` — ugyanaz a multi-owner minta, mint a
`design_links` / `document_links`, `INSERT OR IGNORE`-ral idempotensen. Az
epizodikus emlekek is kapnak `conversation_id` / `project_id` oszlopot.

**A meres, ami a talalgatast lezarja.** Minden kimenet, ami **eljutott a
kapuig**, ir egy sort a `memory_capture_runs` tablaba: a kihagyasok a sajat
okukkal (`too-short`, `cap-reached`, `unparsable`, `rejected-shape`,
`no_eligible_model`, `budget_stop`, `error`), az extrakciok a
kiirt jegyzetek szamaval es a `kinds` JSON-tombbel. A `provider` oszlop
`provider/model`, vagy `provider/route`, ha a valasz nem nevez meg modellt
(pl. `claude-code/isolated-cli`); egy elbukott vagy ures extrakcios hivas
`error` sort ir a megkiserelt providerrel. Ket hallgatas szandekos: a
kikapcsolt capture (`disabled`) egyaltalan nem ir sort, es egy hatter-futas,
aminek nincs olvashato asszisztens-szovege, el sem jut a kapuig — futasonkent
egy skip-sor csak felfujna azt a diagnosztikat, amit oszinten kellene tartania.
Ettol lesz a `minUserChars` **hangolhato, nem orok
tipp** (milyen gyakran tuzel a kapu?), a `kinds` eloszlas pedig az egyetlen ut,
amin a **felcimkezes** — egy projekt-teny `user`-kent elmentve — lathatova valik
anelkul, hogy valaki kezzel atolvasna a vaultot.

**A boot-sorrend hiba, amit ez talalt meg.** A `conversations` modul a sajat
`onStart`-jaban nezte meg a `ctx.memory`-t, a module loader viszont csak a
kemeny `dependencies` szerint rendez: a `conversations` MINDEN indulasnal a
`memory` elott indul, tehat a `ctx.memory` mindig `undefined` volt, es a
memoria-lifecycle hookok **68 rogzitett indulasi ciklusbol 0-szor** kotottek be.
A hookok mostantol hivas-idoben oldodnak fel
(`conversations/memory-hooks.ts`), ugyanazzal a lusta-accessor mintaval, ami a
szomszedos sorokban mar ott volt. (Tortenelmi megjegyzes: a PreCompact
osszefoglalok akkor jutottak volna az epizodikus memoriaba; the dead
PreCompact/`onContextCompact` receivers were removed in G7
(ConversationMemoryHooks, memory-hooks.ts, memory-lifecycle.ts); a compaction is
only a `contextCompacted` notice and writes nothing to memory.)

**L0 nyers reteg: `source_type` szotar es sema v2.** A `memory_raw.source_type`
szotara: `user_message`, `assistant_message`, `tool_result`, `document`,
`r6_sync`, `legacy_episodic`, `thinking`. Egyetlen helyen van definialva,
`RAW_SOURCE_TYPES`-kent (`src/modules/memory/v2/schema.ts`), es a
`RawSourceType` ebbol szarmazik. Szandekosan **nincs** `compaction` tipus: a
beszelgetes-tomorites osszefoglaloi nem kerulnek memoriaba.
`memory_meta.schema_version` = `'2'`. A v1 adatbazisokat boot-kor a
`migrateMemoryV2Schema` frissiti, amit a `memory/index.ts` `onRegister` hiv
kozvetlenul a `createMemoryV2Tables` utan: vedett, egyetlen tranzakcios
`memory_raw` ujraepites (explicit oszlopmasolas, a rid megmarad, az 5 index
ujraepul, a foreign key-ek BE maradnak), hiba eseten teljes rollback, log, es
ujraprobalas a kovetkezo indulaskor. Amig a tabla v1-en all, az ingest a
visszautasitott source type-u egysegeket enqueue-kor eldobja, egyetlen
figyelmeztetessel — a beszelgetes flush-a nem akad el. A `thinking` sorok
L0-only-k: a `runExtraction` soha nem tolti be oket (a watermark viszont
tovablep rajtuk; egy csupa-`thinking` batch `nothing_extractable` okkal
skip-elt futas), es a felidezes soha nem adhatja vissza oket. Ezeket a sorokat
az alapbol kikapcsolt `memory.l0.captureThinking` kapcsolo irja (csak audit,
J8, lent).

**`memory.engine` (J9).** It gates deterministic L1 extraction only: 'v2'
always extracts; 'legacy' extracts while `memory.l0.extractInLegacy` is on (the
default). Recall (standing recall, `memory_search` / `memory_expand`) is always
v2, whichever value is set.

**L0 trust from the author (J7).**
- `CaptureUnit.trustTier` is derived from the author, never from the role.
  `AddMessageInput.author` ('owner'|'agent'|'system'|'peer') and `entryPath`
  are forwarded to `captureConversationMessage` and not persisted.
  `trustForMessage` in `conversations/l0-capture.ts` gives: assistant→derived;
  user+owner→owner (only the interactive chat route, including God Mode);
  user+agent/system→derived (delegation, pipeline, handoff, prompt
  coach/enhancer); user+peer→peer (inbound channels, A2A tasks); user with no
  author→derived. meta_json records origin, messageId, provider, model,
  agentId, entryPath, author and godMode.
- Runs whose instruction is never stored as a message use `captureInstruction`:
  conversation-runner for the goal (entryPath 'background'), and the
  orchestrator via `ConversationService.captureInstruction` for each member
  brief ('team'). The unit is a derived user_message whose ULID is
  deterministic (time part 0, randomness = sha256(conversationId, entryPath,
  text)), so a retry is a no-op.

**Vault trust (J7).**
- `vault_index.trust_tier` (NULL = not derived yet; the indexer re-reads such
  rows once) is computed by `deriveVaultTrust` in `vault/vault-trust.ts`:
  frontmatter `origin`, the 'auto-consolidated' tag or a `memory_note_links`
  source='capture' row → derived, otherwise owner; frontmatter `trust` can only
  lower it (minTrust).
- The standing index and `memory_expand` vt: exclude quarantined notes.
- `migrate-imported` builds vault L0 units with the stored trust, project and
  project type (actor 'vault' for non-owner notes).
- `extractionScope` in `extractor.ts`: a source with no conversations row
  (vault:, legacy-episodic:) is extracted under the scope of its newest live L0
  row.
- One-shot `vault_provenance_v1` (`v2/reprovenance.ts`, called in the boot pass
  after the L0 migration): per note, in ONE transaction, it rewrites the L0
  rows' trust, project and type plus their memory_tag rows (never raising a
  quarantined row), tombstones the note's facts (task tag) and gists
  (is_current=0), and runs `runExtraction(…, 'rebuild')` inside a savepoint. It
  rolls back on failure. The key is set only when every note succeeded.

**L0 run capture (J8).**
- `memory/v2/run-capture.ts` `createRunCapture` is fed every AgentEvent by the
  runner. `agent-runner.ts` `run()` wraps the loop in `withRunCapture` when the
  run has a conversation; the capture comes from the
  `AgentRunnerDeps.startRunCapture` factory, wired in `agent/index.ts` to
  `createRunCapture({db: ctx.db, ...run})`, and `end()` runs in `finally`.
- It pairs `tool_use_start` with `tool_result` and emits one `tool_result` unit
  per call that ran (outcome success, error, or none): content JSON `{tool,
  output, isError, outcome, executedBy}` (the blob and the `memory_raw_fts`
  body, which is what extraction reads), trust `ingested`, actor
  `tool:<name>`, `rawName` in meta (this is what marks a bridged
  `mcp__eyas__*` call). The call's arguments (a JSON snapshot clipped to
  `RUN_CAPTURE_INPUT_MAX_CHARS` = 2,048 chars) sit in `memory_raw.meta_json.input`
  as provenance only; `meta_json` is never FTS-indexed, extracted or recalled,
  so arguments shape no topic, entity or fact. Refused, skipped,
  approval-waiting, empty and repeated calls are not captured;
  `toolResultMaxBytes` caps the content (what the call returned), not the
  arguments. `tool_result` stays in `NEVER_RECALLED_SOURCE_TYPES`; its output
  still feeds deterministic extraction.
- `thinking` deltas become one `thinking` unit per model call (derived).
- Units wait for their model call's `turn_complete`, which now carries the
  answering provider and model. An executor-run tool is stamped with the pair of
  the call that requested it; `end()` stamps the rest with the last answering
  pair, else the requested pair.
- The meta shape is `{origin:'agent_run', provider, model, agentId, entryPath,
  sessionId, turn, toolUseId, toolName, rawName?, durationMs, input?}`.
- The policy is process-global in `ingest-bridge.ts` (`setCapturePolicy` /
  `capturePolicy`, default off). `memory/index.ts` installs it from
  `memory.l0.captureToolResults` / `captureThinking`, read per call from
  `ctx.config` (loaded at start).
- The tool executor's log (`logExecution`) no longer captures anything
  (`tools/l0-capture.ts` is deleted). Tool calls outside agent runs are not
  captured.
- The LlmResponse event payload carries `response.provider` / `model` and
  `entryPath`. `AgentRunOptions.entryPath` is derived from `metadata.origin`
  when absent; `executeAgent` passes `a2a`. `event-store/l0-capture.ts` copies
  provider, model, agentId and entryPath into meta.

**Memory blocks retired (J9).** The Letta-style shared memory blocks
(`memory_block_read` / `_write`, `ctx.memoryBlocks`) are removed. The
`memory_blocks` table stays read-only. The one-shot `migrateBlocksIntoL0`
(memory_meta `blocks_migrated_v1`, boot IIFE after `migrateImportedIntoL0`)
copies each row into L0 as a 'document' unit: trust derived (quarantined if the
gate flags it), projectId null, pseudo-task `memory-block:<id>`, deterministic
legacyId, meta origin 'memory_block'.

### Owner quarantine (B10)

Owner-only action (`src/modules/memory/v2/quarantine.ts`, routes in
`memory/routes.ts` under `requirePermission('delete','MemoryEntry')`: `GET/POST
/api/v1/memory/quarantine`, `POST /api/v1/memory/quarantine/preview`, `POST
/api/v1/memory/quarantine/:id/release`; Zod body `{providers, from?, to?,
conversationIds?}`). The web card is on Memory → Overview.

- **Selection:** L0 rows of source_type `assistant_message` and `tool_result`
  whose provider matches. The provider is `COALESCE(meta_json.provider,
  conversations.provider_id)`. Optional `occurred_at` range and conversation
  ids.
- **Cascade:**
  1. the selected rows get trust_tier 'quarantined';
  2. capture notes of their conversations (`memory_note_links` source
     'capture') move to `<vault>/.quarantine/<logId>/<path>`; `removeStale()`
     then drops their vault_index rows, wikilinks and vectors, and their
     `vault:<path>` L0 rows are quarantined;
  3. facts with any source among those rows (`memory_fact_source`);
  4. gists through `memory_gist_source` up to 8 rounds (a fixed point in
     practice).
- Every tier change rewrites the 'trust_tier' memory_tag and bumps revision and
  HLC. Notes move first; the tier changes and the `memory_purge_log` row (reason
  'quarantine'; details = ids by prior tier plus moved notes) share one BEGIN
  IMMEDIATE transaction, and a failure undoes both.
- **Release** restores the prior tiers only on rows still 'quarantined', moves
  the notes back (to `<stem>-restored.md` with the capture links copied if the
  path is taken), re-indexes, and appends a 'quarantine_release' row.
  `memory_purge_log` stays append-only.
- Rows already quarantined are not recorded, so re-apply is a no-op and
  overlapping quarantines are independent. Recall already excludes
  'quarantined' everywhere (retrieve, expand, memory-index, L3), so no reader
  changed. Semantic consolidator notes are not traced.
- Audit: `memory.quarantine.apply` / `memory.quarantine.release` (module
  memory). This is the owner-initiated exception to the rule that "quarantine is
  a write-time decision only", which binds the consolidator only.

### Tartos memoria: felidezes kezbesitese (I4/I5)

A korabbi „kapcsolodo korabbi munka" blokk (`memory/related-work.ts`, a
`memory.relatedWork.*` kulcsok, a system prompthoz fuzott memory-index es
related-work szekcio, a `ctx.memoryIndex` / `ctx.relatedWork` accessorok) es a
`memory/context-builder-v2.ts` / `memory/search/context-builder.ts` torolve. A
korabbi munka mostantol a felidezesi blokkon belul erkezik. A
`conversation_fts` (L0 FTS a `conversation_messages` felett) es a
`search_memory` L0-lathatosaga valtozatlanul el.

**Recall delivery (I4).** One service, `ctx.memoryRecall`
(`src/modules/memory/v2/assemble.ts`: `createMemoryRecall` → `assembleRecall`),
composes the query via `recall-query.ts` (J6), resolves the D1 scope from the
conversation (fail closed) and renders one fenced `<eyas-memory>` block within
`memory.index.budgetChars` scaled by the model window (prompt-wizard
token-budget `memoryRecall`). Fill order: standing notes (`memory-index.ts`
lines, ids on each), retrieved one-liners (standing notes leave them up to
50%), expanded bodies (`<eyas-memory-item id source trust>`; 2 with
drill-down, 4 without). Tool names are rendered via `model/tool-addressing.ts`
`renderToolRef`. The prompt assembler (`prompt-wizard/assembler.ts`
`buildTurn`) wraps the clock (`shared/clock.ts` `formatNow` in
`i18n.timezone`) and the recall block in a `<turn-context>` frame:
`AssembledPrompt.turn`, sections zone "turn" (turn-time, memory-recall),
`delivery.recall {ids, retrieved, expanded, chars, budgetChars, turnId,
withheld?}`. Entry paths attach it to the last user message with
`assemble-system.ts` `attachTurnContext` (the stored message is not modified);
the system prompt carries neither memory nor time. Audience "external"
withholds recall. All untrusted text (channel input, recall, team notes) goes
through `shared/untrusted.ts` `fenceUntrusted`. `memory_access_log` gets one
row per injected id with its own token estimate and `rank_detail_json`.

**One producer, one placement (I5).**
1. The prompt assembler builds `AssembledPrompt.turn` (a `<turn-context>` frame
   with the clock + the `<eyas-memory>` block from `ctx.memoryRecall`).
2. Placement: the agent runner attaches it once before its loop
   (`AgentRunOptions.turn`, defaulting to `systemPrompt.turn`) with
   `attachTurnContext`; the chat route's no-runner fallback attaches it itself.
   Checkpoints store the history without it (`stripTurnContext`), and
   `resumeRun` strips a stale frame, so a resume gets a fresh block.
3. `assembler.buildTurnOnly` builds the turn when no agent resolves or
   assembly fails (`assembleSystemPrompt`, conversation-runner and orchestrator
   fallbacks).
4. Entry paths: chat route (turnText = message; `body.system` replaces only the
   system), conversation-runner (background, board bot, God Mode workers,
   retries/resumes; turnText = goal), `executeAgent` (specialists, delegation,
   pipelines; turnText = task; `opts.audience`), orchestrator members
   (turnText = goal), channel-run-agent (audience from the scope-only voice
   resolver, `createVoiceScopeResolver`), OpenCode (recall block sent as the
   session.prompt `system` field; drillDown true when the session is bound to
   the serve key, false on an attached server; budgetChars =
   `tokensToChars(budgetForWindow(window, {memoryRecallChars:
   memory.index.budgetChars}).memoryRecall)`, the same scaling as the
   assembler. The window is the chosen model's `limit` in OpenCode's own
   `GET /config/providers` (input, else context;
   `OpencodeModelInfo.contextWindow`). An unknown window (no model chosen,
   unlisted, no limit, list unreadable) = `BASELINE_WINDOW`, like
   `budgetWindowOf` on an unresolved profile. The list is read at most once
   per task (developer-agent `readCatalog`) and shared with the variant check;
   K10).
5. Audience policy: A2A → `executeAgent` audience 'external'. Channel voice
   scope 'external' (or unresolvable) → recall withheld; the turn carries the
   clock only.
6. The chat route adopts `agent/tool-scope.ts` (`resolveToolScope` /
   `scopedToolDefinitions` over the conversation's colleague, else the project
   default agent), §14.
7. Recorder: every path passes contextWindow/budgetTotalTokens via prompt-wizard
   `deliveryRecordFields`, stored as `context_compositions.delivery_json`
   (I12, §46).

### Tartos memoria: v2 felidezesi hatokor (D1) es drill-down

**Egyetlen hatokor-szabaly.** A `src/modules/memory/v2/d1.ts` az egyetlen
szabaly: egy `project` memory_tag nyer; kulonben egy `project_type` tag;
kulonben a sor globalis. A gist `scope_type` `'project'` / `'project_type'` +
`scope_id` ugyanigy ellenorzodik. Null projekt = csak globalis (fail closed).
Segedfuggvenyek: `ensurePartitionKey`, `partitionKeyForOwner`, `d1Keys`
(csak olvas), `d1TagFilterSql`, `d1GistScopeSql`, `ownerInD1`.

- A `memory_partition_key` mostantol ki van toltve: az `l3-embed` minden
  vektort a `partitionKeyForOwner(owner rid)` ala iktat.
- A `v2/l3-repartition.ts` egyszeri, batch-elt athelyezes a regi key-0
  vektorokra, a `memory_meta` `'l3_partition_v'='1'` kulccsal: a vec0 sort
  torli es ujra beszurja, mielott a `memory_embedding`-et frissitene; hiba eseten
  a meta beallitatlan marad, igy a kovetkezo boot ujraprobalja. A
  `memory/index.ts` a boot IIFE-ben, az L3 menet elott futtatja.
- retrieve: KNN a `d1Keys` felett; a hydrate `ownerInD1` szerint szur; az
  `ftsVault` es az `ftsRaw` ugyanezt a szabalyt alkalmazza a sajat
  `project_id` / `project_type_id` oszlopain.
- expand: minden ag D1-re zarva, es uj `en:` ag (entitas + legfeljebb 10 D1
  teny).
- A standing index (`buildMemoryIndex`) ugyanezt a szabalyt koveti (lasd fent,
  index a promptban). Vault jegyzet, ami `project:`-et deklaral, kind-tol
  fuggetlenul ahhoz a projekthez tartozik; csak `projectType:` → csak az adott
  tipusu projektekben lathato; egyik sem → globalis.

**Drill-down toolok** (`tools/builtin/memory-tools.ts`: `memory_search`,
`memory_expand`, `search_memory` alias, `save_memory` nyugdijazva). A hatokort
a szerver oldja fel, a `findConversationScope` (`v2/scope.ts`) a beszelgetes
sorabol: sajat projekt, annak tipusa, globalis. A modelltol, CLI-tol vagy
bridge-tol jovo projectId / `scope` figyelmen kivul marad. Ismeretlen
beszelgetes fail closed (`memory scope unresolved`, nincs talalat). Kulso
szereplo (`actor.kind === 'external'`, a sajat MCP szerver kliensei) csak
globalisat lat. Egy beszelgetes nelkuli in-process hivo megtartja azt a
projectId-t, amit az EYAS maga tett a kontextusra.

**Keret: 3 hivas / `ToolContext.turnId`.** Az agent-runner minden exec
kontextusra `turnId = metadata.compositionId ?? generateId()`-t es
`runId = sessionId`-t pecsetel, a `ModelRequestMetadata`-ra pedig
`turnId` / `projectId` / `runId`-t — ez taplalja a CLI-MCP bridge
`BridgeBinding`-jat es (I15) a Claude Code in-process bridge `ToolContext`-jet
(§14). `turnId` nelkul a limit 3 / 90 s, `ext:<conversationId|anon>`
kulccsal (kulso MCP kliensek). A bejegyzesek 1 ora utan torlodnek.
(I12) The composition id is the recall's turn id, so `memory_access_log`
inject rows (written by recall) and `drilldown_read` rows (written by
`memory-tools.ts` with `rank_detail_json {turnId = composition id, call = the
call's number in the turn}`) join on one id; the context inspector's drill-down
line reads them. `tests/modules/memory/delivery-parity.test.ts` checks tool-path
parity for the native executor, the Claude Code in-process bridge and the ACP
bridge route.

**`tool_executions.run_id`.** Additiv oszlop (`tools/execution-log.ts`:
`ensureToolExecutionsTable` / `recordToolExecution`), a `ToolContext.runId`-bol
irva; minden vegrehajtott toolhivas rogziti a felugyelt futast, amihez tartozik.

**Hol nevezodnek meg a toolok.** A promptban a toolneveket a host szerinti
formaban irjuk (`model/tool-addressing.ts`, §8 Tool addressing); a registry, az
executor es a `tool_executions` kanonikus neveket hasznal.

**Felidezesi lekerdezes (J6).** A `v2/recall-query.ts` `buildRecallQuery(db,
{conversationId, turnText})` modellhivas nelkul epiti a lekerdezest (spec §7).
Reszei: a turn szovege (kulonben az utolso tarolt user uzenet), az elozo
eltero user turn (≤ 400 karakter), a cim (≤ 120, placeholder nelkul) es a
goal_description (≤ 400). Egy korabbi reszben mar benne levo resz kiesik.
Osszesen ≤ 1200 karakter, a turn szovege elol, es csak a sajat beszelgetes
sorait olvassa. A `ctx.memoryRecall` ebbol epit; a hivok csak a turn szoveget
adjak at (vagy ''-t). Nyelv: a `v2/language.ts` `resolveQueryLanguage(db,
text, conversationId?)` sorrendje `detectLanguage`, kulonben a beszelgetes
dominans L0 `language` tagje (az utolso 200 user/assistant sor, az 'und' nem
szavaz, holtversenyben a legutobbi), kulonben `'multi'`. A `retrieve()` ezt
hasznalja, ha nem kap `language`-et; a beszelgetes az `excludeConversationId`.
A `tokenize.isStopWord(token, 'multi')` minden stop-listat nez. Beegetett 'en'
alapertelmezes nincs tobbe.

**Recall ranking (J4).** `v2/retrieve.ts`:
- `ftsRaw` reads each matching L0 row's own zstd-decoded text (one LEFT JOIN on
  memory_blob; an unreadable row is skipped), plus trust_tier, occurred_at,
  project_id and bm25. It excludes trust 'quarantined', source_type 'thinking'
  and 'tool_result' (`NEVER_RECALLED_SOURCE_TYPES`) and `shred_partition_id
  LIKE 'vault:%'`. There
  is no memory_gist join.
- `ftsVault` reads bm25, the stored trust_tier (NULL → owner), indexed_at and
  project_id, and excludes quarantined notes.
- `mergeLexical` merges the two lists by per-list min-max-normalised bm25.
- `gatedFuse` runs the ≥2-stem gate on each hit's own text (raw: its first
  `RAW_FTS_CLIP_CHARS`; vault: path/title/summary/body head, with early exit at
  2 stems). It then does weighted RRF (k=60) with competition ranks, so ties
  share a rank.
- `rerank()` scores the whole fused pool before the limit: relevance = fused
  score min-max over the pool; score = (0.35·relevance +
  0.20·exp(−λ·ageDays) + 0.20·importance + 0.10·tagMatch) × TRUST_MULT[stored
  tier]. λ per day: fact 1/30, raw 1/90, gist/vault/entity 1/365; pinned gists
  never decay. tagMatch: task tag = asking conversation 1.0, project 0.5. Trust
  0 rows are dropped.
- An rw: hit's text is `snippetAround(rowText, stems, 280)`, cut only for the
  kept hits.

`expand.ts` rw: returns the row's own text (excerptBody 8000), refuses
quarantined, thinking and tool_result rows, and adds the task gist to metadata only when it
is current, not quarantined, in D1 and not secret-derived. The legacy layered
search (`memory-service.ts ftsLayered`) applies the same raw-row rules.

**Secrets marker (J5).** Egy `contains-secrets` cimkeju tartalombol rogzitett
nyers sor (vault jegyzet a `vault_index` tagjei vagy a frontmatterje alapjan,
epizodikus sor a tagjei alapjan) `memory_tag (kind, contains-secrets)`-et
visel; az L0 ingest a `CaptureUnit.secrets`-bol irja. Az arbitracio egy tenyt
vagy gistet megjelol, ha BARMELY forrasa jelolt, tartalom-hash dedup linket is
beleertve. A `v2/secrets-backfill.ts` a marker elotti sorokat jeloli meg a
`memory_fact_source` es `memory_gist_source` tablakon at, a `memory_meta`
`'secrets_tag_v1'` kulccsal (a jelolt forrashalmaz ujjlenyomata), es csak
hozzaad. A szabaly a `v2/d1.ts`-ben el a D1 hatokor mellett: `SECRETS_TAG`,
`SECRETS_TAG_TYPE`, `secretsFilterSql(ridExpr, includeSecrets)` es
`markSecrets`. Minden olvaso, ami memoriat ad a modellnek, alkalmazza a szurot,
hacsak a `memory.recall.includeSecrets` nincs bekapcsolva: retrieve (FTS raw, a
joinolt task gist, hydrate, es a KNN a MATCH mellett), `memory_expand`
(gs/ft/rw es egy en: kibontas tenylistaja), a standing-index gistek, az L3
beagyazas es a memory-service reteges legacy keresese. Az entitasok nincsenek
jelolve, mert kozos nevek.

### Tartos memoria: v2 L3 beagyazas (J3)

- A felidezes (L3 vektorok + a lekerdezes-oldali KNN) mindig a helyi
  beagyazot hasznalja: multilingual-e5-small, ha a sulyok betoltodnek
  (`data/models`), kulonben a `stem5-fnv-384` hash-beagyazot. Ez minden
  telepitesen igy van, barmelyik chat provider valaszol. A valasztast a
  `memory/embeddings/select-bridges.ts` vegzi. A `ctx.embeddingBridge` mindig ez
  a helyi bridge, es csak a v2 felidezes olvassa.
- Az 'embedding' routing tier csak a legacy vault/episodic indexet (vault_vec,
  episodic_vec) tapolja, es csak ha a megnevezett provider maga tud beagyazni
  (`model-bridge.ts` canEmbed). A modell-azonositoja `gateway:<provider>/<model>`.
- `v2/l3-worker.ts` createL3EmbedWorker:
  - minden L0 flush (`ingest.onFlushed`, az extrakcios listener utan) es a boot
    menet `kick()`-et hiv (500 ms debounce, max 5 s);
  - egyszerre egy drain fut, es sosem a hivo stackjen, igy sosem hivo
    tranzakciojaban;
  - a drain `embedLayeredBatch`-et futtat, amig van mit beagyazni, majd
    `retireDeadEmbeddings`, majd `capLiveIndex`;
  - a `status()` szamlaloi a `ctx.memoryL3Worker`-en erhetok el (J13);
  - az `onStop` a vegso flush elott allitja le.
- `retireDeadEmbeddings` (l3-embed.ts) torli a vektort a vec0-bol, a
  memory_embedding-bol es a memory_item-bol, ha a tulajdonos: nem aktualis vagy
  tombstone-olt gist; valid_until-os vagy tombstone-olt teny; tombstone-olt
  entitas; karanten; hianyzo; vagy, ha az includeSecrets ki van kapcsolva,
  contains-secrets jelolesu. Ez az `embedLayeredBatch` szelekciojanak
  komplementere.
- `wipeForeignModelEmbeddings` csak a memory_embedding-et es a torolt sorok
  vec0 bejegyzeseit erinti. A legacy index reset a
  `memory/embeddings/legacy-model-swap.ts`-ben van, a memory_meta
  `'legacy_embed_model'` kulccsal: az elso start csak rogzit; modellvaltaskor
  nullazza az embedding_hash-t, eldobja a vault_vec/episodic_vec tablat es
  torli a vec_meta-t, a createVecStore elott.
- `eyas doctor`: uj 'Memory embedder' ellenorzes (e5 sulyok megvannak, vagy
  hash fallback es javaslat), §6.8.

### Tartos memoria: felidezesi motor es a v2 iras-ut (J14)

One recall engine serves every model, whichever provider answers. The pieces
are documented above; this is the map.

- **Scope:** D1 partitions (`v2/d1.ts`) are populated when a vector is written,
  and the server resolves the project lock from the conversation row for every
  reader and every memory tool (Tartos memoria: v2 felidezesi hatokor).
- **Vectors:** always the local L3 embedder (e5, else the hash fallback); the
  incremental worker embeds about 0.5 s after each flush and retires dead
  vectors (J3).
- **Ranking:** relevance first, then per-kind recency, importance, the
  same-task/project bonus and the stored trust multiplier (Recall ranking,
  J4).
- **Trust:** derived from the author, never inherited upward; vault notes carry
  their own tier (J7). `contains-secrets` propagates from L0 to facts, gists
  and L3 (J5).
- **Write path:** run capture through the normalized `tool_result` (J8;
  arguments only in `meta_json.input`), model-written notes through the
  instruction filter (J9), recall delivered by `ctx.memoryRecall` (I4/I5).
- **OpenCode parity (J10):** OpenCode's plugin calls the same registered
  `memory_search` / `memory_expand` through `ToolExecutor.execute`, with the
  scope taken from an in-process session binding and a per-process rotated
  bearer (§8 OpenCode, §10). Its tool and terminal output is captured only
  under `capturePolicy().toolResults`.
- **Engine status (J13).** `GET /api/v1/memory/engine`
  (`requirePermission('read','MemoryEntry')`; `v2/engine-status.ts`
  `readMemoryEngineStatus`) is rendered read-only by the Memory page's Recall
  engine card. It returns: the L3/query embedder (model id; e5 or hash); L3
  coverage for gists and facts, where the total is exactly the set the L3 pass
  embeds (`embeddableGistWhere` / `embeddableFactWhere` in `l3-embed.ts`:
  current, live, not quarantined, the secrets rule) and embedded means a
  `memory_embedding` row under the current `model_id`; the L3 worker's
  `lastRunAt`; the D1 partitions that hold live vectors; the effective L0
  capture switches (off unless the ingest was wired this boot and
  `memory.l0.enabled`); `memory.recall.includeSecrets` and
  `memory.index.budgetChars`. Counts and flags only, never content.

### Vault struktura

A vault helye mindig `<data dir>/vault/` (`InstancePaths.vaultDir =
join(dataDir, 'vault')`): koveti az `EYAS_DATA_DIR`-t, es ez az egyetlen
vault-hely — sajat utvonal-beallitasa nincs (a hatastalan `memory.vault.path`
kulcs torolve). A memory modul egyetlen feloldott `vaultDir`-t ad at a vault
service-nek es a chokidar watchernek, es `memoryService.vaultPath`-kent
publikalja mas moduloknak (a Data Port undo nyers olvasojanak). A watcher a
dot-bejegyzeseket csak a vaulton belul hagyja figyelmen kivul, igy egy rejtett
mappa alatti vault is figyelve marad. Migracio: egy regi `<home>/data/vault`
egyszer atmasolodik (soha nem mozgatodik) a `vaultDir`-be, de csak amig a
`vaultDir` egyetlen `.md` jegyzetet sem tartalmaz; a masolas a
`<dataDir>/.vault-legacy-copy` staging mappan at megy, meglevo fajlt soha nem
ir felul, hiba eseten a kovetkezo indulaskor ujraprobalja
(`memory/vault/legacy-location.ts`). Ha mindket mappa tartalmaz jegyzetet, nincs
masolas es nincs merge: csak a `vaultDir` hasznalt, es minden indulas
figyelmeztet. Az allapotot az `eyas doctor` Vault sora jelenti (§6.8).

```
<data dir>/vault/                     # Markdown tudasbazis (git-tracked opcionalis); alap: <home>/data/vault
|-- semantic/                         # Tudas jegyzetek
|   |-- typescript-patterns.md        # [[react-hooks]] [[zod-validation]]
|   |-- kubernetes-networking.md
|   +-- odoo-workflow-engine.md
|-- procedural/                       # Receptek, "hogyan" guide-ok
|   |-- deploy-to-oke.md
|   |-- debug-sqlite-locks.md
|   +-- odoo-module-creation.md
|-- projects/                         # Projekt-specifikus tudas, <project-id> szerint
|   +-- <project-id>/                 # a beszelgetes EFFEKTIV projektje (a seed
|       |-- architecture-decisions.md #   'general-general' NEM az, lasd D2)
|       +-- known-issues.md           #   frontmatter: kind: project, project: <project-id>
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

Provenance fields beside `kind` / `summary` / `project`: `source` (the data-port
importer's record), `origin` (a model-written note: `by` capture |
consolidation | team, provider, model, conversationId; makes the note
'derived'), `trust` (can only lower the derived tier) and `enriched_by`
(`{provider, model?, route}`, route = tier | default | api | isolated-cli; set
by the data-port importer on notes whose metadata the background model enriched
(B11); read back by `parseVaultFile` so rewrites keep it; it does not change the
derived trust tier).

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

A v2 felidezes mindig helyi beagyazot hasznal (J3, lasd fent). Az 'embedding'
routing tier csak a legacy vault/episodic indexet tapolja. Fallback: FTS-only.

### Context builder

Megszunt (I4): a relevans emlekeket a `ctx.memoryRecall` epiti, es a
`<turn-context>` keretben az aktualis user uzenethez csatolva kerulnek a
modellhez, nem a system promptba (lasd Tartos memoria: felidezes kezbesitese).

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
  provider              TEXT,  -- H4: the model's provider (pair with model); NULL = resolved at run time
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

### MCP Tool Bridge (DONE)

A Claude Code SDK sajat agentic loop-ot futtat, kikeruljve az EYAS tool rendszeret.
Megoldas: EYAS tool-okat MCP szerveren keresztul injektaljuk az SDK-ba `createSdkMcpServer()`
segitsegevel (`model/submodules/claude-code/mcp-bridge.ts`, szerver neve `eyas`, a modell
`mcp__eyas__<nev>` alakban latja). Igy az SDK használja az EYAS tool-okat (delegation, team, memory) es minden
EYAS UI komponens (SubConversationTree, TeamDashboard) automatikusan mukodik.

Design spec: `docs/superpowers/specs/2026-04-14-mcp-tool-bridge.md`

**Claude Code in-process bridge (I15).** The bridged `ToolContext` is built
from `ModelRequest.metadata` only (conversationId omitted when absent, never
''; projectId, turnId and runId carried), so memory drill-down counts 3 calls
per answer and is project-locked, and tool executions are attributed to the
run. Its working directories are `resolveCliRoots(request, cwd)` (§8), so
bridged EYAS tools run there. Bridged tools = `selectBridgeTools` of the
request's tool scope (`tools/cli-exposure.ts`, H9/K3, below): every scoped tool
except those in `HOST_NATIVE_TOOL_NAMES` (run_command, read_file, write_file,
edit_file, grep, glob, git_status, git_diff) whose covering native capability
the turn grants — they are not bridged while the CLI's own equivalent is
granted (git_status on a list without run_command is bridged); the EYAS
browser_*, agent_browser_*, browser_use_* and opencode_* tools are bridged. The turn's model binding (H4, `ToolContext.modelBinding`) is carried
on it, so a bridged delegation stores the delegating turn's pair. The provider
declares
`toolAddressing {kind:'mcp-prefix', prefix:'mcp__eyas__'}`, which prompt
rendering reads through `tool-addressing.ts`. Claude Code's native subagents
are never offered (§8, one specialist mechanism): delegation always goes
through `run_specialist` on this bridge.

#### CLI-MCP bridge (Grok/Kimi ACP)

Az ACP providerek egy `eyas` stdio MCP szervert adnak at a `session/new`
`mcpServers` mezojeben (`src/modules/model/cli-mcp/stdio-mcp-server.ts`,
`process.execPath` + modul-relativ ut; a build `dist/stdio-mcp-server.js`-t is
kiad, igy a Docker image is tartalmazza; az `EYAS_INSTALL_ROOT` mar nem kell a
megtalalasahoz). A `tools/list` es `tools/call` hivasokat a
`GET/POST /api/v1/internal/cli-mcp/tools/{list,call}`-ra proxyzza
(`bridge-routes.ts`, a tools modul mountolja). A szerver MCP `instructions`-e
kimondja, hogy az EYAS memoria az egyetlen memoria, es a `memory_search` /
`memory_expand` innen jon.

- **Auth:** fordulonkenti 192 bites CSPRNG titok (`x-eyas-bridge-secret`), amit
  a provider bocsat ki, szerver oldali `BridgeBinding`-gel
  {conversationId, agentId, teamSessionId, userId, projectId, turnId, runId,
  origin, autonomous, idempotencyLedger}. Az `autonomous` =
  `isAutonomousRequest(metadata)` a titok kiadasakor kiertekelve (hianyzo =
  autonom, fail-closed); az `idempotencyLedger` a `metadata.idempotencyLedger`
  masolata (K12).
  A provider `finally`-je visszavonja, TTL 2 ora az utolso hasznalat ota
  (csuszo, G8); plusz loopback-ellenorzes az
  `X-Forwarded-For` / `X-Real-IP` / `Forwarded` fejleceken. A ket ut
  pontos-ut kivetel a session-auth alol (§10); minden mas internal ut
  bejelentkezest ker.
- **Identitas a szerveren:** a `ToolContext` kizarolag a bindingbol epul (a
  request-body `context` figyelmen kivul marad, az `EYAS_MCP_TOOL_CONTEXT` env
  megszunt). Jovahagyasi paritas (K12): a host CLI MCP-toolhoz nem ker
  engedelyt (grok 1.0.40 mcp-dispatch), ezert minden `tools/call` eloszor a
  toolset-ellenorzesen megy at (`toolsetDenial`, a gate elott, igy nem
  keletkezik approval), majd a kozos permission bridge-en
  (`createPermissionBridge`, ugyanaz, mint a Claude Code `canUseTool`-ja) a
  binding `autonomous`, `runId`, `workingDirectories` es `idempotencyLedger`
  mezoivel. Az executor ezutan `securityPipelineHandled: true`-val futtatja (a
  CASL es a toolset marad). A `registerCliMcpBridgeRoutes` kotelezo
  `getSecurityGate` fuggoseget kap (tools modul: lusta `ctx.securityGate`); gate
  nelkul minden hivas elutasitva (fail-closed). A `BridgeBinding` az egyetlen
  tulajdonosi rekord: (H9)
  `toolScope`-ot is visel (a grok-cli es kimi-cli provider bocsatja ki a
  `requestToolScope(request)`-bol); a `tools/list` a scope `selectBridgeTools`-at
  adja, a `tools/call` pontosan ezzel a halmazzal fut `ToolContext.allowedTools`-
  kent, igy az executor minden mast elutasit, es a G3 `onToolOutcome` 'denied'-kent
  jelenti. (H4) `modelBinding`-et is visel (a delegalo fordulo parja). (D5) A
  valasz szerializalasa a `ToolExecutor.renderForModel` (§40), a korabbi
  bridge-sajat `maskMemoryOutput` / `getPrivacy` torolve. A kategoria-alapu
  `EXCLUDED_CATEGORIES` szurok megszuntek.
- **Munkamappak (B2):** a Grok/Kimi a working foldert a bridge felallitasa
  elott oldja fel, es a turn mappait (cwd-vel) szerver oldalon a
  `BridgeBinding.workingDirectories`-be koti; a keres torzse soha nem nevezheti
  meg a sajatjat. Az agent-runner minden beszelgetes-mappat kuld, nem csak az
  elsot.
- **Kimenet-visszajelzes (G3):** a `BridgeBinding.onToolOutcome`
  (`cli-mcp/bridge-routes.ts`) a permission bridge `onDecision`-jebol hivodik
  (denied / approval_required approvalId-vel / skipped), illetve az executor
  `DENIED`-jebol (CASL, toolset). A bridge mar nem hasznalja az executor
  `APPROVAL_REQUIRED` agat; azt az agent-runner es a kulso MCP ut hasznalja
  tovabb.
- **Resume-ledger Grokon (K12):** az acp-stream a `use_tool` altal hivott EYAS
  tool soranak inputjakent a `tool_input`-ot rogziti (amit a bridge kap), nem a
  grok-wrappert, igy a resume ledger-kulcsa (`toolLedgerKey`) egyezik a
  bridge-en ujra latott hivassal.
- **Boot self-test:** a bootstrap a `startAll` utan futtatja a
  `checkCliMcpBridge`-et a teljes middleware-stacken at, es `ctx.cliMcpBridge`-kent
  publikalja: {healthy, error?, toolCount?, deferred?, checkedAt}. Hiba eseten
  warn log (a Grok/Kimi fordulok EYAS toolok nelkul futnak), befejezetlen setup
  alatt a teszt elhalasztva (`deferred`). A kezbesitesi profil (§44) a bridge-elt
  cimzesu providereknel ebbol dont a `drillDown`-rol.

### Tool scope (`src/modules/agent/tool-scope.ts`) (I3/I5/I15)

- There is a single resolver. `resolveToolScope({agentTools?, orchestration?})`
  returns `{include?, exclude}`. `include` is undefined (all tools) when the
  agent list is empty, absent or only blanks; otherwise it is the deduped list
  ∪ `PLATFORM_MANDATORY_TOOLS` (= `MEMORY_ALWAYS_ON_TOOLS` from
  `tools/builtin/memory-tools.ts`: memory_search, memory_expand; read-only). `exclude` is `DELEGATION_TOOLS`
  (run_specialist, delegate_to_agent, handoff_to_colleague, propose_team) when
  orchestration === 'solo'; assign_task is not excluded.
- `scopeAllows(scope, name)` and `scopedToolDefinitions(registry, scope)` apply
  it.
- Consumers: `executeAgent` (scoped by the child conversation's mode),
  conversation-runner (`conv.orchestration`), orchestrator team members (the
  member's child conversation, which is auto),
  `communication/channel-run-agent` (`conv.orchestration`), the chat route
  (the conversation's colleague, else the project default agent; I5), the
  Claude Code in-process bridge (I15), and the prompt-wizard tool inventory
  (`prompt-wizard/tools-section.ts` `resolveToolInventory`;
  `AssemblerDeps.resolveToolsFor(agentId, conversationId?)`).
- `requestToolScope` reads that scope back from a provider request: its tool
  names, or no allowlist when it names none, with the Solo exclusions.
  `scopedToolDefinitions` logs a warning once per agent and name for allowlist
  names that are not registered (they are dropped).
- **Executor enforcement (H9).** `ToolContext.allowedTools` is checked in
  tool-executor `authorize()`, after CASL and before the
  `securityPipelineHandled` shortcut, via the exported `toolsetDenial()`
  ("'<tool>' is not in this agent's toolset"). The agent runner sets
  `allowedTools` to `toolContext.allowedTools`, else the names in
  `options.tools`, and also refuses an out-of-toolset tool_use before the gate
  and approvals.
- **One exposure rule (H9).** `src/modules/tools/cli-exposure.ts`
  `selectBridgeTools(tools, allowed, native)` excludes by name (not by
  category, because a category mixes host-native tools with tools only EYAS
  has) each `HOST_NATIVE_TOOL_NAMES` tool whose covering capability is in
  `native` (default: every capability): an EYAS tool is withheld only while
  the CLI's own equivalent is granted. Used by the Claude Code in-process
  bridge (provider.ts), the CLI-MCP tools/list and tools/call routes
  (bridge-routes.ts) and the prompt tool list for any tool addressing other
  than native (prompt-wizard/assembler.ts), each with the turn's
  `nativeCapabilitiesFor(scope)`.
- **Native capability grants (K3).** `tools/cli-exposure.ts` holds one table,
  `CLI_NATIVE_CAPABILITIES`, with the rows read | write | shell | web. Each
  row lists `grantedBy` (the EYAS tools that grant it; read is always
  granted), `covers` (the EYAS tools the CLI's built-ins
  replace: read → read_file/grep/glob, write → write_file/edit_file, shell →
  run_command/git_status/git_diff, web → none), the Claude Code built-ins
  (Read/Glob/Grep; Write/Edit/NotebookEdit; Bash; WebFetch/WebSearch), the ACP
  kinds and Grok's own tool names. grantedBy: write ← write_file | edit_file;
  shell ← run_command (git_status/git_diff never grant it); web ← research |
  browser_navigate | agent_browser_run | browser_use_exec.
  `agent/tool-scope.ts` `nativeCapabilitiesFor(scope)` turns a turn's tool
  scope (`requestToolScope` of the request) into the granted set; no allowlist
  grants everything. Consumers: the Claude Code provider (the query's `tools`
  list holds the granted built-ins, the rest go to `disallowedTools`;
  `claudeCodeBuiltins` replaces the old `SDK_BUILTIN_TOOLS` constant);
  `acp-governance` (a permission request needing an ungranted capability is
  refused before the gate — see §8 ACP CLI isolation; a client-fs write needs
  write); and `selectBridgeTools` on both bridges and in the prompt inventory.
  ACP mapping: execute/delete → shell, edit/move → write, fetch → web,
  read/search → read. Kimi's native search/fetch never ask EYAS, so web cannot
  be withheld from Kimi per agent (the isolation tripwire still stops such a
  turn).

### Persona import ledger (A12)

`agent.importRoots` uses the same root selection as skills
(`selectImportRoots`, §15). `importPersonasFromDirectory` writes through a
ledger (table `agent_persona_imports`: agent_id, source_path, file_hash,
row_hash, imported_at). Create → record. Update only while the row's imported
fields (name, role, description, systemPrompt, tools) still hash to row_hash.
A missing row with a record means deleted in EYAS: not re-created. An existing
row without a record is never overwritten; it is adopted if identical. The
first file to import an id owns it until that file disappears. The DB row
stays the source of truth (personas are UI-managed). Agent `PATCH` validates
with a Zod partial schema (unknown keys stripped, bad values 400, unknown agent
404; effort checked per E3, §8).

### Agent runner: outcomes, provider-executed tools, resume ledger (G5)

1. **Single outcome normalizer.** `createAgentRunner().run()` yields exactly one
   terminal: `done{response, outcome: RunOutcome, stopReason}` | `cancelled` |
   `parked_for_approval`, or it throws. `RunOutcome`
   (`src/modules/agent/run-outcome.ts`) = completed | max_turns | max_tokens |
   refusal | tool_budget, from the last stopReason, the EYAS loop cap or the
   tool budget. A gateway 'error' frame becomes the single throw. Consumers read
   `done.outcome`: `supervisorOutcomeOf` maps it to the agent_sessions status
   max_turns / tool_budget.
2. `tool_result` follows the G1 contract: outcome and executedBy. The runner
   emits `approval_required` for a call left waiting on a human.
3. **Provider-executed tools.** A tool_use_start + tool_result pair seen inside
   one gateway.stream call is recorded as ToolCall/ToolResult events with the
   canonical toolName, rawName, executedBy, and `argHash =
   toolArgHash(normalized input)`. For executedBy 'provider', the runner also
   calls `deps.recordExternalToolExecution` (below). Such a turn and
   every CLI park force a checkpoint: `meta.modelMessages` = history + answer
   text, `meta.providerExecuted = true`.
4. **Do-not-repeat ledger.** Keys are `toolLedgerKey(name, input)` =
   canonicalToolName + argHash(normalizeToolInput(input)), in
   `src/shared/arg-hash.ts`. `resumeRun` builds the ledger from successful
   ToolResult events across the run lineage. The runner enforces it for its own
   executor, and forwards it as `ModelRequestMetadata.idempotencyLedger` (never
   serialized). The CLI permission bridge (`PermissionBridgeDeps.ledger`) turns
   a gate allow into a refusal on a hit. `PermissionBridgeDeps.onDecision(
   BridgeDecision {toolUseId, toolName, outcome: denied|approval_required|skipped,
   reason, approvalId?})` fires once per refused call. The event-store
   ToolCall/ToolResult payloads accept executedBy ('eyas'|'provider') and
   rawName.
5. **Provider-executed tool recording (G12).** The runner reports each
   `tool_result` with executedBy 'provider' to `recordExternalToolExecution`;
   `agent/index.ts` wires it to `ToolExecutor.recordExternal`, which writes one
   `tool_executions` row (canonical name, input, output or error text,
   duration, conversation, agent, `run_id`) only for executedBy 'provider'. It
   never executes, authorizes, runs hooks or emits `tools:executed`, and never
   captures into L0 (`memory/v2/run-capture.ts` owns L0 capture, §13). Bridged
   EYAS tools are logged once, by the executor itself. These rows are tool
   evidence for the critic's grounding check (below) and for the self-learning
   and efficiency reports.

The terminal vocabulary (`TOOL_OUTCOMES`, `TURN_OUTCOMES`) is defined once in
`src/shared/chat-stream.ts` (§8 Stream contract).

**Critic and rubric planner (C5).** The completeness critic
(`agent/critic.ts`) and the rubric planner use purposes 'critic' and 'planner'
on the auxiliary model service (§8); none → 'unavailable' (Unverified) and no
rubric.

Grounding evidence (I11): `deterministicGroundingCheck` accepts a retrieval
tool from the runner's events, the executor log of the judged runs
(`toolNamesOfRuns` in `tools/execution-log.ts`: DISTINCT tool_name by run_id,
the lineage for a continuation), a `[source:…]` citation, or
`CriticInput.injectedMemoryIds` (the run's `PromptDelivery.recall.ids`, from the
assembled prompt or the turn-only fallback). `memory_expand` counts as
retrieval. Delivered recall only skips the automatic 'incomplete'; the model
critic still judges. `criticRules(ids)` rule 6 names delivered memory as
evidence and lists up to 30 id-shaped ids (others are only counted).

### One runner entry (I10)

Every background conversation run goes through `ctx.agents.runConversation(
conversationId, overrides?)`, built by `createRunConversationEntry` over
`createRunDeps()` (`src/modules/agent/run-deps.ts`). `createRunDeps` is the
single ConversationRunnerDeps/ResumeRunDeps bundle: prompt assembler (turn
block and recall), critic, verify, event store, checkpoint, budget engine,
pricing, context recorder, designs, documents, memory capture, model binding
and materializeBinding, with services from other modules read through getters.
The same bundle (`ctx.agents.runDeps`) backs the run routes (retry/refresh),
approval resume, retry sweep, boot recovery and God Mode. Three triggers use the
entry: the proactive bot-executor (stage-bound cards, and `assign_task`), the
scheduler's `agent_run` handler (§17), and the hand-off subscriber
(`agent/handoff-run.ts` `wireHandoffRuns`: `eyas.board.task_assigned` with
`handoffFromConversationId` → run the colleague's home thread only while it is
'waiting'; the handoff tool refuses a busy thread, and a duplicate event never
starts a second run). Scheduled `agent_run` jobs and hand-off auto-start are
implemented (previously dead code paths).

### Run tree (orchestration events) (G6)

- `agent/run-tree.ts` (`runTreeScopeOf` + `withRunTree`) wraps
  `createAgentRunner().run()` when `deps.getOrchestrationSink()` (the agent
  module passes `ctx.orchestration`, lazily) returns a sink and the run has a
  conversation.
- Plain run (runId = conversationId): run_started, then node_started{kind:
  'root', label = model ?? provider, agentId, conversationId} on `conv:<id>`,
  node_progress{turn, maxTurns, tokens} per runner turn and per provider `step`,
  tool_started/tool_result per tool id (runner-executed and provider-executed
  alike, deduped), then node_completed + run_completed{status, totalTokens,
  totalCostUsd}.
- Status mapping: every `done` outcome is 'completed'; `cancelled` and a
  consumer that stops reading are 'cancelled'; a throw is 'failed' and counts
  the ProviderRunError usage/costUsd; a park emits a 'checkpoint' frame and stays
  open.
- Cost: a CostAccumulator over the turns' usage, priced with
  `deps.pricingOverrides` (config.model.pricing). It is null when any turn's
  usage was unreported.
- A team member run (metadata/toolContext teamSessionId at run start) emits
  only tool frames on `conv:<child>` under runId = teamSessionId. The team driver
  owns phases, member nodes and node_progress; the orchestrator's `tool`
  onProgress kind is removed.
- Providers emit nothing, except ACP CLIs' plan entries:
  `grok-cli/acp-plan.ts` `createAcpPlanEmitter` gives node_started{kind:
  'plan_step', pending?} and node_completed on `plan:<conversationId>:<i>`,
  parent `conv:<conversationId>`. The Grok/Kimi governance `orchestrationSink`
  is an `OrchestrationSink` object. Claude Code installs no orchestration hooks.
- `shared/orchestration-events.ts`: OrchestrationNodeKind includes 'plan_step';
  node_started.pending; run_completed.totalCostUsd is number|null;
  `OrchestrationSink {emit, latestSeq?}`; `createSharedRunSeq(runId,
  latestSeq)` returns max(own, persisted)+1 per event, used by the runner, plan
  steps and the team driver.
- Frontend run-tree-store: run_started drops the previous nodes of the same
  runId (a per-turn tree; another run's nodes stay); node_started after a
  terminal status reopens the node; run_completed stores cost; a null cost
  renders as '—'.

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
// Agent tools: browser_navigate, snapshot (index + snapshotId), click/fill/hover/select,
// tabs, back, wait, dialog, upload, evaluate (page JS), download → Documents,
// storage (Playwright storageState), screenshot, get_content, close
// Biztonsag: URL allowlist + SSRF, 5 perc process session, EYAS-owned userDataDir
//   (soha nem a napi Chrome-profil — Chrome 136+ Default CDP tiltva),
//   snapshot index navigaciora invalidalodik
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

**Import roots (A12).** `skills.importRoots` (instance overlay) is re-scanned
on every start as `import:<dir>` roots. Before the scan, the roots go through
`selectImportRoots` (`src/shared/memory-sovereignty/import-roots.ts`). It asks
the shared path policy and drops any root inside or enclosing a foreign-memory
store (`FOREIGN_MEMORY_STORES`, other-home dot-folders, Obsidian vaults,
`security.foreignMemoryPaths`) or an EYAS-owned CLI home, logging a warning
that points to the Data port. Provider-native content enters EYAS only through
the one-way Data port import. The same selection serves `agent.importRoots`
(§14) and the `eyas doctor` 'Import roots' check (§6.8).

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

### Job handlers and agent routines (I10, E6)

- Job handlers are `JobHandler(config, { jobId, createdBy })`. A handler may
  throw `JobFailure(message, result)` to keep structured context on a failed
  `job_executions` row.
- The `agent_run` handler (`scheduler/agent-run-handler.ts`,
  `AgentRunConfigSchema`: agentId, prompt, conversationPolicy new|reuse,
  conversationId, title, effort) creates or re-arms a conversation owned by the
  job creator (else the root owner), with goal = prompt, mode autonomous,
  binding inherit, status waiting, and runs it via `ctx.agents.runConversation`
  (§14, One runner entry). The execution result carries `conversationId`,
  including on failure. A run that cannot start fails the execution with a coded
  reason (`agent_unavailable`, `over_budget`, `invalid_config`,
  `conversation_busy`, `conversation_forbidden`, `runner_unavailable`,
  `owner_unavailable`), which counts toward the dead-letter limit.
  `conversationPolicy: 'reuse'` needs a conversation of the same user that is
  not running.
- `handlerConfig.effort` (`EffortSettingSchema`; 'auto'/null → NULL) is written
  onto the run conversation on every run (§8 effort, scheduler entry path).
- The routes validate an agent_run `handlerConfig` on create/update (400) and
  stamp `createdBy` from the authenticated user. The unimplemented
  `channelNotify` option is gone.

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
  turn_meta TEXT,                              -- JSON TurnMeta (src/shared/chat-stream.ts), assistant replies only; NULL for user messages and pre-G7 rows
  created_at TEXT DEFAULT (datetime('now'))
);
```

A `turn_meta` oszlopot a conversations/index.ts egyetlen additiv ALTER-je adja hozza; az `addMessage` `TurnMetaSchema.parse`-szal validal, a `toMessage` ervenytelen tarolt erteknel null-t ad (pino warn).

Ha a user egy conversationbol taskot akar csinalni, a rendszer automatikusan linkelhe a task-hoz (task_id kitoltese). A `task_messages` tabla a board modul resze marad — de a megjelenses mindketto szal megjelenithetoen is.

---

## 19. Communication modul
> **Status: [DONE]** — Implemented in src/modules/communication/ — Telegram, MCP stubs, A2A

### MCP integraciok

- **MCP Server**: Eyas mint MCP szerver (mas eszkozok elerhik: search, task.create, memory.save, agent.run)
- **MCP Client**: Kulso MCP szerverek elerese (filesystem, browser, database, custom)
- **Memoria-tar blokk** (`mcp-client/memory-store.ts`, B7): a kulso memoriat tarto MCP szerver minden modellnek tiltott. Harom determinisztikus jel: katalogus `memoryStore` flag (memory, qdrant, obsidian — tier 'manual') vagy annak csomagneve; `FOREIGN_MEMORY_MCP_SIGNATURES` pontos csomag/binaris nev (verzio-suffix nelkul, a megjelenitett nev soha); barmely arg/env ertek/command ut/file: URL, amit a `getPathPolicy()` nem 'ok'-nak itel (foreign-memory, eyas-data, provider-home). A kikenyszerites egy helyen, a `McpClient`-ben van: `add`/`update` `McpMemoryStoreBlockedError`-t dob (route: 409 `memory_store_blocked`), a `connectServer` spawn elott elutasit (nincs `mcp_*` tool), boot-kor a meglevo sorok status='blocked'. A `GET /mcp/servers` `blocked:'memory_store'`-t ad; a `refresh` 409, a `test` `{ok:false, code}`. A `config/mcp.yaml` memoria-tar bejegyzesei hibaval kimaradnak.

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
> **Status: [PARTIAL]** — Engine + workflow implemented; web search uses Brave when `brave-search-api-key` exists, else a mock provider. Every model step (query expansion, source scoring, synthesis, cross-reference) goes through `ctx.auxiliaryModel` (purpose research, group research: Standard tier → default binding → API providers → isolating CLIs) as an isolated one-shot. The engine reads the service lazily per call. Untrusted web content (titles, snippets, page extracts, and model-written sections for the cross-check) is wrapped in a per-call nonce fence (`src/modules/research/model-io.ts` `createSourceFence`: CSPRNG tag `research-data-<hex>`, fence-family tags inside the content defanged) with a data-not-instructions rule in `request.system`; model output is Zod-checked (`parseJsonArray`). Degraded mode: when the service has no model (no_eligible_provider / tier_not_configured / budget_stop), the run stops asking. A missing or unusable synthesis gives a deterministic report: order-based relevance (1 - i/n, top N ≥ 0.5), one section per top source {title, snippet + url}, no cross-reference, no page fetch without a model. `research_reports.degraded` = 1. The report still completes; only non-model failures set status error.

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
8. Mentes: memoria (semantic tier) + dokumentum (documents modul) — NINCS
   implementalva: a jelentesek csak a `research_reports` tablaban elnek; a
   kutatasi kimenet trust-cimkezese J7/J8 feladata.
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

Jelenlegi kizarasok (`DEFAULT_BACKUP_EXCLUDES`): `data/backups`, `data/tmp`, pid/log, es a
`data/cli-homes/*/sessions` CLI session-tarak (eldobhato transcriptek, amiket az EYAS soha nem
folytat; a CLI home tobbi resze — az EYAS-sajat bejelentkezesi adatok — az archivumban marad).
Ismert hiany: az archivum a `<home>/data`-t fedi le; ha az `EYAS_DATA_DIR` mashova mutat (DB +
vault), azt kulon kell menteni. A `data/`-n kivuli workspaces gyoker (§8 CLI runtime seam) sincs
benne; az agens-kimenetek a documents-ben (conversation attachment) megmaradnak.

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
eyas doctor                         # Rendszer diagnozis (Claude Code runtime, Vault, Import roots, Memory embedder, SQLite, zstd, …; §6.8)
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
eyas config reload                  # NEM tolti ujra a default.yaml/local.yaml-t (nincs route, lasd §37)
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

**Provider-nevek es -tipusok (G13).** A web a provider nevet es tipusat
kizarolag a `src/web/src/lib/provider-display.ts`-en at olvassa: egyetlen,
cache-elt, Zod-dal ellenorzott `GET /model/providers` lekeres
(`useProviderDisplay()` → name / kind / isCli, plus a szinkron `providerName(id)`
a tiszta view-builderekhez). Hianyzo katalogusnal (pl. guest szerepkor, aki nem
olvashatja) az id-re es az `api` tipusra esik vissza. Egyetlen oldal sem tart
sajat nev-terkepet vagy CLI-id halmazt (§8, One provider display source); a
provideronkenti forditott szovegek a tulajdonos modul locale-jaiban, provider-id
szerint maradnak.

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
> **Status: [PARTIAL]** — fs.watch + 300ms debounce + Zod validation + bus events for `config/personality/` only; `default.yaml` / `local.yaml` need a restart and `eyas config reload` has no route

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

`core/config/watcher.ts`: fs.watch a config/personality/ konyvtaron. Debounce (300ms). YAML betoltes -> Zod validalas -> ha hibas: SKIP + warning + notification, regi config marad. Ha jo: config registry frissites -> bus event `eyas.config.reloaded` -> erintett modulok ujratoltik. Pelda: a privacy modul a `privacy.yaml` valtozasara (es `reload.failed`-re) ujraimportalja a policy seedet, amig a policy forrasa nem `ui` (§40).

**Pontositas (2026-09):** a `config/default.yaml` es a `config/local.yaml` NEM hot-reloadolhato. Indulaskor egyszer toltodnek be (`ctx.config`), a watcher csak a `config/personality/`-t figyeli, es a `default.yaml`/`local.yaml`-ra semmi nem kezeli az `eyas.config.reloaded`-et — minden itteni valtozas (pl. `memory.index.budgetChars`, `i18n.timezone`, `security.*`) restartot igenyel.

CLI: `eyas config validate` (Zod check). Az `eyas config reload` a `POST /api/v1/config/reload`-ra kuld, de ezt az utat jelenleg egyetlen route sem szolgalja ki — vagy a mechanizmust kell megvalositani, vagy a parancsot eltavolitani.

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
> **Status: [DONE]** — Implemented in src/modules/privacy/ — deterministic line-bounded scanner chain, policy v2 (DB-stored, hot-reloaded seed, edited on the Privacy page), gateway egress filter, one mask for tool results on every transport, inbound refusal of block-class values, aggregated egress audit, mask-at-rest for vault notes

### Szenzitiv adat vedelem (CORE, 2026-03-23, NemoClaw inspired; atirva 2026-09)

**Egress-szerzodes:** az EYAS adat nyersen tarolodik, es kifele menet
celonkent maszkolodik, egyetlen determinisztikus fuggvennyel a
`PrivacyService`-ben (`src/modules/privacy/service.ts`, publikalva
`ctx.privacy`-kent). Nincs "lokalis motorra iranyitas": a korabbi `auto_local`
/ `routeToLocal` es az Ollama provider-id alapu kivetel megszunt.

### Scanner chain (determinisztikus, szinkron, sorhatarolt)

```typescript
interface PiiScanner {
  id: string
  scan(text: string): PiiMatch[]
}

interface PiiMatch {
  type: string          // BuiltinPiiType | custom slug
  value: string         // A talalt szenzitiv adat
  start: number         // Abszolut pozicio a szovegben
  end: number
  confidence: number    // 0-1
  scanner: string       // Melyik scanner talalta
}
```

A lanc `'\n'`-en darabol (`scanners/lines.ts`, `splitLines`), es abszolut
offseteket ad vissza; egy ket sorra tort ertek nem talal, es egy telefon- vagy
adoszo csak ugyanazon a soron szamit.

1. **RegexScanner** — beepitett tipusok (`BUILTIN_PII_TYPES`): `email`,
   `phone`, `iban` (minden orszag, mod-97 + pontos hossz), `bank_account`
   (HU giro 8-8(-8), 9-7-3-1 blokk-checksum), `credit_card` (Luhn +
   kartyahalozat-prefix), `ssn` (ervenyes area/group/serial), `personal_id`
   (HU szemelyi igazolvany 6 szamjegy + 2 nagybetu, onallo token),
   `tax_number` (adoszam ellenorzo szammal, 1–5 AFA-koddal es valodi
   megyekoddal; HU kozossegi adoszam; adoazonosito jel ellenorzo szammal ES
   egesz-szavas adoazonosito-szoval elotte), `taj_number` (CDV). A tiszta
   checksumok es alak-predikatumok a `scanners/validators.ts`-ben vannak.
   Kifejezetten elutasitva: datumok minden szokasos formaban, idopontok, ISO
   timestampek, IPv4, verziok, osszegek es azonosito-kontextusok (rekord,
   ticket, build, commit, UUID, ULID, hash). Telefon csak `+`-szal, zarojeles
   korzetszammal, HU belfoldi formatummal (06/36) vagy 40 karakteren belul
   ugyanazon a soron allo telefon-szoval talal (egesz-szavas illesztes).
2. **CustomScanner** — felhasznalo altal definialt mintak (name, regex, type
   slug, action). Sorhatarolt (`^`/`$` sorra horgonyoz, soha nem illeszt
   sortoresen at), ReDoS-vedett es forditott; a nem biztonsagos vagy nem
   fordulo minta kimarad es pino-val logolodik; ures illesztesre kepes minta nem
   akaszthatja meg a scannert. Minden leforditott policy sajat custom scannert
   birtokol.

**A NerScanner megszunt.** Nemdeterminisztikus volt, megkerulte a model
gateway-t (a prompt szoveget egy lokalis Ollamanak kuldte), es lokalis modellt
feltetelezett. Egy `ner` bejegyzes a `privacy.yaml`-ben figyelmeztetessel
figyelmen kivul marad; a bovitesi pont a custom minta. Nevek es postai cimek
nem detektalodnak.

### Policy v2 (`policy.ts`)

Zod `PrivacyPolicySchema`: tipusonkenti muvelet-terkep, custom mintak,
`localHosts` (legfeljebb 32 kanonikus host, sema/port nelkul) es `audit`.
`rulesetVersion` = `'regex@2/policy@<version>'`.

| Muvelet | Leiras |
|---------|--------|
| `off` | Figyelmen kivul |
| `warn` | Szamolva es logolva, a szoveg valtozatlan |
| `mask` | `[TYPE]` helyorzo, amikor a szoveg egy tavoli modell fele elhagyja az EYAS-t |
| `block` | Kifele ugyanugy maszkolva — **soha nem szakit meg egress-t**; a legszigorubb osztaly, egyetlen tovabbi hatasa az UJ interaktiv bejovo uzenet elutasitasa tavoli cel eseten (D6, lent) |

Alapertelmezes: email/phone mask; iban/bank_account/tax_number/personal_id/
credit_card/ssn block; taj_number warn.

### Tarolas es YAML seed (`policy-store.ts`)

Tabla: `privacy_policy(id, json, version, source yaml|ui|defaults, yaml_hash,
seed_error, updated_at)`. A `privacy.yaml` a seed: hash-valtozaskor
ujraimportalodik (bootkor es az `eyas.config.reloaded` / `reload.failed`
esemenyre a `privacy.yaml`-ra), amig `source != 'ui'`. Ervenytelen vagy
hianyzo fajl: az utolso jo policy marad, error-szintu log a feloldott uttal, es
`seed_error` beallitva — nincs csendes visszaeses a defaultokra.

```yaml
# config/personality/privacy.yaml (seed)
privacy:
  enabled: true
  actions:
    email: mask
    phone: mask
    iban: block
    bank_account: block
    tax_number: block
    personal_id: block
    credit_card: block
    ssn: block
    taj_number: warn
  customPatterns:
    - name: "internal_project"
      regex: "PROJECT-[A-Z]{3}-\\d+"
      type: "internal_project"
      action: warn
  localHosts: []   # loopback-on kivuli, "ez a gep" hostok (max 32)
  audit: true
```

A regi formatum (`scanners` / `rules` / `custom_patterns`) konvertalodik:
tipusonkent az elso illeszkedo szabaly dont, illeszkedes nelkul `warn`,
`sanitize` → mask, `auto_local` → mask figyelmeztetessel, `ner` figyelmeztetessel
kimarad, a `scanners`-bol hianyzo scanner detekcioi kikapcsolnak, a
hasznalhatatlan szabaly/minta figyelmeztetessel eldobodik.

### Service API

`policy()`, `state()`, `rulesetVersion()`; `localityOf(provider)` az
`egressHost`-bol + `isLoopbackHost` + `localHosts` (hianyzo host = remote,
nincs DNS; `src/shared/endpoint-locality.ts`: `hostOf` + `isLoopbackHost` —
csak `localhost`, `127.0.0.0/8` es `::1` loopback, a `0.0.0.0` es a privat
tartomanyok nem); `redactText(text, {locality})` a mask- es block-osztalyt
`[TYPE]`-ra cserelni, soha nem dob; `redactValue` csak string-leveleken jar;
`checkInbound(text, {localities})` csak tavoli cel eseten blokkolja a
block-osztalyt (ures lista = remote); `maskAtRest(text)`; `update(policy)`
validal, ment, atomikusan csereli a policyt, majd
`eyas.privacy.policy.updated {version, source, rulesetVersion, changedTypes,
userId?}`-t emital (ertekek soha); `stats()`; `snapshot()` (lasd lent);
`redactToolOutput(toolName, output, {transport, …})` (D5, lent); `preview(text)`
(a scan tester, D8).

**Stats contract (D8).** `PrivacyService.stats()` returns `{since, egress{calls,
maskedCalls, byType}, inbound{checked, refused, masked}, byScanner}`. The
counters are in memory and cover real traffic only: `recordEgress(digest)` is
called for every gateway/embed digest from the module's `onDigest` (only remote
digests count); `redactToolOutput` counts every memory tool result sent past the
gateway; `checkInbound` counts `checked`; `refused` / `masked` come from the
`eyas.privacy.inbound_refused` / `inbound_masked` bus events. The scanner chain
keeps no counters, and the scan tester never touches them.

### Egress filter (`egress-filter.ts`, `createEgressFilter`)

A privacy modul a raw gateway `EgressSlot`-jaba (`ctx.modelEgress`,
`model/egress.ts`, §8 Egress slot) installal. A filter a `resolveProvider` utan
fut a `complete()`/`stream()` MINDEN kiserleten (retry es tier-fallback hop is),
es az `embed()`-ben. A `ctx.model` nincs becsomagolva, tehat a privacy indulasa
elott elkapott referenciak (a decision engine triage hivasa) is fedve vannak.

- Lokalitas = `service.localityOf(provider)`: loopback `egressHost` vagy
  `policy.localHosts` → local; nincs host (CLI/ismeretlen) → remote. Local cel
  vagy kikapcsolt policy eseten a request objektum valtozatlanul megy.
- Tavoli celnal:
  - a system prompt szekcionkent szkennelodik, a
    `ContextRecorder.sectionsFor(metadata.compositionId)` sorrendjeben
    lokalizalva (in-memory LRU, 128 friss kompozicio). A
    `SYSTEM_GENERATED_SECTION_KEYS` (core-identity, core-rules, runtime,
    working-directories, available-tools, available-skills, available-agents,
    orchestration-directive) nem szkennelodik; a nem lokalizalhato szoveg
    `unattributed`-kent szkennelodik (fail closed; rekord nelkul az egesz
    prompt);
  - a string uzenetek es text blokkok szkennelodnek; a `<turn-context>` blokk
    (ora + felidezes, I4) a user uzenet reszekent szkennelodik (a
    context-recorder a 'turn' zona szekcioit kihagyja a system-prompt
    lokalizalobol);
  - a `ToolImplementation.memoryBearing === true` toolok tool_result blokkjainak
    JSON-leveleit a `redactValue` maszkolja (valtozatlan eredeti bajtok
    megmaradnak), nem-JSON szovegkent maszkolodik;
  - tool_use inputok, kepek, thinking blokkok es minden mas blokk erintetlen.
- Valtozas nelkul ugyanazt az objektumot adja vissza, kulonben spread-megorzo
  sekely masolatot.
- Ertekmentes `EgressDigest`-et epit (szekcionkenti spans/skipped/located,
  unattributed/messages/toolResults szamlalok, byType, matches) az
  observability hookhoz.
- **A policy fordulonkent rogzitett:** `PrivacyService.snapshot()`, kulcs
  `compositionId ?? runId` (LRU 128), igy egy tool-loop kozbeni hot swap nem
  valtoztathatja meg a mar elkuldott bajtokat (preserved-thinking replay).
- **Digest per call (D7).** Every call with the policy enabled yields a
  value-free `EgressDigest` with a locality (local calls: nothing scanned). The
  filter attaches it after the call (`queueMicrotask`) to the turn's composition
  via `contextRecorder.attachEgress` (§46, context inspector).

**Csak a memory-bearing toolok maszkoltak** (owner dontes; felulirja a p1e
terv "minden tool_result szkennelese" pontjat). A workspace toolok (fajl, shell,
git, grep, browser, documents, kodkereses) nyersek maradnak, mert a CLI-nativ
toolok ugysem maszkolhatok, es a maszkolas helyorzoket irna vissza a modell
altal szerkesztett fajlokba. Egy contract teszt kikenyszeriti a flaget a
read-only memory/knowledge toolokon, es tiltja a workspace kategoriakon.

### Kimeno tool-eredmenyek a gateway-en kivul (D5)

- A gateway egress filtere csak a nativ agent-loop tool_result-jait latja. A
  tobbi csatorna (Claude Code in-process MCP bridge, Grok/Kimi ACP bridge
  `/api/v1/internal/cli-mcp/tools/call`, kulso MCP `/api/v1/mcp/tools/call`,
  OpenCode sidecar) egyetlen szerializalason megy at:
  `ToolExecutor.renderForModel(toolName, result, ctx: ToolOutputContext) →
  {text, isError}` (`src/modules/tools/tool-executor.ts`).
- Hiba eseten `Error: <ok>`. Siker eseten `JSON.stringify(output ?? {})`. A
  `memoryBearing` toolok kimenete (es hibaszovege) elotte a
  `PrivacyService.redactToolOutput(toolName, output, {transport,
  conversationId?, runId?, agentId?, turnId?})` fuggvenyen megy at. Ez mindig
  remote maszk (`redactValue`), es erteket nem tartalmazo `ToolOutputDigest`-et
  ad es logol.
- `OutboundTransport = 'mcp-bridge' | 'mcp-external' | 'opencode'`. Mind remote,
  a `localHosts` nem mentesit.
- Az identitas szerveroldali allapotbol jon (BridgeBinding, ToolContext), soha
  nem request body-bol.
- A redactor lusta: `ExecutorOptions.getModelOutputRedactor` (a tools modul
  `ctx.privacy?.redactToolOutput`-ot ad at). Ha dob, a memoria-eredmeny
  visszatartva (`MEMORY_RESULT_WITHHELD`: 'Error: memory tool result withheld
  (privacy scan failed)').
- OpenCode: a developer-agent a task promptot es a `system` memoria-hidratalast
  egy `redactToolOutput('opencode_run', …, transport 'opencode')` hivassal
  maszkolja, meg barmilyen, a taskot hordozo sidecar-hivas elott (a
  `GET /config/providers` modell-lista olvasas elotte fut, de semmit nem visz
  a taskbol). Hiba eseten a task elbukik. A
  plugin `POST /api/v1/opencode/memory/search|expand` valaszai (J10) ugyanazon
  a `ToolExecutor.renderForModel`-en mennek at, transport 'opencode'-dal, igy
  szinten maszkoltak (§8 OpenCode).
- A nativ loop valtozatlan: az agent-runner csak `execute`-ot hasznal, a gateway
  egress filter maszkol celonkent.
- A bridge-routes korabbi sajat `maskMemoryOutput` / `getPrivacy` mechanizmusa
  torolve.
- Az aggregalt audit esemeny (D7) a `reportToolOutput`-bol megy ki
  (`attachToolEgress`, turnId = compositionId).
- A kulso MCP `tools/call` a body-t validalja: 400 + JSON-RPC `-32600` (nem
  JSON / nem objektum) vagy `-32602` (hianyzo nev / nem objektum arguments); az
  ismeretlen tool 404 `-32601` marad.

### Bejovo elutasitas (D6)

'block' has exactly one effect beyond masking: a NEW interactive user message
(chat `POST /api/v1/conversations/:id/messages`, God Mode, the channel inbound
coordinator) that carries a block-class value and is bound for a remote
destination is refused before anything is stored or started. History, memory,
tool results and embeddings are never refused, only masked.

- The refusal is a typed outcome (`privacy/errors.ts`: code 'privacy_blocked';
  HTTP 422 `{error, code, message, types, maskedContent}` on chat, before any
  stream starts; a localized notice from `privacy/notice.ts` +
  `privacy/locales/{en,hu,de,es,fr,tlh}.json` on channels, language from
  memory/v2 `detectLanguage`, fallback en), never a stream error frame.
- Chat destination (`conversations/privacy-preflight.ts`): `resolveStatic` of
  the turn's binding (override > pinned/inherited pair), the provider's egress
  host → `PrivacyService.localityOf`; Auto (unless Auto-routing is globally
  off) and unresolvable bindings → remote; God Mode → every roster participant
  (`GodModeSendDeps.participants`), empty → remote. Channels → remote.
- `privacy:'mask'` stores and sends `checkInbound().maskedText` (only
  block-class values masked). A channel refusal ends the inbound event
  `skipped` / `privacy_blocked` with only the masked text kept; no
  conversation, message or run is created.
- Bus/audit: `eyas.privacy.inbound_refused` and `eyas.privacy.inbound_masked`
  `{targetId, conversationId, source, types, userId?, godMode?,
  inboundEventId?}`, never values.

**Bootstrap-sorrend megjegyzes:** a privacy az egress slotba installal; az
observability tracing wrappere meg a `ctx.model`-t csomagolja, ezert a trace-ek
a privacy elotti requestet mutatjak, amig ez at nem kerul.

### Tarolt memoria

A vault jegyzetek iraskor a `ctx.privacy.maskAtRest`-en mennek at — ugyanaz a
fuggveny, mint az egress-nel; a datumok maradnak (§13 rogzites). Az L0 nyers
rekord, a gistek es a tenyek az EYAS-on belul nyersek maradnak, es csak
kilepeskor maszkolodnak.

### HTTP API

**Operator surface (D8).**
- `GET /api/v1/privacy/policy` (read SecurityEvent): policy, version, source,
  seedError, updatedAt, rulesetVersion, builtinTypes, actions, limits,
  canManage.
- `PUT /api/v1/privacy/policy` (manage SecurityEvent): body
  `PrivacyPolicySchema`, validated by `PrivacyService.update`. It persists the
  policy as UI-managed, swaps it atomically, emits `eyas.privacy.policy.updated
  {version, source, rulesetVersion, changedTypes, userId}`, and answers 400
  `invalid_policy` with Zod issue paths/codes.
- `POST /api/v1/privacy/scan` (manage SecurityEvent): Zod-validated body
  (non-empty `text`, at most 100 000 characters), served by
  `PrivacyService.preview(text)`: `{enabled, rulesetVersion, matches (per-match
  action, value '***'), inbound {refused, types}, egressPreview}` — the
  remote-destination mask, the per-match action and the ingress verdict
  (refused iff any block-class type). It never touches the counters.
- `GET /api/v1/privacy/stats` (read SecurityEvent): the stats contract above.
- Web: `pages/privacy/{policy-editor.tsx, scan-tester.tsx, policy-form.ts}`.

**Audit (D7).** The aggregated action `privacy.egress`: one per model call
(gateway/embed) or per memory tool result sent past the gateway
(mcp-bridge/mcp-external/opencode) that had a detection. Target =
conversationId. Payload: conversation/run/agent/composition/turn ids,
providerId, locality, transport, rulesetVersion, masked/warned, byType,
sectionKeys ('unattributed' for system text outside recorded sections),
historyMatches, toolNames. Values are never included. Emitted only with
`policy.audit` on (`src/modules/privacy/egress-audit.ts`). The per-match
`privacy.detected` entries are no longer written. `privacy.policy.updated` is
always audited.

### Integracio

A privacy modul nem wrappeli a `ctx.model`-t: a gateway egress slotjaba
installal (kimeno modellforgalom es embedding), a memory modul a
`maskAtRest`-et hivja vault-iraskor, a tools modul a `redactToolOutput`-ot
(D5), a `checkInbound` pedig az uj bejovo uzenetek elutasitasanak alapja (D6).

**Start order (D8).** `privacyModule.dependencies = ['model', 'auth']`. Routes
created in `onStart` must sit behind auth's middleware; every consumer reads
`ctx.privacy` lazily. `auth/routes.ts` pairs `/api/v1/privacy/*` with
authenticate + csrfProtection (the login-bounce known issue is resolved).

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

**Memoria-szuverenitas path policy** (`src/shared/memory-sovereignty/`). Tiszta es modul-fuggetlen, egyetlen processz-szintu peldannyal (`installPathPolicy` / `getPathPolicy`); amig a gate nem installalja a konfiguralt policyt, egy `resolveInstance()`-bol epitett lusta default valaszol.

- **Bemenetek:** `foreign-stores.ts`, verziozott: `FOREIGN_MEMORY_STORES`, `SEGMENT_RULES`, `FOREIGN_MEMORY_MCP_SIGNATURES`; az `InstancePaths` (`dataDir`, `databasePath`, `workspacesDir`, `cliHomesDir`); es a `security.foreignMemoryPaths` config.
- **Itelet:** `foreign-memory`, `eyas-data` vagy `provider-home`. A munkateruletek abszolut gyokerek: `workspacesDir`, `<dataDir>/studio`, `<dataDir>/browser/downloads`. A beszelgetesek kozotti szabaly a `workspacesDir`-hez kotott, `<id>` es `_runs/<id>` szerint (masik beszelgetes workspace-e tiltott). Egy utat irott formajaban ES `realpathBestEffort` utan is megitelunk (`src/shared/fs-realpath.ts`), a szigorubb itelet nyer.
- **Obsidian vaultok:** az Obsidian sajat vault-listaja (Zod, valtozaskor ujraolvasva) plusz `.obsidian` marker felfele kereses, korlatos, idoben lejaro cache-sel (5 ms alatt).
- **API:** `evaluateToolInput` (minden tool minden path mezoje, shell-kinyeres a `shell-paths.ts`-sel, Glob literal prefix; a Grep minta soha nem path; a per-mezo ellenorzesek utan a keresesi hatokorok, lent); `kernelDenyList({exclude, workingDirectories})` glob-mentes bejegyzesek a Grok profilhoz es a Claude sandboxhoz; `isProtectedDir` grep/glob bejarashoz (mappara es fajlra is); `protectedWithin(dir, ctx)`: az elso vedett hely szigoruan egy mappa ALATT, ugyanazzal az eleressel, mint a teljes mappa keresese (K1 `reachOf`), `null`, ha a mappa maga vedett (azt a `classify` mondja meg); `describe()` a UI-nak.
- **Search scopes (K1).** A search is judged by its effective set, not by its folder alone. `src/shared/memory-sovereignty/search-scope.ts` derives search scopes `{field, root, include globs, anywhere}` from two sources: CLI-native search tools (Claude Code Grep/Glob/LS, Grok rawInput variant Grep/ListDir, OpenCode's mapped Grep/Glob), and every `command` line (recursive programs and glob words; `run_command` program + argv without expansion). `path-policy.ts` `evaluateToolInput` checks the scopes after the per-field checks. `reachOf` classifies the root. It then checks every place known by name strictly below the root: data dir, database, provider homes, foreign-store paths, `foreignMemoryPaths`, registry and marker vaults, and sibling workspaces when the root encloses the workspaces root. It filters them with a linear, conservative glob matcher (ripgrep 'anywhere' semantics for include globs, anchored for shell globs, exclusions ignored, brace/length caps). Last, it runs a bounded breadth-first scan (2000 dirs, depth 8, skipping `node_modules`/VCS) for places known only by shape. The scan ignores the search's globs: it walks a root once, records every protected folder it meets (never descending into one; at most 256), and caches that list for 10 s per root + own workspaces; each search then keeps the hits its globs may reach, so a new glob or tool on the same root costs no readdir. Non-link entries are classified with the parent's real path joined, not a realpath each. Shell lines (`shell-paths.ts` tokenizer, `search-scope.ts` unwrap) follow the shell grammar: a redirection takes one target word (a leading fd number or `{name}` is dropped) and the simple command continues after it; a here-document body (up to its delimiter line; `<<-` strips tabs; inside a `$(`, a delimiter line ending in `)` closes it) is stdin, never words or commands — only its `$(…)`/backticks when the delimiter is unquoted — and a body whose delimiter never comes is re-read as lines (conservative); arithmetic (`$((…))`, `((…))`, `$[…]`) is one word. `unwrap` skips reserved words (`! { } if then elif else fi do done while until esac`, `coproc [NAME {]`), reads `eval` words and `sh -c` / `-lc` scripts as command lines, and marks a shell with no script (or `-s`, `-`, `/dev/stdin`) as reading stdin: then every here-document and here-string of the line is read as a script. `xargs`/`parallel` mark the command as input-fed: a recursive search under them is a scope rooted at `/`. Path words (and path candidates) are brace-expanded (`expandBraces`, now in `shell-paths.ts`; too many variants → the prefix before the first brace). `embeddedShellScripts` hands `sh -c`/`eval`/stdin scripts to the path check too, so a quoted `bash -c 'cat ~/.claude/CLAUDE.md'` is refused like the bare command. A hit is a `PathViolation` with `searchRoot`. `deny-reason.ts` renders `Search too broad [memory-path:search-scope:<target>] … narrower folder`; the tag lives in the import-free `search-scope-code.ts`, which the web tool row reads to show a localized line, and it is one of `MEMORY_PATH_REASON_MARKERS`. EYAS's own grep/glob are not searches here: `walkFiles` leaves protected folders and files out. Not covered: Kimi's native Grep/Glob, which never ask EYAS (kimi-cli 1.52.0 source).
- **Config:** `security.foreignMemoryPaths` (abszolut utak, `~` kibontva, a nem-abszolut bejegyzesek `ignored`-kent listazva) es `security.cliSandbox` = `auto | required` (nincs `off`; mas ertek config-hiba: a Zod enum miatt az EYAS nem indul; a `getCliSandboxMode` required-fallbackje csak vedovonal). Mindketto kikenyszeritve; a cliSandbox a §8 Kernel file sandbox (B5) szerint. The earlier note "accepted and validated now; enforced later" is superseded.
- **Mappa-validalas (B12):** `validateWorkingDirectories` (`src/modules/tools/working-directories.ts`) az egyetlen mappa-ellenorzo a beszelgetes Folders, a projekt es a projekttipus mentesehez, es a `resolveCliCwd` / `resolveCliRoots` ezt futtatja minden tarolt mappara CLI-inditas elott. Sorrend: `notAbsolute` (null bajt is) → `home` (gyoker, $HOME vagy folotte) → `getPathPolicy().classify` (provider-home es cli store → `providerHome`; vault, ai-memory, Obsidian app-config, `security.foreignMemoryPaths` → `vault`; eyas-data → `eyasData`; a workspaces gyoker es a `_runs` maga is `eyasData`) → `sensitive` → `notFound` / `notDirectory`. A route-ok `400 {error, code, path, found}`-t adnak (`checkWorkingDirectoriesBody`, Zod); a web a kodot a `projects.folders.error.<code>` kulcsra kepezi. K2: a mappat az is kizarja, amit TARTALMAZ — a sorrend vegen (notDirectory utan) az EYAS home (`resolveHome()`, EYAS_HOME vagy a processz cwd) vagy afolotti mappa, majd a policy `protectedWithin()` talalata (adat-dir, adatbazis, workspaces gyoker, CLI home-ok, foreign store-ok, `foreignMemoryPaths`, registry/marker vaultok, mas beszelgetes munkaterulete, illetve a korlatos scan: 8 szint, 2000 mappa, `.git`/`node_modules` kihagyva) → `containsEyasData` / `containsProviderHome` / `containsVault`; a 400-as valasz `found` mezoben nevezi meg a talalt helyet. A mar tarolt, most elutasitott mappakat az agent runner (`screenToolWorkspaceFields`) es a chat route direkt-gateway aga futaskor kihagyja, `folderRefused` notice-szal; a prompt-wizard sem nevezi meg oket. Az EYAS `grep`/`glob` bejarasa `isProtectedDir`-rel kihagyja a vedett almappakat es fajlokat.
- **Kikenyszerites (B2):** a security-gate `onRegister` installalja a konfiguralt policyt: `pathPolicyOptionsFromInstance(resolveInstance())` + `database.path` + `security.foreignMemoryPaths`, a nem-abszolut bejegyzesek warninggal kimaradnak.
- A deterministic gate `check(tool, input, {workingDirectories})` MINDEN toolra `evaluateToolInput`-ot hiv, a blocklist es a sensitive-path ellenorzes utan, a rate limit elott. Talalat: `deny`, checkpoint `deterministic`; soha nem eszkalal (nincs judge, approval, grant); a denial streaket sem noveli, sem nullazza. Ha a policy kivetelt dob, az is deny (fail-closed). Kikapcsolt gate mellett is el.
- Indokok: `Memory outside EYAS (<label>) — use memory_search / memory_expand from EYAS`; `EYAS data directory (<label>) is read and written only by EYAS`; `<provider home> is read and written only by EYAS`; `Not this conversation's workspace (…)`; keresesi hatokornel (K1) `Search too broad [memory-path:search-scope:<target>]: the folder searched contains <what>, and this tool cannot leave it out — search a narrower folder that does not contain it` (foreign-memory celnal `; for memory use memory_search / memory_expand from EYAS` utotaggal; target = foreign-memory | eyas-data | provider-home | other-workspace).
- `gate.checkMemoryPath(tool, input, callCtx)` onallo, auditalt ellenorzes: deny eseten egy `security_events` sor; tiszta utnal `null`, sor nelkul. Ezt hasznalja az ACP fs kezelo (A6) es a Claude Code PreToolUse hook (B4).
- **Claude Code csatorna (B4):** a Claude Code beepitett es bridge-elt tooljai EGYETLEN PreToolUse hookon mennek at (`buildMemoryPathHook`, a `mergeHooks` `sovereignty` slotja, PreToolUse[0]); a hook `gate.checkMemoryPath`-et futtat (determinisztikus, auditalt, soha judge, nincs streak), hiba = deny. Reszletek es a munkamappak forrasa (`resolveCliRoots`): §8, Claude Code isolation tripwire and hook composition.
- A `workingDirectories` forrasai:
  - agent-runner: `toolContext`;
  - tool-executor: `workspaceFromContext`;
  - permission bridge ctx: Grok/Kimi eseten a `resolveAcpRoots` gyokerei a session cwd-vel; Claude Code eseten `resolveCliRoots`;
  - CLI-MCP bridge: a szerver-oldali `BridgeBinding.workingDirectories`, soha nem a kerestorzsbol.
- Hianyzo mappa csak a masik-workspace finomitast kapcsolja ki, a foreign-memory es az eyas-data tiltast nem.
- Torolve: `MEMORY_PATH_PATTERNS`, `FILE_WRITE_TOOLS`, `sensitivePathLiterals`.
- **Tovabbi fogyasztok:** az MCP client a `classify()`-t hasznalja a szerver arg/env/command/file: URL ertekeire (B7, §19); a `selectImportRoots` az import rootokra (A12, §15); a `validateWorkingDirectories` a mappakra (B12). `FOREIGN_STORES_VERSION` 2026-09-23 (MCPVault szignatura).
- **Allapot:** kikenyszeritve a gate-ben (minden tool, olvasas es iras), a Claude Code PreToolUse hookban, az ACP fs kezeloben, az MCP clientben, a mappa-validalasban, a grep/glob bejarasban, es (B5) a kernel file sandboxban a Claude Code shell es a Grok CLI sajat tooljai szamara (`kernelDenyList`, §8). Meg nyitott: a Kimi Code CLI nativ olvasasai es keresesei (a Kimi Grep/Glob soha nem kerdez, a Kimi-nek nincs kernel sandboxa), es ahol nincs elerheto sandbox (`auto`), ott a parancsszovegbol nem lathato shell-celok (valtozok, `eval`; a `cd`-t koveti a kinyeres). Valtozatlanul el: az EYAS sajat fajl-toolja elutasit egy munkamappan beluli, kifele mutato (akar logo) symlinket.
- **Unsandboxed shell (B5).** Egy Claude Code Bash hivas `dangerouslyDisableSandbox`-szal `callCtx.requireHuman`-nel megy a gate-be: csak a determinisztikus checkpoint fut (deny nyer), kulonben eszkalal (`UNSANDBOXED_SHELL_REASON_TAG`); nincs judge, nincs streak-valtozas. Reszletek: §8, Kernel file sandbox.
- **Transparency (B13).** `GET /api/v1/security/memory-policy` (`requirePermission read SecurityEvent` — owner/admin, absolute host paths). It returns `{policy: PathPolicy.describe(), sandbox: {mode: security.cliSandbox, providers: [{id, name, fileSandbox: FileSandboxInfo | null}]}, refusals: {windowHours: 24, since, memoryPathDenials, unsandboxedEscalations}}`; `sandbox.providers` lists the enabled CLI providers (claude-code, grok-cli, kimi-cli; all three when provider_config is absent). The builder is `src/modules/security-gate/memory-policy-report.ts`. `memoryPathDenials` counts `security_events` rows with decision=deny, checkpoint=deterministic, and a reason containing one of `MEMORY_PATH_REASON_MARKERS` (`src/shared/memory-sovereignty/deny-reason.ts`, kept in step with `memoryPathReason` / `memoryPathFailClosedReason` by a test; the fail-closed refusal has one wording on every channel). `unsandboxedEscalations` counts rows with decision=escalate and a reason containing `UNSANDBOXED_SHELL_REASON_TAG`. The window cutoff is an ISO timestamp compared against the ISO created_at. The Security events page renders it as `MemoryPolicyCard` (`src/web/src/pages/security/memory-policy-card.tsx`).
- **Proof (B14).** The isolation release gate (§8, Isolation release gate) runs a memory-sovereignty matrix per CLI provider through the real security-gate module: a native read and a shell `cat` of a store registered only in `security.foreignMemoryPaths`, a write into `<dataDir>/vault`, then a workspace read. Each refusal is exactly one `security_events` deny from this policy (checkpoint `deterministic`, never a rate limit) and a `denied` tool row; the workspace read after them works; the sentinel never reaches the model. Channels proven: the Claude Code PreToolUse hook → `gate.checkMemoryPath`, and the Grok ACP `session/request_permission` → `validateToolCall`. Verified free on Claude Code 2.1.281 and grok 1.0.41; Kimi Code CLI has no matrix row yet.

### Checkpoint 2 — LLM Security Judge

Kulon AI kontextus (NEM az executor AI). Fuggetlen, nem manipulalhato az executor altal.

- Policy-k alapjan dontest hoz
- **Sandwich prompt**: szabalyok a keres ELOTT es UTAN (szabalyok fogjak kozre a kerest)
- Ha megfelel: osszallitja az executor prompt-ot (szabalyok + keres + tiltasok)
- Ha NEM felel meg: visszakuldi a chat-be magyarazattal + rate limit szamlalo novelese

**Futtatas (C5).** The judge runs on the auxiliary model service (purpose
`security_judge`, safety group: heartbeat → quick, at most 2 candidates, the
next only after a retryable transport error) as an isolated one-shot with the
rules in `request.system`. Outcomes: no eligible model, budget_stop or every
candidate failing → escalate (human approval); unparseable or empty answer →
deny with no other candidate. The judge no longer produces `judge_error`; that
decision type remains only as a defensive fallthrough.

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
| `MEMORY.md` | Csak tulajdonosi jegyzet: nem kerul a promptba, es agens nem irhatja. A regi `memory/YYYY-MM-DD.md` fajlok a Workspace UI-ban csak olvashatok. |

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
- `suffix` = dinamikus: team kontextus, runtime, aktiv hang profil. A memoria es az ora (I4) nem resze a system promptnak: az `AssembledPrompt.turn` `<turn-context>` kerete az aktualis user uzenethez csatolva megy ki, igy a prefix es a suffix fordulorol fordulora bajt-stabil.
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
- `workspace_append` / `workspace_edit` — kizarolag az `AGENTS.md`-t es a `TOOLS.md`-t cellozhatjak; a Zod sema az `invoke()`-on belul is ujra ellenorzodik, igy egy executort megkerulo hivo sem er el memoria-fajlt

#### Master memoria-szerzodes (B8+I9)

- A `CORE_IDENTITY` memoria-pontja es a `CORE_RULES` 8. szabalya egyetlen szerzodes: memoria csak az EYAS-on at, olvasva es irva; egyetlen tool-par, `memory_search` / `memory_expand`; hivatkozas `[source:<id>]`; idegen tarak (`~/.claude`, `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, `~/.codeium`, OpenCode adatmappak, `ai-memory`, Obsidian vaultok) tilosak, es memoria-fajl sem a munkamappakban, sem a data dir-ben nem hozhato letre. A 7. szabaly (grounding) a `memory_search`-ot nevezi meg.
- A felidezes (I4) a fordulonkenti `<eyas-memory>` blokkban erkezik, az aktualis user uzenethez csatolt `<turn-context>` keretben; a master identitas memoria-pontja es a 8. szabaly ezt mondja ki. A korabbi szoveget hordozo zarolt sorok indulaskor frissulnek (szovegenkent egy prior-seed bejegyzes).
- Minden szallitott szovegvaltozas pontosan egyszer hozzafuzi az elozo torzset a seed-migracio `PRIOR_IDENTITY_BODIES` / `PRIOR_CORE_RULES` listajahoz. A zarolt, nem szerkesztett sorok ezutan hash alapjan frissulnek (a 0.8.16–0.8.23 `save_memory` szabalyt hordozo sorok is); a tulajdonosi szerkesztesekhez soha nem nyulunk. A cache-prefix a frissites utan egyszer valtozik.
- A `CORE_RULES`-nak bele kell fernie a `DEFAULT_BUDGET_FULL.coreRules` keretbe (800 token).

#### Runtime ora

A modellnek mutatott ora (I4 ota a `<turn-context>` keret `turn-time` szekcioja, nem a runtime szekcio) a `src/shared/clock.ts` `formatNow(timeZone)`-bol jon: a config `i18n.timezone` zonaja (Intl-en at Zod-validalva; ervenytelen ertek indulaskor config-hibat ad), kulonben a host zonaja (`TZ`, majd az OS). A datum es az ido mindig ugyanabbol a zonabol jon, az ido formaja `HH:MM (Zone, UTC±hh:mm)`. Nincs beegetett locale vagy zona (korabban fix kozep-europai ido UTC-datummal).

#### Kezbesitesi profil es ablak-feloldo (Delivery profile and window resolver)

1. **`src/modules/model/model-window.ts`** az egyetlen ablak-feloldo, `ctx.modelWindow`-kent publikalva; import-mentes, a web ujraexportalja. Precedencia (G11, E7): `model_config.context_window` → `PROVIDER_WINDOW` csak CLI fallbackkent (grok-cli 500k, kimi-cli 256k, claude-code 200k; egy 1M-es CLI modell-sor tehat 1M) → `DEFAULT_WINDOW` 200k. A `hasKnownProviderWindow` torolve; ez a kezbesitesi profilra (prompt-meretezes) is vonatkozik. Claude Code (K9): a first-boot seed (`claude-code/provider.ts` `KNOWN_MODELS`) es a discovery (`claude-code/discovery.ts` `claudeModelsFromDiscovery`) is a `claudeCodeWindowFor(alias, concrete?)`-bol veszi a modell ablakat: 1M csak a `[1m]` utotagnal, kulonben `pickContextWindow(null, 'claude-code')` (`PROVIDER_WINDOW` 200k). Minden provider-betolteskor a `claude-code/manifest.ts` `undiscoveredSeedDrift` az aktualis seedbol ujrairja azt a tarolt seed-sort, amelynek nincs `metadata.discoveredAt`-ja es az ablaka elcsuszott; az enabled valasztas es a missing jelzo marad, semmi nem kerul hozzaadasra vagy torlesre. `supportsTools`: `model_config.supports_tools` → true. A per-model capability rekord (reasoning registry) csak reasoning-tenyeket tart, es szandekosan nem ablak-forras (E7). A prompt-keret ezt olvassa; a context bar es a board csik a `conversations/context-occupancy.ts`-en at (§46, G11), ami a futasidoben jelentett ablakot es a rogzitett ablakot elorebb veszi (a korabbi, csak a conversations-ben elo `context-window.ts` es a beegetett 200k-s csonk megszunt).
2. **`src/modules/prompt-wizard/delivery-profile.ts`** buildenkent feloldja: {providerId, modelId, contextWindow, supportsTools, toolAddressing, drillDown, resolved}. Forras: `BuildOptions.target`, kulonben a model owner, kulonben a `model/binding.ts` `resolveDefault`. A `drillDown` csak tool-mentes modellnel hamis, vagy bridge-elt cimzesnel (Grok meta-tool / Kimi mcp-server), ha a CLI-MCP bridge self-testje lefutott es elbukott (§14).
3. **`token-budget.ts` `SectionBudget`:** zarolt kulcsok `coreIdentity` 600 / `coreRules` 800 / `personality` / `runtime` / `activeVoice` — ezek soha nem vagodnak (az identitas-keret 200-rol 600-ra nott, mert a szallitott szoveget kozepen vagta). Uj `memoryRecall` (alap = `memory.index.budgetChars` / 4); a `memoryContext` csak a working memory. Alap osszesen 10 000 token. `budgetForWindow(window)`: 100k-nal alapertek, a skalazhato szekciok ≥250k-nal legfeljebb 2,5×, ~29k alatt az egesz a window 35%-an belul; monoton. A felidezesi blokk (I4) a skalazott `memoryRecall` keretet tolti ki (az OpenCode task is, K10). Known gap: `budgetForWindow` covers the system prompt and the recall block only. Tool schemas travel unbudgeted over the provider tool API, and history is not fitted, so on 4k–32k windows a large toolset can still fill the window. Fitting them needs a tool-priority policy shared by the agent runner, the prompt inventory and the executor allowlist.
4. **`AssembledPrompt.delivery`** = {profile, budgetTotalTokens}. Az agent runner csak akkor koveti (explicit, vagy a systemPromptbol), ha egyezik a futas provider/modelljevel. `supportsTools=false` → nem kuldunk toolt, es a visszakapott tool-hivas nem fut; a feloldott ablak `ModelRequest.contextWindow`-kent megy ki. **Master variants (K7).** The master sections are chosen per delivery profile: `prompt-wizard/master-variant.ts` `masterVariantFor(profile)` returns 'no-tools' when `profile.supportsTools === false`. `renderMasterSections` then replaces, at render time only, every shipped tool paragraph (`core-identity.ts` `IDENTITY_TOOL_PARAGRAPHS`: memory, tools, hand-off and grounding bullets; `core-rules.ts` `CORE_RULES_TOOL_PARAGRAPHS`: rules 7 and 8) that is still present verbatim with its `withoutTools` wording. The swap never writes `prompt_templates`, never enters `PRIOR_*` or the seed migration, and leaves owner-edited paragraphs as written. `CORE_IDENTITY` and `CORE_RULES` are composed from the `withTools` texts, so they are byte-identical to the seeded rows. Each `withoutTools` text is no longer than its `withTools` text, so it fits the locked coreIdentity/coreRules caps. For the same profile the assembler also omits the skills inventory and the agent roster, besides the tool inventory. Tool-capable profiles keep canonical names plus the inventory's `toolAddressingNote` (item 6). Minden belepesi ut (chat fordulo, hatter-futas, team-tag, delegalt specialista, csatorna-valasz, board bot) a futas binding-jenek modelljet adja at (§8 D3/H4).
5. **Ollama:** a `num_ctx`-et a `ModelRequest.contextWindow`-bol szarmaztatja (csak a 4096-os default felett, a kovetkezo ketto-hatvany, az ablakra korlatozva), a `supportsTools`-t pedig az `/api/show` capabilities-bol.
6. **Tool-cimzes:** CLI providernel az available-tools leltar egy zarosorral mondja meg a host szerinti hivasi format (`toolAddressingNote`, §8 Tool addressing).

#### Tesztek

- `tests/integration/end-to-end-primary-agent.test.ts` — E2E: workspace bootstrap + assembler
- `tests/integration/sub-agent-delegation.test.ts` — delegalasi lanc hang-megorzessel
- `tests/integration/voice-scope-override.test.ts` — 5-szintu prioritas hierarchia
- `tests/integration/cascade-merge.test.ts` — project-type + project + agens AGENTS.md sorrendiseg
- `tests/performance/prompt-cache-anthropic.test.ts` — cache_control plumbing + gated 80% hit-ratio gate

---

## 45. Context Engineering Pipeline
> **Status: [DONE]** — Implemented as the recall service `ctx.memoryRecall` (src/modules/memory/v2/assemble.ts) plus the prompt assembler's `<turn-context>` frame (I4/I5, §13); `context-builder-v2.ts` is deleted

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

A `ctx.memoryRecall` epiti a felidezesi blokkot, a prompt assembler csatolja a `<turn-context>` keretben az aktualis user uzenethez minden belepesi uton (§13, Tartos memoria: felidezes kezbesitese). Az audit a context inspector `turn` zonaja es a `delivery.recall` rekord.

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
    memoryTiers: string[]       // Melyik tier-ekbol jott az info (G12: memory_tiers_used, lent)
    contextTokens: number
    systemPromptTokens: number
    toolDefinitions: string[]
  }

  // Execution
  toolCalls: {                  // G12: a trace API {name, id, executedBy?} alakban adja
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
    auto: number              // LEGACY (C12): nem irodik; csak regi sorokon van erteke
    userFeedback?: 'good' | 'bad'
    evaluatorModel?: string   // LEGACY (C12): nem irodik
  }
}
```

**Tool counts and memory tiers on every provider (G12).**
- The trace wrapper counts tool calls the same way for every provider: the
  final content's `tool_use` blocks plus the `tool_result` events settled inside
  the provider's stream, deduplicated by id. `tool_calls` lists `{name, id,
  executedBy?}` ('provider' or 'eyas' for calls a CLI settled itself), so
  Claude Code, Grok CLI and Kimi Code CLI turns no longer count 0 tools.
- `ai_traces.memory_tiers_used` = JSON counts per memory id prefix (vt, gs,
  ft, en, ep, rw) read from the composition's 'memory-recall' turn-section
  `source_ref` (`memoryTiersOf`); NULL when the turn carried no memory or the
  call has no composition (background calls).
- A call whose usage has `reported: false` costs only the cost the provider
  itself reported, otherwise 0; it is never priced from placeholder counts.

**Oszlopok (F2, E2).** Az `ai_traces` tabla egyetlen additiv-ALTER blokkja (`observability/schema.ts`, amit C9 es E2 bovit) kap egy `resolved_model TEXT` oszlopot, a `ModelResponse.resolvedModelId`-bol irva (NULL, ha nincs), `AiTrace.resolvedModel`-kent visszaadva; a traces UI a model oszlop alatt mutatja („answered by …"), ha elter. Tovabba `effort_requested`, `effort_effective` es `effort_source`. A hatter-hivasok (aux) a purpose-szel cimkezettek, az auto-title hivas a beszelgeteshez rendelt.

**Purpose columns (C9).**
- `purpose TEXT` (the background call's AuxPurpose from `request.metadata.purpose`; NULL for conversation turns) and `aux_route TEXT` (the auxiliary-ladder rung from `request.metadata.auxRoute`: tier | default | api | isolated-cli). Both are appended to the table's single additive-ALTER block after `resolved_model` and `effort_*`, with an index on `purpose`.
- `purposeGroup` is derived at read time through `AUX_PURPOSE_GROUP` and is never stored. An unknown purpose maps to null.
- `GET /api/v1/observability/traces` (read:AuditEntry) validates its query with Zod: model, provider, conversationId, from, to, minCost ≥ 0, purposeGroup ∈ AUX_POLICY groups, limit 1–500, offset ≥ 0; empty values count as absent, and anything invalid gets 400. `purposeGroup` filters on `purpose IN (the group's purposes)`.
- The Usage tab shows a Purpose column and filter. Background calls count toward the routing budget through `readSpendTotals` (§8).

### Context inspector (context_compositions)

The per-turn composition record (`observability/context-schema.ts`, written by `context-recorder.ts`) backs the conversation's context bar and the Context composition panel. One additive-ALTER block holds the W2 columns:

- **Window occupancy (G11).** `observed_prompt_tokens` (the last main-thread call's provider-reported prompt size, `ModelUsage.promptTokensLastCall`), `observed_context_window` (`ModelResponse.contextWindow`) and `history_estimated_tokens` (a chars/4 estimate of the messages sent). They are written by `recorder.record({historyEstimatedTokens})` and by `recorder.observe(compositionId, {promptTokens?, contextWindow?})`, which is Zod-checked and fail-open. Every agent-runner entry path wraps its run in `observeRunEvents(events, recorder, compositionId)`; the chat route reports through the turn sink, before the done frame. `conversations/context-occupancy.ts` is the one numerator/window source for the conversation header and the board: numerator = `observed_prompt_tokens ?? estimated_tokens + history_estimated_tokens` (measured flag); window = observed runtime window > window resolved at record (same provider/model only) > `resolveModelContextWindow`. `ModelUsage.promptTokensLastCall` is set only where the counts are one call's whole prompt: `toModelUsage(counts, {wholePrompt: true})` in the Anthropic, OpenAI and Gemini mappers; Claude Code sets it itself from message_start. It is never set from summed usage (Claude Code result, ACP) or from Ollama's `prompt_eval_count`.
- **Egress (D7).** `context_compositions.egress_json` holds the last call's locality, provider, transport, ruleset, calls, history/unattributed counts, toolResults per tool and transport (gateway last call plus accumulated bridge results) and byType. `context_sections.egress_masked`, `egress_spans` (`[[start,end,type]]` relative to the recorded content) and `egress_skipped` are written by the last remote call; all three are NULL for local calls, turn-zone sections and unlocated sections. The inspector's 'as sent' view = recorded content with spans replaced by `[TYPE]`.
- **Delivery (I12).** `delivery_json` is the delivery record: DeliveryProfile summary, budgetTotalTokens, recall `{ids, retrieved, expanded, chars, budgetChars, withheld, injectTurnId?}`, and `systemPromptChannel`, which `observe()` sets after an ACP call. `record()` is the only writer, fed on every entry path by `assemble-system.ts` `deliveryRecordFields`. The composition id is the recall's turn id (§13).
- `GET /api/v1/observability/compositions/:id` returns `composition.egress`, per-section `egress`, `composition.delivery` and `composition.drillDown {calls, reads, limit}` (null when not recorded; drillDown also null when the access log cannot be read). The list endpoint stays content-free. Detail rows are kept 7 days by default (`observability.contextRetentionDays`).
- **Memory delivery by provider (G12).** Read-only `GET /api/v1/observability/memory-parity?days=1..90` (default 7; `read AuditEntry`; an invalid value is 400), built by `memoryParity()` in `context-routes.ts`. It groups the window's `context_compositions` by the provider that answered (the composition's last `ai_traces` row, else the composition's or the delivery record's provider), and joins recall's per-item `inject` rows (turnId = composition id, or `delivery.recall.injectTurnId`) and the `drilldown_read` rows of `memory_access_log`. Per provider: turns, memoryTurns, avgItemsByLayer, avgItems, avgMemoryTokens, drillDownTurns, avgDrillDownCalls, avgDrillDownReads, and the latest 10 turns. It is bounded by the context-detail retention. The Context tab renders it as the 'Memory delivery by provider' card.

### Anomalia-detektalas

- **Koltseg kiugrasok**: hirtelen megnovekedett koltseg detektalasa + riasztas
- **Szokatlan viselkedes**: tul sok tool call, rendellenes valasz meret
- **Hallucination patterns**: ismetlodo teves valaszok felismerese
- **Latency drift**: lassulas detektalasa

### Dontesi lanc vizualizacio

Frontend oldalon interaktiv vizualizacio: adott feladat kapcsan milyen AI dontesek torttek, milyen kontextussal, milyen eredmennyel. Hasznos debug es optimalizacios eszkoz.

### Quality scoring

A minosegi pontozas csak felhasznaloi visszajelzes: thumbs up/down a chat-ben,
osszekapcsolva a trace-szel (`quality-scorer.ts` `recordUserFeedback`). Az
automatikus kis-modelles ertekelo (C12) torolve: soha nem volt bekotve, es
beegetett gyartoi modell-azonositot hasznalt. Az `ai_traces.quality_score_auto`
/ `evaluator_model` oszlopok a regi sorok miatt maradnak, de nem irodnak; a
Usage tab egy regi sor auto-pontszamat tovabbra is mutatja.

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
- Model binding (fixed / auto / inherit, §8 D3) es a top-bar model picker (H5)
- Conversation-board szinkronizalas

### Turn sink (G7)

- The chat route's two invocation branches (agent runner / direct gateway stream) feed one `createTurnSink` (`src/modules/conversations/turn-sink.ts`).
- `start` → `agent_start{agentId, maxTurns, binding?}`. `handle` maps AgentEvent/StreamEvent to ChatStreamFrame: text, thinking, tool_use (+rawName), tool_result, approval_required, progress (from step), notice, turn_complete. `annotate`: binding/effort, strict. `notice(code, params)`.
- `finish()` is idempotent and ends the turn once: attachment collectors → assistant message (answer, or only the partial answer on cancel/failure; the error text is never persisted, because it would be replayed as history) with the validated TurnMeta → status (idle, or waiting_approval when parked) → one cost record → one terminal frame → one post-turn memory capture.
- Usage is tallied per model call (`turn-meta.ts` `createUsageTally` / `buildTurnMeta`). The same tally is used by `executeAgent` and `channel-run-agent`.
- Interactive maxTurns = `resolveMaxTurns(agent.maxTurns)`, default `DEFAULT_AGENT_MAX_TURNS = 25` (`src/shared/turn-budget.ts`, also the CLI providers' default cap).
- **Image gate (H7).** After the binding is resolved, the chat route reads `supportsImages` for the turn's pair from model_config. When it is false, `stubUnsupportedImages` (`model/helpers.ts`) replaces every ImageBlock of the replayed history with `imageOmittedText`, and the route sends `notice{code:'imagesNotVisible', params:{providerId, modelId, count}}` through the turn sink right after agent_start (frame plus `TurnMeta.notices`). A model with no catalog row gets its images unchanged. God Mode participants stay ungated.
- **Privacy preflight (D6).** `conversations/privacy-preflight.ts` refuses a new message with block-class values bound for a remote destination before anything is stored (§40).

### Chat UI contract (G10)

The web consumes `ChatStreamFrame` from `src/shared/chat-stream.ts` directly, with no local frame union.
- Tool rows (store status running|success|error|denied|approval_required|skipped|unknown, `src/web/src/pages/conversations/tool-status.ts`) open on tool_use and settle only on tool_result, matched by toolUseId whatever their status. A row still running when the turn ends becomes 'unknown'.
- `components/stream-error.tsx` is the single error renderer, looked up in this order: `conversations.errors.<code>` (CodedModelError code + params; cliIsolation lists its checks as `conversations.errors.cliIsolation.check.<id>`), then `conversations.errors.<kind>` via the exhaustive `KIND_KEY: Record<ModelErrorKind, string>`, then `conversations.errors.other`. The raw detail is collapsed. HTTP refusals (`errorViewFromBody`) and connection failures render through it too.
- Generic notices are localized as `conversations.notice.<code>` (contextCompacted, imagesNotVisible, cliSandboxUnavailable), rendered live from the notice frame and afterwards from the stored reply's turnMeta (`turn-notices.ts`, `components/stream-notice.tsx`).
- approval_required and parked_for_approval become inline cards (`components/approval-inline-card.tsx`) that decide through `POST /api/v1/autonomy/approvals/:id/{approve,reject}` (CASL approve Autonomy).
- `components/message-meta.tsx` renders the persisted TurnMeta: outcome badge, usage with costSource (unknown means 'not reported', never $0), binding, effort chip, and the approvals count.
- `agent_start.agentId` is resolved to a display name in the web; progress frames drive 'Step N / Max', otherwise the tool-call count; turn_complete tokens are summed.
- Theme tokens `--success` and `--warning` (+ `--color-success` / `--color-warning`) are defined in `globals.css` and in every theme template, light and dark.

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

- The executor also exposes `renderForModel`, the single model-facing tool-result serialisation for transports outside the gateway (masks memoryBearing output via `ctx.privacy`, §40 D5).
- `authorize()` enforces `ToolContext.allowedTools` (`toolsetDenial`, H9, §14 Tool scope).
- `cli-exposure.ts` `selectBridgeTools` is the one rule for which tools a host CLI is offered over its EYAS bridge (H9), and `CLI_NATIVE_CAPABILITIES` the one table of which of the CLI's own built-ins an agent's tool list grants (K3, §14 Tool scope).
- `builtin/file-tools.ts` `walkFiles` leaves out protected folders and protected files (a database in the searched folder, a `security.foreignMemoryPaths` file, also when named directly), so EYAS's grep/glob are never refused as a too-broad search (K1, §41 memory-sovereignty path policy).
- The executor's log (`logExecution`, `tool_executions.run_id`) no longer captures L0 rows; run capture reads the runner's stream (§13 J8). The critic reads `toolNamesOfRuns` from it (I11).

---

## 55. Skill Evolution modul
> **Status: [DONE]** — Implemented in src/modules/skill-evolution/

Skillok teljesitmenykovehtese es automatikus fejlesztese. Gyujti a skill-hasznalati statisztikat, sikerességi aranyokat, es javaslatokat tesz a skill promptok finomhangolasara.

---

## 56. Hand Hub modul
> **Status: [DONE]** — Implemented in src/modules/hand-hub/

EYAS Hand companion alkalmazasok kozponti kezelese. WebSocket (WSS) kapcsolat tavoli gepekhez, auth hardening, node registry. Az EYAS Hand egy kulon repo (eyas-hand), cross-platform companion app amely remote machine hozzaferst biztosit.

---

## 57. Design modul
> **Status: [DONE]** — Implemented in src/modules/design/

Tobb-artboardos design canvas-ok a Claude Design konteneres formatumaban. Egy design a `designs` tablaban indexelt, de az igazsag a `<dataDir>/designs/<id>/` fajlfa: `<Name>.dc.html` artboardok, `canvas.json` elrendezes-manifest, es kepek **bare base64** szovegkent — pontosan ugy, ahogy a konteneres formatum a wire-on tarolja, igy az export masolas es nem konverzio. A verziozas append-only harmas (tabla + snapshot + verzio-sor); a `design_links` junction adja a tobb-tulajdonosu kotest (conversation, project, knowledge), a `document_links` mintajara.

A rendereles sajat MIT runtime-mal tortenik (`dc-runtime-source.ts`), amely stringkent szallitodik, mert az artboard sandboxolt iframe-jeben kell futnia: a `setState` ujrarendereli a sablont, tehat a kiterjesztes nem tortenhet egyszer az alkalmazasban. A runtime implementalja a formatum szemantikajat — `{{ pontozott.ut }}` lookup, `<sc-for>`, `<sc-if>`, `<dc-import>`, JSX-camelCase esemenyek, es a `class Component extends DCLogic` vegrehajtasa.

Ez a modul biztonsagi hatara a `dc-render.ts`: az iframe `sandbox="allow-scripts"` es **soha** `allow-same-origin` (a ketto egyutt atadna a szulo origin-jet egy AI altal irt scriptnek, a session pedig httpOnly cookie fejlec-alapu CSRF-fel), a srcdoc sajat CSP-t visel `connect-src 'none'`-nal, es az egyetlen kulso origin a Google Fonts. Az artboardot semmilyen route nem szolgalja ki dokumentumkent: a render endpoint JSON-ban adja vissza a srcdoc-ot es a sandbox erteket egyutt, igy a ketto nem csuszhat szet.

Minden iras — kezi, importalt, vagy barmelyik AI-fokozat eredmenye — atmegy a `validateCanvas` kapun, mielott verzio lehetne belole. A kapu a Claude Design sajat elutasitasait tukrozi (gyokerelem, artboard-nevek es case-insensitive stem-utkozes, hianyzo kephivatkozas, style-attributumon beluli ternary, canvas.json szigoru sema, launch- es page-hivatkozasok, 200/2 MiB/200/40 limitek), es ez teszi hasznalhatova a gyenge providereket is. Az AI-motor egy pipeline: kozos prompt, kozos kapu, es ket vegrehajto fokozat (egesz-canvas ujrairas, illetve artboardonkenti iteracio); egy elutasitott eredmenynel a validator sajat kimenete megy vissza visszajelzeskent, egyetlen ujraprobalassal. A `design_*` toolok `category: 'custom'` kategoriaval kerulnek a kozos registry-be, hogy a CLI providerekhez is eljussanak az MCP bridge-en at.

A WYSIWYG szerkesztesnek egy kenyszere van, ami mindent meghataroz: az iframe `allow-same-origin` nelkul fut, tehat **az alkalmazas nem er hozza az artboard DOM-jahoz**. Ezert nem az app parseolja es mutalja a sablont, hanem a runtime: parse-kor minden sablon-elem stabil sorszamot kap (`data-dc-i`), ez atkerul a renderelt elemre, es a szerkesztes postMessage-en megy — kijeloles, stilus-patch, szoveg-patch. A runtime a sajat sablon-masolatan modosit, ujraszerializal, es a **kesz template-forrast** kuldi vissza; az app a `dc-splice.ts`-szel illeszti be a `.dc.html` fajlba, ugy hogy a head-marker, a helmet es a logic-script bitre valtozatlan marad. Egy parser, egy helyen, es nincs renderelt-elem→forras visszakepzesi problema.

Ket reszlet, amiert igy kell: a stilus-patch a `style` attributumot SZOVEGKENT modositja deklaraciónkent, mert a DOM style API csendben tonkretenne a `{{hole}}`-t egy nem erintett deklaracioban; a splice pedig **visszaolvassa** az eredmenyt es osszeveti azzal, amit irt — a puszta "parseol-e" ellenorzes gyenge, mert egy sablonba keveredett `</x-dc>` korabban zarja az elemet, a fajl tovabbra is parseol, csak csonkan.

Az uzenetek opak originbol (`"null"`) erkeznek es pontosan annyira megbizhatatlanok, mint maga az artboard: az app a `contentWindow`-hoz koti oket, szigoru alakra validal, es semmit nem renderel vagy hajt vegre beloluk a sandboxon kivul. A runtime alapertelmezett modja `interact`, nem `edit` — a canvas mukodo prototipusokat mutat, a kijeloles elnyelne az artboard sajat kezeloit, ezert a szerkesztesbe lepes tudatos aktus. Egy `is_interactive`-nak jelolt artboard sosem lep edit modba.

### Nincs kulon arculat-entitas

Volt egy masodik entitas (`design_systems`: paletta, tipografia, hangnem, logo), sajat
tablaval, CRUD-dal, verziozassal, projekt-oszloppal, feluleti kartyaval, `brand_get`
toollal, megfelelosegi criticcel es app-boritassal. **Eltavolitva** — ket, egymashoz
kozeli fogalom (arculat es design) egyszerre felrevezeto, es ami hasznos volt benne, azt
a Design mar viszi: a csatolt vaszon artboard-forrasa bekerul a promptba, tehat az ugynok
latja a szineket, a tipografiat es a komponenseket.

Ami a torlest tullelte, es miert: a **determinisztikus HTML-renderer**
(`shared/html-document.ts`). Ez allitja elo az ertesito-emailt, a csatorna-valaszokat es
az email-piszkozatok torzsat, es **Markdownt fogad, sosem HTML-t** — ez biztonsagi
tulajdonsag, nem kenyelem: nincs sanitizer, mert nincs mit sanitizalni. A palettaja
mostantol konstans. Korabban minden szint es fontnevet interpolaciokor sanitizaltunk,
mert azok arculat-tokenek voltak, tehat nem megbizhato bemenet; ma literalok, es egy
sanitizer, aminek nincs mit sanitizalnia, csak egy kommentnek allcazott vedelem.

Az `agent.brandCriticEnabled` config, a `brand-context` prompt-szekcio es a hozza
kifaragott 800 tokenes budget is megszunt; a `projectCascade` visszakapta a teljes 3000-et,
az osszeg tovabbra is 8400.

### Amit a modell lat egy csatolt designbol: BEJELENTKEZES, nem adat

Harom alak volt kiprobalva, es a harmadik a mostani:

1. **Fajlnevek + „hivd a design_read-et"** — a modell stilus nelkuli oldalt adott,
   helyesen: nem mondtunk neki semmit, amit hasznalhatott volna, es a `design_read`
   ki is esett a csonkolt tool-leltarbol, tehat lekerni sem tudta.
2. **Fajlnevek + a derivalt paletta beagyazva** — mukodott, de MINDEN fordulon
   atadott ertekeket, hasznalta oket vagy sem, es a meret nott a vaszonnal.
3. **Bejelentkezes + reszenkenti lekeres** (mostani) — a blokk annyit mond, hogy a
   design ITT VAN, es hogy melyik resze MILYEN TIPUSU adatot tartalmaz. Erteket nem ad at.

**A szamtan, ami eldontotte:** a blokkot MINDEN forduló fizeti, a lekerest EGYSZER.
Ket fordulonal a lekeres mar olcsobb, es csak a lekeres az, ami nem no a vaszonnal.
Ezert nincs mar „kis vasznat beagyazunk egeszben" kivetel sem — nincs olyan meret,
ahol a beagyazas a jobb csere.

Merve a szallitott Odoo vasznon: **652 karakter egy 46 763 karakteres designra**,
es lapos marad — husz artboard ugyanabba a nehany szerep-sorba hajtogatodik, mint ketto.

A `design_read` ezert kapott **`part`** parametert (`tokens|typography|components|
patterns|page|other`). Korabban vagy EGY TELJES artboardot adott vissza, vagy az EGESZ
vasznat — tehat a „csak azt olvasd, amire szukseged van" a gyakorlatban azt jelentette,
hogy 10 KB-ot kell elolvasni ot hex kodert. A `part` egy szerep derivalt ertekeit adja
vissza es semmit a tobbibol, **ugyanabbol a derivaciobol**, amibol a bejelentkezes is
keszul — a ketto nem mondhat mast arrol, hogy mi letezik.

A szerep-szotar (`tokens`, `typography`, `components`, `patterns`, `page`) ezzel nem
csak rendezes, hanem **cim**: a `design-prompt.ts` ezt tanitja az uj designoknak, es
ez az, amit a modell lekerni tud.
### Design hozzarendelese: hol es hogyan

Egy design harom helyrol kerulhet a modell ele, es mindharom ugyanazt a
`design_links` tablat hasznalja (`owner_module` = `conversations` vagy `projects`):

- **Beszelgetes fejlec** — ikon, nem mezo: a felso sav tele van, es ez alkalmi
  muvelet. A jelvenyen a darabszam az egyetlen, aminek egy pillantasbol olvashatonak
  kell lennie.
- **Projekt urlap** — a projekthez csatolt designok, kozvetlenul a link-route-okon
  (many-to-many kapcsolat, nem oszlop). A szekcio ezert csak MAR LETEZO projektnel
  csinal barmit — nincs mihez linkelni, amig nincs id.
- **`design_link` / `design_unlink` tool** — `category: 'custom'`, tehat atmegy mindket
  MCP bridge-en a CLI providerekhez. Alapertelmezesben a futas SAJAT beszelgetesehez
  csatol (`ctx.conversationId`, nem a modelltol jovo ertek); a `scope` mezo zart
  nevter (`conversation` | `project`), nem szabad string — a modell nem talalhat ki
  egy owner modult, ahova a linket senki nem olvassa vissza.

**A projekt designjai MASOLODNAK, nem oldodnak fel olvasaskor.** Amikor egy beszelgetes a
projektben jon letre, a projekt designjai atkerulnek ra sajat linkkent — pontosan ugy,
ahogy az `indexedSources` es a `workingDirectories` (`board/routes.ts`,
`conversations/routes.ts`). Onnantol a beszelgetes birtokolja oket es barmelyiket
leveheti; nincs masodik, lathatatlan igazsagforras, amit minden fordulonal ossze kellene
egyeztetni, es nincs olyan sor a feluleten, amit a leszedes gomb ne tudna kezelni.
A masolas additiv es idempotens (`adoptProjectDesigns`), tehat nem tunteti el azt, amit
valaki szandekosan csatolt.


**Mindket modell-ut latja.** Az interaktiv chat F2 ota kapta; a hatter-futas
(`conversation-runner`) mostantol ugyanazt a `design-context` szekciot kapja, ugyanabban a
fail-soft try/catch-ben. Enelkul egy utemezett futas vakon dolgozott azon a designon,
amit az ugynok epp szerkeszteni volna hivatott.

### A vaszon kezelese

A vaszon panolhato (a hatter huzasaval) es zoomolhato. A kerek-kezelo **natívan**,
`passive: false` mellett van felkotve: a React sajat `onWheel`-je passziv gyoker-listeneren
megy, ahol a `preventDefault()` hatastalan — nelkule a Ctrl+kerek a bongeszot nagyitana a
vaszon helyett. A zoom a **kurzorra van horgonyozva**: ami a mutato alatt van, az ott is
marad, kulonben egy nagy vasznon navigalhatatlan.

Amit a frame-ek fole NEM tettunk: esemenyelnyelo attetsző reteget. Egy artboard sandboxolt
iframe, ami a keret- es eger-esemenyeket elnyeli, tehat a panolas csak a frame-eken KIVUL
mukodik. Egy overlay az egesz feluletet panolhatova tenne — de elnemitana minden
`is_interactive` prototipust is, amig bele nem kattint az ember. A hatter-huzas eleg, tehat
a csere nem eri meg; az artboard megnyitasa ezert nem gesztus a frame folott, hanem
kifejezett vezerlo a cimsoraban.

**Fokusz-nezet:** egy artboard megnyithato onmagaban (cim melletti gomb, vagy dupla
kattintas a cimen), `Esc` visszaall az elozo nezetre. Itt hasznaljuk vegre az
`artboardEntry.expand` mezot: `fit` (alap) az egesz artboardot a nezetablakhoz kicsinyiti,
`fill` a keretet a nezetablak szelessegere teriti termeszetes meretben es gorgetni hagyja —
ez az, amit egy fluid szelessegu terv akar. A „Fit" gomb a lap **tenyleges** befoglalojara
igazit (artboardok + jegyzetek), nem egy bedrotozott 60%-ra.

**Atnevezes:** a cim helyben szerkesztheto a fejlecben (`PATCH /designs/:id`), `Enter` ment,
`Esc` eldobja.

**Nincs statusz.** A `designs.status` oszlop (`draft|active|archived`) egy jelvenyt rajzolt a
listaban es semmi mast: nem befolyasolta a beszelgetesbe injektalast, a
nyomtatast vagy az exportot, a szurot senki nem hivta, es a feluletrol allitani sem lehetett.
Tehat fogyaszto nelkuli felulet volt — eltavolitva. Meglevo telepiteseken az oszlop bennmarad
inaktivan (`NOT NULL DEFAULT 'draft'`, tehat az ot kihagyó INSERT tovabbra is mukodik);
tabla-ujraepitest nem er meg. Ezt teszt rogziti.

### Torles

A `DELETE /designs/:id` az F2 ota megvolt; gomb nem tartozott hozza, es a felhasznaloi
kezikonyv ezt ki is mondta. Most a reszletezo fejlecen van, az atnevezes mellett — NEM a
lista-kartyakon, mert azok `<Link>` elemek, es egy destruktiv vezerlo egy navigacios
celpontban felrekattintasra var.

A megerosites megnevezi, mi vesz el: a mentett verziok szama es a **csatolasok szama**.
Utobbi az, amit a design sajat lapjarol nem lehet latni, ezert a `GET /designs/:id` valasza
egy `links` testvermezot is visz (`{ total, byModule }`, a `design_links` fole huzott
`COUNT(*)`). Vakon kerdezni a rosszabb valtozat.

### Az AI-szerkesztes futasai

A `POST /designs/:id/ai` **szinkron**, es meressel **8 perc 43 masodperc** volt egy CLI
provideren. Eddig az egyetlen nyom, hogy egyaltalan tortenik valami, egy React boolean volt:
egy ujratoltes, egy megszakadt kapcsolat vagy egy proxy olvasasi idokorlatja (az nginx alapja
60 masodperc) megsemmisitette a valaszt, mikozben a szerver befejezte a munkat.

Ezert minden kiserlet kap egy sort a `design_ai_runs` tablaban, **mielott** a modellt
megkerdeznenk, es a route MINDEN kijaraton lezarja — a dobason is. Ez nem naplozas, hanem
hibaturés: attol, hogy az eredmeny egy lekerdezheto helyre kerul, a valasz elvesztese mar
nem az eredmeny elvesztese. Az utvonalat NEM alakitottuk 202 + job-id-va: az csak a HTTP
tartas idejet roviditene, cserebe torne a meglevo API-szerzodest es a `commit:false`
jelolt-elonezeti utat.

- **Negy allapot:** `running | ok | failed | interrupted`. Egy ujrainditas altal arvan
  hagyott futas nem modell-hiba, es nem is ugyanazt az uzenetet erdemli — sajat vegallapotot
  kap, amit a modul regisztraciokor tesz ra minden meg `running` sorra. Elo futast csak az a
  folyamat ismer, amelyik a keresét kiszolgalja; ez a folyamat pedig epp most indult.
- **Epoch ezredmasodperc, nem ISO** — szemben a modul tobbi oszlopaval. Ez a ket oszlop
  azert letezik, hogy kivonjuk oket egymasbol, a `datetime('now')` pedig
  `YYYY-MM-DD HH:MM:SS`-t ad, amit a `new Date()` **helyi** idokent olvas: nema
  ora-elcsuszas minden nem-UTC bongeszoben.
- **A valasz viszi a szerver `now`-jat is.** A „mennyi ideje fut" ket ora kulonbsege:
  a kezdes a szerveré, a most a bongeszoé. A kliens ebbol egy eltolast szamol
  (`ai-run-view.ts`), es azon keresztul merik — kulonben a szam annyit teved, amennyit a
  ket gep nem ert egyet.
- **Nyesés:** designonkent az utolso 50 sor marad, minden inditasnal.
- A panel futas kozben szamlalot es „ez percekig tarthat" figyelmeztetest mutat, utana az
  utolso futast jelenti; a fejlec AI-gombja pörög futas kozben es piros pontot kap egy
  sikertelen utolso futasnal, tehat a panel megnyitasa nelkul is latszik. Amig egy futas
  `running`, ugyanazon a vasznon nem inditható masodik.

### Nyomtatas, PDF es PNG

A nyomtatasi utat egyetlen bongeszo-teny hatarozza meg: **a Chromium nem tordel iframe-en beluli tartalmat**. A keretet fix dobozkent rendereli es a tullogot levagja, tehat egy `print: 'flow'` artboard iframe-ben egy oldalkent, csonkan jonne ki. Ezert minden artboard **sajat, legfelso szintu dokumentumkent** rendelodik (`print-page.ts`), es a tobb-artboardos PDF ezeknek az egy-artboardos PDF-eknek az osszefuzese (`pdf-lib`, MIT).

Ez nem kerulout, hanem a jobb valasz. Egy brosura minden oldala megtartja a sajat termeszetes meretet (a PDF formatum oldalankent tarolja a MediaBox-ot), egy folyo riport tovabbra is tordelodik, es az egyik artboard `<helmet>` CSS-e nem szivarog at a masikba — ami pontosan az tortenne, ha tobbet mountolnank egy dokumentumba. A sorrend a vaszon olvasasi sorrendje: oldal, majd fentrol le, majd balrol jobbra.

A sandbox-attributum elvesz, ezert az izolacio harom retegbol jon, es mindharom kell: (1) minden oldal eldobhato `BrowserContext`-ben nyilik, cookie es tarolo nelkul, opak originnel; (2) a `context.route('**/*')` **minden kerest eldob** a formatum altal megengedett ket Google Fonts originen kivul — ez a valodi kerites, mert a bongeszo-folyamat kenyszeriti ki, nem egy meta tag; (3) ugyanaz az `ARTBOARD_CSP` meta tag, importalva es nem ujragepelve, hogy a ketto ne csuszhasson szet.

A meretezes: `print: 'fixed'` eseten az oldal pontosan az artboard kerete (a CSS pixel definicio szerint 1/96 hüvelyk, ezert atvaltas es kerekites nelkul adhato at), `pageRanges: '1'` kiseretében — egy pixelnyi tullogas kulonben egy ures masodik oldalt eredmenyez, ami egy poszter-exportban hibanak latszik. `print: 'flow'` eseten a papir A4 vagy Letter, es a szeles oszlop `scale`-lel zsugorodik; a keskeny oszlop **nem** nagyitodik fel, mert a szerzo azt a szelesseget valasztotta. PNG-nel a `deviceScaleFactor` a kontextuson all be — a `screenshot()` hivason megadva a Playwright csendben figyelmen kivul hagyja, es a @2x export 1x-ben szallitodik.

A bongeszo maga **opcionalis**. A `playwright-core` valodi fuggoseg (Apache-2.0, nincs postinstall, nincs sajat runtime fuggosege), a bongeszo-binaris viszont nem az: `EYAS_CHROMIUM_PATH` → a Playwright sajat regisztere → ismert rendszer-utvonalak, es ha egyik sincs, a `/api/v1/designs/print-status` `available: false`-t ad az orvossaggal egyutt, a felulet pedig letiltja a gombokat. A Chromium sandboxot **sosem** kapcsoljuk ki automatikusan: a renderer az, ami az AI altal irt artboard-JavaScriptet futtatja, tehat egy sandbox-hiba nem valthat at csendben sandbox nelkuli ujraprobalasra — ehhez explicit `EYAS_CHROMIUM_NO_SANDBOX=1` kell, es a hibauzenet ezt meg is mondja.

---

## 58. Media modul
> **Status: [DONE]** — Implemented in src/modules/media/ — core, `required: false`

Vendor-neutral media gateway. Negy opcionalis adapter MCP-n (`media.magnific`, `media.higgsfield`, `media.fal`, `media.heygen`); egyik sem default, tobb is futhat egyszerre. Ot unified tool: `media_generate`, `media_wait`, `media_catalog`, `media_balance`, `media_history`. Nulla konfiguralt provider = fail-closed (Fireflies minta). Kesz fajlok a documents modulba ingestelodnek es a termelo chat-turn attachmentjeihez csatolodnak. Settings → Media: connect, routing, budget. HeyGen: talking-head / Video Agent / speech; MCP a webes csomag kreditjet vonja, nem a REST API-egyenleget.

---

## 59. Studio modul
> **Status: [DONE]** — Implemented in src/modules/studio/ — core, `required: false`

Helyi, ugynok altal irt production engine-ek — **nem** Media. Media SaaS prompt→pixel; Studio HTML/kompozicio → fajl ezen a gepen. Elso engine: `studio.hyperframes` (Apache 2.0 CLI wrapper, nem vendored monorepo). Hat tool: `hyperframes_status`, `hyperframes_create`, `hyperframes_write`, `hyperframes_lint`, `hyperframes_render`, `hyperframes_list`. Hianyzo Node 22+ / FFmpeg / CLI = fail-closed orvossaggal. chrome-headless-shell, soha nem az EYAS Playwright Chromium, soha nincs automatikus `--no-sandbox`. UI: Tartalom → Studio (`/studio`). Kesz MP4 a documentsbe es a termelo turn attachmentjeire.

---

## 60. Browser Use extra modul (Python CLI + agent-browser)
> **Status: [DONE]** — Implemented in src/modules/browser-use/ — extra, `required: false`

Ket opcionalis sidecar, nem Studio, nem Media. Nyilvanos oldal: natív `browser_*`. Ajanlott tartós-auth sidecar: Vercel `agent-browser` (Apache-2.0, nincs vendored Rust): `EYAS_AGENT_BROWSER_BIN` → PATH, fail-closed `doctor --offline --quick --json`, toolok `agent_browser_status` / `agent_browser_run`, MCP `agent-browser mcp --tools core,state`. Saját `--profile` a `{dataDir}/browser/agent-browser/profile` alatt (Chrome 136: soha a napi Chrome Default). `chat` / AI Gateway / `--tools all` tiltva; az LLM az EYAS model modul. A Python `browser_use_exec` legacy sidecar marad. Playwright MCP kulon Connections-sor (a11y-ref). Chrome DevTools MCP kulon coding/debug sáv (konzol, HAR, Lighthouse, WebMCP) — nem űrlapkitöltés; WebMCP toolok csak ha a sidecar hirdeti (fail-closed).
