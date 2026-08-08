---
name: odoo-dev-chain
description: >
  Odoo development skill chain for EYAS agents. Use when implementing or
  reviewing Odoo modules (models, views, security, tests). Ground every claim
  in local source via odoo_search_* tools or search_indexed — never invent
  field names, XML IDs, or method behavior.
category: coding/odoo
type: knowledge
triggers:
  - odoo
  - _inherit
  - project.task
  - res.partner
  - ir.model
---

# Odoo development chain (EYAS)

## Always ground first

Before writing or changing Odoo code:

1. **Model exists?** → `odoo_search_model` with the model name fragment  
   (requires `EYAS_ODOO_SOURCE_PATHS` pointing at local checkouts).
2. **Field name/type?** → `odoo_search_field` (optional `model` filter).
3. **XML ID?** → `odoo_search_xml_id`.
4. **Behavior of a core method?** → `read_file` / `grep` on the checkout path  
   returned by the search — do **not** rely on training memory.

Cite hits as `[source:odoo-src:path:line]`.

## Implementation order

1. Context gather (tools above + `search_indexed` if a code source is registered).
2. Implement with `_inherit` only — never patch core in place.
3. Security: access rights / record rules when new models or privileged fields appear.
4. Tests: happy path + negative (e.g. AccessError) when business logic changes.
5. `.po` updates when user-facing strings change (project convention).

## Coding surface tools

Prefer first-class tools over shell:

| Task | Tool |
|------|------|
| Read source | `read_file` |
| Targeted edit | `edit_file` |
| Create file | `write_file` |
| Find symbol | `grep` / `glob` |
| Diff for review | `git_diff` / `git_status` |
| Run tests | `run_command` (approval-gated) |

## Live Odoo instance (tickets)

- `odoo_search_tasks` / `odoo_get_task` — read tickets  
- `odoo_message_post` / `odoo_write_task` — gated writes  

These talk to the **live** DB via JSON-RPC. Source tools talk to **local files**.

## Hard rules

- No Enterprise code copying into Community modules.
- No fabricated XML IDs or field names.
- Ask before destructive writes on production-like Odoo instances.
