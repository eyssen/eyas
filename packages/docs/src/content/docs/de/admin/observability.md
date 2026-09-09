---
title: Observability & Ops
description: Token-Telemetrie, Traces, Kosten, God-Mode-Läufe und Prompt-Kontext-Kosten.
---

**Wozu das dient.** Observability (`/observability`) ist die Telemetrie-Oberfläche dieser Instanz: Traces, Kosten, Latenz, Anomalien, Ensemble- (God-Mode-) Läufe und was das Modell tatsächlich erhalten hat. **Ops** (`/ops`) ist Remediation. Hände, Remote-Knoten, Erweiterungen und Benachrichtigungseinstellungen liegen **nicht** auf dieser Seite — sie haben eigene Kapitel.

| Bereich | Route | Bedeutung |
|---------|-------|-----------|
| Observability | `/observability` | Metriken / Tracing — Tabs **Usage**, **God Mode**, **Kontext** |
| Ops | `/ops` | Kubernetes-Ops-Agent — beobachten → diagnostizieren → vorschlagen → freigeben → anwenden. Default **nur vorschlagen**. Cluster-URL, kubeconfig, GitOps-Repo sind Instanz-Config. |

Anderswo (nicht diese Seite): [Hände](/docs/de/admin/hands/) (`/hands`), [Remote-Knoten](/docs/de/admin/nodes/) (`/nodes`) — inklusive bewachtem SSH-Invoke, [Ingress](/docs/de/admin/ingress/) (`/ingress`), [Erweiterungen](/docs/de/admin/extensions/) (`/extensions`), [Benachrichtigungen](/docs/de/admin/notifications/) (`/notifications-settings`).

### Usage-Tab

**Usage** ist Token-Telemetrie: **Total Traces**, **Total Cost**, **Avg Latency**, **Anomalies**, Tageskosten, Modellverteilung und die Trace-Tabelle (Zeitstempel, Modell, Anbieter, Tokens, Kosten, Latenz, Tools, Qualität).

### God-Mode-Tab

`/observability` hat drei Tabs: **Usage** (bestehende Traces / Stats), **God Mode** und **Kontext**. Der God-Mode-Tab listet Ensemble-Läufe (Conversation, Gewinner, Modellanzahl, Kosten, Dauer, Stichentscheid), die Gewinnrate je Modell und das durchschnittliche Kostenvielfache gegenüber einem Einzelmodell. Klick auf einen Lauf öffnet den God-Tab der Conversation (Schritttagebuch, wer für wen stimmte, Gegenbewertung).

Kader, Entscheidungsregeln und God-Tab: [Gespräche — God-Modus](/docs/de/daily/conversations/#god-modus).

### Kontext-Tab

Der **Kontext**-Tab beantwortet eine Frage, die bisher nichts in EYAS beantworten konnte: was das Modell *tatsächlich* erhalten hat — nicht was gesendet werden sollte. Er zeigt die durchschnittlichen und maximalen Token-Kosten je Prompt-Abschnitt (und auf wie vielen Messwerten das beruht), die Kürzungshäufigkeit (wie oft und welcher Abschnitt zum Einhalten des Budgets gekürzt wird) sowie Geschätzt vs. tatsächlich: die Lücke zwischen der Token-Schätzung und dem vom Provider gemeldeten Wert — damit lässt sich der Fehler dieser Schätzung erstmals messen.

Die Aufbewahrungsfrist der detaillierten Abschnitts-Datensätze ist kurz (standardmäßig 7 Tage); dauerhaft erhalten bleibt nur das Tages-Rollup. Wer danach nach alten Details sucht, findet keine mehr — das ist beabsichtigt, kein Datenverlust.

## Verwandt

[Mission Control](/docs/de/agents/runs/) · [Sicherheit](/docs/de/admin/security-privacy/) · [Einstellungen-Übersicht](/docs/de/admin/settings/) · [Hände](/docs/de/admin/hands/) · [Remote-Knoten](/docs/de/admin/nodes/) · [Erweiterungen](/docs/de/admin/extensions/) · [Benachrichtigungen](/docs/de/admin/notifications/)
