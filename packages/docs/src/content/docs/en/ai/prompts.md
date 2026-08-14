---
title: Prompts system
description: Layered prompts, Prompt Enhancer, and scoped Prompt Coaches.
---

**Routes:** Settings → Prompts · conversation **Prompt Enhancer** · **Prompt coach** on Projects / Agents.

## Layers

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

---

## Related

- [Projects — prompt fields](/docs/en/daily/projects/)
- [Agents — system prompt](/docs/en/agents/configure/)
- [Conversations](/docs/en/daily/conversations/)
