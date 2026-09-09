---
title: FAQ
description: Problemas habituales.
---

### Puerto en uso
`EYAS_PORT=3200 ./bin/eyas start` o libera el proceso.

### La UI no está en el puerto 3000
El puerto de escucha por defecto es **3100**, para no chocar con Grafana o Create React App en :3000. Abre **http://localhost:3100**. Override: `EYAS_PORT` o `server.port`. Docker: `"${EYAS_PORT:-3100}:3100"`.

### Sin UI
`bun run build:web` (automático al arrancar salvo `EYAS_SKIP_WEB_BUILD=1`).

### /docs 404
`bun run docs:build` o reinicia sin `EYAS_SKIP_DOCS_BUILD`. Paquete: `packages/docs`. No ejecutes `generate-full-docs.mjs` / `bun run full-docs` — sobrescribe la prosa.

### Error de autenticación del proveedor
Vuelve a introducir la clave en Proveedores/Secretos; para CLIs, `claude`/`grok`/`kimi` deben funcionar en el mismo entorno.

### Las conversaciones leen ~/.claude / ~/.grok
Claude Code CLI: deja **Cargar config Claude del host** **OFF** (por defecto). Las llamadas aisladas también ponen `CLAUDE_CODE_DISABLE_AUTO_MEMORY`. Grok/Kimi ACP **no** se pueden aislar. Ver [Proveedores](/docs/es/ai/providers/).

### Se escriben notas duraderas y quiero apagarlo
`memory.capture.enabled: false` en `local.yaml` (por defecto **true**). Apagado = ninguna fila `memory_capture_runs`. Ver [Memoria](/docs/es/knowledge/memory/) y [Configuración](/docs/es/deploy/configuration/).

### ¿Dónde están los datos?
`$EYAS_HOME` o cwd: `data/sqlite`, `data/vault`, `data/agents`, copias, logs.

### El asistente se atasca tras recargar
Entra como propietario, abre `/setup` para los pasos opcionales restantes.
