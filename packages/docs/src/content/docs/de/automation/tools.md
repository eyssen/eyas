---
title: Werkzeuge
description: Katalog aufrufbarer Fähigkeiten — Risiko, Freigabe, Zuweisung.
---

**Wozu das da ist.** Werkzeuge sind die Aktionen, die ein Agent wirklich ausführt. Diese Seite ist der Live-Katalog dieser Instanz. Die Zuweisung bleibt auf dem Agenten-Tab **Konfiguration**; hier prüfst du Name, Kategorie, Risiko und ob ein Aufruf auf Freigabe wartet.

**Route:** `/tools`. Untertitel: *Registrierte Werkzeuge für die Agentenausführung.* Sidebar: **Werkzeuge**.

## Wann du es brauchst

- Bevor du Ids auf einen Agenten schreibst.
- Ein Aufruf wurde blockiert — Risikostufe und **Freigabe erforderlich**.
- MCP oder Connection verdrahtet, entdeckte Tools neben den Builtins.
- Input-Schema, weil der Agent falsch aufruft.

## Typischer Ablauf

1. **Werkzeuge** (`/tools`).
2. Suche oder Filter **Kategorie** / **Risikostufe**.
3. **Schema anzeigen** für JSON-Input.
4. Id auf dem Agenten-Tab **Konfiguration**. Siehe [Konfigurieren](/docs/de/agents/configure/).
5. Gefährliche Aufrufe laufen trotzdem durch das [Security-Gate](/docs/de/admin/security-privacy/).

## Funktionen

Kopf zählt **Werkzeuge** und wie viele **Freigabe erfordern**. Karten: Monospace-Id, Beschreibung, Kategorie, Risiko (**low / medium / high / critical**), Schild wenn Freigabe nötig.

| Begriff | Bedeutung |
|---------|-----------|
| Tool-Name | Stabile Id in Config und Logs |
| Kategorie | `system`, `file`, `network`, `compute`, `data`, … |
| Risikostufe | steuert Gate / Freigabe |
| **Freigabe erforderlich** | Läuft nicht ohne Mensch |
| Schema | JSON Schema — **Schema anzeigen / ausblenden** |
| Berechtigungen | CASL plus Security-Gate |
| Sandbox | Manche Tools in eingeschränkter Umgebung |

Leer: *Noch keine Werkzeuge registriert.*

MCP unter [MCP-Server](/docs/de/ai/mcp/). Credentials unter [Verbindungen](/docs/de/admin/connections/).

Coding-Oberfläche (`read_file`, `write_file`, `edit_file`, `grep`, `glob`, `git_status`/`git_diff`, `run_command`), Search/Grounding (`needsPin`), Memory-Blöcke + `search_memory`/`save_memory`. E-Mail draft→approve→send, optionales Odoo, Connections-Inventar, Board/Conversation/Document/Knowledge/Research/Schedule/Channel/A2A-Delegate. **Studio** `hyperframes_*` / `videouse_*`: [Studio](/docs/de/studio/). Screen-Capture-Politur ist kein Tool: Recordly ist AGPL-Begleiter unter [Erweiterungen](/docs/de/admin/extensions/#recordly) — kein `recordly_*`. **Medien** (optional): `media_generate`, `media_wait`, `media_catalog`, `media_balance`, `media_history` — [Medien](/docs/de/ai/media/). CLI-MCP-Parität für Grok/Kimi: [MCP](/docs/de/ai/mcp/).

<h3 id="browser">Browser</h3>

Headless Playwright (`browser_*`): SSRF; `browser_snapshot`-Index + `snapshotId` (ungültig nach Navigation); Tabs, back, wait, hover, select, Dialog, Upload, `evaluate` nur in der Seite, Download → Dokumente, `storageState`. `browser_replay` / `browser_action_cache` speichern einen Locator (JSON im Projekt- oder Vault-Ordner, kein LLM, keine Füllwerte). `browser_totp` (gelb) liest den Seed aus Geheimnisse/Schlüsselbund und gibt nur den Code für `browser_fill`. Profil `data/browser/profile`, nie das tägliche Chrome-Profil (Chrome 136+). Optionales [Browser Use](/docs/de/automation/browser-use/): empfohlen `agent_browser_*`, Legacy `browser_use_*`. Der Katalog zeigt Risiko **green / yellow / red**.

## Verwandt

- [Agenten — Tools](/docs/de/agents/configure/)
- [Security-Gate](/docs/de/admin/security-privacy/)
- [Verbindungen](/docs/de/admin/connections/)
- [Skills](/docs/de/automation/skills/)
- [MCP-Server](/docs/de/ai/mcp/)
- [Medien](/docs/de/ai/media/)
- [Studio](/docs/de/studio/)
- [Erweiterungen](/docs/de/admin/extensions/#recordly)
