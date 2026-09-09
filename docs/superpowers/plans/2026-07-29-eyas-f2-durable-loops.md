# EYAS F2 — Durable Loops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Process override (owner mandate):** subagents NEVER commit, NEVER create branches, NEVER push. Work directly on `main` working tree. Diffs are taken via tmp-index `git write-tree` snapshots by the controller.

**Goal:** Close the autonomy loops left open after F0/F1: park-and-resume approval (durable interrupt for gated tool calls), verification-before-done (completeness critic + honest `max_turns`), auto-retry/failover (error-transport unification, gateway tier-failover, boot warm-resume, team-session durability), ownership-scoped WS/REST surfaces, and the tokens/cost producer.

**Architecture:** Everything rides shipped machinery: the every-turn checkpoint + `resumeRun` warm-resume becomes the park/critic/retry re-entry point; the `autonomy_approvals` table becomes a durable one-shot grant ledger (`arg_hash` + CAS consume); supervision (`beginRun`) is extended to team/delegation runs so every autonomous shape has a run row, checkpoints, an event-store transcript, and ownership; the WS registry's already-received-but-discarded `userId` becomes the subscribe-time ACL hook.

**Tech Stack:** Bun 1.x, TypeScript 5.9 strict ESM, Hono, Drizzle + bun:sqlite (runtime `CREATE TABLE IF NOT EXISTS` + try/`ALTER` migrations — NO drizzle-kit), Zod, Pino, Vitest, React 19 + Zustand (src/web).

**Recon ground truth:** 6 verified recon reports + critic in scratchpad `f2-design/` (A approval, B lifecycle, C verification, D retry, E ws, F cost, G critic). All file:line refs below were verified there on main @ 6446b9b/d16379b. The critic's cross-cutting seams S1–S10 are each assigned to a task below.

## Global Constraints

- All new user-facing UI strings ship in **en + hu + de + es** (i18n-parity contract test enforces). WS/REST payloads carry **machine enum codes, not prose** (thin-frame rule).
- Vendor-neutral: no provider hardcoding; model access via tier resolution (`decisionEngine.resolveForTier`) through the **lazy** gateway (`createLazyGateway`) so privacy + tracing wrappers apply.
- Security fail-closed: unknown → deny/escalate; ownership checks fail closed on unresolvable ids; no secrets/args on global WS topics.
- Schema changes: idempotent runtime DDL in module `onRegister` (pattern `run-supervisor.ts:73-104`) **and** the Drizzle mirror in the module's `schema.ts` kept aligned.
- Pino logging only, no `console.log`. Zod on all external input. `/api/v1/` prefix. Version freeze — no version bumps.
- Tests: Vitest under `tests/`, following existing contract-test patterns. Every task ends green: `bun run typecheck` (backend + web) and the affected test files pass; full suite at final review.
- Both WS server copies (`src/main.ts`, `src/cli/commands/serve.ts`) must stay behavior-identical when touched.

---

## Decision Log (owner-approvable; each Dx is referenced from tasks)

- **D1 — Park scope:** Extend `beginRun` supervision to team subagent runs and `executeAgent` (delegation + pipeline port) with new `kind` values `'team'` / `'delegation'`. All supervised autonomous shapes (background, team, delegation, pipeline) get park-and-resume. Interactive chat is NOT parked — it gets the grant flow only (approve → next attempt auto-allows). This resolves the F0 hard-deny on locked categories for delegation/team/pipeline runs.
- **D2 — Park mechanism:** Durable **deny+park**: on escalation in an autonomous supervised run → persist approval (with `input_json`, `arg_hash`, `run_id`, `expires_at`), end the runner loop with a `parked_for_approval` event, set run `waiting_approval` + conversation `waiting_approval`. NO in-process `canUseTool` hold (SDK runtime behavior unverified — critic U1; no spike in F2). CLI-provider shape parks post-turn via an approval sink threaded to the permission bridge; autonomous CLI escalations deny with `interrupt: true`.
- **D3 — Resume:** Approval-approve triggers a **bus subscriber** (`autonomy:approval-resolved`) in the agent module → `resumeParked()` → `resumeRun(runId, …, {seedFromCheckpoint: true})` (new run, `parent_run_id` lineage). Resume failure is observable: `autonomy_approvals.resume_error` set, run stays `waiting_approval`, and an hourly sweep retries approved-but-unconsumed approvals (also covers boot ordering — S3).
- **D4 — Grant ledger (exactly-once):** The approval row itself is the grant: `status='approved' AND consumed_at IS NULL AND arg_hash matches AND not expired` → allow + CAS-consume (`UPDATE … SET consumed_at WHERE consumed_at IS NULL`). Checked in all three gate paths before escalate. Changed args → no grant → re-escalate (re-park). Re-park cap: 5 approvals per run lineage → run fails with `approval_loop`.
- **D5 — Reject/expiry semantics:** Operator reject and TTL expiry both warm-resume ONCE with an injected denial guidance message ("denied: do not retry this action; complete another way or report the blocker"). TTL default 72h (`security.approvalTtlHours` config), `expireStale` wired into the hourly sweep (S9).
- **D6 — Status vocabulary (S2-hardened):** `agent_sessions` gains `waiting_approval` (non-terminal) and `max_turns` (terminal). `conversations` gains `waiting_approval`. PATCH `/conversations/:id` gets Zod validation; client-settable `status` whitelist = `{'idle','waiting','archived'}`; `totalCostUsd` stripped alongside `teamSessionId`. Type unions fixed (`stuck` added; phantom `refreshing` removed from backend types, kept mapped in web until follow-up). `waiting_approval` counts as ACTIVE for the retry-route 409 guards (S4). `max_turns` joins RETRYABLE in the UI and is excluded from the self-learning completed-runs miner.
- **D7 — Critic:** Runs for every supervised run that would finalize `completed` (skipped on `max_turns`/`failed`/`cancelled`). Fail-open: model unavailable / unparseable → `verification='unverified'`, run still completes. Tier ladder `heartbeat → quick` via `resolveForTier`, nonce-sandwich + strict single-JSON verdict (llm-judge pattern). One feedback round max (`critic_rounds`, default cap 1, config `agent.criticMaxRounds`): verdict incomplete → `resumeRun` with a synthetic reviewer-feedback user message — NEVER via the board `'waiting'` arm state (S5). Second failure → `completed` + `verification='failed'` badge.
- **D8 — Planning as rubric:** `planning.ts` is wired as **plan-as-rubric only** for background runs above the existing complexity threshold: fail-open `generatePlan`, persisted to new `agent_plans` table, step list injected via reinjection; critic judges against `steps[].successCriteria` when a plan exists, else the goal. No approval UI (no new translated surface).
- **D9 — Error transport + taxonomy (prerequisite):** Providers ALWAYS throw on failure: grok-cli rethrows after yielding `error`; claude-code throws on non-`success` result subtypes. New shared `classifyModelError` extends `classify-auth-error` with kinds `timeout | network | aborted | invalid-request | provider-run-error`; retryable set = `{rate-limit, overload, timeout, network}`.
- **D10 — Gateway failover:** Inside `createModelGateway`: on retryable error → one same-provider retry (1s backoff); cross-provider tier-fallback ONLY when the request carries `metadata.tier` (stamped by the decision engine on auto-routed calls) and the tier config has `fallbackProviderId/ModelId`. Explicit provider-pinned requests never fail over cross-provider. Streaming retries only before the first yielded chunk.
- **D11 — Run auto-retry:** Background (`kind='background'`) runs only. On retryable `error_kind`, `attempts < 3` → `next_attempt_at` backoff (1/5/15 min), hourly+minute sweep resumes via `resumeRun`. Attempts = failure-retry count only; approval resumes do NOT increment (D13/S4). Boot: `recoverOrphans` keeps cold-marking `failed` (`error_kind='restart'`), then a deferred post-boot pass warm-resumes checkpoint-bearing background orphans and resets crashed `'working'` conversations to `'idle'`. `waiting_approval` rows survive restart untouched.
- **D12 — Team-session durability:** Persist `current_phase`/`phase_status` on `team_sessions` + new `team_phase_results` table. `executeTeam` driver extracted so the approve route, the resume route (post-restart), and the boot scan share it. `paused` sessions wait durably; `running` orphans re-drive from the phase cursor.
- **D13 — Budget engine:** `createBudgetEngine` instantiated in agent module; `addTokenUsage` call sites route through `budgetEngine.trackUsage`; `wireBudgetReset` switches to `budgetEngine.resetAll()` (clears `alertsSent`). The F1 WS alert pipe goes live with zero further wiring.
- **D14 — WS/REST ownership:** Subscribe-time ACL: per-prefix resolvers registered on ctx (fail-closed for unknown per-id prefixes; globals stay authenticated-only), fresh per-subscribe user role lookup, owner/admin override sees all. NACK frame `subscribe_denied` (machine keys only — no new UI strings). `notifications:<userId>` bound to the socket user. REST twins scoped in the same wave: `routes-orchestration` ownership-filtered; autonomy approvals list ownership-scoped for non-admins with `input_json` projected out (S1). `board:<projectId>` deferred (no membership model). Sockets closed on logout/suspend; periodic socket TTL = follow-up.
- **D15 — Cost producer matrix:** ai_traces (gateway tracing wrapper) = per-call ledger, gains attribution from `metadata` incl. new `metadata.runId`; run-boundary rollups (single source: the runner's own accumulation) write `agent_sessions.tokens_used/cost_usd`, increment `conversations.total_cost_usd`, and orchestrator accumulates `team_sessions.total_cost_usd`. claude-code surfaces SDK-reported `total_cost_usd` + cache tokens (authoritative over estimates); pricing moves to a config-backed table with local providers pinned $0. `ctx.agentDailyStats` bound from `agent_sessions`. Historical rows stay $0.00 (accepted; CHANGELOG-disclosed). Agent budgets stay token-denominated in F2.

---

### Task 1: Error-transport unification + model error taxonomy + gateway failover (D9, D10)

**Files:**
- Create: `src/shared/classify-model-error.ts`
- Modify: `src/modules/model/submodules/grok-cli/provider.ts` (~:338-352), `src/modules/model/submodules/claude-code/provider.ts` (~:499), `src/modules/model/gateway.ts` (:99-120), `src/modules/model/index.ts` (gateway construction + tier lookup injection), `src/modules/model/routing/decision-engine.ts` (stamp `metadata.tier` on route results' consumers) and `src/modules/model/types.ts` (`ModelRequestMetadata.tier?: RoutingTier`), `src/modules/conversations/index.ts:104` (lazy gateway — fixes the tracing bypass, recon F §2a)
- Test: `tests/modules/model/classify-model-error.test.ts`, `tests/modules/model/gateway-failover.test.ts`, extend `tests/modules/model/providers/grok-cli.test.ts` + claude-code provider tests

**Interfaces:**
- Produces: `classifyModelError(e: unknown): { kind: 'auth'|'rate-limit'|'overload'|'timeout'|'network'|'aborted'|'invalid-request'|'provider-run-error'|'other'; retryable: boolean }` — `retryable === kind ∈ {rate-limit, overload, timeout, network}`.
- Produces: `ModelRequestMetadata.tier?: RoutingTier` (optional; only auto-routed calls carry it).
- Produces: new error class `ProviderRunError extends Error { subtype: string }` (claude-code non-success result subtypes).

**Steps:**

- [ ] **Step 1: Failing tests for the classifier.** Cases: status 429 → rate-limit/retryable; 529 → overload/retryable; 401 → auth/terminal; `AbortError` name → aborted/terminal; `ETIMEDOUT`/`fetch failed`/`ECONNRESET` message → timeout|network/retryable; status 400/404/422 → invalid-request/terminal; `ProviderRunError` → provider-run-error/terminal; unknown → other/terminal.
- [ ] **Step 2: Implement `classify-model-error.ts`** delegating status/regex extraction to `classify-auth-error.ts` (reuse, don't duplicate), adding the new buckets. Distinguish caller-abort (`signal.aborted` / `AbortError`) from provider timeout by name+message.
- [ ] **Step 3: grok-cli transport fix.** Failing test: a stream whose ACP client throws must cause `provider.stream` to THROW after yielding the `error` event (so the chat route can still render the frame, but the gateway `onError` hook fires and the run fails). Implement: rethrow after `yield {type:'error'}` at `grok-cli/provider.ts:338-352`.
- [ ] **Step 4: claude-code result-subtype fix.** Failing test: SDK `result` message with `subtype:'error_max_turns'` (or any non-success) → provider throws `ProviderRunError` carrying the subtype (after emitting any final usage it has). Implement at `provider.ts:499`.
- [ ] **Step 5: gateway failover.** Failing tests: (a) retryable error on non-streaming call → one same-provider retry, second success returned; (b) two failures + `metadata.tier` present + tier config with a registered fallback provider → fallback attempted, `hooks.onError` fired per attempt; (c) NO tier on request → never cross-provider; (d) streaming: error after first yielded chunk → rethrow immediately, no retry; error before first chunk → retry allowed; (e) terminal error kind → immediate rethrow, no retry. Implement inside `complete()`/`stream()` with an injected `getTierFallback(tier) => {providerId, modelId} | null` provided by `model/index.ts` from `routing_tiers`. Backoff: `await sleep(1000)` before same-provider retry (injectable clock for tests).
- [ ] **Step 6: tier stamping.** Where the chat route uses `decisionEngine.route(...)` (`conversations/routes.ts:205-217`) set `metadata.tier = decision.tier` on the outgoing request. Add `tier` to `ModelRequestMetadata` (`model/types.ts:84-92`).
- [ ] **Step 7: conversations lazy gateway.** Change `createConversationRoutes` to receive `getModel: () => ModelGateway` (or `createLazyGateway(() => ctx.model)`) instead of the eagerly-captured `ctx.model` (`conversations/index.ts:104`), so the no-tools chat fallback is traced and failover-covered. Update route internals accordingly.
- [ ] **Step 8: typecheck + affected tests green.**

### Task 2: Status vocabulary + schema alignment + PATCH hardening (D6, S2)

**Files:**
- Modify: `src/modules/agent/run-supervisor.ts` (finalize union, `complete()` outcome param, DDL: `error_kind`, `next_attempt_at`, `verification`, `critic_rounds` columns), `src/modules/agent/types.ts:37`, `src/modules/agent/schema.ts:37-49` (mirror gains ALL runtime columns: heartbeat_at, deadline_at, attempts, last_event_seq, kind, supervisor_state, checkpoint_ref, parent_run_id + the new four), `src/modules/agent/conversation-runner.ts:175-183` (observe `max_turns_reached`/`tool_budget_exhausted`), `src/modules/agent/run-routes.ts:104,128` (409 guard: active = `running` OR `waiting_approval`), `src/modules/agent/session-registry-adapter.ts:49-73`, `src/modules/self-learning/**/completed-runs.ts:46-50` (exclude `max_turns`), `src/modules/conversations/routes.ts:158-171` (Zod body schema; status whitelist `{'idle','waiting','archived'}`; strip `totalCostUsd`), `src/modules/board/stage-automation.ts:27` (UNARMABLE += `waiting_approval`), `src/modules/proactive-assistant/bot-executor.ts` (claim untouched — claims only `'waiting'`; add regression test), web: `src/web/src/pages/agent-runs/agent-runs-page.tsx:16-38` (+ `max_turns`, `waiting_approval`; RETRYABLE += `max_turns`), `board-dashboard-utils.ts:13` (WIP += `waiting_approval`), status dot maps, locales ×4 (`agentRuns.status.max_turns`, `agentRuns.status.waiting_approval`, `conversations.status.waiting_approval`, board pinned status).
- Test: `tests/contracts/agent-sessions-schema.contract.test.ts` (NEW — Drizzle mirror ↔ runtime DDL parity, modeled on `conversations-schema.contract.test.ts`), `tests/modules/agent/run-supervisor.test.ts`, `tests/modules/conversations/routes-patch-validation.test.ts`

**Interfaces:**
- Produces: `RunHandle.complete(stats: { toolCalls: number; turns: number; tokensUsed?: number; costUsd?: number; outcome?: 'done' | 'max_turns' | 'tool_budget' })` — outcome resolves final status: `max_turns` → `'max_turns'`, else existing logic. (tokens/cost written by Task 9; param shape lands here.)
- Produces: `supervisor.park(sessionId, approvalId)` / `supervisor.unpark(sessionId)` primitives (status `waiting_approval` ↔ re-watch); park removes the run from the in-memory watch map (stuck sweep exemption) WITHOUT writing `completed_at`.
- Produces: agent_sessions status set: `running | waiting_approval | completed | max_turns | failed | stuck | cancelled`; conversations adds `waiting_approval`.

**Steps:**

- [ ] **Step 1: schema contract test first** (fails on today's 8-column drift), then align `agent/schema.ts` mirror + add new DDL columns (`error_kind TEXT`, `next_attempt_at TEXT`, `verification TEXT`, `critic_rounds INTEGER DEFAULT 0`) in `ensureRunSupervisionSchema`.
- [ ] **Step 2: `complete()` outcome param + `max_turns` finalize** (failing test: a run whose event loop saw `max_turns_reached` finalizes `'max_turns'`, `eyas.agent.run.max_turns` emitted). Wire `conversation-runner.ts` event loop to record the exhaustion signals and pass `outcome`.
- [ ] **Step 3: `park`/`unpark` primitives** with tests: park keeps row un-finalized, `recoverOrphans` ignores `waiting_approval`, tick sweep ignores parked runs, unpark re-registers the watch.
- [ ] **Step 4: PATCH Zod hardening** (failing tests: PATCH `status:'waiting_approval'` → 400; `status:'working'` → 400; `totalCostUsd: 999` → field stripped; `status:'waiting'` → 200). Keep all other UPDATE_FIELD_MAP fields passing through; unknown fields rejected by `.strict()` is NOT required (match current permissive style, only validate the dangerous fields + strip list).
- [ ] **Step 5: type unions, adapter, miner, retry guards, UNARMABLE, web statuses + locales ×4.** i18n-parity + ws-topics contract tests must stay green (frames carry `status` string — RUN_FRAME_KEYS unchanged; NO approvalId on global topics — S10).
- [ ] **Step 6: typecheck backend+web + affected tests green.**

### Task 3: Approval subsystem upgrade — enqueue-everywhere, grant ledger, TTL, REST scoping (D4, D5, D14/S1, D12-kind, D14-riskTier)

**Files:**
- Modify: `src/modules/security-gate/autonomy-policy.ts` (DDL: `arg_hash TEXT`, `run_id TEXT`, `kind TEXT DEFAULT 'tool_call'`, `consumed_at TEXT`, `resume_error TEXT`; new `consumeGrant()`; `createApproval` accepts the new fields; `expireStale` returns expired rows incl. run_id), `src/modules/security-gate/routes.ts:164-178` (list: non-admin → ownership-scoped + `input_json` projected out; keep approve/reject owner/admin), `src/modules/model/permission-bridge.ts` (riskTier threading to `categoryForTool`; enqueue with input_json/arg_hash/run_id; grant check before escalate/ladder-deny), `src/modules/agent/agent-runner.ts:523-619` (enqueue on ALL escalations incl. interactive + uncategorized, with args; grant check before `needsApproval` deny), `src/modules/tools/tool-executor.ts:185-206` (same: enqueue uncategorized too, with input_json; grant check), `src/modules/scheduler` consumer wiring in `src/modules/security-gate/index.ts` (hourly `autonomy.approvals.sweep` job: `expireStale` + emit `autonomy:approval-expired` per row)
- Test: `tests/modules/security-gate/approval-grants.test.ts`, `tests/modules/security-gate/approval-routes-scoping.test.ts`, extend `tests/modules/agent/agent-runner-approvals.test.ts`, `tests/modules/model/permission-bridge.test.ts`, `tests/modules/tools/tool-executor.test.ts`

**Interfaces:**
- Produces: `autonomyPolicy.consumeGrant(input: { conversationId: string; toolName: string; argHash: string; now?: string }): { granted: boolean; approvalId?: number }` — SQL: `UPDATE autonomy_approvals SET consumed_at=? WHERE conversation_id=? AND tool_name=? AND arg_hash=? AND status='approved' AND consumed_at IS NULL AND (expires_at IS NULL OR expires_at > ?) RETURNING id` (CAS, exactly-once).
- Produces: `createApproval` input extended `{ …, argHash?, runId?, kind?, expiresAt }`; ALL tool-path enqueues now pass `inputJson` (Zod-safe `JSON.stringify(input)`), `argHash` (reuse `agent/arg-hash.ts`), `runId` (when supervised), `expiresAt = now + security.approvalTtlHours (default 72)`.
- Consumes: Task 2's park primitives are NOT needed here — this task is pure approvals substrate; runner park behavior lands in Task 5.

**Steps:**

- [ ] **Step 1: DDL + `consumeGrant` with failing tests** (grant consumed exactly once under double-call; expired grant not granted; wrong argHash not granted).
- [ ] **Step 2: enqueue-everywhere.** Failing tests per path: interactive native escalation → row exists with input_json+arg_hash (was: no row); executor uncategorized escalation → row exists (was: none); CLI bridge passes `riskTier` into `categoryForTool` (red-tier unmapped tool → `data_delete` category — closes the CLI fail-safe gap).
- [ ] **Step 3: grant checks.** In each of the three paths, BEFORE the deny/escalate branch: `consumeGrant(...)` → granted ⇒ proceed as allowed (log `gate:grant_consumed`, still record ToolCall/ToolResult events). Tests: approve an escalated call's row → identical re-call allowed exactly once; third identical call escalates again.
- [ ] **Step 4: TTL sweep** (scheduler job hourly; `expireStale` wired; expired rows emit `autonomy:approval-expired {approvalId, runId}` on the bus — Task 6 subscribes). Test with injected clock.
- [ ] **Step 5: REST scoping (S1).** Failing tests: `user`-role caller listing approvals sees only rows whose `conversation_id` resolves (parent-chain) to their own conversations AND payload has no `input_json`; owner/admin sees all incl. args. Reuse the `ownsConversation` chain pattern (`routes-team.ts:56-62`).
- [ ] **Step 6: typecheck + tests green.**

### Task 4: Supervision extension to team + delegation runs (D1, S7)

**Files:**
- Modify: `src/modules/agent/orchestrator.ts` (`runAgentInConversation` :571-770 — `beginRun(kind:'team')`, sessionId → runner options (checkpoints+events), member status from run outcome instead of hardcoded `'completed'` :766, tokensUsed from run), `src/modules/agent/index.ts:303-375` (`executeAgent` — `beginRun(kind:'delegation')`, honest result: empty text → `{text:'', status}` not `'Task completed.'`; callers adapt), `src/modules/agent/run-supervisor.ts` (accept `kind: 'interactive'|'background'|'team'|'delegation'`), `src/modules/agent/session-registry-adapter.ts` (owner resolution walks `parent_conversation_id` chain for `'system'`-owned child conversations — S7; pattern `conversations/routes.ts:61-67`), `src/modules/mission-control` snapshot unchanged (inherits)
- Test: `tests/modules/agent/orchestrator-supervision.test.ts`, `tests/modules/agent/execute-agent.test.ts`, extend `tests/modules/agent/session-registry-adapter.test.ts` (system-owned child resolves to root owner)

**Interfaces:**
- Consumes: Task 2's `complete(stats { outcome })`.
- Produces: every team/delegation/pipeline run has an `agent_sessions` row, checkpoints, event-store transcript → parkable (Task 5), critic-able (Task 7), Mission-Control-visible, cost-attributable (Task 9). `PhaseResult.agentResults[].status` now real (`failed` when run failed).

**Steps:**

- [ ] **Step 1: failing test — team member run creates a supervised row** with `kind='team'`, checkpoint rows appear, `LlmResponse` events recorded; member failure (thrown) finalizes the row `failed` and the phase result carries `failed`.
- [ ] **Step 2: implement orchestrator threading** (sessionId into `agentRunner.run` options + supervisor handle around the loop; keep abort semantics — supervisor cancel must abort the member).
- [ ] **Step 3: same for `executeAgent`** (`kind='delegation'`; pipeline port inherits). Honest empty-result change + adapt `delegation.delegate()` caller and pipeline stage check (stage fails when run failed, not only on throw).
- [ ] **Step 4: S7 owner-chain resolution** in the registry adapter with failing test (child conv userId `'system'`, parent owned by user X → entry.ownerUserId === X).
- [ ] **Step 5: typecheck + tests green.** (Mission Control now lists team/delegation runs — CHANGELOG note in Task 12.)

### Task 5: Park — durable interrupt on escalation (D2)

**Files:**
- Modify: `src/modules/agent/agent-runner.ts` (approval block :523-619: autonomous + supervised + escalated ⇒ enqueue (Task 3 shape) then yield NEW event `{type:'parked_for_approval', approvalId, toolName}` and `return`; interactive/unsupervised keep today's deny-and-continue), `src/modules/agent/conversation-runner.ts` (on `parked_for_approval`: `supervisor.park(sessionId, approvalId)`, conversation → `'waiting_approval'`, result `{ran:true, parked:true}` — NO `handle.complete`), `src/modules/model/permission-bridge.ts` + `src/modules/model/submodules/claude-code/provider.ts` + `grok-cli/acp-governance.ts` (approval sink: bridge deps gain `onEscalatedApproval(approvalId)` collector + autonomous denies use `interrupt:true`; provider surfaces collected ids on the `done` event payload), `src/modules/agent/agent-runner.ts` (post-turn: if provider `done` carried pending approval ids on an autonomous supervised run → same park path), re-park cap: count approvals `WHERE run_id IN (lineage)` ≥ 5 → finalize `failed` with `error_kind='approval_loop'`
- Test: `tests/modules/agent/park-flow.test.ts` (native path), `tests/modules/model/permission-bridge-park.test.ts` (CLI path), extend run-supervisor tests

**Interfaces:**
- Consumes: Task 2 `park`, Task 3 `createApproval` extended shape, Task 4 supervision (team/delegation park just works).
- Produces: `AgentEvent` union += `parked_for_approval`; `RunConversationResult` += `parked?: boolean`; WS: `eyas.agent.run.waiting_approval` flows through the existing bridge wildcard (thin frame, no approvalId on global topic — S10).

**Steps:**

- [ ] **Step 1: failing native-path test** — autonomous supervised run hits a locked-category tool: approval row created WITH args+run_id, run row `waiting_approval` (not completed), conversation `waiting_approval`, loop ended (no further model turns), WS frame emitted.
- [ ] **Step 2: implement native park** (runner event + conversation-runner handling + board: stage-automation must NOT re-arm `waiting_approval` — covered by Task 2's UNARMABLE, add regression test here).
- [ ] **Step 3: interactive/unsupervised regression tests** — behavior unchanged (deny-and-continue + enqueue from Task 3).
- [ ] **Step 4: CLI-path park** — failing test: bridged autonomous run where the bridge escalates → deny uses `interrupt:true`, approvalId collected, post-turn park identical to native. (grok ACP: `reject_once` + collect.)
- [ ] **Step 5: re-park cap test** (5th park attempt on one lineage → `failed`/`approval_loop`).
- [ ] **Step 6: typecheck + tests green.**

### Task 6: Resume — approve/reject/expiry drive the run (D3, D5, S3)

**Files:**
- Modify: `src/modules/agent/index.ts` (new `wireApprovalResume(bus, deps)`: subscribes `autonomy:approval-resolved` + `autonomy:approval-expired`; approved → `resumeParked(approvalId)`; rejected/expired → `resumeParked` with denial guidance), new `src/modules/agent/approval-resume.ts` (`resumeParked`: load approval → run row must be `waiting_approval` → `supervisor.unpark` → `resumeRun(runId, deps, {seedFromCheckpoint:true, messages:[reviewerMessage]})`; on failure write `autonomy_approvals.resume_error` + leave run parked), `src/modules/agent/conversation-runner.ts` (`RunConversationOverrides.messages` already exists — reviewer message: approved → "Operator approved the pending `<tool>` call. Re-issue it with exactly the same arguments and continue."; denied → "Operator denied `<tool>`: <reason>. Do not attempt it again; complete the task another way or report the blocker."), hourly sweep (Task 3's job) also scans `status='approved' AND consumed_at IS NULL AND run_id IS NOT NULL AND resume attempts stale` → re-trigger resume (covers boot ordering + failed resumes — S3), `src/web/src/pages/autonomy/autonomy-dashboard.tsx` (pending rows show linked run/conversation; new locale keys ×4: `autonomy.parkedRun`, `autonomy.resumeFailed`)
- Test: `tests/modules/agent/approval-resume.test.ts` (approve → new run via lineage, grant consumed on re-issue, run completes; reject → resumed run gets denial message and finishes without the tool; resume failure (event store missing) → `resume_error` set, run stays parked; sweep retries and succeeds once deps available; boot: parked run + approved row → sweep resumes after startAll)

**Interfaces:**
- Consumes: Tasks 2/3/5; `resumeRun` (`conversation-runner.ts:238-320`) unchanged except messages override passthrough.
- Produces: end-to-end durable interrupt: park → operator decision → warm-resume; observable failure state (`resume_error`); restart-safe.

**Steps:**

- [ ] **Step 1: failing E2E-ish test (native, in-process)**: park (Task 5 fixture) → `decide(approved)` → bus event → resumed run re-issues the call → `consumeGrant` allows → run completes; lineage `parent_run_id` links; approval `consumed_at` set.
- [ ] **Step 2: implement `approval-resume.ts` + wiring.** decide() itself stays sync/untouched (the bus emission already exists in the approve route).
- [ ] **Step 3: reject/expiry path tests + implementation** (single denial-resume; a second reject of the same lineage does not loop — the run finishes).
- [ ] **Step 4: failure-state + sweep tests** (S3): simulate `event_store_required` → `resume_error` recorded; sweep re-attempt succeeds; CAS ensures no double-resume when bus event and sweep race (guard: `unpark` only from `waiting_approval`, second caller no-ops).
- [ ] **Step 5: dashboard link + locales ×4; typecheck + tests green.**

### Task 7: Verification-before-done — completeness critic + plan-as-rubric (D7, D8, S5, S6)

**Files:**
- Create: `src/modules/agent/critic.ts`, `src/modules/agent/plan-store.ts` (agent_plans DDL + tiny CRUD)
- Modify: `src/modules/agent/conversation-runner.ts` (pre-`complete()` critic hook for outcome `done`; feedback resume via `resumeRun` + messages override — NEVER via board arm state (S5)), `src/modules/agent/index.ts` (wire critic deps: lazy gateway + `resolveForTier` getter; config `agent.criticMaxRounds` default 1, `agent.criticEnabled` default true), `src/modules/agent/schema.ts` (+ `agentPlans` mirror), event-store event registry (add `CriticVerdict` validated event type), planning wiring: `maybePlanTask` complexity-gated at background run start (fail-open; plan persisted; steps injected via reinjection section), web: agent-runs page verification badge (`verification: passed|failed|unverified`) + locales ×4 (`agentRuns.verification.*`)
- Test: `tests/modules/agent/critic.test.ts`, `tests/modules/agent/critic-loop.test.ts`, `tests/modules/agent/plan-rubric.test.ts`

**Interfaces:**
- Produces: `runCritic(input: { goal: string; planSteps?: {title: string; successCriteria: string}[]; transcript: string; }, deps: { gateway; resolveTier }) → Promise<{ verdict: 'complete'|'incomplete'|'unavailable'; reason: string; missing: string[] }>` — nonce-sandwich, strict single-JSON parse, tier ladder `heartbeat`→`quick`, ANY error → `'unavailable'` (fail-open).
- Produces: `agent_sessions.verification` (`passed|failed|unverified`) + `critic_rounds`; `CriticVerdict` event appended per round.
- Transcript source: `eventStore.getByTypes(sessionId, ['LlmResponse'])` text projections (cap ~8k chars, newest-weighted); no event store ⇒ `unverified`.
- Approval-queue interaction: the critic writes NO approval rows in F2 (S6 kind-discriminator reserved via Task 3's `kind` column; sign-off flow = future).

**Steps:**

- [ ] **Step 1: failing critic unit tests** (complete verdict; incomplete with missing list; malformed JSON → unavailable; zero providers → unavailable; prompt contains nonce sandwich and the transcript only between nonces).
- [ ] **Step 2: implement `critic.ts`** (reuse llm-judge's parse/nonce discipline — extract shared helper if trivial, else mirror; metadata stamped `{origin:'scheduled', conversationId, runId}` for Task 9 attribution).
- [ ] **Step 3: failing loop tests**: verdict incomplete + rounds<cap → `resumeRun` invoked with reviewer feedback message, `critic_rounds` incremented on the NEW run; second incomplete → finalize `completed` + `verification='failed'`, no further resume; verdict complete → `verification='passed'`; unavailable → `unverified`; `max_turns`/`failed`/`cancelled` outcomes skip critic entirely.
- [ ] **Step 4: wire into `conversation-runner`** (critic runs after the event loop, before `handle.complete`; the resume is fire-and-forget-safe: this run finalizes `completed`+`verification='failed_pending_rework'`? NO — keep simple: this run finalizes with `verification='failed'` AND the feedback resume starts the child run; child's own critic round respects the lineage-cap via `critic_rounds = parent.critic_rounds + 1`).
- [ ] **Step 5: plan-as-rubric**: failing tests — background run whose goal trips `detectComplexity.recommendsPlan` gets a persisted plan (fail-open: generation error ⇒ no plan, run proceeds); critic receives `planSteps` when a plan exists. Implement `plan-store.ts` (DDL `agent_plans(id, run_id, conversation_id, plan_json, created_at)`) + `maybePlanTask` call (approval handler: auto-approve — `onPlanApproval: async () => true` — rubric-only mode, D8) + reinjection of step titles.
- [ ] **Step 6: web badge + locales ×4; typecheck + tests green.**

### Task 8: Auto-retry + boot warm-resume + budget engine (D11, D13, S4, S8)

**Files:**
- Modify: `src/modules/agent/conversation-runner.ts` (catch path: `classifyModelError` → `handle.fail(error, {errorKind})`), `src/modules/agent/run-supervisor.ts` (`fail()` writes `error_kind`; helper `scheduleRetry(sessionId, attempt)` computes `next_attempt_at` backoff 60s/300s/900s), new `src/modules/agent/retry-sweep.ts` (scheduler job `agent.run.retry.sweep` every minute: rows `status='failed' AND error_kind retryable AND attempts<3 AND next_attempt_at<=now AND kind='background'` → `resumeRun(seedFromCheckpoint:true)`; new run's `attempts = parent.attempts + 1`), boot: `src/modules/agent/index.ts` sets `(ctx as any).agentPostBoot = async () => {…}` (warm-resume checkpoint-bearing background orphans just cold-failed by `recoverOrphans` (error_kind='restart', attempts<3); reset `conversations.status='working'` rows with no live run → `'idle'`; team-session boot scan hook for Task 10); `src/main.ts` + `src/cli/commands/serve.ts` invoke `ctx.agentPostBoot?.()` after WS wiring; budget engine: `src/modules/agent/index.ts` instantiates `createBudgetEngine({registry, bus})`, `addTokenUsage` call sites (`conversation-runner.ts:182`, `orchestrator.ts:761`, `channel-run-agent.ts:76`) → `budgetEngine.trackUsage`, `wireBudgetReset` → `budgetEngine.resetAll()`
- Test: `tests/modules/agent/retry-sweep.test.ts`, `tests/modules/agent/boot-recovery.test.ts`, `tests/modules/agent/budget-engine-wiring.test.ts`

**Interfaces:**
- Consumes: Task 1 classifier, Task 2 columns (`error_kind`, `next_attempt_at`, attempts), `resumeRun`.
- Produces: bounded unattended self-healing; `eyas.agent.budget.alert` live over the existing F1 WS pipe.
- Rollup semantics (S8): each attempt is its own run row; miner/reporters keep counting rows — CHANGELOG-disclosed; the retry chain is inspectable via `parent_run_id`.

**Steps:**

- [ ] **Step 1: failing tests — error_kind persistence** (retryable provider error → `failed` + `error_kind='overload'` + `next_attempt_at` set; terminal error → no `next_attempt_at`).
- [ ] **Step 2: sweep tests + implementation** (due row resumed exactly once — claim via CAS UPDATE on `next_attempt_at IS NOT NULL`; attempts increment on child; 3rd failure → no further schedule; `waiting_approval` rows never touched (D13); non-background kinds never touched).
- [ ] **Step 3: boot recovery tests + implementation** (orphan with checkpoint → warm-resumed after `agentPostBoot`; orphan without checkpoint → stays failed; stale `'working'` conversation reset to `'idle'`; parked run untouched). `agentPostBoot` must be idempotent and error-isolated (log, never throw).
- [ ] **Step 4: budget engine wiring tests** (trackUsage crossing 80% emits `eyas.agent.budget.alert` once (dedup); `model:budget:reset` clears counters AND dedup via `resetAll`).
- [ ] **Step 5: typecheck + tests green.**

### Task 9: Cost producer — attribution + rollups + pricing (D15, S8)

**Files:**
- Modify: `src/modules/model/types.ts` (`ModelUsage` += `cacheReadTokens?, cacheCreationTokens?, costUsd?`; `ModelRequestMetadata` += `runId?`), `src/modules/model/submodules/claude-code/provider.ts` (read SDK result `total_cost_usd` + `modelUsage` cache fields into usage; fix `run_completed` frame `totalCostUsd` :520), anthropic/openai/gemini adapters (fill cache-token fields where the API provides them — read-only additions), create `src/shared/model-pricing.ts` (pricing table: config-overridable via `model.pricing` YAML block, defaults refreshed, provider-qualified keys, `ollama`/`lmstudio` → 0; `estimateCost(provider, model, usage)` preferring `usage.costUsd` when present), `src/modules/observability/trace-collector.ts` (attribution: `conversationId`/`agentSessionId` from `request.metadata` (:393-394, :449-450); use shared pricing), `src/modules/agent/conversation-runner.ts` + `orchestrator.ts` (accumulate per-turn usage → `handle.complete({tokensUsed, costUsd, …})`; orchestrator sums member run costs → `totalCostUsd` finally real :402→:565; runId stamped into run metadata at construction sites), `src/modules/agent/run-supervisor.ts` (`finalize` writes `tokens_used`, `cost_usd`), `src/modules/conversations/conversation-service.ts` (server-side `total_cost_usd` increment helper called at run boundary + interactive turn accumulation in routes), `src/modules/agent/index.ts` (bind `ctx.agentDailyStats`: `completedToday` + `costTodayUsd` from `agent_sessions WHERE date(completed_at)=date('now','localtime')`), mission-control inherits
- Test: `tests/modules/model/pricing.test.ts`, `tests/modules/observability/trace-attribution.test.ts`, `tests/modules/agent/cost-rollup.test.ts`, extend claude-code provider tests (SDK cost surfaced)

**Interfaces:**
- Column-ownership matrix (single-writer rule, S8): `ai_traces.*` ← tracing wrapper ONLY; `agent_sessions.tokens_used/cost_usd` ← `finalize` ONLY; `conversations.total_cost_usd` ← service increment ONLY (PATCH-stripped by Task 2); `team_sessions.total_cost_usd` ← orchestrator ONLY; `agent_definitions.tokens_used_month` ← budgetEngine.trackUsage ONLY.
- Critic/judge/cheap-pass calls: traced+attributed via metadata when they carry it; NEVER added to run rollups (rollups source = runner turn accumulation only) — no double count.

**Steps:**

- [ ] **Step 1: pricing module tests + impl** (config override wins; local providers $0; unknown model falls back to conservative default; `usage.costUsd` preferred).
- [ ] **Step 2: claude-code cost surfacing tests + impl** (SDK result cost lands in `usage.costUsd`; run_completed frame carries it).
- [ ] **Step 3: trace attribution tests + impl** (request with metadata → ai_traces row carries conversation_id + agent_session_id(runId); request without → NULLs as today; local model priced $0 — fixes budget over-count).
- [ ] **Step 4: rollup tests + impl** (background run: agent_sessions tokens/cost written at finalize; conversation total incremented; team session cost = Σ member runs; Mission Control snapshot shows non-zero tokensUsed/costUsd; dailyStats non-stub).
- [ ] **Step 5: typecheck + tests green.** (Historical $0 accepted — CHANGELOG note.)

### Task 10: Team-session durability — phase cursor + re-drive (D12)

**Files:**
- Modify: `src/modules/agent/index.ts` (DDL: `team_sessions` += `current_phase INTEGER DEFAULT 0`, `phase_status TEXT`; new table `team_phase_results(id, team_session_id, phase_index, agent_id, status, summary, tokens_used, cost_usd, created_at)`), `src/modules/agent/schema.ts` (mirrors), `src/modules/agent/orchestrator.ts` (`executeTeam` writes phase cursor at `phase_started`/`phase_completed`/checkpoint; persists per-member results; accepts `startAtPhase` + preloaded results), `src/modules/agent/routes-team.ts` (driver extracted to `src/modules/agent/team-driver.ts`: `driveTeam(teamSessionId, deps)` — approve route, resume route (relaunches driver when no in-memory resolver), and boot scan all call it), `src/modules/agent/team-session-service.ts` (resume: if no resolver → relaunch driver from cursor instead of the silent `pendingResumes` lie), boot scan in `agentPostBoot` (Task 8 hook): `running` → relaunch from cursor; `paused` → leave (durable wait)
- Test: `tests/modules/agent/team-durability.test.ts` (cursor written per phase; kill-driver-then-resume relaunches from phase N with prior results loaded; completed members not re-run (results from `team_phase_results`); boot scan re-drives `running`, leaves `paused`; `paused`+resume after restart actually continues — the F1-era wedge test)

**Interfaces:**
- Consumes: Task 4 (member runs supervised → member status/cost from run rows), Task 8 `agentPostBoot`.
- Produces: restart-survivable team sessions; the in-memory resolver stays as fast path.

**Steps:**

- [ ] **Step 1: DDL + cursor-write failing tests → impl.**
- [ ] **Step 2: driver extraction** (behavior-preserving refactor; approve-route E2E test stays green).
- [ ] **Step 3: resume-relaunch + boot-scan tests → impl** (incl. the no-double-driver guard: an in-memory active driver blocks relaunch).
- [ ] **Step 4: typecheck + tests green.**

### Task 11: WS + REST ownership scoping (D14, S1-REST twin, S10)

**Files:**
- Modify: `src/core/http/websocket.ts` (`WSConnectionRegistry` += `setTopicAcl(acl: { canSubscribe(userId: string, topic: string): boolean })`; `subscribe()` consults it; deny → send `{event:'subscribe_denied', data:{topic}}` and do NOT register), create `src/core/http/ws-acl.ts` (`createTopicAcl()`: per-prefix resolver registry; parse rules: `team:<id>:event`, `team:proposed:<convId>`, `orchestration:<id>`, `chat:<id>`, `notifications:<userId>`, `agent:<id>`, `board:<id>`, globals; unknown per-id prefix → deny; globals + `agent:` → allow authenticated; `board:` → allow authenticated (deferred membership)), `src/modules/agent/index.ts` + `src/modules/conversations/index.ts` register resolvers on ctx (`ownsConversation` parent-chain; teamSession → parent conv; orchestration runId → teamSession | conversation, unresolvable → deny; `notifications:` → suffix === userId), fresh role lookup per subscribe (1 SELECT via auth users table; owner/admin → allow all), `src/main.ts` + `src/cli/commands/serve.ts` (wire ACL; extract shared `setupWsServer(ctx, registry)` helper to kill the duplication), auth module (`logout` + user suspend/delete → `registry.closeUser(userId)` — new registry method), `src/modules/agent/routes-orchestration.ts:13-21` (list filtered to owned runIds for non-admins; `/runs/:runId/events` ownership-checked, unresolvable → 404), web `src/web/src/hooks/use-websocket.ts` (+`use-websocket-utils`): handle `subscribe_denied` → drop topic from the re-subscribe set + `logger`-level warn (no UI strings in F2), `src/shared/ws-topics.ts` (+ frame-type constant for the NACK so the contract test sees both sides)
- Test: `tests/core/websocket-acl.test.ts` (foreign team topic denied + NACK; own allowed; admin override; notifications cross-user denied; unresolvable orchestration id denied; unknown per-id prefix denied; globals allowed), `tests/modules/agent/routes-orchestration-scoping.test.ts`, extend `tests/contracts/ws-topics.contract.test.ts` expectations, web hook unit test for NACK handling

**Interfaces:**
- Consumes: F1 `ownsConversation` pattern; role source: fresh DB lookup (also closes the stale-role gap for subscribes).
- Produces: per-id full-content topics (team:event, team:proposed, orchestration, notifications, chat) ownership-scoped on WS AND the REST replay twin; sockets die on logout/suspend.

**Steps:**

- [ ] **Step 1: registry ACL + NACK failing tests → impl** (core-level, resolver injected as plain object — core cannot import modules).
- [ ] **Step 2: module resolvers + wiring in both server entries** (shared helper extraction; both entries' behavior verified by one shared test through the helper).
- [ ] **Step 3: REST scoping tests → impl** (guest/user sees only own runs; admin all; 404 on unresolvable).
- [ ] **Step 4: closeUser on logout/suspend tests → impl.**
- [ ] **Step 5: web NACK handling; ws-topics contract green; typecheck + tests green.**

### Task 12: CHANGELOG + docs + behavior disclosure

**Files:**
- Modify: `CHANGELOG.md` (F2 wave: durable approvals park/resume; grant ledger semantics; new statuses; critic + verification badge; auto-retry + boot warm-resume; team durability; WS/REST ownership scoping incl. NACK; cost producer + pricing config; budget alerts live; BREAKING/behavior notes: PATCH status whitelist; approvals list projection for non-admins; grok/claude-code failures now fail runs (previously silent success); Mission Control now lists team/delegation runs; historical cost rows stay $0; each retry attempt is a separate run row for stats), `docs/eyas-architecture.md` (correct the fallback.ts/„fallback implemented" claims :26/:465/:2421 to the real D10 design; update run-status state machine section; approvals/park lifecycle diagram)
- Test: none (docs); full-suite + both typechecks green as the task's exit gate.

**Steps:**

- [ ] **Step 1: write CHANGELOG F2 wave** (all behavior changes above, honestly).
- [ ] **Step 2: architecture doc corrections.**
- [ ] **Step 3: run FULL test suite + backend/web typecheck + vite build; fix nothing here — regressions route back to the owning task's fix loop.**

---

## Task order & dependencies

T1 (transport/failover — prerequisite for retry trust) → T2 (statuses + hardening; independent of T1) → T3 (approvals substrate) → T4 (supervision extension) → T5 (park; needs T2+T3+T4) → T6 (resume; needs T5) → T7 (critic; needs T2+T4, sequenced after T6 so critic resumes can't hit locked-category walls) → T8 (retry+boot; needs T1+T2) → T9 (cost; needs T1+T4) → T10 (team durability; needs T4+T8 hook) → T11 (WS/REST scoping; independent, anytime after T2) → T12 (docs, last).

## Self-review notes

- Spec coverage: park-and-resume (T2/T3/T5/T6), verification-before-done incl. max_turns + planning wiring (T2/T7), retry/failover incl. transport unification + boot + team durability (T1/T8/T10), F1 carries: WS ownership (T11) + cost producer (T9). All critic seams assigned: S1→T3, S2→T2, S3→T6, S4→T2/T8, S5→T7, S6→T3 (kind column reserved), S7→T4, S8→T8/T9 (matrix), S9→T3/T6, S10→T2/T5.
- Deliberately out of F2 (recorded follow-ups): SDK short-hold spike (U1); per-run budget denominator on AgentCard; board membership model; periodic socket TTL; cost-denominated agent budgets; interactive inline-approve UI; `refreshing` phantom cleanup in web; guest `read Conversation` revocation.
- Type consistency: `RunHandle.complete` stats shape defined once in T2, consumed by T4/T7/T9; `consumeGrant`/`createApproval` shapes defined in T3, consumed by T5/T6; `agentPostBoot` defined in T8, consumed by T10.
