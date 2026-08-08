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

### Coding surface (model-agnostic)

First-class filesystem tools so **every** model (Grok, Claude API, Kimi, local, …) can edit code without relying on Claude Code SDK builtins:

| Tool | Purpose | Risk |
|------|---------|------|
| `read_file` | Read text file (line offset/limit) | green |
| `write_file` | Create/overwrite file | yellow |
| `edit_file` | Exact string replace (targeted edit) | yellow |
| `grep` | Content search under workspace | green |
| `glob` | Find files by pattern | green |
| `git_status` / `git_diff` | Read-only review helpers | green |
| `run_command` | Shell-free program execution (approval) | red |

Paths are jailed to the workspace or agent **worktree**. Sensitive paths (`.env`, `master.key`, `.ssh`, …) are denied. Prefer `edit_file` over full-file rewrites.

**Verify before done:** configure `agent.verifyCommands` in YAML (e.g. `bun test`) to run deterministic checks after a run; failures re-open the agent with the error summary.

**Hooks:** every tool call passes PreToolUse / PostToolUse on the ToolExecutor (universal, not Claude-only).

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

**Live instance** (JSON-RPC):

| Tool | Purpose |
|------|---------|
| `odoo_search_tasks` | Search tickets/tasks (read-heavy) |
| `odoo_get_task` | Fetch one task |
| `odoo_message_post` | Post chatter message |
| `odoo_write_task` | Gated write |

**Local source index** (coding chain — set `EYAS_ODOO_SOURCE_PATHS` to checkout roots):

| Tool | Purpose |
|------|---------|
| `odoo_search_model` | Find `_name` / `_inherit` in local Python |
| `odoo_search_field` | Find `fields.*` assignments |
| `odoo_search_xml_id` | Find XML record ids |

Skill: `coding/odoo/odoo-dev-chain`. Configure live credentials via [Connections](/docs/en/admin/connections/) (Odoo type).

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
