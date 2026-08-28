---
title: Toolok
description: Beépített és extension toolok.
---

**Útvonal:** `/tools`.

A toolok hívható képességek. Az ágenshez a **Configuration → Tools** mezőben (és jogosultság/security gate) rendelhetők. MCP: [MCP szerverek](/docs/hu/ai/mcp/). Külső rendszer hitelesítés: [Kapcsolatok](/docs/hu/admin/connections/).

---

## Beépített csoportok (kiemelés)

### Coding surface (model-független)

| Tool | Cél |
|------|-----|
| `read_file` / `write_file` / `edit_file` | Fájl olvasás, írás, célzott csere |
| `grep` / `glob` | Keresés a workspace-ben |
| `git_status` / `git_diff` | Review (csak olvasható) |
| `run_command` | Program futtatás shell nélkül (jóváhagyás) |

Útvonalak a workspace/worktree-re korlátozva. Verify: `agent.verifyCommands` a configban. Hookok: PreToolUse / PostToolUse minden tool hívásra.

### Keresés és grounding

| Tool | Cél |
|------|-----|
| `list_search_sources` | Források (label, version, family, status) |
| `get_search_context` / `set_search_context` | Conversation pin olvasás / írás |
| `search_indexed` | Hibrid keresés + citáció; tiszteletben tartja a pint; opcionális filterek |

Több ready **odoo-family** source + nincs pin → **`needsPin`**. Lásd [Keresés](/docs/hu/daily/search/).

### Memória blokkok

| Tool | Cél |
|------|-----|
| `memory_block_read` / `memory_block_write` | Megosztott blokkok (company / agent / team / run) |

### Böngésző

SSRF védelem privát/metadata hostok ellen; `browser_snapshot` = accessibility-tree (token-hatékony).

### Email (draft → approve → send)

`email_create_draft` → `email_approve_draft` → `email_send_draft` (küldés csak approved státuszban).

### Odoo (opcionális modul)

Élő instance: `odoo_search_tasks`, `odoo_get_task`, `odoo_message_post`, `odoo_write_task` (írás gated).  
Helyi forrás: `odoo_search_model` / `field` / `xml_id` — rootok a **conversation/project pin**ből, Search Sources (`family: odoo`), vagy `EYAS_ODOO_SOURCES_JSON` / `EYAS_ODOO_SOURCE_PATHS`. Cite: `[source:odoo-src:label:file:line]`.  
Hitelesítés: [Kapcsolatok](/docs/hu/admin/connections/) (Odoo típus). UI: [Keresés](/docs/hu/daily/search/), [Projektek](/docs/hu/daily/projects/), conversation **Források** fül.

### Connections

`connections_list`, `connections_catalog`, `connections_test`, `connections_propose`.

### CLI MCP parity

**Grok CLI** / **Kimi Code CLI** stdio MCP bridge-et kap — ugyanazok a toolok, mint in-process / Claude Code. Lásd [MCP](/docs/hu/ai/mcp/).

## Kapcsolódó

- [Ágens konfiguráció](/docs/hu/agents/configure/)
- [Biztonság](/docs/hu/admin/security-privacy/)
- [Kapcsolatok](/docs/hu/admin/connections/)
