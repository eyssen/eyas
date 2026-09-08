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

## Relacionado

- [Nativo](/docs/es/deploy/native/)
- [Docker](/docs/es/deploy/docker/)
- [Programador](/docs/es/automation/scheduler/)
- [CLI](/docs/es/deploy/cli/)
