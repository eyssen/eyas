---
title: Configuración
description: YAML, overlays, env.
---

`default.yaml` → `local.yaml` → `EYAS_*` → flags CLI. Ejemplos: `server.port` 3100, `database.path`, `autonomy.identitySelfUpdate`.

### Verify y coding (0.8.6+)

`agent.verifyCommands` / `verifyCwd` — checks deterministas tras el run.  
`EYAS_ODOO_SOURCE_PATHS` — raíces locales para `odoo_search_*` y bootstrap opcional.  
`EYAS_ODOO_SOURCES_JSON` — bootstrap multi-versión preferido: `[{ "path", "label?", "version?", "edition?", "family?" }, …]`.

```bash
export EYAS_ODOO_SOURCES_JSON='[
  {"path":"/path/to/odoo-18-community","label":"18c","version":"18","edition":"community","family":"odoo"}
]'
```

Luego reindexar en Search Sources, defaults en Proyectos, pestaña **Fuentes** en conversación — [Búsqueda](/docs/es/daily/search/).  
Hooks Pre/Post — [Herramientas](/docs/es/automation/tools/).
