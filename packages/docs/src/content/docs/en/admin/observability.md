---
title: Observability & ops
description: Metrics, ops, hands, nodes, ingress, extensions.
---

| Area | Route | Meaning |
|------|-------|---------|
| Observability | `/observability` | Metrics / tracing UI |
| Ops | `/ops` | Ops agent / remediation surfaces |
| Hands | `/hands` | Remote hand / computer-use hub settings |
| Nodes | `/nodes` | Remote nodes — including **SSH invoke** with destructive-command guard |
| [Ingress](/docs/en/admin/ingress/) | `/ingress` | Tunnel / remote access |
| Extensions | `/extensions` | Extension catalogue |
| Notifications | `/notifications-settings` | Notification channels |

### Nodes — SSH invoke

When a node is SSH-capable, EYAS can run remote commands through a guarded executor. Destructive command patterns are blocked unless explicitly forced. Non-SSH node types may not support invoke yet.

### God Mode tab

`/observability` has two tabs: **Usage** (existing traces / stats) and **God Mode**. The God Mode tab lists ensemble runs (conversation, winner, model count, cost, duration, whether a tie was broken), win-rate by model, and the average cost multiple versus a single model. Click a run to open that conversation’s God tab (step log, who voted for whom, and each model’s comments on the others).

How a race is set up, how the winner is chosen, and how to read the conversation God tab: [Conversations — God Mode](/docs/en/daily/conversations/#god-mode).

## Related

- [Mission Control](/docs/en/agents/runs/)
- [Multi-instance](/docs/en/deploy/multi-instance/)
- [Security](/docs/en/admin/security-privacy/)
