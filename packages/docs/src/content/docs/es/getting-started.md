---
title: Primeros pasos
description: Instalar EYAS, arrancar el servidor, asistente y abrir la UI.
---

## Pasos

1. Instalar EYAS (nativo o Docker)
2. Arrancar el servidor
3. Completar el [asistente](/docs/es/setup-wizard/)
4. Abrir la UI web

## Requisitos

| Requisito | Notas |
|-----------|--------|
| **Bun 1.x** (recomendado) o **Node.js 22+** | Runtime principal: Bun |
| Disco | SQLite, vault, workspaces en `data/` |
| Opcional: Docker | Despliegue en contenedor |
| Opcional: CLIs del host | `claude`, `grok`, `kimi` |

## Instalación nativa

```bash
git clone https://github.com/eyssen/eyas.git
cd eyas && bun install && ./bin/eyas start
```

**http://localhost:3100** (puerto por defecto **3100**). Primer plano: `./bin/eyas serve`.

Instalador: `scripts/install.sh` / `install.ps1`. Versión fija: `--version 0.8.9-beta`.

## Docker

```bash
docker compose up -d
# GPU: docker compose --profile gpu up -d
```

## Ciclo de vida

| Comando | Función |
|---------|---------|
| `eyas serve` | Primer plano |
| `eyas start` / `stop` / `restart` | Segundo plano |
| `eyas status` / `doctor` / `version` | Estado / diagnóstico / versión |

Frontend y docs se construyen al arrancar si faltan (`EYAS_SKIP_WEB_BUILD` / `EYAS_SKIP_DOCS_BUILD` para omitir).

## Primer acceso

`/setup` → owner → [Panel](/docs/es/daily/dashboard/). Docs en **`/docs/`**.

## Datos

`data/sqlite/`, `data/vault/`, `data/agents/`, `data/backups/`, `config/` bajo `$EYAS_HOME` o el cwd de arranque.

## Siguiente

[Asistente](/docs/es/setup-wizard/) · [Conceptos](/docs/es/concepts/) · [CLI](/docs/es/deploy/cli/)
