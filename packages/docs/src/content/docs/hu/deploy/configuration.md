---
title: Konfiguráció
description: YAML, local overlay, env.
---

default.yaml → local.yaml → `EYAS_*` → CLI. Példa: server.port 3100, database.path, autonomy.identitySelfUpdate.

## Agent verify és coding (0.8.6+)

```yaml
agent:
  criticEnabled: true
  verifyCommands:
    - name: bun-test
      command: bun
      args: [test]
  # verifyCwd: /abszolút/repo/út
```

| Kulcs / env | Jelentés |
|-------------|---------|
| `agent.verifyCommands` | Determinisztikus lint/test a run után (shell nélkül) |
| `agent.verifyCwd` | Working directory a verify parancsokhoz |
| `EYAS_ODOO_SOURCE_PATHS` | Helyi Odoo checkout-ok (`:` / `;`) — lightweight `odoo_search_*` + opcionális bootstrap |
| `EYAS_ODOO_SOURCES_JSON` | Ajánlott többverziós bootstrap: JSON `[{ "path", "label?", "version?", "edition?", "family?" }, …]` — idle Search Source-ok induláskor |

### Többverziós Odoo példa

```bash
export EYAS_ODOO_SOURCES_JSON='[
  {"path":"/path/to/odoo-18-community","label":"18c","version":"18","edition":"community","family":"odoo"},
  {"path":"/path/to/odoo-18-enterprise","label":"18e","version":"18","edition":"enterprise","family":"odoo"}
]'
```

Ezután **Search Sources → Reindex**, majd **Projects → Alapértelmezett kódforrások**. Conversation: jobb panel **Források** fül. Részletek: [Keresés](/docs/hu/daily/search/).

Tool hookok (Pre/Post) minden tool híváson — lásd [Toolok](/docs/hu/automation/tools/).
