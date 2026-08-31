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

## Related

- [Native](/docs/en/deploy/native/)
- [Kubernetes](/docs/en/deploy/kubernetes/)
- [Multi-instance](/docs/en/deploy/multi-instance/)
- [Getting started](/docs/en/getting-started/)
