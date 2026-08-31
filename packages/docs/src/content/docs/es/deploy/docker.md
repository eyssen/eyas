---
title: Docker
description: Compose un contenedor (más Ollama GPU opcional). Puerto 3100. Persiste data/.
---

**Para qué sirve.** Segundo camino: un servicio `eyas`, volumen `data/`, perfil **gpu** opcional para Ollama. Cuando ya hay Docker y no quieres Bun en el host. La imagen incluye backend, frontend dist y docs en `/docs/`. El contenedor escucha en **3100**.

## Cuándo usarlo

- El servidor ya tiene Docker.
- Un segundo stack (`-p eyas-dev` + `EYAS_PORT=3200`).
- Ollama local con NVIDIA (`--profile gpu`).

## Flujo típico

1. Clona. `.env` opcional.
2. `docker compose up -d`. **http://localhost:3100**.
3. Volumen `eyas-data`. `./config` de solo lectura.
4. `docker compose logs -f` / `down`.
5. GPU: `docker compose --profile gpu up -d`.

Mapeo `"${EYAS_PORT:-3100}:3100"` — 3100 para no chocar con Grafana/CRA en :3000. Ver [Varias instancias](/docs/es/deploy/multi-instance/).

## Relacionado

- [Nativo](/docs/es/deploy/native/)
- [Kubernetes](/docs/es/deploy/kubernetes/)
- [Varias instancias](/docs/es/deploy/multi-instance/)
