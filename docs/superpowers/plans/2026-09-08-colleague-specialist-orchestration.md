# Colleague + specialist orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> (or subagent-driven-development) to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking. Tasks 1–8 done in-session 2026-09-08. Tasks 9–10 remaining.

**Goal:** Colleagues (primary/team) auto-route: `run_specialist` / handoff /
in-roster `assign_task` are green; the Assistant cannot do builder work;
specialists are a shared pool; `propose_team` is only for gaps / epic / explicit ask.

**Architecture:** Keep the existing delegation service, team sessions, and
sub-conversation tree. Split routing from effects at the tool + security-gate
layer. Inject a living roster via `renderInventory`. Implicit work sessions
unlock team memory without a proposal card. Home threads (`conversations.kind`)
back `handoff_to_colleague`. Parallel fan-out and sidebar UI are later tasks.

**Tech Stack:** TypeScript ESM strict, Vitest, Drizzle/SQLite, existing Hono tools registry.

**Spec:** `docs/superpowers/specs/2026-09-08-colleague-specialist-orchestration-design.md`

## Global Constraints

- Released as **0.8.26-beta** (owner closed the wave 2026-09-08).
- English code and comments. User-facing UI strings (Task 10) go in all six
  locales (`en hu de es fr tlh`). Tool errors returned to the model stay English.
- MIT-compatible dependencies only. **This wave adds none.**
- Do not reopen Computer-as-a-place, `request_secret`, Pi, God Mode, or A2A.
- Seed-tool reconcile: exact prior-set only. Never overwrite an edited allow-list.

## File Structure

| File | Responsibility |
|---|---|
| `src/modules/tools/builtin/delegate-tool.ts` | `run_specialist` + alias `delegate_to_agent`; specialist-only; green |
| `src/modules/tools/builtin/handoff-tool.ts` | `handoff_to_colleague`; colleague-only; green; home thread |
| `src/modules/tools/builtin/assign-task-tool.ts` | green when target enabled |
| `src/modules/security-gate/types.ts` | move routing names to green; drop `assign_task` from yellow |
| `src/modules/agent/conversation-runner.ts` | `DESTRUCTIVE_TOOLS` keeps routing names (resume skip, not approval) |
| `src/modules/agent/team-session-service.ts` | optional create status; implicit running session |
| `src/modules/agent/index.ts` | register handoff; implicit-session hook wiring |
| `src/modules/conversations/schema.ts` + `index.ts` + `conversation-service.ts` | `kind`; `getOrCreateHomeThread` |
| `src/modules/conversations/team-auto-propose.ts` | no auto card on complex; nudge specialists |
| `src/modules/conversations/orchestration-directive.ts` | deep → `run_specialist` |
| `src/modules/agent/agent-templates.ts` | Assistant strip; IDENTITY Owns; PRIOR extras; new tool names on colleagues |
| `src/modules/agent/agent-directory.ts` | inventory items (`id`, oneLine) |
| `src/modules/prompt-wizard/cache-prefix-builder.ts` + `token-budget.ts` + `assembler.ts` + `index.ts` | `available-agents` section |
| `src/modules/prompt-wizard/core-identity.ts` + `seed-migration.ts` | delegate bullet |
| `src/modules/tools/builtin/team-tools.ts` | error text if no session (implicit should have created one) |
| `tests/helpers/production-tool-registry.ts` | register handoff |
| Tests listed per task | |
| Sidebar / picker / docs | Task 10 (phase 3) — not this session unless asked |
| `agent-runner.ts` parallel batch | Task 9 (phase 2) |

---

### Task 1: Green routing tools (`run_specialist` alias + specialist-only)

**Files:**
- Modify: `src/modules/tools/builtin/delegate-tool.ts`
- Modify: `src/modules/security-gate/types.ts` (`DEFAULT_CONFIG.riskTiers`)
- Modify: `src/modules/agent/conversation-runner.ts` (`DESTRUCTIVE_TOOLS` add `run_specialist`, `handoff_to_colleague`)
- Modify: `tests/helpers/production-tool-registry.ts` (still `createDelegateTool`)
- Test: `tests/modules/tools/builtin/delegate-tool.test.ts` (create)
- Test: `tests/contracts/tool-service/assign-task-tool.contract.test.ts` (yellow → green in Task 2)

**Produces:**
```ts
export function createDelegateTool(
  delegationService: ReturnType<typeof createDelegationService>,
  registry?: AgentRegistry,
  opts?: { ensureWorkSession?: (conversationId: string, memberIds: string[]) => void },
): ToolImplementation[]
// two tools: name 'run_specialist' and name 'delegate_to_agent', same execute
// riskTier: 'green', requiresApproval: false
```

- [ ] **Test first.** `run_specialist` / alias are green, no `requiresApproval`. Target primary → error containing `handoff_to_colleague`. Target specialist → `delegationService.delegate` called. Missing id → `availableAgents`.

- [ ] **Implement.** Shared execute. If `registry.get(agentId).tier` is `primary` or `team`, return the handoff error. Specialist path unchanged. After success, `opts.ensureWorkSession?.(conversationId, [ctx.agentId, agentId])`.

- [ ] **Gate lists.** Add `run_specialist`, `delegate_to_agent`, `handoff_to_colleague` to `DEFAULT_CONFIG.riskTiers.green`. Do **not** leave `delegate_to_agent` unclassified (unclassified is yellow).

---

### Task 2: `assign_task` green

**Files:**
- Modify: `src/modules/tools/builtin/assign-task-tool.ts` (`riskTier: 'green'`, mention `run_specialist` in the description)
- Modify: `src/modules/security-gate/types.ts` — remove `'assign_task'` from yellow (already green via Task 1 list)
- Modify: `tests/contracts/tool-service/assign-task-tool.contract.test.ts` — expect green, not in yellow

- [ ] **Test.** Registry `assign_task.riskTier === 'green'`; `DEFAULT_CONFIG.riskTiers.yellow` does not contain it; green list does.

- [ ] **Implement.** `riskTier: 'green'`. Keep `DESTRUCTIVE_TOOLS` membership (resume skip).

---

### Task 3: Implicit work session

**Files:**
- Modify: `src/modules/agent/team-session-service.ts`
- Modify: `src/modules/agent/index.ts` (wire `ensureWorkSession`)
- Test: `tests/modules/agent/team-session-service.test.ts` (extend or create)

**Produces:**
```ts
create(parentConversationId: string, input: CreateSessionInput & {
  status?: TeamSession['status']
}): TeamSession
// default status remains 'proposing'

ensureImplicitWorkSession(parentConversationId: string, memberIds: string[]): TeamSession
// if parent already has team_session_id whose row is active → return it
// else create({ config: { source: 'implicit', members: unique(memberIds) }, reasoning: 'implicit', estimatedTokens: 0, status: 'running' })
```

- [ ] **Test.** First ensure creates `running` + stamps parent. Second ensure same id. `write_team_memory` against that id works (existing team-tools test or a thin one).

- [ ] **Implement.** `create` uses `input.status ?? 'proposing'`. `ensureImplicitWorkSession` as above. Pass it into `createDelegateTool` / `createAssignTaskTool` from `agent/index.ts`.

`assign_task` should also call ensure (spec: first spawn or assign).

---

### Task 4: `handoff_to_colleague` + home thread

**Files:**
- Create: `src/modules/tools/builtin/handoff-tool.ts`
- Modify: `src/modules/conversations/schema.ts` — `kind` text default `'task'`
- Modify: `src/modules/conversations/index.ts` — ALTER + unique index
- Modify: `src/modules/conversations/conversation-service.ts` — `kind` on `Conversation`; `getOrCreateHomeThread`; `createSubConversation` writes `kind='delegation'`; `create` writes `kind='task'`
- Modify: `src/modules/agent/index.ts` + `tests/helpers/production-tool-registry.ts` — register
- Test: `tests/modules/conversations/home-thread.test.ts`
- Test: `tests/modules/tools/builtin/handoff-tool.test.ts`
- Contract: `tests/contracts/conversations-schema.contract.test.ts` if it lists columns

**Produces:**
```ts
getOrCreateHomeThread(input: {
  userId: string
  agentId: string
  title: string
  projectId?: string | null
  providerId?: string | null
  modelId?: string | null
}): Conversation  // kind === 'home'

createHandoffTool(deps: {
  getConversations: () => ConversationService | undefined
  registry?: AgentRegistry
  bus?: EyasBus
}): ToolImplementation[]
// name 'handoff_to_colleague', green, requiresApproval false
```

- [ ] **Test home thread.** Two calls same `(userId, agentId)` → same id. Different agent → different id. Unique index holds.

- [ ] **Test handoff.** Target specialist → error to use `run_specialist`. Target colleague → returns `conversationId` of home thread; source unchanged.

- [ ] **Implement.** Handoff: validate enabled primary/team, not self; `getOrCreateHomeThread`; `update` goalDescription + status `waiting`; emit `eyas.board.task_assigned` or a dedicated `eyas.agent.handoff` if the bot-executor already listens to task_assigned — **prefer reusing `eyas.board.task_assigned`** so the existing executor wakes. Append a user-visible line on the home thread via `addMessage`. Return `{ handedOff: true, conversationId, agentId, agentName }`.

---

### Task 5: Team auto-propose + orchestration copy

**Files:**
- Modify: `src/modules/conversations/team-auto-propose.ts`
- Modify: `src/modules/conversations/orchestration-directive.ts`
- Modify: `tests/modules/conversations/team-auto-propose.test.ts`

New `decideTeamAutoPropose` table (v1, no LLM gap-scan):

| Condition | action |
|---|---|
| solo / active session | `none` |
| explicit team language | `propose` |
| first turn + complexity `expert` | `propose` (maps to epic) |
| first turn + `deep` or `auto` + complex/moderate | `nudge` (specialists, not a card) |
| later turns, no explicit | `none` |

Nudge text: call `run_specialist` in parallel for independent slices; `handoff_to_colleague` if another colleague owns it; `propose_team` only if a required specialist is missing.

Deep orchestration directive (non-claude): same, not “propose_team first”.

- [ ] **Tests.** Flip the existing “auto + complex first message → propose” to `nudge`. “deep + moderate → propose” → `nudge`. Keep explicit `/team` → `propose`. `expert` first message → `propose`.

---

### Task 6: Assistant grants + IDENTITY + reconcile

**Files:**
- Modify: `src/modules/agent/agent-templates.ts`
- Test: existing reconcile tests + `tests/contracts/template-names.contract.test.ts` (must stay green)

Assistant `tools` — **remove** `run_command`, `write_file`, `edit_file`, `design_create`, `design_write`.
**Add** `run_specialist`, `handoff_to_colleague`, `assign_task`. Keep `delegate_to_agent`.

Snapshot **before** the edit as explicit `ASSISTANT_PRIOR_TOOLSETS` (two priors: with design tools, without design tools) mapping to the new list. Append those to `PRIOR_TOOLSETS` (do not abuse `TOOLS_ADDED_BY_ROUND` for removals).

`TOOLS_ADDED_BY_ROUND` append:
```ts
['run_specialist', 'handoff_to_colleague', 'assign_task']
```
so other templates that already list `delegate_to_agent` pick up the new names when their list still matches a prior set.

IDENTITY.md seeds: Owns / Does not own / Hands off to (spec §5).

Assistant `systemPrompt`: delete the mandatory propose_team sequence; coordinator rules.

System Engineer IDENTITY: Hands off comms to Assistant; specialists by id.

- [ ] **Test.** `PRIMARY_TEMPLATES` assistant tools exclude builder names and include the three new names. Reconcile: a seed row whose tools JSON equals today’s shipped assistant list upgrades; a mutated list does not.

---

### Task 7: Living roster in the prompt

**Files:**
- Modify: `src/modules/agent/agent-directory.ts` — `toInventoryItems(): { name: string; oneLine: string }[]` where `name` is the **id**
- Modify: `src/modules/prompt-wizard/token-budget.ts` — `availableAgents: 400` on `SectionBudget` + `DEFAULT_BUDGET_FULL` + shrink map
- Modify: `src/modules/prompt-wizard/cache-prefix-builder.ts` — optional `agentsList`, `available-agents` via `renderInventory`
- Modify: `src/modules/prompt-wizard/assembler.ts` + `index.ts` — `resolveAgentsFor`
- Modify: `src/modules/prompt-wizard/core-identity.ts` + `seed-migration.ts` (add current CORE_IDENTITY body to PRIOR before changing)
- Test: `tests/modules/agent/agent-directory.test.ts`
- Test: `tests/modules/prompt-wizard/cache-prefix-builder.test.ts`

Footer: `Call run_specialist or handoff_to_colleague with the id field (not the name). Schemas are the tool API.`

`resolveAgentsFor`: from `(ctx as any).agents` registry if present; `createAgentDirectory(registry).toInventoryItems()`. Fail-soft `[]`.

Every `buildCachePrefix({...})` call site must pass `agentsList: []` or items (TypeScript will catch).

- [ ] **Tests.** Inventory contains ids; disabled omitted; prefix includes `<available-agents>` when list non-empty; footer survives clip (reuse inventory rules).

---

### Task 8: Wire + contract sweep

**Files:** `src/modules/agent/index.ts`, production-tool-registry, `tests/contracts/template-names.contract.test.ts`, any DEFAULT_CONFIG yellow assertions.

- [ ] Run:
```bash
bun test tests/modules/tools/builtin/delegate-tool.test.ts \
  tests/modules/tools/builtin/handoff-tool.test.ts \
  tests/modules/conversations/home-thread.test.ts \
  tests/modules/conversations/team-auto-propose.test.ts \
  tests/modules/agent/agent-directory.test.ts \
  tests/modules/prompt-wizard/cache-prefix-builder.test.ts \
  tests/contracts/template-names.contract.test.ts \
  tests/contracts/tool-service/assign-task-tool.contract.test.ts \
  tests/contracts/conversations-schema.contract.test.ts
```
Expected: all pass.

- [ ] Grep for leftover “ALWAYS call `propose_team` FIRST” and `assign_task` yellow assertions; fix.

---

### Task 9 (phase 2, later): Parallel `run_specialist` in one turn

**Files:** `src/modules/agent/agent-runner.ts`, worktrees in orchestrator for implicit multi-writer.

Not this session.

### Task 10 (phase 3, later): Sidebar Colleagues + picker + i18n docs

Not this session.

---

## Spec coverage

| Spec § | Task |
|---|---|
| D1–D5, D8, D10 routing/grants | 1, 2, 5, 6 |
| D7 implicit session | 3 |
| D6 home thread / handoff | 4 |
| §6 roster | 7 |
| §7 parallel | 9 (later) |
| §8 UI | 10 (later) |
| §9 prompt copy | 5, 6, 7 |
| §11 tests | per task + 8 |

## Placeholder scan

No TBD. `eyas.board.task_assigned` reuse is an explicit choice for waking the bot-executor.
