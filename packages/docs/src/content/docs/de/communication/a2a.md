---
title: A2A & externe Agenten
description: Agent-to-Agent-Protokoll, Card und Task-Ausführung.
---

Agent Card: `/.well-known/agent-card.json`. Nur bei bewusster Netz-Exposition.

| Konzept | Bedeutung |
|---------|-----------|
| Agent card | Maschinenlesbare Fähigkeiten/Endpoints |
| Task execution | Eingehendes `tasks/send` → echter Agent-Runner (`executeAgent`): Conversation anlegen, dann ausführen |
| Mailbox | A2A-Task-Mailbox list/get im Communication-Service |

## Verwandt

- [Observability / Ingress](/docs/de/admin/observability/)
- [Kanäle](/docs/de/communication/channels/)
