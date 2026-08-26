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

`/observability` hat drei Tabs: **Usage** (bestehende Traces / Stats), **God Mode** und **Kontext**. Der God-Mode-Tab listet Ensemble-Läufe (Conversation, Gewinner, Modellanzahl, Kosten, Dauer, Stichentscheid), die Gewinnrate je Modell und das durchschnittliche Kostenvielfache gegenüber einem Einzelmodell. Klick auf einen Lauf öffnet den God-Tab der Conversation (Schritttagebuch, wer für wen stimmte, Gegenbewertung).

Kader, Entscheidungsregeln und God-Tab: [Gespräche — God-Modus](/docs/de/daily/conversations/#god-modus).

### Kontext-Tab

Der **Kontext**-Tab beantwortet eine Frage, die bisher nichts in EYAS beantworten konnte: was das Modell *tatsächlich* erhalten hat — nicht was gesendet werden sollte. Er zeigt die durchschnittlichen und maximalen Token-Kosten je Prompt-Abschnitt (und auf wie vielen Messwerten das beruht), die Kürzungshäufigkeit (wie oft und welcher Abschnitt zum Einhalten des Budgets gekürzt wird) sowie Geschätzt vs. tatsächlich: die Lücke zwischen der Token-Schätzung und dem vom Provider gemeldeten Wert — damit lässt sich der Fehler dieser Schätzung erstmals messen.

Die Aufbewahrungsfrist der detaillierten Abschnitts-Datensätze ist kurz (standardmäßig 7 Tage); dauerhaft erhalten bleibt nur das Tages-Rollup. Wer danach nach alten Details sucht, findet keine mehr — das ist beabsichtigt, kein Datenverlust.

## Verwandt

[Mission Control](/docs/de/agents/runs/) · [Sicherheit](/docs/de/admin/security-privacy/)
