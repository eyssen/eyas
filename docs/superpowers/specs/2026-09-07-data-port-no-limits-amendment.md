# Data-port import — "No limits" amendment (R11)

**Amends:** `2026-09-06-data-port-lossless-import-design.md` (spec) and its plan. Where this document conflicts with the spec, the plan, or any earlier ruling in `.superpowers/sdd/2026-09-06-data-port-lossless-import/plan-amendments.md`, **this document wins**.

**Owner rule (verbatim, 2026-09-07):** "Nincsen limit! Mindent fel kell térképezni és mindent be kell tölteni hiánytalanul, akkor is, ha az enyémnél sokkal nagyobb memória van egy gépen. Ha olyan döntés volt, hogy valamit ne töltsünk be, az hibás döntés volt."

## R11 — No limits, nothing left out

1. **No caps.** No file-count cap (the 2500 candidate cap is removed), no per-file size cap for text (the 4 MiB / 50 MiB limits become *warnings*, not skips), no total-bytes cap. A scan of a tree ten times larger than the owner's must still list and import everything; the cost is time and disk, never omission.
2. **Map everything under the root.** The home-directory "keep-list" (assistant folders + Obsidian ai-memory only) is removed. The walker visits every directory under the root. Only directory *classes* that can never hold the owner's memory are not descended (`node_modules`, `.git`, `.cache`, `__pycache__`, `dist`/`build` outputs, browser profiles, OS trash) — and each such directory is still **mapped as one visible row** with its file count and a reason code (`directory-skipped:<class>`), so nothing is hidden. Symlinked directories are followed (real-path de-duplicated).
3. **Everything text is importable and selected by default.** Every text file becomes a candidate with a kind. The default selection is *all* candidates except rows that have no text content at all (`binary`, `derived-index`, `app-state` such as sqlite caches, browser profile blobs). In particular these are now **selected by default**:
   - Claude Code `*.jsonl` transcripts, Cursor agent transcripts, Codex rollouts → episodic (rendered by the existing chat-export renderers, one episodic record per session).
   - Obsidian `99_Meta/claude-sessions/**` and any note with `type: claude-session | grok-session` → episodic session summaries (the same treatment as Grok's `sessions/*.md`).
   - Legacy memory folders `memory.local-backup-*`, `memory.old`, `*.bak` markdown → memory notes tagged `legacy` (slug collision → `-2` sibling, never dropped).
   - The owner's own docs (`~/.claude/docs`, Desktop/Documents markdown, Obsidian `10_Projects`, `20_Areas`, every vault folder) → memory notes (kind from `type:`, else `reference`).
   - Third-party product docs (e.g. `.grok/docs/user-guide`) → memory notes with tag `third-party` (visible, selected; the owner can untick them in the wizard).
   - Rule files anywhere under the root, including `**/.cursor/rules/*.mdc`, `.cursorrules`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `global_rules.md` inside repos → proposals.
   The `not-durable` and `transcript` reason codes no longer unselect anything; they remain as informational labels.
4. **Secrets are stored, never dropped.** A file that the secrets heuristic flags is imported **verbatim** and tagged `contains-secrets` (note tag / skill capability / episodic tag). Safety is a *recall* measure, not an import measure: notes tagged `contains-secrets` are excluded from the always-on memory index and from `search_memory` results **by default**, with an owner toggle `memory.recall.includeSecrets` (default `false`) documented in six languages. Skill assets flagged as secrets are written to the asset directory and inlined like any other asset. The heuristic itself is corrected so that code calling a lookup (`keychain_lookup(...)`, `os.environ[...]`, `getenv(...)`) and documentation placeholders (`"your-…"`, `<…>`, `xxx`) are not flagged.
5. **Whitespace is preserved.** Bodies are written byte-for-byte including leading and trailing blank lines (the trailing-newline normalisation of the vault writer is the only permitted change, and it is documented).
6. **Provenance per item.** Every applied item records the adapter that read it (`source.adapter` / `source:<adapterId>` tag — a Grok summary imported under an auto-detected `claude-code` job is tagged `grok-cli`), all alias paths, and the content sha256 in the ledger for **every** kind (vault, episodic, skill, skill-assets, agent, proposal).
7. **Scale.** Candidates are stored in a table (`data_port_candidates`, one row per candidate, indexed by scan/kind/reason/path) instead of a single JSON blob; the API pages and filters them (`?kind=&reason=&folder=&selected=&offset=&limit=`) and returns per-kind / per-folder / per-reason counts; the wizard renders a grouped, virtualised tree with "select all importable" / per-group toggles and never loads the whole list into memory. The runner streams items (never holds all bodies at once), commits in batches, yields to the event loop, reports progress per 100 items, rebuilds the index once at the end, and survives tens of thousands of items and hundreds of megabytes of transcripts. Scan time and import time are reported; nothing is truncated to make them shorter.
8. **Idempotent and additive.** Re-running the same scan+import after this amendment adds only what is new; already-imported items stay `unchanged` (content-sha). The owner's existing live import is not rolled back; the next import completes it.

## Decisions taken with stated assumptions (owner may override)

- **D-7 Secrets recall exclusion (assumption):** stored verbatim (R11.4) but hidden from model-facing recall by default. If the owner wants credentials visible to the model, set `memory.recall.includeSecrets: true`.
- **D-8 Default selection scope (assumption):** "everything text" is selected by default, including third-party docs and source-code markdown; the wizard makes unticking a group one click. Code source files (`.ts`, `.py`, …) inside repos are mapped and importable but **not** selected by default, because they are not memory or instructions — the owner can tick them.
- **D-9 Directory classes never descended** (mapped as one counted row each): `node_modules`, `.git`, `.hg`, `.svn`, `.cache`, `__pycache__`, `.venv`/`venv`, `dist`, `build`, `out`, `.next`, `.turbo`, `target`, browser profile directories (Chrome/Chromium/Firefox/Antigravity profile roots), `.Trash`, `Library/Caches`, `.DS_Store`. Nothing else.

## Out of scope

Model-based classification (still none), automatic secret rotation, and importing binary media into memory.
