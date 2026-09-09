# Memory at scale, scoped to projects and conversations — design

**Status:** approved by the owner, 2026-08-27.
**Extends:** `2026-08-27-durable-memory-design.md` (M1 recall shipped in 0.8.15-beta;
M2 capture plan approved, unbuilt). This design does not reopen those decisions —
it adds what a forensic pass, a scale audit and a research sweep showed is missing.

## What prompted this

A forensic pass over the live instance settled the "memory is empty" question:
**nothing was ever written, and nothing ever deleted anything.** All four
backups (install evening) hold all-zero memory tables; `sqlite_sequence` proves
the live DB is the original file; all 13 nightly consolidator runs reported
zero promotions and zero deletions; the vault directories still carry their
creation mtime. Unit tests run on `:memory:` databases and the e2e suite has
demonstrably never run against this instance.

On top of the known write-path gap (the model called `save_memory` 0 times in
24 conversations), the pass found a second, independent kill switch:

> **Boot-order bug.** `conversations` starts before `memory` (bootstrap.ts:201
> vs 213; the loader orders by hard `dependencies` only and ignores
> `optional`), but wires its memory hooks only if `ctx.memory` already exists
> at its own `onStart` (conversations/index.ts:120-126). `ctx.memory` is
> published in memory's `onStart` (memory/index.ts:159). The confirmation log
> line has appeared 0 times in 68 start cycles. Even the PreCompact capture
> path could never fire. **M2 wired through this pattern would be silently
> dead**; the fix is a lazy accessor, the codebase's own established pattern
> (five lazy getters sit directly above the broken lines). A bus event is the
> wrong fix: `LocalBus` has no replay.

The scale audit found defects that are dormant only because the stores are
empty. They become live the day capture ships:

- `buildMemoryIndex()` reads the **entire `vault_index` including full note
  bodies on every turn**, uncached, ordered by `indexed_at DESC` — so every
  vault write reorders the always-on prompt section and invalidates provider
  prompt caches mid-conversation (memory-index.ts:74-75).
- In hybrid search, **vector-only hits are silently dropped** — hydration is
  built only from FTS results (memory-service.ts:177-242). Embeddings buy
  nothing FTS didn't already find.
- `embedding-service.backfill()` runs `LIMIT n` with no cursor and no SQL
  staleness predicate: rows beyond the first window are **never embedded**.
- The global search module rebuilds Orama **in RAM on every boot** (101k
  chunks / 146 MB today) and answers vector queries with a JS brute-force scan.
- The archive tier has **no possible writer** (`createDecayService` has zero
  callers); orphan-GC is a permanent no-op (`isReachable` never passed); the
  conversation indexer covers only the newest 500 titles.

## Research grounding (2025 → 2026, sources in the session record)

- **Append-only raw log as ground truth; derived views; never destructive
  LLM rewrite.** Continuous LLM re-consolidation measurably degrades memory
  below the no-memory baseline (arXiv 2605.12978); Mem0 pivoted to ADD-only
  in 2026 for the same reason.
- **Hybrid FTS5 (BM25) + vector fused by RRF** is the proven retrieval floor;
  temporal validity intervals (invalidate, never delete) come before any graph
  engine; RAPTOR-style summary trees regress simple factual QA — skip.
- **Capture:** shipped products converge on a background extractor for durable
  knowledge plus in-band notes for task state. Cursor measured exactly our
  0/24: a main model asked to curate memory via tool calls produces task logs,
  not knowledge. Segment/turn-boundary streaming beats end-of-session (SeCom,
  ICLR 2025) — and "end of session" does not exist here anyway.
- **Scoping:** the universal shipped model is user/global → project → session,
  the narrower scope winning; explicit rules always outrank derived memories.
- **Storage:** sqlite-vec is already integrated (0.1.9); FTS5 external-content
  over a messages table is routine at 1M rows; Hungarian needs
  `unicode61 remove_diacritics 2` plus a trigram rescue table; a bundled
  static embedder (Model2Vec/potion, MIT) is the always-available option.

## The three layers

| Layer | Store | Role |
|---|---|---|
| **L2 — top** | Vault notes + `memory-index` (M1) | Durable facts, one line each, in **every** prompt. Fast by construction. |
| **L1 — middle** | `episodic_memories` (+ archive) | Derived events/summaries, scoped to conversation/project, searched on demand. Decay **demotes** to archive, never deletes. |
| **L0 — bottom** | `conversation_messages` | **Already lossless.** Gains FTS so *everything ever said* is searchable. No new capture machinery. |

Continuous writing is the approved M2 capture (per turn, after the reply is
delivered, structural gate, global switch default ON) — unchanged.

## Owner decisions (2026-08-27)

- **D1 — Recall ranking in a project conversation:** global `user` +
  `feedback` first (they steer every answer and are never walled out), then
  the **active project's** `project` notes, then `reference`. Other projects'
  notes are excluded entirely. Conversations without a project see no
  `project` notes.
- **D2 — The seed `general-general` project is "no project"** for memory:
  capture never emits `project` facts there, recall treats it as projectless.
  A catch-all default is not a project identity.
- **D3 — L0 scope:** conversation text (user + assistant messages) first.
  Tool outputs and attachments are a later, separately-designed wave (the
  `tool_executions` ledger itself currently records nothing — a separate
  defect).
- **D4 — Capture UX:** silent write + a visible "memory updated" indication +
  per-scope editable lists (F3). No approval queue now; `memory_capture_runs`
  measures noise so the queue can be revisited on evidence.
- **D5 — Embeddings:** L0 ships FTS-only. Vault/episodic embeddings keep the
  existing provider bridge; a bundled static embedder stays a later option.

## Phases

### F1 — The write path (plan: `2026-08-27-f1-memory-write-path.md`)

The approved M2 plan, executed with these amendments (each traces to an
adversarial-review finding):

1. **`project` kind ships together with project-ranked recall** — never one
   without the other; a project note nothing ranks is a file with no consumer.
   `MemoryIndexOptions` gains `projectId`, threaded at both assembly sites
   (conversations/routes.ts:817-827 and conversation-runner.ts:426-432).
2. **The extractor sees the project.** The capture prompt carries the active
   project's name + description; the candidate schema **rejects `project`
   kind when the conversation has no (effective) project**. Kind distribution
   is recorded per run so mislabeling is measurable.
3. **The capture prompt carries the current index one-liners** — the
   "nothing an existing note already covers" rule is unenforceable against
   notes the model cannot see, and the one-liners are cheap.
4. **Provenance:** vault frontmatter gains `project` (scope, set at capture,
   frozen — it does not follow a conversation that later changes project),
   projected into a `vault_index.project_id` column by the indexer. Creation
   *and* update provenance goes to a `memory_note_links` table
   (`note_path, owner_module, owner_id`), mirroring `design_links`, so a note
   reinforced in conversation B appears in B's memory view too.
5. **Episodic rows gain `conversation_id` and `project_id`**, stamped by the
   live writers (`save_memory` from `ToolContext` — which already carries
   both; PreCompact). The consolidator's carry-forward belongs to F4, where
   the consolidator is touched anyway; its sources are starved until then.
6. **The boot-order fix** (lazy hooks) lands first — it gates everything else.
7. **Stable index ordering lands in F1, not F2** — capture is what arms the
   prompt-cache churn. Ordering: kind rank, then `path ASC`.

### F2 — Scale and the lossless bottom tier

- `buildMemoryIndex`: SQL-side column pruning + LIMIT, cache keyed on
  `(projectId, COUNT(*), MAX(indexed_at))` — the key MUST include the project
  now that the index is project-dependent.
- Vault watcher gets `indexOne(path)`; `indexAll()` becomes boot-only; the
  duplicate per-file SELECT goes.
- **L0:** FTS5 external-content table + triggers over `conversation_messages`
  (`unicode61 remove_diacritics 2`), plus a trigram rescue table (budget ~3×
  text size, measured before default-ON). Backfill is **chunked and async**
  via the scheduler, never a synchronous `('rebuild')` on the boot path.
  Indexed length is clipped per message (pasted documents are unbounded).
- **L0 security (mandatory, same phase as the index):** search filters
  `status != 'deleted'` and ownership; results are provenance-labelled
  untrusted content; the privacy module's `collectSegments` is extended to
  scan `tool_result` blocks (today it scans only system/text — L0 arms that
  dormant gap); FTS delete-triggers plus a retention/hard-delete story.
- Fix vector-only hydration; fix `backfill()` with a cursor + SQL staleness
  predicate; retire the search module's JS vector scan in favour of the
  existing sqlite-vec store; `stats()` via SQL COUNT; conversation indexer
  beyond 500 titles.

### F3 — Scoping UI (M3 lifecycle absorbed here)

- Project form gains a memory section beside `ProjectDesignSection`; the
  conversation panel gains a memory tab beside the working-directories tab.
- Each lists the scope's notes (via `vault_index.project_id` /
  `memory_note_links`) and episodic rows (via the new columns), with edit /
  delete and staleness surfacing. A "memory updated" indication after capture.
- Six languages for every string, per the i18n mandate.

### F4 — Consolidation and cleanup

- Idle-time, **additive-only** consolidation via the scheduler (sleep-time
  pattern): derived artifacts are added with provenance; raw rows are never
  rewritten. Decay demotes episodic → archive (wire `createDecayService`).
- Validity surfacing on vault notes (episodic already has
  `valid_from`/`valid_until`).
- Orphan-GC gets a real `isReachable`; dead surfaces are wired or deleted
  (`context-builder-v2`, `search/context-builder`, the hardwired-empty wiki
  port, the unused `MemoryConfig`); a dead-project sweep marks orphaned
  project notes.

## Security

Everything the durable-memory spec says about recalled notes being untrusted
input stands. New with this design: L0 makes **verbatim past messages**
retrievable into future prompts, including text that arrived from external
channels. The F2 controls above (status/ownership filters, untrusted
labelling, `tool_result` scanning, retention) are part of the same phase as
the feature, not a follow-up.

## Risks

- **Capture noise** — bounded by the gate, the do-not-save list, dedup, and
  now measured per-kind in `memory_capture_runs`. The approval queue (D4) is
  the ready fallback if the measurements say so.
- **Project mislabeling is silent** under D1's exclusion rule: a global fact
  captured as `project` disappears from other conversations. Mitigations: the
  extractor sees the project, the schema rejects `project` without one, and
  F3 makes every note visible and editable in its scope.
- **Trigram index size** (~3× text) — measured on the real corpus before it
  defaults on.

## Explicitly not doing

- No graph engine, no summary trees, no destructive consolidation.
- No per-project memory isolation toggle (ChatGPT-style "project-only") —
  revisit only if D1's exclusion rule proves insufficient.
- No tool-output indexing in L0 (D3) until the tool ledger itself records.
- No new storage engines; no new dependencies in F1.
