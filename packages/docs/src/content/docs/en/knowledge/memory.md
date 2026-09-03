---
title: Memory
description: What EYAS remembers — automatic vault notes, five tiers, and when to use which store.
---

**What this is for.** Memory is EYAS's own long-term store. A durable fact you state in a conversation becomes a vault note without anyone asking, and the same note is what every later conversation reads back. This page is where you inspect working blocks, episodic facts, vault files, and the review queue — not where you curate a wiki.

## When to use it

- You want the assistant to remember who you are, how you work, or a project's constraints.
- A fact was stated in chat and you want to confirm it landed in the vault (or why a capture was skipped).
- You need to review, tag, graph, or consolidate memories — or jump to **Today's note**.
- You are choosing between Memory, the Knowledge wiki, Documents, and hand-written vault files (see below).
- You want capture off for this instance (`memory.capture.enabled: false`).

## Typical workflow

1. Open **Memory** in the sidebar (**Content** section) — route `/memory`. (Also listed under **Settings → AI & Model**.)
2. Check **Overview** (counts, salience, recent episodic), then **Vault Files** for durable notes.
3. Have a conversation longer than ~40 characters that states a lasting fact. Return here after the reply — you should see a new vault note (kind `user`, `feedback`, `domain`, `project`, or `reference`).
4. If nothing appeared, it was too short, capture is off, or the turn was God Mode (those do not capture). Hand-write a note in the vault if you need it anyway.

## Which store to use

| Store | Job |
|-------|-----|
| **Memory** (this page) | Automatic + agent-written facts. EYAS injects a one-line index into later prompts. Source of truth for "what the assistant knows about you." |
| **Knowledge** wiki | Curated pages **you** edit (spaces, tree, versions). Not filled by capture. |
| **Documents** | Files you upload (PDF, images, …) for retrieval — not durable identity notes. |
| **Vault files** (hand-written markdown) | Same vault as capture (`data/vault/…`). Write one yourself; EYAS picks it up. Do **not** treat `~/.claude` or `~/.grok` as this store. |
| **Project wiki** | Per-project ticket and decision pages, not global memory. |

Host Claude / Grok memory on the machine is **not** the source of truth. Isolated CLI calls and the default-off `loadClaudeMd` setting exist so a second memory cannot pre-empt the vault.

## Features

Subtitle in the app: *5-tier hybrid memory — working, episodic, semantic/procedural vault, archive.*

## Actions

| Control | Meaning |
|---------|---------|
| **Today's note** | Jump to / create today’s note |
| **Consolidate Now** | Run consolidator (promote/demote memories) |
| **Refresh** | Reload stats |

## Tabs

| Tab | Content |
|-----|---------|
| **Overview** | Stats + salience charts + recent episodic |
| **Working Memory** | Short-TTL blocks (24h) |
| **Episodic Memory** | Facts/episodes with salience |
| **Vault Files** | Markdown vault browser |
| **Archive** | Low-salience archived items |
| **Graph** | Memory graph view |
| **Tags** | Tag browser |
| **Review** | Review queue for memory hygiene |

## Overview stats

| Stat | Meaning |
|------|---------|
| **Working Blocks** | Active working blocks (24h TTL) |
| **Episodic Facts** | Episodic count (+ invalidated) |
| **Vault Files** | Semantic+procedural markdown files |
| **Archived** | Low-salience archive count |
| Ready for promotion → vault | High-value episodic candidates |
| Ready for demotion → archive | Low-salience candidates |
| Salience min/avg/max | Distribution |
| Top tags / by source | Breakdowns |

## Working memory row

chars · accessed N× · expires time

## Episodic row / detail

| Field | Meaning |
|-------|---------|
| **salience** | Importance score |
| **invalidated** | No longer trusted/current |
| **ID / Source / Source ID / Agent** | Provenance |
| **Access count / Conversation count** | Usage |
| **Valid from / Invalidated at / Created / Last accessed** | Lifecycle timestamps |
| **Embedding hash** | Vector index presence |

## Vault browser

| Control | Meaning |
|---------|---------|
| File list | Vault paths |
| **Frontmatter** | YAML metadata |
| **tags / links** | Wikilinks and tags |
| **Content** | Markdown body |
| **Backlinks** | Notes linking here |

## Archive

archived at · original created · ids — consolidator moves low-salience items here.

## Durable notes

A durable note is a lasting fact, not a record of something that happened: who
you are, how you want to be worked with, what a project's constraints are. Each
one is a single markdown file in the vault, and every turn the agent is given a
**one-line index** of them — the summaries only. It reads a whole note with
`search_memory` when the line turns out to matter.

A second per-turn block retrieves **related prior work** from the vault,
episodic memory, and past conversation messages, using the current
message as the query. The model does not have to call `search_memory`
for those hits to appear. Bodies still load through `search_memory`.
Past messages are searchable because they are already stored; this is
not a second copy.

Two frontmatter fields drive this:

| Field | What it does |
|-------|--------------|
| `kind` | `user`, `feedback`, `domain`, `project` or `reference` — also the ranking order |
| `summary` | The single line that appears in the index |

`user` and `feedback` are ranked first, because they change how every answer is
produced. `domain` is the project type (shared by sibling projects); `project`
is this one project. A note with no `kind` is read as `feedback` if it lives in
`procedural/` and as `reference` otherwise — never as `user`: claiming an
undeclared note is a fact about you would put it at the top of every prompt.
Without a `summary` the note's first real line is used, so a file written by
hand in any editor works with no EYAS-specific frontmatter at all.

Where they live: `data/vault/semantic/`, `data/vault/procedural/`,
`data/vault/projects/`, `data/vault/project-types/`. Write one yourself and EYAS picks it up.

**These fill themselves.** Once a reply has been delivered, a small model call
reads the exchange and asks whether anything in it is still true and still
useful in a month. It may return up to two notes, and on most turns it correctly
returns none. This never happens inside the critical path of your answer, and a
capture that fails costs you a note, never a reply.

What stands in front of that call is a single length check — a message shorter
than `minUserChars` (40 characters by default) never buys one — plus a ceiling of
`maxPerConversation` (20) model calls per conversation. There is no keyword list
in any language. Switch the whole thing off with `memory.capture.enabled: false`
in `config/default.yaml`. Writing a note by hand and an agent calling
`save_memory` both still work exactly as before.

A fact you repeat reinforces the note that already exists rather than creating a
second one: the new wording is appended as a dated bullet under `## History`,
never written over the old. Text passes through the privacy module before it
reaches disk, not when it is read back.

**Project memory.** A fact learned inside a project's conversations is filed
under `projects/<project-id>/`, ranks ahead of general reference notes while you
are working in that project, and is not shown anywhere else — another project's
notes never reach your prompt. The **General** project that every conversation
starts in is not a project identity: facts learned there are kept as facts about
you or about how you want to be worked with, so they follow you everywhere
instead of being buried in a catch-all.

Agents recall with `search_memory`. Default **`scope` is `current`**: this
project, its type, and global user / feedback / reference notes — not other
projects. Pass `scope: all` when the agent must look across the whole vault.
The Memory page search (`/memory`) is unfiltered.

### Capture is on by default

Capture runs on **every** conversation, globally, unless you set
`memory.capture.enabled: false` in `config/default.yaml`. A small model call
attaches **after** the reply has been delivered — never in the critical path.
A capture that fails is a missing note, never a failed conversation.

| Gate | Default | Meaning |
|------|---------|---------|
| `memory.capture.enabled` | **on** | Master switch |
| `minUserChars` | 40 | Unicode code points; shorter messages skip the model call |
| `maxPerConversation` | 20 | Model-spend ceiling (successful, unparsable, and error runs count; too-short skips do not) |

There is no keyword list in any language. `{"notes":[]}` is the common and
correct extractor answer (0–2 notes, kinds `user` / `feedback` / `domain` /
`project` / `reference`).

### Isolated CLI — EYAS memory only

Extraction runs in an **isolated** model context: no host filesystem settings,
no CLI-native memory, no bridged tools, a single turn. Conversations on the
Claude Code CLI default **`loadClaudeMd` off** — they do not load `~/.claude`
settings, CLAUDE.md, host skills, or project `.mcp.json`. Isolated and opted-out
calls also set `CLAUDE_CODE_DISABLE_AUTO_MEMORY` and `strictMcpConfig`.

Grok / Kimi (ACP) have no isolation switch; their provider panels say so rather
than pretending. Agents are told to use `search_memory` / `save_memory` only,
and the file-writing gate denies `~/.claude`, `~/.grok`, and `ai-memory` paths.

Without isolation the extractor once read the owner's host memory, reported the
fact "already recorded", and the EYAS vault stayed empty. That is the bug this
closes.

### Capture run ledger

Every outcome that reaches the gate writes a `memory_capture_runs` row: skips
with their reason, extractions with the kinds they wrote, plus a `provider`
column (`provider/model`, or null when no model was called). Two silences are
deliberate: capture switched off writes nothing, and a background run with no
assistant text never reaches the gate. **God Mode** turns return their own
stream before the post-turn block, so they capture nothing — no note, no row.

---

## Shared memory blocks (agent tools)

In addition to the five-tier UI, agents can use **scoped memory blocks** (Letta-style) via tools — durable shared notes for multi-turn and multi-agent work.

| Scope | Shared among |
|-------|----------------|
| **company** | Whole instance |
| **agent** | One agent |
| **team** | Team orchestration |
| **run** | Single run |

| Tool | Meaning |
|------|---------|
| `memory_block_read` | Read block content |
| `memory_block_write` | Append or replace content; formatted into prompts when relevant |

These are separate from Working Memory rows on this page but complement them for cross-conversation state.

## Related

- [Knowledge base](/docs/en/knowledge/knowledge-base/)
- [Documents](/docs/en/knowledge/documents/)
- [Project wiki](/docs/en/knowledge/client-wiki/)
- [Providers](/docs/en/ai/providers/) (CLI isolation / `loadClaudeMd`)
- [Data import](/docs/en/admin/data-port/)
- [Tools](/docs/en/automation/tools/)
