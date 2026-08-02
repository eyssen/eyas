# Changelog

## [0.8.4-beta] - 2026-08-02 — Security closure, durable autonomy, operator platform

Everything shipped after the 0.8.3-beta memory/prompt-enhancer release, previously
split across multiple `0.8.3-beta` CHANGELOG headers plus unreleased August work.
Covers F0–F2 security and autonomy loops, governed CLI providers, operator UX
(home, board, Schedule Hub), install/self-update/backup lifecycle, expanded model
providers, multi-instance channels, and new modules (voice, intel, ideabox, costops).

### Install, lifecycle & self-update
- Default HTTP port **3100** (avoids Grafana/CRA on `:3000`); `EYAS_HOME` +
  `local.yaml` merge; port-clash detection; multi-project Docker Compose.
- `eyas start` / `stop` / `restart`; one-line curl/PowerShell installers;
  optional installer `--version` / `-Version` for empty-system restore pin.
- Auto-build frontend on `start`/`serve` when the web build is missing or stale.
- Setup recommendations checklist (replaces autonomy-only home nudge).
- Status bar version reads `version.json` via `getVersion()` (no hardcoded `1.0.0`).
- **Self-update v1:** GitHub `eyssen/eyas` release/tag + CHANGELOG detection;
  `eyas update check` / `apply`, `GET`/`POST /api/v1/system/update`, Settings
  Updates card, status-bar badge. Apply always requires a working backup module
  and creates a fresh backup before checkout/rebuild/restart — no silent upgrades.

### Backup & offsite destinations
- Full-system backup packs `data/`, `config/`, `.env`, `version.json`, and compose
  overrides (excludes nested backups/tmp/runtime); sidecar manifest records
  `eyasVersion`; Backup UI shows version.
- Configurable primary offsite target after local `tar.gz`: S3/B2, FTP, Dropbox,
  SSH. Secrets are env/secret-ref names only; B2-style S3 setup documented in README.

### Providers & models
- **Kimi API** + **Kimi Code CLI** (wizard host-CLI detection).
- Claude Code **Fable** model alias; stable product display names; Terminal icons
  for `*-cli` hosts.
- OpenClaw-aligned OpenAI/Anthropic-compatible catalog (xAI, Mistral, Groq,
  Together, DeepSeek, MiniMax, vLLM, …).
- **Grok CLI ACP** provider + dual-CLI setup wizard (Claude Code + Grok).
- Claude Code session store; self-healing routing-tier defaults; providers
  off-by-default until configured.

### Communication — multi-instance channels
- Channel catalog with **instance-level credentials** and agent bindings (same
  type, e.g. Signal, can serve multiple agents).
- Configure/reconnect APIs, `list_channels` / `channel_send` tools, dashboard
  setup recommendation, agent detail **Channels** tab.
- Communication UI: per-card add instance, step-by-step setup guides, human
  field labels for Signal/Telegram.
- Channel hardening: reply-guard, progress placeholders/watchdog; Google Chat /
  Teams stubs; A2A peers.

### Product documentation & in-app help
- **Starlight multi-language docs** (`packages/docs/`, en/hu/de/es): user/admin
  product documentation covering setup, daily work, agents, automation, knowledge,
  communication, AI providers, admin, deploy/CLI, and reference.
- Served by the main EYAS process at **`/docs/`** (same origin/port); auto-build
  on `start`/`serve` when missing or stale (`docs:build`, soft-fail if omitted).
  Env: `EYAS_SKIP_DOCS_BUILD`, `EYAS_FORCE_DOCS_BUILD`, `DOCS_BASE` for standalone
  static export. Docker image and install script build the docs package.
- **help-map.json** + **ContextualHelp** (`?` on page titles) resolve to the
  active UI language; sidebar **Documentation** link. Vite proxies `/docs` in
  frontend dev.

### Operator surfaces
- **Home Attention Surface:** approvals, pinned/recent conversations, mission-
  control snapshot, briefing, next jobs (replaces empty dashboard).
- **First-turn team auto-propose** from orchestration mode + complexity
  (still requires user approval).
- **Context Rail** on conversations (notes + business history, Next activities,
  Files); runtime strip separated from chatter; idle/working noise dropped.
- Board defaults to **All projects**; rich kanban meta restored (status, due,
  tokens, agent, subtasks, aging, WIP); `/conversations` → `/board`.
- Dialogs use theme tokens (`bg-background` / `border-border`) instead of
  hardcoded dark overrides.
- **Schedule Hub:** `next_run_at`, PATCH reschedule, timeline/projections API,
  24h stats, dead-letter, concurrency limits, execution retention; `agent_run` +
  board recurring handlers; `schedule_*` tools; Gantt/list/calendar UI with
  assigned-agent badges (en/hu/de/es).
- Board multi-views (July): Linear-style grouped list + ⌘K, timeline/run-trace,
  dashboard, orchestration + stage-flow graph.
- UI i18n: English / Hungarian / German / Spanish throughout.

### New modules & data portability
- **Voice:** local STT/TTS (Whisper/Piper) + Telegram voice replies.
- **Intel** fact registry, **Ideabox** funnel, **Costops** ledger.
- Ops host-guards: disk space, channel watchdog, stuck runs; optional bumblebee scan.
- Stage WIP limits + card aging; Google Docs tools; MCP `connectors.hu`.
- Settings **data port** import wizard (multi-tier memory + own-skill routing);
  richer vault memory graph UI.

### Platform foundations (July, condensed)
- Prompt assembler: DB-backed master identity + core-rules, warm base personality,
  memory/team resolvers, master-seed refresh on upgrade; real system prompt on
  interactive/background/delegated runs.
- Autonomy / self-improvement: feature-flagged loops, approval-gated applies,
  forge/self-learning/skill-generation model-authored proposals, proactive
  heartbeat composer, settings card + onboarding.
- Skill-generation module live: routes, gated owner-approval adoption, scheduler,
  skills-registry adapter.
- Templates/themes: nebula/atelier/halo/terminal/sequoia skins, status-bar module,
  Appearance + wizard template picker.
- Users: archive-not-delete, protect agent users, restore archived.
- Ops dashboard + ticket-to-code pipeline + real remediation execution (kubectl/PR
  gate); vendor-neutrality scrub of shipped surface.
- Mission Control team role + parent edges; per-agent `maxTurns` and tool progress
  under Claude Code; phase-nested run tree + `maxParallelAgents`.

### Fixes
- Non-blocking `agentPostBoot` recovery (fire-and-forget after listen; batch-capped);
  UTC-correct daily stats (`date('now')` vs UTC `completed_at`).
- Privacy phone sanitization no longer rewrites ticket IDs as `[PHONE]`.
- Grok ACP `mcpServers` on `session/new`; ops/intel scheduler seed CreateJobInput shape.
- Conversation switch hardening; theme token mapping via `@theme inline`.

---

### F2 durable loops — park/resume, verification, auto-retry, cost producer
Eleven-task closure of the autonomy loops left open after F0/F1: a durable park-and-resume
interrupt for gated tool calls (instead of deny-and-continue), a completeness critic that
checks a run's own transcript against its goal before it can claim `completed`, auto-retry
and tier failover for transient provider errors, restart-survivable team sessions, a real
tokens/cost producer, and ownership-scoped WebSocket/REST surfaces. Every deliverable below
lands on a clean backend + web type check and a green full suite.

### Behavior changes to know before relying on this build
- **BREAKING — provider failures now fail the run.** `grok-cli` and `claude-code` used to
  swallow transport/result errors and let the run finish as if nothing happened; both now
  always throw (`grok-cli` rethrows after its `error` frame, `claude-code` throws
  `ProviderRunError` on any non-`success` SDK result subtype). Run success rates will look
  different after upgrade — they're honest now, not silently inflated.
- Mission Control's run list now includes team and delegation runs, not just background
  runs — because those shapes are supervised for the first time (see below), there are
  simply more rows than before for the same amount of actual work.
- Every background run that would finalize `completed` now spends one extra cheap-tier
  model call (the completeness critic), and complex goals spend one more for plan
  generation. A run that exhausts `maxTurns` is now its own terminal status, `max_turns`,
  and is no longer reported as `completed`.
- Historical runs/conversations/team sessions keep `cost_usd`/`total_cost_usd` at `0` —
  the new cost producer is forward-only, there is no backfill.
- Tier-based cross-provider failover ships **dormant**: `DEFAULT_TIERS` seeds every tier
  with empty `fallbackProviderId`/`fallbackModelId`, so no existing install gets
  cross-provider failover until an operator sets a fallback provider/model per tier in the
  routing UI. Same-provider retry-once is always active; that part is not gated.
- `PATCH /api/v1/conversations/:id` now Zod-validates the client-settable `status` to
  `{'idle', 'waiting', 'archived'}` (400 on anything else) — a client can no longer PATCH a
  conversation into (or out of) `waiting_approval`; that status is runner-owned, so a parked
  conversation can't be flipped back into a claimable state from the outside
  (`src/modules/conversations/routes.ts`).
- First in-codebase SQLite table rebuild: `autonomy_approvals` gained a `'revoked'` status
  value, which SQLite's `CHECK` constraint can't add via `ALTER TABLE` — the migration
  renames the table, recreates it with the new constraint, copies rows, and drops the old
  one (`src/modules/security-gate/autonomy-policy.ts`). It runs once at boot on upgrade;
  if a second process touches the same SQLite file during that boot window it will wait on
  `busy_timeout` and can fail to start — this is retryable, just restart it.

### Durable park-and-resume approvals (replaces deny-and-continue)
- An autonomous supervised run (background, team, delegation, or pipeline) that escalates a
  gated tool call now **parks**: the run and its conversation move to `waiting_approval`,
  the loop ends cleanly (no `handle.complete`), and the pending call is queued as an
  approval row carrying its arguments, an arg hash, and the run id
  (`src/modules/agent/agent-runner.ts`, `src/modules/agent/run-supervisor.ts`). CLI
  providers (Grok ACP, claude-code) park through an interrupt + approval-sink path instead
  of the native event. Interactive chat is unchanged — it still gets deny-and-continue plus
  a queued approval, never a park.
- The approval row is the grant: `autonomy_approvals` gained `arg_hash`, `run_id`,
  `consumed_at`, and `kind` columns. Operator approve consumes the grant exactly once via a
  CAS `UPDATE … WHERE consumed_at IS NULL` before the tool is allowed to re-run
  (`autonomy-policy.ts#consumeGrant`) — a changed argument set never matches a stale grant
  and re-escalates instead. A run lineage that re-parks five times fails outright with
  `error_kind='approval_loop'` rather than looping forever.
- Approve/reject drive a warm-resume via the existing checkpoint machinery
  (`src/modules/agent/approval-resume.ts`): approved runs re-issue the exact call with a
  reviewer message telling them to proceed; rejected runs get a denial message telling them
  not to retry the action. TTL expiry (`security.approvalTtlHours`, default 72h) resolves
  the same way as a reject. An hourly sweep retries approved-but-unconsumed grants and
  covers boot-time ordering, and any resume failure is recorded on the approval row
  (`resume_error`) instead of silently leaving the run stuck.
- The approvals list endpoint is now ownership-scoped for non-admin callers (parent-chain
  resolution, same pattern as team-session ownership), and the raw `input_json` (tool
  arguments) is projected out of non-admin/non-owner responses.

### Supervision extended to team + delegation runs
- Team-member and delegation/pipeline runs now get a real `agent_sessions` row,
  checkpoints, and an event-store transcript — the same supervision background runs
  already had. This is what makes park-and-resume, the critic, and cost attribution work
  for these shapes too, and it's why Mission Control now lists them (see behavior note
  above).
- Member/delegation completion status is now the run's real outcome instead of a
  hardcoded `'completed'` string; a member that throws now reports `failed`, and a
  delegated call that returns no text is reported as empty text with its real status
  instead of the previous fabricated `'Task completed.'`.

### Verification-before-done — completeness critic + plan-as-rubric
- Every supervised run that would finalize `completed` (never `max_turns`/`failed`/
  `cancelled`) is now judged by a cheap-tier completeness critic
  (`src/modules/agent/critic.ts`) against its goal — and, for background runs complex
  enough to have triggered planning, against the plan's per-step success criteria
  (`src/modules/agent/plan-store.ts`, new `agent_plans` table). The critic is fail-open: no
  provider available or an unparseable verdict just marks the run `unverified`, it still
  completes.
- An `incomplete` verdict triggers exactly one feedback resume with the critic's own
  reasoning injected as a reviewer message; a second `incomplete` finalizes the run
  `completed` with `verification='failed'` rather than looping.
- New `agent_sessions.verification` column (`passed | failed | unverified`) surfaced as a
  badge on the agent-runs page.

### Auto-retry + boot warm-resume + budget engine
- Background runs that fail with a retryable `error_kind` (rate-limit, overload, timeout,
  network) and have made fewer than 3 attempts are rescheduled with a 60s/300s/900s backoff
  and resumed from checkpoint by a sweep (`src/modules/agent/retry-sweep.ts`); each retry
  attempt is its own `agent_sessions` row linked via `parent_run_id` — existing
  completed-run counters and reporters keep counting rows as before, so retried runs will
  show up as multiple rows for one logical task.
- A new post-boot pass (`agentPostBoot`) warm-resumes checkpoint-bearing background runs
  that a restart just cold-failed, and resets conversations stuck in `working` with no live
  run back to `idle`. `waiting_approval` rows are left untouched across a restart.
- The F1-era budget engine (`createBudgetEngine`) is now actually instantiated and wired to
  every token-usage call site — `eyas.agent.budget.alert` fires for the first time; it
  previously existed but was never connected to anything.

### Cost producer — real tokens/cost, finally
- `agent_sessions.tokens_used/cost_usd`, `conversations.total_cost_usd`, and
  `team_sessions.total_cost_usd` are now written from the runner's own turn accumulation at
  run boundaries, instead of staying structurally zero (the F1 CHANGELOG's known gap).
  `ai_traces` rows gain `conversation_id`/run attribution from request metadata.
- New shared, config-overridable pricing table (`src/shared/model-pricing.ts`) pins
  `ollama`/`lmstudio` (local providers) to $0 — this closes a real bug where local-model
  calls were being priced at cloud rates and eating into the global budget for free work.
  claude-code's SDK-reported `total_cost_usd` and cache-token counts are read and preferred
  over the estimate when present.
- Mission Control's token/cost counters and daily stats are real numbers now, not stubs.

### Team-session durability — phase cursor + re-drive
- `team_sessions` persists a phase cursor (`current_phase`/`phase_status`) and per-member
  results (new `team_phase_results` table); the driver is extracted
  (`src/modules/agent/team-driver.ts`) so the approve route, the resume route, and a boot
  scan all share it. A restarted server re-drives `running` team sessions from the
  persisted cursor and leaves `paused` ones waiting durably — completed phases are not
  re-run. This closes the F1-era wedge where a `paused` team session that survived a
  restart could never actually be resumed.

### WS + REST ownership scoping
- Per-id content topics (`chat:<id>`, `team:<id>`, `orchestration:<id>`,
  `notifications:<userId>`) are now ownership-scoped at WebSocket subscribe time: a
  fail-closed ACL (`src/core/http/ws-acl.ts`) does a fresh role lookup per subscribe, denies
  unknown per-id prefixes outright, and sends a `subscribe_denied` NACK frame instead of
  silently registering — an unauthenticated or cross-owner subscribe used to just work.
  The orchestration REST replay routes (`GET /api/v1/orchestration/runs*`) are scoped with
  the same resolver. Sockets are now closed on logout and account suspension.
- `board:<projectId>` stays open to any authenticated user in F2 — there's no board
  membership model yet to scope it against; that's a deliberate, recorded gap, not an
  oversight.

### Follow-ups (deferred out of this wave)
- A team member that gets parked for approval and is then refused because of a status
  race is not currently picked up by auto-retry.
- There is no UI button yet for `POST /team-sessions/:id/resume` — a `paused` or
  boot-parked team session needs the raw API call until a later wave adds the control.
- A parked run can't be cancelled directly; the only way out today is reject (which
  resumes the run with a denial message) or letting the TTL expire.
- Interactive (non-autonomous) chat intentionally never parks — only autonomous supervised
  shapes do; interactive escalations keep the existing grant-then-retry flow.
- Cost-denominated agent budgets, a per-run budget denominator on the AgentCard, an
  interactive inline-approve UI, and periodic WebSocket TTL sweeps are recorded as future
  work, not attempted here.


### CLI-provider governance, orchestration visibility, effort levels

### Security — CLI providers fail closed
- **Grok ACP governed**: removed `--always-approve`; every ACP `session/request_permission`
  and `fs/read_text_file` / `fs/write_text_file` request now routes through the shared
  Cap 7 permission bridge (security gate + autonomy ladder, fail-closed without a gate).
  ACP tool kinds map onto the gate's canonical vocabulary (`execute`/`delete`→Bash,
  `edit`/`move`→Write, …); allows always pick `allow_once`, never `allow_always`
  (`src/modules/model/submodules/grok-cli/acp-governance.ts`).
- **claude-code**: the ungoverned `bypassPermissions` fallback is gone — no security
  gate now means headless `default` permission mode (fail-closed) + warning log.
- `createPermissionBridge` moved to `src/modules/model/permission-bridge.ts` (shared
  by both CLI providers; the old claude-code path re-exports it).

### Orchestration visibility for every claude-code run
- SDK hooks now install for ALL governed runs, not only team runs: plain conversations
  get their own run (`runId = conversationId`) with a `conv:<id>` root node,
  `sub:<agent_id>` subagent nodes nested beneath it, and run_started/run_completed frames.
- Exact tool attribution via hook `agent_id` (parallel Task fan-out included) replaces
  the single-active-subagent heuristic; PostToolUse/PostToolUseFailure emit tool_result.
- Subagent-originated stream content (`parent_tool_use_id`) no longer leaks into the
  main answer stream — it renders in the run tree instead.
- **Persistence + replay**: `orchestration_events` table + `OrchestrationEventService`
  (drop-in broadcaster: persists + broadcasts), `GET /api/v1/orchestration/runs` and
  `GET /api/v1/orchestration/runs/:runId/events`; 7-day retention prune at startup.
- Frontend: run-tree store `loadRun()` replay hydration on conversation load, team-session
  rehydration after reload, RunTree mounts for any run with nodes; the board graph's
  orchestration mode gained a real data source (run list + live WS follow + run selector).
- SSE: `tool_use_end` forwarded; `tool_result` now carries `toolUseId` (frontend matches
  by id — the old name-keyed matching never hit).

### Effort levels (provider-agnostic)
- `ModelRequest.effort` (`low|medium|high|max`) mapped per provider: claude-code →
  SDK `effort` + adaptive thinking; Anthropic API → `output_config.effort` on
  adaptive-thinking models, effort-derived `budget_tokens` on older ones; OpenAI →
  `reasoning_effort` on o-series (`max`→`high`); Grok CLI ignores it (no surface).
- Per-conversation `effort` column (PATCH-able, UI select replaces the budget presets
  that were silently discarded on adaptive models; editable mid-conversation).
- Per-agent `effort` column on `agent_definitions`, forwarded into SDK subagent
  definitions (`AgentDefinition.effort`) and the agent edit form.
- Autonomous/background runs now honor the conversation's thinking/effort (previously
  always thinking-off).

### Orchestration mode (per conversation)
- New `orchestration` column: `solo` (no provider-native fan-out — Task tool and
  subagent roster stripped), `auto` (default), `deep` (fan-out directive injected into
  the system prompt + effort defaults to `max`). Provider-aware directive: claude-code
  is steered to native Task fan-out, other providers to `propose_team`/`delegate_to_agent`.
- Precedence note: EYAS `executeTeam` owns phases/checkpoints; a team subagent running
  on claude-code may still fan out natively (nested one level, rendered under its
  `conv:<id>` node) unless the conversation is set to `solo`.


### F0 security closure

Eight-task hardening pass closing the gaps found in the 07-28 subagent orchestration
review: audit trails that recorded `'unknown'`, security modules wired in code but
never registered, a judge and permission bridges that could fail open, and an MCP
tool surface reachable without the normal authorization path. Every non-allow
decision is now audited, every unclassified tool escalates instead of running, and
the tool executor is the one place a tool call can be authorized.

### Audit trail — real subjects, secrets access logged
- Bus-emitted events now stamp their real `action`/`module` on the resulting audit
  entry instead of `'unknown'` (`src/core/bus/local-bus.ts`, `src/modules/audit/index.ts`).
- Secrets module: scope-denied and privileged reads/writes are now audited via a
  lazy sink (`src/modules/secrets/audit-sink.ts`) that falls back to `logger.warn`
  if the audit service isn't up yet, instead of being silently dropped.

### Privacy module — actually registered
- The `privacy` module (PII egress scanning, shipped `privacy.yaml` ruleset) is
  now registered in `src/core/bootstrap.ts` — it existed in code since an earlier
  wave but was never wired in, so it never ran.
- New per-call `lazy-gateway` (`src/modules/model/lazy-gateway.ts`) resolves the
  privacy + tracing wrappers at call time, so `agent-runner`, `orchestrator`, and
  the LLM judge all go through them instead of capturing an un-wrapped reference
  at module-load time (the earlier eager-capture bug this closes).

### LLM security judge — vendor-neutral, fail-closed
- Removed the hardcoded Anthropic provider pick; the judge now resolves a
  provider through the same tier resolver (`getTierResolver`) as ordinary
  requests, so any configured provider can serve as judge.
- Judge prompt rewritten to a nonce-sandwiched template demanding a strict JSON
  verdict; **zero configured providers now escalates to human approval instead
  of defaulting to allow**, and an unparseable verdict denies rather than passing
  through. No more "verdict shopping" across providers on an ambiguous result
  (regression-tested).
- `agent-runner` routes judge escalations into the approval-queue flow.

### CLI permission bridges — exhaustive fail-closed verdicts
- `src/modules/model/permission-bridge.ts` (shared by claude-code and the Grok
  ACP provider, `src/modules/model/submodules/grok-cli/acp-governance.ts`):
  **only an explicit gate `allow` proceeds** — `deny`, `escalate`, `judge_error`,
  an unrecognized decision, or the gate throwing all deny, fail-closed.
  `escalate` additionally enqueues an approval-queue entry; every non-allow
  verdict is pino-logged.
- **BREAKING:** an EYAS install with no judge-capable model configured now
  **denies `Write`/`Edit`/`Bash` in interactive claude-code/Grok CLI chats**
  until a model is configured or the owner approves the queued request — the
  previous `bypassPermissions`/`--always-approve` fallbacks that allowed these
  tools with no judge are gone.

### Deterministic gate — unknown tools escalate, paths denylisted
- Unrecognized tool names now **escalate** (human approval) instead of the
  previous silent allow; the gate also consults the tool registry's `riskTier`.
- New sensitive-path denylist for file/shell tools (`deterministic-gate.ts`):
  `master.key`, the SQLite data directory, `.env`/`.envrc`/`.ENV` (case-insensitive,
  directory-aware), `.ssh`, SSH key files, and the configured DB path.
- Every gate decision is now audit-logged, including green allows (previously
  only denials were). Denial-streak lockouts gain a 10-minute cooldown recovery
  instead of staying locked indefinitely. `WebFetch`/`WebSearch` moved from green
  to **yellow** (judge-reviewed). ACP tool kinds with no canonical mapping get a
  reserved name instead of falling through to an attacker-supplied title
  (closes a title-spoofing gap).

### Autonomous classification contract
- New `ModelRequestMetadata.origin` + `isAutonomousRequest`: only explicitly
  human-attended origins count as interactive — **absence of an origin now
  means autonomous, fail-closed** (previously the reverse). All run-construction
  call sites are labeled.
- Delegation/team/pipeline runs are now ladder-gated by this classification:
  locked-category tools (e.g. `run_command`) deny on these runs until the F2
  approval-resume flow lands — a known, accepted blast-radius increase flagged
  for follow-up.

### Tool executor — single authorization choke point + MCP closure
- `src/modules/tools/tool-executor.ts` is now the one place a tool call is
  authorized: CASL actor check + security gate + autonomy ladder, failing
  closed if authorization isn't wired.
- MCP server routes moved from `/mcp/*` to `/api/v1/mcp/*`, now behind auth and
  a CASL `execute Tool` check (previously reachable without going through the
  normal authorization path). The `mcp-server` submodule now ships
  **default-disabled** with no runtime toggle — enabling it requires editing
  the manifest source directly.
- Role `user` gains the `execute Tool` ability; `executeAgent` delegation and
  pipeline runs now carry a proper tool-execution context (previously missing,
  which would have made those paths reject every call under the new choke point).


### F1 dead-wiring closure

Nine-task follow-up closing the dead-wiring gaps found in the same 07-28
review: builtin tools that resolved their backing services to `undefined`
at bind time, agent templates whose tool lists matched no registered tool,
a conversation-update path duplicated by a hand-written 25-branch
if-chain, team-session context that never reached subagent runs, a
Mission Control/board/team WebSocket surface with no working transport,
and a board column meant to trigger unattended agent runs that no code
ever armed. Every seam below is proven live against the real
registry/executor/bus, not just unit-mocked.

### Behavior changes to know before relying on this build
- Background/autonomous runs of conversations with `thinking`, `effort`,
  or `orchestration: deep` set now actually **spend** the tokens those
  settings imply — previously the columns were silently ignored on the
  scheduled/board run path (thinking was always off). Existing scheduled
  conversations that already had these fields set will start costing more.
- Dragging a card into — or **creating** a card directly in — a
  bot-capable stage (`botListen`, or one with an `autoAssigneeId`) now
  arms it and starts an unattended agent run, using the card title as the
  goal when no prompt is set. This is wider than "drag only."
- Two agents that both hold `move_to_stage`/`assign_task` can, in
  principle, ping-pong a card back and forth; bounded by budget,
  `maxTurns`, and the single-flight/claim-recheck choke point in
  `bot-executor`, but not structurally prevented.
- Any agent created from a template before this wave — or with a
  persisted empty/NULL tools list — previously ran with **zero** usable
  tools (placeholder names matched nothing, and an empty list resolved to
  "no tools" instead of "no restriction"). Such agents now fall back to
  the full, per-call-gated tool menu the next time they run — a real
  capability increase for agents that were silently inert.
- Mission Control's per-run progress bars and cost figures still read
  zero at this wave — the F2 cost producer (later in this release) is
  what writes `tokens_used`/`cost_usd` onto `agent_sessions`.

### Tools — every builtin now hits a real service, not `undefined`
- Root cause was two independent defects: (1) `onRegister` built each tool
  factory against `(ctx as any).memory`/`knowledge`/`documents`/`research`/
  `search.engine` before those services were published in `onStart`,
  capturing `undefined` for the process lifetime; (2) even the services
  present at bind time were called through methods that don't exist
  (`board.listProjects`, `documents.listByResource`,
  `conversations.getStatus`, `search.search`, `memory.search(query, opts)`).
- Fix: the F0 lazy-getter pattern applied to every tool factory
  (`src/modules/tools/register-builtins.ts`) — services now resolve
  **per call**; a not-yet-ready service returns a structured `{ error }`
  instead of throwing.
- `search_indexed`, `search_knowledge`/`get_page`/`create_page`,
  `list_documents`/`read_document`, `search_memory`/`save_memory`,
  `list_projects`/`move_to_stage`, `get_conversation_status`, and
  `research` all now call the real, currently-shipped service API.
- **Ruling (D1) — empty tools list means "all tools."** An agent whose
  persisted `tools` is `NULL` or `[]` now resolves to the full tool menu
  (still individually gated by the security gate/autonomy ladder), not
  zero tools; fixed at all three run-path call sites (`agent/index.ts`,
  `conversation-runner.ts`, `orchestrator.ts`).
- **Ruling — `send_agent_message`/`read_agent_messages` stay green**
  (in-process, session-scoped, no egress) via an explicit autonomy-category
  override, hardened so a `null` override can never exempt a RED-tiered tool.
- **Ruling — `research` reclassified green → yellow**, matching
  `WebFetch`/`WebSearch` (web search/fetch is the same exfiltration-class
  egress; now judge-reviewed like its SDK siblings instead of
  deterministically auto-allowed).
- All 16 agent templates' `tools:` arrays renamed from placeholder strings
  to real registered tool names (the placeholders matched nothing, so
  every template-created agent ran with zero tools); every template also
  gained the coordination set (`delegate_to_agent`, `write_team_memory`,
  `read_team_memory`, `send_agent_message`, `read_agent_messages`). Both
  agent-creation INSERT paths (the `auth` setup wizard, `team-bootstrap`)
  now persist `tools` at all — previously omitted from the column list
  entirely.

### Conversations — schema-driven update, settings + team context threaded
- `conversation-service.ts`'s hand-written 25-branch `update()` if-chain
  is replaced by a single loop over a typed `UPDATE_FIELD_MAP`
  (`satisfies Record<keyof ConversationUpdate, …>` — a field added to one
  without the other is now a compile error); `teamSessionId` is a
  first-class, directly persisted column.
- Autonomous/background/board-triggered runs now read and honor the
  conversation's `thinking`/`effort`/`orchestration` settings (see the
  cost behavior note above).
- `teamSessionId` (+ derived `sessionId`/`agentRole`) now threads through
  every run shape: orchestrator subagents, `executeAgent` delegation,
  channel-triggered runs, and sub-conversations. `injectTeamMemory` — dead
  since it was written — is revived and actually injects teammates'
  memory into the system prompt, hardened against prompt injection
  (data-framing sentence, fixed-point tag-stripping so a hostile memory
  entry can't forge a closing tag and smuggle instructions past the
  boundary, `[unattributed]` instead of a forgeable `[system]` tag).
- **PATCH `/conversations/:id` now strips `teamSessionId`** from client
  request bodies — the field became directly writable the moment it
  joined `ConversationUpdate`, and a client PATCH could otherwise forge
  team-session membership.
- **Ownership enforcement added to every team-session route** (propose,
  memory read/write, get, list, approve, reject, resume) — previously any
  authenticated user could bind to, read, or act on another user's team
  session; `approve` was the sharpest gap, since it could start (and bill)
  an execution against a foreign session.

### WebSocket — the wire is real, front to back
- The bus→WS bridge is rebuilt on a shared `WS_TOPICS` module
  (`src/shared/ws-topics.ts`) instead of ad hoc string subjects on each
  side; a contract test bans string-literal `subscribe(`/`broadcast(`
  call sites and requires every topic to have both a backend producer and
  a frontend consumer.
- Frames are now thin, **projected** payloads — an allow-listed key set
  per topic, not the raw bus event — so run-failure error text, autonomy
  actor/decision detail, and rendered budget-alert sentences no longer
  ride the wire to every subscriber of a shared topic.
- Mission Control's snapshot socket (previously an unwired, tested-but-dead
  pusher) is replaced with a REST snapshot fetch plus a thin live ping
  that triggers a refetch; a real session registry now backs it (it was
  rendering an empty fallback while runs were actually in flight). Pause/
  resume are hidden in the UI — the registry has no suspend primitive and
  both endpoints now answer a hard 500 instead of silently no-op-ing;
  Interrupt remains the supported control.
- The monthly `model:budget:reset` event finally has a subscriber —
  previously zero, meaning an agent that hit its monthly budget stayed
  blocked forever.
- Frontend: team-proposal state now survives a page reload (REST-hydrated
  team-session discovery on conversation load), the team-memory dashboard
  panel auto-expands on hydration and on live approval, and the run tree
  replays from persisted `orchestration_events` instead of only showing
  runs that started after the page loaded.

### Board → agent trigger + `assign_task`
- Stage automation (`src/modules/board/stage-automation.ts`) now actually
  arms a card for autonomous pickup when it enters a `botListen` stage or
  one with an `autoAssigneeId` set — previously `bot-executor` polled for
  a `'waiting'` status nothing ever wrote, gated on a stage auto-assignee
  column that was insert-only dead (no UI, no update path). A bus kick
  (`card_armed` / `task_assigned`) now wakes the executor immediately
  instead of waiting for the 10-minute cron sweep (kept as a
  crash-recovery fallback). See the behavior note above — this also fires
  on card **creation**, not just a drag-move.
- New `assign_task` tool — async handoff to another agent via a
  sub-conversation, capped at an ancestry depth of 5 to bound delegation
  chains; yellow risk tier. See the behavior note above on the ping-pong
  possibility with `move_to_stage`.
- Stage editor gained an Auto-assign column (all four locales: en/hu/de/es).

### Testing infrastructure
- New contract-test harness (`tests/helpers/tool-contract.ts`) runs tool
  factories through the *real* registry + executor with the F0
  authorization choke point active, rather than mocking the executor
  away — the tool-seam fixes above were TDD'd red-then-green against it.
- New i18n-parity contract test for `src/web` locale bundles (en/hu/de/es
  key + placeholder parity), alongside the existing backend one.
- New `ws-topics` contract test enforcing the shared-topic-module
  convention described above.

### Follow-ups (deferred out of this wave; several closed in F2 above)
- Mission Control's per-run progress/cost bars needed a producer writing
  `tokens_used`/`cost_usd` onto `agent_sessions` — closed in F2 (cost producer).
- `PATCH /conversations/:id` still leaves other system-managed fields
  client-writable (`parentConversationId`, `agentId`, `sdkSessionId`,
  `totalCostUsd`) — same shape as the `teamSessionId` fix, not yet swept.
- `assign_task`'s default global pickup stage can land a child card off a
  project-scoped board (spec-conformant today, not reconciled).
- No component-test infrastructure for the new/changed `src/web` UI
  (verified via `tsc`/`vite build` + store/hook unit tests only — no
  jsdom render-level tests).
- Per-conversation "streak" keying and a few other minor items noted in
  the F1 ledger remain open; see
  the F1 remediation notes for the complete list.

---

## [0.8.3-beta] - 2026-04-19 — Memory rewrite (5-tier + vault + sqlite-vec) + Prompt Enhancer

Scope: Phase 1 security hardening Wave 1c, Phase 2 email provider wiring,
Phase 3 inspiration patterns (E/F/G/M + integrations), Phase 4 bootstrap
registration, Phase 5 observability + i18n integration, a comprehensive
memory-module rewrite (5-tier + Obsidian-parity vault + sqlite-vec), and
the new Prompt Enhancer sub-conversation feature with its own routing
tier. All changes land on a clean type check and a green test suite.

### Memory module — Obsidian-parity rewrite
- **sqlite-vec integration:** Native vector storage via the `vec0` virtual
  table, activated through Bun's `Database.setCustomSQLite` pointing at
  homebrew libsqlite3. Embedding dimensions initialised lazily on first
  write. Cosine similarity queries run against the same SQLite file as
  the rest of memory — no external service required.
- **Reciprocal Rank Fusion hybrid search:** FTS5 BM25 ranks and vector
  similarity ranks fused via RRF, with explicit AFTER INSERT / UPDATE /
  DELETE triggers on `episodic`, `semantic`, and `archive` FTS tables.
  `escapeFtsQuery` rewritten to tokenise → AND-join so multi-word queries
  return hits instead of phrase-matched zeros.
- **Semantic promoter (consolidator):** LLM summariser condenses episodic
  clusters into semantic memories on a scheduled tick. Review queue
  persistence for skill / wiki proposals so the consolidator can surface
  promotions without auto-adopting them.
- **Obsidian-compatible vault:** wikilink parser for `[[note]]`,
  `[[note|alias]]`, `[[note#heading]]`, `[[note^block]]`, `![[embed]]`.
  Dataview-style query API (`vault-query.ts`). Daily notes + templates
  service. Tag pivot service backing an aggregate tag view.
- **Graph + backlinks:** endpoints resolve wikilink targets against
  basenames, titles, and aliases so the graph and backlinks panels stop
  showing empty results for isolated nodes. Cytoscape.js graph view,
  clickable tag pivot, review queue UI.
- **Routes:** new `/api/v1/memory` endpoints for graph, backlinks, tags,
  templates, review queue, dataview query, episodic/:id, archive.
  Working-block character counts resolve via `contentLength ?? length`
  (no more empty counters).
- **Frontend Memory page:** full dashboard rewrite — Overview, Working,
  Episodic, Semantic, Archive, Graph, Tags, Review tabs. Every row in
  every tab is clickable; detail modals use explicit opaque backgrounds
  to avoid transparency bleed on top of the vibrancy backdrop.
- **Agent-scoping:** SQL injection path eliminated — the agent_id list
  filter now flows through parameterised queries.

### Prompt Enhancer (new feature)
- **Sub-conversation architecture:** a "wand" button next to the paperclip
  in the conversation input opens a dialog that spawns a child
  conversation with `goalDescription='prompt-enhancer'`. The system
  prompt installs a coach persona that emits a `<final-prompt
  carry-attachments="all|none">…</final-prompt>` block once it converges.
- **File attachments + carry-over:** the dialog supports the same upload
  / paste / drop flow as the main input. When the enhancer signals
  `carry-attachments="all"`, Apply pushes the refined text back into the
  parent input AND attaches the documents by ID (no re-upload — the file
  store is reference-counted via the link table).
- **Dedicated `prompt_enhancer` routing tier:** the enhancer runs on its
  own tier in the `routing_tiers` table. Seed logic upgraded to upsert
  missing defaults so existing databases receive the new tier. The
  enhancer-route looks up `resolveForTier('prompt_enhancer')` at
  sub-conversation creation time and sets `providerId`/`modelId` before
  the first user message.
- **SSE consumption in the dialog:** the `/messages` endpoint streams
  Server-Sent Events, so the dialog drains the stream via a dedicated
  `postMessageStreamed` helper and then refetches the full conversation
  — the previous `api.post` path was rejecting the stream as "Non-JSON
  response: OK".
- **Providers page:** new Prompt Enhancer row with a Wand2 icon in the
  Routing Tiers configurator.

### Other changes in this window

### Phase 1 — Security (Wave 1c)
- **S5 Privacy sanitization:** Replaced offset-based reconstruction that
  drifted whenever a PII replacement changed length. Each ModelRequest
  segment (system prompt, string message, text block) is now scanned and
  sanitized in isolation — indices cannot leak between neighbours.
- **S7 Worktree lifecycle:** Module-scope tracker + SIGTERM/SIGINT/exit
  handlers plus `gcOrphanedWorktrees(basePath)` at startup. Zombie
  `agent/*` branches left by SIGKILL'd prior runs are swept automatically.
- **S8 Delegation TOCTOU:** `validate` + `createChildConversation` now run
  inside one `ctx.db.transaction(...)`. Execution still runs outside the
  lock so long-running LLM calls never hold a writer.

### Phase 2 — Email providers wired into channel router
- Microsoft 365 (Graph + OAuth2), Gmail API (OAuth2), and the generic
  SMTP/IMAP adapter all plug into the existing Channel router via a new
  EmailProvider → Channel bridge. Each configured provider becomes its
  own channel keyed by mailbox address; any combination runs concurrently.
- Bridge preserves threading (`inReplyTo`, `References`), strips duplicate
  "Re:" subject prefixes, and fails init gracefully so a misconfigured
  provider cannot block the others.

### Phase 3 — Inspiration patterns
- **3E Interactive Planning:** Zod Plan/Step/Risk schema, complexity
  detector heuristic, LLM plan generator with JSON recovery and retry,
  immutable approval transitions. Runner wrapper (`maybePlanTask`) sits
  ahead of `runner.run()` without modifying it — fail-closed when no
  approval callback is wired.
- **3F Approval Tier Mode:** paranoid/balanced/autopilot policy with
  call-site > per-tool > per-user > per-risk-tier > global precedence.
  Integrated into agent-runner: approved tool calls can gate on a
  `onApprovalRequired` callback; absent callback or callback throw
  resolves to fail-closed denial. Default: autopilot — unchanged runtime.
- **3G Flow runner:** deterministic Zod-typed DAG with cycle detection at
  build time, per-node input/output schema enforcement, stable
  topological order, abort-safety. Fan-in uses a source-id-keyed record
  unless an explicit `edge.map` is supplied.
- **3M ACI output truncation:** per-tool output formatter with verbatim /
  line-head-tail / json-head / binary-summary / byte-trim strategies.
  Truncation markers embed an optional follow-up hint so the model
  knows how to retrieve the omitted portion.

### Phase 4 — Bootstrap integration
- 7 inspiration modules (event-store, artifacts, mission-control, ops,
  client-wiki, skill-generation, pipelines.ticket-to-code) registered in
  `bootstrap.ts`. Dependency order resolved by `ModuleLoader.resolveDependencies()`.
- CASL subjects seeded for event-store, client-wiki, skill-generation
  with role-appropriate defaults (agent can propose skills but not adopt;
  event-store is read-mostly; wiki is collaborative).

### Phase 5 — Integration & polish
- **Prometheus `/metrics` endpoint:** `createPrometheusExporter` wired
  into observability.onStart. Secret-driven hardening
  (`prometheus-bearer-token`, `prometheus-ip-allowlist`). Exposes 5
  collector families (agent, tool, model, http, runtime).
- **OpenTelemetry tracing:** `createOtelService` wired, OTLP/HTTP exporter
  activated only when `otel-endpoint` secret is set. Noop processor
  otherwise so instrumentations stay zero-cost. `onStop` flushes and
  shuts down the service for clean Kubernetes pod termination.
- **i18n parity guard:** tests/core/i18n-parity.test.ts auto-discovers
  every locale under `src/core/i18n/locales/` and validates same
  namespaces, same keys, same placeholder sets against the HU reference.
  New baseline namespaces for `approval` and `planning` shipped in both
  locales for the forthcoming frontend work.

### Type + test hygiene
- **tsc: 100 → 0 errors.** EyasDb gains generic `all<T>` / `get<T>`,
  routes factories relaxed to `Hono<any>`, path-param asserts where
  Hono's narrower typing rejects a runtime invariant, explicit mock
  return types, ambient declarations (`src/optional-modules.d.ts`) for
  dynamically-imported optional deps (imapflow, discord.js, @slack/bolt,
  playwright).
- **Baseline test failures: 16 → 0.** TaskSourceAdapter tests switched
  to a Drizzle wrapper (they were passing the raw sqlite handle),
  ProjectService seed-guard added to `update()` to match `delete()`,
  LlmJudge fail-closed test updated to expect the typed `judge_error`
  decision, Scheduler E2E renamed 'Skill Evolution Scan' → 'Forge Scan'.
  Vault-watcher E2E tests now `it.skipIf(!EYAS_TEST_VAULT_DIR)` to avoid
  false failures when test cwd ≠ server cwd.

### Phase 5 — Notifications completion
- **Batch / digest engine wired:** `notification_batch_queue` schema,
  `createBatchEngine` exposed via router, preferences now carry a
  `deliveryMode` column (`immediate` | `batched`). Critical severity
  always bypasses batching.
- **Retry engine wired:** `notification_retry_queue` schema, exponential
  backoff (30s → 60s → 120s → dead letter at 3 attempts), router
  auto-enqueues retries whenever a channel `send()` returns false or
  throws. `/api/v1/notifications/retry-stats` for ops visibility.
- **Webhook channel wired:** DB-backed per-user endpoint
  (`notification_webhooks` table) with HMAC-SHA256 signatures
  (`X-EYAS-Signature: sha256=…` when a shared secret is set). Routes
  GET/PUT/DELETE `/api/v1/notification-webhooks` with SSRF-aware URL
  validation (blocks loopback, `169.254.169.254`, `.internal`, non-http(s)
  schemes).
- **Template engine wired:** channel-specific renderers (email HTML
  table digest, telegram markdown, webhook JSON, web plain text) with
  HTML escape. Custom `registerTemplate(eventPattern, template)` with
  exact-then-wildcard matching.
- **Periodic processor:** module `onStart` spawns a 30s interval tick
  that drains `batchEngine.processDue()` and `retryEngine.processDue()`,
  cleaned up in `onStop`.
- **i18n:** `notifications` namespace baseline in HU + EN (settings,
  webhook, retry, severity labels).

### Test coverage
- ~130 new / fixed tests added across Phase 1-5. Notifications wiring
  adds 38 tests (templates 13, batch 9, retry 8, webhook 8) across 4 new
  files. Final suite: **269 files / 2472 passed / 3 skipped / 1
  pre-existing E2E failure (functional-memory episodic list ordering —
  unrelated, tracked separately)**.

### Autonomous Agent Prompt Architecture v2 — Phase 10: Integration tests + docs

#### Test harness (`tests/helpers/test-eyas.ts`)
- **`setupTestEyas()`** — lightweight harness for integration tests: tmpdir data
  folder, in-memory SQLite + Drizzle, real workspace loader/writer/soul pipeline,
  stub model provider (no LLM calls). Returns typed `api`, `assembler`,
  `workspaceLoader`, `workspaceWriter`, `db`, `dataDir`, `shutdown`.
- `makeMockVoiceProfile()` — helper exported for delegation chain tests.

#### Integration tests (`tests/integration/`)
- **`end-to-end-primary-agent.test.ts`** — 5 assertions: workspace files created,
  agent name substituted, prefix tags (`<core-identity>`, `<agent-identity>`,
  `## My mission`), suffix contains `Voice scope: INTERNAL`, token budget < 8800.
- **`sub-agent-delegation.test.ts`** — originating agent voice signature preserved
  through delegation chain; specialist prompt contains `<core-identity>`,
  `<subagent-role>`, `<task>`, `<delegated-voice>`.
- **`voice-scope-override.test.ts`** — 8 assertions covering the full 5-level
  priority hierarchy: per-message > ephemeral > per-conversation > per-channel > auto.
  Also covers ephemeral TTL expiry.
- **`identity-self-edit.test.ts`** — `workspace_update_identity` tool: section
  update fires notification with diff, revert restores file, rate limit blocks
  4th update in a day.
- **`soul-forge-proposal.test.ts`** — `forge_propose_soul_change` inserts row,
  `SoulProposalApplier.apply()` updates SOUL.style.json + re-renders SOUL.md,
  assembler prefix hash changes after apply.
- **`cascade-merge.test.ts`** — project-type AGENTS.md + project AGENTS.md +
  agent AGENTS.md all appear in prefix; order: type < project < agent.
- **`provider-adapter-parity.test.ts`** — AnthropicAdapter sets `cache_control:
  ephemeral` on prefix block; OpenAIAdapter concatenates prefix+suffix; Ollama
  capabilities declare `promptCache=none`; all verified without real API calls.
- **`voice-scenarios.test.ts`** — parametric test over 10 fixture scenarios.

#### Performance gate (`tests/performance/prompt-cache-anthropic.test.ts`)
- Synchronous unit test (always runs): verifies prefix block carries
  `cache_control: { type: 'ephemeral' }`.
- Gated test (`describe.skipIf(!EYAS_REAL_ANTHROPIC)`): documents the ≥ 80%
  cache hit ratio gate for 10-turn loops; skipped in CI.

#### Migration test (`tests/migration/`)
- **`helpers/seed-v1.ts`** — seeds all 16 templates as v1 rows + `simulateMigration()`.
- **`migrate-v1-to-v2.test.ts`** — roundtrip: seed → snapshot → bootstrap workspaces
  → assert IDENTITY.md/SOUL.md per tier → rollback → assert v1 columns restored.

#### Fixtures (`tests/fixtures/voice-scenarios.json`)
- 10 voice scope scenarios: owner-dm, owner+team, owner+known-contact,
  owner+unknown-external, outbound-proactive, multi-team-member, broadcast-public,
  team-only (no owner), mixed large group, proactive-to-external.

#### Docs
- Architecture notes — Section 44 (Prompt Wizard) updated with v2
  summary: file-based workspace, assembler pipeline, cache boundary, voice system.
- Agent voice guide (Hungarian user guide): 6 dimenzió,
  8 preset, tiltott szófordulatok, override beállítások.
- Manual QA stub (deferred).

---

## [0.8.2-beta] - 2026-04-14

### Features
- **Extended Thinking:** Conversation-level thinking mode (Off / Low / Medium / High / Max) with token budget presets (5k–100k). Provider pass-through for Anthropic and Claude Code SDK. Thinking blocks displayed as collapsible violet panels during streaming. Locked after first message.
- **Markdown Rendering (Streamdown):** Vercel Streamdown integration for streaming-aware markdown in chat messages — GFM tables, syntax-highlighted code blocks (Shiki CDN), copy/download buttons, bold/italic/lists. Handles unterminated blocks during streaming gracefully.
- **MCP Tool Bridge:** EYAS tools exposed to Claude Code SDK via in-process MCP server. Agents can use EYAS tools (memory, search, knowledge, documents) alongside SDK built-in tools.
- **Static Frontend Serving:** SPA fallback added to main.ts entry point.

### Fixes
- **Claude Code SDK Isolation:** `settingSources: []` (SDK isolation mode) prevents `~/.claude/` user-level configs from leaking into EYAS conversations when `loadClaudeMd` is disabled.
- **Streamdown Controls:** Table fullscreen disabled (fixed overlay incompatible with split panel layout). Copy and download buttons retained.

### Documentation
- Architecture spec: `streamdown` dependency, `thinking`/`thinking_budget` columns in conversations schema.
- Specification HTML: Extended Thinking + Markdown Rendering in Conversation Pipeline section.
- Overview HTML: Extended Thinking in Model spec, 2 new rows in feature comparison table.
- MCP Tool Bridge design spec added.

## [0.8.1-beta] - 2026-04-12

### Security Hardening
- Path traversal protection on all file-serving endpoints.
- Parameterized queries audit across all modules.
- JWT token validation hardened, expiry edge cases resolved.
- SameSite cookie attributes, origin header verification.
- WebSocket auth hardening for Hand Hub remote connections.
- PBKDF2 iterations increased to 600K for master key derivation.

### Features
- **Skill Ecosystem:** 221 bundled skills across 16 categories, 3 types (knowledge, tool, integration), 15 API integrations.
- **Agent Wizard:** AI-assisted agent creation via conversation skill.
- **Embedding Provider:** Dedicated embedding provider in model module.
- **WebSocket Frontend:** Full real-time integration for board, chat, agent progress.
- **Smart Memory Lifecycle:** Memory tier promotion/demotion, context builder v2.
- **Team Sessions:** Parallel agent coordination, shared memory, real-time dashboard.
- **Agent System Overhaul:** No hardcoded agent names, agent memory, delegation, channel binding.

### Test Coverage
- 1353 tests passing (158 test files).
