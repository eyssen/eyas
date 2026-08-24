---
title: A2A & external agents
description: Agent-to-agent protocol, agent card, and task execution.
---

EYAS can expose an **Agent Card** at `/.well-known/agent-card.json` for A2A-compatible discovery.

| Concept | Meaning |
|---------|---------|
| Agent card | Machine-readable description of capabilities/endpoints |
| Trust boundary | Only enable A2A where network exposure is intentional |
| Discovery | Peers fetch the well-known URL |
| Task execution | Inbound `tasks/send` is wired to the real agent runner (`executeAgent`) — creates a conversation, then runs the assigned agent |
| Mailbox | Communication service list/get for A2A task mailbox surfaces |

Configure exposure carefully behind auth/ingress. Failed or unconfigured execution no longer “instant-fails” as unavailable when agents are set up correctly.

## Related

- [Ingress](/docs/en/admin/ingress/)
- [Channels](/docs/en/communication/channels/)
- [Agents overview](/docs/en/agents/overview/)
