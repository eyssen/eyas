# EYAS — Full-Scope Implementation Roadmap

**Created:** 2026-04-16
**Last status update:** 2026-04-17
**Scope:** Complete implementation of security fixes, email integration, inspiration-derived patterns, and new autonomous features.
**Approach:** Phased execution with parallel subagents where safe; every code change accompanied by tests written by a separate tester subagent.

---

## Status snapshot (2026-04-17)

All items below have landed on branch `claude/determined-wiles` unless
marked otherwise. Full state: 2346 tests passing / 0 failing / 3 skipped;
tsc 0 errors.

| Phase | Status | Notes |
|---|---|---|
| Phase 1 — Security (S1–S9) | ✅ done | S1–S6 + S9 earlier; Wave 1c (S5/S7/S8) in this branch |
| Phase 2 — Email (m365 / gmail / imap-smtp) | ✅ done | bridge + router wiring both in |
| Phase 3 — Inspiration patterns (A–M) | ✅ done | all 13 items shipped; 3E/3F runner-integrated |
| Phase 4 — Autonomous features (A–F) | ✅ done | ops, k8s manifests, email triage, ticket pipeline, client wiki, benchmarks |
| Phase 5 — Integration & polish | ✅ partial | Prometheus + OTel + i18n parity done; frontend dynamic reg + load harness + doc refresh pending (doc refresh in progress) |

Detailed per-item status lives in `docs/eyas-architecture.md`
("Implementation status" section).

---

## Constraints (from CLAUDE.md + user memory)

- Language: TypeScript strict, ESM, Bun-first
- License: MIT-compatible deps only
- No auto-commit, no new branches, no push without explicit permission
- Every protected endpoint: CASL permission check
- Zod validation on all external input
- Frontend required for every backend feature
- i18n hu namespace for all user-facing strings
- Test coverage required for all new code

## Phase Overview

| # | Phase | Parallelizable? | Est. effort |
|---|---|---|---|
| 1 | Security fixes (9 issues) + tests | Partial (disjoint files) | 2–3 days |
| 2 | Email: O365 + Gmail + Generic IMAP/SMTP + agent routing | High (per provider) | 3–5 days |
| 3 | Inspiration patterns (13 submodules) | Very high | 5–10 days |
| 4 | New features (6 modules) | High | 5–8 days |
| 5 | Integration, observability, load test, polish | Medium | 2–3 days |

---

## Phase 1 — Security hardening

Nine concrete issues from the code audit. Each gets a unit/integration test, some get targeted fuzzing.

| ID | File | Issue | Fix |
|---|---|---|---|
| S1 | `src/modules/scheduler/scheduler-service.ts:41` | No distributed lock | SQLite advisory-lock (`PRAGMA locking_mode`) + leader heartbeat row, fallback to in-process lock; add config flag |
| S2 | `src/modules/security-gate/llm-judge.ts:41`, `src/modules/agent/agent-runner.ts:153` | Fail-open on judge error | Return `decision: 'deny'` + typed error; remove silent catch in runner |
| S3 | `src/modules/tools/tool-executor.ts` | No sandbox, shell injection | Zod input schema per tool; `execFile` not `exec`; deny-list of shell metachars; timeout + kill-tree |
| S4 | `src/modules/secrets/routes.ts:17-26` + `secrets-registry.ts` | Scope bypass in list | `list(scope, requester)`: DB-level scope filter; reject cross-scope reads |
| S5 | `src/modules/privacy/index.ts:170-204` | Offset-based sanitization drifts | Replace with structure-aware walk (already is JSON) + typed masks; property path tracking |
| S6 | `src/modules/agent/budget-engine.ts:28` | `alertsSent` unbounded | LRU with TTL (e.g. 24h); eviction on reset |
| S7 | `src/modules/agent/orchestrator.ts:408-412` | Worktree zombies on SIGKILL | Register process-level cleanup (SIGTERM/SIGINT); startup GC of orphaned worktrees |
| S8 | `src/modules/agent/delegation.ts:17-32` | TOCTOU race | Single DB transaction wrapping validate+create |
| S9 | `src/modules/agent/agent-runner.ts:83` | `maxTurns` lets 40 tools per turn | Add `maxToolCallsPerTurn` + `maxTotalToolCalls`; token budget per loop |

**Library recommendations (from security hook):**
- Helmet.js on HTTP layer for response headers (check if already installed)
- SSRF filter (`ssrf-req-filter`) for any module that fetches URLs (research, ingress, meeting)
- Safe-regex check for any user-supplied regex (privacy, search)

**Done criteria:** `bun vitest run` passes; new tests cover each fix; no regression in existing 1350 tests.

---

## Phase 2 — Email integration

Providers: **Microsoft 365 (Graph API, OAuth2)**, **Gmail (Gmail API, OAuth2)**, **Generic IMAP/SMTP** (existing adapter, hardened).

### Submodule structure

```
src/modules/communication/submodules/email/
├── manifest.ts
├── index.ts                # channel adapter (unchanged interface)
├── providers/
│   ├── types.ts            # EmailProvider interface
│   ├── imap-smtp.ts        # generic (existing, hardened)
│   ├── microsoft365.ts     # NEW — Graph API
│   └── gmail.ts            # NEW — Gmail API
├── router/
│   ├── inbound-router.ts   # incoming email → agent pipeline
│   ├── thread-builder.ts   # In-Reply-To / References threading
│   └── signature-stripper.ts
├── parsing/
│   ├── mime-parser.ts      # MIME multipart, attachments
│   └── html-to-text.ts     # readability
└── schema.ts               # drizzle tables: email_accounts, email_messages, email_threads
```

### OAuth2 handling

- Tokens stored via `ctx.secrets` (encrypted at rest)
- Refresh token rotation with lock (prevent double-refresh)
- Setup wizard step for each provider (guided device-code flow for CLI)

### Agent routing

- `EmailReceived` event → router classifies → routes to conversation (existing or new)
- Classification: sender-binding rules table + fallback LLM classifier
- Respects `approval-tier` mode (auto-draft vs auto-send)

### Tests

- Mock IMAP/SMTP server (fixture-based)
- Graph/Gmail: recorded fixtures (no live calls in CI)
- E2E: inbound → agent → draft reply → approval

---

## Phase 3 — Inspiration-derived patterns

Each becomes its own submodule under `src/modules/` or submodule of existing module where it belongs. Every item gets a dev subagent + tester subagent.

### 3A. Event Sourcing (`src/modules/event-store/`)
**Source:** OpenHands V1 SDK
- Append-only event log table (`agent_events`: id, session_id, seq, type, payload, ts, actor)
- Event types: ToolCall, ToolResult, LLMCall, LLMResponse, StateTransition, ApprovalRequested, ApprovalGranted
- Replay engine: `replay(sessionId) → reconstructed state`
- Snapshots every N events for fast replay
- Deterministic: tool results must be recorded verbatim

### 3B. Checkpoint / Resume (`src/modules/agent/checkpoint.ts`)
**Source:** LangGraph
- Checkpoint = snapshot of conversation state + pending tool calls + memory deltas
- Auto-checkpoint on every completed turn
- Resume: `resumeAgentRun(checkpointId)` reconstructs context and continues
- Integrates with event-store (checkpoints are event seq pointers)

### 3C. Sleep-time Consolidator (`src/modules/memory/consolidator-agent.ts`)
**Source:** Letta MemGPT
- New scheduled agent (runs nightly, low-priority)
- Responsibilities:
  - Working → episodic → semantic promotion
  - Skill candidate extraction from successful traces
  - DeepWiki refresh (project summaries)
  - Orphan GC
- Uses existing memory tier infrastructure

### 3D. Graph-rank Context Selector (`src/modules/search/graph-rank.ts`)
**Source:** Aider
- Build dependency graph from AST indexer (already exists)
- PageRank over symbols (calls + references)
- `selectContext(task, tokenBudget)` → returns top-N relevant files/chunks
- Replaces naive recency-based selection in context builder

### 3E. Interactive Planning (`src/modules/agent/planning.ts`)
**Source:** Devin
- Complex-task detector (heuristic + LLM score)
- Plan generator produces structured artifact: goals, steps, risks, rollback
- Approval gate (user or PM-agent) before execution
- Plan stored in conversation; executor references plan-step-id in each turn

### 3F. Approval Tier Mode (`src/modules/security-gate/approval-tiers.ts`)
**Source:** Cline / Roo Code
- Three modes: `paranoid` (all actions), `balanced` (destructive only), `autopilot` (log-only)
- Per-user preference + per-tool-category override
- Destructive action preview: diff/dry-run before approval

### 3G. Flow vs Crew Dichotomy (`src/modules/agent/flow.ts`)
**Source:** CrewAI
- `Flow` = deterministic DAG, Zod-typed inputs/outputs per node
- `Crew` = open collaboration (existing team sessions)
- User explicitly chooses; SOPs become Flows

### 3H. Artifact-driven Handoff (`src/modules/agent/artifacts.ts`)
**Source:** MetaGPT
- Structured handoff: each role produces Zod-validated artifact
- Artifact types: PRD, DesignDoc, TaskList, CodeDiff, TestPlan, DeployManifest
- Registered in DB, versioned, referenced by next role in pipeline

### 3I. Mission Control Dashboard (`src/web/src/pages/MissionControl.tsx`)
**Source:** Cursor 2.0
- N running agents real-time grid view
- Per-agent: progress, tokens, cost, next-action preview, interrupt button
- Backed by WebSocket feed from event store

### 3J. Skill Auto-generation + A/B Validation (`src/modules/skill-evolution/` revamp)
**Source:** Hermes + validation best practices
- Trigger: successful completion of N-turn complex task
- Extractor: trace → skill template (description, tools, prompt)
- A/B runner: new skill vs baseline on sample tasks from internal benchmark
- Auto-adopt only if success rate improves by >5% with p<0.05
- Auto-rollback on regression

### 3K. Signed Metrics (`src/modules/observability/signed-metrics.ts`)
**Source:** RSA 2025 AIOps research
- Ed25519-signed telemetry (HMAC fallback)
- Tamper-evident metric stream for ops-agent input
- Key rotation via master-key module

### 3L. Docker-per-tool Sandbox (`src/modules/tools/sandbox/docker.ts`)
**Source:** Goose
- Optional wrapper: tool executes in ephemeral Docker container
- Volume mount limited to worktree
- Network mode configurable (none/bridge/host)
- Resource limits (CPU, memory, pids)

### 3M. ACI Output Truncation (`src/modules/tools/aci-layer.ts`)
**Source:** SWE-agent
- Per-tool output formatter: structured, truncated, LLM-friendly
- Long outputs: head + tail + "N lines truncated, query with pattern"
- Integrates with all existing tools

---

## Phase 4 — New autonomous features

### 4A. Ops-agent (`src/modules/ops/`)
- K8s custom controller pattern: `EYASIncident` CRD (declared as TS type, stored in DB)
- Observe loop: subscribes to K8s events, Prometheus alerts, log anomalies
- Diagnose: calls research-agent + runs `kubectl describe/logs` read-only
- Propose: produces action artifact (kubectl command, helm upgrade, etc.)
- Approve: routed through approval-tier
- Apply: GitOps — commits change to infra repo, PR opens; auto-merge only with 2 approvals (human + reviewer-agent)
- Integrated with signed-metrics

### 4B. K8s Manifests (`deploy/k8s/`)
- Helm chart for EYAS
- OCI-specific: `oci-bv` storageClass, flexible LB annotations
- NetworkPolicies for intra-pod traffic
- PodSecurityStandards: restricted
- Readiness/liveness probes → `/web/health`
- HorizontalPodAutoscaler (CPU + custom metric)
- External secrets integration (optional)

### 4C. Email Triage Agent (`src/modules/agent-templates/email-triage.ts`)
- Built on email + agent + approval-tier modules
- Per-message next-action: archive / quick-reply / todo / escalate / delegate
- Auto-draft replies (not auto-sent in `balanced` mode)
- Natural-language filter rules ("forward anything from Kovács to finance")

### 4D. Ticket-to-code Pipeline (`src/modules/agent-templates/ticket-to-code.ts`)
- MetaGPT-style SOP Flow (from 3G)
- Stages: ingest (Odoo project.task) → PM (clarify) → architect (design doc artifact) → dev-agent (code + tests) → reviewer-agent → PR → deploy
- Each stage produces Zod artifact; next stage consumes it
- Integrates with existing Odoo connector skill

### 4E. Client DeepWiki (`src/modules/client-wiki/`)
- Per-client (or per-project) living wiki
- Auto-updated by sleep-time agent from:
  - Codebase structure (AST indexer)
  - Recent PRs and decisions
  - Stored conversations
  - Customer communications
- Exposed as MCP resource to agents

### 4F. Internal Benchmark Suite (`tests/benchmarks/`)
- 50–100 tasks across: email triage, coding, ops, research, meetings
- Gold-standard outputs + rubric-based eval
- Regression check: every release runs full suite
- Cost + time + quality score per task
- Resistance to benchmark-gaming (per Berkeley 2025): randomized prompt variations, held-out set

---

## Phase 5 — Integration & polish

- Prometheus metrics exporter (`/metrics` endpoint)
- Jaeger/Tempo distributed tracing (OpenTelemetry)
- Frontend: dynamic module registration (replace static imports)
- Load test harness: 100 agents, 10k tasks, 1M memories
- Documentation refresh: architecture spec ↔ implementation sync
- Internationalization pass on new user-facing strings

---

## Execution discipline

1. Each phase-item gets a dedicated dev subagent and tester subagent
2. All code MIT-compatible; dependency licence-check before adding any package
3. No auto-commit: halmozzuk a változásokat, a user dönt mikor commitál
4. Every module ships with: manifest, index, types, tests, migration, frontend (if user-visible), i18n keys
5. Daily checkpoint: run full test suite, report pass/fail count
6. Failure protocol: if a subagent's implementation breaks existing tests, halt, revert, investigate before continuing

---

## Kickoff order

Phase 1 → Phase 2 (parallel start after Phase 1 mid-point)
Phase 3 + Phase 4 (parallel, internal parallelism high)
Phase 5 (after 3 + 4 converge)

Phase 1 cannot parallelize fully (overlapping files in agent module), so 3 waves:
- Wave 1a: S1, S3, S4 (scheduler, tool-executor, secrets — disjoint)
- Wave 1b: S2, S6, S9 (security-gate + agent-runner + budget — agent module)
- Wave 1c: S5, S7, S8 (privacy, orchestrator, delegation)
