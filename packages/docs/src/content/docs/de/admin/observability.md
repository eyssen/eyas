---
title: Observability & Ops
description: Metriken, Ops, Hands, Nodes (SSH), Ingress, Extensions.
---

| Bereich | Route | Bedeutung |
|---------|-------|-----------|
| Observability | `/observability` | Metriken / Tracing |
| Ops | `/ops` | Ops / Remediation |
| Hands | `/hands` | Computer-use Hub |
| Nodes | `/nodes` | Remote-Nodes — **SSH-Invoke** mit Destruktiv-Guard |
| [Ingress](/docs/de/admin/ingress/) | `/ingress` | Tunnel / Remote Access |
| Extensions | `/extensions` | Extension-Katalog |
| Notifications | `/notifications-settings` | Benachrichtigungen |

### God-Mode-Tab

`/observability` hat zwei Tabs: **Usage** (bestehende Traces / Stats) und **God Mode**. Der God-Mode-Tab listet Ensemble-Läufe (Conversation, Gewinner, Modellanzahl, Kosten, Dauer, Stichentscheid), die Gewinnrate je Modell und das durchschnittliche Kostenvielfache gegenüber einem Einzelmodell. Klick auf einen Lauf öffnet den God-Tab der Conversation (Schritttagebuch, wer für wen stimmte, Gegenbewertung).

Kader, Entscheidungsregeln und God-Tab: [Gespräche — God-Modus](/docs/de/daily/conversations/#god-modus).

## Verwandt

[Mission Control](/docs/de/agents/runs/) · [Sicherheit](/docs/de/admin/security-privacy/)
