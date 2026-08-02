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
