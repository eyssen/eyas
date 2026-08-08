---
title: Tools
description: Built-in and extension tools agents can call.
---

**Route:** `/tools`.

Tools are **invokable capabilities** (filesystem, shell, browser, HTTP, search, domain integrations, MCP-backed tools, …). Assignment to an agent is on the agent **Configuration** tab (`Tools` comma-separated list) and via permissions / security gate.

| Concept | Meaning |
|---------|---------|
| Tool name | Stable id used in agent config and logs |
| Description | What the tool does (shown in catalogue) |
| Permissions | CASL / gate may block a call at runtime |
| Sandbox | Some tools run in restricted environments |

Configure MCP-backed tools under [MCP servers](/docs/en/ai/mcp/). External system credentials under [Connections](/docs/en/admin/connections/).

---

## Built-in tool groups (highlights)

### Search & grounding

| Tool | Purpose |
|------|---------|
| `search_indexed` | Hybrid FTS + vector search with **citation** fields |
| `list_search_sources` | List configured index sources before inventing facts |

See [Search](/docs/en/daily/search/).

### Memory blocks

| Tool | Purpose |
|------|---------|
| `memory_block_read` / `memory_block_write` | Shared Letta-style blocks (company / agent / team / run) |

See [Memory](/docs/en/knowledge/memory/).

### Browser

| Tool | Purpose |
|------|---------|
| Browser session tools | Navigate and interact; **SSRF** blocks private/metadata hosts |
| `browser_snapshot` | Accessibility-tree snapshot (token-efficient) |

### Email (draft → approve → send)

| Tool | Purpose |
|------|---------|
| `email_create_draft` | Create local draft |
| `email_approve_draft` | Mark draft approved |
| `email_send_draft` | Send **only** if approved |

### Odoo (optional module)

| Tool | Purpose |
|------|---------|
| `odoo_search_tasks` | Search tickets/tasks (read-heavy) |
| `odoo_get_task` | Fetch one task |
| `odoo_message_post` | Post chatter message |
| `odoo_write_task` | Gated write |

Configure instance credentials via [Connections](/docs/en/admin/connections/) (Odoo type).

### Connections inventory

| Tool | Purpose |
|------|---------|
| `connections_list` / `connections_catalog` | Inventory + catalog |
| `connections_test` | Health check |
| `connections_propose` | Propose connection for human approval |

### CLI MCP parity

When agents run on **Grok CLI** or **Kimi Code CLI**, EYAS injects a stdio MCP bridge so those hosts share the same ToolExecutor tools as in-process / Claude Code sessions. See [MCP](/docs/en/ai/mcp/).

---

## Related

- [Agents — configure tools](/docs/en/agents/configure/)
- [Security gate](/docs/en/admin/security-privacy/)
- [Connections](/docs/en/admin/connections/)
