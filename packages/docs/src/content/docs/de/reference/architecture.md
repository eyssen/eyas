---
title: Architektur (Verweis)
description: Wo die technischen Spezifikationen liegen, und die übergreifenden Regeln, auf die sich der Rest dieses Handbuchs stützt.
---

Die Benutzerdokumentation endet hier. Für Entwickler:

| Pfad | Inhalt |
|------|--------|
| `docs/eyas-architecture.md` | Die vollständige Modul-Architektur |
| `docs/superpowers/specs/` | Design-Spezifikationen |
| `docs/superpowers/plans/` | Umsetzungspläne |
| `CHANGELOG.md` | Releases |

Diese Dateien sind keine Endnutzer-Handbücher. Die folgenden Abschnitte fassen die Regeln zusammen, die bei jedem Anbieter gelten — API-Modelle, Claude Code CLI, Grok CLI, Kimi Code CLI, lokale Laufzeiten und OpenCode —, und verweisen auf die Seiten, die sie erklären.

## Speicher-Souveränitätsschicht {#memory-sovereignty-layer}

EYAS ist der einzige Speicher, den ein Modell hat. Ein Modell liest ihn nur über den Abrufblock an seiner Nachricht und die Tools `memory_search` / `memory_expand`. Es schreibt nie Speicher — das tut EYAS —, und es erreicht Speicher außerhalb von EYAS auf keinem Kanal:

```text
Der Tool-Aufruf eines Modells kommt über einen dieser Kanäle:
  1. EYAS-Tools in EYAS' eigener Agent-Schleife (API-Anbieter)
  2. EYAS-Tools, die Grok CLI und Kimi Code CLI über die Tool-Bridge aufrufen
  3. Die eingebauten Tools von Claude Code (eine Prüfung, bevor sie laufen)
     und die Berechtigungsanfragen von Claude Code
  4. Berechtigungsanfragen von Grok / Kimi und die Dateien, die sie über
     EYAS lesen oder schreiben
                         |
                         v
        EINE Pfad-Policy. Sie schützt:
          - den Speicher anderer KI-Werkzeuge
          - Obsidian-Vaults
          - die Pfade in security.foreignMemoryPaths
          - EYAS' eigenen Datenordner (Vault, Datenbank, Schlüssel, CLI-Anmeldungen)
          - die Arbeitsbereiche anderer Gespräche
                         |
             +-----------+-----------+
             v                       v
      harte Ablehnung             erlaubt
   (kein KI-Richter, keine Freigabe,
    zählt nicht zur Sperre,
    eine Zeile in Sicherheitsereignisse)

Unter der eigenen Shell der CLIs sperrt die Datei-Sandbox des
Betriebssystems dieselben Orte (Claude Code und Grok CLI; Kimi Code CLI
hat keine).

Speicher hinein:  der Block <eyas-memory> + memory_search / memory_expand
Speicher hinaus:  schreibt nur EYAS
```

Headless-Aufgaben von OpenCode durchlaufen dieselbe Prüfung, und OpenCodes Modell liest Speicher nur über dieselben zwei Tools.

- Wo die Policy greift und was ein Modell zu hören bekommt: [Sicherheit & Datenschutz — Speicher außerhalb von EYAS](/docs/de/admin/security-privacy/#memory-outside-eyas).
- Wie sie vor jedem Release an den echten CLIs bewiesen wird: [Sicherheit & Datenschutz — Wie die Isolation bewiesen wird](/docs/de/admin/security-privacy/#how-isolation-is-proven).
- Was ein Modell stattdessen bekommt: [Speicher — Wie der Abruf funktioniert](/docs/de/knowledge/memory/#how-recall-works) und [Speicher außerhalb von EYAS wird verweigert](/docs/de/knowledge/memory/#memory-outside-eyas-is-refused).

## Speicherlieferung {#memory-delivery}

Abgerufener Speicher erreicht jedes Modell auf dieselbe Weise, auf jedem Einstiegsweg.

- **Ein Erzeuger.** Der Prompt-Assembler ist der einzige Ort, an dem Abruf entsteht, über einen einzigen Abrufdienst. Chat, Hintergrund- und geplante Läufe, Läufe des Board-Bots, God-Mode-Worker, Spezialisten und delegierte Agenten, Teammitglieder, Kanalantworten, Übergaben an Kollegen und OpenCode-Aufgaben laufen alle darüber. Die Abrufanfrage baut der Dienst selbst aus dem Gespräch, sodass jeder Weg gleich sucht.
- **Eine Platzierung.** Der Agent-Runner hängt den Rundenblock — aktuelles Datum und Uhrzeit, dann den Abrufblock — beim Senden der Anfrage an die aktuelle Nutzernachricht. Die gespeicherte Nachricht ändert sich nie, und ein fortgesetzter Lauf bekommt einen frischen Block statt des alten. Nichts, was sich von Runde zu Runde ändert, steht im System-Prompt; er bleibt daher gleich und lässt sich cachen (automatisch bei der Anthropic-API).
- **Auf das Modell bemessen.** Das Lieferprofil jeder Runde kommt aus einem einzigen Fenster-Resolver: das Fenster des Modells aus dem Katalog, sonst das bekannte Fenster des CLI-Anbieters, sonst 200k Tokens. Die Budgets sind für ein 100k-Token-Fenster gesetzt — dort ist der Anteil des Abrufblocks `memory.index.budgetChars`, standardmäßig 2.400 Zeichen — und wachsen mit dem Fenster: bis zum 2,5-Fachen ab 250k Tokens, während unter 100k das Prompt-Budget nie mehr als 35 % des Fensters belegt. Master-Identität und Regeln werden nie gekürzt.
- **Namen für den Host.** Tool-Namen sind kanonisch, und jeder Hinweis nennt sie so, wie der Host des Modells sie listet: `memory_search` bei API-Anbietern, `mcp__eyas__memory_search` in Claude Code, `use_tool` mit `eyas__memory_search` in Grok CLI und `memory_search` auf dem MCP-Server `eyas` in Kimi Code CLI. Ein Modell, das keine Tools aufrufen kann, bekommt weder Tools noch Drill-down-Hinweis und dafür bis zu vier statt zwei Notizen im Volltext.
- **Drill-down.** `memory_search` und `memory_expand` erlauben zusammen 3 Aufrufe pro Runde, bei jedem Anbieter. Ihren Projektbereich bestimmt EYAS auf dem Server aus dem Gespräch, nie aus einem Tool-Argument.
- **Publikum.** Owner-Speicher wird nicht an Außenstehende geschoben. A2A-Aufgaben von Partnern und Kanalantworten in der externen Stimme — oder deren Stimme sich nicht bestimmen lässt — bekommen nur Datum und Uhrzeit, und die Runde hält fest, dass der Abruf zurückgehalten wurde. Die Speicher-Tools selbst bleiben unter dem Security-Gate.
- **Sichtbar.** Jede Runde hält fest, was sie bekam: in der Box **Gelieferter Speicher** ihrer Kontext-Zusammenstellung und in `memoryTiersUsed` ihres Traces. Die Karte **Speicherlieferung nach Provider** unter **Beobachtbarkeit → Kontext** vergleicht die Anbieter. Siehe [Gespräche — Kontext-Zusammenstellung](/docs/de/daily/conversations/#context-composition) und [Observability & Ops](/docs/de/admin/observability/#memory-delivery-by-provider).

## Eine Bindung, ein Tool-Bereich, ein Weg für Spezialisten {#binding-tools-specialists}

- **Eine Modellbindung pro Runde.** Jede Runde läuft auf dem Modell, an das ihr Gespräch gebunden ist — ein festes Modell, der Standard des Kollegen oder Auto-Routing. Die Bindung steht fest, bevor der Prompt zusammengestellt wird, sodass seine Größe und seine Tool-Namen zu diesem Modell passen. Ein Modell, das du gewählt hast, wird nie still ausgetauscht; ein Modell, das EYAS selbst festgelegt hat, fällt mit einem Hinweis zurück. Siehe [Gespräche — Welches Modell antwortet](/docs/de/daily/conversations/#which-model-answers).
- **Ein Weg für Spezialisten.** Spezialisten laufen immer über EYAS mit `run_specialist`, bei jedem Anbieter, als Untergespräche mit eigenem überwachtem Lauf. Das eigene Subagent-Tool von Claude Code wird nicht angeboten. Siehe [Teams und Delegation](/docs/de/agents/teams/).
- **Ein Tool-Bereich.** Ein Agent bekommt seine Tool-Liste plus `memory_search` und `memory_expand` (eine leere Liste bedeutet alle Tools), und Solo entfernt die Delegations-Tools. Derselbe Bereich gilt auf jedem Laufweg und bei jedem Anbieter, auch für die EYAS-Tools, die eine CLI über die Bridge erreicht; ein Aufruf außerhalb davon wird abgelehnt. Siehe [Erstellen & konfigurieren — Tools & Einschränkungen](/docs/de/agents/configure/#tools--constraints).

## Reasoning-Effort und nachgewiesene CLI-Versionen {#effort-and-cli-versions}

- **Effort.** Die Stufe wird pro Modell bestimmt, in dem Moment, in dem ein Modell antwortet — nach Routing, einem neuen Versuch oder einem Fallback erneut —, und an das angepasst, was dieses Modell unterstützt. Jeder Anbieter übersetzt sie nur in seinen eigenen Parameter, und ein Modell, über das EYAS keine geprüften Fakten hat, bekommt keinen. Claude Code CLI, Grok CLI und Kimi Code CLI melden die Stufe zurück, mit der sie tatsächlich liefen. Siehe [Anbieter — Wie jeder Anbieter die Effort-Stufe anwendet](/docs/de/ai/providers/#effort-by-provider).
- **Nachgewiesene CLI-Versionen.** Die CLI-Isolation wird beim Start jeder Session geprüft, und jede CLI-Version wird vor dem Release durch die Release-Prüfung (`bun run test:live-cli`) bewiesen. `eyas doctor` vergleicht die installierte Binärdatei mit der zuletzt nachgewiesenen Version. Siehe [Anbieter — Nachgewiesene CLI-Versionen](/docs/de/ai/providers/#proven-cli-versions).

## Beobachtbarkeit bei jedem Anbieter {#observability-on-every-provider}

- **Tool-Aufrufe, einmal gezählt.** Ein Trace zählt die Aufrufe, die das Modell EYAS zur Ausführung übergeben hat, und die, die eine CLI in ihrer eigenen Schleife erledigt hat — ihre eingebauten Tools und EYAS-Tools über die Bridge —, jeden einmal, bei jedem Anbieter gleich.
- **Von einer CLI ausgeführte Tools werden protokolliert, nicht erneut ausgeführt.** Ein Tool, das eine CLI selbst ausgeführt hat, bekommt eine Zeile im Tool-Ausführungsprotokoll unter seinem kanonischen Namen, mit seinem Lauf. EYAS führt es kein zweites Mal aus und gibt es nicht noch einmal frei, und aus dem Protokoll gelangt nichts in den Speicher: Ob Tool-Ausgaben im Speicher landen, entscheidet allein `memory.l0.captureToolResults`. Siehe [Werkzeuge — Tool-Ausführungsprotokoll](/docs/de/automation/tools/#tool-execution-log).
- **Speicher pro Runde.** Traces tragen `memoryTiersUsed`, die abgerufenen Einträge gezählt nach Präfix der Speicher-Id, und `GET /api/v1/observability/memory-parity` fasst Abruf und Drill-downs je antwortendem Anbieter zusammen. Siehe [Observability & Ops](/docs/de/admin/observability/#usage-tab).
- **EYAS' eigene Modellaufrufe.** Hintergrundarbeit — Titel, Speichererfassung, der Security-Judge, … — läuft auf dem Hintergrundmodell und wird wie eine Gesprächsrunde getraced und aufs Budget angerechnet. Siehe [Routing & Budget — Das Hintergrundmodell](/docs/de/ai/routing-budget/#background-model).

## Für Mitwirkende {#for-contributors}

- **Modellaufrufe.** Backend-Code ruft das Modell-Gateway nur von einer kurzen, geprüften Liste aus direkt auf: der Agent-Runner, die Chat-Stream-Route, die Modell-API-Routen, das Tracing, das Gateway selbst und einige isolierte interaktive Einzelaufrufe (Zuerst planen, der God-Mode-Prüfer, Design). Hintergrundarbeit läuft über den Hintergrundmodell-Dienst. `tests/modules/model/no-direct-model-calls.test.ts` schlägt bei jedem anderen direkten Aufruf fehl.
- **Dieses Handbuch.** Englisch ist die Quelle, und die fünf Übersetzungen behalten dieselben Überschriften in derselben Reihenfolge. Eine übersetzte Überschrift behält mit dem Suffix `## Überschrift {#english-id}` den englischen Anker, sodass `/docs/<lang>/<page>/#<id>`-Links und In-App-Hilfe-Hashes in jeder Sprache funktionieren und die Überschrift im Inhaltsverzeichnis der Seite bleibt. Eine Id mit `--` übersteht die typografische Umwandlung nicht, die vorher läuft; eine solche Überschrift nutzt stattdessen ein rohes `<h3 id="…">`. Ein einziger Test, `tests/contracts/handbook-locale-parity.test.ts`, schlägt fehl, wenn eine gelistete Seite zwischen den Sprachen abweicht (Überschriften, Anker, Form der Überschrift, Tabellenzeilen) oder wenn irgendein Handbuch-Link auf einen Anker zeigt, den seine Seite nicht hat. Aufbau und Ton der Seiten: `packages/docs/PAGE_TEMPLATE.md`.
