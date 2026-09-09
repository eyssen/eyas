# Effective-Context Inspector & Skill Inventory — Design Spec

> **Date:** 2026-08-24
> **Status:** Draft (awaiting owner review)
> **Scope:** Spec A of two. Spec B (`cron as execution log`) is a separate document and does not touch this surface.
> **Builds on:** `2026-07-11-eyas-prompt-system-design.md` (§5.1.1, R1), `2026-07-11-eyas-prompt-phase3-autonomy-design.md` (A2, §3.1)

## 1. Problem

Three defects share one root cause: **nothing records what actually reached the model.**

1. **No per-turn context record.** The prompt assembler composes ~16 sections
   (`prompt-wizard/cache-prefix-builder.ts:24-72`, `cache-suffix-builder.ts:80-163`), then
   `flattenAssembledPrompt` (`agent/agent-runner.ts:225-228`) collapses them to one string. Section
   identity, order, size and truncation are lost before the request is built
   (`agent-runner.ts:404`). When a turn misbehaves there is nothing to inspect.

2. **No skill usage signal.** The live injection path (`conversations/routes.ts:649-672`) writes
   nothing — no DB update, no bus event, no audit row, no event-store event. `skills` has no
   `last_used_at` and no counter. Consequently there is no basis for deciding a skill is dead.

3. **No skill provenance or precedence.** Two roots (`config/skills` at `skills/index.ts:65`;
   extension dirs at `extensions/index.ts:48-53`) write into one flat `id` namespace via
   `skill-loader.ts:48-49`, last-writer-wins by `readdir` order. 222 files collapse to 220 rows;
   two collisions ship today (`websocket-patterns`: `api/` vs `web/realtime/`; `slack-integration`:
   `integrations/slack.md` vs `communication/messaging/slack-integration.md`). No row records which
   file produced it, and a deleted `.md` leaves its row enabled forever.

### Collateral defects this surfaces (not caused by it)

- **Silent empty system prompt.** `conversations/system-prompt.ts:32` is `catch { return '' }` — an
  assembler failure degrades to no system prompt with no signal anywhere.
- **`body.system` override is invisible.** `system-prompt.ts:19` short-circuits the entire
  assembler; nothing records that it happened.
- **ContextBar numerator is wrong by construction.** `context-bar.tsx` divides
  `conversations.tokens_used` — a cumulative in+out sum over the whole thread
  (`conversation-service.ts:557-560`) — by the context window, so it exceeds 100% on any long
  conversation and never measured context occupancy.
- **Loader error handling conflates failures.** The whole scan sits in one `try{}catch{}`
  (`skill-loader.ts:82-84`); a mid-scan failure is indistinguishable from a missing directory.
- **Load counter over-reports.** `count++` fires on both insert and shadowing update
  (`skill-loader.ts:68`, `:79`).

### Prior decisions this spec honors (not re-opened)

| Source | Decision | Status in code today |
|---|---|---|
| `eyas-prompt-system-design.md:144` | The `AssembledPrompt` object must reach the runner as `systemPrompt`, **not** a flattened string, so prompt-cache boundaries survive. | **Approved, not implemented** — `system-prompt.ts:31` and `agent-runner.ts:225-228` still flatten. This spec partially delivers it. |
| `eyas-prompt-system-design.md:190` (R1) | Prompt-cache correctness depends on a provider honoring `cache_control`; the live v1 Anthropic provider sends a single string. | Unresolved. Inherited as a risk, **out of scope here** (§10). |
| `eyas-prompt-phase3-autonomy-design.md:31` (A2) | Every prompt/skill/routing/soul change is a **proposal** routed through the existing approval ladder (`autonomy_categories` / `createApproval` / security-gate). No loop autonomously changes agent behavior. | Honored: the dead-skill detector proposes, never applies (§6.4). |

## 2. Goals & Non-Goals

### Goals

- G1 — A per-assembly record of every context section: identity, zone, order, size, budget,
  truncation, and raw content.
- G2 — Two retention layers: full detail short-term (debug), daily rollup long-term (trend).
- G3 — Skill usage telemetry as a by-product of G1, from a single write site.
- G4 — Deterministic skill precedence with recorded losers; orphan detection.
- G5 — A dead-skill detector that **disables, never deletes**, and only ever proposes.

### Non-Goals

- Real tokenization. Estimates stay `ceil(chars/4)` (`token-budget.ts:69`); the inspector's
  estimate-vs-actual view exists precisely to measure that heuristic's error, not to replace it.
- Conversation-history trimming, windowing, or summarisation. Absent today, still absent.
- Activating the v2 `ModelProvider`/`NormalizedRequest` adapters or `cache_control` (R1).
- Auto-disabling anything.
- A skill dependency graph. See §6.1.

## 3. Decisions (from clarification)

| # | Decision | Choice |
|---|---|---|
| D1 | Work split | Spec A = context inspector + skills (one instrumentation point). Spec B = cron. |
| D2 | Storage approach | Own composition record; `ai_traces` references it by FK. Rejected: filling `ai_traces`' dead columns (wrong cardinality), and event-store `LlmCall` (session-scoped, blob queries). |
| D3 | Retention | Both layers: per-assembly detail short window + daily rollup long-term. |
| D4 | Detail depth | Metadata **plus full raw section content**. |
| D5 | Detector trigger | Proposal only; owner approves. Nothing auto-applies. |
| D6 | Detector surface | Item enters the **existing autonomy approval queue**, and links through to the skills inventory table where the full context is visible. |
| D7 | Skill visualization | **Resolution table**, not a force-directed graph. |
| D8 | Unassembled paths | Recorded with `entry_point='unassembled'` and one `raw-system` section — visibly un-broken-down rather than silently missing. |
| D9 | WebSocket | No new topic. None of this is realtime; the house rule is thin frames + REST (`shared/ws-topics.ts`). |

### D7 rationale

220 skills. A force-directed layout is a hairball past ~40 nodes, its positions are
non-deterministic between renders, and it cannot express **precedence** — which is the actual
question. The three real questions ("what shadows what", "what is orphaned", "what has not run")
are each a sortable column, not a graph edge.

## 4. Data model

**Ownership:** `prompt-wizard` *produces* the manifest; `observability` *persists and serves* it.
No new module — `observability` already owns `ai_traces` and the gateway-wrapping trace collector
(`observability/trace-collector.ts:399-417`, `:454-472`), so the correlation belongs there.

**Write cardinality:** the assembler runs **once per run**; the gateway is called **N times** per
run (tool loop). The composition is therefore persisted once, and its id is carried in
`request.metadata` so each trace stores only an FK. No dedup logic, no write-back, no ordering
dependency.

### 4.1 Detail layer (short retention)

**`context_compositions`** — one row per assembly

| column | notes |
|---|---|
| `id` | TEXT PK |
| `created_at` | TEXT ISO |
| `conversation_id` | TEXT, nullable |
| `run_id` | TEXT, nullable (agent session id) |
| `agent_id` | TEXT |
| `entry_point` | `conversation｜background｜orchestrator-member｜unassembled` |
| `provider`, `model` | TEXT |
| `context_window` | INTEGER — the window used for budget shrinking. **Caveat:** today this is hardcoded `200_000` (`prompt-wizard/index.ts:167`, "real lookup comes when modelRegistry is ready") while real per-model windows already exist in `model_configs.context_window`. The column records what the budget logic actually used, not the model's true window; fixing that lookup is a separate change. |
| `budget_total_tokens` | INTEGER — post-`shrinkForContextWindow` total |
| `estimated_tokens` | INTEGER — sum of section estimates |
| `prefix_hash` | TEXT — already computed at `assembler.ts:80,86`, currently discarded |
| `section_count` | INTEGER |
| `assembler_error` | TEXT, nullable — populated when `system-prompt.ts:32` would have swallowed a failure |

**`context_sections`** — one row per section

| column | notes |
|---|---|
| `composition_id` | TEXT FK |
| `ord` | INTEGER — position in the final prompt |
| `zone` | `prefix｜suffix｜reminder｜append` |
| `section_key` | e.g. `coreIdentity`, `memoryContext`, `skill`, `raw-system`, `body-system-override` |
| `source_ref` | TEXT, nullable — skill id, file path, project id |
| `chars`, `estimated_tokens` | INTEGER |
| `budget_tokens` | INTEGER, nullable — the cap that applied (null for unbudgeted appends) |
| `truncated` | INTEGER 0/1 |
| `dropped_chars` | INTEGER |
| `content` | TEXT — raw section text (D4) |
| `content_hash` | TEXT |

**`ai_traces` + 1 column:** `composition_id`. Estimate-vs-actual comes from joining the run's
**first** trace (later calls are inflated by accumulated tool results). No write-back.

### 4.2 Rollup layer (long retention)

**`context_section_daily`** — PK (`day`, `section_key`): `count`, `sum_tokens`, `max_tokens`,
`truncated_count`, `sum_dropped_chars`. Average is `sum/count`. **No p95** — without raw retained
data it could only be fabricated; `max` is honest.

**Skill usage** follows the existing `scheduled_jobs` convention (`scheduler/schema.ts:16-18`
keeps denormalized `run_count`/`last_run_at` next to the log):

- `skills` + `use_count`, `last_used_at` — makes the detector query and the inventory table cheap.
- **`skill_usage_daily`** — PK (`day`, `skill_id`): `injected_count`.

### 4.3 What counts as skill usage

**Only injection.** Skills touch the prompt two ways: `<available-skills>` lists all enabled
skills every turn (`cache-prefix-builder.ts:57-62`), and the matcher picks one and injects its full
body (`conversations/routes.ts:662`). Listing is **not** usage — the model cannot act on it,
because the `skill_load(name)` tool the prompt advertises
(`prompt-wizard/cache-prefix-builder.ts:60`) **does not exist** anywhere in the codebase. Counting
listings would mark every skill permanently alive and the detector would never fire.

### 4.4 Retention

Detail layer purged by a job following the existing `scheduler.retention.purge` pattern
(`scheduler/index.ts:171-174`). Default **7 days**, config-driven, and the job logs how much it
removed. Rollups are retained.

**Size, stated plainly:** ~34 KB of raw content per assembly (the 8 400-token budget) × 7 days is
in the hundreds of MB under heavy use. Two relief valves if that is too much: shorten the window,
or store `content` only for the largest N sections. The default is the window.

## 5. Instrumentation

### 5.1 Manifest type

`prompt-wizard/types.ts`: new `ContextSection` (`zone`, `key`, `sourceRef?`, `content`, `chars`,
`estimatedTokens`, `budgetTokens?`, `truncated`, `droppedChars`); `AssembledPrompt` gains
`sections: ContextSection[]`.

### 5.2 Builders collect instead of discarding

`clipToBudget` (`token-budget.ts:72-76`) already computes the clip and returns `{content,
truncated}`; the flag is read by nobody (`cache-prefix-builder.ts:27-68` and
`cache-suffix-builder.ts:88-161` use `.content` only). It gains `droppedChars` (original length −
clipped length), and both builders push a `ContextSection` alongside each `parts.push(...)` via one
small `collect()` helper, so clip-and-append stays a single operation. Mechanical, two files.

`WorkspaceFile.truncated` (`workspace-loader.ts:47`) is likewise already computed and unread; it
feeds the `projectCascade`/workspace sections' `truncated` flag.

### 5.3 Plumbing

`resolveConversationSystemPrompt` (`conversations/system-prompt.ts:19-34`) returns `{ system,
sections }` instead of a bare string. One function, one call site (`conversations/routes.ts:639`).
This is the partial delivery of the prior decision at `eyas-prompt-system-design.md:144`.

The `catch` at `system-prompt.ts:32` keeps failing soft, but records `assembler_error` and
`entry_point='unassembled'` instead of vanishing. `body.system` (`:19`) records one
`body-system-override` section.

### 5.4 Post-assembler appends register themselves

Three sites append to the system string outside every budget and must appear in the same manifest,
zone `append`:

| Site | `section_key` | `source_ref` |
|---|---|---|
| `conversations/routes.ts:665-668` | `skill` | skill id |
| `conversations/routes.ts:689` | `orchestration-directive` | mode |
| `conversations/routes.ts:730,734` | `team-nudge` | conversation id |

The skill row's `source_ref` is the single line that feeds the entire dead-skill detector. These
are also the largest and least-controlled sections — a full skill body, unbudgeted — so omitting
them would hide exactly what matters most.

### 5.5 Unassembled paths (D8)

`executeAgent` (`agent/index.ts:493`), God Mode (`agent/god-mode/orchestrator.ts:271-280`) and the
utility calls (triage, auto-title, critic, planner, judge) bypass the assembler. Each records one
`raw-system` section with `entry_point='unassembled'`.

**Coverage note:** this gap does **not** affect skill telemetry. Skills are consumed at exactly two
sites — `conversations/routes.ts:655,662` (injection) and `prompt-wizard/index.ts:135` (listing).
`executeAgent` and God Mode inject no skills, so usage counts are complete. The gap affects only
section breakdown for those paths, which is why they are marked rather than omitted.

### 5.6 Persist and correlate

`observability` exposes `contextRecorder.record(manifest, attribution) → compositionId`, called
once per assembly by `agent-runner`, `conversation-runner` and `orchestrator`. The id goes into
`request.metadata` (`agent-runner.ts:404`); the trace collector reads it in the existing
`resolveAttribution` (`trace-collector.ts:45-50`) and stores the FK.

### 5.7 Skill counters live in one place

`use_count`, `last_used_at` and `skill_usage_daily` are written **by the recorder** when it sees a
`section_key='skill'` row — not by `conversations/routes.ts`. One write site means the counter
cannot drift from the composition record it is derived from.

## 6. Skill inventory & dead-skill detector

### 6.1 Provenance

`skills` gains `source_path` (relative file path), `source_root` (which root), `last_seen_at` (the
scan that last observed the file). Orphan detection is then a comparison: after a **complete**
scan, any `bundled` row with `last_seen_at < scanStartedAt` is orphaned.

### 6.2 Deterministic precedence

Today `readdir` order decides (`skill-loader.ts:48-49` + upsert `:59-80`) — filesystem-dependent
and unpredictable. Replaced by an explicit ladder:

```
user  >  generated  >  extension-bundled  >  core-bundled
```

Ties within a root break on lexicographic path. `user > bundled` already exists implicitly (the
loader silently skips rows whose `source` is `user`/`generated`); this states and extends it.

**Losers are recorded**, not just winners: **`skill_shadowed_sources`** (`skill_id`, `path`, `root`,
`seen_at`). Without it the resolution table cannot show *what* was shadowed — which is the question.

### 6.3 Disable, never delete

New columns: `disabled_reason` (`user｜orphan｜shadowed｜dormant｜never-used`), `disabled_at`,
`disabled_by`.

New method **`setEnabled(id, boolean, reason?)`** — idempotent. The existing `toggle()`
(`skill-loader.ts:144-149`) reads-then-flips, so it is unusable for any programmatic or bulk
operation; it remains as a thin wrapper so `POST /skills/:id/toggle` and the UI switch keep working.

No code path in this spec deletes a skill row. The two existing hard-delete paths
(`skill-loader.ts:151-153`, `skill-generation/real-registry.ts:67`) are untouched.

### 6.4 The detector

Not a new mechanism — a query over data §5 and §6.1 already produce: provenance + `use_count` /
`last_used_at` + shadowing state.

Per D5/D6 and prior decision A2, it **proposes**: `createApproval(...)` enqueues the item into the
existing autonomy approval queue (surfaced on the autonomy page), and the item links through to the
skills inventory table where shadowing, orphan status and last-use are visible together. Apply
happens only on owner approval, via `setEnabled(id, false, reason)`.

### 6.5 Classification policy — owner-authored

`classifySkill()` receives `use_count`, `last_used_at`, `created_at`, `source`, `isShadowed`,
`isOrphan` and returns a category. This is a judgment call, not boilerplate, and the owner writes
it. Implementation will prepare the file with the signature, the input shape and a `TODO`.

Two traps the policy must answer explicitly:

- A **newly added** skill has zero usage by definition; a naive "unused for N days" rule disables
  every new skill on sight.
- A **situational** skill (disaster recovery, a migration) legitimately sleeps for months. It is
  insurance; disabling it would fail at exactly the worst moment.

Thresholds live in config, not in code. The **shape of the rule** is the owner's.

### 6.6 Two prior half-built attempts — resolved, not left beside a third

| Artifact | State today | Resolution |
|---|---|---|
| `skill-generation/rollback.ts` | Explicit stub (`:12-32`) intending "auto-disable a regressing skill"; monitoring loop never wired; `checkAndRollback` has zero callers; its "disable" is `registry.unregister` → **hard DELETE** (`real-registry.ts:67`). | **Mark dead and remove.** Its stated intent — *auto*-disable — is directly superseded by D5 and prior decision A2 (propose-only), and its mechanism is a delete, which §6.3 forbids. A regressing skill becomes a proposal on this surface, not an automatic action. |
| `skill-generation/curator-gate.ts` | `evaluateCuratorGate` complete with thresholds; zero `src/` call sites (referenced only by its own test), while `packages/docs/**/automation/skills.md` documents it as active. | **Out of scope, doc corrected.** This gates *adoption quality* of generated skills — a different concern from dead-skill detection. It stays unwired; the only change here is fixing the documentation that claims it is active. Wiring it is a `skill-generation` decision, not this spec's. |

### 6.7 Loader hardening (prerequisite, not a nicety)

- **Error handling splits.** `ENOENT` (no directory) must be distinguished from every other failure
  (`skill-loader.ts:82-84`). This is load-bearing here: **a partial scan must never run orphan
  detection**, or one transient read error marks every unseen skill as orphaned.
- **Counters split** into inserted / updated / shadowed, fixing the over-report at `:68` and `:79`.

## 7. API & UI

### 7.1 API

**Observability** (existing CASL subject):

- `GET /api/v1/observability/compositions?conversationId=&runId=&limit=`
- `GET /api/v1/observability/compositions/:id` — detail with sections
- `GET /api/v1/observability/context-sections/daily?from=&to=&key=`

**Skills:**

- `GET /api/v1/skills/inventory` — resolution table: winner, shadowed sources, provenance, usage, status
- `GET /api/v1/skills/dead-candidates` — detector output
- `PATCH /api/v1/skills/:id/enabled` — idempotent, takes `reason`. Existing `POST /:id/toggle` stays.

All routes: Hono under `/api/v1`, Zod-validated, `requirePermission(...)`, registered in the
deny-by-default auth matcher (`auth/routes.ts`).

### 7.2 UI — three existing surfaces, no new page

1. **ContextBar becomes clickable** (`conversations/context-bar.tsx`, 19 lines today) → a panel
   showing that turn's composition: sections in order, sizes, what was truncated, raw content. The
   numerator is fixed at the same time: composed context size against the window, replacing the
   cumulative in+out sum that could exceed 100%.
   *Naming:* this is the token stripe above the header, distinct from the right-hand **Context Rail**
   (`2026-08-02-conversation-context-rail-redesign.md`). Different surface; that spec is untouched.
2. **Observability page** (`pages/observability/`) gains a Context tab: per-section token trend,
   truncation frequency, and estimate-vs-actual delta — which is what validates the `chars/4`
   heuristic that currently has no measured error.
3. **Skills page** (`pages/skills/skills-page.tsx`) gains an inventory view mode beside the existing
   cards, and the approval item from §6.4 links into it.

### 7.3 i18n

Every new user-facing string in all six languages — `en`, `hu`, `de`, `es`, `fr`, `tlh` — in
`pages/observability/locales/`, `pages/skills/locales/`, `pages/conversations/locales/`. CI fails on
a missing key.

## 8. Phasing

Four phases, each independently verifiable, so the implementation plan has natural gates.

| Phase | Content | Gate |
|---|---|---|
| **P1 — Record** | Manifest type; `clipToBudget` + `collect()`; both builders; `resolveConversationSystemPrompt` plumbing; post-assembler appends; unassembled paths; `context_compositions` / `context_sections`; `ai_traces.composition_id`; recorder + metadata correlation. Backend only, no UI. | The §9 byte-equality invariant passes on all four `entry_point` values. |
| **P2 — Inventory** | Loader hardening (§6.7) **first**; provenance columns; precedence ladder; `skill_shadowed_sources`; orphan detection; `setEnabled`; disable metadata; skill counters + `skill_usage_daily`; rollup job + retention purge. | The two live collisions resolve deterministically; the interrupted-scan negative test passes. |
| **P3 — Detector** | `classifySkill` (owner-authored); `GET /skills/dead-candidates`; `createApproval` integration. | A proposal appears in the autonomy queue and applies only on approval. |
| **P4 — Surfaces** | Composition + inventory APIs; ContextBar drill-down and numerator fix; observability Context tab; skills inventory view; i18n ×6. | CI green including the i18n completeness check. |

P2 depends on P1 only for the skill `source_ref` rows (counters). P3 depends on P2. P4 can start
once P1 and P2 have landed.

## 9. Verification strategy

**The load-bearing test is one invariant.** This feature has exactly one serious failure mode: the
manifest drifts from reality, claiming section X reached the model when the model received Y. A test
that **reassembles the prompt from `sections` and asserts byte equality with the string actually
sent** eliminates that entire class. Every other test is secondary.

- **Unit:** `clipToBudget` `droppedChars`; the `collect()` helper; the precedence ladder — using the
  two real live collisions (`websocket-patterns`, `slack-integration`) as fixtures, so the test
  proves determinism on actual data; orphan detection; the owner's `classifySkill`.
- **Negative:** an interrupted scan does **not** run orphan detection. This is the most dangerous
  regression available — one error would orphan every skill.
- **Idempotence:** `setEnabled(id, false)` twice equals once; `toggle()` still flips.
- **Routes + authz:** following `tests/modules/mission-control/routes.test.ts`.
- **Coverage:** a composition row exists for each of the four `entry_point` values.

DB-touching tests use in-memory SQLite with the real DDL, per existing convention.

## 10. Risks & out of scope

- **R1 (inherited, `eyas-prompt-system-design.md:190`)** — prompt-cache correctness. This spec stops
  flattening on the conversation path but does **not** activate the v2 adapters or `cache_control`.
  The `prefix_hash` recorded here makes prefix stability measurable for the first time, which is
  input to that decision, not the decision.
- **R2 — Detail-layer volume.** See §4.4. Mitigated by the config window and a logging purge job.
- **R3 — Detector correctness depends on §6.7.** Orphan detection on a partial scan would be
  destructive-by-proposal. The negative test in §9 gates it.
- **Out of scope:** cron execution log (Spec B); real tokenization; history trimming/compaction;
  the missing `skill_load` tool; a skill dependency graph.

## 11. Open questions

- **OQ1** — `classifySkill` thresholds and the situational-skill rule: deliberately deferred, and
  owner-authored at implementation time (§6.5). This is the only open item; §6.6 is resolved.
