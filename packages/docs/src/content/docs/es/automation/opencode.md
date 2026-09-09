---
title: OpenCode
description: Sidecar opcional del motor de código (MIT) con terminal web en la conversación.
---

**Para qué sirve.** OpenCode es un agente de código en terminal (MIT, [opencode.ai](https://opencode.ai)). EYAS **no** importa su núcleo privado ni sus SDK de IA. La vía oficial: servidor HTTP local (`opencode serve` en 127.0.0.1) y un PTY POSIX hacia xterm.js. El chat hidrata la memoria de EYAS; `opencode_run` envía la tarea. Puedes ver o tomar el TUI.

**Ruta:** `/opencode`. Barra: **IA → OpenCode**. En la conversación, el icono de terminal.

## Cuándo

- La tarea de código debe correr en el bucle de OpenCode.
- Quieres **ver** el TUI o escribir en él.
- OpenCode debe leer memoria EYAS y devolver diffs/stdout a L0.

## Flujo

1. Abre **OpenCode** (`/opencode`). Si no está listo: instala el CLI o `EYAS_OPENCODE_BIN`.
2. Concede `opencode_status` / `opencode_run`.
3. En la conversación, el icono de terminal.
4. Pide `opencode_run`. Memoria primero; captura después.

OpenCode usa **su propia autenticación de proveedor** (`opencode auth login` en el TUI).

## Relacionado

- [Herramientas](/docs/es/automation/tools/)
- [Memoria](/docs/es/knowledge/memory/)
- [Conversaciones](/docs/es/daily/conversations/)
