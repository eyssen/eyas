---
title: Tools
description: Eingebaute und Extension-Tools für Agenten.
---

**Route:** `/tools`. Zuweisung unter Agent **Configuration → Tools** und Security Gate. MCP: [MCP-Server](/docs/de/ai/mcp/). Externe Credentials: [Verbindungen](/docs/de/admin/connections/).

## Gruppen (Auszug)

| Gruppe | Tools / Verhalten |
|--------|-------------------|
| Coding surface | `read_file`, `write_file`, `edit_file`, `grep`, `glob`, `git_status`, `git_diff`, `run_command` (modellunabhängig; Worktree-Jail) |
| Verify / Hooks | `agent.verifyCommands`; PreToolUse/PostToolUse am ToolExecutor |
| Suche | `search_indexed` (Hybrid + Zitationen), `list_search_sources` |
| Memory blocks | `memory_block_read` / `memory_block_write` (company/agent/team/run) |
| Browser | SSRF-Schutz; `browser_snapshot` (Accessibility-Tree) |
| E-Mail | `email_create_draft` → approve → `email_send_draft` (nur freigegeben) |
| Odoo (live) | `odoo_search_tasks`, `odoo_get_task`, `odoo_message_post`, `odoo_write_task` |
| Odoo (Quelle) | `odoo_search_model` / `field` / `xml_id` (`EYAS_ODOO_SOURCE_PATHS`) |
| Connections | `connections_list`, `catalog`, `test`, `propose` |
| CLI MCP | Grok/Kimi CLI erhalten denselben Tool-Surface über MCP-Bridge |

## Verwandt

- [Agent konfigurieren](/docs/de/agents/configure/)
- [Sicherheit](/docs/de/admin/security-privacy/)
- [Verbindungen](/docs/de/admin/connections/)
