# EYAS Workflows — Hybrid Orchestration Visualization

**Date:** 2026-07-08
**Status:** IMPLEMENTED — P0+P1+P2 shipped 2026-07-08; extended 2026-07-28 (hooks on ALL claude-code runs, agent_id tool attribution, event persistence + replay, effort levels, orchestration mode, Grok ACP governance). See CHANGELOG 0.8.3-beta / 2026-07-28.
**Version impact:** None — version stays frozen (spec only, not a release).
**Relation to roadmap:** NEW workstream. NOT part of the Cap 1–7 resilience roadmap
(`[[project_eyas_resilience_roadmap_and_fixes]]`), but reuses its Cap 7 governance spine and
Cap 3 supervision primitives.

## 1. Problem & Goal

When EYAS runs a multi-agent task, the user wants a live **`/workflows`-style progress tree**:
a nested view of agents → subagents → tool calls, updating in real time.

Two execution engines must feed **one** visualization:

- **Non-Claude providers** (Anthropic API, OpenAI, Gemini, OpenRouter, Ollama, LM Studio):
  EYAS's own orchestrator/delegation decomposes and runs subagents.
- **`claude-code` provider:** **Claude itself** drives its native subagents (SDK `Task` tool),
  and EYAS visualizes + governs them.

This is the **hybrid, provider-dependent** model chosen by the user.

### Why this is now feasible (and reverses an earlier constraint)

The earlier decision `[[feedback_eyas_no_cli_subagents]]` forbade Claude Code's `Agent` tool
because **CLI-subprocess** subagents bypass EYAS entirely (no DB/bus/WS/CASL). That objection does
**not** apply to the SDK's **in-process** subagents: `@anthropic-ai/claude-agent-sdk` v0.2.89
runs `options.agents` inside the same `query()` process, EYAS's tools are already bridged in via
MCP, and the SDK exposes everything needed to make them **visible and governed**:

- `canUseTool?: CanUseTool` (Options) — route every tool decision back through EYAS.
- `agents?: Record<string, AgentDefinition>` — programmatic subagent definitions.
- `parent_tool_use_id: string | null` on messages — reconstruct the tree.
- `hooks` with `SubagentStart`/`SubagentStop`/`TaskCreated`/`TaskCompleted`/`PreToolUse`/
  `PermissionRequest` + `includeHookEvents` — subscribe to the subagent lifecycle directly.
- `interrupt` control request — cancellation.

**Escape-valve note:** this refines, not silently overrides, the old memory. The old rule stands
for CLI-subprocess `Agent`; the SDK in-process path is a different mechanism.

## 2. Current State (ground truth from the code)

- **Decomposition is NOT automatic today.** The interactive route
  (`POST /api/v1/conversations/:id/messages`, `conversations/routes.ts`) runs a single
  `agentRunner.run()`; fan-out only happens when the model calls `propose_team` (human-approval
  gated) or `delegate_to_agent`. The heuristic auto-triggers `analyzeComplexity`
  (`agent/complexity-analyzer.ts`) and `maybePlanTask` (`agent/planning*.ts`) are **dead code**.
  *(Out of scope here — see §7.)*
- **Subagents run through the same abstraction:** `agentRunner.run()` → `gateway.stream()` →
  `provider.stream()`. Each subagent is a child EYAS conversation (`createSubConversation`).
- **The `claude-code` provider** already calls the SDK `query()` (resume+sessionId, maxTurns 25,
  `permissionMode: 'bypassPermissions'`, cwd) and **already bridges EYAS tools (incl.
  `delegate_to_agent`) into the session as `mcp__eyas__*`**. But it **pins
  `tools: SDK_BUILTIN_TOOLS`** (9-tool allowlist, no `Task`/`Agent`) and **never sets `agents`** →
  Claude cannot spawn its own subagents today.
- **The provider stream is flat:** `StreamEvent` (`model/types.ts:94`) has no `parent_tool_use_id`,
  no tool inputs/results from the CC internal loop; the `done` event collapses to one `text` blob
  with `stopReason:'end'`. So even a CC multi-agent run has nothing renderable.
- **Progress barely reaches the browser.** `routes-team.ts` emits `team:<id>:event` on the bus, but
  `core/http/ws-bridge.ts` `BRIDGE_MAPPINGS` does **not** map `team:*`, and `local-bus` is
  exact-subject match (no wildcards). Mission Control sidesteps this with its own dedicated WS.
- **No recursive tree exists.** `TeamDashboard` = flat card grid; `SubConversationTree` = single
  level; Mission Control snapshot carries `parentSessionId`+`team.role` but `AgentCard` renders it
  flat. `agent_progress` is a reducer branch in `team-session-store.ts` that the backend **never
  emits** (inert).
- **Known bug to fix in passing:** `routes-team.ts` calls
  `orchestrator.executeTeam(config, parentConversationId, '', id)` with an **empty goalDescription**,
  so approved team subagents receive an empty task. Must persist+pass the real goal.

## 3. Decisions

1. **Hybrid, provider-dependent** (user, 2026-07-08): Claude drives on `claude-code`; EYAS
   orchestrator drives on all other providers; one normalized tree shows both.
2. **Full gate, automatic fan-out** (user, 2026-07-08): on the Claude side, Claude may spawn
   subagents autonomously (no per-fan-out human approval), but **every tool call** routes through
   `canUseTool` → EYAS `security-gate.validateToolCall` (interactive) / autonomy-ladder +
   `autonomy_approvals` queue (`autonomous=true`), strictest-wins. `bypassPermissions` is removed
   for the bridged path. This mirrors the Cap 7 interactive model
   (`[[project_eyas_resilience_roadmap_and_fixes]]`): gating is per-tool, not per-fan-out.
3. **Frontend ships with backend** (`[[feedback_eyas_frontend_always]]`), Sequoia glass style
   (`[[feedback_eyas_design_style]]`).

## 4. Architecture

### 4.1 Normalized progress-event model (shared core)

One vocabulary both engines emit and one store reduces. New file
`src/shared/orchestration-events.ts`:

```ts
export type OrchestrationNodeKind = 'root' | 'agent' | 'subagent';

export interface OrchestrationEvent {
  runId: string;              // team_session id, or a synthesized id for a single-agent run
  nodeId: string;             // stable id for this agent/subagent node
  parentId: string | null;   // null for root; enables the tree
  seq: number;                // monotonic per run, for ordering + gap detection
  ts: number;                 // epoch ms (stamped at emit)
  payload:
    | { type: 'run_started'; goal: string }
    | { type: 'node_started'; kind: OrchestrationNodeKind; label: string; agentId?: string; conversationId?: string }
    | { type: 'node_progress'; turn?: number; maxTurns?: number; tokens?: number }
    | { type: 'tool_started'; toolId: string; name: string; input?: unknown }
    | { type: 'tool_result'; toolId: string; status: 'success' | 'error'; summary?: string }
    | { type: 'node_completed'; status: 'completed' | 'failed' | 'cancelled'; summary?: string; tokens?: number }
    | { type: 'checkpoint'; message: string }
    | { type: 'run_completed'; status: 'completed' | 'failed' | 'cancelled'; totalTokens: number; totalCostUsd: number };
}
```

Bus subject: `orchestration:<runId>:event` (a single, wildcard-free family — add the concrete
subject to the WS bridge, see §4.5). `nodeId` is **provisional** at `node_started` (EYAS side
yields `conversationId:''` before the child exists — key the node by `agentId+phase+slotIndex` and
reconcile the real `conversationId` on `node_completed`).

### 4.2 Engine 1 — EYAS orchestrator (non-Claude providers)

`OrchestratorEvent` (`agent/orchestrator.ts:197`) already covers most transitions
(`phase_started/agent_started/agent_completed/checkpoint/team_completed/team_failed`). Add an
adapter that maps `OrchestratorEvent` → `OrchestrationEvent`, plus:

- **Emit real `node_progress`.** Today per-agent turn/tool activity flows only to the SSE
  `conversation-store` (single-agent), never to the team store. Thread the child run's
  `agentRunner` events (turn_complete, tool_use) up to the orchestrator so each subagent node gets
  live `node_progress`/`tool_started`/`tool_result`. Requires `runAgentInConversation` to accept a
  progress callback and forward runner events.
- **Set `parentId`** from `parent_conversation_id` / `teamSessionId`.
- **Fix the empty-goal bug** (`routes-team.ts`): persist the proposal's `goalDescription` on the
  `team_sessions` row and pass it into `executeTeam`.
- Honor `maxParallelAgents` in the phase loop (currently ignored — parallel phases launch all
  agents at once).

### 4.3 Engine 2 — Claude SDK (`claude-code` provider)

In `model/submodules/claude-code/provider.ts` `stream()`:

- **Enable subagents:** set `queryOptions.agents = <AgentDefinition map built from EYAS
  agent_definitions>` (map `description/prompt/tools/model`), and **include `Task`** in the base
  tool set (add to `SDK_BUILTIN_TOOLS`, or drop the allowlist while keeping the MCP server so the
  full preset — which includes `Task` — is available). Keep `mcp__eyas__*` tools bridged.
- **Subscribe the lifecycle:** set `includeHookEvents: true` and pass `hooks` for
  `SubagentStart`/`SubagentStop`/`TaskCreated`/`TaskCompleted`/`PreToolUse`/`PostToolUse`. Translate
  each into an `OrchestrationEvent`. Read `parent_tool_use_id` on assistant/user messages to set
  `parentId` (the `Task` tool_use id is the subagent's parent node).
- **Governance bridge:** set `queryOptions.canUseTool = deps.canUseTool` and **remove
  `permissionMode: 'bypassPermissions'`** for the bridged path. `canUseTool(toolName, input, opts)`
  → call EYAS `security-gate.validateToolCall` (interactive) or autonomy-ladder + approval queue
  (`autonomous`), returning `PermissionResult` allow/deny. Threads `conversationId/agentId/
  teamSessionId` from `request.metadata`.
- **Cancellation:** forward `request.signal` (add `signal?: AbortSignal` to `ModelRequest`,
  populated by `agentRunner` from `AgentRunOptions.signal` — already exists per Cap 3) into the
  provider; on abort call the SDK query's `interrupt`. Replace the fixed 10-min AbortController with
  one that also honors the incoming signal.
- New provider→gateway `StreamEvent` variants (extend `model/types.ts:94`):
  `{ type: 'orchestration'; event: OrchestrationEvent }` (carries the nested lifecycle up without
  overloading the flat `tool_use_*` events).

### 4.4 Governance bridge details

`canUseTool` policy MUST mirror `agent-runner.ts` (Cap 7 PR2):

- **Interactive run** (`autonomous` not set): `security-gate.validateToolCall(name, input, ctx)`;
  deny → `PermissionResult` behavior:'deny' with reason.
- **Autonomous run** (`autonomous=true`): autonomy-ladder `resolve(categoryForTool(name))`;
  Locked/L1–L2 → enqueue `autonomy_approvals` and deny-until-resolved (fail-closed when no
  reviewer wired, consistent with current behavior); L3 → allow.
- **Strictest-wins** when both apply. Full gate on **all** tools per Decision 2.
- Audit: bridged calls already pass `toolExecutor.execute` (audit + CASL); `canUseTool` adds the
  policy layer the SDK-internal loop otherwise bypasses.

### 4.5 Transport

`orchestration:<runId>:event` must reach the browser. Two options (pick during P0):
- **(a)** Add the concrete subject family to `ws-bridge.ts` `BRIDGE_MAPPINGS` and ensure the
  subscriber matches concrete subjects (work around `local-bus` exact-match, e.g. subscribe per
  active `runId`, or add a small wildcard-capable relay).
- **(b)** A dedicated progress WS endpoint like Mission Control's (`/api/v1/mission-control/ws`),
  which already bypasses the bridge cleanly. **Recommended** — it's the proven pattern and avoids
  touching `local-bus` semantics.

### 4.6 UI

- New recursive `src/web/src/pages/conversations/components/run-tree.tsx` (`<RunTree>`): renders the
  node tree with per-node status dot, label, turn/token, live tool row, expand/collapse. Sequoia
  glass-card + CSS vars (`[[feedback_eyas_design_style]]`); no hardcoded colors.
- New unified store `src/web/src/stores/run-tree-store.ts` reducing `OrchestrationEvent` into a
  `Map<nodeId, RunNode>` tree. Replaces the split between `team-session-store` (flat) and
  `conversation-store.agentProgress` (single-agent) for this view.
- `conversation-page.tsx`: right panel shows `<RunTree>` when a run is active (supersedes the flat
  `TeamDashboard`); `TeamProposalCard` unchanged (pre-exec approval).
- Mission Control: `AgentCard.tsx` renders the already-present `parentSessionId`/`team.role` as tree
  edges (low-effort win, fleet-wide view).

## 5. Phasing

- **P0 — transport + normalized event model + `<RunTree>` (EYAS engine).** Deliverables:
  `orchestration-events.ts`, orchestrator→event adapter, real `node_progress` plumbing, `parentId`,
  empty-goal bugfix, transport (§4.5b), `<RunTree>` + `run-tree-store`. **Outcome: multi-agent EYAS
  runs look like `/workflows`. Zero SDK dependency.** Highest value / lowest risk.
- **P1 — Claude engine.** Provider rework (§4.3): `agents`/`Task`/`hooks`/`parent_tool_use_id`/
  `canUseTool`/`interrupt`; new `orchestration` StreamEvent; governance bridge (§4.4). Outcome: the
  `claude-code` provider fans its own subagents into the same tree, fully gated.
- **P2 — polish.** Per-agent budget/maxTurns under Claude (currently provider-wide default 25),
  checkpoint/resume interplay, `maxParallelAgents` cap, Mission Control edges.

## 6. Testing (TDD, Vitest)

- **P0:** unit — orchestrator→event adapter mapping (each `OrchestratorEvent` → correct
  `OrchestrationEvent`, provisional-node reconciliation); `run-tree-store` reducer (tree assembly,
  out-of-order seq, node reconcile); empty-goal regression (subagent receives the real goal).
  Component — `<RunTree>` renders nesting + status transitions.
- **P1:** `canUseTool` policy parity with `agent-runner` (interactive deny, autonomous ladder,
  strictest-wins) — table-driven; provider hook→event translation (mock SDK messages with
  `parent_tool_use_id`); signal→interrupt cancellation.
- Respect the **3-schema-source** caveat (`test-db.ts`/`test-eyas.ts` diverge from prod DDL) — any
  new column goes into all sources.
- Default `bun vitest run` must stay green offline (e2e excluded per `vitest.e2e.config.ts`).

## 7. Non-goals / out of scope

- **EYAS-side auto-decomposition** (wiring the dead `analyzeComplexity`/`maybePlanTask`): remains
  model-initiated + human-approved as today. Separate decision.
- Version bump (frozen).
- Replacing the `propose_team` human-approval gate on the EYAS side.

## 8. Risks & mitigations

- **Deepens dependency on `@anthropic-ai/claude-agent-sdk`** (flagged "revisit after features",
  MIT concern in `[[project_eyas_resilience_roadmap_and_fixes]]`). Contained: only the `claude-code`
  provider (1 of 7) uses P1; P0 is SDK-free.
- **`canUseTool` latency** — every CC-subagent tool round-trips to the gate. Mitigate with a fast
  in-process path (no network); acceptable per Decision 2 (audit-first priority).
- **Provisional node reconciliation** (`conversationId:''` at start) — cover with reducer tests for
  the start→complete id-swap.
- **`local-bus` exact-match** could silently drop events — §4.5b dedicated WS avoids it; add a test
  asserting an emitted event reaches a subscribed client.
- **SDK hook/`parent_tool_use_id` shape** may differ from assumptions — P1 starts by asserting the
  actual SDK message shapes against `sdk.d.ts` before building the translator.
