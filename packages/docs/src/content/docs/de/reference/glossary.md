---
title: Glossar
description: Produktbegriffe.
---

| Begriff | Definition |
|---------|------------|
| Agent | Konfigurierter KI-Akteur |
| Kollege | Primary- oder Team-Agent, mit dem du sprichst; ein Home-Thread je Kollege (Sidebar **Kollegen**) |
| Primary | Immer-an Kollegen aus dem Setup (Personal Assistant + System Engineer) |
| Spezialist | Schmaler Arbeiter, den jeder Kollege starten kann (`run_specialist`) |
| Home-Thread | Ein fortlaufendes Gespräch je Kollege |
| Skill | Markdown-Verfahrenspaket |
| Skill-Vorschlag | Passender Skill, auf den die Gesprächsrunde wartet — **Verwenden**, **Diesmal nicht**, oder Owner/Admin **Abschalten** |
| Tool | Aufrufbare Fähigkeit |
| Coding surface | Modellagnostische File-Tools (`read_file`, `edit_file`, `grep`, …) von EYAS, nicht einem Vendor-SDK |
| Worktree | Isolierter Git-Working-Tree für parallele schreibende Spezialisten (`.eyas-worktrees/`) |
| Verify commands | Lint/Test nach einem Agentenlauf vor dem LLM-Critic |
| Tool hook | PreToolUse / PostToolUse bei jeder Tool-Ausführung |
| Tool-Ergebnis | Der abgeschlossene Status eines Tool-Aufrufs in den Tool-Zeilen: *Erfolgreich*, *Fehlgeschlagen*, *Abgelehnt*, *Freigabe nötig* oder *Übersprungen* (*Ergebnis unbekannt*, wenn die Runde vorher endete). Grün wird eine Zeile erst, wenn das Tool wirklich zurückgemeldet hat — bei jedem Anbieter gleich ([Tool-Zeilen](/docs/de/daily/conversations/#tool-trace)) |
| Tool-Ausführungsprotokoll | Die Aufzeichnung jedes Tool-Aufrufs: kanonischer Name, Eingabe, Ausgabe oder Fehlertext, Dauer, Gespräch, Agent und Lauf. Es enthält auch die Tools, die eine CLI in ihrer eigenen Schleife ausgeführt hat (Claude Codes `Bash` als `run_command`). Die Vollständigkeitsprüfung und das Selbstlernen lesen es; nichts daraus gelangt in den Speicher ([Werkzeuge](/docs/de/automation/tools/#tool-execution-log)) |
| Board | Arbeitstracking |
| Gespräch | Chat-Thread |
| Rundenergebnis | Wie eine Chat-Runde endete, als ein Badge unter der Antwort: keins, wenn sie abgeschlossen wurde, sonst *Rundenlimit erreicht*, *Ausgabelimit erreicht*, *Vom Modell abgelehnt*, *Werkzeugbudget aufgebraucht*, *Gestoppt*, *Fehlgeschlagen* oder *Wartet auf Freigabe*. Die bisherige Antwort bleibt immer erhalten ([Rundenergebnis](/docs/de/daily/conversations/#turn-outcome)) |
| Memory-Stufe | Working→episodic→vault→archive |
| Rohaufzeichnung (L0) | Eine wörtliche, komprimierte zweite Kopie jeder Nachricht, die EYAS speichert, dazu Tool-Ausgaben und das Reasoning der Modelle, wenn diese Schalter an sind. Modelle erreichen sie nur über den Abruf; aufgezeichnete Tool-Ausgaben und aufgezeichnetes Reasoning werden nie abgerufen. Schalter: `memory.l0.enabled` ([Die Rohaufzeichnung](/docs/de/knowledge/memory/#the-raw-record)) |
| Vertrauensstufe | Wer einen gemerkten Text geschrieben hat: *owner*, *derived*, *peer*, *ingested* oder *quarantined*. Ein Fakt oder eine Zusammenfassung bekommt nie mehr Vertrauen als der Text, aus dem sie entstanden sind. Gewicht im Abruf: 1 / 1 / 0,3 / 0,6 / nie ([Vertrauen: wer es geschrieben hat](/docs/de/knowledge/memory/#trust-who-wrote-it)) |
| Projektbereich | Der Speicher, den ein Gespräch sehen kann: der seines Projekts, der seines Projekttyps und der globale — nie der eines anderen Projekts. EYAS setzt ihn auf dem Server durch, für den Abruf und jedes Speicher-Tool, egal was das Modell sendet ([Welchen Speicher ein Gespräch sieht](/docs/de/knowledge/memory/#which-memory-a-conversation-can-see)) |
| Speicher-Id | Die Id einer abgerufenen Zeile, die `memory_expand` öffnet. Ihr Präfix nennt die Schicht: `vt:` Vault-Notiz, `gs:` Zusammenfassung, `ft:` Fakt, `en:` Entität, `ep:` Episode, `rw:` Rohaufzeichnung (eine frühere Nachricht). Beobachtbarkeit zählt gelieferten Speicher nach diesen Kürzeln |
| Memory block | Stillgelegt: die früheren geteilten Notizen, die Agenten über `memory_block_*`-Tools lasen und schrieben — beim Upgrade einmal in den EYAS-Speicher kopiert |
| Vault | Markdown-Langzeitgedächtnis |
| Capture run | Eine Post-Turn Durable-Memory-Extraktion; jedes Ergebnis schreibt `memory_capture_runs`. Schalter: `memory.capture.enabled` |
| Design canvas | Multi-Artboard `.dc.html` + `canvas.json`, Claude-Design-Dateiformat mit EYAS-Runtime |
| Anbieter | LLM-Backend |
| Anbieterart | `cli` (Claude Code CLI, Grok CLI, Kimi Code CLI), `local` (Ollama, LM Studio, vLLM) oder `api` (jede gehostete API). `GET /api/v1/model/providers` liefert sie neben dem Produktnamen, und die Seite Anbieter und der Setup-Assistent erkennen einen CLI-Anbieter daran ([Anbieter](/docs/de/ai/providers/#built-in-providers)) |
| Festes Modell | Das Modell, auf dem ein Gespräch läuft und das es behält. Ein neues Gespräch ohne Modell bekommt mit der ersten Nachricht den Installations-Default; spätere Default-Änderungen verschieben es nicht. Ein Modell, das du in der Modellauswahl gewählt hast, wird nie still ausgetauscht: Wird es unverfügbar, wird die Nachricht abgelehnt |
| Modellauswahl | Das Bedienelement in der oberen Leiste eines Gesprächs, das ein festes Modell, automatisches Routing oder den Standard des Kollegen wählt und sagt, welches Modell die nächste Nachricht beantwortet und warum |
| Auto-Routing | Eine Wahl pro Gespräch: Nur bei einem auf Auto gesetzten Gespräch werden Nachrichten klassifiziert und über die Stufen geroutet, und nur solange **Automatisches Routing erlauben** eingeschaltet ist |
| Standard des Kollegen | Ein Gespräch mit einem Kollegen (und ein Untergespräch) folgt dem Modell dieses Kollegen, sonst dem Modell des delegierenden Gesprächs, sonst dem Default; ist das Modell des Kollegen nicht verfügbar, fällt der Zug mit einem Hinweis zurück, nie still |
| Hintergrundmodell | Das Modell, auf dem die Hintergrundarbeit von EYAS läuft (Titel, Heartbeat, Speichererfassung, Security-Judge, Recherche, …) — nur ein Anbieter, der isolierte Aufrufe kann, in fester Stufenreihenfolge versucht. Die Karte **Hintergrund-Modellaufrufe** unter Routing-Stufen zeigt, wohin jede Gruppe geht |
| Kernel-Datei-Sandbox | Die Datei-Sandbox des Betriebssystems (macOS Seatbelt, Linux bubblewrap), in der Claude Codes Shell-Befehle und die eigenen Werkzeuge von Grok CLI laufen; sie sperrt Speicher außerhalb von EYAS und die privaten Daten von EYAS. Kimi Code CLI hat keine. `security.cliSandbox: auto \| required` |
| Quarantäne (Anbieter-Speicher) | Owner-Aktion unter Speicher → Übersicht, die vor jedem Modell verbirgt, was ein Anbieter geschrieben hat, und es später wieder freigeben kann; nichts wird gelöscht |
| CLI-Home | EYAS-eigener Ordner, in dem Grok CLI, Kimi Code CLI und OpenCode laufen (`<data dir>/cli-homes/<provider>`), statt im Setup des Betreibers; enthält ihre Anmeldung für EYAS. Claude Code behält das Host-Home und teilt nur seine Anmeldung |
| Für EYAS anmelden | Anmeldung von Grok CLI / Kimi Code CLI für EYAS' eigenes CLI-Home (Gerätecode oder, bei Grok, ein xAI-API-Schlüssel) — die Host-Anmeldung wird nicht genutzt |
| Isolationsprüfung | EYAS' Prüfung, dass eine CLI (Claude Code, Grok, Kimi) nichts vom Host geladen hat; ein Zug, der sie nicht besteht, stoppt und wird nie an ein anderes Modell übergeben |
| Release-Prüfung | `bun run test:live-cli`, vor einem Release: Die echten Claude Code und Grok CLI (und Kimi Code CLI, wo installiert) laufen über EYAS in einem Wegwerf-Home voller Fallen, um zu beweisen, dass nichts vom Host geladen wird und Speicher außerhalb von EYAS verweigert bleibt. Der kostenlose Teil nutzt ein lokales Scheinmodell und verbraucht keine Tokens ([Wie die Isolation bewiesen wird](/docs/de/admin/security-privacy/#how-isolation-is-proven)) |
| Nachgewiesene CLI-Version | Die CLI-Version, auf der die Release-Prüfung zuletzt bestanden wurde: Claude Code 2.1.281 und Grok CLI 1.0.41; Kimi Code CLI noch nicht. `eyas doctor` warnt, wenn die installierte Version abweicht; jede Session wird beim Start trotzdem geprüft ([Nachgewiesene CLI-Versionen](/docs/de/ai/providers/#proven-cli-versions)) |
| Rundenblock | Der Block `<turn-context>`, den EYAS in jeder Runde oben an deine aktuelle Nachricht setzt: aktuelles Datum und Uhrzeit, dann der Abrufblock. Er wird für jede Runde neu gebaut und nur an das Modell geschickt — nie mit deiner Nachricht gespeichert —, sodass der System-Prompt von Runde zu Runde gleich bleibt ([Wie der Abruf das Modell erreicht](/docs/de/knowledge/memory/#how-recall-reaches-the-model)) |
| Abrufblock | Der abgegrenzte Block `<eyas-memory>` im Rundenblock: Dauernotizen, die für diese Nachricht abgerufenen Notizen und die besten Treffer im Volltext. Bei jedem Anbieter gleich, bemessen am Kontextfenster des antwortenden Modells |
| Drill-down | Das Modell öffnet selbst Speicher mit `memory_search` / `memory_expand`: 3 Aufrufe pro Antwort bei jedem Anbieter, immer im Projektbereich des Gesprächs. Jeder Host benennt die Tools auf seine Art (`mcp__eyas__memory_search` in Claude Code, `use_tool` mit `eyas__memory_search` in Grok CLI); ein Modell, das keine Tools aufrufen kann, bekommt keinen Drill-down und dafür mehr Notizen im Volltext ([Weitersuchen: memory_search und memory_expand](/docs/de/knowledge/memory/#looking-further-memory_search-and-memory_expand)) |
| Lieferprofil | Was EYAS über das Modell weiß, das eine Runde beantwortet: sein Kontextfenster, ob es Tools aufruft, wie sein Host EYAS-Tools benennt und ob es Drill-downs kann. Prompt und Abrufblock werden danach bemessen, und ein Modell, das keine Tools aufrufen kann, bekommt keine. Pro Runde zeigt es die Box **Gelieferter Speicher** ([Kontext-Zusammenstellung](/docs/de/daily/conversations/#context-composition)) |
| Abruf-Engine | Worüber jedes Modell abruft: ein lokaler Embedder (multilingual-e5-small, sonst ein Hash-Ersatz), Vektoren je Projektpartition abgelegt, eine Abfrage und ein Ranking. Schreibgeschützt auf der Karte **Abruf-Engine** unter **Speicher → Übersicht** ([Abruf-Engine](/docs/de/knowledge/memory/#recall-engine)) |
| Speicherlieferung nach Provider | Die Karte unter **Beobachtbarkeit → Kontext**, die Anbieter vergleicht: Runden mit Speicher, durchschnittliche Einträge je Schicht, Speicher-Tokens und Drill-downs pro Runde. Ähnliche Zahlen heißen, dass jedes Modell denselben Speicher bekam ([Observability & Ops](/docs/de/admin/observability/#memory-delivery-by-provider)) |
| Speicher außerhalb von EYAS | Speicher anderer Werkzeuge, Notiz-Vaults und EYAS' eigener Datenordner — jedem Modell zum Lesen und Schreiben verweigert |
| MCP | Model Context Protocol |
| Connection | Benannter externer System-Inventareintrag (Odoo, GitHub, MCP, …) |
| Kanal | Externer Messaging-Connector — nicht Connection, nicht Hand |
| Hand | Gepaarter lokaler Client mit OS/CLI/Desktop-Tools ([Hände](/docs/de/admin/hands/)) |
| Media | Gehostetes Prompt→Pixel-Gateway (Magnific, Higgsfield, fal, HeyGen). Fünf `media_*`-Tools; keines ist Default. ([Medien](/docs/de/ai/media/)) |
| HeyGen | Optionaler Talking-Head- / Presenter-Video-Backend unter Media (MCP-OAuth, Webplan-Credits). Nicht Studio. ([Medien](/docs/de/ai/media/)) |
| Studio | Lokale Production-Engines (HTML oder Footage → Datei). Nicht Media. ([Studio](/docs/de/studio/)) |
| Video Use | Studio-Engine: Rohmaterial aus einem EDL ([Video Use](/docs/de/studio/videouse/)) |
| Browser Use | Optionaler CLI-Sidecar für eingeloggtes Chrome via CDP ([Browser Use](/docs/de/automation/browser-use/)) |
| OpenCode | Optionaler MIT-Coding-Engine-Sidecar (HTTP 127.0.0.1 + Web-TUI). Nicht vendored. ([OpenCode](/docs/de/automation/opencode/)) |
| OpenCode-Speicher-Plugin | Gibt OpenCodes Modell die nur lesenden EYAS-Tools `memory_search` / `memory_expand`, aber kein Tool, das Speicher schreibt. Eine `opencode_run`-Aufgabe liest den Projektbereich ihres Gesprächs, andere Sessions nur globalen Speicher, und ein angebundener externer Server gar keinen. Jeder OpenCode-Prozess, den EYAS startet, hat einen eigenen Schlüssel, der mit dem Prozess erlischt ([EYAS-Speicher in OpenCode](/docs/de/automation/opencode/#eyas-memory-inside-opencode)) |
| Remote-Knoten | Andere Maschine, die diese Instanz erreicht (SSH und Freunde) ([Knoten](/docs/de/admin/nodes/)) |
| Extension-Pack | Drittanbieter-Skill-Pack aus dem Katalog, MIT-kompatibler Lizenzcheck ([Erweiterungen](/docs/de/admin/extensions/)) |
| Recordly | AGPL-Desktop-Screenrecorder; Drittanbieter-Begleiter unter Erweiterungen, nicht gebündelt, keine Studio-Engine ([Recordly](/docs/de/admin/extensions/#recordly)) |
| Grounding | Retrieval-Belege vor Faktenbehauptungen |
| Hybrid search | FTS + Vektor (RRF) |
| Search source | Benannter indexierter Baum unter Suchquellen |
| Code source pin | Gespräch- oder Projektwahl, welche Suchquellen Agenten abfragen dürfen |
| Working directories | Benannte Ordner (Name + absoluter Pfad) für Read/Write; der erste ist cwd. Typ und/oder Projekt; Conversation erbt. Datei-Tools sind hier eingesperrt — ein Gespräch ohne solche Ordner bekommt seinen eigenen EYAS-Workspace |
| EYAS-Workspace | Der Ordner, den EYAS für ein Gespräch ohne eigene Arbeitsverzeichnisse anlegt; nie in einem Git-Checkout (`EYAS_WORKSPACES_DIR` verschiebt ihn) |
| Zuerst planen | Composer-Modus: Plan schreiben, auf **Freigeben** / **Plan überspringen** / **Ablehnen** warten, bevor Tools laufen |
| Skill import roots | Instanz `skills.importRoots` / `agent.importRoots` in `local.yaml` — zusätzliche Markdown-Ordner, bei jedem Start gelesen. Default leer. Wurzeln in den Ordnern eines anderen Werkzeugs werden übersprungen |
| Projekt-Wiki | Seiten pro Projekt (`/projects/:id/wiki`); optionales Auto-Update aus geschlossenen Tickets und Team-Entscheidungen |
| needsPin | Tool-Antwort, wenn mehrere odoo-family-Versionen ready sind, aber nichts gepinnt |
| Prompt Enhancer | Coach für Gesprächs-Drafts |
| Prompt Coach | Coach für dauerhafte Projekt-/Agent-Systemprompts |
| Forge | Freigegebene Soul/Identity-Änderungen |
| God Mode | Dieselbe Aufgabe von einem Settings-Roster von Modellen geraced; Chair bei gerader Anzahl |
| Security gate | Policy vor der Aktion |
| CASL | Autorisierungsbibliothek |
| Orchestration | Solo/Auto/Deep: Spezialisten-Policy (plus God Mode) |
| Effort | Reasoning-Tiefe (in der Oberfläche **Aufwand**: Automatisch, Keiner, Minimal, Niedrig, Mittel, Hoch, Sehr hoch, Maximum). Die Auswahl listet nur die Stufen, die das Modell anbietet; Automatisch erbt (Deep → Maximum, Kollege, delegierendes Gespräch, Routing-Stufe) oder nutzt den Default des Modells; jeder Aufruf wird an das angepasst, was das antwortende Modell unterstützt, und jede Antwort zeigt den Effort, mit dem sie lief |
| Zurückgelesene Stufe | Claude Code CLI, Grok CLI und Kimi Code CLI melden die Effort-Stufe, mit der sie tatsächlich liefen, und genau die zeigen die Antwort und ihr Trace. Bei jedem anderen Anbieter ist es die Stufe, die EYAS nach der Anpassung an das Modell gesendet hat ([Wie jeder Anbieter die Effort-Stufe anwendet](/docs/de/ai/providers/#effort-by-provider)) |
| SLA breach | Proaktives Signal für overdue/stale Arbeit |
| A2A | Agent-to-Agent-Protokoll (Card + Task-Ausführung) |
