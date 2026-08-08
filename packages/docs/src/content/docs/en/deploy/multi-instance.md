---
title: Multiple instances
description: EYAS_HOME, ports, isolation.
---

| Lever | Purpose |
|-------|---------|
| `EYAS_HOME` | Separate data, pid, local config |
| `EYAS_PORT` / `--port` | Non-colliding listen port |
| Compose project name | Multiple stacks on one Docker host |

**Never** point two live instances at the same SQLite file.
