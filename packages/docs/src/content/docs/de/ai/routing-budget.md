---
title: Routing & Budget
description: Auto-Routing-Stufen, Fallbacks, Hintergrund-Modellaufrufe, Ausgabenlimits und Modellzuweisungen pro Agent.
---

**Wozu das da ist.** Routing entscheidet, *welches* Modell antwortet — an welches Modell ein neues Gespräch gebunden wird, über welche Stufen ein auf Auto gestelltes Gespräch geroutet wird und auf welchem Modell die Hintergrundarbeit von EYAS läuft. Das Budget entscheidet, *wie viel* du ausgibst, bevor EYAS warnt, herabstuft oder hart stoppt. Modellzuweisungen heften nach dem Setup jedem eingebauten Agenten ein Standardmodell an. Zusammen verhindern sie, dass eine Instanz mit mehreren Anbietern immer das teure Modell nimmt oder still das Geld aufbraucht.

**Route:** `/providers` (Sidebar **Anbieter**) → Tabs **Routing-Stufen** und **Budget**. Modellzuweisungen: Einstellungen (`/settings`) → Karte **Modellzuweisungen**.

## Wann du es brauchst

- Auf Auto gestellte Gespräche sollen für schnelle Fragen ein günstiges Modell bekommen und für Code ein stärkeres.
- Die Hintergrundarbeit — Titel, Heartbeat, Security-Judge, Speichererfassung — soll auf einem Modell laufen, das du wählst (die Stufe **Heartbeat**).
- Eine primäre Cloud/CLI ist unzuverlässig, und du willst einen expliziten **Fallback** (oder das zuschaltbare Auto-Failover).
- Du brauchst Tages-/Wochen-/Monatslimits, eine Warnschwelle, eine Herabstufung und einen harten Stopp.
- Eingebaute Agenten haben nach dem Assistenten noch kein Modell — weise es in den Einstellungen zu.

## Typischer Ablauf

1. Öffne **Anbieter** (`/providers`) → **Routing-Stufen**.
2. Prüfe oben die Karte **Hintergrund-Modellaufrufe**: Jede Gruppe der Hintergrundarbeit sollte ein Modell zeigen, nicht *Kein Modell — deterministischer Fallback*.
3. Schalte **Automatisches Routing erlauben** auf **Ein**, wenn auf Auto gestellte Gespräche per Nachrichtenanalyse geroutet werden dürfen (Hinweis: *Wenn eingeschaltet, wählt eine auf automatisches Routing gestellte Unterhaltung ihr Modell für jede Nachricht. Unterhaltungen mit festem Modell oder dem Standard des Kollegen werden nie umgeleitet.*).
4. Setze pro Stufe den **Primär**-Anbieter und das Modell, einen optionalen **Fallback** und den Standard-**Aufwand** der Stufe.
5. Öffne **Budget**: fülle unter **Ausgabenlimits** **Täglich / Wöchentlich / Monatlich**, dann unter **Schwellenwerte** **Warnung bei / Herabstufung bei / Harter Stopp bei**.
6. Öffne **Einstellungen** → **Modellzuweisungen**, hefte jedem Seed-Agenten einen Anbieter und ein Modell an, dann **Zuweisungen speichern**.

## Funktionen

<h3 id="auto-failover">Anbieterübergreifendes Auto-Failover (zuschaltbar)</h3>

Ist **Auto-Failover** eingeschaltet (`EYAS_AUTO_FAILOVER=1` oder `model.autoFailover: true` in der Konfiguration), füllt ein zweiter aktiver Anbieter beim Start leere **Fallback**-Plätze der Stufen. **Von dir gesetzte Fallbacks werden nie überschrieben.**

Das hilft bei einer unzuverlässigen primären Cloud/CLI; für Kosten- und Qualitätskontrolle sind selbst gewählte Fallbacks trotzdem besser.

Monatliche Token-Budgets pro Agent sind davon getrennt (Agenten-Tab **Konfiguration**).

<h3 id="default-binding">Welches Modell antwortet, wenn keines genannt ist</h3>

Manche EYAS-Aufrufe nennen weder Anbieter noch Modell: die erste Nachricht eines neuen Gesprächs (das Gespräch behält danach dieses Modell — siehe [Gespräche — Welches Modell antwortet](/docs/de/daily/conversations/#which-model-answers)), KI-Bearbeitungen in Design und Agentenläufe, deren Agent kein Modell hat. Sie gehen an den **Installations-Default**, geprüft in dieser Reihenfolge:

1. die Routing-Stufe **Standard**, wenn ihr Anbieter aktiviert ist;
2. sonst der Default-Anbieter und das Default-Modell der Installation — gesetzt, wenn du im [Setup-Assistenten](/docs/de/setup-wizard/) die **Primäre CLI** wählst, oder mit `PUT /api/v1/model/defaults`;
3. sonst der aktivierte Anbieter, der alphabetisch zuerst kommt und mindestens ein aktiviertes Modell hat.

Kein Anbieter wird wegen seines Namens bevorzugt, und die Startreihenfolge der Anbieter spielt keine Rolle. Gibt es nichts davon, schlägt der Aufruf mit *No default model binding: configure the Standard tier or a default provider* fehl, statt zu raten. Frühere Versionen schickten solche Aufrufe an Anthropic, wenn es konfiguriert war, sonst an den Anbieter, der sich zufällig zuerst registrierte — auf einer Installation mit mehreren Anbietern ohne Standard-Stufe können diese Aufrufe daher jetzt an einen anderen Anbieter gehen als vorher. Die Standard-Stufe (oder der Default-Anbieter) steuert das.

<h3 id="background-model">Das Hintergrundmodell</h3>

Die Hintergrundarbeit von EYAS läuft nie auf einem Anbieter, den das Gateway zufällig wählt. Sie geht durch einen Resolver, der feste Kandidaten der Reihe nach probiert und nur ein Modell nutzt, das einen **isolierten** Aufruf ausführen kann — keine Tools, ein Zug, nichts vom eigenen Speicher oder der Konfiguration der CLI. Geeignet sind jeder API-Anbieter, Claude Code sowie Grok CLI / Kimi Code CLI, sobald EYAS ihre Isolation auf diesem Host geprüft hat. Eine CLI, die nicht isolieren kann, wird nie genutzt, weder als Kandidat noch als **Fallback** einer Stufe.

| Hintergrundarbeit | Kandidaten, der Reihe nach |
|-------------------|----------------------------|
| Gesprächstitel | Nur die Stufe **Heartbeat** — nie das eigene Modell des Gesprächs oder ein anderer Anbieter |
| Speichererfassung, nächtliche Konsolidierung, das Reflexions-Briefing, das Heartbeat-Briefing, Vorschläge von Selbstlernen, Forge-Vorschläge, Skill-Erstellung, Anreicherung im Datenimport | Stufe **Heartbeat** (primär, dann Fallback) → Installations-Default → API-Anbieter alphabetisch → CLIs, die isoliert laufen können |
| Security-Judge, Vollständigkeitsprüfung, Rubrikplan für komplexe Hintergrundziele | **Heartbeat** → **Schnell** → Installations-Default → andere geeignete Anbieter |
| Teamvorschlag und der Neuplaner zwischen den Phasen | **Schnell** → **Standard** → Installations-Default → andere geeignete Anbieter |
| Recherche (Abfrageerweiterung, Quellenbewertung, Schreiben, Gegenprüfung) | **Standard** → Installations-Default → API-Anbieter → CLIs, die isoliert laufen können |
| Klassifizierer des Auto-Routings | Nur die Stufe **Triage** (primär, dann Fallback) — siehe [Auto-Routing](#auto-routing) |

Ein zweiter Kandidat wird nur nach einem Netzwerk-, Timeout-, Überlast- oder Rate-Limit-Fehler probiert, nie nachdem der erste geantwortet hat (in der Praxis probiert das nur die Sicherheitsgruppe). Ein Budget-**Stopp** bedeutet überhaupt keinen Aufruf.

<h4 id="background-effort">Aufwand der Hintergrundaufrufe</h4>

Jeder Hintergrundaufruf fordert den Denkaufwand an, der auf der ersten Routing-Stufe seines Zwecks eingestellt ist: die Stufe **Heartbeat** für Speicherarbeit, Lernarbeit, Titel und die Sicherheitsprüfungen; **Schnell** für Neuplanung und Teamvorschläge; **Standard** für Recherche; **Triage** für den Klassifizierer des Auto-Routings. Derselbe Stufenaufwand gilt, welches Modell auch antwortet — das Modell der Stufe, der Installations-Default, ein API-Anbieter oder eine CLI, die isoliert laufen kann —, und er wird an dieses Modell angepasst: Eine nicht unterstützte Stufe rückt auf die nächste, die es annimmt. Triage, Schnell und Heartbeat stehen standardmäßig auf *Niedrig*, daher fordern die meisten Hintergrundaufrufe standardmäßig Niedrig an; Recherche folgt Standard, das standardmäßig auf Automatisch steht. Eine auf Automatisch gestellte Stufe sendet keinen Aufwandsparameter. Hat das Modell keine Aufwandssteuerung oder kann EYAS nicht erkennen, welches Modell antwortet (eine CLI ohne bestimmtes Modell aufgerufen, häufig auf reinen CLI-Installationen), wird nichts gesendet und der eigene Standard des Modells gilt.

<h4 id="background-traced">Erfasst und angerechnet</h4>

Jeder Hintergrundaufruf wird wie ein Gesprächszug als Trace erfasst — Anbieter, Modell, Tokens, Kosten, Latenz, sein Zweck, angeforderter und tatsächlicher Aufwand —, und seine Kosten zählen wie Gesprächszüge gegen die Tages-, Wochen- und Monatslimits des Budgets. Ein Hintergrundaufruf, der mangels geeignetem Modell nicht laufen konnte, macht keinen Modellaufruf: Er hinterlässt keinen Trace und kostet nichts. Siehe [Observability — Nutzung](/docs/de/admin/observability/#usage-tab).

Jeder Hintergrundaufruf sendet seine Anweisungen als echten System-Prompt und genau eine Benutzernachricht, bei jedem Anbieter — nie als Benutzer- oder Assistentenzeile.

<h4 id="background-no-model">Wenn kein Modell geeignet ist</h4>

Etwa auf einer reinen Grok- oder Kimi-Installation, bevor ihre Isolation geprüft ist, macht EYAS keinen Modellaufruf, und jede Funktion behält ihr deterministisches Ergebnis: Der Anfang der ersten Nachricht bleibt der Titel; der Heartbeat sendet den Alarm *Heartbeat: items may need your attention* mit seiner Liste von Gründen; Selbstlernen zeigt seine allgemeinen Vorschläge; Forge behält den zusammengefügten Vorschlag; Skill Evolution schreibt die Vorlage `SKILL.md`; die Speichererfassung protokolliert ein Auslassen; die Konsolidierung lässt Cluster für eine spätere Nacht liegen; das Briefing behält seinen deterministischen Teil; der Security-Judge eskaliert zu deiner Freigabe; die Vollständigkeitsprüfung markiert den Lauf als *Nicht geprüft*; der Teamvorschlag ist ein einzelner Agent; die Recherche baut ihren Bericht aus den besten Quellen. Auf einer Installation, auf der Claude Code das einzige Modell ist, startet jeder solche Aufruf einen kurzen, isolierten Claude-Code-Prozess.

<h3 id="background-model-calls-card">Karte Hintergrund-Modellaufrufe</h3>

Der Tab **Routing-Stufen** beginnt mit der Karte **Hintergrund-Modellaufrufe**. Sie zeigt, wohin die Hintergrundarbeit von EYAS gerade geht, ohne einen Modellaufruf zu machen. Es gibt eine Zeile pro Gruppe:

| Gruppe | Was sie umfasst |
|--------|-----------------|
| **Gedächtnis: Erfassung, Konsolidierung, Reflexion, Import-Anreicherung** | Erfassung, nächtliche Konsolidierung, das Reflexions-Briefing, Anreicherung im Datenimport |
| **Lernen: Heartbeat, Selbstlernen, Forge, Skill-Erstellung** | Der Heartbeat, Selbstlernen, Forge, Skill-Erstellung |
| **Gesprächstitel** | Automatische Titel |
| **Sicherheit: Sicherheitsprüfer, Vollständigkeitskritiker, Ziel-Rubrik** | Security-Judge, Vollständigkeitsprüfung, Ziel-Rubrik |
| **Planung: Teamvorschlag, Neuplaner** | Teamvorschlag, der Neuplaner zwischen den Phasen |
| **Recherche** | Recherche-Läufe |
| **Triage für automatisches Routing** | Der Klassifizierer des Auto-Routings |

Jede Zeile zeigt entweder den Anbieter und das Modell, das der nächste Aufruf der Gruppe nutzen würde, als *Anbieter · Modell*, mit einem Badge, woher es kommt — **Stufe** (die Routing-Stufe der Gruppe, primär, dann Fallback), **Standard** (der Installations-Default), **API-Anbieter** oder **Isolierte CLI** (eine CLI, die isolierte Aufrufe ausführen kann; sie zeigt nur ihren Anbieternamen, weil sie ihr eigenes Standardmodell nutzt) — oder **Kein Modell — deterministischer Fallback** mit dem Grund:

- *Kein Anbieter kann einen isolierten Aufruf ausführen* — nichts Geeignetes ist aktiviert, etwa eine reine Grok- oder Kimi-Installation, bevor EYAS ihre Isolation geprüft hat, oder eine Stufe, die eine solche CLI nennt;
- *Die Stufe ist nicht konfiguriert* — nur für Titel und Triage, die nur ihre Stufe nutzen;
- *Budgetgrenze erreicht* — ein Budget-Stopp blockiert jeden Hintergrundaufruf.

Die Karte zeigt den ersten Kandidaten. Hat eine Gruppe keinen geeigneten Anbieter, sagt ein rotes Banner, dass es für einen Teil der Hintergrundarbeit kein zulässiges Modell gibt, sie daher ihren eingebauten Fallback nutzt und kein Modell aufruft, und bittet dich, einen API-Anbieter oder eine CLI zu aktivieren, deren Isolation EYAS geprüft hat. Eine fehlende Stufe oder ein Budget-Stopp zeigt seinen Grund in der Zeile, aber kein Banner. Die Karte aktualisiert sich, wann immer du den Tab Routing-Stufen öffnest, und nach jeder Stufenänderung auf diesem Tab.

**API (Integratoren).** `GET /api/v1/routing/auxiliary` (read Settings; `401` ohne Anmeldung, `403` ohne die Berechtigung) liefert `{ groups: [ { group, purposes, target: { provider, model | null, route } | null, reason | null } ] }` — `group` ist `memory`, `learning`, `title`, `safety`, `planning`, `research` oder `triage`; `route` ist `tier`, `default`, `api` oder `isolated-cli`; `reason` ist `no_eligible_provider`, `tier_not_configured` oder `budget_stop`. `503` kommt nur, wenn der Hintergrundmodell-Dienst nicht verfügbar ist. Hintergrundaufrufe sind in den [Observability](/docs/de/admin/observability/)-Traces mit ihrem Zweck beschriftet.

## Felder und Bedienelemente

<h2 id="auto-routing">Auto-Routing</h2>

| Bedienelement | Bedeutung |
|---------------|-----------|
| **Automatisches Routing erlauben** Ein/Aus | Erlaubt Auto-Routing für auf Auto gestellte Gespräche. Andere Gespräche werden nicht geroutet |
| Hinweis | *Wenn eingeschaltet, wählt eine auf automatisches Routing gestellte Unterhaltung ihr Modell für jede Nachricht. Unterhaltungen mit festem Modell oder dem Standard des Kollegen werden nie umgeleitet.* |

**Nur auf Auto gestellte Gespräche werden geroutet.** Ein Gespräch behält das Modell, auf dem es läuft: Ein festes Modell oder das Modell seines Kollegen wird nie triagiert. Bei einem auf Auto gestellten Gespräch wird die Nachricht klassifiziert und an die Stufe **Schnell**, **Standard**, **Komplex** oder **Codeausführung** geroutet. Solange der Schalter aus ist, nutzt ein Auto-Gespräch sein gespeichertes Modell und sagt das. Zeigen alle Stufen auf dasselbe Modell (etwa auf einer Installation mit nur einer CLI), wird gar nicht klassifiziert. Auto-Routing wählst du pro Gespräch im Modellwähler seiner oberen Leiste; der Eintrag ist ausgegraut, solange **Automatisches Routing erlauben** aus ist. Siehe [Gespräche — Welches Modell antwortet](/docs/de/daily/conversations/#which-model-answers).

**Der Klassifizierer.** Zuerst kommen Stichwortregeln, und die kosten nichts: Eine Nachricht, die sie einordnen (etwa eine Übersetzung, ein Code-Review oder eine Debugging-Anfrage), macht keinen Modellaufruf. Nur eine Nachricht, die sie nicht einordnen können, geht an das Modell der Stufe **Triage** — ihr Primär-Modell oder, wenn das nicht nutzbar ist, ihren Fallback, und nur, wenn dieser Anbieter isolierte Aufrufe ausführen kann. Es fällt nie auf die Standard-Stufe, den Installations-Default oder einen anderen Anbieter zurück. Der Aufruf ist isoliert (keine Tools, kein Speicher und keine Konfiguration des Anbieters, keine gespeicherte Sitzung), sendet nur die ersten 500 Zeichen der Nachricht, läuft durch dieselbe Datenschutz-Maskierung und dasselbe Tracing wie jeder andere Modellaufruf und zählt zu den Ausgabenlimits. Gibt es kein solches Modell, ist der harte Stopp des Budgets erreicht oder ist die Antwort keine gültige Kategorie und Komplexität, entscheidet die Stichwortklassifizierung, und der Zug verzögert sich nicht. Auf einer reinen Claude-Code-Installation wartet eine nicht eingeordnete Nachricht in einem Auto-Gespräch trotzdem auf einen kurzen, isolierten Claude-Code-Aufruf, bevor die Antwort beginnt.

<h2 id="tiers">Routing-Stufen</h2>

Jede Stufe hat einen **Primär**-Anbieter und ein Modell sowie einen optionalen **Fallback**:

| Stufe | Typische Nutzung |
|-------|------------------|
| **Triage** | Der Klassifizierer des Auto-Routings für Nachrichten, die die Stichwortregeln nicht einordnen können (nur primär und Fallback) |
| **Schnell** | Schnelle, günstige Antworten |
| **Standard** | Standardqualität — außerdem der Installations-Default für Aufrufe, die kein Modell nennen ([oben](#default-binding)) |
| **Komplex** | Schwierige Aufgaben |
| **Codeausführung** | Code-lastige Arbeit |
| **Heartbeat** | Erste Wahl für die Hintergrundarbeit von EYAS — Titel (der einzige Kandidat), der Heartbeat, Speichererfassung, der Security-Judge und mehr ([oben](#background-model)) |
| **Embedding** | Speist nur den älteren Vault- und episodischen Suchindex. Der Speicherabruf nutzt ihn nie: Der Abruf bettet immer lokal ein (siehe [Speicher — Die Vektorsuche läuft immer lokal](/docs/de/knowledge/memory/#vector-search-always-runs-locally)). Nennt die Stufe einen Anbieter, der nicht einbetten kann, nutzt auch dieser Index den lokalen Embedder; ändert sich sein Embedder, wird der Index einmal geleert und automatisch neu aufgebaut |
| **Prompt-Optimierung** | Der Prompt Enhancer im Eingabefeld des Gesprächs und der Prompt-Coach bei Projekten und Agenten ([Prompts](/docs/de/ai/prompts/)) |

| Feld | Bedeutung |
|------|-----------|
| **Provider auswählen…** | Primärer Anbieter der Stufe |
| **Modell auswählen…** | Primäres Modell |
| **Fallback** (**Fallback auswählen…** / **Keiner**) | Ersatz, wenn der primäre ausfällt |
| **Aufwand** | Der Standard-Denkaufwand der Stufe (jede Stufe außer **Embedding**) — siehe [unten](#tier-effort) |

Auf einer Kimi-Code-CLI-Installation werden Stufen, die EYAS selbst auf die stillgelegten Zeilen *Kimi Code CLI (K3)*, *(K2.7 Code)* oder *(K2.6)* gesetzt hatte, beim Start auf **Kimi Code CLI** (die Standardzeile) verschoben, die sie ohnehin immer ausgeführt haben; eine neue reine Kimi-Installation startet jede Stufe darauf, ohne Fallback. Siehe [Anbieter — Kimi-Modelle und Thinking](/docs/de/ai/providers/#kimi-models-and-thinking).

<h3 id="tier-effort">Standardaufwand der Stufe</h3>

Jede Routing-Stufe außer **Embedding** hat eine Auswahl **Aufwand**: den Standard-Denkaufwand für Aufrufe, die an diese Stufe geleitet werden. **Triage**, **Schnell** und **Heartbeat** stehen standardmäßig auf *Niedrig*, jede andere Stufe auf *Automatisch* (der eigene Standard des Modells). Die Auswahl listet nur die Stufen, die das Modell der Stufe annimmt; wählst du ein Modell, das die gespeicherte Stufe nicht anbietet, wird sie vor dem Speichern geändert, und die Oberfläche sagt das (*Aufwand von … auf … angepasst*); eine Stufe, die das Modell nicht annimmt, wird abgelehnt: *Das Modell bietet diese Aufwandsstufe nicht an. Es wurde nichts gespeichert.*

Der Standard der Stufe gilt an zwei Stellen:

- **Bei einer über die Stufe gerouteten Nachricht**, wenn nichts weiter oben in der Reihenfolge eine Stufe setzt: eigene Stufe der Unterhaltung > Tief (Maximum) > Kollege > delegierende Unterhaltung > Routing-Stufe > Modellstandard.
- **Bei den Hintergrundaufrufen von EYAS**, deren erste Stufe sie ist — Heartbeat für Speicher, Lernen, Titel und die Sicherheitsprüfungen; Schnell für Neuplanung und Teamvorschläge; Standard für Recherche; Triage für den Klassifizierer ([oben](#background-effort)).

Den Aufwand einer Stufe zu ändern, ändert also sowohl die über sie gerouteten Nachrichten als auch die Hintergrundaufrufe, die sie nutzen. Bestehende Installationen haben den Standard *Niedrig* einmal bekommen, beim ersten Start nach dem Upgrade; eine Stufe, die du später wieder auf Automatisch stellst, bleibt Automatisch. `PUT /api/v1/routing/tiers/:tier` prüft seinen Body: Eine unbekannte Stufe liefert `404`, ein Aufwand, den das Modell der Stufe nicht annimmt, `400` mit dem Code `EFFORT_UNSUPPORTED` und den angenommenen Stufen. Siehe [Anbieter — Reasoning-Effort](/docs/de/ai/providers/#reasoning-effort).

<h2 id="budget">Budget / Ausgabenlimits</h2>

| Feld | Bedeutung |
|------|-----------|
| **Täglich / Wöchentlich / Monatlich** (**Ausgabenlimits**) | Dollar-Limit für den Zeitraum; leer bedeutet *unbegrenzt* |
| **Warnung bei** (**Schwellenwerte**) | Warnschwelle als Anteil des Limits (als Prozent angezeigt; Standard 0,8 = 80 %) |
| **Herabstufung bei** | Wechsel zu günstigeren Modellen (Standard 1,0 = 100 %) |
| **Harter Stopp bei** | Weitere Ausgaben sperren, Hintergrundaufrufe eingeschlossen (Standard 1,2 = 120 %) |

<h2 id="model-assignments">Modellzuweisungen (Einstellungen)</h2>

Der authentifizierte Ersatz für den optionalen Schritt KI-Modelle des Assistenten (dieser Schritt ist gesperrt, sobald das Setup abgeschlossen ist).

| Bedienelement | Bedeutung |
|---------------|-----------|
| Agentenname | Eingebauter / Seed-Agent |
| Modellauswahl | **— keins —** oder ein Modell eines aktivierten Anbieters, angezeigt als *Anbieter / Modell* |
| **Zuweisungen speichern** | PUT `/api/v1/model/agent-assignments` (`manage Model`) |

Beim Speichern werden Anbieter und Modell zusammen gespeichert, sodass eine Modell-Id, die zwei Anbieter listen, nie mehrdeutig ist. Die API nimmt `{assignments: {agentId: {providerId, modelId}}}` oder das ältere `{agentId: modelId}`; eine Modell-Id, die mehrere Anbieter listen, wird dann ohne Anbieter gespeichert. Ist ein Modell nicht im Katalog, liefert sie `400` mit `code: unknown_model` und den `agents`, und nichts wird geschrieben.

Die Karte blendet sich aus, solange es keine Seed-Agenten oder keine Modelle gibt.

## Verwandt

- [Anbieter](/docs/de/ai/providers/)
- [Observability](/docs/de/admin/observability/)
- [Agenten — Token-Budget](/docs/de/agents/configure/)
- [Prompts](/docs/de/ai/prompts/)
- [Proaktiv](/docs/de/automation/proactive/)
