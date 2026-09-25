---
title: Erstellen & konfigurieren
description: Name, Modell, Tools, Budget und Kanalbindungen eines Agenten setzen.
---

**Wozu das da ist.** Der Tab **Konfiguration** ist die gespeicherte Identität eines Agenten: Name, Rolle, Modell, Aufwand, Tools, Einschränkungen und monatliches Token-Budget. Workspace-Dateien und Stimmprofile sind eigene Tabs. Das füllst du beim Anlegen aus, und das änderst du, wenn sich die Aufgabe verschiebt.

## Wann du es brauchst

- Du legst einen Agenten an und brauchst Name, Typ, Modell und Tool-Liste.
- Ein Coding-Agent auf einem API-Modell soll `read_file` / `edit_file` / `grep` bekommen, ohne von einer CLI abzuhängen.
- Ein monatliches Token-Limit soll Ausgaben stoppen, oder du willst es aufheben (`0` = unbegrenzt).
- Eingehendes Telegram (oder ein anderer Kanal) soll bei diesem Agenten landen.
- Der Prompt-Coach soll den System-Prompt straffen — nicht die Stimme, nicht die Projektdomäne.

## Typischer Ablauf

1. Öffne **Agenten** → klicke den Agenten (oder **Agent erstellen**) — Route `/agents/:id`, Tab **Konfiguration**. Das Assistenten-Gespräch von **Agent erstellen** nennt kein Modell: Es läuft auf dem Standard der Installation, der mit seiner ersten Nachricht festgelegt wird.
2. Fülle **Name**, **Rolle**, **Stufe**, **Agent-Typ**, **Modell** (Anbieter + Modell oder **Eigenes Modell der Unterhaltung**), **Aufwand**, **Tools (durch Komma getrennt)**, **Einschränkungen (eine pro Zeile)**.
3. Setze ein **Monatliches Token-Budget**, wenn du einen Deckel willst. Binde auf dem Tab **Kanäle** einen Kanal, wenn eingehende Nachrichten hier landen sollen.
4. **Änderungen speichern**. Eine neue Unterhaltung mit diesem Agenten nutzt dieses Modell, diese Tool-Liste und diesen Prompt.

## Funktionen

Der Seitenkopf zeigt die Zusammenfassung **Token-Budget** und, solange ein Lauf aktiv ist, **Wird ausgeführt…**. Tabs: **Konfiguration**, **Erinnerungen**, **Stimme**, **Arbeitsbereich**, **Kanäle**.

## Klassifizierung

| Feld | Bedeutung |
|------|-----------|
| **Stufe** | **Primär** / **Team** = Kollegen, mit denen du sprichst; **Spezialist** = gemeinsamer Spawn-Pool (siehe [Übersicht](/docs/de/agents/overview/)) |
| **Agent-Typ** | **Assistent**, **Ingenieur**, **Entwickler**, **Prüfer**, **Kritiker**, **Rechercheur**, **Planer**, **Koordinator**, **Beobachter** |

## Persona

| Feld | Bedeutung |
|------|-----------|
| **Name** | Anzeigename |
| **Rolle** | Kurze Rollenzeile |
| **Beschreibung** | Längere Beschreibung |
| **Ziel** | Was die Entscheidungen treibt (*Was die Entscheidungen dieses Agenten bestimmt*) |
| **Hintergrund** | Kontext, der das Vorgehen prägt (*Kontext, der den Ansatz und die Sichtweise des Agenten prägt*) |
| **Avatar** | In der Oberfläche angezeigtes Emoji |
| **System-Prompt** | Anweisungen auf Agentenebene (kombiniert mit den geschichteten Prompts) |
| **Prompt-Coach** | KI-Coach für den System-Prompt (nur Betriebsprotokoll — nicht Stimme, nicht Projektdomäne) — [Prompts](/docs/de/ai/prompts/#prompt-coach) |

<h2 id="model--effort">Modell & Aufwand</h2>

| Feld | Bedeutung |
|------|-----------|
| **Modell** | Ein Anbieter plus ein Modell, gewählt aus einer nach Anbieter gruppierten Liste — oder **Eigenes Modell der Unterhaltung** (leer): Der Kollege läuft dann auf dem Modell der Unterhaltung — dem Modell des delegierenden Zugs oder dem Standard der Installation, der bei der ersten Nutzung festgelegt wird (siehe [Teams und Delegation](/docs/de/agents/teams/#which-model-and-effort-a-specialist-or-member-uses)) |
| Zurücksetzen-Knopf | *Eigenes Modell der Unterhaltung verwenden* — leert das Modell; Speichern leert es wirklich |
| Rote Notiz | *&lt;Anbieter&gt; / &lt;Modell&gt; ist kein aktiviertes Modell eines aktiven Anbieters. Bis es wieder verfügbar ist, läuft dieser Kollege mit dem eigenen Modell der Unterhaltung.* |
| **Aufwand** | Dieselbe Aufwand-Auswahl wie in Unterhaltungen: nur die Stufen, die das Modell des Agenten anbietet (aus **Keiner**, **Minimal**, **Niedrig**, **Mittel**, **Hoch**, **Sehr hoch**, **Maximum**; **An** / **Aus** bei einem An/Aus-Modell), zuerst **Automatisch** mit dem Standard des Modells (*Automatisch · Modellstandard (Mittel)*). Wählst du ein Modell, das die gespeicherte Stufe nicht anbietet, wird sie vor dem Speichern geändert, und das wird gesagt (*Aufwand von Sehr hoch auf Hoch angepasst: Das gewählte Modell bietet Sehr hoch nicht an.*); ein Modell ohne Aufwandssteuerung setzt sie auf Automatisch. Eine Stufe, die das Modell nicht unterstützt, wird nicht gespeichert, und eine Meldung nennt die unterstützten Stufen — deine übrigen Änderungen bleiben im Formular. Ohne festes Modell bietet die Auswahl jede Stufe an, die ein Modell einer Stufe des automatischen Routings annimmt. Der Aufwand des Kollegen gilt überall, wo er läuft — in seinem Chat, seinem Home-Thread, bei Kanal-Antworten und als geerbte Stufe der Spezialisten, an die er delegiert. Siehe [Anbieter — Denkaufwand](/docs/de/ai/providers/#reasoning-effort). |
| Aufwand-Hinweis | *Denkaufwand dieses Kollegen — nur die Stufen, die sein Modell anbietet, werden angezeigt; ein Modellwechsel passt eine Stufe an, die das neue Modell nicht anbietet. Automatisch = der eigene Standard des Modells.* |
| **Max. Runden** | Harte Obergrenze für Modell-Rundläufe pro Lauf — für die Chat-Züge dieses Kollegen und für seine Hintergrund-, Spezialisten-, Team- und Kanalläufe. Bei Claude Code, Grok und Kimi ist sie zugleich die eigene Rundengrenze der CLI. Bei einem Agenten ohne gespeicherten Wert zeigt das Feld 10, und Speichern übernimmt die angezeigte Zahl. Ohne gespeicherten Wert erlaubt ein Chat-Zug 25 Rundläufe, ein Hintergrund-, Team- oder Kanallauf 20 und ein Spezialistenlauf 10. |

Andere Felder zu speichern (Name, Prompt …) schickt das Modell nicht erneut mit — eine Bearbeitung scheitert also nie daran, dass das Modell inzwischen ausgeschaltet wurde.

**Upgrade.** Beim ersten Start nach dem Upgrade bekommt jeder bestehende Agent, dessen Modell-ID im Modellkatalog unter genau einem Anbieter steht, diesen Anbieter automatisch. Modell-IDs unter mehreren Anbietern, unbekannte IDs und Stufennamen wie `sonnet` bleiben ohne Anbieter; sie werden zur Laufzeit ihrem Besitzer zugeordnet, und wenn das nicht geht, wird das eigene Modell der Unterhaltung genutzt.

<h2 id="tools--constraints">Tools & Einschränkungen</h2>

| Feld | Bedeutung |
|------|-----------|
| **Tools (durch Komma getrennt)** | Tool-Namen, die dieser Agent aufrufen darf. Platzhalter: *Leer = alle Tools · z. B. read_file, grep, research*. Hinweis: *Leer = alle Tools. Gilt im Chat und bei jedem Provider – auch für die eigenen Schreib-, Shell- und Web-Tools eines CLI-Modells. Die Speichersuche ist immer verfügbar; bei einem CLI-Modell auch das Lesen von Dateien in den Ordnern der Unterhaltung.* |
| **Fähigkeiten (durch Komma getrennt)** | Fähigkeits-Tags (z. B. `research, coding`) |
| **Einschränkungen (eine pro Zeile)** | Harte Regeln (z. B. keine destruktiven Vorgänge) |

### Was die Tool-Liste bedeutet

Die Liste gilt auf jedem Weg, auf dem ein Agent läuft, gleich: interaktiver Chat, geplante und Board-Läufe einer Unterhaltung, mit `run_specialist` / `delegate_to_agent` gestartete Spezialisten, Teammitglieder und Kanal-Antworten (Telegram, Slack, E-Mail und die übrigen Kanäle) — und bei jedem Anbieter: API-Modelle und die CLI-Modelle Claude Code, Grok und Kimi.

- **Eine leere Liste bedeutet alle Tools.**
- Sonst bekommt der Agent **genau die gelisteten Tools, plus `memory_search` und `memory_expand`**. Diese beiden EYAS-Speichertools bekommt jeder Agent immer, auch wenn seine Liste sie auslässt.
- In einer **Solo**-Unterhaltung werden außerdem `run_specialist`, `delegate_to_agent`, `handoff_to_colleague` und `propose_team` entfernt; `memory_search`, `memory_expand` und `assign_task` (Board-Arbeit) bleiben.
- Das Tool-Verzeichnis im System-Prompt des Agenten nennt nur die Tools, die der Lauf tatsächlich angeboten bekommt.
- **Ein Modell kann nur ein angebotenes Tool nutzen.** Nennt ein Modell ein Tool außerhalb der Liste oder eines, das es nicht gibt, lehnt EYAS den Aufruf mit *'&lt;tool&gt;' is not in this agent's toolset* ab und führt ihn nicht aus. Es gibt keine Freigabeanfrage; er wird direkt abgelehnt, bei jedem Anbieter.
- **Unbekannte Namen fallen weg.** Ein Name, der kein installiertes Tool ist (ein Tippfehler, ein deaktiviertes Modul, ein nicht verbundener MCP-Server), wird nicht angeboten, und das Server-Log zeigt eine Warnung pro Agent und Tool-Name.
- **Bei den CLI-Modellen (Claude Code, Grok, Kimi) begrenzt die Liste auch die eingebauten Werkzeuge der CLI selbst**, bei jeder CLI gleich:
  - **Dateien schreiben** (Write, Edit, NotebookEdit von Claude Code; die Bearbeiten- und Verschieben-Werkzeuge von Grok und Kimi sowie Dateischreibvorgänge, die EYAS der CLI bereitstellt): nur, wenn die Liste `write_file` oder `edit_file` enthält.
  - **Shell-Befehle** (Bash von Claude Code; die Ausführen-Werkzeuge von Grok und Kimi; ein Löschen zählt als Shell-Befehl, so wie das Security-Gate es einstuft): nur, wenn die Liste `run_command` enthält. `git_status` und `git_diff` gewähren keine Shell; auf einer Liste ohne `run_command` werden sie der CLI stattdessen als EYAS-Tools über die Bridge angeboten.
  - **Web-Abruf und Websuche** (WebFetch, WebSearch von Claude Code; die Abruf-Werkzeuge von Grok und Kimi, Groks web_fetch und web_search): nur, wenn die Liste ein Web-Tool enthält — `research`, `browser_navigate`, `agent_browser_run` oder `browser_use_exec`.
  - **Dateien lesen** (Read, Glob, Grep von Claude Code; die Lese-, Such- und Auflistungs-Werkzeuge von Grok und Kimi) ist immer erlaubt, egal was die Liste sagt. Es bleibt in den Ordnern der Unterhaltung, unter der Speicher-Policy und der Kernel-Datei-Sandbox. Auch die Speichersuche bleibt verfügbar.
  - Eine leere Liste bedeutet weiterhin alle Tools, die eigenen Werkzeuge der CLI eingeschlossen.

  Auf Claude Code werden die zurückgehaltenen Werkzeuge dem Modell gar nicht erst angeboten. Auf Grok und Kimi lehnt EYAS ein zurückgehaltenes Werkzeug, das die CLI nutzen will, ab, bevor das Security-Gate gefragt wird: keine Freigabeanfrage, und die Tool-Zeile zeigt **Abgelehnt**. Kimis Berechtigungsanfragen sagen nicht, welche Art von Werkzeug fragt (aus dem Quellcode von Kimi 1.52.0; noch nicht auf einem Host geprüft), daher kann ein Agent, dessen Liste entweder die Schreib-Tools oder `run_command` nicht enthält, keines der fragenden Werkzeuge von Kimi nutzen (Datei schreiben oder ersetzen, Shell, Hintergrundaufgaben). Kimis Websuche und Web-Abruf fragen EYAS nie und lassen sich daher nicht pro Agent erlauben; die Isolationsprüfung von EYAS stoppt einen Zug, der sie nutzt, trotzdem. Siehe [Anbieter — Claude-Code-Isolation](/docs/de/ai/providers/#claude-code-isolation).
- Über die EYAS-Bridge — den In-Process-Server von Claude Code wie die Grok/Kimi-MCP-Bridge — steuert die Liste die EYAS-Tools, die die CLI erreicht. EYAS-Tools, für die die CLI ein gewährtes eigenes Gegenstück hat (`read_file`, `grep`, `glob` immer; `write_file`, `edit_file`, solange sie schreiben darf; `run_command`, `git_status`, `git_diff`, solange sie ihre Shell nutzen darf), werden nicht gebridgt: Die CLI nutzt ihre eigenen Werkzeuge unter dem Security-Gate, der Speicher-Policy und der Kernel-Datei-Sandbox. Die EYAS-Tools für Browser, agent-browser, browser-use und OpenCode erreichen CLI-Modelle ebenfalls. Siehe [MCP — CLI-Tool-Parität](/docs/de/ai/mcp/#cli-mcp-tool-parity-grok--kimi).

**Verhaltensänderung für bestehende Agenten:** Eine schmale Liste wird überall eingehalten. Der **Persönliche Assistent** bekommt zum Beispiel kein `run_command` / `write_file` im Chat, im Hintergrund, als Spezialist oder im Team — wie seine Vorlage es vorsieht —, und auf Claude Code, Grok und Kimi kann er auch über Write, Edit oder Bash der CLI selbst keine Dateien mehr schreiben und keine Befehle mehr ausführen. Um ein Tool zu gewähren, füge es der Liste hinzu (`write_file` / `edit_file` zum Schreiben, `run_command` für die Shell), oder leere die Liste, um alle Tools zu erlauben. Agenten, deren Liste Tools nennt, die es nicht gibt, verlieren diese Namen (mit einer Warnung im Log), und ein Modell, das ein Tool außerhalb seiner angebotenen Liste aufruft, bekommt eine Ablehnung.

### Coding-Agenten (modellunabhängige Oberfläche)

Für Implementieren, Fixen oder Review auf einem API-Modell gewährst du die erstklassigen Datei-Tools, damit das Modell ohne Shell bearbeiten kann:

```
read_file, write_file, edit_file, grep, glob, git_status, git_diff, run_command, search_indexed, list_search_sources
```

| Tool | Einsatz |
|------|---------|
| `read_file` / `edit_file` / `write_file` | Lesen und gezielt bearbeiten in den Arbeitsordnern oder im Worktree |
| `grep` / `glob` | Symbole und Dateien finden |
| `git_status` / `git_diff` | Review-Helfer (nur lesend) |
| `run_command` | Tests/Lint (rote Stufe — Freigabe / Autonomie) |

Die CLI-Modelle (Claude Code, Grok, Kimi) nutzen stattdessen ihre eigenen Datei- und Shell-Werkzeuge, und diese Namen in der Liste sind es, die sie ihnen erlauben: `write_file` / `edit_file` schalten die eigenen Dateischreibvorgänge der CLI frei, `run_command` ihre Shell. Ohne `run_command` erreichen `git_status` und `git_diff` eine CLI als EYAS-Tools über die Bridge.

Der **Persönliche Assistent** (primär, Typ Assistent) koordiniert — gib ihm kein `write_file` / `edit_file` / `run_command`. Der **Systemingenieur** und die Coding-Spezialisten besitzen diese Tools. Siehe [Teams und Delegation](/docs/de/agents/teams/).

**Bestehende Agenten**, die vor 0.8.6 angelegt wurden, übernehmen neue Tools **nicht** automatisch — füge sie hier hinzu (oder spiele eine aktualisierte Vorlage neu ein). Vollständiger Katalog: [Werkzeuge](/docs/de/automation/tools/).

<h2 id="imported-personas">Importierte Personas</h2>

Agenten können aus Persona-Dateien in den Ordnern unter `agent.importRoots` in `local.yaml` stammen (siehe [Konfiguration — Zusätzliche Skill- und Persona-Wurzeln](/docs/de/deploy/configuration/#extra-skill-and-persona-roots)). Ein Agent, den du in EYAS bearbeitest, wird **nie** von seiner Datei überschrieben:

- Beim ersten Start legt eine Datei ihren Agenten an.
- Spätere Änderungen an der Datei aktualisieren den Agenten nur, solange **Name, Rolle, Beschreibung, System-Prompt und Tools** genau so sind, wie der letzte Import sie hinterlassen hat. Sobald du eines dieser fünf hier bearbeitest, ändert die Datei den Agenten nicht mehr.
- Nur Modell, Aufwand, An/Aus-Schalter, Avatar, Tags oder Budget zu ändern stoppt die Aktualisierungen nicht, weil der Import diese nie schreibt.
- Ein importierter Agent, den du löschst, wird nicht neu angelegt. Um ihn zurückzuholen, importiere die Datei mit dem [Datenimport](/docs/de/admin/data-port/).
- Ein bestehender Agent mit derselben ID, den der Import nicht angelegt hat — eine eingebaute Vorlage, einer aus der Oberfläche oder einer aus dem Datenimport —, wird nie überschrieben. Stimmt er bereits exakt mit der Datei überein, wird er übernommen und folgt späteren Dateiänderungen.
- Enthalten zwei Import-Ordner eine Persona mit derselben ID, gewinnt der zuerst gelistete Ordner; wird diese Datei entfernt, übernimmt die Datei des nächsten Ordners.

**Upgrade.** Von früheren Versionen importierte und seitdem nicht bearbeitete Agenten werden automatisch übernommen. Bearbeitete bleiben genau, wie sie sind.

## API (Integratoren)

- `PATCH /api/v1/agents/:id` validiert seinen Body wie beim Anlegen: Unbekannte Felder wie `source` oder `id` werden ignoriert, ungültige Werte ergeben `400` mit Details (ein nicht unterstützter Aufwand ergibt Code `EFFORT_UNSUPPORTED` mit den unterstützten `levels` des Modells), und ein unbekannter Agent ergibt `404`.
- `POST` / `PATCH /api/v1/agents` nehmen `provider` zusammen mit `model` an. Das Paar muss ein aktiviertes Modell eines aktiven Anbieters sein; sonst lautet die Antwort `400` mit `code: model_binding_unavailable`, `providerId` und `modelId`, und nichts wird gespeichert. `provider` ohne `model` → `400`.
- `model` allein (die ältere Form) wird weiter angenommen; sein Anbieter wird ergänzt, wenn genau ein Anbieter die Modell-ID führt.
- `provider: null, model: null` (oder ein leeres Modell) leert beide. `GET`-Antworten enthalten `provider`.

## Budget

| Feld | Bedeutung |
|------|-----------|
| **Monatliches Token-Budget** | Deckel für den Monat; **`0` = unbegrenzt** |
| Token-Verbrauch | Verbraucht vs. Budget in der Liste und im Seitenkopf |

## Aktionen

| Element | Bedeutung |
|---------|-----------|
| **Änderungen speichern** | Konfiguration speichern |

## Tab Erinnerungen (nur lesende Liste)

| Element | Bedeutung |
|---------|-----------|
| **Episodisch / Arbeit** | Filter nach Speicherstufe |
| *N Erinnerungen* | Anzahl |
| *Relevanz: N* | Wichtigkeitswert |
| *N× abgerufen* | Zugriffszähler |
| *Erste N von M Zeichen — die ganze Erinnerung ist gespeichert* | Eine lange Erinnerung wird nur in der Liste gekürzt |
| Leer-Hinweis | *Erinnerungen erscheinen hier, während der Agent interagiert und lernt.* |

## Tab Kanäle (Überblick)

Binde Kanal-Instanzen, damit eingehende Nachrichten diesen Agenten erreichen. Vollständige Feldliste: [Kanäle — Übersicht](/docs/de/communication/channels/).

| Element | Bedeutung |
|---------|-----------|
| **Kanal-Instanz binden** | Eine bestehende Telegram-/…-Instanz wählen |
| **An diesen Agenten binden** | Anbinden |
| **Lösen** | Lösen |
| Status **Verbunden / Fehler / Zugangsdaten gesetzt / Nicht konfiguriert** | Zustand der Instanz |
| Modus **Autonom** | Der Kanal darf autonome Bearbeitung auslösen |

## Verwandt

- [Identität & Workspace](/docs/de/agents/identity-workspace/)
- [Teams und Delegation](/docs/de/agents/teams/)
- [Stimmprofile](/docs/de/agents/voice/)
- [Anbieter](/docs/de/ai/providers/)
