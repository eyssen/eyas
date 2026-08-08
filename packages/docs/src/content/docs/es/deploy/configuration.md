---
title: Configuración
description: YAML, overlays, env.
---

`default.yaml` → `local.yaml` → `EYAS_*` → flags CLI. Ejemplos: `server.port` 3100, `database.path`, `autonomy.identitySelfUpdate`.

### Verify y coding (0.8.6+)

`agent.verifyCommands` / `verifyCwd` — checks deterministas tras el run.  
`EYAS_ODOO_SOURCE_PATHS` — checkouts locales de Odoo para `odoo_search_*`.  
Hooks Pre/Post en cada tool — [Herramientas](/docs/es/automation/tools/).
