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

`/observability` has three tabs: **Usage** (existing traces / stats), **God Mode**, and **Context**. The God Mode tab lists ensemble runs (conversation, winner, model count, cost, duration, whether a tie was broken), win-rate by model, and the average cost multiple versus a single model. Click a run to open that conversation’s God tab (step log, who voted for whom, and each model’s comments on the others).

How a race is set up, how the winner is chosen, and how to read the conversation God tab: [Conversations — God Mode](/docs/en/daily/conversations/#god-mode).

### Context tab

The **Context** tab answers a question nothing in EYAS could answer before: what the model *actually* received, not what was meant to be sent. It shows the average and peak token cost of each prompt section (and how many samples that rests on), truncation frequency (how often — and which section — gets cut to fit budget), and estimate vs. actual: the gap between the token estimate and what the provider reported, the first way to measure how far that estimate drifts.

Detailed per-section records are short-lived by design (7 days by default); only the daily rollup survives long-term. If you go looking for older detail and can't find it, that's expected, not data loss.

## Related

- [Mission Control](/docs/en/agents/runs/)
- [Multi-instance](/docs/en/deploy/multi-instance/)
- [Security](/docs/en/admin/security-privacy/)
