# EYAS — Personal AI Agent Platform

Self-hosted, modular AI assistant with persistent memory, agent orchestration, and multi-channel communication.

**Your AI. Your Rules. Your Machine.**

## Quick Start

### Native (Bun)

```bash
git clone https://github.com/eyssen/eyas.git
cd eyas
bun install
./bin/eyas start          # background (auto-builds frontend if missing)
# or: ./bin/eyas serve    # foreground (Ctrl+C to stop)
```

Open **http://localhost:3100** — the setup wizard guides you through admin account, AI provider, and agent naming.

> `eyas start` / `eyas serve` run `bun run build:web` automatically when `src/web/dist` is **missing or older than the source** (so you never get a stale UI after code changes). Skip with `EYAS_SKIP_WEB_BUILD=1`; force with `EYAS_FORCE_WEB_BUILD=1`.

```bash
./bin/eyas status         # health + PID
./bin/eyas stop           # stop background server
./bin/eyas restart        # stop then start
./bin/eyas doctor         # local diagnostics
```

### Docker

```bash
git clone https://github.com/eyssen/eyas.git
cd eyas
docker compose up -d
```

Open **http://localhost:3100**.

```bash
docker compose logs -f    # logs
docker compose down       # stop
```

With local Ollama (GPU profile):

```bash
docker compose --profile gpu up -d
```

### One-line installer

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.sh | bash
```

Non-interactive (defaults, no prompts):

```bash
curl -fsSL https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.sh | bash -s -- --yes
```

Pin a release (e.g. to restore a backup created on that version):

```bash
curl -fsSL https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.sh | bash -s -- --version 0.8.9-beta
# or:  EYAS_VERSION=0.8.9-beta curl … | bash
```

**Windows (PowerShell):**

```powershell
powershell -c "irm https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.ps1 | iex"
```

Non-interactive / pinned version:

```powershell
powershell -c "& ([scriptblock]::Create((irm https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.ps1))) -Yes -Version 0.8.9-beta"
```

Default ref is **`main`**. Optional: `--version` / `-Version` (tag for backup restore), `--dir` / `-Dir`, `--method` / `-Method`, `--port` / `-Port`, `--yes` / `-Yes`.

---

## Backup & empty-system restore

Backups are a **full restore package** for an empty machine (plus a code install of the matching version).

### What is included

| Included | Purpose |
|----------|---------|
| `data/` | SQLite (+ WAL), **master.key**, agents/, vault/, documents/, voice/, … |
| `config/` | local.yaml, mcp, model-routing, personality, skills |
| `.env` | API keys / port / setup env (if present) |
| `docker-compose.override.yml` | Host port overrides (if present) |
| `version.json` | EYAS version the backup was taken on |

**Excluded:** `data/backups/` (nested archives), `data/tmp/`, `eyas.pid`, `eyas.log`.

Each archive also gets a sidecar `backup-….tar.gz.json` with `eyasVersion` and restore steps. The **Backup** UI lists the EYAS version per backup.

### Create a backup

- UI: **Backup** → Create Backup  
- API: `POST /api/v1/backup/create`  
- Self-update always creates a **fresh** backup first (`eyas update apply`).

### Offsite destinations (optional)

Every backup is always written under `data/backups/` first. You can also set a **primary** remote target so each create uploads the archive there:

| Type | Typical use | Secrets |
|------|-------------|---------|
| **s3** | AWS S3, **Backblaze B2**, R2, MinIO | `accessKeyId`, `secretAccessKey` |
| **ftp** | FTP / FTPS | `username`, `password` |
| **dropbox** | Dropbox API | `accessToken` |
| **ssh** | SFTP | `username` + `password` or `privateKey` |

Configure under **Backup → Offsite destinations** (or `data/backups/destinations.json`). Paste keys in the form (they are vaulted) or point at environment variable names. Example for B2 with env names:

```bash
export BACKUP_S3_ACCESS_KEY=...
export BACKUP_S3_SECRET_KEY=...
```

Then set destination type `s3`, endpoint like `https://s3.us-west-000.backblazeb2.com`, bucket, region, and either paste the keys or set secretRefs to those env names. Mark it **Use for uploads**.

### Restore onto an empty system

1. **Note the version** from the Backup table (or from `version.json` / the sidecar JSON), e.g. `0.8.9-beta`.
2. **Install that code version** (not necessarily `main`):

```bash
# macOS / Linux — pin to the backup's version
curl -fsSL https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.sh | bash -s -- --version 0.8.9-beta --yes
```

```powershell
# Windows
powershell -c "& ([scriptblock]::Create((irm https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.ps1))) -Yes -Version 0.8.9-beta"
```

Or manually:

```bash
git clone --depth 1 --branch v0.8.9-beta https://github.com/eyssen/eyas.git ~/eyas
cd ~/eyas && bun install && bun run build:web
```

(`0.8.9-beta` is normalized to tag `v0.8.9-beta`.)

3. **Stop** EYAS if it is already running: `./bin/eyas stop`
4. **Extract** the archive into the **install root** (same directory as `bin/`, `config/`, `data/`):

```bash
cd ~/eyas   # install root
tar -xzf /path/to/backup-….tar.gz
```

5. **Permissions** for secrets:

```bash
chmod 600 data/master.key
[ -f .env ] && chmod 600 .env
```

6. **Start**:

```bash
./bin/eyas start
# open http://localhost:3100 (or the port from config / .env)
```

You should be able to log in with the previous admin user; providers/secrets decrypt with the restored `master.key`.

> Prefer installing the **same** (or newer, with migrations) version as `eyasVersion` on the backup. Mixing a much older code with a newer DB can break.

---

## Start / stop cheat sheet

| Goal | Native | Docker |
|------|--------|--------|
| Start (background) | `./bin/eyas start` | `docker compose up -d` |
| Start (foreground) | `./bin/eyas serve` | `docker compose up` |
| Stop | `./bin/eyas stop` | `docker compose down` |
| Restart | `./bin/eyas restart` | `docker compose up -d --force-recreate` |
| Status | `./bin/eyas status` | `docker compose ps` |
| Logs | `data/eyas.log` | `docker compose logs -f` |

Production mode serves the **built UI and API on the same port** (default **3100**).

> **Why not 3000?** Grafana, Create-React-App, Next.js and many other tools bind `:3000`. EYAS defaults to **3100** so a typical laptop does not clash. (`eyas status` detects a non-EYAS service on the configured port and says so.)

---

## Ports

| What | Default | Override |
|------|---------|----------|
| HTTP (API + UI) | **3100** | `config/default.yaml` → `server.port`, or `EYAS_PORT`, or `eyas serve --port` |
| Vite dev frontend | 5173 | only in `bun run dev:web` (proxies API to backend port from config) |
| Ollama (optional) | 11434 | `OLLAMA_PORT` (Docker) |

**Priority (highest first):** CLI `--port` / `--host` → `EYAS_PORT` / `EYAS_HOST` → `config/local.yaml` → `config/default.yaml`.

Canonical default is **3100** everywhere (app config, Docker `EXPOSE`, Compose mapping, CLI).

Container-internal port is **3100**. Change only the **host** port when mapping:

```bash
EYAS_PORT=3200 docker compose up -d   # host :3200 → container :3100
```

---

## Multiple instances on one machine

Each instance needs its own **port** and **data directory** (SQLite, `master.key`, vault). Do not share `data/` between prod and test.

### Native — `EYAS_HOME`

Same install, separate state:

```bash
# Production (default port 3100)
export EYAS_HOME="$HOME/.eyas/prod"
mkdir -p "$EYAS_HOME/config" "$EYAS_HOME/data"
./bin/eyas start

# Dev / experimental
export EYAS_HOME="$HOME/.eyas/dev"
export EYAS_PORT=3200
./bin/eyas start

# Stop the instance that matches the current EYAS_HOME
EYAS_HOME="$HOME/.eyas/dev" ./bin/eyas stop
EYAS_HOME="$HOME/.eyas/prod" ./bin/eyas stop
```

Layout per home:

```
$EYAS_HOME/
  config/
    local.yaml      # optional port / log / i18n overrides
  data/
    sqlite/eyas.db
    master.key
    eyas.pid
    eyas.log
    vault/ …
```

### Native — separate checkouts

```bash
cd ~/eyas-prod && ./bin/eyas start --port 3100
cd ~/eyas-dev  && ./bin/eyas start --port 3200
```

Each checkout keeps its own `./data`.

### Docker — project name + host port

```bash
# Prod (host :3100)
docker compose -p eyas-prod up -d

# Dev (host :3200)
EYAS_PORT=3200 docker compose -p eyas-dev up -d

docker compose -p eyas-prod logs -f
docker compose -p eyas-prod down
docker compose -p eyas-dev  down
```

Compose does **not** pin `container_name`, so multiple projects can run side by side. Volumes are project-scoped (`eyas-prod_eyas-data`, …).

### Useful environment variables

| Variable | Purpose |
|----------|---------|
| `EYAS_HOME` | Instance home (data, pid, log, local config) |
| `EYAS_PORT` | Listen port (host process) / Compose host mapping |
| `EYAS_HOST` | Bind address (default `0.0.0.0`) |
| `EYAS_CONFIG` | Explicit primary config file |
| `EYAS_DATA_DIR` | Override data directory |
| `EYAS_DB_PATH` | Override SQLite path |
| `EYAS_INSTALL_ROOT` | Install tree (frontend assets); set automatically when using `EYAS_HOME` |
| `EYAS_MASTER_KEY` | 64-char hex master key (Docker/K8s; otherwise `data/master.key`) |
| `EYAS_SECRET_PROVIDER` | e.g. `env` in containers |

---

## Configuration

1. **Shipped defaults:** `config/default.yaml`
2. **Local overlay (merged):** `config/local.yaml` (or `$EYAS_HOME/config/local.yaml`)
3. **Env / CLI** as above

Example `config/local.yaml`:

```yaml
server:
  port: 3100
log:
  level: debug
```

Validate:

```bash
./bin/eyas config validate
```

---

## Product documentation

Product docs (en / hu / de / es) live in **`packages/docs/`** (Astro Starlight).
The main EYAS server serves them at **`/docs/`** (auto-built on start when missing).

```bash
./bin/eyas serve                 # then open http://localhost:3100/docs/
bun run docs:dev                 # optional live-reload authoring only
bun run docs:build               # → packages/docs/dist/ (also nginx-ready)
```

Standalone root deploy: `DOCS_BASE=/ bun run docs:build`. See `packages/docs/README.md`. Architecture specs remain under `docs/`.

## Development Mode

Two terminals (backend reads port from `config/default.yaml`; Vite proxies `/api` and `/ws` there):

```bash
bun run dev          # Backend (default :3100, hot reload)
bun run dev:web      # Frontend (Vite :5173, HMR)
```

---

## Requirements

- **Bun 1.x** (primary) or Node.js 22+ (fallback)
- At least one AI provider API key (Anthropic, OpenAI, Google, or local Ollama)

---

## Setup Wizard

On first run, EYAS walks you through:

1. Admin account creation  
2. AI provider configuration  
3. Primary agent naming  
4. Team agent selection  

---

## CLI

```bash
eyas start [--port N] [--host H]   # Background server + pidfile
eyas stop                          # Stop background server
eyas restart [--port N]            # Stop then start
eyas update check                  # Check GitHub (eyssen/eyas) for newer version
eyas update apply --yes            # Backup + git upgrade + rebuild + restart
eyas serve [--port N]              # Foreground server
eyas status                        # Query running server (uses config port)
eyas doctor                        # System diagnostics
eyas config validate               # Validate configuration
eyas module list                   # List modules
eyas version                       # Version info
```

---

## Kubernetes

Production Helm chart: `deploy/k8s/helm/eyas/` — see `deploy/k8s/README.md`.

Note: embedded SQLite → keep **replicaCount: 1** unless you move to external storage carefully.

---

## Optional: systemd (Linux)

```ini
# /etc/systemd/system/eyas.service
[Unit]
Description=EYAS Personal AI Agent
After=network.target

[Service]
Type=simple
User=eyas
WorkingDirectory=/opt/eyas
Environment=EYAS_HOME=/var/lib/eyas
Environment=EYAS_PORT=3100
Environment=EYAS_INSTALL_ROOT=/opt/eyas
ExecStart=/opt/eyas/bin/eyas serve
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now eyas
sudo systemctl stop eyas
```

---

## What's Inside

- **35+ modules** — agent framework, persistent memory, board/kanban, knowledge wiki, scheduler, search, documents, notifications, and more
- **Agent system** — agent templates + seed agents, named AI personas with skills, tool access, and delegation
- **200+ skills** across coding, DevOps, AI, security, data, research, communication, and more
- **MCP integration** — catalog + client/server, Hand Hub remote transport
- **5-tier memory** — working, episodic, semantic, procedural, archive — with vector search
- **Board & projects** — kanban, project types, conversation tracking
- **Multi-channel** — Web UI, Telegram, WebSocket, A2A protocol
- **2,880+ tests** across 339 test files

## Tech Stack

TypeScript · Bun · Hono · Drizzle ORM · SQLite · React 19 · shadcn/ui · Tailwind · TanStack Router · Zustand · Vitest

## License

[MIT](LICENSE) — Copyright (c) 2026 Krisztian Eyssen
