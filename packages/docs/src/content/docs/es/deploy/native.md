---
title: Instalación nativa
description: Bun en el host — clone o instalador, luego eyas start. Portátil o VPS sencillo.
---

**Para qué sirve.** La nativa es uno de tres caminos (nativo / Docker / Kubernetes). Elige **nativo** cuando quieres Bun en la máquina, CLIs del host (`claude`, `grok`, `kimi`) en el mismo PATH y pocas piezas móviles. UI: **http://localhost:3100** — no 3000.

Ver [Primeros pasos](/docs/es/getting-started/).

## Cuándo usarlo

- Portátil de desarrollo o un VPS con Bun 1.x (o Node 22+).
- Proveedores CLI del host sin contenedor.
- Restaurar un backup en una instalación `--version` coincidente.

## Flujo típico

1. Bun 1.x (o Node 22+).
2. `git clone` + `bun install` **o** `scripts/install.sh` / `install.ps1`.
3. `bin/` en el `PATH`.
4. `./bin/eyas start` o `./bin/eyas serve`.
5. **http://localhost:3100**, [asistente de setup](/docs/es/setup-wizard/).

One-liner: `curl -fsSL https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.sh | bash`. Pin: `--version 0.8.16-beta`.

## Relacionado

- [Docker](/docs/es/deploy/docker/)
- [Kubernetes](/docs/es/deploy/kubernetes/)
- [CLI](/docs/es/deploy/cli/)
- [Configuración](/docs/es/deploy/configuration/)
