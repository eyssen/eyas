---
title: Prompts system
description: Layered prompts — master → project-type → project → conversation — plus coaches.
---

**What this is for.** Every turn is assembled from stacked prompt layers, not one blob. **Master** is the global identity (some sections locked). **Project type** and **Project** refine it for a kind of work and a single project. **Conversation** adds thread-specific text. Agents also have a **System Prompt**. This chapter is the editor for those durable layers; the conversation **Prompt Enhancer** is only for one-off drafts.

**Routes:** `/prompts` (sidebar **Prompts** — templates), `/prompt-settings` (master **System Prompt** sections). Also: conversation **Prompt Enhancer**, **Prompt coach** on Projects / Agents.

## When to use it

- You want to change house voice (the editable **personality** section) without touching locked platform rules.
- A project type should carry a reusable brief that every project of that type inherits.
- One project needs domain conventions that should not leak into other projects.
- A draft in the composer is weak and you want the Prompt Enhancer, not a durable layer change.

## Typical workflow

1. Open **Prompts** (`/prompts`). Pick a level: **Master / Project Type / Project / Conversation**.
2. Select a template. Locked ones are **Read-only**. Others: edit content, **Activate / Deactivate**, or delete.
3. Open `/prompt-settings` (from the Prompts crumb) to see master sections. Only **personality** is editable there; the rest are locked.
4. For a durable project or agent brief, use **Prompt coach** on the project / agent form, then **Apply**.
5. For a one-off user prompt, open **Prompt Enhancer** from the conversation composer.

## Features

| Layer | Scope |
|-------|-------|
| **Master** | Global system identity & core rules (some sections locked) |
| **Project type** | Defaults for a type of work |
| **Project** | Overrides for one project |
| **Conversation** | Thread-specific additions / one-off user prompts |
| **Agent System Prompt** | Agent-level operating protocol ([Configuration](/docs/en/agents/configure/)) |

| Concept | Meaning |
|---------|---------|
| Locked section | Not editable in UI (platform integrity) |
| Editable section | You can customise tone/rules |
| Inheritance | Lower layers refine upper layers |

---

## Prompt Enhancer (conversation drafts)

Opens from the conversation **composer**. Optimizes a **one-off** user prompt for the thread’s **model family**, with task-type chips, quality scoring, and concise/thorough alternatives.

Full field table: [Conversations — Prompt Enhancer](/docs/en/daily/conversations/#prompt-enhancer-dialog).

---

## Prompt Coach (durable layers)

**Prompt coach** buttons open a role-aware coach for **durable** text — not mixed with conversation drafts.

| Scope | Where | What it optimizes |
|-------|-------|-------------------|
| **Project type** | Projects → Project Types → Prompt | Reusable defaults inherited by projects of that type |
| **Project** | Projects → Project → Prompt | Operating brief for all conversations in the project (domain, conventions, success criteria) |
| **Agent system** | Agents → Configuration → System Prompt | Agent operating protocol (not voice, not project domain, not one-off tasks) |

### Coach dialog controls

| Control | Meaning |
|---------|---------|
| Scope badge | **Project layer** / **Project-type layer** / **Agent systemPrompt** |
| Draft / reply | Describe goal or paste a draft; iterative **Send** |
| **Quality N/10** | Checklist score; **Gaps** lists missing items |
| **Propose two alternatives** | Concise + thorough variants |
| **Suggested brief** | Candidate to insert |
| **Apply** | Write the brief into the form field |

## Fields and controls

<h2 id="prompts-list">`/prompts` — Prompt Templates</h2>

Subtitle: *Configure system prompt templates for the prompt inheritance chain.*

| Control | Meaning |
|---------|---------|
| Level tabs | **Master / Project Type / Project / Conversation** |
| Template list | Name, active flag, locked badge |
| **View Template / Edit Template** | Editor pane |
| **Activate / Deactivate** | Toggle `isActive` |
| Content | Template body |

<h2 id="prompt-settings">`/prompt-settings` — System Prompt</h2>

Subtitle: *These sections form the foundation of every AI conversation. Locked sections cannot be modified.*

Locked sections render as read-only. The **personality** section is **Editable** — save writes `PATCH /prompts/master/personality`.

## Related

- [Projects — prompt fields](/docs/en/daily/projects/)
- [Agents — system prompt](/docs/en/agents/configure/)
- [Conversations](/docs/en/daily/conversations/)
- [Routing & budget](/docs/en/ai/routing-budget/)
