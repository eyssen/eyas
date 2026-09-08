---
title: MCP-Server
description: Model Context Protocol — aktive Server, Katalog-Install, CLI-Tool-Parität.
---

**Wozu das da ist.** MCP hängt *externe* Toolboxes an. Entdeckte Tools sind wie Builtins zuweisbar. Kein Chat-[Kanal](/docs/de/communication/channels/), keine [Verbindung](/docs/de/admin/connections/) — obwohl du einen MCP-Server auch als Connection führen kannst.

**Route:** `/mcp-settings`. Tabs: **Aktiv** · **Katalog**. Sidebar: **MCP-Server**.

## Wann du es brauchst

- Tools, die EYAS nicht mitliefert.
- One-Click-Katalog (API-Key) statt Command tippen.
- Grok/Kimi-CLI soll dieselbe ToolExecutor-Fläche sehen.
- Server disconnected — **Test**.

## Typischer Ablauf

1. **MCP-Server** (`/mcp-settings`).
2. **Katalog**: Ready / One-Click / Manual.
3. **Installieren** oder **MCP-Server hinzufügen** (Name, Transport stdio/HTTP/SSE, Command oder URL).
4. **Aktiv**: connected, **Test**, entdeckte Tools/Resources/Prompts.
5. Ids auf dem Agenten-Tab **Konfiguration**.

Lizenz-Badge; Copyleft/proprietary laufen als **separater Prozess** — EYAS bleibt MIT. CLI-Parität: Claude Code in-process MCP; Grok/Kimi stdio-MCP + Loopback `/api/v1/internal/cli-mcp/*`.

**Authentifizierung:** keine / Bearer (API-Schlüssel) / OAuth (Browser). Transport **SSE** ist Streamable HTTP — kein `/sse`-Suffix; den Session-Header übernimmt EYAS.

Magnific, Higgsfield und fal verbindest du unter [Medien](/docs/de/ai/media/); der Agent nutzt fünf `media_*`-Tools statt der rohen Vendor-MCP-Kataloge.

**Chrome DevTools MCP** (Google, Apache-2.0) ist eine **DevTools**-Katalogzeile: `npx -y chrome-devtools-mcp@latest --isolated`, Telemetrie aus, `--categoryExperimentalWebmcp=true`. Nur Coding/Debug (Konsole, Netzwerk, Lighthouse, WebMCP) — **kein** Formularfüllen. Tools: `mcp_chrome-devtools_*`. WebMCP-Tools nur, wenn der Sidecar sie anbietet. `--autoConnect` und das tägliche Chrome-Profil sind verboten. Siehe [Browser Use](/docs/de/automation/browser-use/#chrome-devtools-mcp).

## Verwandt

- [Werkzeuge](/docs/de/automation/tools/)
- [Medien](/docs/de/ai/media/)
- [Agenten konfigurieren](/docs/de/agents/configure/)
- [Verbindungen](/docs/de/admin/connections/)
- [Anbieter](/docs/de/ai/providers/)
