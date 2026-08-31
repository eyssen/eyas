---
title: Data import & export
description: Import wizard for memory, skills, and workspace rules — scan, select, approve.
---

**What this is for.** Data port is the **import wizard**. It scans a server path or an uploaded zip/markdown from another assistant (Claude Code, Cursor, Obsidian, chat export, a prior EYAS export) and proposes what to file where. Memory can apply; workspace rules and identity are **proposal only** until you approve a merge. It is not a full-DB dump — use [Backup](/docs/en/admin/backup/) for recovery. Export is still **Coming soon**.

**Location:** Settings → **Data portability** card. Heading: *Import memory, skills and rules from previous AI systems. Export is coming later.*

## When to use it

- You are moving durable notes out of `~/.claude` or an Obsidian `ai-memory` vault into EYAS (the only memory that later turns will read).
- Custom skills live in Claude/Cursor and should become **own** skills here.
- Agent workspace rules/identity should be reviewed as merge proposals, never auto-overwritten.
- You want a zip of a prior export scanned without copying files onto the server by hand.

## Typical workflow

1. Open **Settings** → **Data portability** → **Import data…**
2. Pick **Source system** (**Auto-detect**, Claude Code, Cursor, Obsidian, generic markdown, chat export, eyas-export).
3. Give a **Server path** (absolute on this machine) **or** **Choose file…** (zip or a single markdown/JSON). Optional **Instructions** guide ranking.
4. **Scan**. Review groups (Memory, Skills, Rules, Identity, Knowledge, Unknown, Skipped/noise). Select what to keep.
5. **Import N items**. Memory/skills apply; rules/identity wait as **Workspace change proposals** — **Approve merge** or **Reject**.

## Features

| Capability | Meaning |
|------------|---------|
| Import | Path on server and/or upload (zip) |
| Targets | Memory (multi-tier), skills, agent workspace rules/identity |
| Merge | **Proposal only** for rules/identity — apply after explicit approve |
| Language | Imported memory keeps source language |
| Skills category | Imported → **own** |
| Export | **Coming soon** — will produce an `eyas-export-v1` bundle (vault, skills, workspaces) |

You do not have to pick the perfect folder. A **home directory** scan stays in assistant folders and **Documents** (so Obsidian `ai-memory` is reached). It does **not** walk `GitHub` or other source trees — those would exhaust the walker before Documents. Inside what it does walk it still **skips** one-line `MEMORY.md` indexes, full chat session dumps (`claude-sessions`), product user-guides, `robots.txt` / LICENSE boilerplate, and `AGENTS.md` inside application repos — even if you select all. Durable notes under `ai-memory`, `.grok/memory`, `.claude/skills` still copy. Vault copies get `kind: reference` unless the note is clearly feedback/user/project. The source path is not read again after import.

Read tools stay open on host memory paths so this importer can copy those notes in; write/shell to `~/.claude` / `~/.grok` / `ai-memory` is denied. See [Memory](/docs/en/knowledge/memory/).

## Fields and controls

<h2 id="wizard">Import wizard</h2>

Steps: **source → review → running → done**.

| Control | Meaning |
|---------|---------|
| **Source system** | Profile listed above |
| **Server path** | Absolute path. Hints include Obsidian `ai-memory`, `~/.claude/skills`, `~/.grok/memory` |
| **Upload archive or file** | ZIP of a prior export, or a single markdown/JSON file |
| **Instructions** | Optional — what to look for |
| **Scan** | Build the candidate list |
| Kind filter | **All / Memory / Skills / Rules / Identity / Knowledge / Unknown / Skipped / noise** |
| **Select all / none / group** | Bulk selection |
| **Import N items** | Start the background job |
| Stats | **Applied / Proposals / Skipped / Errors** |
| **Approve merge / Reject** | Workspace proposals — never auto-merged |

Empty scan: *Nothing importable found in this location.*

## Related

- [Memory](/docs/en/knowledge/memory/)
- [Skills](/docs/en/automation/skills/)
- [Backup](/docs/en/admin/backup/)
- [Agents — workspace](/docs/en/agents/identity-workspace/)
