---
title: Docker
description: Compose one container (plus optional GPU Ollama). Port 3100. Persist data/.
---

**What this is for.** Docker Compose is the second install path: one `eyas` service, a `data/` volume, optional **gpu** profile for Ollama. Use it when you want a boxed runtime on a host that already runs Docker, without installing Bun on the host. The image includes backend, frontend dist, and product docs at `/docs/`. Listen port inside the container is **3100**.

## When to use it

- A server already has Docker, and you do not want Bun on the host.
- You want a second stack on the same machine (`-p eyas-dev` + `EYAS_PORT=3200`).
- You want optional local Ollama with NVIDIA GPU (`--profile gpu`).

## Typical workflow

1. Clone the repo. Optionally add a `.env` (Compose reads it if present).
2. `docker compose up -d`. Open **http://localhost:3100**.
3. Persist `data/` via the `eyas-data` volume (already in the compose file). Mount `./config` read-only as shipped.
4. Logs: `docker compose logs -f`. Stop: `docker compose down`.
5. GPU Ollama: `docker compose --profile gpu up -d`.

## Features

```bash
docker compose up -d
docker compose --profile gpu up -d   # Ollama GPU
docker compose logs -f
docker compose down
```

Port mapping must match `EYAS_PORT` / app listen port (**3100** default — chosen to avoid Grafana/CRA on :3000). Host port is configurable; the container still listens on 3100:

```
"${EYAS_PORT:-3100}:3100"
```

Multiple stacks: `EYAS_PORT=3200 docker compose -p eyas-dev up -d`. See [Multiple instances](/docs/en/deploy/multi-instance/).

### Claude Code in a container

The image does not contain the Claude Code CLI. Without one, EYAS falls back to the older copy bundled inside its Agent SDK dependency (currently 2.1.89) and `eyas doctor` warns about it. To run a current Claude Code, install it in a derived image or mount it, and set `EYAS_CLAUDE_CODE_BIN` to its absolute path. Sign in with `ANTHROPIC_API_KEY` or a provisioned login: the provider is available only once that binary is signed in. See [Providers — Claude Code runtime](/docs/en/ai/providers/#claude-code-runtime).

### Grok and Kimi in a container

Grok CLI and Kimi Code CLI run in EYAS's own home inside the data volume (`data/cli-homes/…`), so they are signed in **for EYAS**, not with a login baked into the image. Use **Sign in with a device code** on the provider panel: EYAS shows a link and a code, and you confirm it in a browser on any other device — no browser is needed in the container. Grok also accepts an xAI API key, stored in Secrets. The sign-ins live in the `eyas-data` volume and survive container restarts. Point EYAS at a binary that is not on the container's PATH with `EYAS_GROK_BIN` / `EYAS_KIMI_BIN`. See [Providers — Sign in Grok and Kimi for EYAS](/docs/en/ai/providers/#sign-in-grok-and-kimi-for-eyas).

### Kernel file sandbox in a container

The EYAS image does **not** include bubblewrap: it is LGPL, so installing it is your choice. Without it, the CLI providers' own tools (Claude Code's shell, Grok CLI's tools) run without the kernel file sandbox; EYAS still refuses every request it sees, the provider panel shows the sandbox as *Unavailable on this server*, and with `security.cliSandbox: required` CLI turns with tools are refused. To have the kernel layer, install bubblewrap (`bwrap`) — plus `socat` for Claude Code — in a derived image, and run the container with unprivileged user namespaces enabled. `eyas doctor` (`docker compose exec eyas eyas doctor`) shows the result on its **CLI sandbox** line. See [Providers — Kernel file sandbox](/docs/en/ai/providers/#kernel-file-sandbox).

### Time zone

Containers usually run in UTC. The date and time EYAS tells the model follow `i18n.timezone`, else the container's `TZ` — see [Configuration — Time zone](/docs/en/deploy/configuration/#time-zone-of-the-models-clock).

## Related

- [Native](/docs/en/deploy/native/)
- [Kubernetes](/docs/en/deploy/kubernetes/)
- [Multi-instance](/docs/en/deploy/multi-instance/)
- [Getting started](/docs/en/getting-started/)
