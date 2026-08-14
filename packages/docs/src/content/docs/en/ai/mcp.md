---
title: MCP servers
description: Model Context Protocol connections and CLI tool parity.
---

**Route:** `/mcp-settings`.

Add MCP servers so agents can call external toolboxes.

| Typical field | Meaning |
|---------------|---------|
| Server name | Display id |
| Transport / command / URL | How to start or reach the server |
| Auth | Tokens/headers if required |
| Enable | Expose tools to agents |
| Catalogue | Discovered tools |

Tools then appear for assignment under agent configuration / tools catalogue.

You can also register an MCP server as a [Connection](/docs/en/admin/connections/) inventory row (type **MCP server**) for health tracking next to Odoo/GitHub/etc.

---

## CLI MCP tool parity (Grok / Kimi)

API and in-process providers already share EYAS tools. For **host CLI** providers:

| Provider | Behaviour |
|----------|-----------|
| **Claude Code** | In-process MCP (existing) |
| **Grok CLI / Kimi Code CLI** | Stdio MCP server + loopback bridge (`/api/v1/internal/cli-mcp/*`) with short-lived secrets; ACP `session/new` receives `mcpServers` so the CLI host can call the same ToolExecutor tools |

Result: coding CLIs and the web agent path see a **consistent tool surface** instead of inventing parallel integrations.

---

## Related

- [Tools](/docs/en/automation/tools/)
- [Agents configure](/docs/en/agents/configure/)
- [Connections](/docs/en/admin/connections/)
- [Providers](/docs/en/ai/providers/)
