---
title: Werkzeuge
description: Katalog aufrufbarer Fähigkeiten — Risiko, Freigabe und Zuweisung an Agenten.
---

**Wozu das da ist.** Werkzeuge (Tools) sind die Aktionen, die ein Agent tatsächlich ausführen kann: eine Datei lesen, einen Index durchsuchen, einen Browser öffnen, einen E-Mail-Entwurf senden. Diese Seite ist der Live-Katalog von allem, was auf dieser Instanz registriert ist. Die Zuweisung bleibt auf dem Agenten-Tab **Konfiguration**; hier prüfst du Name, Kategorie, Risiko und ob ein Aufruf auf Freigabe wartet.

**Route:** `/tools`. Sidebar: **Werkzeuge**. Untertitel: *Registrierte Werkzeuge, die für die Agent-Ausführung verfügbar sind.*

## Wann du es brauchst

- Du willst wissen, welche Tools es gibt, bevor du ihre Ids bei einem Agenten einträgst.
- Ein Aufruf wurde blockiert, und du brauchst die Risikostufe und ob er **Freigabe erfordert**.
- Du bindest MCP oder eine Verbindung an und willst die gefundenen Tools neben den eingebauten sehen.
- Du brauchst das Eingabeschema eines Tools, das der Agent immer wieder falsch aufruft.

## Typischer Ablauf

1. Öffne **Werkzeuge** in der Sidebar (`/tools`).
2. Suche nach Name oder Beschreibung, oder filtere nach Kategorie und Risikostufe.
3. Klappe auf einer Karte **Schema anzeigen** auf, wenn du die JSON-Eingabe brauchst.
4. Trage die Tool-Id auf dem Agenten-Tab **Konfiguration** in **Tools (durch Komma getrennt)** ein. Siehe [Konfigurieren](/docs/de/agents/configure/).
5. Gefährliche Aufrufe laufen zur Laufzeit trotzdem durch das [Security-Gate](/docs/de/admin/security-privacy/) — eine Katalogzeile ist keine Berechtigung.

## Funktionen

Der Kopf zählt die **Werkzeuge** und wie viele **Freigabe erfordern**. Jede Karte zeigt eine Monospace-Id, eine kurze Beschreibung, ein Kategorie-Badge, ein Risiko-Badge (`green Risiko`, `yellow Risiko` oder `red Risiko`) und ein bernsteinfarbenes Schild, wenn Freigabe nötig ist.

| Begriff | Bedeutung |
|---------|-----------|
| Tool-Name | Stabile Id in Agent-Konfiguration und Logs |
| Beschreibung | Was das Tool tut (im Katalog sichtbar) |
| Kategorie | Gruppierung aus der Registry: `memory`, `knowledge`, `search`, `documents`, `board`, `shell`, `browser`, `conversation`, `communication`, `research`, `agent`, `custom` (MCP- und Verbindungs-Tools bringen ihre eigenen mit) |
| Risikostufe | **green / yellow / red** — low / medium / high des Security-Gates |
| **Freigabe erforderlich** | Der Executor führt den Aufruf erst aus, wenn ein Mensch ihn freigibt |
| Eingabeschema | JSON Schema der Argumente; **Schema anzeigen** / **Schema ausblenden** |
| Berechtigungen | CASL auf der API plus das Security-Gate bei jedem Aufruf. Ein Modell kann nur ein Tool ausführen, das seinem Agenten angeboten wurde: Jeder andere Name wird abgelehnt (*'&lt;tool&gt;' is not in this agent's toolset*), ohne Freigabe-Anfrage, bei jedem Anbieter — siehe [Konfigurieren — Tools](/docs/de/agents/configure/#tools--constraints) |
| Sandbox | Manche Tools laufen in einer eingeschränkten Umgebung |

Leer: *Noch keine Werkzeuge registriert.* Laden (*Werkzeuge werden geladen…*) und Ladefehler (*Werkzeuge konnten nicht geladen werden: …*) erscheinen als Seitentext, nicht als stille leere Seite.

MCP-gestützte Tools konfigurierst du unter [MCP-Server](/docs/de/ai/mcp/), Zugangsdaten externer Systeme unter [Verbindungen](/docs/de/admin/connections/).

<h3 id="tool-execution-log">Tool-Ausführungsprotokoll</h3>

Jeder Tool-Aufruf landet im Tool-Ausführungsprotokoll: der kanonische Name des Tools, seine Eingabe, seine Ausgabe oder sein Fehlertext, die Dauer sowie das Gespräch, der Agent und der überwachte Lauf, zu dem er gehört.

- Aufrufe, die der EYAS-Executor ausführt — bei API-Anbietern und EYAS-Tools, die eine CLI über die EYAS-Bridge aufruft —, protokolliert der Executor, jeden genau einmal.
- Tools, die eine CLI in ihrer eigenen Schleife ausgeführt hat — Claude Code, Grok CLI und Kimi Code CLI, etwa ihre Shell oder ihr Dateilesen —, bekommen ebenfalls eine Zeile, unter dem kanonischen Namen (Claude Codes `Bash` wird als `run_command` protokolliert). EYAS hat sie nicht ausgeführt und zeichnet sie nur auf: Sie liefen bereits unter EYAS' Berechtigungsprüfung für diese CLI.
- Diese Zeilen sind die Tool-Belege, an denen die Vollständigkeitsprüfung einen Lauf misst, und sie speisen die Berichte von Selbstlernen und Effizienz — bei jedem Anbieter gleich.
- Das Protokoll ist kein Speicher: Daraus gelangt nichts in den EYAS-Speicher. Ob Tool-Ausgaben im Speicher landen, entscheidet allein `memory.l0.captureToolResults` — siehe [Speicher](/docs/de/knowledge/memory/).

Die Spalte **Tools** unter [Observability — Nutzung](/docs/de/admin/observability/#usage-tab) zählt dieselben Aufrufe pro Trace.

## Felder und Bedienelemente

<h2 id="catalogue">Katalogfilter</h2>

| Bedienelement | Bedeutung |
|---------------|-----------|
| Suche | *Werkzeuge suchen…* — passt auf Name oder Beschreibung |
| **Alle Kategorien** | Auf eine Registry-Kategorie einschränken |
| **Alle Risikostufen** | Auf eine Risikostufe einschränken |

<h2 id="built-in-tool-groups">Eingebaute Tool-Gruppen (Auswahl)</h2>

<h3 id="coding-surface">Coding-Oberfläche (modellunabhängig)</h3>

Vollwertige Dateisystem-Tools, damit **jedes** Modell (Grok, Claude API, Kimi, lokal, …) Code bearbeiten kann, ohne auf die eingebauten Tools des Claude Code SDK angewiesen zu sein:

| Tool | Zweck | Risiko |
|------|-------|--------|
| `read_file` | Textdatei lesen (Zeilen-Offset/Limit) | green |
| `write_file` | Datei anlegen/überschreiben | yellow |
| `edit_file` | Exakter String-Ersatz (gezielte Änderung) | yellow |
| `grep` | Inhaltssuche im Workspace | green |
| `glob` | Dateien per Muster finden | green |
| `git_status` / `git_diff` | Nur lesende Review-Helfer | green |
| `run_command` | Shell-freie Programmausführung (Freigabe) | red |

Pfade sind auf die **Arbeitsordner** des Gesprächs (oder den **Worktree** des Agenten) beschränkt — ein Gespräch ohne eigene Ordner arbeitet in seinem eigenen EYAS-Workspace. Es gibt keinen Rückfall auf das Verzeichnis des EYAS-Prozesses. Sensible Pfade (`.env`, `master.key`, `.ssh`, …) werden verweigert, ebenso Speicher außerhalb von EYAS — der Speicher anderer Werkzeuge, Obsidian-Vaults, EYAS' eigener Datenordner und der Workspace eines anderen Gesprächs —, beim Lesen wie beim Schreiben ([Sicherheit & Datenschutz — Speicher außerhalb von EYAS](/docs/de/admin/security-privacy/#memory-outside-eyas)). Ein Ordner, der Speicher oder Zugangsdaten offenlegen würde, lässt sich gar nicht erst als Arbeitsordner speichern ([Gespräche — Ordner](/docs/de/daily/conversations/#working-folders)). In einem Ordner, der einen solchen Ort nur enthält — ein Repository mit EYAS' `data/`, `~/Documents` mit einem Vault —, steigen `grep` und `glob` nie in die geschützten Unterordner ab (EYAS' Datenordner, ein verschachtelter Obsidian-Vault, der Speicher eines anderen Werkzeugs, ein CLI-Home, der Workspace eines anderen Gesprächs), eine Suche liefert also nie Ergebnisse daraus. Ein Symlink im Arbeitsordner, der nach außen zeigt, wird abgelehnt, auch wenn sein Ziel noch nicht existiert (das gilt für `read_file`-, `write_file`-, `edit_file`- und `browser_upload`-Pfade). Bevorzuge `edit_file` gegenüber dem Neuschreiben ganzer Dateien.

**Lesendes git ohne Klick.** Ruft der Agent `run_command` (oder ein CLI-`Bash`) mit einer Argumentliste auf, die eindeutig `git status` oder `git diff` ist — keine Shell-Metazeichen, kein `-C` / `--git-dir` / `--no-index`, kein absoluter Pfad —, bildet das Security-Gate sie auf `git_status` / `git_diff` ab und **erlaubt sie**. Du bekommst keine Freigabe-Anfrage. `git commit`, `git add`, `ls` und jeder Befehl mit Metazeichen bleiben rot oder werden abgelehnt. Die eigenen Tools `git_status` / `git_diff` sind grün.

**Verify before done:** Konfiguriere `agent.verifyCommands` in YAML (z. B. `bun test`), um nach einem Lauf deterministische Prüfungen auszuführen; Fehlschläge öffnen den Agenten mit der Fehlerzusammenfassung erneut.

**Hooks:** Jeder Tool-Aufruf läuft über PreToolUse / PostToolUse am ToolExecutor (universell, nicht nur Claude). Claude Codes eigene eingebaute Werkzeuge durchlaufen zusätzlich die Speicher-Policy-Prüfung von EYAS, bevor sie laufen.

**CLI-Modelle nutzen ihre eigenen Datei-Tools.** Claude Code, Grok und Kimi bekommen diese Coding-Oberfläche (`run_command`, `read_file`, `write_file`, `edit_file`, `grep`, `glob`, `git_status`, `git_diff`) nicht über die EYAS-Bridge angeboten, weil sie eigene haben: Sie führen sie in den Ordnern des Zugs aus, unter dem Security-Gate, der Speicherpfad-Policy und — für die Shell von Claude Code und die Werkzeuge von Grok — der [Kernel-Datei-Sandbox](/docs/de/ai/providers/#kernel-file-sandbox). Jedes andere EYAS-Tool erreicht sie.

<h3 id="search-grounding">Suche & Grounding</h3>

| Tool | Zweck |
|------|-------|
| `list_search_sources` | Quellen auflisten (Label, Version, Edition, Familie, Pfade, Status), bevor Fakten erfunden werden |
| `get_search_context` | Zeigen, welche Quellen für dieses Gespräch angeheftet sind |
| `set_search_context` | Quellen anheften oder lösen (`sourceIds`, `labels`, `version`, `edition` oder `clear: true`) |
| `search_indexed` | Hybride FTS- + Vektorsuche mit **Zitaten**; beachtet die Anheftung von Gespräch/Projekt; optional `sourceIds` / `labels` / `version` / `edition` |

Sind mehrere Quellen der **odoo-family** bereit und nichts ist angeheftet, liefern die Tools **`needsPin`**, statt Versionen zu mischen. Siehe [Suche — Mehrversions-Anheftung](/docs/de/daily/search/#multi-version-pin).

<h3 id="memory">Speicher</h3>

| Tool | Zweck |
|------|-------|
| `memory_search` | Durchsucht den EYAS-Speicher — Zusammenfassungen, Fakten, Vault-Notizen, importierte Transkripte —, nie den der Host-CLI. Nur lesend und von EYAS auf das Projekt des Gesprächs, seinen Typ und globalen Speicher festgelegt; ein `scope`- oder Projekt-Argument wird ignoriert. Liefert Ids, die `memory_expand` öffnet. |
| `memory_expand` | Öffnet einen Treffer per Id (`vt:`, `gs:`, `en:`, … — aus `memory_search` oder einer Dauerzeile des Speichers), innerhalb derselben Projektsperre |
| `search_memory` | Alias von `memory_search`, mit derselben Projektsperre |
| `save_memory` | Stillgelegt — schreibt nichts. EYAS zeichnet Speicher automatisch auf; Agenten schreiben nie selbst Speicher |

`memory_search` und `memory_expand` sind immer verfügbar, egal was die **Tools**-Liste eines Agenten sagt, und sie sind auf jedem Host die einzigen Speicher-Tools eines Modells — bei API-Anbietern, Claude Code, Grok, Kimi und in OpenCode innerhalb einer `opencode_run`-Aufgabe. Die drei Such-/Öffnen-Tools teilen sich bei jedem Anbieter ein Budget von **3 Aufrufen pro Antwort**. Ein Aufrufer außerhalb eines EYAS-Gesprächs — ein externer MCP-Client oder eine OpenCode-Sitzung, die EYAS nicht für eine Aufgabe gestartet hat — liest nur globalen Speicher, 3 Aufrufe pro 90 Sekunden. `memory_block_read` und `memory_block_write` sind stillgelegt: Was in Blöcken gespeichert war, wurde einmal in den EYAS-Speicher kopiert und wird mit `memory_search` gefunden; ein Agent, dessen Liste sie noch nennt, bekommt sie einfach nicht mehr. Ergebnisse der Speicher-Tools werden auf jedem Transportweg von der Datenschutzrichtlinie maskiert (API-Anbieter, die CLI-Bridges, externe MCP-Clients, OpenCode). Siehe [Speicher](/docs/de/knowledge/memory/).

<h3 id="browser">Browser</h3>

Headless Playwright (`browser_*`) nutzt dasselbe Chromium wie die Druck-Pipeline von Design. Bevorzuge die nummerierten Indizes aus `browser_snapshot` statt CSS. Indizes und `snapshotId` verfallen bei Navigation oder Zurück — mach einen neuen Snapshot. Cookies bleiben in einem **EYAS-eigenen** Profil (`data/browser/profile` oder `EYAS_BROWSER_USER_DATA_DIR`) — nie im täglichen Chrome-Profil (Chrome 136+ blockiert CDP auf dem Default-Profil). Downloads landen in [Dokumente](/docs/de/knowledge/documents/).

| Tool | Zweck |
|------|-------|
| `browser_navigate` | URL öffnen; **SSRF**-Schutz blockiert private/Metadaten-Hosts |
| `browser_snapshot` | Accessibility-Baum + nummerierte interaktive Liste + `snapshotId` |
| `browser_click` / `browser_fill` / `browser_hover` / `browser_select` | Handeln per Index oder CSS |
| `browser_tabs` | `list` / `open` / `switch` / `close` (der letzte Tab lässt sich nicht schließen) |
| `browser_back` / `browser_wait` | Zurück im Verlauf; auf Selektor, URL, Laden oder Zeit warten |
| `browser_dialog` | Annehmen/Abweisen für das nächste `alert`/`confirm`/`prompt` scharf schalten |
| `browser_upload` | Dateifeld — Workspace-Pfade oder Dokumenten-Ids |
| `browser_evaluate` | JavaScript **in der Seite** (nicht Node); JSON-Ergebnis begrenzt |
| `browser_download` | Nächster Download → Dokumente, mit dem Gespräch verknüpft |
| `browser_storage` | Playwright-`storageState` speichern/laden (Cookies + Origins) |
| `browser_replay` / `browser_action_cache` | Gespeicherten Locator abspielen (ohne LLM). JSON im Projekt oder Vault. Nie Füllwerte |
| `browser_totp` | TOTP aus Geheimnisse / macOS-Schlüsselbund → `browser_fill`. Gelb. Der Seed kommt nie zurück |
| `browser_screenshot` / `browser_get_content` / `browser_close` | Bild, Text, Prozess beenden (das Profil bleibt auf der Platte) |
| `agent_browser_status` / `agent_browser_run` | Empfohlener agent-browser-Sidecar (`@e1`-Refs, Apache-2.0) — [Browser Use](/docs/de/automation/browser-use/) |
| `browser_use_status` / `browser_use_exec` | Älterer Python-CLI-Sidecar ([Browser Use](/docs/de/automation/browser-use/)) |
| `opencode_status` / `opencode_run` | Optionaler OpenCode-Coding-Sidecar ([OpenCode](/docs/de/automation/opencode/)). Status ist grün; run ist rot + Freigabe. `opencode_run` läuft nur innerhalb eines Gesprächs. In der Aufgabe kann OpenCode den EYAS-Speicher mit denselben nur lesenden `memory_search` / `memory_expand` lesen, gesperrt auf das Projekt des Gesprächs und mit dem 3-Aufruf-Budget des aufrufenden Zugs; EYAS-Speicher schreiben kann es nicht. |

Die EYAS-Browser-Tools, `agent_browser_*`, `browser_use_*` und `opencode_*` erreichen auch CLI-Modelle (Claude Code, Grok, Kimi) über die EYAS-Bridge — unter demselben Gate, denselben Freigaben und demselben Tool-Umfang wie bei API-Modellen.

<h3 id="studio">Studio (optionales Modul)</h3>

Lokale Engines, nicht Medien. Siehe [Studio](/docs/de/studio/).

| Tool | Zweck |
|------|-------|
| `hyperframes_*` | HTML-Komposition → deterministisches MP4 ([Hyperframes](/docs/de/studio/hyperframes/)) |
| `videouse_*` | Material + EDL → MP4 ([Video Use](/docs/de/studio/videouse/)) |

Screen-Capture-Politur ist kein Studio-Tool. Recordly ist ein AGPL-Begleiter unter [Erweiterungen](/docs/de/admin/extensions/#recordly) — keine `recordly_*`-Tools.

<h3 id="email">E-Mail (Entwurf → Freigabe → Senden)</h3>

| Tool | Zweck |
|------|-------|
| `email_create_draft` | Lokalen Entwurf anlegen |
| `email_approve_draft` | Entwurf als freigegeben markieren |
| `email_send_draft` | **Nur** senden, wenn freigegeben |

<h3 id="odoo">Odoo (optionales Modul)</h3>

**Live-Instanz** (JSON-RPC):

| Tool | Zweck |
|------|-------|
| `odoo_search_tasks` | Tickets/Aufgaben suchen (überwiegend lesend) |
| `odoo_get_task` | Eine Aufgabe holen |
| `odoo_message_post` | Chatter-Nachricht posten |
| `odoo_write_task` | Abgesicherter Schreibzugriff |

**Lokaler Quellindex** (Coding-Kette):

| Tool | Zweck |
|------|-------|
| `odoo_search_model` | `_name` / `_inherit` im lokalen Python finden |
| `odoo_search_field` | `fields.*`-Zuweisungen finden |
| `odoo_search_xml_id` | XML-Record-Ids finden |

Wurzeln werden aufgelöst aus: Gesprächs-/Projekt-**Anheftung** → Suchquellen (`family: odoo`) → `EYAS_ODOO_SOURCES_JSON` / `EYAS_ODOO_SOURCE_PATHS`. Optionale Tool-Filter: `label`, `labels`, `sourceIds`, `version`, `edition`. Zitate: `[source:odoo-src:label:file:line]`.

Skill: `coding/odoo/odoo-dev-chain`. Live-Zugangsdaten über [Verbindungen](/docs/de/admin/connections/) (Typ Odoo). Mehrere Versionen in der Oberfläche: [Suche](/docs/de/daily/search/) · [Projekte](/docs/de/daily/projects/) · Gesprächs-Tab **Quellen**.

<h3 id="connections-inventory">Verbindungs-Inventar</h3>

| Tool | Zweck |
|------|-------|
| `connections_list` / `connections_catalog` | Inventar + Katalog |
| `connections_test` | Health-Check |
| `connections_propose` | Verbindung zur menschlichen Freigabe vorschlagen |

<h3 id="media">Medien (optionales Modul)</h3>

Magnific, Higgsfield, fal oder HeyGen verbindest du unter [Medien](/docs/de/ai/media/). Agenten bekommen fünf gemeinsame Tools, nicht eines pro Anbietermodell. Talking-Head-/Presenter-Video: `provider: heygen` anheften.

| Tool | Zweck | Risiko |
|------|-------|--------|
| `media_generate` | Bild / Video / Audio / Upscale / Bearbeitung / 3D starten | yellow |
| `media_wait` | Abfragen, bis der Job fertig ist | yellow |
| `media_catalog` | Modelle für eine Art auflisten | green |
| `media_balance` | Verbleibende Credits | green |
| `media_history` | Letzte Jobs | green |

Fertige Dateien landen in [Dokumente](/docs/de/knowledge/documents/) und hängen am erzeugenden Zug.

<h3 id="other-groups">Weitere registrierte Gruppen</h3>

Diese erscheinen im Katalog, wenn ihr Modul aktiviert ist: **board**-Tools, **conversation**-Tools, **document**-Tools, **knowledge**-Tools, **research**-Tools, **schedule**-Tools, **channel** senden/auflisten, **A2A delegate** und optional **Google Docs**.

Agent-Routing (vom Agent-Modul registriert, in diesem Katalog nicht dupliziert):

| Tool | Zweck | Risiko |
|------|-------|--------|
| `run_specialist` | Aktivierten Spezialisten starten, auf die Zusammenfassung warten. Alias: `delegate_to_agent`. Der eine Weg für Spezialisten bei jedem Anbieter — Claude Codes eigenes Subagenten-Werkzeug wird nicht angeboten. | green |
| `handoff_to_colleague` | Home-Thread eines anderen Kollegen öffnen und dort sofort einen Lauf starten, mit dem Briefing als Ziel; abgelehnt, solange dieser Thread beschäftigt ist. | green |
| `assign_task` | Asynchrone Board-Karte für einen aktivierten Agenten. | green |
| `propose_team` | Karte für fehlende Rollen, epische Arbeit oder eine ausdrückliche Teamanfrage. | yellow |
| `propose_agent_creation` | Neue Spezialisten-Vorlage vorschlagen. | yellow |

Siehe [Teams und Delegation](/docs/de/agents/teams/).

<h3 id="cli-mcp-parity">CLI-MCP-Parität</h3>

Laufen Agenten auf **Grok CLI** oder **Kimi Code CLI**, hängt EYAS eine stdio-MCP-Bridge ein, damit diese Hosts dieselben ToolExecutor-Tools haben wie In-Process- und Claude-Code-Sitzungen — Speicher-Tools eingeschlossen. Jeder Zug hat sein eigenes Secret, auf dem Server an genau dieses Gespräch, diesen Agenten, dieses Projekt, diese Ordner und diesen Tool-Umfang gebunden, und gebridgte Aufrufe laufen weiterhin durch das Security-Gate. Auf beiden Bridges — dem In-Process-EYAS-MCP-Server von Claude Code und der Grok/Kimi-Bridge — bekommt eine CLI genau die **Tools**-Liste des Agenten plus `memory_search` / `memory_expand` (alle Tools bei leerer Liste), in einem Solo-Gespräch keine Delegations-Tools und nicht die Tools, für die ihr eigenes Gegenstück gewährt ist (`read_file`, `grep`, `glob` immer; `write_file`, `edit_file`, solange die Liste Schreiben gewährt; `run_command`, `git_status`, `git_diff`, solange sie die Shell gewährt). Dieselbe Liste begrenzt auch die eigenen Schreib-, Shell- und Web-Werkzeuge der CLI (siehe [Agenten — Tools](/docs/de/agents/configure/#tools--constraints)). Ein Aufruf jedes anderen Tools wird abgelehnt und erscheint als **Abgelehnt**. EYAS testet die Bridge bei jedem Start und loggt eine Warnung, wenn Grok/Kimi keine EYAS-Tools erreichen. Jeder Host benennt die Tools auf seine Weise (Grok: `use_tool` mit `eyas__<name>`). Siehe [MCP](/docs/de/ai/mcp/#cli-mcp-tool-parity-grok--kimi).

## Verwandt

- [Agenten — Tools konfigurieren](/docs/de/agents/configure/)
- [Teams und Delegation](/docs/de/agents/teams/)
- [Security-Gate](/docs/de/admin/security-privacy/)
- [Verbindungen](/docs/de/admin/connections/)
- [Skills](/docs/de/automation/skills/)
- [MCP-Server](/docs/de/ai/mcp/)
- [OpenCode](/docs/de/automation/opencode/)
- [Medien](/docs/de/ai/media/)
- [Studio](/docs/de/studio/)
- [Browser Use](/docs/de/automation/browser-use/)
- [Erweiterungen](/docs/de/admin/extensions/#recordly)
