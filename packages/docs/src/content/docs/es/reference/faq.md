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
Vuelve a introducir la clave en Proveedores/Secretos. Para Claude Code, `claude` debe tener la sesión iniciada en el mismo entorno. Grok y Kimi inician sesión para EYAS en su panel de proveedor, no en el host.

### Las conversaciones leen ~/.claude / ~/.grok
Ya no pueden. Claude Code siempre corre aislado — sin `CLAUDE.md`, ajustes, hooks, skills, servidores MCP ni auto-memoria del host, y sin transcripciones en `~/.claude/projects`; el antiguo interruptor **Cargar config Claude del host** ha desaparecido. Grok CLI y Kimi Code CLI corren en su propio directorio personal de EYAS y nunca ven `~/.grok`, `~/.kimi` ni `~/.claude`. El security gate rechaza a todos los modelos tanto leer como escribir la memoria de otras herramientas, y los servidores MCP de almacén de memoria están bloqueados. Para traer ese conocimiento a EYAS, impórtalo una vez con **Ajustes → Sistema → Portabilidad de datos → Importar datos**. Ver [Proveedores — Aislamiento de Claude Code](/docs/es/ai/providers/#claude-code-isolation) y [Memoria](/docs/es/knowledge/memory/#memory-outside-eyas-is-refused).

### Grok o Kimi dejaron de responder tras la actualización
Grok CLI y Kimi Code CLI corren ahora en el directorio personal propio de EYAS, así que no se usa el inicio de sesión de la CLI en el equipo. Inicia sesión una vez para EYAS: **Proveedores → Grok CLI / Kimi Code CLI → Iniciar sesión para EYAS** (código de dispositivo; Grok también acepta una clave de API de xAI). Hasta entonces la tarjeta muestra **Inicio de sesión necesario** y los turnos fallan con *… no tiene la sesión iniciada para EYAS*. Ver [Proveedores — Iniciar sesión de Grok y Kimi para EYAS](/docs/es/ai/providers/#sign-in-grok-and-kimi-for-eyas).

### Un turno falló con «no pudo confirmar que se ejecuta aislado»
EYAS encontró algo en el host que rompería el aislamiento de la CLI — por ejemplo un servidor MCP, hook, plugin o skill de más, una config de Grok para todo el sistema, o una política gestionada de Claude Code que fuerza otro modo de permisos. Quita la causa y vuelve a enviar el mensaje; el turno nunca se pasa a otro modelo. Ver [Proveedores — Comprobación de aislamiento](/docs/es/ai/providers/#isolation-check-before-every-turn) y [Aislamiento de Claude Code](/docs/es/ai/providers/#claude-code-isolation).

### Un servidor MCP muestra «Bloqueado: almacén de memoria»
Guarda una segunda memoria fuera de EYAS (Memory, Qdrant, Obsidian, MCPVault, …) o apunta a una carpeta protegida, así que EYAS nunca lo inicia. Edítalo para que apunte a otro sitio, o bórralo, y trae esa memoria con la importación de datos. Ver [MCP](/docs/es/ai/mcp/#memory-store-servers-are-blocked).

### Claude Code está instalado pero el proveedor no está disponible
EYAS necesita que el binario de Claude Code tenga la **sesión iniciada**, no solo que esté en el PATH: login de claude.ai, `ANTHROPIC_API_KEY` o una configuración Bedrock/Vertex. Mira `eyas doctor` — la línea **Claude Code runtime** muestra qué binario ejecuta EYAS y si tiene la sesión iniciada. El PATH de un servicio puede no tener `claude`; define `EYAS_CLAUDE_CODE_BIN` con su ruta absoluta. Tras iniciar sesión, apaga y vuelve a encender el proveedor en Proveedores, o reinicia. Ver [Proveedores — Runtime de Claude Code](/docs/es/ai/providers/#claude-code-runtime).

### Se escriben notas duraderas y quiero apagarlo
`memory.capture.enabled: false` en `local.yaml` (por defecto **true**). Apagado = ninguna fila `memory_capture_runs`. Ver [Memoria](/docs/es/knowledge/memory/) y [Configuración](/docs/es/deploy/configuration/).

### ¿Dónde están los datos?
`$EYAS_HOME` o cwd: `data/sqlite`, `data/vault`, `data/agents`, copias, logs. `EYAS_DATA_DIR` mueve el directorio de datos entero; el vault se mueve con él (`<data dir>/vault`). Los workspaces de conversación de una instalación desde el código fuente ejecutada desde un clon de git viven en el directorio de datos de aplicación de tu usuario — ver [Configuración](/docs/es/deploy/configuration/#conversation-workspaces).

### Definí EYAS_DATA_DIR y faltan mis notas de memoria
Las versiones anteriores guardaban el vault en `<EYAS home>/data/vault` aunque `EYAS_DATA_DIR` apuntara a otro sitio. El primer arranque tras actualizar copia esas notas una vez en `<data dir>/vault`, pero solo mientras el vault nuevo no contenga ninguna nota. Ejecuta `eyas doctor`: su línea **Vault** dice si hay una copia pendiente o si la carpeta antigua ya no se usa porque las dos tienen notas — en ese caso copia a mano las notas que aún necesites. Ver [Configuración — Directorio de datos y vault](/docs/es/deploy/configuration/#data-directory-and-vault).

### El modelo recibe una hora local equivocada
Define `i18n.timezone` (un nombre IANA como `Europe/Berlin`) en `local.yaml` y reinicia. Sin definir, EYAS usa la zona del servidor — `TZ` o, si no, la del sistema operativo; los contenedores suelen estar en UTC. Ver [Configuración](/docs/es/deploy/configuration/#time-zone-of-the-models-clock).

### El asistente se atasca tras recargar
Entra como propietario, abre `/setup` para los pasos opcionales restantes.
