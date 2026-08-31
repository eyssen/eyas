---
title: Browser Use
description: Headless-Playwright-Tools für öffentliche Seiten und optionaler CLI-Sidecar für dein bereits eingeloggtes Chrome.
---

**Wozu das da ist.** Zwei Flächen. Headless `browser_*` öffnet öffentliche Seiten in EYASs eigenem Chromium — nummerierte Steuerelemente, Formulare, Download nach Dokumente. **Browser Use** (`/browser-use`) ist der optionale Sidecar, der **dein** echtes Chrome per CDP steuert, wenn Cookies und 2FA schon da sind. Kein fremdes LLM-SDK. Das Modell bleibt EYAS.

**Route:** `/browser-use`. Sidebar: **AI → Browser Use**. Katalog der Headless-Tools: [Werkzeuge](/docs/de/automation/tools/) (`/tools`).

## Wann du es brauchst

- Der Agent soll eine **öffentliche** Seite lesen oder ausfüllen, ohne dein Alltags-Chrome.
- Ein Download soll in [Dokumente](/docs/de/knowledge/documents/) und an die Conversation.
- Du brauchst das Chrome, in dem du **schon eingeloggt** bist — das ist der Sidecar.
- Ein Aufruf hing; du willst **Bereit** / **Nicht bereit** und die Abhilfe sehen.

## Typischer Ablauf

1. **Werkzeuge** (`/tools`). Suche `browser_`. Indexe statt CSS, `browser_snapshot`.
2. Ids auf dem Agenten-Tab **Konfiguration**. [Konfigurieren](/docs/de/agents/configure/).
3. Öffentliche Seite: navigieren, snapshot, per Index klicken, nach Navigation neu snapshoten.
4. Eingeloggtes Chrome: **Browser Use** (`/browser-use`). Bei **Nicht bereit** fehlenden Check nachrüsten (Python 3.11+, CLI auf PATH). Dann `browser_use_status`, danach `browser_use_exec`.
5. Kein Browser: [Hände](/docs/de/admin/hands/).

## Funktionen

### Vier Spuren

| Aufgabe | Wo | Tools |
|---------|-----|-------|
| Öffentliche Seite, headless | [Werkzeuge](/docs/de/automation/tools/) | `browser_*` — Playwright, nummerierte Indexe, EYAS-Profil |
| Persistente Auth, `@e1` (empfohlener Sidecar) | dieser Screen, `/browser-use` | `agent_browser_status`, dann `agent_browser_run` (oder `mcp_agent_browser_*`) |
| Legacy-Python-CLI | dieser Screen, zweite Karte | `browser_use_status`, dann `browser_use_exec` |
| a11y-Ref-MCP-Sidecar / Live-Tab | [Verbindungen](/docs/de/admin/connections/) + [MCP](/docs/de/ai/mcp/)-Katalog | `mcp_playwright_*`, sobald Playwright MCP verbunden ist |
| Coding/Debug: Konsole, Netzwerk, Lighthouse, WebMCP | [Verbindungen](/docs/de/admin/connections/) + [MCP](/docs/de/ai/mcp/)-Katalog | `mcp_chrome-devtools_*`, sobald Chrome DevTools MCP verbunden ist — **kein** Formularfüllen |
| Desktop-OS | [Hände](/docs/de/admin/hands/) | Hände |

<h2 id="headless">Headless Playwright (browser_*)</h2>

Kein Python. Dasselbe Chromium wie der Design-Print. Der **Prozess** dauert 5 Minuten; Cookies bleiben unter `data/browser/profile` (oder `EYAS_BROWSER_USER_DATA_DIR`). **Nie** das tägliche Chrome/Edge-Profil — Chrome 136+ blockiert CDP auf Default, EYAS lehnt es zuerst ab.

| Tool | Funktion |
|------|----------|
| `browser_navigate` | http(s)-URL. **SSRF** gegen private/Metadata-Hosts |
| `browser_snapshot` | Accessibility-Baum + nummerierte Liste + `snapshotId` |
| `browser_click` / `browser_fill` / `browser_hover` / `browser_select` | **Index** (bevorzugt) oder CSS |
| `browser_tabs` | `list` / `open` / `switch` / `close` — letzter Tab bleibt |
| `browser_back` | Zurück (Indexe ungültig) |
| `browser_wait` | Selektor, URL, Load oder Timeout (max. 30 s) |
| `browser_dialog` | Accept/Dismiss **bevor** der Klick `alert`/`confirm`/`prompt` öffnet |
| `browser_upload` | Dateifeld — Workspace-Pfade und/oder Dokument-Ids |
| `browser_evaluate` | JavaScript **in der Seite**, nicht in Node. JSON max. 50k |
| `browser_download` | Nächster Download → Dokumente, an die Conversation |
| `browser_storage` | Playwright-`storageState` speichern/laden |
| `browser_replay` / `browser_action_cache` | Gespeicherten Locator ohne LLM wiederholen. JSON im Projekt-Vault, sonst `procedural/browser-action-cache.json`. Kein Stagehand; keine Füllwerte/TOTP-Seeds |
| `browser_totp` | 6-stelliger TOTP aus [Geheimnisse](/docs/de/admin/secrets/) (oder macOS-Schlüsselbund). Code an `browser_fill`. Gelb. Seed kommt nie zurück |
| `browser_screenshot` / `browser_get_content` / `browser_close` | Bild, Text, Prozessende (Profil bleibt) |

Indexe und `snapshotId` sterben bei Navigation. Neu snapshoten. Ein erfolgreicher Klick/Fill mit `intent` speichert einen dauerhaften CSS/Rollen-Locator; `browser_replay` nutzt ihn auf demselben Origin. Downloads unter **Dokumente** (`/documents`). Gefährliche Aufrufe warten auf [Freigabe](/docs/de/admin/security-privacy/).

<h2 id="agent-browser">Agent Browser (empfohlener Sidecar)</h2>

Optionales Vercel `agent-browser` (Apache-2.0). Kein vendortes Rust. Auflösung: `EYAS_AGENT_BROWSER_BIN` → PATH. Gesetzter, fehlender Pfad = fail-closed. Installation: `npm i -g agent-browser`, dann `agent-browser install`. Agent: `agent_browser_status`, dann `agent_browser_run` mit `argv` (`["snapshot","-i"]`, `["click","@e1"]`) oder `batch`. Profil: `data/browser/agent-browser/profile`. Nie Default / tägliches Chrome (Chrome 136+). Nie `chat`, nie `--no-sandbox`. MCP: Katalog **Agent Browser** (`mcp --tools core,state`) → `mcp_agent_browser_*`.

<h2 id="sidecar">Python-CLI (Legacy)</h2>

Das Extra-Modul umhüllt weiterhin die MIT-Browser-Use-**CLI**. Keine vendorte Python-Lib, keine LLM-SDKs. Telemetrie aus. Cloud-Key nur wenn in den Einstellungen an. Nie `--no-sandbox`. Agent Browser bevorzugen, wenn Bereit.

Braucht: Python 3.11+ und `browser-use` auf PATH, `uvx` oder `EYAS_BROWSER_USE_BIN`.

Ist ein Check **Fehlt**, ist die CLI nicht bereit — Abhilfe installieren, dann `browser_use_exec`. Keine CDP-URL erfinden.

<h2 id="playwright-mcp">Playwright MCP (Verbindungen)</h2>

Optionales Microsoft `@playwright/mcp` (Apache-2.0). Installieren unter **Einstellungen → MCP-Server → Katalog**, optional als [Verbindungen](/docs/de/admin/connections/)-Zeile **Playwright MCP**. **Test** ist fail-closed (Node 18+, npx), wie die Hyperframes-CLI. Telemetrie aus (`DO_NOT_TRACK=1`). `--no-sandbox` wird entfernt und verweigert.

Kein zweiter LLM-Loop. Tools kommen über die bestehende MCP-Brücke als `mcp_playwright_*` (a11y-Snapshot + Element-Refs). Für einen Live-Tab: Playwright-MCP-Bridge-Extension und `--extension` (ohne `--isolated`). Nie das tägliche Chrome-Profil.

Das Python-`browser-use`-MCP (`uvx browser-use --mcp`) **nicht** installieren. Es verlangt einen LLM-API-Key und bringt `retry_with_browser_use_agent`. EYAS lehnt diesen Sidecar bei add/connect ab.

<h2 id="chrome-devtools-mcp">Chrome DevTools MCP (Coding / Debug)</h2>

Optionales Google `chrome-devtools-mcp` (Apache-2.0). Installieren unter **Einstellungen → MCP-Server → Katalog → Chrome DevTools MCP**, optional als [Verbindungen](/docs/de/admin/connections/)-Zeile **Chrome DevTools MCP**. **Test** ist fail-closed (Node 18+, npx). Telemetrie aus. `--no-sandbox` und `--autoConnect` (tägliches Chrome, Chrome 136+) werden verweigert. Katalog: `--isolated`.

Das ist **nicht** die Formular-Spur. `click` / `fill` / `fill_form` dieses Servers nicht für Formulare nutzen — das bleibt `browser_*`. Tools kommen über die MCP-Brücke als `mcp_chrome-devtools_*` (Konsole, Netzwerk, Lighthouse).

**WebMCP ist fail-closed.** Katalog: `--categoryExperimentalWebmcp=true`. `list_webmcp_tools` / `execute_webmcp_tool` erscheinen **nur**, wenn der Sidecar sie anbietet (Chrome 150+, `--enable-features=WebMCP`). Fehlen sie, erfindet EYAS sie nicht.

## Felder und Steuerelemente

<h2 id="status">Statuskarte</h2>

| Steuerung | Bedeutung |
|-----------|-----------|
| Titel | **Browser Use** |
| Untertitel | Optionaler CLI-Sidecar für dein Chrome per CDP |
| Spur-Hinweis | Headless `browser_*` öffentlich; Sidecar eingeloggt; Hände für den Rest |
| Badge | **Bereit** / **Nicht bereit** |
| Leer | *Die Browser-Use-CLI ist nicht bereit…* |
| Check-Zeile | Label + **OK** / **Fehlt** / **Warnung**, Detail, Abhilfe |
| Hilfe **?** | Öffnet dieses Kapitel |

Der Sidecar startet von diesem Screen keine Aufgaben. Der Agent ruft `browser_use_exec`, wenn der Status bereit ist.

## Verwandt

- [Werkzeuge](/docs/de/automation/tools/)
- [Verbindungen](/docs/de/admin/connections/)
- [MCP-Server](/docs/de/ai/mcp/)
- [Dokumente](/docs/de/knowledge/documents/)
- [Hände](/docs/de/admin/hands/)
- [Sicherheit & Datenschutz](/docs/de/admin/security-privacy/)
- [Konfiguration](/docs/de/deploy/configuration/) (`EYAS_BROWSER_USER_DATA_DIR`)
