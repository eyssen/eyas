---
title: A2A y agentes externos
description: Protocolo agent-to-agent, card y ejecución de tareas.
---

Agent Card: `/.well-known/agent-card.json`. Solo con exposición de red intencionada.

| Concepto | Significado |
|----------|-------------|
| Agent card | Descripción máquina de capacidades/endpoints |
| Task execution | `tasks/send` entrante → runner real (`executeAgent`): crea conversación y ejecuta el agente |
| Mailbox | list/get de mailbox A2A en el servicio de comunicación |

## Relacionado

- [Ingress](/docs/es/admin/ingress/)
- [Canales](/docs/es/communication/channels/)
