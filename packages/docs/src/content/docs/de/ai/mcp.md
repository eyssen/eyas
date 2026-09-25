---
title: MCP-Server
description: Model Context Protocol — aktive Server, Katalog-Installation, Sperre von Speicher-Servern und Tool-Parität der CLIs.
---

**Wozu das da ist.** MCP (Model Context Protocol) ist der Weg, wie EYAS *externe* Werkzeugkästen anbindet: einen Filesystem-Server, ein SaaS-MCP, einen lokalen `npx`-Prozess. Hier gefundene Tools lassen sich zuweisen wie eingebaute. Das ist kein Chat-[Kanal](/docs/de/communication/channels/) und keine Zeile im [Verbindungen](/docs/de/admin/connections/)-Inventar — auch wenn du einen MCP-Server zusätzlich als Verbindung eintragen kannst, um seinen Zustand zu verfolgen.

**Route:** `/mcp-settings` (Sidebar **MCP-Server**). Titel: **MCP-Server**. Untertitel: *Erweitere EYAS um externe Tools, Ressourcen und Prompts über das Model Context Protocol.* Tabs: **Aktiv** · **Katalog**.

## Wann du es brauchst

- Ein Agent braucht Tools, die EYAS nicht mitliefert (ein Hersteller-MCP, ein lokaler Filesystem-Server).
- Ein Grok- oder Kimi-Agent erreicht keine EYAS-Tools, und du brauchst das Ergebnis des Bridge-Selbsttests.
- Du willst eine Katalog-Installation mit einem Klick (API-Schlüssel), statt einen Befehl zu tippen.
- Grok-/Kimi-CLI-Sitzungen sollen dieselben ToolExecutor-Tools sehen wie In-Process-Agenten.
- Ein Server ist nicht verbunden, und du brauchst **Test** / die Zahl gefundener Tools.
- Ein Server zeigt **Gesperrt: Speicher**, oder eine Installation wurde abgelehnt, weil sie Speicher außerhalb von EYAS halten würde.

## Typischer Ablauf

1. Öffne **MCP-Server** (`/mcp-settings`).
2. Durchsuche den **Katalog**, filtere nach Kategorie. Abschnitte: **Einsatzbereit** / **Ein-Klick-Installation (API-Schlüssel erforderlich)** / **Drittanbieter (manuelle Einrichtung)** / **Nicht verfügbar — Speicher außerhalb von EYAS**.
3. **Installieren** (bei Bedarf die Schlüssel eintragen, dann **Installieren & verbinden**) oder **Manuell** → **MCP-Server hinzufügen** (Name, Transport, Befehl oder URL).
4. Prüfe auf **Aktiv**, dass der Server verbunden ist, führe **Test** aus und sieh dir die gefundenen Tools / Ressourcen / Prompts an.
5. Weise diese Tool-Ids auf dem Agenten-Tab **Konfiguration** zu. Siehe [Werkzeuge](/docs/de/automation/tools/).

## Funktionen

Der Kopf zeigt **N/M verbunden**. Katalogeinträge tragen ein **Lizenz**-Badge (MIT-kompatibel / Copyleft / proprietär / unbekannt) — Copyleft und proprietär laufen trotzdem als **separater Prozess**; EYAS bleibt MIT.

Du kannst einen MCP-Server außerdem als Zeile im [Verbindungen](/docs/de/admin/connections/)-Inventar (Typ **MCP server**) eintragen, um seinen Zustand neben Odoo, GitHub und den übrigen zu verfolgen.

Magnific, Higgsfield, fal und HeyGen verbinden sich unter [Medien](/docs/de/ai/media/); der Agent nutzt fünf `media_*`-Tools statt ihrer rohen MCP-Kataloge.

**Agent Browser** (Vercel, Apache-2.0) ist eine Browser-Katalogzeile: `agent-browser mcp --tools core,state`. Installiere zuerst die CLI (`EYAS_AGENT_BROWSER_BIN` oder PATH). Nie `--tools all` (das enthält `chat`). Siehe [Browser Use](/docs/de/automation/browser-use/).

**Chrome DevTools MCP** (Google, Apache-2.0) ist eine **DevTools**-Katalogzeile: `npx -y chrome-devtools-mcp@latest --isolated` mit abgeschalteter Telemetrie und `--categoryExperimentalWebmcp=true`. Nur für Coding/Debugging (Konsole, Netzwerk, Lighthouse, WebMCP) — **nicht** zum Ausfüllen von Formularen. Die Tools kommen als `mcp_chrome-devtools_*`. WebMCP-Tools (`list_webmcp_tools` / `execute_webmcp_tool`) erscheinen nur, wenn der Sidecar sie anbietet; sonst werden sie nicht erfunden. `--autoConnect` und das tägliche Chrome-Profil werden abgelehnt. Siehe [Browser Use](/docs/de/automation/browser-use/#chrome-devtools-mcp).

## Felder und Bedienelemente

<h2 id="active">Aktive Server</h2>

Jede Serverkarte zeigt den Namen, einen Statuspunkt, den Transport, den Befehl oder die URL und Badges:

| Element | Bedeutung |
|---------|-----------|
| **deaktiviert** | Der Server existiert, ist aber nicht aktiviert |
| **Gesperrt: Speicher** | Der Server hält Speicher außerhalb von EYAS oder zeigt auf einen geschützten Ordner. Er wird nie gestartet, und seine Tools erreichen kein Modell; **Test** und **Aktualisieren** sind deaktiviert, **Bearbeiten** und **Löschen** funktionieren weiter — siehe [unten](#memory-store-servers-are-blocked) |
| **OAuth** / **API-Schlüssel** | Wie sich der Server anmeldet (kein Badge, wenn er nichts braucht) |
| **Mit OAuth verbinden** | OAuth-Server: startet die Anmeldung im Browser (`POST …/oauth/start` → Weiterleitung). Bei Magnific und Higgsfield heißt es **Mit Magnific / Higgsfield verbinden (OAuth)** |
| **Verwaltet unter Einstellungen → Medien** | Erscheint, wenn der Server zu Medien gehört (`ownedBy` ist `media`) |
| **N Tools / N Ressourcen / N Prompts** | Gefundener Katalog |
| **Test** → **Verbindung OK / Test fehlgeschlagen** | Verbindung prüfen; das Ergebnis des letzten Tests |
| **Aktualisieren** | Die Tools des Servers neu ermitteln |
| **Bearbeiten** / **Löschen** | Befehl, URL oder API-Schlüssel ändern; den Server entfernen |

<h2 id="add-server">Dialog Hinzufügen / Bearbeiten</h2>

**Manuell** öffnet **MCP-Server hinzufügen** (bei einem vorhandenen Server **MCP-Server bearbeiten**):

| Feld | Bedeutung |
|------|-----------|
| **Name** | Anzeige-Id |
| **Transport** | **stdio (lokaler Prozess)** · **HTTP (remote)** · **SSE (streamfähiges HTTP)** — der Transport `sse` ist Streamable HTTP; hänge **kein** `/sse` an. Den Session-Header übernimmt EYAS. |
| **Befehl** / **Argumente** | Nur stdio: der Prozess (`npx`) und seine durch Leerzeichen getrennten Argumente |
| **URL** | Nur HTTP / SSE: der Endpunkt (ohne `/sse`-Suffix) |
| **API-Schlüssel (optional)** | Nur HTTP / SSE: wird als Bearer-Token gesendet |

Server, die sich per OAuth anmelden, kommen aus dem Katalog oder aus Medien; der Dialog hat keine OAuth-Option.

<h2 id="catalog">Katalog</h2>

| Element | Bedeutung |
|---------|-----------|
| Kategoriefilter | **Alle (N)** plus je eine Kategorie |
| **Installieren / Installiert** | Mit einem Klick, oder schon vorhanden |
| **Einrichtungsanleitung** / **Anleitung ausblenden** | Die Herstelleranleitung aufklappen |
| Schlüsseldialog | Benötigte Schlüssel vor **Installieren & verbinden** |
| Lizenzhinweis | *Lizenziert unter … Läuft als separater Prozess — EYAS bleibt MIT.* |

Leere Aktiv-Liste: *Keine MCP-Server konfiguriert* — **Katalog durchsuchen**.

<h3 id="memory-store-servers-are-blocked">Speicher-Server sind gesperrt</h3>

Ein MCP-Server, der einen zweiten Speicher außerhalb von EYAS hält, würde für jedes Modell zu einer lebenden Lese-/Schreibquelle. Solche Server sind für jedes Modell gesperrt — API-Anbieter, Claude Code, Grok CLI und Kimi CLI gleichermaßen. EYAS liest und schreibt Speicher nur über seine eigenen Speicher; anderen Speicher holst du über einen einseitigen Import herein (**Einstellungen → System → Datenportabilität → Daten importieren**, siehe [Datenimport](/docs/de/admin/data-port/)).

Was als Speicher gilt:

- Die Katalogeinträge **Memory** (Knowledge-Graph-Server), **Qdrant** und **Obsidian**. Sie stehen unter **Nicht verfügbar — Speicher außerhalb von EYAS**, mit deaktiviertem **Installieren**, einer kurzen Erklärung und einer Schaltfläche **Zur Datenportabilität**.
- Ein von Hand hinzugefügter Server, dessen Befehl oder Argumente ein bekanntes Speicher-Paket oder -Binary nennen: der MCP-Referenz-Speicherserver (`@modelcontextprotocol/server-memory`, `mcp-server-memory`), MCPVault (`@bitbonsai/mcpvault`, `mcpvault`), Obsidian-MCP-Server (`mcp-obsidian`, `obsidian-mcp`, `obsidian-mcp-server`), Basic Memory, Mem0/OpenMemory und die Pakete der markierten Katalogeinträge (zum Beispiel `mcp-server-qdrant`). Ein Versionssuffix spielt keine Rolle. Abgeglichen werden nur Paket- und Binary-Namen, nie der Anzeigename; ein Server, der nur „memory“ *heißt*, installiert sich also normal.
- Ein Server, dessen Argument, `--flag=value`-Wert, Umgebungsvariablenwert, Befehlspfad oder `file://`-URL auf einen geschützten Ordner zeigt: den Speicher oder Zustand eines anderen Tools (`~/.claude`, `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, `~/.codeium`, die Ordner von OpenCode, `ai-memory`-Ordner, einen Obsidian-Vault, Einträge in `security.foreignMemoryPaths`), den eigenen Datenordner von EYAS (Vault, Datenbank, Schlüssel — Workspaces von Unterhaltungen bleiben erlaubt) oder die EYAS-eigenen CLI-Homes. Ein Filesystem-Server, der auf einen Obsidian-Vault oder auf `data/vault` zeigt, ist gesperrt; einer, der auf einen normalen Projektordner zeigt, ist in Ordnung. Server, die EYAS aus `data/mcp-servers/` startet — dem Ordner, in den `config/mcp.yaml` sie klont —, sind Servercode, kein Speicher, und erlaubt (beurteilt wird ihr echter Pfad, ein Link von dort in den Vault bleibt also gesperrt).

**Was passiert.** Installation aus dem Katalog, Hinzufügen von Hand oder das Bearbeiten eines Servers hin zu einer solchen Konfiguration wird mit einer übersetzten Meldung abgelehnt, und nichts wird gespeichert. Server, die eingerichtet wurden, bevor es die Sperre gab, werden nicht gelöscht: Beim Start werden sie als **Gesperrt** markiert, nie gestartet, und keines ihrer `mcp_*`-Tools erreicht ein Modell. Der Tab **Aktiv** zeigt ein Badge **Gesperrt: Speicher** mit dem Grund und einem Link zum Datenimport. Markiert die Regel einen Server nicht mehr (zum Beispiel weil ein Ordner aus `security.foreignMemoryPaths` entfernt wurde), verlässt er den Zustand Gesperrt beim nächsten Start. Speicher-Einträge in `config/mcp.yaml` werden mit einem Fehler im Log übersprungen.

**Migration.** Bestehende Installationen verlieren einen bisher funktionierenden Memory-, Qdrant-, Obsidian- oder MCPVault-Server und jeden Server, der auf einen Vault oder den Speicher eines anderen Tools zeigt. Das ist beabsichtigt: Kopiere diesen Speicher einmal per Datenimport nach EYAS.

**API (Integratoren).** `GET /api/v1/mcp/servers` enthält pro Server `blocked: 'memory_store' | null` (Status `blocked`). `POST /api/v1/mcp/servers`, `PUT /api/v1/mcp/servers/:id`, `POST /api/v1/mcp/registry/:id/install` und `POST /api/v1/mcp/servers/:id/refresh` antworten mit `409 {error, code: 'memory_store_blocked'}`; `POST /api/v1/mcp/servers/:id/test` liefert `{ok: false, code: 'memory_store_blocked'}`. Katalogeinträge tragen `memoryStore: true`.

---

<h2 id="cli-mcp-tool-parity-grok--kimi">CLI-MCP-Tool-Parität (Grok / Kimi)</h2>

API- und In-Process-Anbieter teilen sich bereits die EYAS-Tools. Für **Host-CLI**-Anbieter:

| Anbieter | Verhalten |
|----------|-----------|
| **Claude Code** | In-Process-MCP-Server namens `eyas`, aufgerufen als `mcp__eyas__<name>`. Er läuft nicht über die stdio-Bridge unten und hängt daher nicht von deren Selbsttest beim Start ab. Es ist der einzige MCP-Server, den Claude Code lädt. |
| **Grok CLI / Kimi Code CLI** | Stdio-MCP-Server + Loopback-Bridge (`/api/v1/internal/cli-mcp/tools/list` und `/tools/call`) mit einem Geheimnis pro Zug; ACP `session/new` bekommt `mcpServers`, sodass die CLI dieselben ToolExecutor-Tools aufrufen kann. Es ist der einzige MCP-Server, mit dem sie sich verbinden dürfen: Host- und Projekt-MCP-Server werden nicht geladen (siehe [Anbieter](/docs/de/ai/providers/#grok-cli-and-kimi-code-cli)). |

OpenCode ist hier kein MCP-Host: In einer `opencode_run`-Aufgabe bekommt es `memory_search` / `memory_expand` stattdessen vom EYAS-Speicher-Plugin (siehe [unten](#tool-names-per-host) und [OpenCode](/docs/de/automation/opencode/)).

**Welche EYAS-Tools eine CLI bekommt.** Eine Regel für beide Bridges: jedes EYAS-Tool im Umfang des Agenten — seine **Tools**-Liste plus `memory_search` und `memory_expand` (eine leere Liste bedeutet alle Tools), in einer **Solo**-Unterhaltung ohne `run_specialist`, `delegate_to_agent`, `handoff_to_colleague` und `propose_team` — **außer** denen, für die die CLI ein gewährtes eigenes Gegenstück hat: `read_file`, `grep` und `glob` (die Lese-Werkzeuge der CLI sind immer gewährt), `write_file` und `edit_file`, solange die Liste des Agenten Schreiben gewährt, und `run_command`, `git_status` und `git_diff`, solange sie die Shell gewährt. Dafür nutzt die CLI ihre eigenen Shell- und Datei-Werkzeuge in den Ordnern des Zugs, unter der [Kernel-Datei-Sandbox](/docs/de/ai/providers/#kernel-file-sandbox) und der Speicherpfad-Policy. Ein EYAS-Tool, dessen CLI-Gegenstück nicht gewährt ist, wird stattdessen über die Bridge angeboten — `git_status` und `git_diff` auf einer Liste ohne `run_command`. Die **Tools**-Liste des Agenten begrenzt außerdem die eigenen Schreib-, Shell- und Web-Werkzeuge der CLI (siehe [Agenten — Tools](/docs/de/agents/configure/#tools--constraints)). CLI-Modelle bekommen außerdem die EYAS-Browser-Tools (`browser_*`, einschließlich gespeicherter Sessions und `browser_totp`), `agent_browser_*`, `browser_use_*` und `opencode_*`. Sie laufen in EYAS unter demselben Security-Gate, denselben Freigaben, Berechtigungen und demselben Tool-Umfang wie bei API-Modellen. Bei Grok und Kimi speichert die Bindung pro Zug den Tool-Umfang auf dem Server: `tools/list` zeigt genau die erlaubten Tools, `tools/call` lehnt jedes andere ab — bevor das Security-Gate gefragt wird, sodass nie eine Freigabe entsteht —, und die Ablehnung erscheint in der Tool-Zeile des Zugs als **Abgelehnt**. Die Tool-Liste im System-Prompt eines CLI-Modells nennt die EYAS-Tools nicht, die die gewährten eigenen Werkzeuge der CLI ersetzen.

Das Ergebnis: Coding-CLIs und der Web-Agentenpfad sehen **eine einheitliche Tool-Oberfläche**, statt parallele Integrationen zu erfinden. Bei Claude Code trägt jeder gebridgte Tool-Aufruf die Unterhaltung, ihr Projekt, die Antwort (den Zug) und den Lauf, sodass Speicher-Drill-down wie bei den anderen Anbietern **3 Aufrufe pro Antwort** erlaubt, Speicherergebnisse auf das Projekt der Unterhaltung, dessen Typ und den globalen Speicher beschränkt bleiben und Tool-Ausführungen dem überwachten Lauf zugeordnet werden. Eine Anfrage außerhalb einer Unterhaltung wird keiner leeren Unterhaltungs-Id zugeordnet. Grok- und Kimi-Agenten erreichen `memory_search` / `memory_expand`, das Board, Dokumente, die Suche und die übrigen EYAS-Tools. Der Helfer sagt dem Modell außerdem, dass der EYAS-Speicher der einzige Speicher ist und dass `memory_search` / `memory_expand` von diesem Server kommen.

<h3 id="how-the-bridge-is-secured">Wie die Bridge gesichert ist</h3>

- Jeder Antwortzug bekommt sein eigenes zufälliges Geheimnis (192 Bit).
- EYAS vermerkt auf dem Server, zu welcher Unterhaltung, welchem Agenten, Projekt, Zug und Lauf das Geheimnis gehört, ob der Zug begleitet (ein interaktiver Chat oder eine Kanal-Unterhaltung) oder autonom ist (ein Hintergrundlauf; ein nicht als begleitet gekennzeichneter Zug gilt als autonom) und bei einem fortgesetzten Lauf die Liste der bereits ausgeführten Aufrufe. Der Helferprozess legt nur das Geheimnis vor; nichts, was er sendet, kann einen Tool-Aufruf für eine andere Unterhaltung, ein anderes Projekt oder einen anderen Benutzer handeln lassen.
- Das Geheimnis wird widerrufen, sobald der Zug endet (fertig, fehlgeschlagen, gestoppt oder abgebrochen), und läuft 2 Stunden nach seiner letzten Nutzung ab, sodass ein langer, aktiver Zug seine EYAS-Tools behält.
- Eine Anfrage, die erkennbar über einen Proxy von einer nicht-lokalen Adresse kam, wird abgelehnt, auch mit gültigem Geheimnis.
- Gebridgte Tool-Aufrufe durchlaufen dieselbe Entscheidung wie die Tool-Aufrufe von Claude Code und die eigene Tool-Schleife der API-Anbieter: zuerst die Toolset-Prüfung (ein Tool außerhalb der Liste des Agenten wird vor dem Gate als **Abgelehnt** zurückgewiesen und legt daher nie eine Freigabe an), dann das EYAS-[Security-Gate](/docs/de/admin/security-privacy/) und bei autonomen Zügen die Autonomie-Leiter; die Berechtigungsprüfung läuft als der Agent. In einem begleiteten Chat oder einer Kanal-Unterhaltung läuft ein Aufruf, den das Gate erlaubt — ein als freigabepflichtig markiertes Tool wartet nicht mehr nur deshalb in der Warteschlange, weil das Modell Grok oder Kimi ist —, und ein Aufruf, den das Gate eskaliert, zeigt eine Freigabekarte, ohne den Chat anzuhalten. In einem autonomen Lauf wartet ein Aufruf auf **Hinweis** oder **Freigeben** auf Freigabe, und ein eskalierter Aufruf wartet immer auf einen Menschen, auch auf **Auto** (früher lief er auf Grok und Kimi ungefragt). Ohne laufendes Security-Gate wird jeder gebridgte Aufruf abgelehnt. Die Bridge kennt die Ordner des Zugs auf dem Server — alle Ordner der Unterhaltung, nicht nur den ersten —, sodass EYAS-Datei-Tools darin funktionieren, und eine Anfrage kann nie eigene Ordner nennen.
- Wird ein gebridgtes EYAS-Tool abgelehnt oder wartet es auf eine Freigabe, geht das Ergebnis an dieselbe Tool-Zeile der Unterhaltung zurück, mit dem Eintrag der Freigabe in der Freigabe-Warteschlange. In einem überwachten autonomen Lauf pausiert eine solche Freigabe den Lauf (**Wartet auf Freigabe**), sobald der Zug der CLI endet, genau wie eine Freigabe für die eigenen Werkzeuge der CLI; nach der Freigabe läuft er weiter, und genau der freigegebene Aufruf ist einmal erlaubt.
- Ein fortgesetzter oder erneut versuchter Lauf, der einen EYAS-Tool-Aufruf wiederholt, den der ursprüngliche Lauf bereits abgeschlossen hat, wird abgelehnt, bevor er läuft, und die Zeile zeigt **Übersprungen** — *already executed on the original run — duplicate side effect prevented*. Dasselbe Tool mit anderen Argumenten läuft weiterhin. Auf Grok hält die Tool-Zeile eines EYAS-Tools die Argumente fest, die das Tool bekommen hat (`tool_input` von `use_tool`), nicht Groks Hülle, sodass der fortgesetzte Lauf die Wiederholung erkennt. Bewiesen mit der installierten Grok CLI durch die Release-Prüfung; wie ein echtes Kimi-Binary diese Aufrufe meldet, ist noch auf keinem Host geprüft.
- Ergebnisse von Speicher-Tools (`memory_search`, `search_memory`, `memory_expand`, `search_knowledge`, `get_page`, `read_team_memory`), einschließlich ihrer Fehlertexte, werden von der Datenschutz-Policy maskiert, bevor die CLI sie bekommt — genau wie Speicher im Prompt: Der Hersteller der CLI gilt immer als entfernt, und nichts, was der Helfer sendet, kann das ändern. Dieselbe Maskierung gilt für die In-Process-EYAS-Tools von Claude Code. Scheitert der Scan, wird das Ergebnis zurückgehalten (*Error: memory tool result withheld (privacy scan failed)*). Ergebnisse anderer Tools gehen unverändert durch. Siehe [Wo maskiert wird](/docs/de/admin/security-privacy/#where-masking-applies).
- Genau zwei interne Pfade umgehen die Web-Anmeldung: `/api/v1/internal/cli-mcp/tools/list` und `/api/v1/internal/cli-mcp/tools/call`. Jeder andere interne Pfad verlangt weiterhin eine Anmeldung.

Der Helfer läuft mit derselben Laufzeit wie EYAS (Bun), von seinem eigenen Installationsort, und funktioniert daher auch in Docker-Images; `EYAS_INSTALL_ROOT` wird zum Finden nicht benutzt.

<h3 id="boot-self-test">Selbsttest beim Start</h3>

Beim Start testet EYAS die Bridge über den vollen Request-Stack, genauso, wie der Helfer sie aufrufen wird. Erfolg wird als *CLI tool bridge self-test passed* geloggt. Ein Fehlschlag ist eine Warnung — *CLI tool bridge self-test failed — Grok/Kimi turns cannot reach EYAS tools (memory, board, …)* — mit angehängtem Grund; der Start läuft weiter, aber Grok und Kimi laufen dann ohne EYAS-Tools. Auf einer frischen Installation wird der Test bis zum Abschluss des Setup-Assistenten verschoben (Info-Log) und läuft beim nächsten Start.

| Grund in der Warnung | Was zu tun ist |
|----------------------|----------------|
| `tools/list returned HTTP 401 … Authentication required` | Dem laufenden Build fehlt die Bridge-Ausnahme. Aktualisieren oder neu bauen, dann neu starten. |
| `stdio MCP server not found at …` | Dem Build fehlt `dist/stdio-mcp-server.js`. Mit `bun run build` neu bauen (Docker-Images aus dieser Version enthalten es), dann neu starten. |
| `HTTP 404` | Das Tools-Modul ist deaktiviert, es gibt also keine EYAS-Tools anzubieten. |

<h3 id="outside-mcp-clients">Externe MCP-Clients</h3>

Clients von EYAS' eigenem MCP-Server (`/api/v1/mcp/tools/call`) haben keine EYAS-Unterhaltung. Ihre Speicher-Tool-Aufrufe lesen nur globalen Speicher, mit einem Limit von 3 Aufrufen pro 90 Sekunden. Siehe [Speicher — Weitersuchen](/docs/de/knowledge/memory/#looking-further-memory_search-and-memory_expand).

- **Maskiert.** Speicher-Tool-Ergebnisse an einen externen MCP-Client werden von der Datenschutz-Policy maskiert wie bei jedem anderen entfernten Ziel — ein externer Client kann jedes Modell nutzen und gilt daher immer als entfernt. Ein fehlgeschlagener Scan hält das Ergebnis zurück.
- **Geprüft.** Ein fehlerhafter `tools/call`-Body bekommt HTTP `400` mit einem JSON-RPC-Fehler: `-32600` *Invalid Request* für einen Body, der kein JSON oder kein Objekt ist, `-32602` *Invalid params* für einen fehlenden Namen oder `arguments`, die kein Objekt sind. Ein unbekanntes Tool ist `404` mit `-32601`.

<h2 id="tool-names-per-host">Tool-Namen pro Host</h2>

EYAS-Tools haben einen kanonischen Namen (`memory_search`, `memory_expand`, …). Jeder Modell-Host listet sie anders:

| Host | Wie das Modell `memory_search` aufruft |
|------|----------------------------------------|
| API-Anbieter (Anthropic, OpenAI, Gemini, OpenRouter, Kimi API, Ollama, LM Studio, kompatible Endpunkte) | `memory_search` — EYAS führt das Tool selbst aus |
| Claude Code CLI | `mcp__eyas__memory_search` — die Tools kommen vom In-Process-MCP-Server `eyas` von EYAS, der nicht über die stdio-Bridge läuft und daher nicht von deren Selbsttest abhängt |
| Grok CLI | EYAS-Tools stehen nicht in Groks eigener Tool-Liste. Das Modell findet eines mit `search_tool` und ruft dann `use_tool` mit `tool_name` `eyas__memory_search` und den Argumenten in `tool_input` auf. Ein bloßes `memory_search` ist in Grok Groks eigenes eingebautes Speicher-Tool, nicht der EYAS-Speicher; deshalb sagt EYAS einem Grok-Modell nie, ein bloßes `memory_search` aufzurufen. |
| Kimi Code CLI | `memory_search` auf dem MCP-Server `eyas`. Kimis genaue Benennung ist noch nicht geprüft, daher nennt EYAS den Server statt eines qualifizierten Tool-Namens. |
| OpenCode (in einer `opencode_run`-Aufgabe) | `memory_search` — ein Tool des EYAS-Speicher-Plugins in OpenCode, mit EYAS' eigenem Namen, eigener Beschreibung und eigenen Argumenten. Das Plugin schickt den Aufruf an EYAS, das das echte Tool für das Gespräch der Aufgabe ausführt. Es bietet nur `memory_search` und `memory_expand`, nichts, was schreibt. |

Weiß EYAS, welcher Anbieter einen Zug ausführt, endet die Tool-Liste im System-Prompt mit einer Zeile, die dem Modell sagt, wie es die gelisteten Tools auf seinem Host aufruft — bei Claude Code, dass die EYAS-Tools vom EYAS-MCP-Server kommen und als `mcp__eyas__<name>` aufgerufen werden. Speicher-Hinweise und die Zeile *N weitere Notizen* benennen die Tools genauso. Modelle bei API-Anbietern sehen die einfachen Namen. Es gibt nichts zu konfigurieren. Wechselt ein Gespräch zu einem Anbieter mit anderer Tool-Benennung, ändert sich der gecachte Prompt-Präfix einmal (ein einmaliger Prompt-Cache-Miss).

## Verwandt

- [Werkzeuge](/docs/de/automation/tools/)
- [OpenCode](/docs/de/automation/opencode/)
- [Medien](/docs/de/ai/media/)
- [Agenten konfigurieren](/docs/de/agents/configure/)
- [Verbindungen](/docs/de/admin/connections/)
- [Anbieter](/docs/de/ai/providers/)
- [Datenimport](/docs/de/admin/data-port/)
