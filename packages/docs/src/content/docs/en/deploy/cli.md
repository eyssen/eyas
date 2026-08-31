---
title: CLI reference
description: eyas serve/start/stop/doctor/config/module — operate whichever install path you chose.
---

**What this is for.** The `eyas` binary is how you start, stop, diagnose, and toggle modules on a native or container install. It is not a second product — same process, same `EYAS_HOME`. After `bin/` is on `PATH` (native installer) or inside the image (`docker compose exec`), these commands apply.

## When to use it

- Start in the foreground (`serve`) to watch logs, or background (`start` + pidfile).
- `doctor` before filing a bug — missing CLI, port in use, docs/web dist.
- Toggle a module without editing YAML by hand.
- Check GitHub for a newer version (`eyas update` family, same service as Settings → Updates).

## Typical workflow

1. Install via [native](/docs/en/deploy/native/) or [Docker](/docs/en/deploy/docker/).
2. `eyas doctor` — fix what it flags.
3. `eyas serve` (foreground) or `eyas start` (background). `eyas status` to confirm.
4. `eyas config validate` after editing YAML. `eyas config reload` where supported.
5. `eyas stop` / `eyas restart` as needed.

## Features

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
| `eyas update check` | Check GitHub (`eyssen/eyas`) for a newer version; requires Backup ready to apply |
| `eyas migrate …` | One-shot v1→v2 prompt/workspace migration (`run` / `rollback` / `drop-cols`) — not daily ops |

### Environment

`EYAS_PORT`, `EYAS_HOST`, `EYAS_HOME`, `EYAS_INSTALL_ROOT`, `EYAS_SKIP_WEB_BUILD`, `EYAS_SKIP_DOCS_BUILD`, `EYAS_FORCE_WEB_BUILD`, `EYAS_FORCE_DOCS_BUILD`.

Default port is **3100**. `EYAS_SKIP_DOCS_BUILD=1` is why `/docs` 404s — see [FAQ](/docs/en/reference/faq/).

## Related

- [Configuration](/docs/en/deploy/configuration/)
- [Native](/docs/en/deploy/native/)
- [FAQ](/docs/en/reference/faq/)
- [Settings — Updates](/docs/en/admin/settings/)
