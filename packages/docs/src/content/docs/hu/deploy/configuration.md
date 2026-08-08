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
| `EYAS_ODOO_SOURCE_PATHS` | Helyi Odoo checkout-ok (`:`-elválasztva) az `odoo_search_*` toolokhoz |

Tool hookok (Pre/Post) minden tool híváson — lásd [Toolok](/docs/hu/automation/tools/).
