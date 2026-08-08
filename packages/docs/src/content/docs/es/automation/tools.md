---
title: Herramientas
description: Tools integrados y de extensión.
---

**Ruta:** `/tools`. Asignación en **Configuration → Tools** y security gate. MCP: [servidores MCP](/docs/es/ai/mcp/). Credenciales de sistemas externos: [Conexiones](/docs/es/admin/connections/).

## Grupos (destacados)

| Grupo | Tools / comportamiento |
|-------|------------------------|
| Búsqueda | `search_indexed` (híbrido + citas), `list_search_sources` |
| Memory blocks | `memory_block_read` / `write` (company/agent/team/run) |
| Navegador | Protección SSRF; `browser_snapshot` |
| Email | draft → approve → send (solo si approved) |
| Odoo | search/get task, message_post, write_task (escritura gated) |
| Connections | list, catalog, test, propose |
| CLI MCP | Grok/Kimi CLI comparten la misma superficie de tools |

## Relacionado

- [Configurar agentes](/docs/es/agents/configure/)
- [Seguridad](/docs/es/admin/security-privacy/)
- [Conexiones](/docs/es/admin/connections/)
