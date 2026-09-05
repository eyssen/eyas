---
title: A2A & externe Agenten
description: Agent-to-Agent-Protokoll — Agent Card, eingehende Tasks, optionale Peer-Föderation.
---

**Wozu das da ist.** A2A ist, wie eine andere Agent-Runtime diese EYAS entdeckt und ihr eine Aufgabe übergibt — kein Mensch auf Telegram, keine [Hand](/docs/de/admin/hands/). Agent Card: `/.well-known/agent-card.json`. Inbound `tasks/send` erzeugt ein Gespräch und läuft `executeAgent`. Peer-Föderation existiert als API; **kein** Kommunikations-Tab.

## Wann du es brauchst

- Ein A2A-Client soll diese Instanz entdecken und Tasks senden.
- EYAS hinter [Ingress](/docs/de/admin/ingress/) — Well-known-URL und Auth-Schema.
- Zwei EYAS-Instanzen föderieren (`/api/v1/federation/peers`).

## Typischer Ablauf

1. Trust-Boundary. Nur bei bewusster Netz-Exposition, hinter Auth/Ingress.
2. `GET /.well-known/agent-card.json` (Name, Version, Capabilities, Skills, `authentication.schemes` default `bearer`).
3. Peer sendet `tasks/send` — Gespräch + `executeAgent`, kein Instant-Fail wenn Agenten stehen.
4. Optional Peer: `POST /api/v1/federation/peers`. Inbound-Token einmal teilen; rotieren `POST …/rotate-inbound`. Adresse `peerId/agentId`.
5. Gespräche und A2A-Task-Mailbox.

Default-Skills auf der Karte: `research`, `code-review`. Der Kanalkatalog schließt MCP/A2A als Chat-Karten aus.

## Verwandt

- [Ingress](/docs/de/admin/ingress/)
- [Kanäle](/docs/de/communication/channels/)
- [Agenten](/docs/de/agents/overview/)
- [Werkzeuge](/docs/de/automation/tools/)
