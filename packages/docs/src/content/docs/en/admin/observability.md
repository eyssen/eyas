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
| Ingress | `/ingress` | Tunnel / remote access |
| Extensions | `/extensions` | Extension catalogue |
| Notifications | `/notifications-settings` | Notification channels |

### Nodes — SSH invoke

When a node is SSH-capable, EYAS can run remote commands through a guarded executor. Destructive command patterns are blocked unless explicitly forced. Non-SSH node types may not support invoke yet.

## Related

- [Mission Control](/docs/en/agents/runs/)
- [Multi-instance](/docs/en/deploy/multi-instance/)
- [Security](/docs/en/admin/security-privacy/)
