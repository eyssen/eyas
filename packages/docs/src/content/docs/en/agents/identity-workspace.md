---
title: Identity & workspace
description: Edit IDENTITY, AGENTS, TOOLS, and MEMORY files — and restore a snapshot if you need to.
---

**What this is for.** Workspace files are the agent's long-lived prose: who they are, how they relate to the team, how they should use tools, and what they remember. This is deeper than the Configuration form. When autonomy forbids self-update, changes to identity come through [Forge](/docs/en/agents/forge/) instead of a silent rewrite.

## When to use it

- You want to write (or restore) **Who I am**, **My mission**, escalation, and refusal rules.
- The agent needs guidance on the team (`AGENTS`) or on tool policy (`TOOLS`).
- A bad edit landed and you need **History → Restore**.
- You are reviewing a Forge soul proposal against the current IDENTITY.

## Typical workflow

1. Open **Agents** → the agent → tab **Workspace** — route `/agents/:id`.
2. Pick a file (**Who I am**, **Team description**, **Tools**, **Memory**). Edit in **Editor** or check **Preview**.
3. Use the IDENTITY section chips to jump to (or create) missing headings. **Save**.
4. Open **History** if you need a snapshot. After restore, the file on disk should match that snapshot.

## Features

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
