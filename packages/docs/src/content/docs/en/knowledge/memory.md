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
