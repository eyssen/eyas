# EYAS Workflows — P1 (Claude Engine) Spec + Plan

> **Status: IMPLEMENTED (2026-07-08, extended 2026-07-28).** Deviation from plan: no `orchestration` StreamEvent variant — hooks emit directly to the broadcaster sink; since 2026-07-28 the bypassPermissions fallback is removed (fail-closed default mode) and hooks install for all governed runs.
> Per project rules, do NOT implement until the user approves this document.
> REQUIRED SUB-SKILL for execution: superpowers:executing-plans (TDD).

**Goal:** On the `claude-code` provider, let **Claude drive its own SDK subagents** (`Task` + `options.agents`), fully governed via `canUseTool`, and stream the subagent lifecycle into the SAME `orchestration:<runId>` tree the P0 frontend already renders.

**Architecture:** Extend the SDK query options (enable `Task`, define `agents`, add `canUseTool`, drop `bypassPermissions`, forward the abort signal→`interrupt`). Translate SDK `hooks` (`SubagentStart/Stop`, `PreToolUse`, `TaskCreated/Completed`) + `parent_tool_use_id` into normalized `OrchestrationEvent`s via an injected sink. Route every tool decision through the existing Cap 7 governance spine.

## Confirmed API surface (verified against sources 2026-07-08)

- SDK v0.2.89 (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`):
  - `CanUseTool = (toolName: string, input: Record<string,unknown>, opts: { signal: AbortSignal; toolUseID: string; agentID?: string; ... }) => Promise<PermissionResult>`
  - `PermissionResult = { behavior: 'allow'; updatedInput? } | { behavior: 'deny'; message: string; interrupt? }`
  - `AgentDefinition = { description: string; prompt: string; tools?: string[]; disallowedTools?: string[]; model?: string; ... }`; option `agents?: Record<string, AgentDefinition>`
  - Hooks: option `hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>`; `HookCallbackMatcher = { matcher?; hooks: HookCallback[]; timeout? }`; `HookCallback = (input: HookInput, toolUseID: string|undefined, opts) => Promise<...>`
    - `SubagentStartHookInput = { hook_event_name:'SubagentStart'; agent_id; agent_type }`
    - `SubagentStopHookInput = { hook_event_name:'SubagentStop'; agent_id; agent_type; agent_transcript_path; ... lastMessage }`
    - `PreToolUseHookInput = { tool_name; tool_input; tool_use_id }`
  - `query(...)` returns `Query extends AsyncGenerator` with `interrupt(): Promise<void>` and `setPermissionMode()`.
  - Assistant/user SDK messages carry `parent_tool_use_id: string | null`.
- EYAS governance (`src/modules/security-gate/index.ts`): `securityGate.validateToolCall(toolName, input, ctx?) => { decision:'allow'|'deny'|'escalate'; reason; riskTier; ... }`; `securityGate.autonomyPolicy` with `resolve(category)`, `categoryForTool(name)`, `createApproval({category, toolName, agentId, conversationId, reason})`.
- `ModelRequest` (`src/modules/model/types.ts`) has `metadata { conversationId, userId, agentId, teamSessionId }` but **no `signal`**. `StreamEvent` has no `orchestration` variant.
- Provider today (`.../claude-code/provider.ts`): `SDK_BUILTIN_TOOLS` (no Task), `permissionMode:'bypassPermissions'`, fixed 10-min `AbortController`, flattens `tool_use`→`tool_use_start`+`tool_use_end`, never reads `parent_tool_use_id`, `done` always `stopReason:'end'`.
- Provider deps come from `manifest.ts` via `(ctx as any).tools.executor/registry`. The manifest can also read `(ctx as any).securityGate`, `(ctx as any).agents.registry`, and `(ctx as any).wsRegistry`.

## Global Constraints

Same as P0 (English code, ESM/strict, no `console.log`, CSS vars, version frozen, MIT deps, no auto-commit/branch/push, `// Part of eYssen.` header). **Additionally:** governance is mandatory — `bypassPermissions` is removed on the bridged path; every tool call (SDK builtins + `mcp__eyas__*`) passes `canUseTool`. The deepened `@anthropic-ai/claude-agent-sdk` dependency stays contained to this provider.

---

### Task P1-1: Types — `signal` on ModelRequest + `orchestration` StreamEvent

**Files:** Modify `src/modules/model/types.ts`; Test `tests/modules/model/stream-event-types.test.ts` (compile-time / shape).

- Add `signal?: AbortSignal` to `ModelRequest`.
- Add `import type { OrchestrationEvent } from '@shared/orchestration-events.js'` and a variant to `StreamEvent`: `| { type: 'orchestration'; event: OrchestrationEvent }`.
- [ ] Test: a `StreamEvent` of type `orchestration` type-checks and round-trips through a switch. Implement. `bunx tsc`.

### Task P1-2: agent-runner forwards `signal`; gateway/routes pass `orchestration` through

**Files:** Modify `src/modules/agent/agent-runner.ts` (line 318 `const request = {...}` → add `signal: options.signal`); `src/modules/conversations/routes.ts` (SSE switch: map `orchestration` StreamEvent → SSE frame `{type:'orchestration', event}`); Test `tests/modules/agent/agent-runner-signal-forward.test.ts`.

- The runner already has `options.signal` (Cap 3). Thread it into the gateway request so the provider can honor it.
- [ ] Test: a fake provider asserts `request.signal` is the same AbortSignal passed in `AgentRunOptions`. Implement. Run.

### Task P1-3: Governance bridge — `canUseTool` (THE security-critical unit)

**Files:** Create `src/modules/model/submodules/claude-code/permission-bridge.ts`; Test `tests/modules/model/claude-code/permission-bridge.test.ts`.

**Interface:**
```ts
export interface PermissionBridgeDeps {
  validateToolCall(toolName: string, input: Record<string, unknown>, ctx?: { conversationId?: string; agentId?: string }):
    Promise<{ decision: 'allow' | 'deny' | 'escalate'; reason: string; riskTier: string }> | { decision: 'allow' | 'deny' | 'escalate'; reason: string; riskTier: string }
  autonomy?: {
    categoryForTool(name: string): string | null
    resolve(category: string): { level: number; locked: boolean; maxLevel: number }
    createApproval(rec: { category: string; toolName: string; agentId?: string; conversationId?: string; reason: string }): void
  }
  autonomous?: boolean
  ctx: { conversationId?: string; agentId?: string }
}
export function createPermissionBridge(deps: PermissionBridgeDeps):
  (toolName: string, input: Record<string, unknown>, opts: { toolUseID: string; agentID?: string; signal: AbortSignal }) => Promise<PermissionResult>
```

**Policy (mirrors agent-runner Cap 7, strictest-wins):**
1. Normalize `toolName`: strip `mcp__eyas__` prefix.
2. `det = validateToolCall(name, input, {conversationId, agentId})`.
   - `det.decision === 'deny'` → `{ behavior: 'deny', message: det.reason }`.
   - `det.decision === 'allow'` AND (not autonomous OR autonomy not locked) → `{ behavior: 'allow' }`.
   - `det.decision === 'escalate'` OR autonomous-with-restricted-category → autonomy branch:
3. Autonomy branch (only when `autonomous`): `cat = autonomy.categoryForTool(name)`; `{level, locked} = autonomy.resolve(cat)`. Locked or level ≤ 2 → `autonomy.createApproval({...})` + `{ behavior: 'deny', message: 'approval required: ' + det.reason }` (fail-closed — no live reviewer inside the SDK loop). Level 3 → `{ behavior: 'allow' }`.
4. Interactive (not autonomous): escalate → `{ behavior: 'allow' }` (the human owns the conversation, same as agent-runner interactive path) but the call is still audited by `validateToolCall`.

- [ ] Test (table-driven): deny→deny; green allow→allow; escalate+autonomous+locked→deny+createApproval called; escalate+interactive→allow; `mcp__eyas__foo` normalizes to `foo` before validate. Implement. Run.

**Risk-tier coverage:** SDK builtins (`Bash`,`Write`,`Edit`,`NotebookEdit`,`Read`,`Grep`,`Glob`,`WebFetch`,`WebSearch`,`Task`) must resolve to a tier in the security-gate config. Add any missing to the gate's `riskTiers` config (Bash→red; Write/Edit/NotebookEdit→yellow; Read/Grep/Glob/WebFetch/WebSearch/Task→green) so `validateToolCall` classifies them rather than defaulting. Confirm the current `riskTiers` config contents first; add only the missing names.

### Task P1-4: Hooks → OrchestrationEvent sink

**Files:** Create `src/modules/model/submodules/claude-code/orchestration-hooks.ts`; Test `.../orchestration-hooks.test.ts`.

**Interface:** `buildOrchestrationHooks(emit: (e: RunAgentProgressLike) => void, runIdCtx): { hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> }` translating:
- `SubagentStart {agent_id, agent_type}` → node_started (kind subagent, nodeId `sub:<agent_id>`, label agent_type, parentId = current Task's tool_use id if tracked else null).
- `PreToolUse {tool_name, tool_input, tool_use_id}` → tool_started on the owning node (via `parent_tool_use_id`/`agentID` correlation).
- `SubagentStop {agent_id, ...lastMessage}` → node_completed (status completed).
- Emits are shaped as `OrchestrationEvent` and forwarded to the same broadcaster P0 uses (`orchestration:<runId>`), so the existing `<RunTree>` renders Claude-driven subagents unchanged.

- [ ] Test: feed synthetic hook inputs → assert the emitted OrchestrationEvents (types, nodeIds, parent links). Implement. Run.

Node-key rule (consistent with P0): Claude-driven subagents key by `sub:<agent_id>`; the run root is the `teamSessionId` (or a synthesized `cc:<sessionId>` when the claude-code run is a single interactive conversation, not a team). Parent edges from `parent_tool_use_id`.

### Task P1-5: Wire it into the provider

**Files:** Modify `provider.ts` + `manifest.ts`; Test `tests/modules/model/claude-code/provider-agents.test.ts` (mock `query`).

- `provider.ts` `stream()`:
  - Add `'Task'` to `SDK_BUILTIN_TOOLS`.
  - `queryOptions`: remove `permissionMode: 'bypassPermissions'`; set `canUseTool` (from `options.canUseTool`), `agents` (from `options.agents`), `includeHookEvents: true`, `hooks` (from `options.buildHooks?.(...)`), when the bridge deps are present.
  - Replace fixed `AbortController` with one that also aborts on `request.signal` (`request.signal?.addEventListener('abort', () => abortController.abort())`), and keep a reference to the `Query` to call `.interrupt()` on external abort.
  - In the message loop, read `msg.parent_tool_use_id`; keep the existing text/thinking/tool_use handling. (Fine-grained per-subagent events come from hooks in P1-4, not the message loop.)
- `manifest.ts`: construct `canUseTool = createPermissionBridge({ validateToolCall: ctx.securityGate.validateToolCall, autonomy: ctx.securityGate.autonomyPolicy, autonomous: <from request/metadata>, ctx })`, `agents = mapAgentDefinitions(ctx.agents.registry.list({enabled:true}))`, and `buildHooks` bound to the P0 broadcaster (`createOrchestrationBroadcaster(ctx.wsRegistry)`). Pass through `ClaudeCodeProviderOptions`.
  - `mapAgentDefinitions`: EYAS agent_definitions → `{ [id]: { description: goal||role, prompt: systemPrompt, tools: agent.tools, model: MODEL_TO_CLI_ALIAS[agent.model] ?? undefined } }`.

- [ ] Test: mock `query` to capture `queryOptions`; assert `Task` present, no `bypassPermissions`, `canUseTool`/`agents`/`hooks` set when deps present; assert `request.signal` abort triggers `query().interrupt()`. Implement. Run.

### Task P1-6: Verification

- [ ] `bun vitest run` green (2990+ new); `bunx tsc` 0.
- [ ] Web unaffected (no frontend change in P1 — the existing `<RunTree>` consumes the same events).
- [ ] Browser/live smoke: a claude-code-backed agent that calls `Task` shows its subagents in the run tree, and a locked-category tool is denied by `canUseTool` (audited).

## Non-goals (P1)

- Per-agent budget/maxTurns under Claude (P2), checkpoint/resume interplay (P2), Mission Control edges (P2).
- Changing the EYAS-engine path (untouched).

## Risks

- **Governance correctness is paramount** — P1-3 is the security unit; table-driven tests + the fail-closed default (deny when uncertain/locked) are mandatory. A bug here = an ungoverned autonomous tool call.
- **Hook shape drift** — P1-4 starts by asserting the real SDK hook payloads against `sdk.d.ts` before building the translator.
- **`canUseTool` latency** — every SDK-builtin call round-trips to the gate; acceptable per Decision 2 (in-process, no network).
- **Deepens SDK coupling** — contained to this provider; the other 6 providers are unaffected.
