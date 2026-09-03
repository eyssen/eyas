---
title: Kapcsolatok
description: Külső rendszerek leltára — health, secrettek, ágens javaslatok.
---

**Mire való.** A Kapcsolatok (`/connections`) a *külső rendszerek* (Odoo, GitHub, MCP, …) névvel ellátott leltára, amelyeket az ágensek jóváhagyásod után használhatnak. Nem [Csatornák](/docs/hu/communication/channels/) (üzenetküldő fiókok, pl. Telegram) és nem a [Secrets vault](/docs/hu/admin/secrets/) (ahol a hitelesítők vannak). A rendszert ide tedd; a jelszót vagy tokent a Titkokba; a chat-botot a Csatornák alá.

**Útvonal:** `/connections`.  
Alcím: *Külső rendszerek, amiket az EYAS használhat — leltár, health, ágens javaslatok.*

A Connections **névvel ellátott leltár** külső rendszerekről (Odoo, GitHub, MCP, …). A hitelesítő adatok a [Secrets vault](/docs/hu/admin/secrets/)ba kerülnek; az ágensek **javasolhatnak** kapcsolatot emberi jóváhagyásra, ahelyett hogy MCP/skill/ad-hoc secret darabokban élnének.

---

## Tabok

| Tab | Cél |
|-----|-----|
| **Connections** | Aktív leltár (connected / error / disabled / unknown) |
| **Catalog** | Ismert rendszertípusok — válassz egyet a létrehozáshoz |
| **Pending** | Ágens-javaslatok **Approve** / **Reject** várakozással |

---

## Lista

| Vezérlő / mező | Jelentés |
|----------------|----------|
| **N connections** | Sorok száma |
| **Add connection** | Létrehozó űrlap (vagy Catalog → **Use**) |
| **Name** | Példány neve |
| **System** | Katalógus típus |
| **Status** | Pending / Disabled / Connected / Error / Unknown |
| **Adapter** | `native` / `http` / `mcp` |
| **Last check** | Utolsó health teszt |
| **Error** | Utolsó hibaüzenet |
| **Source** | **User** / **Agent** / **System** |
| **Test** | Health adapter futtatása |
| **Edit / Delete** | Szerkesztés / törlés |

Üres: *No connections yet…*

---

## Létrehozás / szerkesztés

| Mező | Jelentés |
|------|----------|
| **Name** | Megjelenített név |
| **System type** | Katalógus bejegyzés |
| **Configuration** | Nem-secret mezők (URL, db, org, …) |
| **Secrets** | Érzékeny mezők — vault: `conn-{id}-{field}`; *mentés után nem látszanak újra* |
| **Save / Cancel** | Mentés / elvetés |

Gyorslinkek: **MCP Settings**, **Secrets**.

---

## Katalógus típusok

| Típus | Adapter | Tipikus használat |
|-------|---------|-------------------|
| **Odoo** | native | ERP / Helpdesk JSON-RPC + ticket toolok |
| **GitHub / GitLab** | http | Repo, issue, PR/MR |
| **Linear / Notion / Jira** | http | Issue / wiki / Atlassian |
| **Slack (API)** | http | Workspace bot toolok (chat csatorna külön) |
| **MCP server** | mcp | Leltár sor → már beállított [MCP](/docs/hu/ai/mcp/) szerver |
| **Playwright MCP** | mcp | Opcionális Microsoft `@playwright/mcp` (Apache-2.0, npx). a11y-snapshot + elem-ref; opcionális Playwright MCP Bridge extension élő fülhöz. Az ügynök tooljai a meglévő MCP-hídon jönnek (`mcp_playwright_*`). A Test fail-closed doctor (Node 18+, npx). Telemetria ki. `--no-sandbox` tilos. Nem a Python browser-use MCP. |
| **Agent Browser** | mcp | Opcionális Vercel `agent-browser` (Apache-2.0 CLI+MCP). `@e1` refek, state save/load. Test fail-closed (`EYAS_AGENT_BROWSER_BIN` / PATH). Soha `chat`, soha a napi Chrome-profil. Toolok: `mcp_agent_browser_*`. |
| **Chrome DevTools MCP** | mcp | Opcionális Google `chrome-devtools-mcp` (Apache-2.0 npx). Coding/debug: konzol, hálózat, Lighthouse, WebMCP. **Nem** űrlapkitöltés. Katalógus → Chrome DevTools MCP (`--isolated`). Test fail-closed (Node 18+, npx). `--autoConnect` és a napi Chrome-profil tiltott. Toolok: `mcp_chrome-devtools_*`. WebMCP csak ha a sidecar listázza. |
| **Custom HTTP** | http | Általános REST |

### Playwright MCP (opcionális)

Telepítés: **Beállítások → MCP szerverek → Katalógus → Playwright MCP**, aztán Connections-sor ebből a típusból (`mcpServerName` alapból `playwright`), hogy a **Test** doctorozhassa.

- Az ügynökön `mcp_playwright_*` toolok, miután az MCP szerver kapcsolódott. Az EYAS nem vendorolja a csomagot.
- Élő fül: Playwright MCP Bridge extension, `--extension` a `--isolated` helyett. Soha a napi Chrome/Edge profil.
- A doctor fail-closed, mint a Hyperframes CLI: hiányzó Node 18+ vagy npx → Test orvossággal elhasal. Telemetria ki (`DO_NOT_TRACK=1`).
- Soha `--no-sandbox` / `PLAYWRIGHT_MCP_NO_SANDBOX`. Soha a Python `browser-use` MCP (`uvx browser-use --mcp`) — LLM-kulcsot kér, és `retry_with_browser_use_agent`-et hoz.

### Agent Browser (opcionális)

CLI: `npm i -g agent-browser`, majd `agent-browser install`, vagy `EYAS_AGENT_BROWSER_BIN`. **Beállítások → MCP szerverek → Katalógus → Agent Browser** (`mcp --tools core,state`). Connections-sor: `mcpServerName` = `agent-browser`.

- Toolok: `mcp_agent_browser_*`. `--tools all` / `debug` → `core,state` (`chat`).
- Profil: `data/browser/agent-browser/profile`. Soha Default / napi Chrome (Chrome 136+).
- Doctor fail-closed. Soha `mcp-agent-browser` wrapper, soha `chat`.

### Chrome DevTools MCP (opcionális, coding / debug)

Telepítés: **Beállítások → MCP szerverek → Katalógus → Chrome DevTools MCP**, aztán Connections-sor (`mcpServerName` = `chrome-devtools`).

- Toolok: `mcp_chrome-devtools_*`. Ez **nem** az űrlap-sáv — arra a natív `browser_*`.
- Katalógus: `--isolated`, telemetria ki, `--categoryExperimentalWebmcp=true`.
- WebMCP csak ha a sidecar hirdeti (Chrome 150+, `--enable-features=WebMCP`). Hiányzó tool nincs kitalálva.
- Doctor fail-closed. `--autoConnect` és `--no-sandbox` elhasal.
- Soha a napi Chrome-profil `--user-data-dir`.

Headless `browser_*`, CLI-sidecarek és ez a coding/debug MCP: [Browser Use](/docs/hu/automation/browser-use/).

---

## Függő javaslatok

Ágensek toolokkal **javasolhatnak** kapcsolatot. **Pending** tab: **Reason**, **Approve**, **Reject**.

---

## Ágens toolok

| Tool | Cél |
|------|-----|
| `connections_list` / `connections_catalog` | Leltár + katalógus |
| `connections_test` | Health |
| `connections_propose` | Javaslat jóváhagyásra |

## Kapcsolódó

- [Secrettek](/docs/hu/admin/secrets/)
- [MCP szerverek](/docs/hu/ai/mcp/)
- [Browser Use](/docs/hu/automation/browser-use/)
- [Toolok](/docs/hu/automation/tools/)
