---
title: MCP servers
description: Model Context Protocol connections for external tools/data.
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

## Related

- [Tools](/docs/en/automation/tools/)
- [Agents configure](/docs/en/agents/configure/)
