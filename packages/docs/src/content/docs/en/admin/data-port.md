---
title: Data import & export
description: Import wizard for memory, skills, and workspace rules — scan, select, approve.
---

**What this is for.** Data port is the **import wizard**. It scans a server path or an uploaded zip/markdown from another assistant (Claude Code, Grok CLI, Cursor, Codex CLI, Gemini CLI, Windsurf, GitHub Copilot, Obsidian, a chat export, a prior EYAS export, or a plain Markdown folder) and proposes what to file where. Memory can apply; workspace rules and identity are **proposal only** until you approve a merge. It is not a full-DB dump — use [Backup](/docs/en/admin/backup/) for recovery. Export is still **Coming soon**.

**Location:** Settings → **Data portability** card. Heading: *Import memory, skills and rules from previous AI systems. Export is coming later.*

## When to use it

- You are moving durable notes out of `~/.claude` or an Obsidian `ai-memory` vault into EYAS (the only memory that later turns will read).
- Custom skills live in Claude/Cursor and should become **own** skills here.
- Agent workspace rules/identity should be reviewed as merge proposals, never auto-overwritten.
- You want a zip of a prior export scanned without copying files onto the server by hand.

## Typical workflow

1. Open **Settings** → **Data portability** → **Import data…**
2. Pick **Source system**: **Auto-detect**, Claude Code, Grok CLI, Cursor, Codex CLI, Gemini CLI, Windsurf / Codeium, GitHub Copilot, Obsidian, Chat export, EYAS export, Markdown folder. The ids the API uses are `claude-code`, `grok-cli`, `cursor`, `codex`, `gemini-cli`, `windsurf`, `copilot`, `obsidian`, `chat-export`, `eyas-export` and `generic-md`.
3. Give a **Server path** (absolute on this machine) **or** **Choose file…** (zip or a single markdown/JSON). Optional **Instructions** guide ranking.
4. **Scan**. Review the folder tree and the groups (Memory, Memory index, Sessions, Skills, Rules, Identity, Agent personas, Knowledge, Source code, Not importable). Select what to keep. Leave **Enrich metadata with the model** unchecked for a fully deterministic import.
5. **Import N items**. Memory/skills apply; rules/identity wait as **Workspace change proposals** — **Approve merge** or **Reject**.

## Features

| Capability | Meaning |
|------------|---------|
| Import | Path on server and/or upload (zip) |
| Targets | Memory (kind + tier), episodic sessions, skills with bundled files, agent personas, workspace rules, project-type prompt |
| Merge | **Proposal only** for rules/identity — apply after explicit approve |
| Enrichment | **Off by default** — an opt-in checkbox, metadata only, never the body |
| Language | Imported memory keeps source language |
| Skills category | Imported → **own** |
| Rollback | Undo a whole job — needs the **`delete`** permission on Data Port |
| Export | **Coming soon** — an `eyas-export-v1` bundle (vault, skills, workspaces, `episodic.jsonl`). A bundle can carry credential-bearing notes, so before it ships the route gets the same owner-only caller test that guards memory recall; `create` on Data Port alone will not be enough |

## What lands where

You do not have to pick the perfect folder. **Everything under the path is mapped.** There is no keep-list and no cap: the scan walks every directory below the root, whatever its size. A tree ten times larger than a typical home directory is listed and imported in full — the cost is time and disk, never omission. Only directory *classes* that can never hold memory are not entered: dependency folders (`node_modules`), version-control folders (`.git`, `.hg`, `.svn`), `.cache`, `__pycache__`, `.venv` / `venv`, build outputs (`dist`, `build`, `out`, `.next`, `.turbo`, `target`) sitting beside a build manifest, browser profile roots (Chrome, Chromium, Firefox, Antigravity — recognised by their marker files, wherever they sit), cloud storage roots (`Library/CloudStorage` and `Library/Mobile Documents`, recognised by the place macOS gives them, plus legacy sync folders such as Dropbox recognised by their own marker files — a folder merely *named* OneDrive or Dropbox is an ordinary folder and is walked), the trash (`.Trash`, `.Trashes`, `$RECYCLE.BIN`, `.local/share/Trash`) and `Library/Caches`. Each of those is still **one visible row** carrying its file count and the reason *Folder not searched: `<class>`*, so nothing disappears in silence. A symlinked directory is followed once — the real path decides — and a loop is reported rather than re-entered. `.DS_Store` is listed as application state.

| Source | EYAS layer |
|--------|------------|
| Note with `type: user` / `feedback` / `project` / `reference` (Claude Code, Obsidian, Grok) | Vault note with that **kind**; `feedback` under `procedural/`, the rest under `semantic/`; the file keeps its **source file name**, so `[[wikilinks]]` keep resolving |
| `MEMORY.md` index | One vault note tagged `index`; a one-line hook becomes the summary of the note it points to when that note declares no `description` of its own |
| Session summaries, session notes (`type: claude-session` / `grok-session`) and transcripts — Claude Code `*.jsonl` including sub-agent transcripts, Cursor agent transcripts, Codex rollouts, ChatGPT / Claude.ai exports | Episodic memory, one row per session — a very long session as ordered parts, never cut — with the turns kept verbatim. **All of it is selected by default**; untick the *Sessions* group if you do not want it. Tool output saved beside a session is listed but not ticked |
| Legacy memory folders (`memory.local-backup-*`, `memory.old`, `*.bak`) | Vault note tagged `legacy`; a name already taken gets a `-2` sibling instead of being dropped |
| Your own documents, anywhere under the root | Vault note; the kind comes from `type:` when the note declares one, otherwise `reference` |
| Third-party product documentation | Vault note tagged `third-party`, selected — untick the group if you would rather not keep it |
| Rule files inside repositories (`.cursor/rules/*.mdc`, `.cursorrules`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `global_rules.md`) | Proposal, wherever in the tree they sit |
| Source-code files | Listed and importable, **not** ticked — they are neither memory nor instructions |
| Data and configuration text (`.yaml`, `.toml`, `.csv`, `.log`, an assistant's `settings.json` …) | Listed and importable, **not** ticked |
| `SKILL.md` with `references/` and `scripts/` | One **own** skill: the whole package verbatim, files also copied to `data/skills/imported/<name>-<hash>/`. The skill body names that directory by its **absolute on-disk path**, so a bundled script can be run straight from there |
| `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, Cursor `.mdc`, Windsurf and Copilot rules | Proposal for the **primary assistant's** `AGENTS.md` — or, when you choose *Project-type prompt*, for the `general` project type — appended on approval, never overwritten |
| `.claude/agents/*.md` personas | Agent definitions (tools mapped to EYAS tools) |

**Nothing is clipped or silently skipped.** Files are read whole at import time and there is no size limit: a text file over 4 MiB (50 MiB for a chat export) is imported in full and only carries a size marker on its row. Bodies are written **byte for byte**, leading and trailing blank lines included; the vault writer's single trailing newline and a dropped UTF-8 byte-order mark are the only changes. Every applied item records the adapter that actually read it (`source.adapter`, and the tag `source:<adapter>` — a Grok summary found under an auto-detected Claude Code job is tagged `grok-cli`), every path the content was found at, and the sha256 of its content in the ledger — for vault notes, episodic rows, skills, bundled skill files, agents and proposals alike. The original frontmatter, path, hash and modification time travel with the note under `source:`. Every file the scan does not import is a visible row with its reason. Re-running an import reports **Unchanged** for notes already present and never overwrites — a different note with the same name gets a `-2` suffix and a `conflict-with:` tag. Re-importing an unapproved rule file does not stack up a second proposal for it.

**A declared project or project type that doesn't exist yet isn't lost.** When an imported note's frontmatter declares a `project` (or `projectType`), the importer files it under `projects/<id>/` (or `project-types/<id>/`) only if that project or project type already exists in this EYAS instance; otherwise it lands unscoped and tagged `declared-project:<id>` (or `declared-project-type:<id>`). Creating the project afterwards and re-importing then files it under the declared id, or you can move the note yourself.

**Any assistant.** Sources are recognised by adapters: Claude Code, Grok CLI, Cursor, Codex CLI, Gemini CLI, Windsurf, GitHub Copilot (documented layout only), Obsidian, ChatGPT / Claude.ai / generic JSON exports, eyas-export and plain markdown (`generic-md`). Files reached through several paths (a vault symlinked into `~/.grok/memory`) become one note.

**Model enrichment is off by default.** The review step carries an **Enrich metadata with the model** checkbox. Left unchecked — the default — the whole import is deterministic and spends no model call at all. Ticked, and with a configured model, notes *without* a declared type get a suggested kind, summary and tags. There is no item cap; the cost is time. The body is never rewritten, nothing is skipped on the model's say-so, and an item tagged `contains-secrets` is never sent. The result panel reports how many notes were enriched.

**Rolling back.** Every job can be reverted from the result panel or the *Previous imports* list: notes, episodic rows, skills (and their copied files), agents and approved rule sections are removed; pending proposals are rejected. Rollback is destructive, so it needs the **`delete` permission on Data Port** — owner and admin only under the shipped defaults; everyone else sees the button fail with a permission error. A vault note you have **edited since the import** is left alone and reported under *skipped* instead of being deleted.

Read tools stay open on host memory paths so this importer can copy those notes in; write/shell to `~/.claude` / `~/.grok` / `ai-memory` is denied. See [Memory](/docs/en/knowledge/memory/).

## Secrets

A file the secrets heuristic flags is **imported verbatim, like every other file**, and tagged `contains-secrets`. Nothing is ever dropped for holding a credential — safety here is a *recall* measure, not an import measure. The tag travels as a note tag, a skill capability, an episodic tag and `[contains-secrets]` in a proposal title, and the wizard marks the row so you can see it before you import.

The heuristic looks for a private-key block, a provider token, a `KEY=value` literal or a `.env`-shaped file name. Code that *looks a secret up* — `keychain_lookup(...)`, `os.environ[...]`, `getenv(...)` — and documentation placeholders such as `<your-key>`, `xxx` or `.env.example` are not flagged.

**What the tag does.** A note, episodic row or skill tagged `contains-secrets` is left out of everything the model reaches on its own: the always-on memory index, related work, `search_memory`, the reflection job, the nightly consolidator, the skill matcher and the assembled system prompt. It is never handed to the optional enrichment model and it is never embedded. It stays fully visible to you on the Memory page. To open it to the model, set `memory.recall.includeSecrets: true` in `config/local.yaml` and restart — see [Configuration](/docs/en/deploy/configuration/).

**This is an automatic-inclusion gate, not a filesystem sandbox.** The tag stops a flagged item being pulled into a prompt by itself. It does not stop an agent that holds file-read tools from reading the original file on disk, and it encrypts nothing. If a credential should not be on this machine at all, rotate it: the importer's job is to keep it out of a prompt you did not ask for, not to make it unreachable.

**Two kinds are not gated, because there the content *is* the prompt.** An imported agent persona and an approved workspace rule file are used **verbatim in the assistant's prompts**, so a credential inside one reaches the model on every turn and recall filtering does not apply — gating them would disable the very agent you imported. They are still tagged `contains-secrets` so you can find them, and the wizard says the same thing on those rows: review them before importing.

**Credential-shaped files** — `.env`, `credentials.json`, key files — are listed and importable but **not ticked**. A note, rule, skill or transcript that merely *contains* a key keeps its own kind, stays ticked, and carries the tag.

## Scale

Every candidate is one row in the database, so neither the wizard nor the server ever holds the whole list.

**The scan runs in the background.** It answers straight away and the folder tree fills in while it walks, reporting folders visited, files seen and rows listed. A whole home directory takes minutes. You can stop it, and what it mapped before you did stays reviewable.

**The review step is a folder tree, a virtualised list and a preview.** Every folder is mapped, the classes that are not entered included — those show their file count and the class that kept the walker out. **Select all importable**, **Select none** and **Back to suggested** act on the whole scan. Below them, selection is by gesture rather than row by row: every folder and every kind carries a tri-state checkbox, so one click unticks every transcript in every folder. The number beside each checkbox is the server's own answer for the selection on screen, so what you read is what the import will file. The preview shows the first 64 KiB of a file; the import still takes it whole.

**The import streams.** Items go in batches of 100, each batch is committed, progress is reported every 100 items, and the search index is rebuilt once at the end. You can stop it after the current batch — everything already filed stays and can be rolled back. If the server restarts mid-import, the job resumes from its last committed batch instead of starting over. Scan time and import time are both shown.

**One large file is the memory bound, not the whole tree.** Importing a container — a transcript, a chat export, a Codex database — costs several times its own file size in transient memory, because the file is held as one buffer while every unit inside it is rendered. How many times depends on what the file is: about three times for a line-per-turn transcript, and seven or more for a chat export, which is parsed whole into one object graph. The import phase costs more than the scan — a 19 MB transcript measured 100 MiB while scanning and 235 MiB while importing. A 90 MB chat export peaks near 900 MiB resident, which the Helm chart's 1Gi default has room for and the 512Mi legacy starter does not.

**Row-by-row memory stays flat, however many rows there are.** Nothing is kept once a scan finishes: a second scan of the same 26 000-row tree adds nothing at all to the heap. Resident memory can still look high afterwards, because the allocator holds on to pages it has already asked the system for — that is the allocator, not the scan. The bound is set by your single largest file, not by the size of the tree.

**Re-running adds only what is new.** Everything already present reports **Unchanged**, and a later import never rolls back an earlier one.

Two engine facts, stated so that nothing surprises you:

- A bundled skill file over 200 000 characters is inlined into the skill body up to that point, with a marker naming the complete copy. The copy under the skill's asset directory is byte-exact and complete.
- A single text file larger than one text value the engine can hold (about 512 MiB) is listed, hashed and selectable like any other, but reported with the reason *Larger than one text value the engine can hold* instead of being filed. The row says why.

**One caveat about identity.** Sessions and skills have no path identity — they are recognised by the digest of their content. A whitespace-only edit to a source file after an import therefore produces a *second* episodic row (and a second skill, when the package bundles files) rather than updating the first. Vault notes, which do have path identity, are re-stamped in place.

## Fields and controls

<h2 id="wizard">Import wizard</h2>

Steps: **source → scanning → review → running → done**.

| Control | Meaning |
|---------|---------|
| **Source system** | Profile listed above |
| **Server path** | Absolute path — a folder or a whole home directory. Choosing a **Source system** other than Auto-detect lists **Typical locations** for it, straight from that adapter |
| **Upload archive or file** | ZIP of a prior export, or a single markdown/JSON file. The 50 MiB body limit is the upload's only; a path scan has none |
| **Instructions** | Optional — what to look for. It guides ranking only; nothing is dropped because of it |
| **Scan** | Map the tree in the background — folders visited, files seen, rows listed, and **Stop the scan** |
| Folders found by the scan | Every folder the scan mapped, with per-folder toggles, subtree counts and **Reasons the rows in this folder carry** — importable or not, including the class of a folder that was not entered |
| Kind filter | **All / Memory / Memory index / Sessions / Skills / Rules / Identity / Agent personas / Knowledge / Source code / Not importable** |
| **Select all importable / Select none / Back to suggested** | Bulk selection over the whole scan, not just the page |
| Folder and kind checkboxes | Tri-state — one click selects or clears everything importable under a folder, or every row of a kind in every folder |
| **Preview** | The first 64 KiB of the file — the import still takes it whole |
| **Enrich metadata with the model** | Off by default — opt-in, metadata only, never the body, never a flagged item |
| **Import N items** | Start the background job |
| **Stop this import** | Stops after the current batch; what is filed stays |
| Stats | **Selected / Applied / Unchanged / Proposals / Skipped / Errors** |
| **Skipped, by reason** | Outcome counts per reason code (see below) |
| **Scanned in / Imported in** | How long each phase took |
| **Approve merge / Reject** | Workspace proposals — never auto-merged |
| **Roll back this import** | Undo the whole job — needs `delete` on Data Port |
| **Previous imports** | The last five jobs, each with its own rollback button |

Empty scan: *Nothing importable found in this location.*

## Reason codes

Every row in the review list carries a reason, and every outcome that is not a clean apply is counted under **Skipped, by reason**. Both come from one fixed vocabulary — never free text — so the wizard can show the label below while the API and the logs carry the code.

| Code | What it means |
|------|---------------|
| `directory-skipped` | Folder class never entered — one counted row, with its file count and the class |
| `binary` | Binary file |
| `outside-root` | Outside the chosen folder |
| `duplicate-content` | Identical content |
| `unreadable` | Could not be read |
| `empty` | Empty file |
| `derived-index` | Generated index |
| `transcript` | Conversation transcript (imported whole) |
| `session-summary` | Session summary |
| `session-artifact` | Tool output saved with a session |
| `persona` | Agent persona |
| `slash-command` | Slash command |
| `cursor-rule` | Cursor rule file |
| `memory-note` | Memory note |
| `memory-index` | Memory index |
| `skill-package` | Skill package |
| `skill` | Skill file |
| `orphan-asset` | Bundled file of a skill that was not imported |
| `rules-file` | Rules file |
| `config` | Configuration file |
| `source-code` | Source code file — importable, not ticked |
| `data-file` | Data or configuration text — importable, not ticked |
| `symlink-upload` | Symlink in the upload |
| `needs-bun` | Needs the Bun runtime |
| `not-downloaded` | Stored in the cloud, not downloaded — listed from what the file system knows, never fetched |
| `invalid-json` | Invalid JSON |
| `unknown-json` | Unrecognised JSON |
| `unrecognised` | Not recognised |
| `app-state` | Application state |
| `identity` | Identity file |
| `not-durable` | Third-party or boilerplate text — label only |
| `tools-policy` | Tool policy |
| `not-importable` | Nothing importable in it |
| `missing-unit` | Its part of the file was gone |
| `unsupported-target` | Destination not supported |
| `service-unavailable` | The service was unavailable |
| `not-a-persona` | Not an agent persona |
| `no-agent` | No agent to receive it |
| `exceeds-string-limit` | Larger than one text value the engine can hold — listed, not filed yet |
| `unchanged` | Already imported, unchanged |
| `error` | Failed with an error |

`not-durable` and `transcript` are labels only: neither unselects anything. The **Unknown** kind is not produced any more — it survives only on scans made before this release.

## Related

- [Memory](/docs/en/knowledge/memory/)
- [Skills](/docs/en/automation/skills/)
- [Backup](/docs/en/admin/backup/)
- [Agents — workspace](/docs/en/agents/identity-workspace/)
