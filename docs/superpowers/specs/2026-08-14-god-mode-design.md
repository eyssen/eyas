# God Mode

**Date:** 2026-08-14
**Status:** implemented (plan executed)
**Approach:** A — winner workspace + unique-insight list (no automatic merge)

## Problem

A conversation runs on one model. For high-stakes coding or document work the
user wants the same task executed in parallel by several different models, then
a structured comparison: which result is best, and what only one model noticed.
Today EYAS has `solo` / `auto` / `deep` orchestration (how one agent decomposes
work) and team sessions (specialist roles). Neither is a same-task ensemble.

## Research (locked)

Closed-ended benchmarks (NeurIPS 2025 *Debate or Vote*) show most multi-agent
gains come from independent samples, not multi-round debate. Debate often
produces sycophantic convergence. Open-ended coding is worse: mixing
incompatible implementations (classic Mixture-of-Agents aggregation) yields
inconsistent “Frankenstein” trees.

Therefore God Mode:

- races independent workers on isolated trees
- does **one** structured cross-review round (no live debate)
- promotes the **winner’s workspace**
- lists unique insights separately — the user applies them, the system does not
  auto-merge code

## Relationship to existing axes

God Mode is a **separate boolean** on the conversation (`god_mode`), not a
fourth `orchestration` value.

| Axis | Field | Meaning |
|---|---|---|
| Orchestration | `solo` / `auto` / `deep` | How each worker decomposes the task |
| God Mode | `god_mode` 0/1 | How many models run the **same** task |

Both can be on: God Mode + `deep` means every worker may fan out on its own
model. The UI puts the God switch **inside** the Orchestration control (space),
but the stored fields stay independent. Selecting God Mode does not overwrite
`orchestration`; workers inherit the conversation’s last `solo`/`auto`/`deep`.

Do **not** reuse `propose_team` / `team-driver`. Those assemble specialists.
God Mode assembles competitors.

Normal conversations still work on original files (no worktree). Isolated trees
exist **only** for God Mode workers.

## Placement

`src/modules/agent/god-mode/` — independently toggleable agent submodule.
Depends on agent, conversations, model, observability, tools
(working-directories).

Reuse: `runConversation`, working directories, existing worktree helpers
(distinct branch namespace), critic (per-worker, fail-open), orchestration
events + Run Tree, `ai_traces`, budget engine.

Do not reuse: team session semantics, conversation `orchestration` enum.

---

## 1. Config

### YAML (operator)

```yaml
agent:
  godModeEnabled: true          # default true when the submodule is loaded
  godModeMinParticipants: 2
  godModeMaxParticipants: 5
```

The roster is **not** YAML. It is edited in Settings and stored in the DB.

### Settings row — `god_mode_config`

Single row, `id = 'default'`.

| Column | Rule |
|---|---|
| `participants` | JSON `[{ id, providerId, modelId }]`. Unique pairs. Length in `[min, max]`. |
| `chair_participant_id` | A participant `id`. **Required when length is even.** Recommended always (a death can make the remainder even). |
| `cost_ceiling_usd` | Nullable. Pre-flight estimate above ceiling → run does not start. Mid-run breach → cancel unfinished workers, decide among finishers. |
| `workspace_retention_hours` | Default `72`. Then GC (boot + scheduler). |
| `updated_at` | ISO timestamp. |

Validation on **save** and again on **every run start**. A run stores a snapshot
of the roster so later Settings edits do not rewrite history.

YAGNI: no per-conversation roster, no weighted votes, no extra reviewer model
outside the roster. The chair is one of the participants.

### Conversation column

`god_mode INTEGER NOT NULL DEFAULT 0` on `conversations`, wired through
`ConversationUpdate` + `UPDATE_FIELD_MAP` (same pattern as `pinned`).

---

## 2. Run tables

Runtime DDL + contract test, same pattern as `team-schema.ts`.

### `god_mode_runs`

| Column | Notes |
|---|---|
| `id` | Primary key |
| `conversation_id` | Parent conversation (the one in the list) |
| `user_message_id` | Triggering `conversation_messages.id` |
| `status` | `preparing` → `racing` → `reviewing` → `deciding` → `promoting` → `completed` \| `failed` \| `cancelled` |
| `winner_participant_id` | Nullable until decided |
| `tie_broken` | 0/1 |
| `chair_participant_id` | Snapshot |
| `participants_snapshot` | JSON roster at start |
| `isolation` | `worktree` \| `copy` \| `none` (Q&A, no folder) |
| `source_working_directory` | Conversation primary cwd, or null |
| `total_tokens` | Sum of workers + review calls |
| `total_cost_usd` | Same |
| `duration_ms` | Wall clock |
| `error` | Nullable |
| `created_at` / `completed_at` | |

Workers are **not** extra rows in the conversation list. Live tool activity
uses the existing orchestration Run Tree via `child_run_id`.

### `god_mode_participants`

| Column | Notes |
|---|---|
| `id` | Primary key |
| `run_id` | |
| `slot_id` | Stable id from the snapshot |
| `provider_id` / `model_id` | |
| `status` | `pending` \| `running` \| `completed` \| `failed` \| `skipped` |
| `workspace_path` | Isolated tree, or null when `isolation = none` |
| `child_run_id` | Agent / conversation-runner session |
| `tokens_in` / `tokens_out` / `cost_usd` / `duration_ms` | |
| `vote_for` | `slot_id` they voted for |
| `scores` | JSON `{ quality, completeness, risk }` |
| `unique_insights` | JSON string array |
| `risks` | JSON string array |
| `summary` | Short what they produced |
| `error` | |
| `created_at` / `completed_at` | |

Reviews live on this row. No third table.

Cross-review response contract (strict JSON, one object):

```json
{
  "voteFor": "<slot_id of another worker>",
  "scores": { "quality": 0, "completeness": 0, "risk": 0 },
  "uniqueInsights": ["..."],
  "risks": ["..."],
  "summary": "..."
}
```

Scores are integers 1–5. Unknown keys ignored. Parse failure → vote discarded.

---

## 3. Runtime

Intercept `POST /conversations/:id/messages` when `god_mode = 1`. The user
message is stored on the parent as today. Then the God Mode orchestrator runs
instead of the single-provider stream.

### Phases

1. **Prepare** — re-validate roster (live providers, chair, ceiling). No
   write-vs-Q&A classifier: if the conversation has a primary working
   directory, fork it; if not, `isolation = none` and file tools fail closed
   as they already do. The composer banner warns when God is on and Folders
   is empty — it does not hard-abort.
2. **Fork** — one isolated tree per worker from the conversation’s **first**
   working directory. Other working directories stay read-only context, not
   forked.
3. **Race** — one **child conversation** per worker
   (`parentConversationId` = parent, `god_mode = 0` so it cannot recurse,
   `providerId`/`modelId` forced, `workingDirectories = [workspace_path]`).
   Hidden from the main list (existing parent filter). `runConversation` on
   that child. Per-worker critic runs fail-open. Spend counts toward existing
   agent/conversation budgets. Autonomy / security-gate is **not** raised or
   bypassed.
4. **Cross-review** — one round. Each survivor receives the others’ summaries
   and diffs, returns the JSON contract above (`voteFor`, scores,
   `uniqueInsights`, `risks`). No live debate.
5. **Decide** — majority of valid votes. A worker **must not** vote for
   itself; a self-vote is discarded. Tie → chair. If the chair is gone →
   earliest completed among the tied. One survivor → that worker wins, skip
   review. Zero survivors → `failed`.
6. **Promote** — copy the winner’s **changed files** onto the conversation
   cwd. Not `git merge`, not a leftover branch on the main tree. The winner’s
   final text becomes the parent assistant message.
7. **Insights** — union of `uniqueInsights` minus items already present in the
   winner, de-duplicated, shown on the God tab. Not applied.

### Isolation

| Source | Worker tree |
|---|---|
| Git repo | Worktree at `.eyas-god/<runId>/<slot>/`, branch `god/<runId>-<slot>`. Namespace is **not** `agent/*` (team worktrees). |
| Not git | Copy to the same path shape. Exclude `node_modules`, `.git`, `dist`, `__pycache__`, `.venv`, large binaries. |
| No primary folder | `isolation = none`, review transcripts only. Banner warns that workers cannot write files. |

File tools jail to the worker cwd. Loser trees stay until
`workspace_retention_hours`, then GC on boot and via scheduler.

### Errors

| Event | Behaviour |
|---|---|
| Roster &lt; min, or even count without chair | Do not start; point at Settings |
| Model dead at start | Slot `skipped`; if live count &lt; min → abort |
| Worker dies mid-race | `failed`, excluded from vote; cost kept |
| Review JSON invalid | That vote discarded (fail-open, same spirit as critic) |
| All reviews invalid | Chair; if chair gone → earliest completed |
| Ceiling before start | Do not start |
| Ceiling mid-run | Cancel unfinished; decide among finishers |
| Second send while a God run is active | Reject |
| User cancel | Stop all workers; trees kept until retention |
| Process crash | In-flight run → `failed`. No auto-resume in v1 |
| Promote fails | Run is otherwise done; winner tree kept; promote retryable |
| Security-gate / approval on one worker | Same ladder as a normal run. Parked worker does not vote until resumed |

God Mode never turns itself on.

---

## 4. API

All under `/api/v1`.

| Method | Path | Permission |
|---|---|---|
| `GET` / `PUT` | `/god-mode/config` | `manage Model` (same as agent-assignments) |
| `GET` | `/conversations/:id/god-mode/runs` | `read Conversation` |
| `GET` | `/god-mode/runs/:id` | `read Conversation` |
| `POST` | `/god-mode/runs/:id/cancel` | `update Conversation` |
| `POST` | `/god-mode/runs/:id/promote` | `update Conversation` (retry) |
| `GET` | `/observability/god-mode/summary` | `read AuditEntry` |
| `GET` | `/observability/god-mode/runs` | `read AuditEntry` |

Live progress: existing orchestration WebSocket topic on each child
conversation id (tool calls → Run Tree). The God scoreboard **polls**
`GET /god-mode/runs/:id` every 1s while `status` is not terminal. No new
WebSocket event type in v1.

Pre-flight cost estimate: for each roster model, `inputPrice * 8_000 +
outputPrice * 2_000` from the existing pricing table (or that model’s
average trace cost if `ai_traces` has ≥ 5 rows). Sum × **1.5** (review
round). No history and no price → treat that slot as `$0` in the estimate
and still run it (ceiling cannot block an unpriced local model).

---

## 5. UI

### Orchestration control

The fields-row Orchestration **native `<select>` is replaced** by a same-sized
custom menu (OS popups cannot color one option). Items:

```
Solo
Auto
Deep
────────
God Mode
```

Choosing Solo / Auto / Deep sets `orchestration` and sets `god_mode = 0`.
Choosing God Mode sets `god_mode = 1` and **leaves** `orchestration` as-is
(workers inherit it).

When `god_mode = 1` the closed trigger reads **God Mode** and uses
`--god` / `--god-foreground` for text and border.

Empty or invalid roster: God item disabled, tooltip points at Settings → God
Mode. Send is blocked with the same pointer.

First send after turning God on: confirm dialog (roster, estimate, ceiling).
Later sends in the same conversation: banner only, unless the estimate exceeds
the ceiling (then hard-block, no confirm bypass).

### Composer banner

Visible only while `god_mode = 1`. Shows `God Mode · N models · ~$X` and roster
chips. During a run it shows the phase name.

The top-bar provider/model readout stays, but while God Mode is on it is
visually muted (workers use the roster). Turning God off restores the single
model path; stored `providerId` / `modelId` are not wiped.

### God tab (chatter panel)

New tab `god` next to history / sources / folders / next / files. Visible when
`god_mode = 1` **or** the conversation has at least one `god_mode_runs` row.
A run start switches to this tab.

Scoreboard, not a second Run Tree (tool calls stay in the Runtime strip):

1. Phase + totals (tokens, cost, duration)
2. Per-model rows: status, tokens, cost, duration; after review: vote + scores.
   Winner row uses `--god` highlight
3. Unique insights (not applied, expandable)
4. Inspect loser workspace / diff until retention expires

### Settings card

On the Settings page, under model-assignments: participant pickers
(provider + model), chair control (required to save when even), cost ceiling,
retention. Saving runs the same Zod rules as the API.

### Observability

No new sidebar item. Observability gains two tabs:

- **Usage** — existing traces / stats (include runtime where it is still missing)
- **God Mode** — run list (conversation, winner, N, cost, duration, tie-broken);
  win-rate by model; average cost multiple vs a single model. Click-through
  shows the same detail as the conversation God tab

### Themes

New CSS variables `--god` and `--god-foreground` (HSL components, same
convention as `--primary`). Set on **every** template, light and dark,
including default Sequoia in `globals.css`. Never hardcode a gold.

| Template | Token intent |
|---|---|
| Sequoia | Amber — contrasts indigo `--primary` |
| Nebula | Amber — contrasts violet / cyan |
| Halo | Amber — contrasts teal `--primary` |
| Atelier | Deep teal — vermilion is already primary/destructive; gold would collide |
| Terminal | Gold — contrasts eYssen red primary and phosphor ink; not `--destructive` |

`--primary` (actions) and `--destructive` (errors) must not be reused for God.

### i18n

Every new string in `en` + `hu` + `de` + `es` + `fr` + `tlh` in conversations,
settings, and observability locale files.

---

## 6. Testing

- **Unit:** roster validation (odd / even / missing chair / duplicate pair /
  dead model); vote tally + tie + chair-gone fallback; insight de-dupe;
  git vs copy vs none isolation choice.
- **Contract:** `god_mode_config` / `god_mode_runs` / `god_mode_participants`
  + `conversations.god_mode`, same style as
  `tests/contracts/team-schema.contract.test.ts` and
  `tests/contracts/conversations-schema.contract.test.ts`.
- **Integration:** three mock models → race → review → winner files land on
  the conversation cwd; one worker fail still decides; ceiling abort;
  cancel; empty Folders → `isolation = none` and banner warning, run still
  starts; crash leaves `failed` and no leaked `god/*` branch after GC;
  child conversations have `god_mode = 0` (no recursion).
- **UI:** God row / trigger uses `--god`; tokens exist on all five templates
  × light/dark.
- **Security:** N parallel writers still hit the security-gate; no privilege
  escalation vs a solo run.

---

## 7. Out of scope (v1)

- Per-conversation roster override
- Weighted votes or a judge model outside the roster
- Multi-round debate
- Automatic application of unique insights
- Automatic `git merge` / Frankenstein synthesis of code
- Auto-resume of a crashed God run
- Forking every working directory (only the primary)
- New top-level navigation item
- Raising autonomy because God Mode is on

---

## Key decisions

1. **Winner workspace + insight list, not synthesis** — coding stays coherent;
   unique ideas stay visible.
2. **Separate `god_mode` flag, UI inside Orchestration** — two axes, one
   control, no extra chrome.
3. **New submodule, not team-driver** — competitors ≠ specialists.
4. **Worktrees only here** — normal chats stay on original files.
5. **Roster in DB Settings, limits in YAML** — UI-editable models, operator
   caps.
6. **Chair required on even count** — and used when a death makes the field even.
7. **No crash-resume in v1** — fail the run, keep trees, user resends.
8. **Theme token `--god` per template** — never a hardcoded gold, never
   primary/destructive.
9. **Reports live in Observability** — global usage stays there; God Mode is
   a second tab, not a new module page.

## Implementation slices (not a commit plan)

Build in this order so each slice is reviewable:

1. Config + schema + roster API + Settings card (no runtime).
2. Orchestrator: fork, race, review, decide, promote + isolation GC.
3. Conversation intercept + Orchestration menu + composer banner + God tab.
4. Observability Usage/God tabs + win-rate / cost-multiple.

Slice 1 is usable alone (you can save a roster). Slice 2 is testable without
UI. Slice 3 is the visible product. Slice 4 is the global report.
