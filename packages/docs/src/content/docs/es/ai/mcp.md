---
title: Servidores MCP
description: Model Context Protocol y paridad de tools en CLI.
---

**Ruta:** `/mcp-settings`. Nombre, transport/command/URL, auth, enable. Tools descubiertos asignables a agentes.

Un servidor MCP también puede inventariarse como [Conexión](/docs/es/admin/connections/) (tipo **MCP server**).

### CLI MCP (Grok / Kimi)

| Proveedor | Comportamiento |
|-----------|----------------|
| Claude Code | MCP in-process |
| Grok CLI / Kimi Code CLI | Stdio MCP + bridge loopback; ACP recibe `mcpServers` → mismo ToolExecutor |

## Relacionado

- [Herramientas](/docs/es/automation/tools/)
- [Conexiones](/docs/es/admin/connections/)
