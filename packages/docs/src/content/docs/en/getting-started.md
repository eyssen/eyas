---
title: Getting started
description: Install EYAS, start the server, complete the setup wizard, and open the UI.
---

## What you will do

1. Install EYAS (native or Docker)
2. Start the server
3. Complete the [setup wizard](/docs/en/setup-wizard/)
4. Open the web UI and begin work

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Bun 1.x** (recommended) or **Node.js 22+** | Primary runtime is Bun |
| Disk space | SQLite DB, vault, agent workspaces under `data/` |
| Optional: Docker / Compose | Container deploy |
| Optional: host CLIs | `claude`, `grok`, or `kimi` if you want keyless local providers |

## Native install

```bash
git clone https://github.com/eyssen/eyas.git
cd eyas
bun install
./bin/eyas start
```

Open **http://localhost:3100** (default port from `config/default.yaml` — **3100**, not 3000).

Foreground (logs in the terminal):

```bash
./bin/eyas serve
```

### One-line installer

```bash
curl -fsSL https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.sh | bash
```

Non-interactive: append `bash -s -- --yes`. Pin a release: `--version 0.8.12-beta`.

Windows: `scripts/install.ps1`.

## Docker

```bash
git clone https://github.com/eyssen/eyas.git
cd eyas
docker compose up -d
```

Open **http://localhost:3100**. Optional GPU + Ollama:

```bash
docker compose --profile gpu up -d
```

## Lifecycle commands

| Command | What it does |
|---------|----------------|
| `eyas serve` | HTTP server in the foreground |
| `eyas start` | Background server (pidfile + log file) |
| `eyas stop` | Stop background process |
| `eyas restart` | Stop then start |
| `eyas status` | Health + PID |
| `eyas doctor` | Local environment diagnostics |
| `eyas version` | Version string |

On start, EYAS auto-builds the **frontend** and **product docs** if missing or stale (`bun run build:web`, `bun run docs:build`), unless you set `EYAS_SKIP_WEB_BUILD=1` / `EYAS_SKIP_DOCS_BUILD=1`.

## First login path

| Step | Result |
|------|--------|
| Browser → `/setup` (automatic if setup incomplete) | [Setup wizard](/docs/en/setup-wizard/) |
| After setup | Login with the **root owner** account you created |
| Home | [Dashboard](/docs/en/daily/dashboard/) |
| Product docs | Always at **`/docs/`** on the same host/port |

## Where data lives

Under the instance home (`EYAS_HOME` or the directory you started from):

| Path | Contents |
|------|----------|
| `data/sqlite/` | Main SQLite database (WAL mode) |
| `data/vault/` | Semantic / procedural markdown vault |
| `data/agents/<id>/` | Per-agent workspace files (IDENTITY, SOUL, …) |
| `data/backups/` | Backup archives |
| `config/` | YAML defaults + local overlays |

## Next

- [Setup wizard — every step and field](/docs/en/setup-wizard/)
- [Core concepts](/docs/en/concepts/)
- [CLI reference](/docs/en/deploy/cli/)
