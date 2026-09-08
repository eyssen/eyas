---
title: Verbindungen
description: Inventar externer Systeme — Health, Secrets, Agentenvorschläge.
---

**Wozu das dient.** Verbindungen (`/connections`) ist das benannte Inventar *externer Systeme* (Odoo, GitHub, MCP, …), die Agenten nach deiner Freigabe nutzen dürfen. Es sind nicht [Kanäle](/docs/de/communication/channels/) (Messaging-Konten wie Telegram) und nicht der [Secrets-Vault](/docs/de/admin/secrets/) (wo Zugangsdaten liegen). Das System hier; Passwort oder Token in Secrets; den Chat-Bot unter Kanäle.

**Route:** `/connections`.  
Untertitel: *Externe Systeme, die EYAS nutzen kann — Inventar, Health und Agentenvorschläge.*

Connections sind ein **benanntes Inventar** externer Systeme (Odoo, GitHub, MCP, …). Zugangsdaten liegen im [Secrets-Vault](/docs/de/admin/secrets/); Agenten können Verbindungen zur **menschlichen Freigabe vorschlagen**, statt Konfiguration über MCP/Skills/Ad-hoc-Secrets zu verstreuen.

---

## Tabs

| Tab | Zweck |
|-----|-------|
| **Connections** | Aktives Inventar (connected / error / disabled / unknown) |
| **Catalog** | Bekannte Systemtypen — wählen zum Anlegen |
| **Pending** | Agentenvorschläge: **Approve** / **Reject** |

---

## Liste

| Steuerung / Feld | Bedeutung |
|------------------|-----------|
| **N connections** | Anzahl der Einträge |
| **Add connection** | Anlegen (oder Catalog → **Use**) |
| **Name** | Anzeigename der Instanz |
| **System** | Katalogtyp |
| **Status** | Pending / Disabled / Connected / Error / Unknown |
| **Adapter** | `native` / `http` / `mcp` |
| **Last check / Error** | Letzter Health-Check / Fehler |
| **Source** | **User** / **Agent** / **System** |
| **Test / Edit / Delete** | Prüfen / bearbeiten / löschen |

---

## Formular

| Feld | Bedeutung |
|------|-----------|
| **Name** | Anzeigename |
| **System type** | Katalogeintrag |
| **Configuration** | Nicht-geheime Felder (URL, db, org, …) |
| **Secrets** | Sensible Felder im Vault als `conn-{id}-{field}` — *nach dem Speichern nicht erneut sichtbar* |
| **Save / Cancel** | Speichern / verwerfen |

---

## Katalogtypen

Odoo (native) · GitHub / GitLab · Linear · Notion · Jira · Slack (API) · **MCP server** (Link zu [MCP](/docs/de/ai/mcp/)) · **Playwright MCP** (optional, Apache-2.0 npx) · **Agent Browser** (optional, Apache-2.0 CLI+MCP, `mcp_agent_browser_*`) · **Chrome DevTools MCP** (optional, Apache-2.0 npx, Coding/Debug, `mcp_chrome-devtools_*`, kein Formularfüllen) · Custom HTTP.

### Playwright MCP (optional)

Installieren unter **Einstellungen → MCP-Server → Katalog → Playwright MCP**, dann eine Connections-Zeile dieses Typs (`mcpServerName` = `playwright`), damit **Test** den Doctor laufen lassen kann.

- Agent-Tools kommen über die bestehende MCP-Brücke als `mcp_playwright_*` (a11y-Snapshot + Element-Refs). Kein zweiter LLM-Loop.
- Live-Tab: Playwright-MCP-Bridge-Extension, `--extension` statt `--isolated`. Nie das tägliche Chrome/Edge-Profil.
- Doctor ist fail-closed wie die Hyperframes-CLI: fehlendes Node 18+ oder npx → Test schlägt fehl, mit Abhilfe. Telemetrie aus (`DO_NOT_TRACK=1`).
- Nie `--no-sandbox` / `PLAYWRIGHT_MCP_NO_SANDBOX`. Nie das Python-`browser-use`-MCP (`uvx browser-use --mcp`) — es verlangt einen LLM-API-Key und bringt `retry_with_browser_use_agent`.

### Chrome DevTools MCP (optional, Coding / Debug)

Installieren unter **Einstellungen → MCP-Server → Katalog → Chrome DevTools MCP**, dann eine Connections-Zeile (`mcpServerName` = `chrome-devtools`).

- Tools: `mcp_chrome-devtools_*`. **Kein** Formularfüllen — dafür `browser_*`.
- Katalog: `--isolated`, Telemetrie aus, `--categoryExperimentalWebmcp=true`.
- WebMCP nur, wenn der Sidecar sie anbietet (Chrome 150+). Fehlende Tools werden nicht erfunden.
- `--autoConnect` und `--no-sandbox` lassen Test fehlschlagen. Nie das tägliche Chrome-Profil.

Headless `browser_*`, CLI-Sidecars und dieser Coding/Debug-MCP: [Browser Use](/docs/de/automation/browser-use/).

---

## Agent-Tools

`connections_list` · `connections_catalog` · `connections_test` · `connections_propose`.

## Verwandt

- [Secrets](/docs/de/admin/secrets/)
- [MCP-Server](/docs/de/ai/mcp/)
- [Browser Use](/docs/de/automation/browser-use/)
- [Tools](/docs/de/automation/tools/)
