---
title: Herramientas
description: Tools integrados y de extensión.
---

**Ruta:** `/tools`. Asignación en **Configuration → Tools** y security gate. MCP: [servidores MCP](/docs/es/ai/mcp/). Credenciales de sistemas externos: [Conexiones](/docs/es/admin/connections/).

## Grupos (destacados)

| Grupo | Tools / comportamiento |
|-------|------------------------|
| Coding surface | `read_file`, `write_file`, `edit_file`, `grep`, `glob`, `git_status`, `git_diff`, `run_command` (agnóstico al modelo; jail worktree) |
| Verify / Hooks | `agent.verifyCommands`; PreToolUse/PostToolUse en ToolExecutor |
| Búsqueda | `list_search_sources`, `get_search_context`, `set_search_context`, `search_indexed` (pin multi-versión; `needsPin` si hay conflicto) |
| Memory blocks | `memory_block_read` / `write` (company/agent/team/run) |
| Navegador | Protección SSRF; `browser_snapshot` |
| Email | draft → approve → send (solo si approved) |
| Odoo (live) | search/get task, message_post, write_task (escritura gated) |
| Odoo (código local) | `odoo_search_model` / `field` / `xml_id` — roots desde pin de conversación/proyecto, Search Sources o env; cita `odoo-src:label:…` |
| Connections | list, catalog, test, propose |
| CLI MCP | Grok/Kimi CLI comparten la misma superficie de tools |

## Relacionado

- [Configurar agentes](/docs/es/agents/configure/)
- [Seguridad](/docs/es/admin/security-privacy/)
- [Conexiones](/docs/es/admin/connections/)
