# EYAS 1.0 — Stabilization & Completion Design Spec

> **Date:** 2026-04-06
> **Status:** Approved
> **Scope:** Full gap analysis remediation — 23 tasks across 5 waves
> **Execution:** Hybrid — RalphTUI (epic tracking) + subagents (parallel worktree implementation)

---

## Context

EYAS 1.0 has 22 modules implemented (~22,600 LOC backend, ~14,500 LOC frontend) but critical gaps remain:
- 43/80 test files FAIL (Bun/Node incompatibility)
- No WebSocket (real-time updates impossible)
- No CASL permissions (189-line stub, no policy enforcement)
- 9 modules from architecture spec not implemented
- No Dockerfile, no CLI, no streaming, no config hot-reload
- Missing industry protocols (A2A, full MCP)

Market research (2026-04-06) identified Mastra as closest TypeScript competitor. EYAS differentiators to preserve: single-process embedded, 5-tier memory, self-learning, agent team + board integration.

---

## Execution Architecture

### Hybrid Model

```
RalphTUI (Epic/Story tracking)    Subagents (Task implementation)
┌──────────────────────────┐      ┌────────────────────────────┐
│ Wave 1: Foundation        │─────▶│ 4 parallel worktree agents │
│ Wave 2: Core modules      │─────▶│ 5 parallel worktree agents │
│ Wave 3: Advanced features  │─────▶│ 4 parallel worktree agents │
│ Wave 4: Deploy + protocols │─────▶│ 3 parallel worktree agents │
│ Wave 5: Docs + polish      │─────▶│ 2 sequential agents        │
└──────────────────────────┘      └────────────────────────────┘
```

### Wave Gate Protocol

Each wave completes with:
1. All agents merge to main (no conflicts)
2. `bun run build` succeeds (0 TypeScript errors)
3. `vitest --run` passes (0 failures)
4. Manual smoke test on critical paths

Only then does the next wave start.

### Dependency Graph

```
Wave 1 (0 deps):
  ├── fix-tests
  ├── websocket-core
  ├── casl-permissions
  └── ollama-provider

Wave 2 (Wave 1 gate):
  ├── audit-module ─────────── needs CASL
  ├── notifications-module ─── needs WebSocket
  ├── privacy-module ────────── standalone (uses Ollama if available)
  ├── config-hot-reload ─────── standalone
  └── ai-streaming ──────────── needs WebSocket

Wave 3 (Wave 2 gate):
  ├── ai-observability ──────── needs audit
  ├── research-module ────────── standalone
  ├── a2ui-module ────────────── needs WebSocket + communication
  └── cli-interface ──────────── standalone

Wave 4 (Wave 3 gate):
  ├── a2a-protocol ──────────── needs communication
  ├── docker-k8s ────────────── standalone
  └── extra-modules ─────────── ingress, meeting, remote-node, DR

Wave 5 (Wave 4 gate):
  ├── full-integration-tests
  ├── architecture-spec-sync
  └── docs-update
```

---

## Wave 1 — Foundation (4 parallel agents)

### 1.1 Fix Tests

**Problem:** 43/80 test files FAIL. Root cause: `Bun.password.hash` and other Bun-specific APIs don't exist in Vitest (Node.js runtime).

**Solution:**
- Create `src/shared/platform.ts` — runtime detection (`typeof Bun !== 'undefined'`)
- Create `src/shared/crypto.ts` — `hashPassword()` / `verifyPassword()` wrappers
  - Bun: `Bun.password.hash(password, { algorithm: 'argon2id' })`
  - Node: `argon2` npm package (MIT licensed)
- Audit all `Bun.*` API usage across codebase, wrap each in platform abstraction
- Fix test collection errors (missing imports, broken paths)
- Add `vitest.setup.ts` with proper Bun API polyfills/mocks where needed

**New dependency:** `argon2` (MIT) — Node.js fallback only

**Files:**
- `src/shared/platform.ts` (new)
- `src/shared/crypto.ts` (modify — add password functions)
- `src/modules/auth/providers/local.ts` (modify — use shared crypto)
- `tests/**/*.test.ts` (fix collection errors)
- `vitest.setup.ts` (new or modify)

**Acceptance:** `vitest --run` → 0 FAIL, 0 collection errors, all 234+ tests pass.

---

### 1.2 WebSocket Core

**Problem:** Architecture spec §38 defines topic-based WebSocket. Nothing implemented.

**Solution:**
- `src/core/http/websocket.ts` — Hono WS upgrade handler
  - JWT auth via query param (`?token=...`)
  - Connection registry (Map<userId, Set<WebSocket>>)
  - Topic subscription: `subscribe(topic)`, `unsubscribe(topic)`
  - Heartbeat: 30s ping/pong, auto-disconnect stale connections
- `src/core/http/ws-bridge.ts` — Bus → WebSocket bridge
  - Pattern matching: bus event `eyas.board.task.*` → WS topic `board:<projectId>`
  - Configurable event→topic mapping
- Frontend hook: `src/web/src/hooks/use-websocket.ts`
  - Auto-connect on login, reconnect with exponential backoff
  - `useSubscription(topic, callback)` — React hook
  - Zustand store integration (board, notifications, agent stores auto-update)

**Topics:**
| Topic | Source events | Use |
|-------|-------------|-----|
| `board:<projectId>` | `eyas.board.*` | Kanban real-time sync |
| `notifications:<userId>` | `eyas.notify` | Push notifications |
| `agent:<sessionId>` | `eyas.agent.step` | Agent progress |
| `chat:<conversationId>` | `eyas.conversation.message` | Chat messages |
| `system` | `eyas.module.*`, `eyas.budget.*` | System status |

**Files:**
- `src/core/http/websocket.ts` (new)
- `src/core/http/ws-bridge.ts` (new)
- `src/core/http/server.ts` (modify — add WS upgrade)
- `src/web/src/hooks/use-websocket.ts` (new)
- `src/web/src/stores/websocket-store.ts` (new)
- `tests/core/websocket.test.ts` (new)

**Acceptance:** Open 2 browser tabs → drag card on board in tab A → card moves in tab B without refresh.

---

### 1.3 CASL Permissions Engine

**Problem:** permissions module is 189 lines — only roles table, no policy enforcement.

**New dependency:** `@casl/ability` (MIT)

**Solution:**
- `src/modules/permissions/ability-factory.ts` — builds CASL Ability from role + overrides
  - Role hierarchy: owner > admin > user > agent > guest
  - Subject registry: modules register their subjects on startup
  - Default rules loaded from `config/personality/permissions.yaml`
- `src/modules/permissions/middleware.ts` — Hono middleware
  - `requirePermission(action, subject)` — checks CASL ability
  - Returns 403 with clear error if denied
- `src/modules/permissions/schema.ts` — extend with `permission_overrides` table
  - Per-user, per-project permission overrides
- Apply middleware to ALL existing routes:
  - Admin routes (users, modules, secrets): require `admin` role
  - Protected routes (conversations, board, documents): require `user` role
  - Public routes (health, login, setup): no auth required
  - Agent routes: require `agent` role

**Files:**
- `src/modules/permissions/ability-factory.ts` (new)
- `src/modules/permissions/middleware.ts` (modify — add CASL)
- `src/modules/permissions/schema.ts` (modify — add overrides table)
- `src/modules/permissions/index.ts` (modify — subject registry)
- `config/personality/permissions.yaml` (new)
- `tests/modules/permissions/ability.test.ts` (new)
- All route files (modify — add permission middleware)

**Acceptance:** Guest user → GET /api/v1/users → 403. Admin user → 200.

---

### 1.4 Ollama Provider

**Problem:** Architecture spec lists Ollama as provider. Not implemented. Critical for privacy module (auto_local routing) and free embeddings.

**Solution:**
- `src/modules/model/submodules/ollama/` — standard submodule structure
  - `manifest.ts` — submodule manifest
  - `provider.ts` — OllamaProvider implementing ModelProvider interface
  - `adapter.ts` — Ollama REST API adapter (http://localhost:11434)
- API endpoints used:
  - `POST /api/chat` — chat completion (streaming via ndjson)
  - `POST /api/generate` — text generation
  - `POST /api/embeddings` — embedding generation
  - `GET /api/tags` — list available models
  - `POST /api/pull` — pull model (for setup)
- Auto-detection on startup: ping Ollama, if available → register provider + models
- Embedding integration: connect to memory module's embedding bridge
- Config: `config/personality/model-gateway.yaml` — ollama section (host, default model)

**Files:**
- `src/modules/model/submodules/ollama/manifest.ts` (new)
- `src/modules/model/submodules/ollama/provider.ts` (new)
- `src/modules/model/submodules/ollama/adapter.ts` (new)
- `src/modules/model/submodules/ollama/index.ts` (new)
- `tests/modules/model/ollama-adapter.test.ts` (new)

**Acceptance:** Ollama running locally → EYAS auto-detects → conversation works with local model → embeddings generated.

---

## Wave 2 — Core Missing Modules (5 parallel agents)

### 2.1 Audit Module

**Spec:** §12

**Schema:**
```sql
CREATE TABLE audit_entries (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  module TEXT NOT NULL,
  target TEXT,
  details TEXT, -- JSON
  result TEXT NOT NULL DEFAULT 'success', -- success|error|denied|rolled-back
  snapshot_id TEXT,
  reversible INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL
);

CREATE TABLE audit_snapshots (
  id TEXT PRIMARY KEY,
  audit_entry_id TEXT NOT NULL REFERENCES audit_entries(id),
  type TEXT NOT NULL, -- file|db_record|config|git_state
  original_data TEXT NOT NULL,
  path TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  restorable INTEGER NOT NULL DEFAULT 1,
  restored_at TEXT
);
```

**Service:**
- `AuditService.log(entry)` — create audit entry
- `AuditService.snapshot(entryId, type, data, path)` — create snapshot
- `AuditService.rollback(entryId)` — restore snapshot, create new entry with result='rolled-back'
- `AuditService.query(filters)` — search entries (userId, action, module, dateRange)

**Bus integration:** Listener on `eyas.*` events → auto-log. Configurable event→action mapping.

**Retention service:** Scheduler job — hot (30d keep) → warm (30-90d, compress details JSON) → cold (90-365d, archive table) → delete (>365d).

**Routes:**
- `GET /api/v1/audit` — list entries (pagination, filters)
- `GET /api/v1/audit/:id` — entry detail + snapshot
- `POST /api/v1/audit/:id/rollback` — execute rollback
- `GET /api/v1/audit/stats` — summary (actions/day, top modules, cost)

**Frontend:** `/audit` page — table with filters (user, action, module, date range, result), rollback button (confirmation dialog), stats cards.

**Diff tracking:** `fast-json-patch` (MIT) — compute RFC 6902 JSON patch between old and new state, store in details.

**Files:** ~10 files (schema, service, retention, routes, index, frontend page + store)

**Acceptance:** Edit conversation title → audit entry created with snapshot → rollback → title reverts.

---

### 2.2 Notifications Module

**Spec:** §24

**Schema:**
```sql
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  event TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info', -- info|warning|error|critical
  title TEXT NOT NULL,
  body TEXT,
  data TEXT, -- JSON
  read_at TEXT,
  channels_sent TEXT, -- JSON array
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE notification_preferences (
  user_id TEXT NOT NULL REFERENCES users(id),
  event_pattern TEXT NOT NULL, -- 'budget.*' | '*'
  channel TEXT NOT NULL, -- 'web' | 'telegram' | 'email'
  min_severity TEXT NOT NULL DEFAULT 'info',
  quiet_hours TEXT, -- JSON {"from":"22:00","to":"07:00"}
  PRIMARY KEY (user_id, event_pattern, channel)
);
```

**Router flow:**
1. Bus event `eyas.notify` received with { event, severity, userId, title, body, data }
2. Load user preferences for matching event_pattern
3. Filter by min_severity
4. Check quiet_hours (except severity=critical)
5. Rate limit check (configurable max N/hour per user)
6. Send to each enabled channel:
   - Web: WebSocket push to `notifications:<userId>` topic
   - Telegram: Grammy bot sendMessage (if user has paired Telegram)
   - Email: nodemailer (SMTP config in secrets)
7. Store in DB (channels_sent = which channels actually received it)

**11 built-in events:** budget.warning, budget.exceeded, agent.team.completed, agent.team.failed, scheduler.job.failed, self-learning.recommendation, remote-node.offline, audit.rollback.executed, board.task.assigned, system.upgrade.available, security.gate.blocked.

**Frontend:**
- TopBar notification bell (unread count badge)
- Notification panel (dropdown or slide-out): list with read/unread, mark read, mark all read
- `/notification-settings` page: event pattern → channel → min severity matrix
- WebSocket subscription: `notifications:<userId>` → auto-update badge count

**New dependency:** `nodemailer` (MIT) — email sending

**Files:** ~10 files (schema, router, channel adapters, routes, index, frontend components + store)

**Acceptance:** Agent completes → notification appears in bell → click marks as read → Telegram message sent.

---

### 2.3 Privacy Module

**Spec:** §40

**Scanner chain (sequential, each scanner adds to results):**

1. **RegexScanner** — always active, 0 dependencies
   - Hungarian PII: személyi szám (`\d{6}[A-Z]{2}`), TAJ (`\d{3}-\d{3}-\d{3}`), adószám (`\d{10}`), IBAN (`HU\d{2}\s?\d{4}(\s?\d{4}){5}\s?\d{4}`)
   - International: SSN, credit card (Luhn), email, phone, IP address
   - Returns: `PiiMatch[]` with type, value, start, end, confidence, scanner

2. **NerScanner** — optional, requires Ollama with NER model
   - Uses Ollama local model (GLiNER-PII compatible)
   - Lazy-loaded: only if Ollama available AND NER model pulled
   - Higher accuracy for names, addresses, organizations

3. **CustomScanner** — user-defined YAML rules
   - `config/personality/privacy.yaml` → custom patterns + actions
   - Example: company project names, internal codes

**Policy engine:**
| Action | Behavior |
|--------|----------|
| `auto_local` | If Ollama available → route to local model. If not → warn user |
| `warn` | Show warning in chat, user decides to proceed or cancel |
| `block` | Reject immediately, never send to cloud |
| `sanitize` | Mask PII with asterisks (`****`), then send to cloud |

**Integration points:**
- Model gateway: `privacy.scan(text)` called before every cloud AI request
- Communication module: scan incoming messages from external channels
- Audit: every PII detection logged

**Config:**
```yaml
# config/personality/privacy.yaml
privacy:
  enabled: true
  scanners: [regex, ner, custom]
  rules:
    - pattern: "personal_id|tax_number|iban"
      action: block
    - pattern: "email|phone"
      action: sanitize
    - pattern: "source_code"
      action: auto_local
  audit: true
```

**Files:** ~8 files (scanner-chain, regex-scanner, ner-scanner, custom-scanner, policy-engine, routes, index, config)

**Acceptance:** Send message containing "TAJ: 123-456-789" → scanner detects → policy action executes (block/sanitize based on config).

---

### 2.4 Config Hot-Reload

**Spec:** §37

**Implementation:**
- `src/core/config/watcher.ts`
  - `fs.watch(configDir, { recursive: true })` on `config/personality/`
  - Debounce: 300ms (ignore rapid successive changes)
  - On change: identify changed file → load YAML → Zod validate against schema
  - If validation fails: log warning, emit `eyas.config.reload.failed`, keep old config
  - If validation passes: update config registry → emit `eyas.config.reloaded` with { file, section }
  - Modules subscribe to `eyas.config.reloaded` and reload their config

**Reloadable files:**
| File | Consuming module |
|------|-----------------|
| `model-gateway.yaml` | model |
| `permissions.yaml` | permissions |
| `memory.yaml` | memory |
| `knowledge.yaml` | knowledge |
| `privacy.yaml` | privacy |
| `notifications.yaml` | notifications |
| `proactive.yaml` | proactive-assistant |
| `config/agents/*.yaml` | agent |

**Not reloadable (requires restart):** `default.yaml` (server config), `.env`

**Files:**
- `src/core/config/watcher.ts` (new)
- `src/core/config/index.ts` (modify — integrate watcher)
- `src/core/bootstrap.ts` (modify — start watcher after modules loaded)
- `tests/core/config-watcher.test.ts` (new)

**Acceptance:** Edit `config/personality/memory.yaml` → save → memory module reloads without server restart → log shows "Config reloaded: memory.yaml".

---

### 2.5 AI Response Streaming

**Problem:** AI responses arrive as complete blocks. No token-by-token streaming to frontend.

**Implementation:**
- Model gateway: `gateway.stream(params)` → returns `AsyncIterable<StreamChunk>`
  - Each chunk: `{ type: 'text_delta' | 'tool_use' | 'done', content: string, ... }`
  - All provider adapters implement streaming (Anthropic SSE, OpenAI SSE, Ollama ndjson, Gemini SSE)
- Conversations route: `POST /api/v1/conversations/:id/messages`
  - Response: `Content-Type: text/event-stream`
  - SSE events: `data: {"type":"delta","content":"Hello"}`, `data: {"type":"done","usage":{...}}`
  - On error: `data: {"type":"error","message":"..."}`
- Agent runner: streaming within tool-use loop
  - Partial results forwarded via WebSocket to `agent:<sessionId>` topic
  - Each tool call result streamed separately
- Frontend: `src/web/src/hooks/use-streaming.ts`
  - `EventSource` or `fetch()` with `ReadableStream` reader
  - Token-by-token append to message content in Zustand store
  - Typing indicator while streaming
  - Cancel button (AbortController)

**Files:**
- `src/modules/model/gateway.ts` (modify — add stream method)
- `src/modules/model/submodules/*/adapter.ts` (modify — implement streaming)
- `src/modules/conversations/routes.ts` (modify — SSE response)
- `src/modules/agent/agent-runner.ts` (modify — streaming integration)
- `src/web/src/hooks/use-streaming.ts` (new)
- `src/web/src/pages/conversations/components/conversation-messages.tsx` (modify)

**Acceptance:** Send chat message → response appears token-by-token → cancel button works mid-stream.

---

## Wave 3 — Advanced Features (4 parallel agents)

### 3.1 AI Observability

**Spec:** §46

**Schema:**
```sql
CREATE TABLE ai_traces (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  request_id TEXT NOT NULL,
  conversation_id TEXT,
  agent_session_id TEXT,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  memory_tiers_used TEXT, -- JSON array
  context_tokens INTEGER NOT NULL DEFAULT 0,
  system_prompt_tokens INTEGER NOT NULL DEFAULT 0,
  tool_definitions TEXT, -- JSON array of tool names
  tool_calls TEXT, -- JSON array [{name, durationMs}]
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  quality_score_auto REAL, -- 0-1, from evaluator model
  quality_score_user TEXT, -- 'good' | 'bad' | null
  evaluator_model TEXT,
  error TEXT
);
```

**Trace collector:** Hook into model gateway — wrap every `complete()` and `stream()` call:
- Before: capture input context (memory tiers, tools, token counts)
- During: capture tool calls (name, duration)
- After: capture output tokens, cost, latency
- Store as ai_trace record

**Quality scoring:**
- Auto: if enabled in config, call cheap model (Haiku) with: "Rate this response 0-1 for helpfulness and accuracy" + original query + response. Store score.
- User: thumbs up/down in chat UI → update trace record

**Anomaly detector:** Scheduler job (hourly):
- Calculate rolling 7-day averages for cost, latency, token count per model
- If current hour exceeds 2σ → emit `eyas.notify` with severity=warning
- Track patterns: sudden model switches, high error rates, unusual tool call counts

**Frontend:** `/observability` page:
- Trace list (table: timestamp, model, cost, latency, quality, tool calls)
- Trace detail view (decision chain: context assembly → model call → tool calls → response)
- Cost dashboard (line chart daily cost, pie chart model distribution, bar chart top agents)
- Anomaly alerts panel
- Filters: date range, model, provider, min cost, quality range

**New dependency:** `recharts` (MIT) — charts for dashboard (already used in frontend? check). If not, use lightweight alternative.

**Files:** ~12 files (schema, trace-collector, anomaly-detector, quality-scorer, routes, index, frontend page + components + store)

**Acceptance:** Chat conversation → trace appears in observability → cost dashboard shows data → anomaly detection runs.

---

### 3.2 Research Module

**Spec:** §21

**Architecture:**
- `src/modules/research/` — research-engine, web-search provider, source-evaluator, report-generator

**Web search provider pattern:**
| Provider | Type | Setup |
|----------|------|-------|
| `BraveSearchProvider` | API | API key in secrets |
| `SearXNGProvider` | Self-hosted | URL in config |
| `MockSearchProvider` | Test | Fixture responses |

**Deep research workflow (ResearchEngine):**
```typescript
async research(query: string, options?: { maxSources?: number, depth?: 'shallow' | 'deep' }): Promise<ResearchReport>
```
1. **Query expansion:** AI generates 3-5 related search queries from original question
2. **Web search:** Execute queries across search provider, collect URLs + snippets
3. **Source evaluation:** AI (Haiku) scores each source for relevance (0-1), filter < 0.5
4. **Content extraction:** Fetch top sources, extract main content (readability heuristic)
5. **Information synthesis:** AI (Sonnet) synthesizes findings into structured sections
6. **Cross-reference:** AI checks for contradictions between sources
7. **Report generation:** Markdown report with sections, key findings, source citations
8. **Storage:** Save to memory (semantic tier) + documents module (PDF optional)

**Tool integration:** Register `research` tool in tool registry → agents can trigger research autonomously.

**Routes:**
- `POST /api/v1/research` — start new research (returns jobId)
- `GET /api/v1/research/:id` — get research report
- `GET /api/v1/research` — list past research

**Frontend:** `/research` page — new research form (query input, depth selector), past research list, report viewer (markdown render with source links).

**Files:** ~10 files (engine, providers, evaluator, report-generator, routes, index, frontend page + store)

**Acceptance:** Submit research query → multi-step process runs → structured report with sources → saved to memory.

---

### 3.3 A2UI — Agent-to-User Interface

**Spec:** §48

**Shared types:** `src/shared/a2ui-types.ts`
```typescript
interface A2UIMessage {
  type: 'text' | 'form' | 'table' | 'buttons' | 'chart' | 'date_picker' | 'progress' | 'card'
  content: unknown // type-specific
  fallback_text: string
}

interface A2UIButtons {
  prompt: string
  buttons: Array<{ label: string, action: string, params: Record<string, unknown> }>
}

interface A2UITable {
  columns: Array<{ key: string, label: string, sortable?: boolean }>
  rows: Record<string, unknown>[]
}

interface A2UIForm {
  title: string
  fields: Array<{ name: string, type: 'text' | 'number' | 'select' | 'date' | 'checkbox', label: string, options?: string[], required?: boolean }>
  submitAction: string
}

// ... chart, date_picker, progress, card
```

**Message detection:** In conversation message rendering, detect if content is `A2UIMessage[]` (JSON parse attempt) → render widgets instead of markdown.

**Frontend components:** `src/web/src/components/a2ui/`
- `A2UIRenderer.tsx` — switch on type, render appropriate widget
- `A2UIButtons.tsx` — button group, onClick sends action back to agent
- `A2UITable.tsx` — sortable/filterable table using existing shadcn Table
- `A2UIForm.tsx` — dynamic form from field definitions, onSubmit sends form data
- `A2UIChart.tsx` — line/bar/pie using recharts
- `A2UIProgress.tsx` — progress bar with percentage + status text
- `A2UICard.tsx` — info card (title, body, footer actions)

**Channel adapters (communication module extension):**
- Telegram: buttons → inline keyboard, table → markdown formatted, form → sequential questions
- CLI: fallback_text for all types
- Web: full widget rendering

**Agent integration:** Agents can return A2UI messages via tool response or direct message content. Example:
```json
{
  "type": "buttons",
  "content": {
    "prompt": "Which deployment to restart?",
    "buttons": [
      {"label": "web-app", "action": "restart", "params": {"name": "web-app"}},
      {"label": "api-server", "action": "restart", "params": {"name": "api-server"}}
    ]
  },
  "fallback_text": "Which deployment? (1) web-app (2) api-server"
}
```

**Files:** ~10 files (shared types, 7 frontend components, channel adapter extensions, message renderer modification)

**Acceptance:** Agent sends buttons message → buttons render in chat → click button → action executes → result appears.

---

### 3.4 CLI Interface

**Spec:** §28

**Framework:** `citty` (MIT, unjs ecosystem) — lightweight, TypeScript-first CLI framework.

**Entry point:** `src/cli/index.ts` → `bin/eyas` (bun shebang)

**Commands (Phase 1 — this wave):**

```
eyas serve [--port N] [--host H] [--config PATH]
  Start the EYAS server

eyas doctor
  System diagnostics: platform info, config validation, DB status,
  module status, secret availability, budget status, node connectivity

eyas status
  Query running server status via API (GET /api/v1/status)

eyas config validate
  Zod-validate all config files, report errors

eyas config reload
  Trigger hot-reload via API (POST /api/v1/config/reload)

eyas module list
  Show all modules with status (enabled/disabled/error)

eyas module enable <id>
  Enable a module

eyas module disable <id>
  Disable a module

eyas version
  Show EYAS version, runtime info, build date
```

**Phase 2 commands (deferred to future, but structure supports them):**
- `eyas task`, `eyas agent`, `eyas memory`, `eyas skill`, `eyas backup`, `eyas notify`

**Implementation:** Each command is a separate file in `src/cli/commands/`. Commands that need API access use a shared HTTP client (configured from `default.yaml` or `--url` flag).

**Files:**
- `src/cli/index.ts` (new — main entry)
- `src/cli/commands/serve.ts` (new)
- `src/cli/commands/doctor.ts` (new)
- `src/cli/commands/status.ts` (new)
- `src/cli/commands/config.ts` (new)
- `src/cli/commands/module.ts` (new)
- `src/cli/commands/version.ts` (new)
- `src/cli/utils/api-client.ts` (new — shared HTTP client)
- `bin/eyas` (new — shebang entry)
- `package.json` (modify — add bin field)

**New dependency:** `citty` (MIT)

**Acceptance:** `eyas doctor` outputs system diagnostics. `eyas serve` starts the server. `eyas version` shows version.

---

## Wave 4 — Protocols & Deploy (3 parallel agents)

### 4.1 A2A Protocol

**New — based on market research. Google A2A spec (Linux Foundation).**

**Implementation:** `src/modules/communication/submodules/a2a/`

**A2A Server:**
- `GET /.well-known/agent-card.json` — serves EYAS agent card:
  ```json
  {
    "name": "EYAS",
    "description": "Personal AI assistant with multi-agent orchestration",
    "url": "https://eyas.example.com",
    "version": "1.0.0",
    "capabilities": {
      "streaming": true,
      "pushNotifications": false
    },
    "skills": [
      {"id": "research", "name": "Deep Research", "description": "..."},
      {"id": "code-review", "name": "Code Review", "description": "..."}
    ],
    "authentication": {"schemes": ["bearer"]}
  }
  ```
- JSON-RPC endpoint at `/api/v1/a2a`:
  - `tasks/send` — receive task from external agent
  - `tasks/get` — check task status
  - `tasks/cancel` — cancel task
  - Response streaming via SSE
- Auth: API key validation

**A2A Client:**
- `A2AClient.discover(url)` — fetch `/.well-known/agent-card.json` from remote
- `A2AClient.sendTask(agentUrl, task)` — send task to external A2A agent
- `A2AClient.getStatus(agentUrl, taskId)` — poll task status
- Registered as tool: `a2a-delegate` — agents can delegate to external agents

**Files:** ~8 files (server, client, agent-card, types, routes, manifest, index, test)

**Acceptance:** Valid agent card at `/.well-known/agent-card.json`. External A2A client can send a task and receive result.

---

### 4.2 Docker + K8s

**Dockerfile (multi-stage, multi-platform):**
```dockerfile
# Stage 1: install dependencies
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Stage 2: build
FROM oven/bun:1 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

# Stage 3: runtime
FROM oven/bun:1-slim AS runtime
RUN addgroup --system eyas && adduser --system --ingroup eyas eyas
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
USER eyas
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD ["bun", "run", "dist/cli/index.js", "status"]
CMD ["bun", "run", "dist/main.js"]
```

**docker-compose.yml:**
```yaml
services:
  eyas:
    build: .
    ports: ["3000:3000"]
    volumes:
      - eyas-data:/app/data
      - ./config:/app/config:ro
    environment:
      - EYAS_SECRET_PROVIDER=env
    restart: unless-stopped

  ollama:
    image: ollama/ollama
    ports: ["11434:11434"]
    volumes:
      - ollama-data:/root/.ollama
    profiles: ["gpu"]  # optional

volumes:
  eyas-data:
  ollama-data:
```

**K8s manifests** (`deploy/k8s/`):
- `deployment.yaml` — single replica, resource limits (256Mi-512Mi RAM, 200m-500m CPU), readiness/liveness probes (`/api/v1/health`), security context (non-root, readOnlyRootFilesystem)
- `service.yaml` — ClusterIP on port 3000
- `pvc.yaml` — PersistentVolumeClaim for data (storageClassName configurable, default `oci-bv` for OKE)
- `configmap.yaml` — personality YAML files
- `secret.yaml` — template for API keys
- `ingress.yaml` — optional, nginx-ingress or OCI LB annotations

**Files:**
- `Dockerfile` (new)
- `docker-compose.yml` (new)
- `.dockerignore` (new)
- `deploy/k8s/deployment.yaml` (new)
- `deploy/k8s/service.yaml` (new)
- `deploy/k8s/pvc.yaml` (new)
- `deploy/k8s/configmap.yaml` (new)
- `deploy/k8s/secret.yaml` (new)
- `deploy/k8s/ingress.yaml` (new)

**Acceptance:** `docker compose up` → EYAS starts → health check green → frontend accessible at localhost:3000.

---

### 4.3 Extra Modules

One agent, sequential. Each is a small module following established patterns.

**4.3.1 Ingress** (`src/modules/ingress/`)
- Provider pattern: CloudflareTunnelProvider (spawns `cloudflared`), ManualProvider (no-op, user handles reverse proxy)
- Config: `config/personality/ingress.yaml` (enabled, provider, tunnel token in secrets)
- Routes: `GET /api/v1/ingress/status`, `POST /api/v1/ingress/start|stop`
- ~5 files

**4.3.2 Remote Node** (`src/modules/remote-node/`)
- Node registry: `remote_nodes` table (id, name, host, capabilities JSON, status, last_seen)
- WebSocket client to remote daemon
- Capabilities: shell, docker, browser
- Routes: CRUD + `POST /api/v1/nodes/:id/invoke`
- ~6 files

**4.3.3 Meeting Processing** (`src/modules/meeting/`)
- MeetingProvider interface: connect, getTranscript, getSummary, getActionItems
- FirefliesProvider: GraphQL API adapter
- LocalProvider: stub (Whisper + Ollama pipeline, future implementation)
- Integration: action items → scheduler, transcript → memory (semantic), notification on completion
- Config: `config/personality/meeting.yaml`
- ~7 files

**4.3.4 Disaster Recovery** (`src/modules/disaster-recovery/`)
- BackupProvider pattern: LocalBackupProvider (tar.gz to data/backups/), S3BackupProvider (aws-sdk)
- Full backup: SQLite DB + config/ + data/vault/ + data/documents/
- Restore: integrity check → stop modules → restore files → restart → doctor run
- Scheduler job: configurable (daily/weekly)
- Routes: `POST /api/v1/backup/create`, `GET /api/v1/backup/list`, `POST /api/v1/backup/:id/restore`
- Config: `config/personality/backup.yaml`
- ~6 files

**Acceptance:** Each module registers, basic functionality works, tests pass.

---

## Wave 5 — Docs & Polish (2 sequential agents)

### 5.1 Full Integration Tests

**New test categories:**

1. **E2E lifecycle test:**
   Bootstrap → setup wizard (create root user) → login → create conversation → send message → receive AI response (mock) → create project → move conversation to board → search → shutdown

2. **Module interaction tests:**
   - Agent run → audit entry created → notification sent → WebSocket push received
   - Privacy scan → PII detected → action executed → audit logged
   - Config change → hot-reload → module picks up new config
   - CASL permission → guest blocked → admin allowed

3. **Security tests:**
   - CASL: each role can only access permitted routes
   - Privacy: PII patterns detected and handled
   - Security gate: blocked commands logged and notified
   - Auth: expired JWT rejected, API key validation

4. **Performance baselines:**
   - 100 concurrent WebSocket connections
   - 1000 conversation messages query < 500ms
   - Search across 10,000 chunks < 1s

**CI script:** `scripts/test-all.sh`
```bash
#!/bin/bash
set -e
echo "=== TypeScript check ==="
bun run typecheck
echo "=== Unit + Integration tests ==="
bun run test
echo "=== Build check ==="
bun run build
echo "=== Docker build ==="
docker build -t eyas:test .
echo "=== All passed ==="
```

**Files:**
- `tests/e2e/lifecycle.test.ts` (new)
- `tests/integration/module-interaction.test.ts` (new)
- `tests/integration/security.test.ts` (new)
- `tests/performance/baselines.test.ts` (new)
- `scripts/test-all.sh` (new)

**Acceptance:** `scripts/test-all.sh` exits 0. All tests green. Coverage report generated.

---

### 5.2 Architecture Spec Sync

Update `docs/eyas-architecture.md`:
- Each of the 48 sections gets implementation status: `[DONE]`, `[PARTIAL]`, or `[PLANNED]`
- Add new section §49: A2A Protocol
- Update §46 (AI Observability) with actual implementation details
- Update §31 (Implementation phases) with completed status
- Fix any discrepancies between spec and actual implementation
- Update dependency diagram

Update `docs/eyas-specification.html`:
- Sync with architecture spec changes
- Add new module descriptions

---

### 5.3 Documentation Update

**Files to create/update:**
- `README.md` — Quick start (docker compose up), feature list, architecture diagram (mermaid), contributing guide
- `docs/eyas-overview.html` — add new modules to feature list
- `CLAUDE.md` — add new modules, routes, CLI commands
- `CHANGELOG.md` — wave-by-wave summary of all changes
- `docs/api.md` — API endpoint reference (generated from route files, or manual)

**Acceptance:** README has working quick start instructions. CLAUDE.md reflects current module state. Architecture spec matches implementation.

---

## Summary

| Wave | Parallel agents | Tasks | Est. new files | Key deliverables |
|------|----------------|-------|----------------|-----------------|
| 1 | 4 | 4 | ~40 | Tests fixed, WebSocket, CASL, Ollama |
| 2 | 5 | 5 | ~55 | Audit, Notifications, Privacy, Hot-reload, Streaming |
| 3 | 4 | 4 | ~45 | Observability, Research, A2UI, CLI |
| 4 | 3 | 7 | ~50 | A2A, Docker/K8s, Ingress, Remote Node, Meeting, DR |
| 5 | 2 seq | 3 | ~20 | Integration tests, Spec sync, Docs |
| **Total** | | **23** | **~210** | Full gap closure |

## New Dependencies

| Package | License | Purpose |
|---------|---------|---------|
| `argon2` | MIT | Node.js password hashing fallback |
| `@casl/ability` | MIT | Permission engine |
| `fast-json-patch` | MIT | JSON diff for audit |
| `nodemailer` | MIT | Email notifications |
| `recharts` | MIT | Charts for observability dashboard |
| `citty` | MIT | CLI framework |

All MIT-compatible. No GPL/LGPL/AGPL/SSPL.
