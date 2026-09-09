# Colleague + specialist orchestration

**Date:** 2026-09-08
**Status:** Implemented (phases 1–3) and released as 0.8.26-beta (2026-09-08).
**Modules:** `agent`, `tools`, `prompt-wizard`, `conversations`, `board` (assign_task), frontend shell + conversations
**Does not replace:** God Mode, A2A, team dashboard, worktrees, security-gate, autonomy ladder

Approved in chat: the user talks to **colleagues** (primary + team) with strict roles; they **automatically** hand off and spawn **specialists** from a **shared pool**, preferably in parallel. Routing is not a human gate. Effects still are.

---

## 1. Problem

The roster, tiers, `delegate_to_agent`, `assign_task`, team sessions, and sub-conversation tree already exist. The product does not feel like Rakazo / Grok Bot colleagues because:

1. `delegate_to_agent` is yellow and `requiresApproval: true` — every hop waits for a click, so the model does the work itself.
2. Multi-domain work is scripted to call `propose_team` first (a card). That is org design, not routing.
3. The Personal Assistant template still grants `write_file` / `run_command` / git writes, so it *can* do specialist work.
4. `AGENTS.md` seeds are empty; `agent-directory.toPromptText()` is unused. The model has no living roster.
5. `write_team_memory` refuses to run without a `propose_team` session.
6. Tools in a turn run **sequentially** (`agent-runner.ts`). Parallel specialists cannot actually overlap.
7. Chat UX is a conversation with a hidden `agentId` dropdown (`tier=primary` only). It is not “open the Engineer”.

Rakazo splits this into `spawn_bot` (peer, own thread) vs `run_subagent` (short-lived worker). EYAS collapsed both into one gated delegate plus a team card.

---

## 2. Decisions

| # | Decision |
|---|---|
| D1 | Approach **B**: addressable colleagues + shared specialist pool. Not a single receptionist (C). Not “just un-gate delegate” (A). |
| D2 | **Assistant loses builder tools.** Prompt-only “MUST delegate” is not enough. |
| D3 | **Routing is green.** `run_specialist`, `handoff_to_colleague`, in-roster `assign_task` do not create an approval row. The *specialist’s* `run_command` / `channel_send` / delete still hit security-gate + autonomy ladder. |
| D4 | Specialists are a **shared pool**. Any colleague (and a specialist within depth) may spawn any enabled specialist. `reportsTo` is not v1 ACL. |
| D5 | `propose_team` / `propose_agent_creation` remain cards. They fire for **missing roles**, **explicit user ask** (`/team`), or **epic + worktrees the user must see**. Not for every multi-step task. |
| D6 | Each colleague has one **home thread**. Heavy work uses `assign_task` (board card + child conversation) so the home thread stays a conversation with a person. |
| D7 | First `run_specialist` in a conversation with no team session **auto-creates an implicit work session** (`running`, `source: implicit`) so team memory works without a card. |
| D8 | `delegate_to_agent` stays as a **compat alias** of `run_specialist` (same executor). Callers and tests that name it keep working. |
| D9 | God Mode stays a separate axis (competing models on one task). Claude Code native `Task` stays for that provider; identity/owns still apply because builder tools are gone from the Assistant. |
| D10 | Seed-tool reconcile uses the existing exact-prior-set rule. An operator who edited an agent’s tools is not overwritten. |

---

## 3. Kinds

```text
Owner
 └── Colleagues  (tier primary | team)     ← sidebar, home thread, SOUL
       ├── handoff_to_colleague
       └── run_specialist × N (parallel)
             └── nested specialist, cycle + depth caps (existing maxDepth / assign_task 5)
```

| Kind | Tier today | User DMs? | SOUL | Typical grant |
|---|---|---|---|---|
| Colleague | `primary`, `team` | Yes | Yes | Coordination + domain tools of *that* role |
| Specialist | `specialist` | No (child/task only) | No (parent voice) | Narrow. Reviewer-class read-only; builder-class may have shell |

No new `agent_definitions.tier` values.

---

## 4. Tools and gates

### 4.1 `run_specialist` (alias `delegate_to_agent`)

Spawn an enabled **specialist** for a self-contained brief. Child conversation + existing `createDelegationService` (cycle check, depth, parked-on-approval of the *child’s* effects).

| Target | Result |
|---|---|
| enabled specialist, not in ancestry, depth OK | execute, **green**, no approval row |
| primary or team | error: use `handoff_to_colleague` |
| missing / disabled | error listing enabled specialists (`id`, name, one-line) — same loud-fail as today |
| cycle / max depth | error, no retry storm |

Input stays `{ agentId, task, context? }`. Timeout stays 15 minutes.

`requiresApproval: false`, `riskTier: 'green'`. Security-gate must not re-escalate this name (deterministic yellow list + `categoryForTool` fallback). Child tool calls are classified on their own names.

### 4.2 `handoff_to_colleague`

Transfer work to another **colleague**.

Input: `{ agentId, reason, summary }`.

- Target must be enabled `primary` or `team`, not self.
- Green.
- Ensures the target’s **home thread** (create if missing).
- Posts a handoff card on the *source* thread (who, reason, link).
- Appends `summary` as a user-visible message on the home thread and **starts a run there** (the colleague continues).
- Does not change `conversations.agent_id` on the source thread (history stays “I talked to Jarvis”).

Frontend: navigate to the home thread when the card is the current view (same as opening a colleague in the sidebar).

### 4.3 `assign_task`

Keep the async board path. Change: **green** when the target is an enabled roster agent (colleague or specialist) and depth is OK. Still creates a card on a bot-capable stage and returns immediately.

Yellow/approval only if we later add assignment to a *new* (not yet enabled) agent — that stays `propose_agent_creation`.

### 4.4 `propose_team`

Unchanged yellow card. Prompt + `team-auto-propose.ts` stop auto-firing it on every complex first message.

Auto-propose (`action: 'propose'`) only when:

- explicit team language (`/team`, “csapat”, “multi-agent”), or
- complexity `epic`, or
- `analyzeAndPropose` would return `agentGaps.length > 0` (missing specialist).

`deep` + complex first message **nudges** `run_specialist` in parallel, it does not open a card.

### 4.5 Implicit work session

`write_team_memory` today: *“Call propose_team first.”*

On the first successful `run_specialist` (or `assign_task`) in a conversation with no `team_session_id`:

1. `teamSessions.create(...)` with `status: 'running'`, config `{ source: 'implicit', members: [caller, target] }`.
2. Set parent `conversations.team_session_id`.
3. Further spawns append members.

No TeamProposalCard. Dashboard / sub-tree still render (session is `running`). User **Skip/Approve** is not shown.

`propose_team` on a conversation that already has an implicit session upgrades it (or creates a sibling explicit session — prefer **upgrade in place**: set `source: 'explicit'`, enter `awaiting_approval` only if gaps or epic worktrees need a card). v1: if an implicit session exists and the user/agent calls `propose_team`, attach the proposal to that session rather than a second one.

---

## 5. Strict roles (grants + IDENTITY)

### 5.1 Personal Assistant (`primary-assistant`)

**Remove from template.tools:** `run_command`, `write_file`, `edit_file`, `design_create`, `design_write`.

**Keep:** read/search/memory/knowledge/documents, `create_page` (notes), `design_list` / `design_read` / `design_link` / `design_unlink` / `render_html_document`, board list/move, channels list + send (send still gated as today), coordination set (`run_specialist` / alias, `handoff_to_colleague`, `assign_task`, `propose_team`, team memory, agent messages).

IDENTITY gains three blocks (English in files; UI language is separate):

```markdown
## Owns
Conversation, planning, research summaries, scheduling, channel triage, coordination.

## Does not own
Source edits, shell, git writes, infrastructure, pixel-level design authoring.

## Hands off to
- System Engineer (`system-engineer`) — code, infra, EYAS platform
- Enabled specialists by id from the roster — single-domain execution
```

System prompt: delete the “ALWAYS call propose_team FIRST” sequence. Replace with: if the task is not in Owns, `handoff_to_colleague` or `run_specialist` in the same turn (parallel when independent); do not attempt builder work.

### 5.2 System Engineer (`system-engineer`)

Keeps builder tools. IDENTITY:

```markdown
## Owns
EYAS codebase, tests, local infra, platform changes.

## Does not own
Client comms, scheduling, copy/UX-only work.

## Hands off to
- Personal Assistant — comms / scheduling
- code-reviewer, test-engineer, … — from the roster, by id
```

### 5.3 Reconcile

Append a `TOOLS_ADDED_BY_ROUND` inverse round is wrong (we are *removing*). Add an explicit `ToolsetUpgrade` for `primary-assistant`: `prior` = today’s shipped list, `current` = stripped list. Existing `reconcileAgentTools` already no-ops if the row does not match `prior` exactly.

New installs get the template as-is.

Team-tier recommended agents: no grant strip in v1 (already mostly reviewer-class). They become sidebar colleagues.

---

## 6. Living roster in the prompt

`createAgentDirectory().toPromptText()` is test-only today.

Wire it into `buildCachePrefix` as a new inventory section **`available-agents`**, using `renderInventory` (same clip rules as tools/skills). Items:

- `id` (copy this, not the name)
- name
- tier
- one line from `role`
- `owns:` first IDENTITY “Owns” line if present, else role

Footer: *“Call run_specialist / handoff_to_colleague with the id field. Schemas are the tool API.”*

Budget: add `availableAgents: 400` to `SectionBudget` / `DEFAULT_BUDGET_FULL`. Locked sections stay locked; this section *does* shrink.

Workspace `AGENTS.md` remains operator notes (`agent-notes`). It is not the roster.

Specialists see the roster too (they may nest), minus themselves, plus “you are a specialist; do not hand off to colleagues.”

---

## 7. Parallel execution

Today: `for (const toolUse of toolUseBlocks)` sequential. Default `maxToolCallsPerTurn = 10`.

v1 change, **only** for a turn that contains two or more `run_specialist` / `delegate_to_agent` blocks:

1. Execute those blocks with `Promise.all` (still respect `maxToolCallsPerTurn` and total budget).
2. Other tools in the same turn stay sequential, in original order, **after** the parallel batch if they are not themselves routing tools. If the model interleaved `read_file` between two `run_specialist`s, run the two specialists in parallel then the remaining tools in order.
3. If two or more spawned specialists have write/shell grants, attach **worktrees** the same way team complex/epic does (`.eyas-worktrees/`), even on an implicit session.

Do not parallelise arbitrary tools in v1 (approval parking, shared cwd).

---

## 8. Home threads and UI

### 8.1 Schema

`conversations.kind TEXT NOT NULL DEFAULT 'task'` with values `home` | `task` | `delegation`.

Partial unique index: `(user_id, agent_id) WHERE kind = 'home' AND agent_id IS NOT NULL`.

`handoff` and sidebar “open colleague” use `getOrCreateHomeThread(userId, agentId)`.

Child `delegate` conversations: `kind = 'delegation'`. `assign_task` cards: `kind = 'task'`.

### 8.2 Sidebar

New **Colleagues** block (primary + team, enabled only). Each row: avatar, name, unread if home thread has unread. Click → home thread. Specialists do not appear here.

Conversation composer / fields agent picker: **primary + team**, not specialists (unless the open conversation is already a specialist child — show read-only).

### 8.3 In-thread

Keep SubConversationTree + Team Dashboard. Handoff renders a compact card (colleague name, reason, “Open”). Specialist progress is the existing tree, not a proposal to Approve/Skip.

### 8.4 i18n

Every new string in `en` `hu` `de` `es` `fr` `tlh` (sidebar, cards, errors, docs `agents/teams.md` + overview tier copy).

---

## 9. Prompt / orchestration copy

| Surface | Change |
|---|---|
| `PRIMARY_TEMPLATES` assistant `systemPrompt` | Coordinator rules; no mandatory propose_team sequence |
| `CORE_IDENTITY` delegate bullet | “Hand off to colleagues or spawn specialists by id from the roster. Do not do work outside Owns.” |
| `orchestration-directive.ts` non-claude `deep` | Fan out with `run_specialist`; `propose_team` only on gaps / epic |
| `team-auto-propose.ts` + nudge text | See §4.4 |
| Specialist `IDENTITY.md` | Keep “Ongoing proactive duties: (none)”; add “You execute one brief and return. Do not open a home thread.” |

Claude Code `deep` directive (native Task) stays. Assistant without builder tools still has to Task/delegate.

---

## 10. Out of scope (v1)

- Org-chart `reportsTo` ACL
- Computer-as-a-place / Rakazo sandbox (separate)
- `request_secret` / OpenAPI connections
- Expo / Electron
- Replacing the conversation-runner with Pi
- Collapsing EYAS to one-thread-per-bot
- Auto-approving `propose_team` cards
- Parallelising non-routing tools
- Stripping builder tools from a user-edited Assistant allow-list

---

## 11. Tests (minimum)

| Case | Expect |
|---|---|
| `run_specialist` to enabled specialist | no `waiting_approval` on the parent; child runs |
| `run_specialist` to `system-engineer` | error naming `handoff_to_colleague` |
| cycle / depth | existing errors |
| two `run_specialist` in one mocked turn | both start before either completes (parallel) |
| Assistant template / reconciled seed | no `write_file` / `run_command` |
| edited Assistant tools | reconcile leaves them |
| implicit session | first spawn sets `team_session_id`; `write_team_memory` works |
| `propose_team` | still yellow; card still exists |
| first-turn complex message, no `/team`, no gaps | no auto card; roster + specialist nudge |
| home thread | second open returns same id |
| `available-agents` inventory | ids present; footer present when clipped |
| i18n | new keys in all six locales (contract test if one exists) |

Reuse `tests/modules/agent/delegation*.ts`, `agent-tool-reconcile`, `team-auto-propose`, `agent-runner-tool-limits`.

---

## 12. Implementation order

Do not start until this spec is accepted in chat.

1. **Policy + tools + grants** — green routing, alias, handoff backend, implicit session, Assistant strip + reconcile, IDENTITY/prompt copy, roster inventory, team-auto-propose retarget. Tests in §11 except UI/parallel.
2. **Parallel `run_specialist`** + worktrees on implicit multi-writer sessions.
3. **Home threads + sidebar Colleagues + handoff card + picker.** Six-locale strings. Docs `agents/teams.md` / overview.

Phase 1 already changes live behaviour (Assistant cannot code; complex chat no longer pops a team card). Call that out in CHANGELOG.

---

## 13. Files (expected)

- `src/modules/tools/builtin/delegate-tool.ts` — alias + green; new `handoff-tool.ts`
- `src/modules/tools/builtin/assign-task-tool.ts` — green when in-roster
- `src/modules/tools/register-builtins.ts`
- `src/modules/security-gate/deterministic-gate.ts` / `types.ts` / `autonomy-policy.ts` — do not yellow-list routing names
- `src/modules/agent/agent-templates.ts` — grants, IDENTITY, `PRIOR_TOOLSETS`
- `src/modules/agent/agent-directory.ts` + prompt-wizard `cache-prefix-builder.ts` / `token-budget.ts` / `inventory` usage
- `src/modules/agent/conversation-runner.ts` / `index.ts` — implicit session
- `src/modules/agent/agent-runner.ts` — parallel batch
- `src/modules/agent/orchestrator.ts` — worktrees for implicit multi-writer
- `src/modules/conversations/schema.ts` + `index.ts` ALTER `kind`
- `src/modules/conversations/team-auto-propose.ts`, `orchestration-directive.ts`
- `src/modules/prompt-wizard/core-identity.ts` (+ seed-migration prior body)
- `src/web/src/components/layout/sidebar.tsx` + conversation fields/picker + handoff card
- `packages/docs/src/content/docs/{en,hu,de,es,fr,tlh}/agents/teams.md` (and overview tier table)
- Tests under `tests/modules/agent/`, `tests/modules/tools/`, `tests/modules/conversations/`

---

## 14. Spec self-review

- No TBD. Implicit vs explicit team session conflict resolved (upgrade in place).
- D2 (strip tools) and D10 (don’t overwrite edits) do not conflict: reconcile is exact-set only.
- Parallel is scoped to routing tools so parking/cwd stay sequential.
- Phase 1 is behaviour-visible without the sidebar; UI is phase 3, not a blocker for the colleague *policy*.
