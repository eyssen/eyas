---
title: A2A & external agents
description: Agent-to-agent protocol and agent card.
---

EYAS can expose an **Agent Card** at `/.well-known/agent-card.json` for A2A-compatible discovery.

| Concept | Meaning |
|---------|---------|
| Agent card | Machine-readable description of capabilities/endpoints |
| Trust boundary | Only enable A2A where network exposure is intentional |
| Discovery | Peers fetch the well-known URL |

Configure exposure carefully behind auth/ingress.

## Related

- [Ingress](/docs/en/admin/observability/)
- [Channels](/docs/en/communication/channels/)
