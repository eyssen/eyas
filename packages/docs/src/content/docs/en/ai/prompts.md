---
title: Prompts system
description: Layered prompts master → project-type → project → conversation.
---

**Routes:** Settings → Prompts / prompt settings pages.

| Layer | Scope |
|-------|-------|
| **Master** | Global system identity & core rules (some sections locked) |
| **Project type** | Defaults for a type of work |
| **Project** | Overrides for one project |
| **Conversation** | Thread-specific additions |

| Concept | Meaning |
|---------|---------|
| Locked section | Not editable in UI (platform integrity) |
| Editable section | You can customise tone/rules |
| Inheritance | Lower layers refine upper layers |

Agent **System Prompt** on Configuration is additional agent-level text.

## Related

- [Projects — prompt fields](/docs/en/daily/projects/)
- [Agents — system prompt](/docs/en/agents/configure/)
