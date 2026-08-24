---
title: Konfiguration
description: YAML, Overlays, Env.
---

| Datei | Rolle |
|-------|-------|
| `config/default.yaml` | Defaults |
| `local.yaml` | Overlay |
| `.env` | Optionale Secrets (nie committen) |

Reihenfolge: CLI → `EYAS_*` → local YAML → default.  
Beispiele: `server.port` 3100, `database.path`, `autonomy.identitySelfUpdate`.

### Agent verify & Coding (0.8.6+)

`agent.verifyCommands` / `verifyCwd` — deterministische Checks nach dem Run.  
`EYAS_ODOO_SOURCE_PATHS` — lokale Roots für `odoo_search_*` und optionalen Bootstrap.  
`EYAS_ODOO_SOURCES_JSON` — bevorzugter Multi-Version-Bootstrap: `[{ "path", "label?", "version?", "edition?", "family?" }, …]`.

```bash
export EYAS_ODOO_SOURCES_JSON='[
  {"path":"/path/to/odoo-18-community","label":"18c","version":"18","edition":"community","family":"odoo"}
]'
```

Danach Search Sources reindexen, Projekt-Standardquellen setzen, im Gespräch Reiter **Quellen**. Siehe [Suche](/docs/de/daily/search/).  
Tool-Hooks Pre/Post — [Tools](/docs/de/automation/tools/).
