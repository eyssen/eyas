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

## Relacionado

- [Configuración](/docs/es/deploy/configuration/)
- [Nativo](/docs/es/deploy/native/)
- [FAQ](/docs/es/reference/faq/)
