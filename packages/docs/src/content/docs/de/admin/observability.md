---
title: Observability & Ops
description: Token-Telemetrie, Traces, Kosten, God-Mode-Läufe, Prompt-Kontext-Kosten und Speicherlieferung pro Anbieter.
---

**Wozu das dient.** Observability (`/observability`) ist die Telemetrie-Oberfläche dieser Instanz: Traces, Kosten, Latenz, Anomalien, Ensemble- (God-Mode-) Läufe, was das Modell *tatsächlich* erhalten hat und wie gleichmäßig jeder Anbieter den EYAS-Speicher bekommen hat. **Ops** (`/ops`) ist Remediation. Hände, Remote-Knoten, Erweiterungen und Benachrichtigungseinstellungen liegen **nicht** auf dieser Seite — sie haben eigene Kapitel.

| Bereich | Route | Bedeutung |
|---------|-------|-----------|
| Observability | `/observability` | Seite **KI-Observability** (Sidebar **Beobachtbarkeit**) — Tabs **Nutzung**, **God Mode**, **Kontext** |
| Ops | `/ops` | Kubernetes-Ops-Agent — beobachten → diagnostizieren → vorschlagen → freigeben → anwenden. Default **nur vorschlagen**. Cluster-URL, kubeconfig und GitOps-Repo sind Instanz-Konfiguration, keine Produkt-Defaults. |

Anderswo (nicht diese Seite): [Hände](/docs/de/admin/hands/) (`/hands`), [Remote-Knoten](/docs/de/admin/nodes/) (`/nodes`) — inklusive bewachtem SSH-Invoke, [Ingress](/docs/de/admin/ingress/) (`/ingress`), [Erweiterungen](/docs/de/admin/extensions/) (`/extensions`), [Benachrichtigungen](/docs/de/admin/notifications/) (`/notifications-settings`).

## Wann du es brauchst

- Du willst wissen, was KI-Aufrufe pro Tag und pro Modell kosten und welche davon EYAS' eigene Hintergrundarbeit waren.
- Ein Zug war langsam, teuer oder hat Tools benutzt, und du willst seinen Trace.
- Du willst Antworten bewerten oder sehen, wie ein God-Mode-Rennen entschieden wurde.
- Du willst sehen, was wirklich im Prompt stand, welche Abschnitte gekürzt wurden und wie weit die Token-Schätzung danebenliegt.
- Du willst prüfen, dass jeder Anbieter — API-Modelle wie CLIs — denselben Speicher bekommen hat.

## Typischer Ablauf

1. Öffne **Beobachtbarkeit** in der Sidebar (`/observability`).
2. Grenze auf **Nutzung** die Trace-Tabelle mit **Modell**, **Von**, **Bis** und **Zweck** ein; bewerte einen Trace mit Daumen hoch / Daumen runter am Ende seiner Zeile.
3. Öffne **God Mode** für Ensemble-Rennen und Siegquoten.
4. Öffne **Kontext** und beginne mit **Speicherlieferung nach Provider**, danach die Karten zu Abschnittsdurchschnitten, Kürzungen und Geschätzt vs. tatsächlich.

## Funktionen

<h3 id="usage-tab">Tab Nutzung</h3>

**Nutzung** ist Token-Telemetrie: die Karten **Traces gesamt**, **Gesamtkosten**, **Durchschn. Latenz** und **Anomalien**, **Tägliche Kosten**, **Modellverteilung**, **Aktive Anomalien** und die Trace-Tabelle — **Zeitstempel**, **Modell**, **Provider**, **Zweck**, **Tokens**, **Kosten**, **Latenz**, **Tools**, **Qualität** — mit den Filtern **Modell**, **Von**, **Bis** und **Zweck** darüber.

**Modell und „geantwortet hat".** Die Spalte **Modell** behält die Modell-Id, die du gewählt hast, damit Beschriftungen und Preise stabil bleiben. Hat der Anbieter ein anderes konkretes Modell gemeldet — eine datierte Modellversion, die Wahl eines Routers wie OpenRouter auto, das in Ollama oder LM Studio geladene Modell, das Modell, das Grok tatsächlich ausgeführt hat —, zeigt eine zweite Zeile *geantwortet hat &lt;Modell&gt;*. Hintergrund-Läufe der Speichererfassung werden ebenfalls diesem konkreten Modell zugeordnet.

**Effort.** Der Trace jedes KI-Aufrufs hält den angeforderten Reasoning-Effort fest, den tatsächlich genutzten nach der Anpassung an das Modell und woher die Anforderung kam (Unterhaltung, Tief, Kollege, delegierende Unterhaltung, Routing-Stufe, Modellstandard, …). Siehe [Anbieter — Reasoning-Effort](/docs/de/ai/providers/#reasoning-effort).

**Zweck.** Ein Hintergrund-Modellaufruf — einer, den EYAS für sich selbst macht, kein Gesprächszug — zeigt seine Zweckgruppe in der Spalte **Zweck**:

| Beschriftung | Hintergrundaufrufe |
|--------------|--------------------|
| **Gedächtnis** | Speichererfassung, nächtliche Konsolidierung, das Reflexions-Briefing, Anreicherung im Datenimport |
| **Lernen** | Der Heartbeat, Selbstlernen, Forge, das Schreiben von Skills |
| **Titel** | Automatische Titel |
| **Sicherheitsprüfungen** | Security-Judge, Vollständigkeitsprüfung, Rubrik-Planer |
| **Planung** | Teamvorschläge, der Neuplaner zwischen den Phasen |
| **Recherche** | Recherche-Läufe |
| **Triage** | Der Klassifizierer des Auto-Routings |

Ein Gesprächszug (ein normaler Chat- oder Agentenzug) zeigt *—*, ebenso Traces aus Versionen, die noch keinen Zweck aufzeichneten. Der Filter **Zweck** bietet **Alle Aufrufe** (Default) oder eine Gruppe; eine Gruppe listet nur ihre Hintergrundaufrufe (Gesprächszüge passen nie), und ein Filterwechsel springt auf die erste Seite zurück. Jeder Hintergrundaufruf wird wie ein Gesprächszug als Trace erfasst — Anbieter, Modell, Tokens, Kosten, Latenz, angeforderter und tatsächlicher Effort (Quelle *Routing-Stufe*) —, und seine Kosten zählen wie Gesprächszüge gegen die Tages-, Wochen- und Monatslimits des Budgets. Ein Hintergrundaufruf, der mangels geeignetem Modell nicht laufen konnte, macht keinen Modellaufruf, hinterlässt keinen Trace und kostet nichts. Auto-Titel-Aufrufe werden ihrem Gespräch zugeordnet. Wohin die Aufrufe jeder Gruppe gehen: [Routing & Budget — Hintergrund-Modellaufrufe](/docs/de/ai/routing-budget/#background-model-calls-card).

**Tools.** Die Spalte **Tools** zählt die Tool-Aufrufe eines Traces bei jedem Anbieter gleich: einen Aufruf, den das Modell an EYAS zur Ausführung zurückgegeben hat, und einen Aufruf, den eine CLI in ihrer eigenen Schleife ausgeführt hat — Claude Code, Grok CLI und Kimi Code CLI —, egal ob es ein eingebautes Werkzeug der CLI war (Shell, Dateilesen, …) oder ein EYAS-Tool, das sie über die EYAS-Bridge aufgerufen hat. Jeder Aufruf zählt einmal. Frühere Versionen zeigten für jeden CLI-Zug 0.

**Qualität.** Die Spalte **Qualität** ist deine eigene Bewertung: Daumen hoch / Daumen runter am Ende einer Zeile markieren den Trace als *gut* oder *schlecht*. EYAS bewertet Traces nicht automatisch; eine Zahl in dieser Spalte stammt aus einem Trace, den eine ältere Version aufgezeichnet hat.

**Token-Zahlen bedeuten bei jedem Anbieter dasselbe.** *Input*-Tokens sind die Prompt-Tokens, die **nicht** aus dem Cache des Anbieters kamen; Cache-Reads (und bei Anthropic Cache-Writes) werden getrennt gezählt. Frühere Versionen zählten bei OpenAI-Familie und Gemini den gecachten Anteil in den Input-Tokens mit; ihre Input-Zahlen in cache-lastigen Gesprächen sind jetzt also kleiner, und der gecachte Anteil erscheint als Cache-Reads. Reasoning- bzw. Thinking-Tokens gehören zu den *Output*-Tokens; Gemini-Thinking-Tokens fehlten früher, daher sind die Output-Zahlen bei Gemini-Thinking-Modellen jetzt höher. OpenAI-Reasoning-Tokens und Gemini-Thinking-Tokens werden außerdem getrennt als Reasoning-Tokens gespeichert, nur zur Information — sie werden nicht doppelt berechnet. Die Zahlen von Grok CLI und Kimi Code CLI folgen derselben Bedeutung. Liefert ein Anbieter gar keine Nutzung (manche kompatiblen Server, ein Ollama-Server ohne Zählung, eine CLI, deren Laufzeit nichts gemeldet hat), wird der Zug als *nicht gemeldet* markiert statt als echte Null gespeichert; das Gespräch zeigt dann *Nutzung nicht gemeldet* und der Laufbaum *—* statt $0. Auf der Anthropic-API ist Prompt-Caching automatisch, deshalb erscheinen für diese Aufrufe Cache-Read- und Cache-Write-Tokens (siehe [Anbieter — Prompt-Caching](/docs/de/ai/providers/#prompt-caching-anthropic-api)).

**Kosten.** Meldet ein Anbieter eigene Kosten, nutzt der Trace diese. Sonst schätzt EYAS sie aus den Token-Zahlen und bepreist jeden Prompt-Token genau einmal: ungecachten Input zum Input-Satz, Cache-Reads zum Cache-Read-Satz des Modells, Cache-Writes zu seinem Cache-Write-Satz. Hat die Preistabelle (oder ein `model.pricing`-Override in der Konfiguration) für ein Modell keinen Cache-Satz, werden seine gecachten Tokens zum normalen Input-Satz berechnet. Ein Aufruf mit *nicht gemeldeter* Nutzung wird nie aus Token-Zahlen bepreist: Seine Kosten sind die, die der Anbieter selbst gemeldet hat, sonst $0. Im Vergleich zu früheren Versionen:

- Kimi K3 über die Kimi-API und jedes Modell mit Cache-Read-Satz in einem `model.pricing`-Override: Die Schätzungen sind niedriger, weil der gecachte Anteil nicht mehr doppelt zählt.
- OpenAI und Gemini mit der eingebauten Tabelle: Die Input-Kosten bleiben gleich.
- Gemini-Thinking-Modelle: Die Schätzungen sind höher, weil Thinking-Tokens als Output berechnet werden.
- Anthropic-kompatible Endpunkte, die nicht in der Tabelle stehen: Gecachte Tokens werden zum konservativen Fallback-Input-Satz berechnet statt kostenlos.
- Claude-Code-Läufe, für die die CLI keine Kosten, aber Token-Zahlen gemeldet hat: Cache-Tokens werden zu den passenden Anthropic-Cache-Sätzen bepreist statt kostenlos.

Es gibt nichts zu konfigurieren und nichts zu migrieren: Neue Trace-Spalten werden automatisch angelegt.

**API (Admins und Integratoren).** `GET /api/v1/observability/traces` (und `/traces/:id`) braucht Leserechte auf das Audit-Protokoll (read `AuditEntry`). Jeder Trace trägt über die Spalten oben hinaus:

- `purpose` (der genaue Zweck, etwa `capture`, `title`, `security_judge`, `triage`), `auxRoute` (wie das Modell gewählt wurde: `tier` = die Routing-Stufe des Zwecks, `default` = der Installations-Default, `api` = ein API-Anbieter, `isolated-cli` = eine CLI, die isoliert laufen kann) und `purposeGroup` — bei Gesprächszügen sind alle drei null;
- `toolCalls` — eine JSON-Liste der Aufrufe, jeweils `{name, id}`, dazu `executedBy` (`provider` oder `eyas`) bei einem Aufruf, den die CLI in ihrer eigenen Schleife erledigt hat;
- `memoryTiersUsed` — JSON-Zählungen des in diesen Zug abgerufenen Speichers pro Ebene: `vt` Vault-Notiz, `gs` Zusammenfassung, `ft` Fakt, `en` Entität, `ep` Episode, `rw` Rohdatensatz, zum Beispiel `{"vt":75,"gs":5,"ft":3}`. Null, wenn der Zug keinen Speicher trug, und bei Aufrufen ohne Kontext-Zusammenstellung (Hintergrundaufrufe).

Die Liste nimmt `purposeGroup=memory|learning|title|safety|planning|research|triage` an. Die Abfrage wird geprüft: Ein unbekanntes `purposeGroup`, ein nicht numerisches oder außerhalb des Bereichs liegendes `limit` (1–500), ein negatives `offset` oder ein nicht numerisches/negatives `minCost` liefert `400`, statt ignoriert zu werden; leere Parameter gelten als nicht angegeben.

<h3 id="god-mode-tab">Tab God Mode</h3>

Der Tab **God Mode** listet Ensemble-Läufe (Gespräch, Gewinner, Modellanzahl, Kosten, Dauer, Stichentscheid), die Siegquote je Modell und das durchschnittliche Kostenvielfache gegenüber einem Einzelmodell. Ein Klick auf einen Lauf öffnet den God-Tab des Gesprächs (Schrittprotokoll, wer für wen stimmte, und die Kommentare jedes Modells zu den anderen).

Wie ein Rennen aufgesetzt wird, wie der Gewinner entschieden wird und wie du den God-Tab des Gesprächs liest: [Gespräche — God-Modus](/docs/de/daily/conversations/#god-modus).

<h3 id="context-tab">Tab Kontext</h3>

Der Tab **Kontext** zeigt, was das Modell *tatsächlich* erhalten hat — nicht, was gesendet werden sollte. Er beginnt mit **Speicherlieferung nach Provider** (unten), danach folgen:

- **Geschätzt vs. tatsächlich** — die Lücke zwischen EYAS' Token-Schätzung und dem vom Anbieter gemeldeten Wert, mit dem mittleren absoluten Fehler;
- **Durchschnittliche Tokens pro Abschnitt** — die durchschnittlichen und maximalen Token-Kosten je Prompt-Abschnitt und auf wie vielen Stichproben das beruht;
- **Kürzungshäufigkeit** — wie oft und welcher Abschnitt zum Einhalten des Budgets gekürzt wird.

Die detaillierten Abschnitts-Datensätze sind bewusst kurzlebig (standardmäßig 7 Tage, `observability.contextRetentionDays`); dauerhaft erhalten bleibt nur das Tages-Rollup. Wer danach nach alten Details sucht, findet keine mehr — das ist beabsichtigt, kein Datenverlust.

<h4 id="memory-delivery-by-provider">Speicherlieferung nach Provider</h4>

Diese Karte zeigt pro Anbieter, ob seine Züge denselben EYAS-Speicher bekommen haben — die Prüfung, dass ein API-Modell und eine CLI den Speicher gleichermaßen erhalten. Den Zeitraum wählst du oben rechts: **Letzte 7 Tage**, **Letzte 30 Tage** oder **Letzte 90 Tage**. Es gibt eine Zeile pro Anbieter, der im Zeitraum Züge beantwortet hat; nach einem Failover zählt ein Zug für den Anbieter, der tatsächlich geantwortet hat.

| Spalte | Bedeutung |
|--------|-----------|
| **Provider** | Die Anbieter-Id. Ein Klick darauf zeigt seine letzten Züge |
| **Runden mit Speicher** | *N von M*: die Züge, deren Nachricht abgerufenen Speicher trug, von allen seinen Zügen |
| **Einträge pro Ebene (Ø)** | Die durchschnittliche Zahl eingefügter Speichereinträge pro Ebene über die Züge mit Speicher, als Ebenen-Badges (`vt`, `gs`, `ft`, `en`, `ep`, `rw`); beim Überfahren eines Badges erscheint der Name der Ebene |
| **Speicher-Tokens (Ø)** | Der Durchschnitt der eigenen Token-Schätzungen der eingefügten Einträge über die Züge mit Speicher |
| **Drill-downs pro Runde** | *X Aufrufe · Y Einträge*, gemittelt über alle Züge: die `memory_search`- / `memory_expand`-Aufrufe, die das Modell selbst gemacht hat und die etwas gelesen haben, und die Speichereinträge, die diese Aufrufe gelesen haben |

Ein Klick auf einen Anbieter listet seine letzten 10 Züge: die Zeit (ein Link, der das Gespräch öffnet), das Modell, die Einträge pro Ebene oder *kein Speicher*, die Speicher-Tokens und die Drill-downs (*Aufrufe · Einträge*, oder nur *Einträge* bei Zügen, die aufgezeichnet wurden, bevor Aufrufnummern protokolliert wurden).

**So vergleichst du Anbieter.** Ähnliche Werte bei **Runden mit Speicher** und **Einträge pro Ebene (Ø)** bedeuten, dass jedes Modell denselben Speicher bekommen hat. **Drill-downs pro Runde** zeigen, ob ein Modell den Speicher auch selbst öffnet: Eine CLI mit deutlich weniger Drill-downs als die API-Modelle erreicht die EYAS-Speicher-Tools nicht oder nutzt sie nicht.

Die Karte wird aus den Details der Kontext-Zusammenstellung gebaut und reicht daher nur so weit zurück wie `observability.contextRetentionDays` (standardmäßig 7 Tage): **Letzte 30 Tage** und **Letzte 90 Tage** zeigen nur dann mehr, wenn diese Aufbewahrung erhöht wird. Ein Zug, dessen Abruf nicht Eintrag für Eintrag protokolliert wurde, zählt als Zug, aber ohne Einträge.

**API.** `GET /api/v1/observability/memory-parity?days=N` — `N` ist eine ganze Zahl von 1 bis 90 (Default 7); nötig ist dieselbe Berechtigung read `AuditEntry` wie bei den anderen Observability-Endpunkten, ein ungültiges `days` liefert `400`. Die Antwort lautet `{days, since, providers: [{provider, turns, memoryTurns, avgItemsByLayer, avgItems, avgMemoryTokens, drillDownTurns, avgDrillDownCalls, avgDrillDownReads, recentTurns: [{compositionId, createdAt, conversationId, model, hasMemory, itemsByLayer, items, memoryTokens, drillDownCalls, drillDownReads}]}]}`.

<h4 id="single-turn-composition">Die Zusammenstellung eines einzelnen Zugs</h4>

Die Zusammenstellung eines einzelnen Zugs öffnest du über die Kontextleiste des Gesprächs — siehe [Gespräche — Kontext-Zusammenstellung](/docs/de/daily/conversations/#context-composition): die gemessene oder geschätzte Fensterfüllung, die Datenschutz-Badges pro Abschnitt und das Feld **Gelieferter Speicher**. `GET /api/v1/observability/compositions/:id` liefert dasselbe: `composition.egress` und pro Abschnitt `egress` (`{masked, spans, skipped}`) für das, was die Datenschutzschicht getan hat; `composition.delivery` (turnId, profile, budgetTotalTokens, recall — ids, hits, retrieved, expanded, chars, budgetChars, tokens, budgetTokens, withheld — und systemPromptChannel); und `composition.drillDown` (`{calls, reads, limit}`). Jedes Feld ist null, wenn nichts aufgezeichnet wurde; `drillDown` ist außerdem null, wenn das Speicher-Zugriffsprotokoll nicht lesbar ist. Der Listen-Endpunkt bleibt unverändert. Im Speicher-Zugriffsprotokoll teilen sich die Abruf- und Drill-down-Zeilen eines Zugs eine Zug-ID (die ID der Zusammenstellung), und Drill-down-Zeilen halten die Nummer des Aufrufs innerhalb des Zugs fest.

## Verwandt

- [Mission Control](/docs/de/agents/runs/)
- [Routing & Budget](/docs/de/ai/routing-budget/)
- [Speicher](/docs/de/knowledge/memory/)
- [Mehrere Instanzen](/docs/de/deploy/multi-instance/)
- [Sicherheit](/docs/de/admin/security-privacy/)
- [Einstellungen-Übersicht](/docs/de/admin/settings/)
- [Hände](/docs/de/admin/hands/)
- [Remote-Knoten](/docs/de/admin/nodes/)
- [Erweiterungen](/docs/de/admin/extensions/)
- [Benachrichtigungen](/docs/de/admin/notifications/)
