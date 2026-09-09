# EYAS Workflows — P2 (Polish) Spec + Plan

> **Status: IMPLEMENTED (2026-07-08).** P2 is polish (no security surface). Present before implementing; execute TDD task-by-task. REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** Finish the run-tree experience and close the P0/P1 deferrals: phase nesting, per-tool progress for Claude subagents, per-agent turn budget under Claude, a real concurrency cap, and Mission Control tree edges.

**Prerequisite:** P0 + P1 committed (12 commits on `main`). No new deps.

## Global Constraints

Same as P0/P1 (English code, ESM/strict, no `console.log`, CSS vars, version frozen, MIT deps, no auto-commit/branch/push, `// Part of eYssen.` header, 3-schema-source rule if a column is added). Frontend verified by web tsc + build (no component harness in-repo).

## Tasks (prioritized; independent — can ship one at a time)

### Task P2-1: Phase nesting in the run tree

**Why:** P0 emits subagent nodes with `parentId: null` (flat). Nest them under their phase node so the tree reads as phase → subagents.

**Files:** `src/modules/agent/orchestrator.ts` (thread the phase into the `onProgress` payload), `src/modules/agent/routes-team.ts` (sink sets `parentId` = `phase:<phase>`), `src/shared/orchestration-events.ts` (RunAgentProgress already carries what's needed — add `phase`).
- `RunAgentProgress` (orchestrator.ts): add `phase: string` to each variant (the phase is known in `executeTeam`'s loop; pass it into `runAgentInConversation`'s `onProgress` calls via a bound closure per phase, or add a `phase` arg).
- routes-team sink: `parentId: \`phase:${e.phase}\`` for the conv node; ensure a `phase:<phase>` `node_started` is emitted first (the generator's `phase_started` already produces it).
- Frontend: no change — `run-tree-store` already nests via `childIds` when `parentId` is set; `<RunTree>` already recurses.

**Test:** `tests/modules/agent/agent-node-progress.test.ts` — assert `onProgress` node_started carries the phase; a reducer test in `run-tree-store.test.ts` already covers nesting.

### Task P2-2: Per-tool progress for Claude subagents (P1-4 deferral)

**Why:** P1 shows subagent start/stop but not their live tool activity.

**Files:** `src/modules/model/submodules/claude-code/orchestration-hooks.ts` + test.
- Add a `PreToolUse` matcher: `{tool_name, tool_use_id}` → `tool_started` on the owning subagent node. Correlate the owning node via the hook's context: the `HookCallback` options do not carry `agent_id` directly, so track the "current subagent" from the most recent `SubagentStart` per `parent_tool_use_id` chain **inside the hooks closure** (a `Map` the matchers share). If correlation is ambiguous, attribute to the run root (documented degradation) rather than guessing.
- Emit `tool_started` (name normalized: strip `mcp__eyas__`). Optionally `PostToolUse` → `tool_result`.

**Test:** feed SubagentStart then PreToolUse synthetic inputs → assert a `tool_started` on `sub:<agent_id>`.

### Task P2-3: Per-agent turn budget under Claude

**Why:** the claude-code provider uses the provider-wide `maxTurns` (default 25), ignoring per-agent `agent.maxTurns`.

**Files:** `src/modules/model/types.ts` (add `maxTurns?: number` to `ModelRequest`), `src/modules/agent/agent-runner.ts` (request build: `maxTurns: options.maxTurns`), `provider.ts` (`queryOptions.maxTurns = request.maxTurns ?? maxTurns`).

**Test:** `provider-agents.test.ts` — pass `request.maxTurns = 7`, assert `captured.options.maxTurns === 7`; and it falls back to the construction default when absent.

### Task P2-4: Honor `maxParallelAgents` in executeTeam

**Why:** a parallel phase currently launches ALL `phase.agents` at once — `config.maxParallelAgents` (1 fallback / 3 normal) is set but never enforced (found in the P0 mapping).

**Files:** `src/modules/agent/orchestrator.ts` (the parallel branch of `executeTeam`, ~lines 409-477).
- Bound concurrency to `config.maxParallelAgents` (a simple worker-pool / sliding window over `phase.agents`), preserving the existing streaming-completion behavior.

**Test:** `tests/modules/agent/orchestrator-*.test.ts` — a phase with 5 agents and `maxParallelAgents: 2` never has >2 `runAgentInConversation` in flight (instrument the fake).

### Task P2-5: Mission Control tree edges

**Why:** the `mission-control` snapshot carries `parentSessionId` + `team.role` but `AgentCard.tsx` renders them flat (found in the P0 mapping).

**Files:** `src/web/src/pages/mission-control/AgentCard.tsx` (+ possibly the grid container). **Implement-time read required first:** read `AgentCard.tsx` and the `AgentRunSnapshot` shape (`src/modules/mission-control/types.ts`) to confirm the exact fields before rendering indentation/parent chips. Not specified here to avoid fabricating props.

**Test:** none (no MC component harness) — web tsc + build + visual.

### Task P2-6: Verification

- `bun vitest run` green (the pre-existing `tests/core/bootstrap.test.ts` 5s-timeout flake excepted — it passes at `--testTimeout=30000`; unrelated). `bunx tsc` 0. Web tsc + build. Optional live smoke.

## Non-goals

- Single (non-team) interactive claude-code runs getting a tree (needs a RunTree mount-trigger change beyond `teamSessionId`) — separate, optional.
- Checkpoint/resume interplay with Claude-driven subagents (defer unless needed; the SDK owns the subagent loop).

## Notes

- The `bootstrap.test.ts` default-timeout flake is a repo-wide test-infra issue (full boot ~14-18s > 5s default). Out of scope here; worth a separate `testTimeout` bump for that one test if the user wants a green default suite.
