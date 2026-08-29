---
title: Glosario
description: Términos del producto.
---

| Término | Definición |
|---------|------------|
| Agente | Actor de IA configurado |
| Primary | Compañeros de setup siempre activos |
| Skill | Paquete de procedimiento markdown |
| Propuesta de habilidad | Skill coincidente a la que la ronda espera — **Úsala**, **Ahora no**, o owner/admin **Desactivar** |
| Herramienta | Capacidad invocable |
| Coding surface | Herramientas de archivo agnósticas al modelo (`read_file`, `edit_file`, `grep`, …) de EYAS |
| Worktree | Árbol git aislado para un agente de equipo paralelo (`.eyas-worktrees/`) |
| Verify commands | Lint/test tras una ejecución, antes del crítico LLM |
| Tool hook | PreToolUse / PostToolUse en cada ejecución |
| Tablero | Superficie de seguimiento de trabajo |
| Conversación | Hilo de chat |
| Nivel de memoria | Working→episodic→vault→archive |
| Memory block | Nota compartida acotada (company/agent/team/run) |
| Vault | Conocimiento markdown a largo plazo |
| Capture run | Una extracción de memoria durable post-turno; cada resultado escribe `memory_capture_runs`. Interruptor: `memory.capture.enabled` |
| Lienzo de diseño | Multi-artboard `.dc.html` + `canvas.json`, formato Claude Design con runtime de EYAS |
| Proveedor | Backend LLM |
| MCP | Model Context Protocol |
| Connection | Entrada de inventario de un sistema externo (Odoo, GitHub, MCP, …) |
| Canal | Conector de mensajería externa — no Connection, no Mano |
| Mano (Hand) | Cliente local emparejado con herramientas OS/CLI/escritorio ([Manos](/docs/es/admin/hands/)) |
| Estudio | Motores de producción locales (HTML o metraje → archivo). No es Media. ([Estudio](/docs/es/studio/)) |
| Video Use | Motor de Estudio que corta metraje desde un EDL ([Video Use](/docs/es/studio/videouse/)) |
| Browser Use | Sidecar CLI opcional para Chrome con sesión vía CDP ([Browser Use](/docs/es/automation/browser-use/)) |
| Nodo remoto | Otra máquina que esta instancia alcanza (SSH y amigos) ([Nodos](/docs/es/admin/nodes/)) |
| Paquete de extensión | Pack de skills de terceros del catálogo, chequeo MIT ([Extensiones](/docs/es/admin/extensions/)) |
| Recordly | Grabador de pantalla de escritorio AGPL; compañero de terceros en Extensiones, no incluido, no es motor de Estudio ([Recordly](/docs/es/admin/extensions/#recordly)) |
| Grounding | Exigir evidencia de búsqueda antes de afirmar hechos |
| Hybrid search | FTS + vector (RRF) |
| Search source | Árbol indexado con nombre bajo Fuentes de búsqueda |
| Code source pin | Selección de conversación o proyecto de qué fuentes puede consultar el agente |
| Working directories | Carpetas absolutas ordenadas de lectura/escritura; la primera es cwd |
| needsPin | Respuesta de herramienta cuando hay varias versiones odoo-family listas y ninguna está fijada |
| Prompt Enhancer | Coach de borradores de conversación |
| Prompt Coach | Coach de prompts durables de proyecto / agente |
| Forge | Cambios de soul/identidad aprobados |
| God Mode | La misma tarea la corren en carrera los modelos del roster de Ajustes; un chair desempata |
| Security gate | Política previa a la acción |
| CASL | Biblioteca de autorización |
| Orchestration | Solo/Auto/Deep (más God Mode) |
| Effort | Profundidad de razonamiento |
| SLA breach | Señal proactiva de trabajo overdue o stale |
| A2A | Protocolo agente-a-agente (card + ejecución de tareas) |
