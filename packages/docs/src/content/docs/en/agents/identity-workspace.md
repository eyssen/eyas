---
title: Identity & workspace
description: Workspace files IDENTITY, AGENTS, TOOLS, MEMORY — editor, sections, history.
---

**Route:** `/agents/:id` → tab **Workspace**.

Long-lived behaviour lives in **markdown files** under `data/agents/<id>/`, not only in SQL form fields.

## File selector

| File label | Meaning |
|------------|---------|
| **Who I am** (`IDENTITY`) | Core identity narrative and mission sections |
| **Team description** (`AGENTS`) | How this agent relates to the team |
| **Tools** (`TOOLS`) | Tool usage guidance |
| **Memory** (`MEMORY`) | Memory notes / pointers |

## Editor

| Control | Meaning |
|---------|---------|
| **Editor** | Raw markdown edit mode |
| **Preview** | Rendered preview |
| **Markdown content…** | Editor placeholder |
| **Save** | Write file to disk/workspace store |
| **(empty)** | File has no content yet |

## IDENTITY sections helper

Click a section chip to jump to or **create** a missing heading:

| Section | Purpose |
|---------|---------|
| **Who I am** | Self-description |
| **My mission** | Mission statement |
| **Ongoing proactive duties** | Background duties |
| **When to escalate** | Escalation rules |
| **When to refuse** | Hard refusal boundaries |

Hint: *Click a section to add it if missing.*

## History panel

| Control | Meaning |
|---------|---------|
| **History** | List of saved snapshots |
| **View** | Open snapshot comparison |
| **Snapshot (date)** vs **Current version** | Diff sides |
| **Restore** | Roll file back to snapshot |
| Empty | *No saved history.* |

Snapshot notice may say to restore then open in the editor to view full content.

## Relation to Configuration & Forge

| Path | What changes |
|------|----------------|
| Configuration form | SQL-level name, model, tools list, budgets |
| Workspace files | Deep identity, mission, tool policy prose |
| [Forge](/docs/en/agents/forge/) | Proposed identity/soul changes requiring approval |

When autonomy forbids direct identity self-update, agents must propose via Forge instead of rewriting IDENTITY themselves.

## Related

- [Create & configure](/docs/en/agents/configure/)
- [Forge](/docs/en/agents/forge/)
- [Autonomy](/docs/en/agents/autonomy/)
