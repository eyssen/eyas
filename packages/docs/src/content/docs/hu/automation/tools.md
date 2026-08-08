---
title: Toolok
description: Beépített és extension toolok.
---

**Útvonal:** `/tools`.

A toolok hívható képességek. Az ágenshez a **Configuration → Tools** mezőben (és jogosultság/security gate) rendelhetők. MCP: [MCP szerverek](/docs/hu/ai/mcp/). Külső rendszer hitelesítés: [Kapcsolatok](/docs/hu/admin/connections/).

---

## Beépített csoportok (kiemelés)

### Keresés és grounding

| Tool | Cél |
|------|-----|
| `search_indexed` | Hibrid FTS + vektor, **citáció** mezőkkel |
| `list_search_sources` | Indexelt források listája |

Lásd [Keresés](/docs/hu/daily/search/).

### Memória blokkok

| Tool | Cél |
|------|-----|
| `memory_block_read` / `memory_block_write` | Megosztott blokkok (company / agent / team / run) |

### Böngésző

SSRF védelem privát/metadata hostok ellen; `browser_snapshot` = accessibility-tree (token-hatékony).

### Email (draft → approve → send)

`email_create_draft` → `email_approve_draft` → `email_send_draft` (küldés csak approved státuszban).

### Odoo (opcionális modul)

`odoo_search_tasks`, `odoo_get_task`, `odoo_message_post`, `odoo_write_task` (írás gated). Hitelesítés: [Kapcsolatok](/docs/hu/admin/connections/) (Odoo típus).

### Connections

`connections_list`, `connections_catalog`, `connections_test`, `connections_propose`.

### CLI MCP parity

**Grok CLI** / **Kimi Code CLI** stdio MCP bridge-et kap — ugyanazok a toolok, mint in-process / Claude Code. Lásd [MCP](/docs/hu/ai/mcp/).

## Kapcsolódó

- [Ágens konfiguráció](/docs/hu/agents/configure/)
- [Biztonság](/docs/hu/admin/security-privacy/)
- [Kapcsolatok](/docs/hu/admin/connections/)
