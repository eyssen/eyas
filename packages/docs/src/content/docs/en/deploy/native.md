---
title: Native install
description: Bun on the host — clone or installer script, then eyas start. Choose this path for a laptop or a simple VPS.
---

**What this is for.** Native install is one of three ways to run EYAS (native / Docker / Kubernetes). Pick **native** when you want Bun on the machine, host CLIs (`claude`, `grok`, `kimi`) on the same PATH, and the fewest moving parts. Default UI: **http://localhost:3100** — not 3000.

See also [Getting started](/docs/en/getting-started/).

## When to use it

- A developer laptop or a single VPS with Bun 1.x (or Node 22+).
- You want host CLI providers without wrapping them in a container.
- You are restoring a backup onto a matching `--version` install.

## Typical workflow

1. Install Bun 1.x (or Node 22+).
2. `git clone` + `bun install` **or** run `scripts/install.sh` (macOS/Linux) / `scripts/install.ps1` (Windows).
3. Add `bin/` to `PATH` so `eyas` works.
4. `./bin/eyas start` (background) or `./bin/eyas serve` (foreground logs).
5. Open **http://localhost:3100** and complete the [setup wizard](/docs/en/setup-wizard/).

## Features

### Methods

1. `git clone` + `bun install` + `./bin/eyas start`
2. `scripts/install.sh` (macOS/Linux)
3. `scripts/install.ps1` (Windows)

One-line:

```bash
curl -fsSL https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.sh | bash
```

Non-interactive: append `bash -s -- --yes`. Pin a release: `--version 0.8.16-beta`.

Pinned version restore: installer `--version x.y.z-beta` matching the backup version.

## Related

- [Docker](/docs/en/deploy/docker/)
- [Kubernetes](/docs/en/deploy/kubernetes/)
- [CLI](/docs/en/deploy/cli/)
- [Configuration](/docs/en/deploy/configuration/)
- [Getting started](/docs/en/getting-started/)
