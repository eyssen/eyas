---
title: Memory
description: Five-tier hybrid memory — every tab and field.
---

**Route:** `/memory`. Subtitle: *5-tier hybrid memory — working, episodic, semantic/procedural vault, archive.*

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

Two frontmatter fields drive this:

| Field | What it does |
|-------|--------------|
| `kind` | `user`, `feedback`, `project` or `reference` — also the ranking order |
| `summary` | The single line that appears in the index |

`user` and `feedback` are ranked first, because they change how every answer is
produced. A note with no `kind` is read as `feedback` if it lives in
`procedural/` and as `reference` otherwise — never as `user`: claiming an
undeclared note is a fact about you would put it at the top of every prompt.
Without a `summary` the note's first real line is used, so a file written by
hand in any editor works with no EYAS-specific frontmatter at all.

Where they live: `data/vault/semantic/`, `data/vault/procedural/`,
`data/vault/projects/`. Write one yourself and EYAS picks it up.

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
- [Data import](/docs/en/admin/data-port/)
- [Tools](/docs/en/automation/tools/)
