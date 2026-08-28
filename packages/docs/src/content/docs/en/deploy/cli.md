---
title: CLI reference
description: serve, start, stop, doctor, config, module.
---

| Command | Description |
|---------|-------------|
| `eyas serve` | Foreground HTTP server |
| `eyas start` | Background (pidfile + log) |
| `eyas stop` | Stop background |
| `eyas restart` | Restart |
| `eyas status` | Health + PID |
| `eyas doctor` | Diagnostics |
| `eyas version` | Version |
| `eyas config validate` | Validate YAML |
| `eyas config reload` | Hot-reload where supported |
| `eyas module list` | List modules |
| `eyas module enable/disable <id>` | Toggle module |

### Environment

`EYAS_PORT`, `EYAS_HOST`, `EYAS_HOME`, `EYAS_INSTALL_ROOT`, `EYAS_SKIP_WEB_BUILD`, `EYAS_SKIP_DOCS_BUILD`, `EYAS_FORCE_WEB_BUILD`, `EYAS_FORCE_DOCS_BUILD`.
