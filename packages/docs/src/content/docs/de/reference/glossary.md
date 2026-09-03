---
title: Glossar
description: Produktbegriffe.
---

| Begriff | Definition |
|---------|------------|
| Agent | Konfigurierter KI-Akteur |
| Primary | Immer-an Setup-Teamkollegen |
| Skill | Markdown-Verfahrenspaket |
| Skill-Vorschlag | Passender Skill, auf den die Gesprächsrunde wartet — **Verwenden**, **Diesmal nicht**, oder Owner/Admin **Abschalten** |
| Tool | Aufrufbare Fähigkeit |
| Coding surface | Modellagnostische File-Tools (`read_file`, `edit_file`, `grep`, …) von EYAS, nicht einem Vendor-SDK |
| Worktree | Isolierter Git-Working-Tree für parallele Team-Agenten (`.eyas-worktrees/`) |
| Verify commands | Lint/Test nach einem Agentenlauf vor dem LLM-Critic |
| Tool hook | PreToolUse / PostToolUse bei jeder Tool-Ausführung |
| Board | Arbeitstracking |
| Gespräch | Chat-Thread |
| Memory-Stufe | Working→episodic→vault→archive |
| Memory block | Gescopter Shared Note (company/agent/team/run) |
| Vault | Markdown-Langzeitgedächtnis |
| Capture run | Eine Post-Turn Durable-Memory-Extraktion; jedes Ergebnis schreibt `memory_capture_runs`. Schalter: `memory.capture.enabled` |
| Design canvas | Multi-Artboard `.dc.html` + `canvas.json`, Claude-Design-Dateiformat mit EYAS-Runtime |
| Anbieter | LLM-Backend |
| MCP | Model Context Protocol |
| Connection | Benannter externer System-Inventareintrag (Odoo, GitHub, MCP, …) |
| Kanal | Externer Messaging-Connector — nicht Connection, nicht Hand |
| Hand | Gepaarter lokaler Client mit OS/CLI/Desktop-Tools ([Hände](/docs/de/admin/hands/)) |
| Studio | Lokale Production-Engines (HTML oder Footage → Datei). Nicht Media. ([Studio](/docs/de/studio/)) |
| Video Use | Studio-Engine: Rohmaterial aus einem EDL ([Video Use](/docs/de/studio/videouse/)) |
| Browser Use | Optionaler CLI-Sidecar für eingeloggtes Chrome via CDP ([Browser Use](/docs/de/automation/browser-use/)) |
| Remote-Knoten | Andere Maschine, die diese Instanz erreicht (SSH und Freunde) ([Knoten](/docs/de/admin/nodes/)) |
| Extension-Pack | Drittanbieter-Skill-Pack aus dem Katalog, MIT-kompatibler Lizenzcheck ([Erweiterungen](/docs/de/admin/extensions/)) |
| Recordly | AGPL-Desktop-Screenrecorder; Drittanbieter-Begleiter unter Erweiterungen, nicht gebündelt, keine Studio-Engine ([Recordly](/docs/de/admin/extensions/#recordly)) |
| Grounding | Retrieval-Belege vor Faktenbehauptungen |
| Hybrid search | FTS + Vektor (RRF) |
| Search source | Benannter indexierter Baum unter Suchquellen |
| Code source pin | Gespräch- oder Projektwahl, welche Suchquellen Agenten abfragen dürfen |
| Working directories | Benannte Ordner (Name + absoluter Pfad) für Read/Write; der erste ist cwd. Typ und/oder Projekt; Conversation erbt. Datei-Tools sind hier eingesperrt |
| Zuerst planen | Composer-Modus: Plan schreiben, auf **Freigeben** / **Plan überspringen** / **Ablehnen** warten, bevor Tools laufen |
| Skill import roots | Instanz `skills.importRoots` / `agent.importRoots` in `local.yaml`. Default leer. Isolation bleibt an |
| Projekt-Wiki | Seiten pro Projekt (`/projects/:id/wiki`); optionales Auto-Update aus geschlossenen Tickets und Team-Entscheidungen |
| needsPin | Tool-Antwort, wenn mehrere odoo-family-Versionen ready sind, aber nichts gepinnt |
| Prompt Enhancer | Coach für Gesprächs-Drafts |
| Prompt Coach | Coach für dauerhafte Projekt-/Agent-Systemprompts |
| Forge | Freigegebene Soul/Identity-Änderungen |
| God Mode | Dieselbe Aufgabe von einem Settings-Roster von Modellen geraced; Chair bei gerader Anzahl |
| Security gate | Policy vor der Aktion |
| CASL | Autorisierungsbibliothek |
| Orchestration | Solo/Auto/Deep (plus God Mode) |
| Effort | Reasoning-Tiefe |
| SLA breach | Proaktives Signal für overdue/stale Arbeit |
| A2A | Agent-to-Agent-Protokoll (Card + Task-Ausführung) |
