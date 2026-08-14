---
title: MCP szerverek
description: Model Context Protocol és CLI tool parity.
---

**Útvonal:** `/mcp-settings`. Szerver név, transport/command/URL, auth, enable. A felfedezett toolok az ágensekhez rendelhetők.

Egy MCP szerver [Kapcsolat](/docs/hu/admin/connections/) leltár sorként is regisztrálható (**MCP server** típus) — health tracking Odoo/GitHub mellett.

---

## CLI MCP tool parity (Grok / Kimi)

| Provider | Viselkedés |
|----------|------------|
| **Claude Code** | In-process MCP |
| **Grok CLI / Kimi Code CLI** | Stdio MCP + loopback bridge (`/api/v1/internal/cli-mcp/*`); ACP `session/new` megkapja a `mcpServers` listát → ugyanaz a ToolExecutor surface |

## Kapcsolódó

- [Toolok](/docs/hu/automation/tools/)
- [Kapcsolatok](/docs/hu/admin/connections/)
- [Providerek](/docs/hu/ai/providers/)
