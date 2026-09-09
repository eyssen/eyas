---
title: Referencia CLI
description: eyas serve/start/stop/doctor/config/module — opera el camino de instalación que hayas elegido.
---

**Para qué sirve.** El binario `eyas` arranca, para, diagnostica y conmuta módulos. El mismo proceso, el mismo `EYAS_HOME`.

## Cuándo usarlo

- Primer plano (`serve`) para logs, o fondo (`start` + pidfile).
- `doctor` antes de un informe de error.
- Conmutar un módulo sin editar YAML a mano.
- Versión más nueva en GitHub (`eyas update check`).

## Flujo típico

1. [Nativo](/docs/es/deploy/native/) o [Docker](/docs/es/deploy/docker/).
2. `eyas doctor`.
3. `eyas serve` o `eyas start`. `eyas status`.
4. Tras YAML: `eyas config validate`.
5. `eyas stop` / `eyas restart`.

Comandos: serve, start, stop, restart, status, doctor, version, config validate/reload, module list/enable/disable, update check, migrate (v1→v2, no ops diarias). Puerto por defecto **3100**. `EYAS_SKIP_DOCS_BUILD=1` → `/docs` 404. Ver [FAQ](/docs/es/reference/faq/).

## Qué comprueba `doctor`

Dos de sus líneas son nuevas en 0.8.23-beta, y ambas tienen que ver con el registro en bruto de la memoria.

| Línea | Significado |
|-------|-------------|
| **SQLite** | Un autotest en vivo sobre una base de datos temporal en memoria — tu archivo de datos no se abre nunca. Informa de la versión de SQLite, de si está **FTS5** (sin él es un fallo: la búsqueda de memoria, de conversaciones y del vault lo necesitan) y de si carga la extensión `sqlite-vec`, insertando de verdad una fila y lanzando una consulta de vecino más cercano en vez de limitarse a preguntar la versión. Que falte la extensión es un aviso, con el remedio para tu plataforma, no un fallo. |
| **zstd** | Qué implementación de compresión usará el registro en bruto: la nativa de Bun, la de Node (22.15 o posterior) o el fallback WASM incluido. El fallback es un aviso — funciona y es unas dos veces más lento. No tener ninguna implementación es un fallo, y entonces EYAS no graba nada en vez de llenar un búfer que nunca podrá escribir. |

## Relacionado

- [Configuración](/docs/es/deploy/configuration/)
- [Nativo](/docs/es/deploy/native/)
- [FAQ](/docs/es/reference/faq/)
