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

### Claude Code en el host

Instala Claude Code (`claude`) en el mismo PATH que EYAS, o define `EYAS_CLAUDE_CODE_BIN` con su ruta absoluta — un servicio arrancado por launchd o systemd suele tener un PATH más corto que tu shell. El proveedor solo está disponible cuando ese binario tiene la sesión iniciada (`claude auth status`). `eyas doctor` muestra qué binario ejecuta EYAS en su línea **Claude Code runtime**. Ver [Proveedores — Runtime de Claude Code](/docs/es/ai/providers/#claude-code-runtime).

### Workspaces en una instalación desde el código fuente

Una instalación desde el código fuente ejecutada desde un clon de git tiene su directorio de datos dentro de ese checkout, así que los workspaces de conversación van al directorio de datos de aplicación de tu usuario (por ejemplo `~/Library/Application Support/eyas/<instance>/workspaces` en macOS). Ver [Configuración — Workspaces de conversación](/docs/es/deploy/configuration/#conversation-workspaces).

## Relacionado

- [Docker](/docs/es/deploy/docker/)
- [Kubernetes](/docs/es/deploy/kubernetes/)
- [CLI](/docs/es/deploy/cli/)
- [Configuración](/docs/es/deploy/configuration/)
