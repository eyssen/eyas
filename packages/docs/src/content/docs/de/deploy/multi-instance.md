---
title: Mehrere Instanzen
description: EYAS_HOME, Ports, Isolation.
---

| Hebel | Zweck |
|-------|-------|
| `EYAS_HOME` | Getrennte data/pid/config |
| `EYAS_PORT` / `--port` | Ports ohne Kollision |
| Compose-Projektname | Mehrere Stacks |

**Niemals** zwei Live-Instanzen auf dieselbe SQLite-Datei.
