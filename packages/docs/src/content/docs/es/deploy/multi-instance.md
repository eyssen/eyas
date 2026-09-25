---
title: Varias instancias
description: EYAS_HOME y puertos separados — nunca dos escritores en un mismo SQLite.
---

**Para qué sirve.** Una máquina puede correr más de una EYAS. El aislamiento es **directorio de datos + puerto**, no «dos procesos, una BD». SQLite no es un clúster multi-escritor.

## Cuándo usarlo

- Segunda instancia en el mismo portátil sin mezclar vaults.
- Docker: segundo nombre de proyecto Compose y puerto de host.
- Salud del programador **Leader / Follower**.

## Flujo típico

1. Nuevo `EYAS_HOME` y `EYAS_PORT` libre (p. ej. 3200).
2. Nativo: `EYAS_HOME=… EYAS_PORT=3200 eyas start`.
3. Docker: `EYAS_PORT=3200 docker compose -p eyas-dev up -d`.
4. Cada UI en su puerto. **Nunca** dos instancias vivas al mismo archivo SQLite.

Palancas: `EYAS_HOME` (datos, pid y config local separados) · `EYAS_DATA_DIR` (opcional: el directorio de datos de una instancia en otro sitio; la base de datos **y el vault de memoria** (`<data dir>/vault`) se mueven con él) · `EYAS_WORKSPACES_DIR` (opcional: dónde viven los workspaces de conversación de esa instancia) · `EYAS_PORT` / `--port` · nombre de proyecto Compose.

**Vaults y workspaces quedan separados.** El vault de cada instancia es `<data dir>/vault`, así que directorios de datos separados significan vaults separados. En una instalación desde el código fuente ejecutada desde un clon de git, los workspaces de conversación viven en una carpeta por instancia con el nombre de la carpeta home de EYAS más un hash corto del directorio de datos, así que una instancia de desarrollo y una en producción en la misma máquina nunca comparten workspaces. Si defines `EYAS_WORKSPACES_DIR`, da a cada instancia su propia ruta. Ver [Configuración — Workspaces de conversación](/docs/es/deploy/configuration/#conversation-workspaces).

## Relacionado

- [Nativo](/docs/es/deploy/native/)
- [Docker](/docs/es/deploy/docker/)
- [Programador](/docs/es/automation/scheduler/)
- [CLI](/docs/es/deploy/cli/)
- [Configuración](/docs/es/deploy/configuration/)
