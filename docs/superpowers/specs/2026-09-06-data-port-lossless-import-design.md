# Data port — lossless import — design

**Status:** draft for owner approval, 2026-09-06.
**Trigger:** the first live import (job `01M1V2C113X40EDN07HDHXJBV7`, scan root `/Users/eyssen`, 296 items) applied 294 items with 0 errors and still lost content at four independent stages. The owner's ruling: *the importer must import 100 % of everything, file it into EYAS's own layers correctly, and not lose a single word or instruction.*
**Lineage:** `2026-08-27-durable-memory-design.md` (M1 recall: kinds, index, scope), `2026-09-03-sovereign-layered-memory-design.md` (layers), memory-sovereignty rule (import is one-way; the source is never a live store; `inferKind` never invents `user`).
**How it was produced:** a read-only audit of the live instance (files, DB, log, code at `c868ca4`), 17 adversarial verifications (two lenses per high-impact claim), a three-angle remediation panel with a judge and a completeness critic, then this reconciliation. Numbers below were reproduced by re-running the real functions against the real data.
**Cross-check with the panel:** the judge's recommended backbone (frontmatter-faithful deterministic re-import, provenance, stable file names, primary-agent proposals, index budget key) is this design. The judge would defer the rollback endpoint (§4.7) and the persona target (§4.6) to a later wave; they stay here because the owner's ruling is "everything, losslessly" and a re-import on the live instance is only safe with a rollback. The critic added three facts folded in below: the Grok per-project `sessions/*.md` files are structured Grok-only memory (438 notes, not transcripts); `AGENTS.md` is clipped to ≈ 3 200 chars in the prompt (§4.5, decision D-6); source modification times are the only recency signal and must be kept (§4.2).

---

## 1. What went wrong (verified)

| # | Stage | Defect | Effect on the live import |
|---|---|---|---|
| D1 | scan (`scan-path.ts:383,418`) | file read capped at 12 512 bytes, content clipped at 12 000 chars, cut can land mid-UTF-8 | 21 memory notes and `CLAUDE.md` clipped before anyone saw them; 315 056 chars lost here |
| D2 | transform (`transform.ts` fallback) | selection > 48 items → deterministic fallback: body `.slice(0, 4000)`, `kind: reference` for all, `description` discarded, summary = first 160 chars, `links: []`, tags only `imported` | 98/276 notes truncated (331 970 more chars), 276/276 `reference`, feedback rules rank below client tickets, always-on index shows 14 alphabetical notes and hides 262 |
| D3 | scan (`heuristics.ts:113`) | "index file" heuristic = bullet ratio ≥ 0.6 → noise 0.95 → not even a candidate | 9 real notes never shown, never importable (`feedback_odoo_means_eyssen_community_fork`, `project_eyas_board_design`, …); wikilinks to them dangle |
| D4 | everywhere | frontmatter stripped with `/^---[\s\S]*?---\s*/m` (flag `m`) | on frontmatter-less notes the text between two `---` rules is deleted (668 and 415 chars in two live notes) |
| D5 | skills | body `.slice(0, 6000)`; frontmatter `name`/`description` (the trigger vocabulary) discarded; `references/` and `scripts/` not bundled; `SKILL.md` without H1 titled "SKILL" | 10/18 skills cut mid-sentence; 2 rows named "SKILL"; `scripts/…` pointers to nothing |
| D6 | rules | proposal target = first *addressable* agent by name → **Code Reviewer**, not the primary assistant; `approveProposal` merges onto a stale snapshot → second approval overwrote the first | Jarvis got nothing; Grok rules exist only in `.history/`; `CLAUDE.md` arrived clipped and spliced |
| D7 | apply (`apply.ts:137`) | slug collision suffix = first 6 chars of a ULID (same for ~17 min) | a re-import overwrites its own duplicate; two notes with the same 60-char slug in one job collide silently |
| D8 | — | no rollback; applied refs not persisted | a clean re-import needs manual file deletion |
| D9 | scan | 161 skipped files summed into one number the UI never renders | loss invisible |
| D10 | scan | `~/.claude/agents/*.md` personas classified as junk (frontmatter looks like a note outside a memory path) | 5 personas not importable |
| D11 | scan | session notes hard-skipped (`claude-sessions/`, `type: grok-session`), `.grok/memory/*/sessions/` dir skipped | 859 vault session notes and 447 Grok session summaries unreachable |
| D12 | AI path (≤ 48 items) | model rewrites the body ("max ~400 words"), may `skip`, runs non-isolated on the first registered CLI provider, privacy wrapper can block a note outright → silent fallback | the "better" path is lossy too and unreliable on the live instance |
| D13 | recall | `kind: project` without a project id is excluded from index, `search_memory` and related-work | an import that assigns declared kinds faithfully would make client notes *vanish* unless scope semantics change |

Also verified, not import defects but relevant to "as effective as before": the always-on index budget is 2 400 chars (≈ 14 lines); `vault_index.content_text` drops fenced code blocks, so `search_memory` returns less than the file for 24 notes; FTS is unicode61 without stemming.

## 2. Requirements

| # | Requirement |
|---|---|
| R1 | **Verbatim.** Every selected file's full text reaches its EYAS layer unchanged: no size cap, no rewriting, no sanitising, no model-authored body. |
| R2 | **Nothing silent.** Every scanned file is either a candidate the user can select or a visible "skipped" row with a reason. |
| R3 | **Faithful layering.** Declared metadata decides the layer: note `type` → EYAS `kind` and tier/folder exactly as EYAS's own capture writer files notes; skills → skills with their whole package; rules → the primary assistant's workspace; personas → agent definitions; sessions → episodic. |
| R4 | **Provenance kept.** The original frontmatter, path, hash and time travel with the note (`source:` map) even where EYAS has no typed field. |
| R5 | **Links survive.** The vault file name is the source file name, so `[[old_slug]]` resolves; `aliases` cover the rest. |
| R6 | **Deterministic first.** No model call is needed for any Claude Code / Obsidian / Grok note; the model is optional metadata enrichment for *undeclared* notes only, never for bodies, never a gate. |
| R7 | **Idempotent and reversible.** Re-running an import skips unchanged items; every job can be rolled back. |
| R8 | **Recall sees it.** Imported kinds are visible to the index, `search_memory` and related-work without a project mapping the owner does not yet have. |
| R9 | Product rules: no machine paths or tenant text in source; six-language UI strings and docs; vitest coverage; no version bump; dev checkout only. |
| R10 | **Any provider.** Memory, rules, skills, personas and sessions from any assistant (Claude Code, Grok CLI, Cursor, Codex, Gemini CLI, Windsurf, Copilot, ChatGPT/Claude.ai exports, Obsidian, plain markdown) import through one adapter registry; a new provider is one adapter file plus a fixture test. Sources that are the same file reached by several paths (the merged Obsidian vault) become one note with all paths recorded. |

## 3. Non-goals

- A live mount of `~/.claude`, `~/.grok` or the Obsidian vault (sovereignty rule). Import stays one-way; the source is not read after the job.
- Grok `index.sqlite` embeddings and Claude Code `*.jsonl` transcripts — derived/raw artefacts; the markdown session notes *are* the memory.
- Recall redesign (stemming, vector search, code-block indexing). Two recall knobs are included because R8 fails without them (§4.8); the rest is listed under follow-ups.

## 4. Design

### 4.1 Scan — full files, exhaustive candidate list

- `MAX_FILE_BYTES` → 4 MiB. Files above it become *visible* noise rows ("too large"), never a silent skip.
- The scan no longer stores file contents in `data_port_scans.candidates_json`. A candidate carries `sourcePath` (absolute, server-side only — stripped from API responses), `bytes`, `sha256`, `mtime`, `preview` (280 chars for the UI). Apply re-reads the file from disk (path scans and upload extracts both live on disk under `data/tmp/data-port/<scan>/`). If the hash changed between scan and apply the file is still imported and tagged `source-changed`. This removes D1 and makes 80 MB session corpora importable.
- **Every** skipped file is emitted as a candidate with `kind: noise`, `target: none`, `selectedByDefault: false` and a reason (binary, lockfile, secrets, too large, unreadable, outside root). The existing "Skipped / noise" group therefore lists them; the counts stay in `stats`. (R2)
- Index detection is **basename `MEMORY.md` only**. The bullet-ratio heuristic is deleted. An index file is a candidate of kind `index`, target `vault.semantic`, selected by default, and is imported as *one* note (§4.2) — never exploded, never dropped. (D3)
- Session material becomes importable, in two classes (D11): (a) **Grok per-project memory** `.grok/memory/<project>/sessions/*.md` — structured summaries ("Decisions & rationale / Technical context / Problems & solutions", 438 files, 1.8 MB) — kind `session`, target `episodic`, **selected by default**, tagged `grok-project:<dir>`; (b) **transcript notes** (`claude-sessions/`, frontmatter `type: claude-session|grok-session`; 845 files, 81 MB) — kind `session`, target `episodic`, **not** selected by default (owner decision D-3). `sessions` leaves the AI-dot skip list for `.grok/memory/` only.
- Personas: markdown with frontmatter under `.claude/agents/`, `.grok/agents/`, `.agents/agents/` → kind `persona`, target `agent`, selected by default. (D10)
- Skill packages: a `SKILL.md` candidate lists `assets` — every non-binary file under its directory (`references/**`, `scripts/**`, `*.txt`, `*.yaml`, …; excluding `__pycache__`, `*.pyc`, `.DS_Store`, > 4 MiB). Assets are not separate candidates; the UI reason reads "+N bundled files". A markdown file under an assistant `skills/` tree that is not inside a `SKILL.md` directory stays a standalone skill, as today. `SKILL.md` title fallback = parent directory name. (D5)
- One shared `splitFrontmatter(raw)` (gray-matter, **leading** block only) replaces the four regex copies. (D4)
- Rules/identity/tools detection unchanged; content is now the full file.

### 4.2 Memory notes — deterministic, faithful mapping

For a note whose frontmatter is Claude Code memory (`name`, `description`, `type` or `metadata.type`), Obsidian (`tags`, `aliases`, `created`) or Grok (`node_type: memory`, `originSessionId`, `modified`):

| EYAS field | Rule |
|---|---|
| body | the whole markdown after the leading frontmatter, verbatim (R1) |
| `kind` | `kind` \| `type` \| `metadata.type` if ∈ {user, feedback, project, domain, reference}; otherwise `reference` (never `user` by inference) |
| folder / `tier` | the capture writer's rule (`note-writer.ts:66`): `feedback` → `procedural/` (tier procedural); `user`, `reference` → `semantic/`; `project` → `projects/<id>/` when a project id is declared or mapped, else `semantic/` with `kind: project` unscoped; `domain` → `project-types/<id>/` or `semantic/` likewise |
| file name | the source basename, sanitised to `[A-Za-z0-9._-]` — so every `[[old_slug]]` in every other note resolves (R5); fallback `slugify(title)` |
| `title` | frontmatter `title` \| first `# H1` \| `name` \| basename |
| `aliases` | `name`, basename without extension, title — deduped, minus the file name |
| `summary` | `description` \| the note's MEMORY.md hook \| first non-empty body line (stored in full; the index clips at 140 chars at read time) |
| `tags` | source tags + `imported`, `source:<profile>`, `import-job:<id>`, `index-section:<slug>` (from MEMORY.md), `source-changed`, `pii:possible` (enrichment flag, never a skip) |
| `links` | wikilink targets extracted from the body |
| `created` / `updated` | `created` \| `date` \| file birthtime; `metadata.modified` \| `updated` \| mtime |
| `source` | provenance map: `{ profile, path, name, type, description, frontmatter: <original YAML object verbatim>, sha256, mtime, indexHooks, indexSection }` — on disk for good even though `parseVaultFile` ignores unknown keys (R4) |

Collision rule (D7): identical body at the target path → `unchanged` (counted, not written; idempotent re-runs). Different body → `<name>-2.md`, `-3.md`… (free-path loop as in `note-writer.ts:196`) and tag `conflict-with:<path>`. Never overwrite.

`MEMORY.md` (kind `index`): imported as one note `semantic/memory-index-<profile>.md`, kind `reference`, tag `index`, summary "Imported one-line memory index (N entries)". A pre-pass over the selection parses its `- [hook](file.md)` items (several per line, `·`-separated) and `##` sections; each hook and section is merged into the matching note's `summary` fallback, `source.indexHooks`, `source.indexSection` and an `index-section:` tag. Nothing in the index is lost, and its curated one-liners become the note summaries where the note has no `description`.

Sessions (kind `session`): `episodic.create({ content: verbatim, sourceType: 'system', sourceId: 'import:<job>', tags: [...frontmatter tags, imported, source:, import-job:, session:<id>], validFrom: frontmatter date/time })`.

### 4.3 AI enrichment — optional, metadata-only, never a gate (D12)

- Runs only when a model is available, the candidate has **no declared kind**, and the selection is ≤ `AI_ITEM_LIMIT` (48). It may return `kind` (clamped; `user` is not accepted from inference), `summary_one_line`, `tags`, `links`. **The body is never taken from the model.** `skip` is ignored for user-selected items; `pii_risk` becomes a tag.
- The classify pass runs only on `unknown` / `knowledge` candidates.
- Any failure yields the deterministic result; the job stats show `aiEnriched` and `aiFallback` counts so the owner can see which path ran.

### 4.4 Skills — the whole package, verbatim (D5)

- `name` = frontmatter `name` \| directory name; `description` = frontmatter `description`, full; `trigger_patterns` = quoted phrases in the description ("…", „…", '…'), the name, the name with `-`/`_` → space, the H1; `capabilities` = frontmatter `capabilities`/tags + import tags; `skill_type: knowledge`; category `own/<name>`.
- `content` = `SKILL.md` body verbatim, then a `## Bundled files (imported verbatim)` section holding every asset in full — markdown inline, other files fenced with a language by extension — and one line naming the on-disk copy.
- Assets are also written to `data/skills/imported/<name>/<relPath>` (mode preserved for `*.sh`/`*.py`) so `run_command` can execute them; the content states that path.
- Same name and identical content → `unchanged`; same name, different content → new row tagged `conflict`.

### 4.5 Rules → the primary assistant, appended without loss (D6)

- Default proposal target: `enabled = 1 AND tier = 'primary' ORDER BY created_at ASC LIMIT 1` (Jarvis), then addressable, then any. Proposal rows keep `agent_id`; the API adds `agentName`; the UI shows the target agent.
- `approveProposal` re-reads the **current** workspace file at approval time and appends `\n\n---\n\n## Imported: <title> (<source path>)\n\n<full body>\n`. Two approvals both survive. A source frontmatter block, if any, is kept as a fenced `yaml` block at the top of the section.
- **Prompt window (verified, not an importer defect):** the workspace loader reads at most 12 000 bytes per file (`workspace-loader.ts:32`) and the cache-prefix builder gives `agent-notes` 800 tokens ≈ 3 200 chars (`token-budget.ts:34`) inside a prefix that is already at 8 400 of 8 800. The appended rules are therefore complete on disk but only their first ≈ 3 200 chars reach the model. The proposal card states this. What to do about it is owner decision D-6.

### 4.6 Personas → agent definitions (D10)

- `parsePersonaMarkdown(content, stem)` is extracted from `persona-import.ts` and shared with `agent.importRoots`.
- id = frontmatter `id` \| `name` \| stem; `name`; `description`; role = description; `systemPrompt` = body verbatim; `tools` mapped by a name table (Read → `read_file`, Write → `write_file`, Edit → `edit_file`, Bash → `run_command`, Glob → `glob`, Grep → `grep`, WebSearch/WebFetch → `research`; unknown names dropped with a logged warning; an empty result **omits** `tools` so the agent keeps the default toolset instead of running tool-less); tier `specialist`; `agentType` by keyword (developer/engineer → developer, review/qa/test → reviewer, critic/advocate → critic, research → researcher, owner/plan/product → planner, else assistant); source `user`; tags `imported`, `source:<profile>`, `import-job:<id>`; enabled, not addressable (owner flips in the UI). Original tool names are kept in `source` provenance via tags `claude-tool:<Name>`.
- Existing id with identical prompt → `unchanged`; different → `<id>-2`, tag `conflict`.

### 4.7 Rollback (D8)

- New table `data_port_applied (id, job_id, kind, ref, source_path, created_at)` — one row per applied vault path, episodic id, skill id (+ asset dir), agent id, proposal id.
- `POST /api/v1/data-port/import/jobs/:id/rollback`: deletes vault notes (`vault.delete` + `indexer.indexAll()` + `removeStale()`), episodic rows, skill rows (`source = 'user'`) and their asset dirs, agent definitions (`source = 'user'`); for **approved** proposals removes the exact appended section from the current file (history snapshot first); pending proposals → rejected. Job status → `rolled_back`, stats recorded, idempotent, refused unless the job is `completed` or `failed`.
- UI: "Roll back this import" on the done step and on a "Previous imports" list (last 5 jobs) on the card, with a confirm.

### 4.8 Recall consistency (R8, D13)

- `vaultNoteInScope`: a `project` or `domain` note **without** a project / type id is global (visible everywhere, ranked at its kind); a scoped one stays scoped to its project. One helper → index, related-work and `search_memory` agree. Tests `memory-index.test.ts:88,119` and `search-scope.test.ts` are updated to the new rule. **Owner decision D-2.**
- `memory.index.budgetChars` (config, default 2 400 — unchanged) so the owner can widen the always-on index on the live instance (suggested 8 000, ≈ 2 000 tokens/turn) and have every user + feedback line in every turn. **Owner decision D-1.**

### 4.11 Provider adapters — any assistant's memory, one registry

**Why.** Today the source profile is a closed enum (`claude-code | cursor | obsidian | generic-md | chat-export | eyas-export | auto`) and every rule about paths, frontmatter and formats is inlined in `heuristics.ts`. Adding a provider means editing the core. The owner's requirement is that *any* provider's memory can be imported.

**Shape.** `src/modules/data-port/adapters/<id>.ts` + `adapters/registry.ts`. An adapter declares:

- `id`, `label` (i18n key), `rootHints` (paths shown in the wizard), `detect(paths) → 0..1` (used by `auto`; every adapter runs, the strongest wins the profile label, all keep classifying),
- `classify(file) → hint | null` (kind, target, confidence, reason, selectedByDefault — specific adapters answer first, the generic one last),
- `parse(file) → SourceNote` (verbatim body, declared kind, title, summary, tags, aliases, links, created/updated, the original metadata object, session id) — the single object §4.2 maps into EYAS fields.

Shared parsers the adapters compose: markdown + leading frontmatter (gray-matter), JSON chat exports (shape-detected message lists), JSONL event streams (role/message), and read-only SQLite (`bun:sqlite`, `?mode=ro`) for providers that keep memory in a database. Adding a provider = one adapter file + one fixture test; no change to scan, apply or the UI (the profile list is built from the registry; labels ×6 languages).

**Adapters in this change** (status = what was verified on the owner's machine on 2026-09-06):

| Adapter | Reads | Lands as | Status |
|---|---|---|---|
| `claude-code` | `~/.claude/CLAUDE.md`; `projects/*/memory/*.md` + `MEMORY.md` (auto-memory, `type`/`metadata.type`, `description`); legacy `~/.claude/memory/*.md`; `skills/*/SKILL.md` + dir; `agents/*.md`; `commands/*.md` (→ skill); `projects/*/*.jsonl` transcripts (`type: user|assistant`, `message.role`) | memory / skill / persona / rule / session | verified (all present) |
| `grok-cli` | `~/.grok/AGENTS.md`; `memory/*.md` (here: symlinks into the vault); `memory/<project>/MEMORY.md` + `sessions/*.md` (structured summaries); `skills/`; `index.sqlite` = derived, noise with reason | memory / rule / session (summaries **on** by default) | verified |
| `obsidian` | any vault; `ai-memory`-style notes; `claude-sessions/` notes (`type: claude-session|grok-session`) | memory / session | verified |
| `cursor` | `.cursor/rules/*.mdc` (`description`, `globs`, `alwaysApply`); `.cursorrules`; `~/.cursor/skills-cursor/*/SKILL.md`; `~/.cursor/projects/*/agent-transcripts/*.jsonl` (`role`, `message.content[].text`) | rule (globs kept in the section header) / skill / session | verified (`~/GitHub/.cursor/rules/odoo18-dev.mdc`, transcripts) |
| `codex` | `~/.codex/AGENTS.md`; `memories_*.sqlite` (`stage1_outputs.raw_memory`, `rollout_summary`, `rollout_slug`, `source_updated_at`); `sessions/**/rollout-*.jsonl` (`session_meta`, `response_item` message user/assistant); `skills/`; `config.toml` = noise | memory (from SQLite) / rule / session | layout + schema verified (0 memory rows on this machine) |
| `gemini-cli` | `~/.gemini/GEMINI.md`, project `GEMINI.md` (global memory + rules); Antigravity `knowledge/`, `brain/`, `*.pb` = noise with reason | rule | layout verified (file empty here) |
| `windsurf` | `~/.codeium/memories/global_rules.md`; `~/.codeium/windsurf/memories/*.md`; `windsurf/workflows/*.md`; repo `.windsurf/rules/*.md` | rule / memory / skill | layout verified (memories dir absent here) |
| `copilot` | `.github/copilot-instructions.md`; `.github/instructions/*.instructions.md` (`applyTo`); `.github/agents/*.agent.md` | rule / persona | documented shape only — fixture test, flagged "unverified" in the label |
| `chat-export` | ChatGPT `conversations.json` (`mapping` tree, `message.author.role`, `content.parts`); Claude.ai `conversations.json` (`chat_messages[].sender/text/created_at`); generic `[{role, content}]` JSON/JSONL; Mem0-style `{memories:[{memory|text, created_at}]}` | session (one episodic row per conversation, reversible markdown rendering: `**user:**` / `**assistant:**` turns verbatim, non-text parts as fenced JSON) / memory | documented shapes only — fixture tests, "unverified" label |
| `eyas-export` | `manifest.json` + `vault/` | as exported | existing |
| `generic` | any `.md`/`.txt` with optional frontmatter (`type`, `kind`, `description`, `tags`, `aliases`, `created`); only when the profile is `generic` or the scan root is not a home directory | memory `reference` (declared kind honoured) | existing behaviour, now last in the chain |

**Merged sources are one note.** Beyond the existing realpath dedupe, files with the same SHA-256 reached by different paths (the Obsidian vault via `~/.grok/memory/*` symlinks and via `~/.claude/projects/*/memory`) are one note with every path recorded in `source.paths[]`. Session material with the same session id but different content (a Grok native summary and the vault's `grok-session` note) is kept twice and linked by the tag `session:<id>`.

**What this machine looks like (verified 2026-09-06):** the Obsidian vault `99_Meta/ai-memory` *is* the merged Claude + Grok durable memory — all 10 `~/.claude/projects/*/memory` symlinks and all 285 `~/.grok/memory/*.md` entries point into it; the one non-symlinked Claude project memory dir is empty; the only stray file is the legacy `~/.claude/memory/eyssen-odoo-development.md` (2026-03-14, superseded by the vault). Not merged: Grok's per-project `sessions/*.md` (295 session ids, 94 of them absent from the vault) and Codex/Cursor transcripts. The adapters above cover all of it.

### 4.9 Visibility and stats

Job stats: `processed, applied, unchanged, proposals, skipped (with reasons), errors, aiEnriched, aiFallback, byKind`. Scan stats unchanged in shape; the skipped files are now rows.

### 4.10 UI, i18n, docs, tests (R9)

- Web card: kinds `session`, `persona`, `index`; "+N bundled files"; target-agent badge on proposals; "Roll back this import" + confirm + result; stat `unchanged`; previous-imports list. All strings in `en, hu, de, es, fr, tlh`.
- Docs (six languages): `admin/data-port.md` (what lands where, nothing skipped, rollback, sessions off by default, AI optional), `knowledge/memory.md` (unscoped project notes are global; index budget key), `deploy/configuration.md` (`memory.index.budgetChars`). `CHANGELOG.md` under *Unreleased*. No version bump.
- Tests (vitest): one fixture tree per adapter (synthetic, no tenant text) asserting detection, classification and the parsed `SourceNote` (declared kind, summary, dates, session id); merged-path dedupe (three paths, one note, `source.paths` = 3); heuristics (no index false positive; sessions → episodic; SKILL.md dir title; personas), scan (full read, skipped rows, assets, hash), frontmatter split (rules-with-`---` regression), apply-memory (kind → folder/tier, verbatim body, basename slug, aliases, hooks merge, free-path, unchanged), transform (model output never replaces body; declared kind wins), skills (package assembly, triggers from description, assets on disk), proposals (primary target, append re-reads, two approvals survive), personas (tool map, empty tools omitted), rollback (every kind, idempotent, proposal section removal), memory-index/search scope (unscoped project global; scoped stays scoped), config (`index.budgetChars`).

## 5. Layer map (source → EYAS)

| Source | EYAS layer | Where |
|---|---|---|
| note `type: user` | vault, kind `user` | `data/vault/semantic/<name>.md` |
| note `type: feedback` | vault, kind `feedback`, tier procedural | `data/vault/procedural/<name>.md` |
| note `type: project` | vault, kind `project` (unscoped, global) or `projects/<id>/` when mapped | `data/vault/semantic/<name>.md` |
| note `type: reference` / undeclared | vault, kind `reference` | `data/vault/semantic/<name>.md` |
| `MEMORY.md` | one vault note, tag `index`; hooks merged into notes | `data/vault/semantic/memory-index-<profile>.md` |
| session notes (Claude + Grok) | episodic tier | `episodic_memories` |
| `SKILL.md` + directory | skill (own) with bundled files; assets on disk | `skills`, `data/skills/imported/<name>/` |
| standalone skill `.md` | skill (own) | `skills` |
| `CLAUDE.md`, `AGENTS.md`, `TOOLS.md`, `SOUL.md`, `IDENTITY.md` | proposal → primary assistant's workspace file | `data/agents/<primary>/…` |
| `.claude/agents/*.md`, `.github/agents/*.agent.md` | agent definition (source user) | `agent_definitions` |
| Cursor `.mdc` / `.cursorrules`, `GEMINI.md`, Windsurf `global_rules.md` / `.windsurf/rules`, Copilot instructions | proposal → primary assistant's `AGENTS.md` (and D-6 type prompt); `globs` / `applyTo` kept in the section header | `data/agents/<primary>/AGENTS.md` |
| Codex `memories_*.sqlite` rows, Windsurf memories, Mem0-style JSON | vault, kind `reference` (declared kind honoured) | `data/vault/semantic/` |
| Grok `sessions/*.md` summaries; Claude Code / Codex / Cursor transcripts; ChatGPT / Claude.ai exports | episodic tier (summaries on by default, transcripts off — D-3) | `episodic_memories` |

## 6. Owner decisions

| # | Question | Recommendation |
|---|---|---|
| D-1 | Add `memory.index.budgetChars` (default 2 400 unchanged) and set it to 8 000 in the live `config/local.yaml`? | yes — without it only ~14 of the user + feedback lines are in context |
| D-2 | Unscoped `project`/`domain` notes become global in index, search and related-work (scoped notes unchanged)? | yes — the only lossless option while no client projects exist; moving a note into `projects/<id>/` later scopes it |
| D-3 | Transcript session notes (845 vault files, 81 MB) selected by default? (Grok's 438 per-project summaries are on by default regardless.) | no — one click selects the group; on by default floods episodic FTS with transcripts |
| D-4 | Keep the optional metadata-only AI enrichment, or ship zero model calls? | keep, optional; it never touches bodies and never blocks |
| D-5 | After release: roll back job `01M1V2C1…` on the live instance and re-import (scan root `~/Documents/Obsidian Vault/99_Meta/ai-memory` + `~/.claude` + `~/.grok`)? | yes, as a separate explicit step (dev → live update + restart, then rollback, then import) |
| D-6 | Global rule files reach the model only through the ≈ 3 200-char `agent-notes` window. Options: (a) add an importer target `prompt.project-type` that appends a rule file to the `general` project type's prompt (12 000-char cascade, proposal-style, +1 day); (b) leave the importer at AGENTS.md and move rules into the type prompt by hand later; (c) raise the `agentsMd` prefix budget (risks the 8 800 prefix ceiling for every agent). | (a) — it is the only place a 15 KB rule file is both stored verbatim and effective |

## 7. Follow-ups (not in this change)

- `vault_index.content_text` drops fenced code blocks — `search_memory` cannot return commands stored in notes.
- FTS unicode61 without stemming; short Hungarian prompts (< 40 chars) get no related-work block (`memory.relatedWork.minQueryChars` is already configurable; 12 was suggested by the panel).
- Skill matching is top-1 per turn and absent from background runs; the prompt footer advertises a `skill_load` tool that does not exist.
- Chat exposes every registered tool regardless of the agent's tool list.
- No config hot-reload: `local.yaml` changes (D-1, `minQueryChars`) need a restart.
- Live-instance findings outside the importer, for the owner: `projects.general-general.prompt` has no `+` prefix and therefore replaces the `general` type prompt instead of extending it (`prompt-service.ts:19-24`); the Code Reviewer `AGENTS.md` can be restored from `.history/AGENTS.md.2026-09-06T09-56-48.md` via the workspace restore route; the Odoo module has no connection configured, so `odoo_*` tools cannot yet replace the imported skill scripts; only the 18c/18e Odoo source indexes are registered as search sources (no 19c/19e, no `eyssen-erp` tree).
- Imported note bodies mention Claude Code tooling that has no EYAS equivalent (Keychain, hooks, `/odoo-*` plugin skills, `mcpvault`); they are stored verbatim by design — arbitration or annotation of stale/contradicting notes (e.g. the 2026-03 `~/.claude/memory/eyssen-odoo-development.md`) is a memory-lifecycle feature, not an import one.
