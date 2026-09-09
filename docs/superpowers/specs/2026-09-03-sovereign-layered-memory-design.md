# Sovereign, layered memory — design

**Status:** approved by the owner 2026-09-03 ("Mehet"); Phase 0 spikes done 2026-09-03 (see 2026-09-03-memory-p0-spike-report.md); Phase 1 plans in docs/superpowers/plans/2026-09-03-memory-p1*.md, awaiting approval.
**Lineage:** extends `2026-08-27-durable-memory-design.md` (M1 recall, M2 capture → shipped as F1 in 0.8.16-beta) and `2026-08-27-memory-scale-and-scoping-design.md` (F1 shipped; F2 partially shipped as L0 FTS in 0.8.19-beta; F3/F4 unbuilt). Owner decisions D1, D2, D4 and `loadClaudeMd=false` survive unchanged; D3 becomes sequencing; D5 is revisited (§13). F2's remaining items, F3, M3 and F4 are subsumed here (§14).
**How it was produced:** an eight-lens research sweep (agent-memory frameworks, cognitive models, Claude and Grok memory as documented, PKM/Obsidian, shared memory, embedded storage, governance), each lens adversarially fact-checked; a four-proposal judge-panel design written **without reading this codebase**; three adversarial critiques; then a component-by-component reconciliation with the tree at `fc9075bd`. Companions: `2026-09-03-memory-research-synthesis.md` (evidence and sources), `2026-09-03-memory-gap-analysis.md` (50-row gap table, migration mapping, roadmap reconciliation) and `2026-09-03-memory-p0-spike-report.md` (Phase 0 spike results and the production defaults they fixed).

---

## 1. Requirements

| # | Requirement | Short name |
|---|---|---|
| R1 | Human-like memory: remember **everything** ever discussed; old or large topics only as a gist ("we talked about X around then") with deeper layers available on demand; token cost per turn must stay flat as the store grows to 10⁵–10⁶ items over years | layered recall |
| R2 | EYAS owns all memory. The model never decides what is stored and never decides what is retrieved; no provider memory product; the provider can change at any time. The model may be called as a **stateless function** (extract / summarize / embed) whose output EYAS validates and arbitrates; a design that works with **zero model calls** is required | sovereignty |
| R3 | A transparent management UI: search, view, edit, delete, browse layers and provenance | UI |
| R4 | Every memory is labelled with the project and the task it belonged to, plus other tags, so an audit is navigable | tagging |
| R5 | Periodic audit and reorganisation (dedup, re-rank, gist rewriting), but **one layer always keeps the complete original** so anything can be corrected or re-derived later | audit + raw layer |
| R6 | Later phase, designed now: per project or per tag the owner can share memory; a shared store reachable over API/MCP syncs both ways between independent EYAS instances (10–15 developers on common client projects and a shared code fork) | sharing |

Constraints: TypeScript/Bun (Node 22 fallback), single process, embedded SQLite via Drizzle, MIT-compatible dependencies only, VPS/K8s pods without GPU, **no local LLM assumed** (CLI-only providers such as Claude Code or Grok CLI may be the only model), six UI languages, the existing board (a task is a conversation) and scheduler.

---

## 2. What the research settled (evidence in the companion synthesis)

1. **The field converged on tiers**: hot in-context → warm searchable → cold immutable raw (Letta, MemOS, CoALA, Zep/Graphiti). EYAS's working/episodic/archive + vault already had the shape; what it lacked was the raw layer and the arbitration.
2. **Append-only writes, retrieval-time intelligence** (Mem0's 2026 pivot) is the right *shape*; letting model output land as equal-weight truth is not. EYAS keeps an explicit arbitration gate in deterministic code.
3. **Bi-temporal facts, invalidate-don't-delete** (Graphiti: `valid_at`/`invalid_at`) is the most reusable data model for R5. Graphiti itself is Python + external graph DB, so the *columns* are reimplemented on SQLite; no graph database is adopted (Kuzu, the only MIT embeddable candidate, self-archived 2025-10-10).
4. **Recency × importance × relevance** (Generative Agents) plus **RAPTOR's collapsed tree** (every summary level in one index, one query returns the right granularity) give R1 without a second query path.
5. **Sleep-time consolidation** (Letta): the live agent reads, a separate offline process is the sole writer. EYAS implements the offline writer as deterministic scheduled code, not a second agent.
6. **Index-first injection** (Claude Code's `MEMORY.md`: a hard-capped index always loaded, detail files on demand) is the cheapest instantiation of "gist now, detail on demand". EYAS already uses it (M1); it becomes tier 1 of the assembler.
7. **Context Rot** (Chroma, 18 models): long context is not a memory substitute; curated, bounded injection stays necessary.
8. **Every consumer product studied (claude.ai, ChatGPT, Gemini, Copilot, Grok's app, Claude Code auto-memory) lets the model decide what to write, and every one caps at view + delete, none offers in-place edit.** R2 and R3 are therefore deliberate differentiators, not gaps to reconcile.
9. **Claude vs. Grok, as documented.** Anthropic's API memory tool (`memory_20250818`) is client-owned storage driven by model tool calls; context editing and server-side compaction are opt-in; Managed Agents memory stores are versioned, redactable, archive-not-delete (the closest published analogue of R5/R6's object model). xAI's API is stateless by design (client-held compaction blob, "does not create persistent memory"); Grok Build and grok-cli use `AGENTS.md`/`CLAUDE.md`-style rule files plus resumable transcripts, no consolidation. Neither vendor puts memory ownership at the API layer — which is exactly where EYAS wants it, in its own code.
10. **PKM lessons (Obsidian and peers):** atomic addressable notes, typed frontmatter, links over hierarchy, MOC index notes as the gist layer, Bases-style *computed views over immutable sources*, PARA as a shallow taxonomy, progressive summarisation applied opportunistically where notes are reused.
11. **R6 has no precedent anywhere** (Mem0, Zep, Letta, MCP, A2A all lack cross-instance sync; A2A explicitly scopes memory sharing out). CouchDB replication and Matrix state resolution are the battle-tested templates; cr-sqlite/CRDTs are optional optimisations; access control reuses the tag taxonomy.
12. **Memory poisoning is demonstrated, not theoretical** (AgentPoison >80 % success, MINJA query-only injection). Trust tiers and a write-time gate are required, not optional.

---

## 3. Principles (non-negotiable in this design)

- **L0 is immutable and complete.** Every message, background-run output and tool result EYAS ever sees is written once, verbatim, compressed, content-addressed. Nothing above L0 is ground truth; everything above L0 is rebuildable from it.
- **The model proposes, EYAS decides.** Model output (facts, gist text, entities, importance) is a *candidate*. Dedup, supersede, tag inheritance, trust and commit are deterministic code. There is **no model-facing write tool** (today's `save_memory` is retired).
- **Degraded mode is the default path, not a fallback.** Phase 1 ships with zero model dependency: heuristic gists, structural facts, keyword tags, local CPU embeddings. A model improves quality when — and only when — a provider can be invoked headlessly and in isolation.
- **Retrieval is EYAS's decision.** The assembler chooses what is injected and how much. The model may ask for more through two read-only tools executed and filtered by EYAS (owner decision, §16-6).
- **Nothing is silently lost or changed.** Edits are new versions; deletes are tombstones; irreversible erasure is an explicit, logged, owner-only action (crypto-shred) that scrubs derived layers too.
- **Tags are structural.** `project` and `task` come from the board at capture, never inferred; a fact or gist can never carry a project/task its sources lack.
- **Designed for sharing, shipped alone.** ULIDs, content hashes, hybrid logical clocks, origin instance and trust tier are on every row from day one; the sync protocol is built only when a second instance actually needs it.

---

## 4. Layer model

| Layer | Contents | Mutability | Expected size (yr 1–3) | Retention |
|---|---|---|---|---|
| **L(−1) capture buffer** | The existing persistence points: `conversation_messages`, `agent_events` (background runs), the tool executor. Each unit gets a ULID **at capture** | Mutable/ephemeral | ≤ tens of rows per open task | Flushed to L0 on task close, 30-min idle or 8k-token chunk |
| **L0 raw** | One `memory_raw` row per occurrence (source, actor, task, project, time, trust tier) referencing a zstd-compressed, SHA-256-addressed `memory_blob` deduplicated *within* a crypto-shred partition (default: the conversation) | **Append-only** | 10⁵–10⁶ rows; size on **~2.7× compression** of message text (measured 2.663 @L3 on repo text; the 5× figure is a synthetic-corpus artefact) | Forever, unless crypto-shredded |
| **L1 facts** | Bi-temporal `(subject, predicate, object, valid_from, valid_until, invalidated_by, confidence, trust_tier, extraction_run, entity)` | Insert-only, supersede-by-new-row | 4·10⁴–1.5·10⁵ | Hot indefinitely; superseded, >3 years, unreferenced → `memory_fact_archive` (same content, off the hot path) |
| **L2 gists** | RAPTOR-style tree: depth-0 task gists, depth-1 project / project-type / topic rollups, depth-2 era rollups; **plus `global` pinned gists** (the user/feedback notes of D1). Each carries `source_*` links, `consolidation_run_id`, `gist_source` (`heuristic`/`model`) and `trust_tier = min(sources)` | New versioned rows, never edited in place; last 2–3 versions inline, older collapsed to a changelog line | 6·10³–4·10⁴ | Indefinite; re-derivable from L1/L0 |
| **L3 index** | SQLite FTS5 over L0 (contentless, populated at flush) and over L1/L2; vectors of facts, gists and entity names only — never raw L0 text. Live KNN set capped at 40 000 rows by a nightly sweep; cold rows keep their vector on disk (`live_in_index=false`) | Fully rebuildable projection | tens of thousands of live vectors | `eyas memory rebuild-index` is a tested command |
| **L4 share overlay** | Sync columns on every row + `share_scope`, `share_peer`, `share_grant`, `tombstone` tables; an untrusted inbox | Grants revocable; inbox rows re-enter the full write pipeline | small | Tombstones: peer-ack-gated compaction; zero peers compacts on schedule |
| **Vault (role changes)** | `data/vault` markdown: human-authored notes, data-port imports, and an optional **generated read-only mirror** of pinned gists | Human-edited; machine writes only to the mirror | hundreds–thousands of files | Forever, git-versionable for R6 |

The vault stops being the capture sink. Every vault file is ingested into L0 as a `document` occurrence (partition `vault:<path>`, hash = **SHA-256 of the file bytes computed at ingestion**; `vault_index.file_hash` is a `${size}-${mtimeMs}` change detector (`vault-service.ts:70`), not a hash, and is not reused — its blindness to same-size/same-mtime edits is recorded as debt) so the human layer is inside R1's "everything" without being the system of record. Justification: files cannot give bi-temporal supersede, trust tiers, tombstones, crypto-shred or a bounded tier-1 injection.

---

## 5. Data model (Drizzle/SQLite, essentials)

Common columns on every syncable table (`syncCols`): `id` (ULID), `content_hash` (SHA-256, local identity, never sent raw over the wire), `origin_instance_id`, `hlc_physical_ms`, `hlc_logical`, `revision`, `created_at`.

```
memory_blob      (content_hash, shred_partition_id) PK, compressed_blob, byte_length, ref_count
                 -- composite key kept: dedup is per shred partition (per-conversation DEKs, §11)
memory_raw       syncCols + content_hash, shred_partition_id, source_type (user_message|assistant_message|
                 tool_result|document|r6_sync|legacy_episodic), actor, conversation_id (= task), project_id,
                 project_type_id, occurred_at, trust_tier, dek_id, tombstoned, meta_json
                 idx (conversation_id, occurred_at), (project_id, occurred_at), (content_hash, shred_partition_id) non-unique
memory_raw_fts   FTS5 contentless (content=''), unicode61 remove_diacritics 2, populated at flush
memory_fact      syncCols + subject, predicate, object_text, valid_from, valid_until, invalidated_by_fact_id,
                 confidence, trust_tier, extraction_run_id, entity_id, decay_score, presence_tier, archived
memory_fact_archive  same columns, off L3 and off the default consolidation scan
memory_fact_source   (fact_id, episode_id) PK
memory_gist      syncCols + scope_type (global|task|project|project_type|topic|era), scope_id, tree_depth, text,
                 structured_json (feedback: why/howToApply), pinned, trust_tier, token_count, importance_score,
                 gist_source, consolidation_run_id, supersedes_gist_id, superseded_by_gist_id, is_current,
                 decay_score, presence_tier, alternate_of_gist_id, times_retrieved, changelog_json
memory_gist_source   (gist_id, child_type, child_id) PK
memory_entity    syncCols + tombstoned, canonical_name, entity_type, aliases_json, merged_into_entity_id
                 -- amended after p1a: `tombstoned` is on memory_fact, memory_gist and memory_entity as well,
                 -- not only on memory_raw as §5 originally implied
memory_embedding rid, id, owner_type, owner_id, owner_rid, model_id, dimensions, vector (int8 blob),
                 project_key, live_in_index, created_at
                 -- amended after p1a to the shipped column list (read back from the committed schema)
memory_embedding_vec  CREATE VIRTUAL TABLE … USING vec0(project_key INTEGER PARTITION KEY, embedding int8[384])
                 -- amended after p1a: project_key, because the partition is an INTEGER allocated by
                 -- memory_partition_key, while project_id is a ULID everywhere else in this schema
                 (global = 0); rebuildable from memory_embedding.vector
memory_tag       (memory_rid, tag_type, tag_value) PK; covering idx (tag_type, tag_value, memory_type, memory_rid)
                 -- amended after p1a: the column is memory_rid (an INTEGER rid, not a ULID; every other *_id
                 -- in this schema is a ULID, so memory_id would be actively misleading), and memory_type is
                 -- dropped from the PK because rid is globally unique across item types (one allocator)
                 tag_type: project|project_type|task|kind|entity|topic|source_type|language|trust_tier|layer
memory_link      id, created_at (NOT NULL, **no default** — p1d relies on an INSERT OR IGNORE that omits it
                 writing nothing), from_type, from_id, to_type, to_id, link_type (derived_from|supersedes|invalidates|part_of|
                 merged_into|alternate_of|migrated_from), run_id
memory_run       id, run_type (extraction|consolidation_light|consolidation_heavy|migration), conversation_id, status
                 (ok|partial|failed|skipped|degraded_no_model), model_used, prompt_template_hash,
                 raw_model_output_hash, rejected_candidate_count, quarantined_candidate_count,
                 model_calls_used, tokens_in, tokens_out, cost_usd, duration_api_ms, provider_version, stats_json
memory_access_log id, ts, actor (system_index|model_drilldown|user_ui), memory_type, memory_id,
                 action (inject|drilldown_read|edit|tombstone|crypto_shred|purge), context_task_id,
                 tokens_estimate, rank_detail_json (10 % sample)
memory_meta      (key TEXT PRIMARY KEY, value TEXT NOT NULL)
                 -- added after p1a; §5 never listed it. Holds schema_version, instance_id, fts_tokenizer,
                 -- and (per p1c/p1d) idf_docs and the per-conversation extraction watermarks
memory_partition_key  project_key INTEGER PRIMARY KEY AUTOINCREMENT, scope_type, scope_id, UNIQUE (scope_type, scope_id)
                 -- added after p1a; the ULID -> INTEGER map the vec0 project_key partition needs. 0 is
                 -- reserved for global (AUTOINCREMENT starts at 1). The ONLY allocator of partition keys
memory_dek       id, scope, scope_id (= shred partition), wrapped_key, destroyed_at, created_at,
                 UNIQUE (scope, scope_id)
memory_purge_log id, scope, reason, purged_by, purged_at        -- survives every purge
share_scope      id, scope_type (project|tag), scope_value, sync_gists (default false), hmac_key_id, revoked_at
share_peer       id, instance_id, public_key, last_ack_hlc, presumed_gone_at
share_grant      id, scope_id, peer_id, token_id, issued_by_instance_id, expires_at, revoked_at
tombstone        id, entity_table, entity_id, reason, hlc_physical_ms, hlc_logical, compacted_at
```

Differences from the judge-panel design, driven by this codebase: `scope_type` gains `global` and `project_type` (D1 ordering and the 0.8.18 `domain` inheritance depend on them); `structured_json` keeps `feedback` notes' `why`/`howToApply`; `tag_type` gains `kind` and `project_type`; `memory_run.status` gains `skipped` (today's `memory_capture_runs` writes a row for every skip — keep that discipline); `memory_link` gains `migrated_from`. `memory_capture_runs` is widened into `memory_run` rather than duplicated. Vault `## History` bullets and `## Provenance` footers are kept in the ingested L0 document text; they are not parsed into versions.

Keys and vectors: `memory_embedding_vec` is the vec0 projection of `memory_embedding.vector` (global = partition 0); **all three of the vec0 rowid, the `memory_raw_fts` rowid and `memory_tag.memory_rid` share one INTEGER surrogate key**; ULIDs are the sync identity only, never the filter path. Vector parameters are bound with `vec_int8(?)` on INSERT and MATCH. Float vectors are not stored anywhere.

`memory_raw.meta_json` carries attachment ULIDs and, for background outputs, the agent session id/seq/usage (alternatively `memory_link(raw → document, 'part_of')` rows; 5 live messages carry attachments today). `CriticVerdict` events are **not** captured or migrated unless they gain their own `source_type`. `memory_run.provider_version` is the SDK-bundled CLI version for claude-code (2.1.89 today), the API version string otherwise.

Timestamps: `occurred_at`, `created_at`, `hlc_physical_ms` are INTEGER epoch ms. Legacy sources are normalised at the boundary: ISO `Z` text; INTEGER ms (`agent_events.ts`); `datetime('now')` `YYYY-MM-DD HH:MM:SS` **as UTC** (`memory_capture_runs`, `memory_note_links`); vault `created` date → midnight UTC.

Mutations that are allowed in place, each logged: administrative columns (tags, pin, trust tier by explicit user action), `is_current`, `decay_score`, `presence_tier`, `times_retrieved`, and the crypto-shred scrub (§11).

---

## 6. Write path

```
persistence hook → L(−1) (ULID at capture) → L0 flush (exactly once per id)
   → deterministic extraction (always) → optional model pass (stateless JSON, isolated + headless)
   → arbitration (dedup · supersede · tag invariant · poisoning gate · entity linking · trust)
   → L1 facts + L2 task gist + tags + links + run row → L3
```

**Capture hooks.** L0 is fed at the persistence layer, not post-turn: `chatService.addMessage` (`src/modules/conversations/routes.ts`), the `agent_events` append for background runs (`src/modules/agent/conversation-runner.ts`, whose outputs never reach `conversation_messages` today), and the tool executor for `tool_result` (Phase 1b, 8 KB cap, `ingested` trust). This structurally closes the God Mode gap (the God Mode branch returns before today's capture call) and the background-run gap, and makes L0 independent of chat-store deletion. A lazy, bounded in-process `ctx.memoryIngest` queue absorbs the boot-order problem (conversations, tools and event-store register on both sides of memory in `bootstrap.ts`; the loader orders by hard dependencies only).

**Flush contract.** Idempotency is keyed on the capture-time ULID (`INSERT OR IGNORE` on `id`), never on content, so a retried flush is a no-op while two byte-identical occurrences in two conversations stay two rows, two blobs, one `content_hash` (within one conversation: two rows, one blob, `ref_count = 2`). Compression shim (verified): `Bun.zstdCompressSync` → `node:zlib` zstd (**Node ≥ 22.15.0; Node 23.0–23.7 have none — the shim fails loudly, never silently**) → **`@bokuweb/zstd-wasm`** (MIT, compress + decompress; `fzstd` is decompress-only and excluded). **Level 3.** Frames are byte-identical across Bun 1.3.10 and Node 22.23 today (both libzstd 1.5.7); identity is the SHA-256 of the *uncompressed* bytes, never of the frame.

**Trust tier at capture** (never inherited from context): owner conversation text → `owner`; tool results, fetched pages, ingested files → `ingested` unless the source is on an explicit allowlist (board fields are owner-equivalent); data-port imports the owner performed → `owner` (§16-7); R6 rows → `peer`, always.

**Deterministic extraction (always runs).** Regex/heuristic entities (dates, `@mentions`, capitalised phrases, `key: value` / `X = Y`, code identifiers, board-linked entities), TF-IDF keywords against an incrementally maintained IDF table (reusing `related-work.ts`'s tokenisation rules and `escapeFtsQuery`), rule-based importance (message count, decision markers such as "decided/approved/TODO/blocked", task outcome, user pin), a heuristic leaf gist (first + last message + top-3 TF-IDF sentences, ≤ ~280 chars, `gist_source='heuristic'`), and structural facts only (board fields, tool arguments, explicit `X = Y`) with `facts_pending=true` for later model backfill. Language detection (hu/en/de/es/fr/tlh) is a dependency-free heuristic.

**Model pass (optional, once per trigger).** Today's capture ladder is kept and retargeted: `capture/completion.ts` (tier → non-CLI provider → isolated CLI → gateway; CLI never model-pinned), `parseBatch`'s balanced-brace salvage and per-item Zod validation, `CAPTURE_SYSTEM_PROMPT`'s ground-truth rules (EXISTING NOTES is the only coverage source; the assistant's "I saved it" is narration). New output contract: `{ gist, importance 1–10, candidate_facts[{subject, predicate, object, confidence_hint}], candidate_entities[] }`. A background call goes only to an eligible provider: `eligible(p) := p.supportsHeadlessInvocation === true && (p.supportsIsolatedCompletion === true || !isCliProviderId(p.id))`. `supportsHeadlessInvocation` is added in **Phase 1** (absent from `src/` today), `true` on every API provider and claude-code, absent on grok-cli and kimi-cli: `grok -p` is headless but injects ≥ 15 k tokens of host context and keeps `run_terminal_command` + plugin MCP tools under every documented switch, and it read the host's Obsidian ai-memory vault in the Phase 0 canary — F1.3 proved a non-isolated call answers from the host machine's own memory, and F1.6 proved ACP denies are not enforceable. Those installs run degraded mode permanently for background work, disclosed in the UI. The ladder's `gateway-fallback` rung (d) is **not used for background work** (background = eligible provider or degraded, never "let the gateway choose"). Cost is recorded per run (`total_cost_usd`, `duration_api_ms`); on a CLI-only install the isolated path runs on the CLI default (`claude-opus-4-6[1m]`, ≈ $0.015 / 8 s per 20-line batch); the SDK-bundled CLI version, not the system `claude`, is what runs. The judge-panel design's "piggyback a hidden side-request onto the user's live session" mechanism is **not adopted**: there is no provider on which it is both needed and safe (§16-8).

**Arbitration (100 % deterministic).**
- Dedup: content-hash match → link only; near-duplicate (cosine ≥ 0.92, same entity + predicate) → reinforcement, confidence bump, no new row. Scoping rule from `note-writer.ts` survives: a project-scoped item never fuzzy-matches a global one.
- Contradiction: same `(subject, predicate)`, different object → new fact, `valid_until`/`invalidated_by` on the old. Never an in-place update.
- Tag invariant: `project`/`task` inherited from source episodes and validated at commit; a violation is a rejected write.
- Poisoning gate, graduated, applied to candidate facts **and** to the model's gist text: high-confidence instruction-shaped text ("ignore previous facts", role reassignment, system-imperative phrasing) is rejected and counted; low/medium confidence commits as `trust_tier='quarantined'` (visible in the UI, excluded from injection); a rejected gist falls back to the heuristic gist.
- Entity linking: exact/alias match, else cosine ≥ 0.85 within the same project; auto-merge only when every contributing source is `owner`/`derived`; anything else, and any entity gaining > 3 aliases in 24 h, goes to the merge-review queue.
- Commit: facts, gist (`trust_tier = min(sources)`), tags, links, `memory_run` row (prompt hash, raw-output hash, counts, tokens); embeddings for gist text, fact objects and entity names.

**Cost per 30-message conversation:** capture 0 calls; extraction with a model 1 call (~6 300 in / ~500 out); degraded 0; arbitration 0.

---

## 7. Read path

**Query construction (no model):** task title + description + last 1–2 user turns + `project_id` + `project_type_id` + existing topic tags, with the same TF-IDF vocabulary as write time. `related-work.ts`'s anti-echo rules (`hasQuerySignal`, `isQueryEcho`) survive as regression tests.

**Candidate generation:** FTS5 `bm25()` top-50 with the D1/task filter written as **`+rowid IN (SELECT memory_rid FROM memory_tag …)`** (the unary plus is mandatory: the plain form re-runs the MATCH per candidate, 0.5 s at 300 k) ∪ KNN top-50 over `memory_embedding_vec` as a **`MATERIALIZED` CTE with `project_key IN (0, <project>, <project_type>) AND k = 50`, outer `ORDER BY distance LIMIT 50`** (vec0 returns k per partition), with `rowid IN (…)` from `memory_tag` as the secondary filter inside the same query; both in one statement (26–40 ms p50 on the pod at 200 k/300 k with the `rowid IN` KNN; ≈ FTS cost with the partition CTE). The D1 set is `global` ∪ active project ∪ its project type; other projects are excluded. **Over-fetch-then-filter is banned** (recall 2–30 %). Fusion is **gated, not naive RRF** (the RRF base keeps `k=60`, lifted from `memory-service.ts`; the byte-identical duplicate in `search/engine.ts` is deleted): query tokens prefix-stemmed to 5 chars + `*`, stop-words and tokens < 3 chars dropped, lexical weight ≤ 0.3 or a bm25 hit admitted only with ≥ 2 distinct query stems, dense list primary — naive RRF costs 20 R@5 points on the hu/de fixture. For `language=tlh` the lexical up-weight is kept (the embedding model was never trained on Klingon).

**Re-ranking:**
```
score = 0.35·relevance(RRF) + 0.20·recency(exp(−λ·age), λ per layer: facts ~30 d, gists ~365 d, pinned never)
      + 0.20·importance + 0.15·log(1+access_count) + 0.10·tag_match(task 1.0 / project 0.5)
then trust multiplier: owner/derived 1.0 · ingested 0.6 · peer ≤ 0.3 and labelled · quarantined excluded
```
Weights are hand-set defaults, labelled as such in the UI; `rank_detail_json` (10 % sample) feeds a later offline tuning job. Optional CPU cross-encoder rerank on the top 30 is a toggle.

**Injection, one budgeted section, three tiers:**
1. **Always-injected index** (no query): D1 order — pinned `global` gists (≤ ~600 tokens, today's 2 400-char index), the active project's root gist, up to 5 recent sibling task gist lines. Trust-gated like everything else.
2. **Retrieved gist lines:** top-8 fused candidates as one-line references with ids.
3. **Auto-expanded top-2** as full text — EYAS's decision.
Default ≈ 900–1 600 tokens; **declared** as one `SectionBudget` section with a 1 200-token reserve (§16-9), replacing today's three uncoordinated blocks (`memory-index` 2 400 chars and `related-work` 1 200 chars, both budget-exempt; prompt-wizard `memory-context` shrinkable to zero). Wired through the existing lazy accessors into both call sites (`conversations/routes.ts` SSE handler and `conversation-runner.ts`).

**Drill-down tools (owner decision §16-6).** `memory_search(query, filters)` and `memory_expand(id)` are the only memory tools on the model's surface: read-only, executed by EYAS's own retrieval code with identical ranking and trust gating, 3 calls/turn, server-truncated, **project-locked** (another project needs a user UI action, never a tool argument), every call logged as `model_drilldown`, results rendered as passive quoted data that can never trigger a tool or a write. Note the measured reality: CLI providers narrate tool calls they never make (F1.2, `tool_executions` = 0), so automatic injection must carry the full load and the critic must never mark a run incomplete for not calling them.

**Worked example** (300 k raw, 40 k facts, 6 k gists; new task in an active project with ~650 tagged rows): tier 1 ≈ 275 tokens, tier 2 ≈ 360, tier 3 ≈ 300 → **≈ 935 tokens**, worst case with drill-down ≈ 1 835. Nothing in the injected set scales with corpus size; only the `LIMIT`-bounded candidate pool does. Flatness is measured at 50 k / 150 k / 300 k seeded rows in Phase 2/3, not extrapolated.

---

## 8. Consolidation and audit jobs

Two scheduled jobs on the existing scheduler, never a second live agent.

**Light pass (hourly).** Runs in a **dedicated worker thread with its own WAL connection** (no `worker_threads` usage exists in `src` today — new infrastructure, Phase 0 spike), chunked into **5 000–10 000-row** transactions (reader p50/p95/p99 are unaffected by chunk size; 10 000 finishes 10⁶ rows in ~20 s on 2 vCPU vs > 100 s at 500–2 000); yield `setImmediate` per chunk; `busy_timeout 5000`; `synchronous=NORMAL`; **the worker owns WAL checkpointing during a sweep**: `PRAGMA wal_autocheckpoint=0` on its connection, `wal_checkpoint(PASSIVE)` every ~50 chunks (~100 MB WAL), `TRUNCATE` at the end — the default auto-checkpoint on a bulk writer with a continuously reading main thread is the sole source of the 0.6–2.6 s reader stalls measured. Scope: decay recompute; exact-duplicate sweep within partitions; broken-link check; presence-tier reassignment hot→warm→cold; the **size-capped eviction** (`ORDER BY decay·importance DESC LIMIT 40 000`, overflow demoted regardless of age); `model_id` mismatch detection queuing rolling re-embedding.

**Heavy pass (weekly, budgeted).** `priority = 0.40·reuse + 0.25·staleness + 0.20·volume_pressure + 0.15·user_flag`, plus a fixed 2 % random sample so a silent extraction bug in an unvisited corner is eventually seen. Clusters sibling gists by embedding k-means (no model), then one model call per cluster to refresh the parent gist citing its children — through the same isolated + headless ladder as extraction (today's `semantic-promoter.ts` has no ladder and no isolation; it is retired). Rollup text clears the same poisoning gate; parent `trust_tier` is recomputed from the child set. Degraded-mode rollups exist at every depth: top-N children by importance × recency, templated header with date range, TF-IDF themes and most recent lines, ≤ ~300 tokens, `gist_source='heuristic'`, queued for opportunistic upgrade.

**Steady-state cost** at the worked-example scale: ~300 clusters, quarterly refresh → ~23 model calls/week (~33 k tokens, < 2 min) within a default 50-call weekly ceiling; **0 by default until a capable provider is configured** (§16-8).

**Tree and history bounds.** Inactive task gists (no touched children for 6 months) are absorbed into the project gist (`superseded_by_gist_id`, row kept). Gist history: last 2–3 versions inline, older collapsed into a changelog line. Facts: superseded, > 3 years, unreferenced by a live gist → `memory_fact_archive`.

**May:** insert gist rows at any depth, insert supersede pairs, merge entities from `owner`/`derived` sources (logged, reversible), recompute scores and tiers, rebuild L3. **May never:** touch L0, physically delete a fact/gist/entity, crypto-shred, promote a `quarantined` row, or demote trust on its own (quarantine is a write-time decision only). Today's orphan GC (`consolidator/orphan-gc.ts`) physically deletes rows and is retired for that reason, not fixed.

**Tombstone GC.** 90-day window, then compaction to a stub once every known, non-`presumed_gone` peer has acked past its HLC; **an empty peer set compacts on schedule** (asserted by the Phase 4 test that ships this GC — no compaction routine exists before Phase 4, and nothing writes a tombstone before Phase 3's UI delete); a peer silent for 6 months is marked `presumed_gone` with an admin alert.

**Backlog self-monitoring.** Queue depth and average scope staleness are surfaced in the run-history view; the scheduler may auto-scale the heavy budget within an admin ceiling. Phase 4's acceptance test runs the heavy pass against a competing background job on the reference pod (`maxConcurrent: 4`, no CPU budget pool exists today — the pool stays an optional later change).

---

## 9. Tagging and scoping

Required facets, Zod-enforced, stored only in `memory_tag`: `project`, `project_type`, `task` (= conversation, `conversations.id`), `kind` (user|feedback|project|domain|reference, for D1 ordering and UI filters), `entity`, `topic`, `source_type`, `language`, `trust_tier`, `layer`. `project`/`task` attach at capture from board context (`effectiveProjectId`, D2: `general-general` → no project). Inheritance `episode → fact → gist` is strict for `project`/`task`; `entity`/`topic` accumulate upward. A gist whose children span projects under one topic is `scope_type='topic'`, `project_id=NULL`, `multi_project=true`.

The same taxonomy is R6's sharing boundary (`share_scope = (project|tag, value)`), so no parallel permission scheme is introduced. Today's `vaultNoteInScope()` becomes the tag-based candidate restriction; the write-only `memory_note_links` table becomes `memory_link` with a reader (the provenance view).

---

## 10. Management UI (R3)

Six linked views over the same tables, keeping `memory-dashboard.tsx`'s tab shell, the six locale files (full parity today) and `ContextualHelp`; the global Cytoscape graph view is dropped (unreadable past a few hundred nodes; the bounded provenance DAG replaces it).

1. **Browse/facet list** — filters for project / project type / task / kind / topic / trust / language / layer / date; FTS vs. vector toggle; default-scoped to the current project; cross-project is an explicit toggle (its latency is benchmarked separately).
2. **Provenance DAG** (≤ 3 hops): episodes → extraction run (model or "degraded", raw-output hash) → consolidation runs → gist versions, diffable.
3. **Access/injection log** over `memory_access_log`: what was injected vs. retrieved, tokens, drill-down calls, cost.
4. **"What would be injected now"**: the exact assembler dry-run for a draft task, per-tier token counts, weights labelled hand-set, each candidate's trust multiplier — the counterpart of Claude Code's `/context`.
5. **Run history** with backlog trend and one-click non-destructive revert per run (tombstone its rows, flip `is_current` back).
6. **Review queue** (generalising today's `review-view.tsx` + `review-queue.ts`): quarantined items, entity merges below trust, alias-rate holds, heuristic gists awaiting upgrade.
Plus the two EYAS-specific placements F3 asked for: a memory section in the project form and a memory tab in the conversation panel (task facet).

**Edit** = new row (`revision+1`, `reason='user_edit'`), prior row `is_current=false`; only administrative columns mutate in place, each logged. **Delete** has three tiers (§11). The capture indicator (D4) becomes a one-line disclosure on turns where extraction ran.

**i18n:** ~150–250 new keys × six languages; a locale-key parity test in CI; the handbook's `knowledge/memory.md` de/es pages (currently ~7 sections short) are regenerated from one English source per wave.

---

## 11. Trust, delete semantics, erasure

**Trust tiers:** `owner` · `derived` · `ingested` · `peer` · `quarantined`, a column on raw, fact and gist rows, projected into `memory_tag` for filtering so UI and read gate can never disagree.

**Delete tiers:**
- **Tombstone** (default "Delete"): reversible, hidden from retrieval, bytes intact.
- **Crypto-shred** ("permanently destroy", typed confirmation, owner-only): destroys the partition's DEK (wrapped by the `secrets` module), **scrubs in place** every `memory_fact.object_text` and `memory_gist.text` citing an episode of that partition (fixed placeholder, ids/tags/links intact, `reason='key_destroyed'`), re-derives multi-partition gists without the destroyed sources, and rebuilds the affected FTS/vector entries. Logged in `memory_purge_log`. Default partition = one conversation (also the dedup boundary; finer partitions trade dedup for granularity).
- **Hard purge** (admin-only): physical removal; `memory_purge_log` is the one thing that survives, kept outside every table it describes.

CASL gains `delete` and `purge` on `MemoryEntry` (no role has `delete` today; owner's `manage all` is the only path), plus `MemoryShareScope`/`MemoryShareGrant` subjects for R6. With no model-side write tool, the tool surface collapses to two green read tools, so the two coexisting authorisation schemes (CASL for REST, security-gate autonomy for `save_memory`) reduce to one on the REST/UI edge.

---

## 12. Shared memory (R6) — designed now, built on demand

**Scaffolding in Phase 1:** ULIDs, `content_hash`, HLC triple, `origin_instance_id`, `revision`, `trust_tier` (with `peer` and `quarantined` as first-class values), and the four empty share tables. A solo instance is L4 with an empty peer set.

**Protocol (implementation gated on a real second instance):** one MCP server `eyas-memory-share` with `push_since(cursor, scope)`, `pull_since(cursor, scope)`, `list_shared_scopes()`, `revoke_scope(scope)` and a `schema_version` handshake — registered on its **own private transport, never in the tool registry** (today's MCP server exposes the whole registry, which is exactly the surface the share server must not share). Every RPC verifies a Biscuit capability token (JWT + revocation list as the documented fallback) and a CASL rule; `revoke_scope` only for grants the caller issued or holds.

**Topology:** hub-and-spoke, self-hosted hub (no STUN/TURN), with the hub's plaintext visibility disclosed and consent-gated at hub election; per-recipient encryption is a candidate later hardening.

**Sync mechanics:** structured tier via HLC cursor + field-level last-writer-wins on columns present from Phase 1 (cr-sqlite optional, never load-bearing); vault markdown via whole-file git objects through vendored `isomorphic-git` (MIT), no system `git`. Wire identity uses `HMAC(scope_secret, content_hash)`, never the raw hash (membership-oracle mitigation).

**Inbox re-validation:** every pulled row re-enters the full write pipeline (§6) with `trust_tier` forced to `peer` before promotion; nothing is adopted for having arrived over an authenticated channel.

**Gist policy:** default **facts and episodes only**; each instance regenerates its own gists (the gist-merge problem has no precedent and is sidestepped). `share_scope.sync_gists` opts into alternate-gist linking (`alternate_of_gist_id`, never auto-merged, same version cap).

**Redaction gate:** two engines — the existing `privacy` scanner chain (`ctx.privacySanitize`, extended to `tool_result` blocks, which it does not scan today) as the PII engine, plus a new secret-scanner (entropy + known credential prefixes + PEM headers, MIT/Apache rules only). Cached by `(content_hash, ruleset_version)`; a mandatory human preview gates scope activation; flagged items in an active scope are held for batch approval.

**Revocation** is non-destructive: the receiver moves synced items to a quarantined `revoked-shared` layer. **Schema skew:** additive-only migrations on syncable tables; unknown columns are ignored by older peers.

---

## 13. Storage engine, embeddings, runtime — decided with the codebase in view

- **Storage engine: keep `bun:sqlite` primary** (the project's documented stack). The judge-panel design proposed `better-sqlite3` under both runtimes because bun:sqlite's FTS5 support was "unverified"; in this codebase FTS5 is **proven** — `episodic_fts`, `vault_fts`, `archive_fts` and `conversation_fts` run on bun:sqlite today. **Bun's Linux builds load extensions natively**; `setCustomSQLite()` is a **macOS-only** workaround (Apple's SQLite refuses `loadExtension`; Homebrew's works) and is a silent no-op on Linux — `connection.ts` restricts the probe to `darwin`, guards it once per process, and replaces `isSqliteExtensionLoadingAvailable()` (no callers) with a live self-test (`vec_version()`, 1-row `int8` insert, KNN) surfaced by `eyas doctor`. (a) The runtime image stays **`oven/bun:<pinned 1.3.10>-slim` (glibc)**; `libsqlite3` in the image is irrelevant to Bun; **musl is unsupported** unless `vec0.so` is compiled from the amalgamation at build time; the `Dockerfile` installs with `--ignore-scripts` (or `better-sqlite3` moves to `optionalDependencies`) because its install script fails under Bun and breaks the build today. (b) **sqlite-vec is load-bearing for filtered KNN and vector persistence** (vec0 `PARTITION KEY` = 0.3–1.3 ms p95 at 200 k on the pod; `rowid IN` = 16–29 ms; float = over budget), **not for raw speed**: the pure-JS int8 scan over `memory_embedding` blobs is the fallback for macOS-without-Homebrew and musl and is measured at 11–12 ms p95 for 40 k rows (faster than sqlite-vec for an unfiltered scan). Both engines run in the light-pass worker, never on the request thread. `better-sqlite3` is **Node-only and cannot load under Bun at all** (hard-blocked at `require()`, oven-sh/bun#4290). Owner decision §16-1.
- **Local embeddings: bundle `@huggingface/transformers` 4.2 (Apache-2.0; pulls `onnxruntime-node`, MIT) + `multilingual-e5-small` from `intfloat/multilingual-e5-small` (MIT)** as q8 ONNX, 384-d, with mandatory `query: `/`passage: ` prefixes (`model_id = multilingual-e5-small@q8/e5-prefix`), run on CPU inside EYAS, provider bridge (`gateway.embed()`, ollama/openai) as an optional upgrade. This does **not** violate the no-local-LLM rule: a ~136 MB embedding model on CPU is a deterministic function, not an LLM, and it is what makes the vector channel exist at all on a CLI-only install (none has an `embed()` provider today; D5 revisited). **Model chosen by the Phase 0 Hungarian/German recall spike:** R@5 85 % vs 60 % for `paraphrase-multilingual-MiniLM-L12-v2` and 22.5 % for FTS5 on the hu/de/en fixture; the English-centric `all-MiniLM-L6-v2` (24 MB, 150–240 MB RSS) is the documented English-only downgrade, not the default. **~136 MB on disk, ~0.5 GB RSS** (the XLM-R tokenizer alone ≈ 250 MB), cold start 0.7–1.3 s on 2 vCPU, ~65 sentences/s at 128 tokens with `intraOpNumThreads` pinned to the CPU quota (the ORT default halves throughput in a cgroup). **Bun hosts it natively** (`onnxruntime-node` loads under Bun 1.3.10 on glibc; no Node sidecar); it lives in the light-pass worker, lazy-loaded, disposed after idle. Do not ship weights from an unlabelled `Xenova/*` mirror. `model_id` on every vector enables rolling re-embedding when the model changes. The search module's own Ollama/OpenAI discovery by raw HTTP (`search/index.ts:57-75`, bypassing the gateway) is search-module debt, off memory's path.
- **Compression:** runtime-detected zstd shim, three tiers — `Bun.zstdCompressSync` → `node:zlib` zstd (Node ≥ 22.15.0; Node 23.0–23.7 have none and the shim fails loudly) → `@bokuweb/zstd-wasm` (MIT); `fzstd` excluded (decompress-only); level 3; ~30 µs/msg at 2 vCPU; identity = SHA-256 of the uncompressed bytes (§6).
- **IDs:** a ~40-line ULID utility (no dependency; `nanoid` stays for non-memory ids); `instance_id` generated once into **`memory_meta`**, not into secrets (amended after p1a: it is the *public* sync identity stamped on every row, it must be readable **synchronously** inside the flush transaction, and the secrets provider is async and empty before the master key exists — it is not secret material).
- **Worker thread** for the light pass: Bun `Worker` / Node `worker_threads`, own WAL connection — **verified** (0 `SQLITE_BUSY` over 10⁶ rows, reader p99 unchanged); the worker also hosts the embedder and both KNN engines and owns WAL checkpointing (§8).
- **Raw SQL escape hatch** for FTS5 `MATCH`/`bm25()` and `vec0` KNN: mostly exists (`sql.raw` in `conversation-fts.ts`, `vec-store.ts`, `memory-service.ts`); the contentless-FTS and filtered-KNN shapes are written and validated: the Phase 0 spike's `fts-knn-shapes/shapes.sql` (USE / DO NOT USE annotated) becomes `tests/modules/memory/query-shapes.test.ts` (spike report §5).
- **No new frameworks:** CASL for ACL (not node-casbin), no graph database (entity/relationship rows + on-demand `graphology` if traversal is ever needed), Orama stays in the search module only.

---

## 14. Migration and retirements

**Live data today** (read-only query, this instance): 46 conversations, 61 `conversation_messages`, 266 vault notes (264 imported `reference`, 1 `user`, 1 `feedback`), every DB memory tier at 0 rows, 15 capture runs, 2 note links. Migration risk is procedural, not volumetric — but the procedure must work for any install.

**Principles:** additive schema (`memory_*` tables, no `ALTER`/`DROP` of legacy tables at cutover); deterministic re-runnable ULIDs (timestamp from the source `created_at`, random part from `SHA-256('legacy:'+table+':'+pk)`); real `occurred_at`; vault files never rewritten; `memory.engine: 'legacy' | 'v2'` selects the read/write path; legacy tables read-only for one release; `eyas memory migrate --undo` drops only the new tables and `migrated_from` links; every raw row gets a `memory_link(raw → <legacy table>, <pk>, 'migrated_from')`; the migration writes its own `memory_run(run_type='migration')` with counts in `stats_json` and is **idempotent by construction** (`INSERT OR IGNORE` on deterministic ids, blob `ref_count` bumped only on `changes()==1`; 78 ms to re-run under pod limits) — no "already migrated" flag; a disaster-recovery backup precedes migration.

| Source | Target |
|---|---|
| `conversation_messages` | `memory_raw` (`user_message`/`assistant_message`, `owner`, partition = conversation, `project_id` via `effectiveProjectId`) + `memory_blob` |
| `agent_events` `LlmResponse` | `memory_raw` `assistant_message` for background runs; join **`agent_events.session_id = agent_sessions.id → agent_sessions.conversation_id`** (the managed child conversation; the user-visible parent is `conversations.parent_conversation_id`); **skip an `LlmResponse` whose content hash already exists as an `assistant_message` in the parent conversation** (3/9 today) — and at capture time hook only one of the two writers; `actor` = `agent_sessions.agent_id` (`agent_events.actor` is NULL on every row); `CriticVerdict` **not migrated** |
| `episodic_memories` / `archive_memories` | `memory_raw` (`legacy_episodic`) + one `memory_fact` (`note states <content>`, `confidence = salience`, `trust=derived`, `facts_pending=true`); archive rows `presence_tier='cold'` |
| Vault notes | one `memory_raw` `document` (partition `vault:<path>`, hash = SHA-256 of the file bytes at migration) + one depth-0 gist (text = `summary` with a leading `# heading` stripped, or the first body paragraph — imported `reference` summaries are ~160-char truncations; `scope_type` global/project/project_type/topic by `kind`; `pinned` for user/feedback; `structured_json` for feedback) + `kind`/`topic`/`project` tags (`source:x` → `source_type` tag, `import-job:x` → `changelog_json`, `imported` → dropped, not `topic`) + source link |
| `memory_note_links` | `memory_link(derived_from)` matched to capture runs by same `conversation_id` **and same second** (observed delta 0 s), ±60 s fallback, after UTC normalisation |
| `memory_capture_runs` | `memory_run(extraction)` with status mapping: `skipped_reason='error'` → **`failed`**; `unparsable`/`too-short` → `skipped` |
| `working_memory` | not memory: stays the prompt-wizard scratchpad; live rows flushed as `document` at cutover |
| `memory_blocks`, `team_memory` | not migrated (0 rows); blocks retired; team memory stays a run blackboard in the agent module, its promotion writes an L0 document + task gist instead of a vault file |

**Rebuild-from-log:** `eyas memory rebuild --from-l0` truncates L1/L2/L3 (never L0, `memory_run`, `memory_purge_log`) and replays deterministic extraction in `occurred_at` order; tested in Phase 1 with row counts and hash spot-checks. **Vault export:** `eyas memory export --vault [--scope …]` renders pinned gists and facts as frontmatter markdown (`generated: true`) so Obsidian users lose nothing.

**Retire (dead or superseded):** `context-builder-v2.ts`, `search/context-builder.ts`, `consolidation/decay.ts` + `implicit-extractor.ts` (with `tests/modules/memory/consolidation.test.ts`), `consolidator/wiki-refresher.ts` and the `wiki_edit_proposals` phase, `consolidator/orphan-gc.ts`, consolidator phases 1–3 and `semantic-promoter.ts` (after Phase 4), `blocks/memory-blocks.ts` + `memory_block_*` tools, `types.ts` `MemoryConfig`, `graph-builder.ts` soft-edge helper, the subscriber-less `eyas.memory.reflection` event, `archive_memories`/`archive_fts`/`tiers/archive-memory.ts` (after migration), `memory-index.ts` and `related-work.ts` as assemblers (after Phase 2; their rules become tests), `memory-service.search()`/`stats()`, `tools/builtin/memory-tools.ts` `save_memory` (Phase 1) and `search_memory` (re-contracted), `consolidator/README.md`, the `a2a` entry in `CLAUDE.md` (module does not exist). Move, not delete: `skill_candidates` + extractor → skill-evolution; the `team_memory` retention job → agent module.

**`save_memory` retirement touches** rule 8 in `prompt-wizard/core-rules.ts:30-35`, 12 persona allow-lists in `agent-templates.ts`, the `memory_maintenance` binding in `security-gate/autonomy-policy.ts:130`, `agent/critic.ts`, and the MCP catalog — one wave, documented in six languages. Rule 8 becomes "you cannot save memory; EYAS records automatically — use `memory_search` to look things up".

**Roadmap reconciliation:** D1/D2/D4/`loadClaudeMd=false`/"capture always on" survive; D3 becomes Phase 1 (messages + background outputs) → 1b (tool results); D5 revisited (§13). F2: index cache and `indexOne` obsolete (tier 1 is a `LIMIT` query), L0 FTS shipped and subsumed, L0 security subsumed by trust tiers, `tool_result` privacy scanning **still required**, vector-hydration drop (`memory-service.ts:292-293`) and `backfill()` cursor (`embedding-service.ts:112-159`) confirmed still broken — fix hydration now as an interim S, let backfill die with its replacement. F3/M3/F4 fully subsumed by §8/§10.

---

## 15. Phasing

**Phase 0 — Spikes and irreversible defaults (S/M, ~1–1.5 weeks; blocks the schema).** Done 2026-09-03 — see `2026-09-03-memory-p0-spike-report.md`: (a) PARTIAL (glibc PASS, musl FAIL, JS-scan PASS), (b) FAIL (Bun hard-blocks better-sqlite3; Dockerfile build broken), (c) PASS with mandated shapes, (d) PASS/PARTIAL (e5-small; 0.5 GB RSS), (e) PASS, (f) PASS with max-stall caveat, (g) claude-code PASS / grok FAIL / kimi UNTESTED, (h) PASS budget / FAIL shipped k8s limits, (i) PASS with corrections. The items as planned, kept for the record: (a) `sqlite-vec` loading under bun:sqlite on the real glibc and musl images with `libsqlite3` present, and the JS-scan fallback benchmark at 40 k; (b) `better-sqlite3`-under-Bun native load, only as the recorded alternative; (c) contentless-FTS5 and filtered-KNN query shapes as tests, latency budget < 50 ms p95 at 200 k pre-eviction; (d) transformers.js multilingual embedder: cold start, throughput, RSS on 2 vCPU/4 GB, Hungarian/German recall vs. FTS-only; (e) zstd shim round-trip on both runtimes; (f) worker thread with its own WAL connection under Bun; (g) provider matrix `supportsHeadlessInvocation × supportsIsolatedCompletion` for claude-code (SDK `query()`), grok-cli, kimi-cli, API providers; (h) combined RSS under `--memory=3g`; (i) migration dry-run on a copy of `data/sqlite/eyas.db` with counts and hash spot-checks. Deliverable: spike report; owner decisions §16-1 and §16-2 taken.

**Phase 1 — L0 + L1 core, degraded-first, migration, retirements (L, ~3–4 weeks).** All `memory_*` tables incl. empty R6 tables; ULID + `instance_id`; capture hooks at `addMessage` / `agent_events` / tool executor (1b) with the lazy buffered ingest accessor; exactly-once flush; deterministic extraction; arbitration skeleton (hash dedup, `(S,P)` supersede, tag invariant, regex poisoning gate with graduated response); heuristic leaf gist; `memory_run`; `eyas memory migrate` / `rebuild --from-l0` / `rebuild-index`; `memory.engine` flag; `save_memory` retired everywhere; `agent/index.ts:979` made lazy; dead files deleted; `collectSegments` scans `tool_result`; `supportsHeadlessInvocation` on `AIProvider` + `eligible()` predicate; `Dockerfile` install fix and Bun tag pin; `connection.ts` probe restricted to darwin + capability self-test in `eyas doctor`; `src/shared/zstd.ts` shim with its dual-runtime test; k8s memory `1Gi/2Gi` in raw and Helm manifests (§16-15). **Acceptance:** replaying the live store yields raw/gist/tag rows with zero model calls; migration counts and hashes match; migration re-run is a no-op; `datetime('now')` timestamps land at UTC; two identical messages in two conversations → **two raw rows, two blobs, one `content_hash`**; within one conversation → two raw rows, one blob, `ref_count = 2`; God Mode and background runs produce L0 rows; every existing memory test ported or deleted with its code.

**Phase 2 — Local embeddings, hybrid retrieval, assembler (M, ~2–3 weeks).** Embedder provider behind the gateway (local default, bridge optional); `memory_embedding` with `model_id`/`live_in_index`; live set + cap; RRF + ranking + per-layer decay + trust gate; tier 1 in D1 order; one declared `SectionBudget` section wired into both call sites; `memory_search`/`memory_expand` replacing `search_memory`; `memory_access_log`; `memory-index.ts`, `related-work.ts`, `memory-service.search()` retired; duplicate weights in `search/engine.ts` deleted. **Acceptance:** 20-question eval answered from injected context alone; median injected tokens flat at 50 k and 150 k seeded rows; unscoped-query latency budget met; Hungarian and Klingon fixtures for the lexical-upweight rule; recall on the 80-pair / 300-distractor hu/de/en fixture (`dataset.mjs`): e5-small R@5 ≥ 0.80 (hu ≥ 0.85), fused R@5 ≥ dense-alone − 0.02; JS-scan and vec0 results identical on the same fixture; KNN and tokenization execute in the worker (HTTP p99 ≤ 50 ms at 20 rps).

**Phase 3 — Model-assisted extraction, rollups, UI v1 (L, ~3 weeks).** Capture ladder retargeted to the candidate contract (isolated + headless only); heuristic + model rollups at depth 1 (project, project type) and 2 (era); UI views 1–4, tombstone delete, edit-as-version, project-form section, conversation memory tab; CASL `delete`; disclosure line; six languages + handbook de/es parity; `memory_capture_runs` → `memory_run` cutover. **Acceptance:** killing the provider mid-batch leaves ingestion uninterrupted; 100 UI edits leave every L0 hash unchanged; locale parity test green; synthetic load fixture at 50 k/150 k/300 k built.

**Phase 4 — Consolidation, audit, eviction, crypto-shred (L, ~3 weeks).** Light pass in a worker (chunked); heavy pass (k-means, budgeted, 2 % sample, trust recompute); presence tiers + 40 k cap; `memory_fact_archive`; tombstone GC **including the solo-instance case** (an empty peer set compacts on schedule — moved here from Phase 1, which ships the empty `tombstone` table but no compaction routine); DEKs via the secrets provider; scrub + L3 rebuild; `memory_purge_log`; UI views 5–6; nightly consolidator phases and `semantic-promoter.ts` retired; skill-candidate mining moved to skill-evolution. **Acceptance:** heavy pass within budget on the 300 k fixture with a competing job; light pass: reader p99 unchanged **and max reader stall < 100 ms** at 10⁶ rows on the reference pod, WAL < 256 MB throughout, with worker-owned periodic checkpointing (the untested variant from Phase 0 is Phase 4's first measurement); crypto-shred proves unrecoverable ciphertext and scrubbed L1/L2; a solo instance with zero peers compacts its tombstones on schedule; adversarial candidates rejected/quarantined for facts and gist text; eviction bounds the live set under burst writes.

**Phase 5 — R6 (gated on a real second instance; M/L).** Private MCP server outside the tool registry; CASL scopes; Biscuit or JWT per spike; two-engine redaction with `(hash, ruleset)` cache and preview; `isomorphic-git` vault sync; schema-version handshake. **Acceptance:** two local instances sync a tagged subset both ways under the facts-only default, every pulled row re-enters arbitration; a manufactured conflict resolves by HLC-LWW; opt-in gist sync surfaces an unmerged alternate; `revoke_scope` quarantines and rejects foreign revokes; peer-ack compaction validated with intermittently offline peers and the zero-peer case.

**Interim fixes worth doing before Phase 2 (S each):** vector-hydration drop in `memory-service.ts`; `agent/index.ts:979` laziness; the `CORE_IDENTITY` 491/200-token overrun (raise the prefix reserve to 9 000); handbook de/es parity.

---

## 16. Decision points for the owner

| # | Decision | Recommendation | Consequence |
|---|---|---|---|
| 1 | Storage engine under Bun: keep `bun:sqlite` (+ `sqlite-vec` loaded natively, JS-scan fallback) vs. `better-sqlite3` under both runtimes | **Keep `bun:sqlite`** — **the alternative does not exist under Bun** (hard block); sqlite-vec loads natively on the glibc image and is load-bearing for filtered KNN; JS scan is the fallback | `better-sqlite3` is Node-only; its install script must not run in the Bun image |
| 2 | Local embedder: bundle a multilingual quantised model vs. provider bridge only (FTS-only on CLI installs) | **Bundle `multilingual-e5-small`** (MIT), ~136 MB disk / ~0.5 GB RSS; the memory limit rises to 2Gi to hold it (§16-15) | Without it, every CLI-only install has no vector channel; the "no local LLM" rule is about LLMs, not a CPU embedder — ~0.5 GB RSS is the price |
| 3 | L0 ownership of message bytes: own compressed copy vs. reference `conversation_messages` | **Own copy** (~2× text storage, negligible) | Memory survives conversation deletion; `conversation_fts` retires with `related-work.ts` |
| 4 | Tool-result capture timing (D3) | **Phase 1b**, 8 KB cap, `ingested` trust; attachments deferred | Until 1b, L0 is text-only as D3 stated |
| 5 | Vault role: capture sink (status quo) vs. human layer + import + optional generated mirror | **Human layer + mirror** | Machine notes stop appearing as new markdown unless the mirror is on; Obsidian users keep their files |
| 6 | Ship read-only drill-down tools (`memory_search`/`memory_expand`) or automatic injection only | **Ship with guardrails**; measure invocation rate | Omitting them removes legitimate follow-up; CLI providers may never call them anyway |
| 7 | Trust tier of data-port imports (264 `reference` notes today): `owner` vs. `ingested` | **`owner`** for imports the owner performed; bulk "trust" action in the UI | `ingested` would down-weight most of today's memory by 0.6 from day one |
| 8 | Background model calls on CLI-only installs: piggyback on live sessions (judge-panel design) vs. none; heavy-pass budget default | **No piggyback; budget 0** until a capable provider is configured, then an onboarding prompt | grok/kimi-only installs stay at heuristic quality, disclosed in the UI; claude-code and API providers get full quality |
| 9 | Injected-token reserve declared in `SectionBudget` (900 / 1 200 / 1 500) and the prefix reserve | **1 200**, prefix reserve 9 000 (also fixes `CORE_IDENTITY`) | Other sections shrink slightly on small-context models; view 4 makes it visible |
| 10 | Migration: full historical L1/L2 extraction in Phase 1 vs. L0 backfill + queue vs. leave legacy data outside | **L0 backfill + queue** | R1 holds for pre-cutover history; old history's gists arrive gradually |
| 11 | `memory_blocks` (0 rows, on no persona) and `team_memory` fate | Retire blocks; team memory stays a run blackboard whose promotion writes L0 + a task gist | Letta-style blocks return, if ever wanted, as pinned `global` gists |
| 12 | R6 gist policy default | Facts-only, `sync_gists` opt-in | Teammates converge on facts, not on each other's prose |
| 13 | R6 tokens: Biscuit vs. JWT + revocation list | Biscuit, JWT as the spike fallback | Offline attenuation vs. simplicity |
| 14 | Crypto-shred partition default | Per conversation; per-project opt-in for finer | Finer partitions reduce blob dedup |
| 15 | K8s resources for the memory subsystem (in-process embedder) | **requests `memory: 1Gi` / limits `2Gi`, CPU `500m` / `2`** in both `deploy/k8s/deployment.yaml` and `deploy/k8s/helm/eyas/values.yaml`; `512Mi/1Gi` kept only as the documented bridge-embeddings profile; size on cgroup numbers, not `process.memoryUsage().rss` | `docker stats` peak 551–558 MiB already exceeds today's 512Mi limit. Required manifest change (Phase 1, not applied here): raw `deploy/k8s/deployment.yaml:36-40` requests `cpu: 200m / memory: 256Mi` → `cpu: 500m / memory: 1Gi`, limits `cpu: 500m / memory: 512Mi` → `cpu: "2" / memory: 2Gi`; Helm `deploy/k8s/helm/eyas/values.yaml:150-155` requests `500m / 512Mi` → `500m / 1Gi`, limits `"1" / 1Gi` → `"2" / 2Gi` |
| 16 | Bun runtime image tag | **Pin the image tag/digest to the project's Bun** (`oven/bun:1.3.10-slim`); `oven/bun:1` = 1.4.0 today | SQLite version and the FTS planner follow the Bun version (3.51.2 → 3.53.2 between 1.3.10 and 1.4.0, Node ABI 147); a CI capability job catches drift |
| 17 | Background model cost on CLI-only installs | Accept the CLI default model (`claude-opus-4-6[1m]`, ~$0.015 / ~8 s per 20-line batch) **or** allow an owner-set alias for the isolated path only | Cost is recorded per run (`cost_usd`, `duration_api_ms`) either way; an alias trades quality for spend without touching the live session's model |

---

## 17. Risks specific to this codebase

| Risk | Mitigation |
|---|---|
| Boot order: `ModuleLoader` orders by hard deps only; new hooks straddle memory's registration | Lazy buffered `ctx.memoryIngest`; regression test in the style of `conversations/memory-hooks-lazy`; fix `agent/index.ts:979` in the same wave |
| Prompt budget: today's memory blocks are budget-exempt; `CORE_IDENTITY` already overruns | One declared section; reserve 9 000; view 4 shows the real total |
| CLI providers never execute registry tools (F1.2) | Injection carries the full load; drill-down is a bonus; the critic never penalises its absence |
| ACP providers (grok/kimi) cannot be isolated (F1.3) or enforced (F1.6) | Background model work only on isolated + headless providers; ACP installs are chat-only for memory purposes, documented in six languages |
| God Mode branch skips capture | Capture at the persistence layer; regression test |
| i18n volume (~200 keys × 6) and handbook drift | CI parity test; handbook generated from one English source per wave |
| Extension loading varies by image | `eyas doctor` runs the vec0 self-test (not just `vec_version()`); JS-scan fallback; **glibc image pinned to the project's Bun**; musl unsupported; `libsqlite3` irrelevant on Linux |
| Migration idempotency, mixed timestamp formats, imports present twice | Deterministic ULIDs, `INSERT OR IGNORE`, partition-scoped dedup, vault keyed on `file_hash`, dry-run gate |
| Two retrieval stacks during cutover | `memory.engine` is exclusive; both call sites read one accessor |
| New infrastructure (worker threads, zstd, ONNX) on 1–2 vCPU | Phase 0 numbers before Phase 2/4 commit; per-job CPU hint the scheduler can honour later |
| Hungarian-language recall with an English-centric embedder | Multilingual model spike is a Phase 0 gate, not an afterthought |
| **Bun tag drift** (1.4.0: SQLite 3.53.2, Node ABI 147) | Pin + CI capability job |
| **WAL checkpoint starvation** under a bulk writer | Worker-owned checkpointing + WAL-size assertion |
| **K8s memory limit below the embedder's footprint** | 1Gi/2Gi defaults; bridge profile documented |
| **grok-cli reaches host memory (incl. the Obsidian vault) in headless mode** | Never eligible for background work; UI disclosure |
| **ORT thread oversubscription in cgroups** | Pin `intraOpNumThreads` |
| **sqlite-vec int8 binding trap** | `vec_int8(?)` everywhere; self-test covers insert + KNN |
