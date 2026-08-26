---
title: A2A és külső ágensek
description: Agent-to-agent protokoll, agent card és task execution.
---

Agent Card: `/.well-known/agent-card.json`. Csak tudatos hálózati kitettség mellett.

| Fogalom | Jelentés |
|---------|----------|
| Agent card | Gép olvasható képesség / endpoint leírás |
| Trust boundary | Csak szándékos hálózati expozíciónál |
| Task execution | Bejövő `tasks/send` → valódi agent runner (`executeAgent`): beszélgetés létrehozás, majd ágens futtatás |
| Mailbox | A2A task mailbox list/get a communication service-en |

## Kapcsolódó

- [Ingress](/docs/hu/admin/ingress/)
- [Csatornák](/docs/hu/communication/channels/)
