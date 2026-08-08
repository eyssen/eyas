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
`EYAS_ODOO_SOURCE_PATHS` — lokale Odoo-Checkouts für `odoo_search_*`.  
Tool-Hooks Pre/Post auf jedem ToolExecutor-Pfad — [Tools](/docs/de/automation/tools/).
