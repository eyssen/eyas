---
title: Forge
description: Propose and approve agent soul/identity evolution.
---

**Route:** `/forge`.

Forge is the **human-in-the-loop** path for changing deep agent identity/soul. Agents (or the system) **propose**; you **review and apply** — or reject.

## Why Forge exists

| Path | When |
|------|------|
| Direct workspace edit | You edit IDENTITY/SOUL files yourself |
| Agent self-update | Only if autonomy `identitySelfUpdate` allows it |
| **Forge proposal** | Default safe path for autonomous improvement |

When identity self-update is disabled in config/autonomy, agents must use forge proposals instead of rewriting IDENTITY.md directly.

## Soul proposal card (typical controls)

| Control | Meaning |
|---------|---------|
| Proposal summary | What would change |
| Diff / preview | Before vs after |
| **Approve / Apply** | Accept into workspace |
| **Reject / Dismiss** | Discard proposal |
| Agent name | Whose identity is affected |

Exact labels follow the Forge page locales.

## Related

- [Identity & workspace](/docs/en/agents/identity-workspace/)
- [Autonomy](/docs/en/agents/autonomy/)
- [Self-learning](/docs/en/automation/self-learning/)
