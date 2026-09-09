# Ticket-to-Code Pipeline — Design Spec

Date: 2026-07-09
Status: Approved (design); pending implementation plan
Scope: EYAS `pipelines/ticket-to-code` module (#42). Companion feature `ops` (#41) is shipped.

## 1. Context & Goal

The `ticket-to-code` pipeline is fully built — a 7-stage orchestrator
(ingest → pm-clarify → architect-design → dev-implement → review → pr-open → deploy)
with real stages that call four dependency **ports** (`TicketSourcePort`,
`AgentRunnerPort`, `ArtifactServicePort`, `PRClientPort`) plus an optional
`CheckpointPort`. It is **inert** only because nothing attaches `ctx.pipelineDeps`
at bootstrap; the module logs "skipped: ctx.pipelineDeps not provided" and never
mounts its routes.

Goal: wire the ports with concrete adapters over existing EYAS modules, attach
`pipelineDeps` at bootstrap so the routes mount, add off-by-default config, and
extend the PR provider to commit multi-file PRs — turning the built-but-inert
pipeline into a real, opt-in feature.

**Vendor-neutrality (hard requirement — see [[feedback_eyas_vendor_neutral]]):**
EYAS is a general, embedded, MIT assistant for anyone. The **only built-in ticket
source is the internal EYAS board**. No Odoo / eyssen.com / any-vendor coupling.
Git hosting (Gitea/GitHub) is a generic, operator-configured, off-by-default output
target, never a built-in dependency.

## 2. Locked Decisions

1. **Ticket source = internal EYAS board only.** `TicketSourcePort` adapter resolves a
   board conversation (`conversationService.get(id)`) into a `TicketContext`. External
   ticket backends are explicitly out of scope (and would only ever be generic,
   user-configured, optional adapters — never built-in).
2. **PR client = reuse #41 `PrProvider`, extended for multi-file commits.** `PullRequestInput.files[]`
   (add/modify/delete/rename) are committed to one branch, then one PR is opened. Provider is
   generic Gitea/GitHub; token from secrets (`pipeline-pr-token`); off unless configured.
3. **Off by default.** New config `pipelines.ticketToCode.enabled` (default `false`). When
   disabled or when required deps/creds are missing, the module does not mount its routes
   (honest inert, matching today's behavior).
4. **Default approval gate before `pr-open`.** `config.approvalGates` defaults to `{ 'pr-open': true }`
   so the run stops (`awaiting_approval`) for a human `approve Pipeline` before any PR is opened.
   Operators can gate additional stages (e.g. `dev-implement`).
5. **PR opened as draft** (`status: 'draft'`) — the PR is the human review surface; nothing merges
   or deploys autonomously.
6. **`deploy` stage stays a stub** (emits a deploy-manifest artifact only — no real deployment).
   Real deployment is explicitly out of scope.
7. **Checkpoint = no-op adapter** (save/load stubs). Wiring the real agent checkpoint subsystem
   is deferred (Cap 3 remainder).
8. **Separate `pipeline-pr-token` secret** (distinct from ops `ops-pr-token`); an operator may set
   the same value if they use one bot.

## 3. Scope

**In scope**
- Adapters: `ticketSource` (internal board), `agentRunner` (over `ctx.agents.runner`), `artifacts`
  (over `ctx.artifacts`), `prClient` (over extended `PrProvider`), `checkpoint` (no-op).
- Multi-file support on `PrProvider` (new `openMultiFilePullRequest` or extended `openPullRequest`).
- Attach `ctx.pipelineDeps` in the module `onStart` when enabled+configured; mount routes.
- `pipelines.ticketToCode` config (Zod) + `pipeline-pr-token` secret lookup + default approval gate.
- Tests (unit adapters + multi-file PR + wiring/route/gate). No real board write side effects beyond
  the test DB, no real agent call, no real PR in tests.

**Out of scope**
- External ticket backends (Odoo/GitHub issues/Jira). 
- Real deployment (deploy stays a stub).
- Real checkpoint/resume wiring.
- The pipelines frontend page beyond confirming routes are reachable (a dedicated UI is tracked
  separately; this spec ensures the API works and is CASL-gated).

## 4. Architecture & Components

### 4.1 ticketSource adapter (internal board) — new `src/modules/pipelines/ticket-to-code/adapters/board-ticket-source.ts`
```ts
export function createBoardTicketSource(conversations: { get(id: string): ConversationLike | null }): TicketSourcePort
```
- `fetchTicket(source, ticketId)`: `conversations.get(ticketId)`; if null → throw `Error('ticket not found: <id>')`.
  Map to `TicketContext`: `id`, `title` = conversation title, `body` = concatenated message text (or the
  first user message), `source` = the given source string (e.g. `'board'`), `reporter`/`createdAt` from the
  conversation. `raw` = the conversation object. No external calls.

### 4.2 agentRunner adapter — new `adapters/agent-runner-port.ts`
```ts
export function createAgentRunnerPort(runner: { run(o: AgentRunOptions): AsyncGenerator<AgentEvent> }): AgentRunnerPort
```
- `run(input)`: build `AgentRunOptions` from `{ agentId, sessionId, instructions, context, modelOverride }`,
  drain the async generator, accumulate `text` from `text`/`done` events, capture usage tokens, and attempt
  `JSON.parse` of the accumulated text (or a fenced ```json block) → `json`. Return `{ text, json, tokensIn, tokensOut }`.
  Errors from the runner propagate (the stage handles failure). Governance/security-gate still applies inside
  the runner — the pipeline does not bypass it.

### 4.3 artifacts adapter — thin wrapper (or direct) over `ctx.artifacts`
- `ctx.artifacts` (from the artifacts module) already exposes `create`/`getWithPayload`/`link`. Provide a small
  `createArtifactPort(ctx.artifacts)` that adapts names/shapes to `ArtifactServicePort` if they differ; otherwise
  pass through. Verified in the plan.

### 4.4 prClient adapter + multi-file PrProvider — extend `src/modules/ops/actions/pr-provider.ts`
- Add `openMultiFilePullRequest(input: { branch; baseBranch?; title; body; draft?; files: Array<{path; action; content?; renamedFrom?}> })`
  to `PrProvider` (Gitea + GitHub): create branch from base, then for each file PUT/DELETE its content on the branch
  (compute existing sha per file as in the single-file path), then open one PR (draft when requested).
- `createPipelinePrClient(provider): PRClientPort`: map `PullRequestInput.files[]` (resolve `patch`→`newContent` via
  jsdiff `applyPatch` against current content when only a patch is given, mirroring #41) → `openMultiFilePullRequest`,
  returning `{ provider, url, number, branch, status:'draft' }`.
- Reuses the #41 `createPrProviderFromConfig` shape; token key `pipeline-pr-token`.

### 4.5 checkpoint adapter — inline no-op
- `{ async save() {}, async load() { return undefined } }`.

### 4.6 Wiring (`ticket-to-code/index.ts` `onStart`)
- **Enable condition (decisive):** the module attaches `pipelineDeps` and mounts routes only when
  `ctx.config.pipelines.ticketToCode.enabled === true` AND a PR provider is fully configured (provider + owner
  + repo) AND the `pipeline-pr-token` secret is present. Otherwise it logs and returns (no routes) — inert but
  honest, exactly as today. (A pipeline with no way to open its final PR should not advertise itself.)
- When enabled+configured: build the five adapters, then set
  `ctx.pipelineDeps = { ticketSource, agentRunner, artifacts, prClient, checkpoint, logger, newId, now }` and let
  the existing `onStart` route-registration path run (it already reads `ctx.pipelineDeps`).

## 5. Config (`src/core/config/schema.ts`)
```yaml
pipelines:
  ticketToCode:
    enabled: false
    prProvider: null          # 'gitea' | 'github' | null
    prBaseUrl: null
    prOwner: null
    prRepo: null
    prBaseBranch: main
    approvalGates:            # stage -> require human approval after it
      pr-open: true
```
Zod: `pipelines` optional; nested defaults as above; `pipeline-pr-token` read from secrets at startup.

## 6. Security Model
- The pipeline only starts on an explicit operator action: `POST /api/v1/pipelines/ticket-to-code/start`
  (CASL `create Pipeline`). Autonomous runs are not triggered by this feature.
- Approval gate (default `pr-open`) stops the run for a human `approve Pipeline` before a PR is opened.
- Output is a **draft PR** — a human reviews and merges; nothing lands on the base branch or deploys automatically.
- `deploy` is a no-op stub; no cluster/deploy side effects.
- The agentRunner adapter runs through the real agent-runner, so the security-gate governs the agent's tool use.
- Off by default; missing enable/provider/token → inert (no routes) — no fake capability.

## 7. Data Flow
```
operator POST /start {source:'board', ticketId} (CASL create Pipeline)
 → ingest (board ticketSource → TicketContext) → pm-clarify → architect-design
 → dev-implement (agentRunner writes code diff → artifact) → review
 → [approval gate 'pr-open': run pauses awaiting_approval; human POST /:id/approve/pr-open]
 → pr-open (prClient → draft multi-file PR on the operator's repo) → deploy (stub manifest artifact)
run + stage state persisted; each stage output is an artifact linked in the graph
```

## 8. Testing Strategy
- `board-ticket-source.test.ts`: maps a conversation → TicketContext; not-found → throws.
- `agent-runner-port.test.ts`: drains a fake event generator → text + parsed json + tokens; propagates errors.
- `pr-provider-multifile.test.ts`: Gitea + GitHub multi-file open (mocked fetch) — branch, per-file PUT/DELETE,
  one draft PR; patch→content resolution via applyPatch.
- `pipeline-wiring.test.ts`: with `enabled:true` + a fake provider, `onStart` attaches `pipelineDeps` and mounts
  routes; with `enabled:false`, no routes.
- `pipeline-routes.test.ts` (extend existing): `start` requires `create Pipeline`; `approve/:stage` requires
  `approve Pipeline`; the `pr-open` gate pauses then resumes on approve. (Reuse fake ports; no real agent/PR.)
- No real board mutation beyond the test DB, no real agent call, no real PR.

## 9. Deployment & Credentials
- `pipelines.ticketToCode.enabled: true` + `prProvider`/`prOwner`/`prRepo` + `pipeline-pr-token` secret to use it.
  All default OFF → stock deploy is inert but honest.
- The operator points the PR provider at THEIR own repo; EYAS ships no default repo/host.

## 10. Phased, Approval-Gated Build Plan
Each phase is TDD, ends green (full suite + typecheck), and stops for review.
- **P1 — Multi-file PrProvider**: extend `pr-provider.ts` with `openMultiFilePullRequest` (Gitea+GitHub) + tests.
- **P2 — Adapters**: board ticketSource, agentRunner port (stream-drain + json parse), artifacts port,
  pipeline prClient, checkpoint no-op + tests.
- **P3 — Config + wiring**: `pipelines.ticketToCode` Zod config, `pipeline-pr-token` lookup, `onStart` attaches
  `pipelineDeps` + default `pr-open` gate; route + gate tests.
- Checkpoints: after P1 (shared PR block), after P2 (adapter review), before commit. Commit only on explicit request.

## 11. Risks & Mitigations
- **Autonomous code reaching a repo** → draft PR + `pr-open` approval gate + human merge; off by default.
- **Runaway agent cost** → runs are operator-started, one ticket at a time; agent-runner budget/governance applies.
- **Multi-file PR partial failure** (some files committed, PR open fails) → open PR as the last step after all
  file commits; on failure return honest error (the branch may exist — acceptable, operator can delete).
- **Vendor coupling regression** → only the internal board is a built-in source; reviewers reject any Odoo/eyssen
  reference (see [[feedback_eyas_vendor_neutral]]).
- **Security-gate bypass via the pipeline agent** → the agentRunner adapter uses the real runner; the gate still governs.
