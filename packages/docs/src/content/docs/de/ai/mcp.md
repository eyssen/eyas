---
title: MCP-Server
description: Model Context Protocol und CLI-Tool-Parität.
---

**Route:** `/mcp-settings`. Name, Transport/Command/URL, Auth, Enable. Entdeckte Tools den Agenten zuweisen.

MCP-Server können auch als [Verbindung](/docs/de/admin/connections/) (Typ **MCP server**) inventarisiert werden.

### CLI MCP (Grok / Kimi)

| Provider | Verhalten |
|----------|-----------|
| Claude Code | In-process MCP |
| Grok CLI / Kimi Code CLI | Stdio-MCP + Loopback-Bridge; ACP erhält `mcpServers` → gleicher ToolExecutor |

## Verwandt

- [Tools](/docs/de/automation/tools/)
- [Verbindungen](/docs/de/admin/connections/)
