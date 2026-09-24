---
title: Glosario
description: Términos del producto.
---

| Término | Definición |
|---------|------------|
| Agente | Actor de IA configurado |
| Colega | Agente primary o team con el que hablas; un hilo de inicio por colega (barra **Colegas**) |
| Primary | Colegas always-on del setup (Asistente personal + Ingeniero de sistema) |
| Especialista | Trabajador estrecho que cualquier colega puede lanzar (`run_specialist`) |
| Hilo de inicio | Una conversación continua por colega |
| Skill | Paquete de procedimiento markdown |
| Propuesta de habilidad | Skill coincidente a la que la ronda espera — **Úsala**, **Ahora no**, o owner/admin **Desactivar** |
| Herramienta | Capacidad invocable |
| Coding surface | Herramientas de archivo agnósticas al modelo (`read_file`, `edit_file`, `grep`, …) de EYAS |
| Worktree | Árbol git aislado para especialistas escritores en paralelo (`.eyas-worktrees/`) |
| Verify commands | Lint/test tras una ejecución, antes del crítico LLM |
| Tool hook | PreToolUse / PostToolUse en cada ejecución |
| Resultado de herramienta | El estado final de una llamada a herramienta en la traza: *Correcto*, *Fallido*, *Denegado*, *Requiere aprobación* u *Omitido* (*Resultado desconocido* si el turno terminó antes). Una fila solo se pone en verde cuando la herramienta informó de verdad, igual en todos los proveedores ([Traza de herramientas](/docs/es/daily/conversations/#tool-trace)) |
| Registro de ejecución de herramientas | El registro de cada llamada a herramienta: nombre canónico, entrada, salida o error, duración, conversación, agente y ejecución. Incluye las herramientas que una CLI ejecutó en su propio bucle (el `Bash` de Claude Code se registra como `run_command`). Lo leen el crítico de completitud y el Autoaprendizaje; nada de él llega a la memoria ([Herramientas](/docs/es/automation/tools/#tool-execution-log)) |
| Tablero | Superficie de seguimiento de trabajo |
| Conversación | Hilo de chat |
| Resultado del turno | Cómo terminó un turno de chat, como una insignia bajo la respuesta: ninguna si se completó; si no, *Límite de turnos alcanzado*, *Límite de salida alcanzado*, *Rechazado por el modelo*, *Presupuesto de herramientas agotado*, *Detenido*, *Fallido* o *Esperando aprobación*. La respuesta escrita hasta entonces se conserva siempre ([Resultado del turno](/docs/es/daily/conversations/#turn-outcome)) |
| Nivel de memoria | Working→episodic→vault→archive |
| Registro en bruto (L0) | Una segunda copia literal y comprimida de cada mensaje que EYAS guarda, más la salida de herramientas y el razonamiento del modelo cuando esos interruptores están activados. Los modelos solo llegan a él mediante el recall; la salida de herramientas y el razonamiento grabados nunca se recuerdan. Interruptor: `memory.l0.enabled` ([El registro en bruto](/docs/es/knowledge/memory/#the-raw-record)) |
| Nivel de confianza | Quién escribió un texto recordado: *owner*, *derived*, *peer*, *ingested* o *quarantined*. Un hecho o un resumen nunca tiene más confianza que el texto del que salió. Peso en el recall: 1 / 1 / 0,3 / 0,6 / nunca ([Confianza: quién lo escribió](/docs/es/knowledge/memory/#trust-who-wrote-it)) |
| Ámbito de proyecto | La memoria que puede ver una conversación: la de su proyecto, la de su tipo de proyecto y la global — nunca la de otro proyecto. EYAS lo impone en el servidor para el recall y para cada herramienta de memoria, envíe lo que envíe el modelo ([Qué memoria ve una conversación](/docs/es/knowledge/memory/#which-memory-a-conversation-can-see)) |
| Id de memoria | El id de una línea recordada, que `memory_expand` abre. Su prefijo indica la capa: `vt:` nota del vault, `gs:` resumen, `ft:` hecho, `en:` entidad, `ep:` episodio, `rw:` registro en bruto (un mensaje anterior). Observabilidad cuenta la memoria entregada con estos códigos |
| Memory block | Retirado: las antiguas notas compartidas que los agentes leían/escribían con las herramientas `memory_block_*`, copiadas una vez a la memoria de EYAS al actualizar |
| Vault | Conocimiento markdown a largo plazo |
| Capture run | Una extracción de memoria durable post-turno; cada resultado escribe `memory_capture_runs`. Interruptor: `memory.capture.enabled` |
| Lienzo de diseño | Multi-artboard `.dc.html` + `canvas.json`, formato Claude Design con runtime de EYAS |
| Proveedor | Backend LLM |
| Tipo de proveedor | `cli` (Claude Code CLI, Grok CLI, Kimi Code CLI), `local` (Ollama, LM Studio, vLLM) o `api` (cualquier API alojada). `GET /api/v1/model/providers` lo devuelve junto al nombre del producto, y la página Proveedores y el asistente de configuración reconocen por él a un proveedor CLI ([Proveedores](/docs/es/ai/providers/#built-in-providers)) |
| Modelo fijado | El modelo en el que corre una conversación y que conserva. Una conversación nueva que no nombra ninguno recibe el valor por defecto de la instalación en su primer mensaje; cambiar los valores por defecto después no la mueve. Un modelo que elegiste en el selector de modelo nunca se cambia en silencio: si deja de estar disponible, el mensaje se rechaza |
| Selector de modelo | El control de la barra superior de la conversación que elige un modelo fijo, Auto-enrutado o el predeterminado del colega, e indica qué modelo responde al siguiente mensaje y por qué |
| Auto-enrutado | Una elección por conversación: solo una conversación puesta en Auto tiene sus mensajes clasificados y enrutados entre los niveles, y solo mientras **Permitir enrutamiento automático** esté activado |
| Predeterminado del colega | Una conversación con un colega (y una subconversación) sigue el modelo de ese colega; si no, el de la conversación que delega; si no, el predeterminado; si el modelo del colega no está disponible, el turno recurre a otro con una nota, nunca en silencio |
| Modelo en segundo plano | El modelo en el que corre el trabajo en segundo plano de EYAS (títulos, heartbeat, captura de memoria, juez de seguridad, research, …) — solo un proveedor que puede hacer llamadas aisladas, probado en un orden fijo de niveles. La tarjeta **Llamadas de modelo en segundo plano** de Niveles de enrutado muestra adónde va cada grupo |
| Sandbox de archivos del kernel | El sandbox de archivos del sistema operativo (macOS Seatbelt, Linux bubblewrap) en el que se ejecutan los comandos de shell de Claude Code y las herramientas propias de Grok CLI, y que bloquea la memoria fuera de EYAS y los datos privados de EYAS; Kimi Code CLI no tiene. `security.cliSandbox: auto \| required` |
| Cuarentena (memoria de un proveedor) | Acción del propietario en Memoria → Resumen que oculta a todos los modelos lo que escribió un proveedor, y que puede liberarse después; no se borra nada |
| Directorio personal de CLI (CLI home) | Carpeta propia de EYAS en la que corren Grok CLI, Kimi Code CLI y OpenCode (`<data dir>/cli-homes/<provider>`) en lugar de la configuración del operador; guarda su inicio de sesión para EYAS. Claude Code mantiene el directorio personal del host y solo comparte su inicio de sesión |
| Iniciar sesión para EYAS | Login de Grok CLI / Kimi Code CLI hecho para el directorio personal de CLI de EYAS (código de dispositivo, o una clave de API de xAI para Grok) — no se usa el login del host |
| Comprobación de aislamiento | La comprobación de EYAS de que una CLI (Claude Code, Grok, Kimi) no cargó nada del host; un turno que no la pasa se detiene y nunca se pasa a otro modelo |
| Comprobación de publicación | `bun run test:live-cli`, antes de publicar: Claude Code y Grok CLI reales (y Kimi Code CLI donde esté instalado) corren a través de EYAS en un directorio personal desechable lleno de trampas, para demostrar que no se carga nada del host y que la memoria fuera de EYAS sigue rechazada. Su parte gratuita usa un modelo falso local y no gasta tokens ([Cómo se demuestra el aislamiento](/docs/es/admin/security-privacy/#how-isolation-is-proven)) |
| Versión de CLI probada | La versión de CLI con la que pasó por última vez la comprobación de publicación: Claude Code 2.1.281 y Grok CLI 1.0.41; Kimi Code CLI todavía no. `eyas doctor` avisa si la versión instalada es otra; cada sesión se sigue comprobando al arrancar ([Versiones de CLI probadas](/docs/es/ai/providers/#proven-cli-versions)) |
| Bloque del turno | El bloque `<turn-context>` que EYAS pone al principio de tu mensaje actual en cada turno: la fecha y la hora actuales y, después, el bloque de recall. Se construye de nuevo en cada turno y solo se envía al modelo — nunca se guarda con tu mensaje —, así que el system prompt no cambia de un turno a otro ([Cómo llega el recall al modelo](/docs/es/knowledge/memory/#how-recall-reaches-the-model)) |
| Bloque de recall | El bloque delimitado `<eyas-memory>` dentro del bloque del turno: las notas permanentes, las notas recuperadas para este mensaje y el texto completo de las mejores coincidencias. Igual en todos los proveedores, dimensionado según la ventana de contexto del modelo que responde |
| Drill-down | El modelo abre la memoria por sí mismo con `memory_search` / `memory_expand`: 3 llamadas por respuesta en todos los proveedores, siempre dentro del ámbito de proyecto de la conversación. Cada host nombra las herramientas a su manera (`mcp__eyas__memory_search` en Claude Code, `use_tool` con `eyas__memory_search` en Grok CLI); un modelo que no puede llamar a herramientas no tiene drill-down y recibe a cambio más notas con su texto completo ([Buscar más allá: memory_search y memory_expand](/docs/es/knowledge/memory/#looking-further-memory_search-and-memory_expand)) |
| Perfil de entrega | Lo que EYAS sabe del modelo que responde un turno: su ventana de contexto, si llama a herramientas, cómo nombra su host las herramientas de EYAS y si puede hacer drill-down. El prompt y el bloque de recall se dimensionan con él, y a un modelo que no puede llamar a herramientas no se le envía ninguna. En cada turno lo muestra el recuadro **Memoria entregada** ([Composición del contexto](/docs/es/daily/conversations/#context-composition)) |
| Motor de recuperación | Aquello con lo que recuerda cada modelo: un embedder local (multilingual-e5-small o, si no, uno de reserva con hash), vectores archivados por partición de proyecto, una consulta y una clasificación. Se muestra en solo lectura en la tarjeta **Motor de recuperación** de **Memoria → Resumen** ([Motor de recuperación](/docs/es/knowledge/memory/#recall-engine)) |
| Entrega de memoria por proveedor | La tarjeta de **Observabilidad → Contexto** que compara proveedores: turnos que llevaron memoria, elementos medios por capa, tokens de memoria y consultas de memoria por turno. Cifras parecidas significan que cada modelo recibió la misma memoria ([Observabilidad y ops](/docs/es/admin/observability/#memory-delivery-by-provider)) |
| Memoria fuera de EYAS | La memoria de otras herramientas, las bóvedas de notas y la carpeta de datos propia de EYAS — rechazadas a todos los modelos para leer y escribir |
| MCP | Model Context Protocol |
| Connection | Entrada de inventario de un sistema externo (Odoo, GitHub, MCP, …) |
| Canal | Conector de mensajería externa — no Connection, no Mano |
| Mano (Hand) | Cliente local emparejado con herramientas OS/CLI/escritorio ([Manos](/docs/es/admin/hands/)) |
| Media | Pasarela alojada prompt→píxeles (Magnific, Higgsfield, fal, HeyGen). Cinco herramientas `media_*`; ninguna es el valor por defecto. ([Media](/docs/es/ai/media/)) |
| HeyGen | Backend opcional de vídeo talking-head / presentador bajo Media (OAuth MCP, créditos del plan web). No es Estudio. ([Media](/docs/es/ai/media/)) |
| Estudio | Motores de producción locales (HTML o metraje → archivo). No es Media. ([Estudio](/docs/es/studio/)) |
| Video Use | Motor de Estudio que corta metraje desde un EDL ([Video Use](/docs/es/studio/videouse/)) |
| Browser Use | Sidecar CLI opcional para Chrome con sesión vía CDP ([Browser Use](/docs/es/automation/browser-use/)) |
| OpenCode | Sidecar opcional del motor de código MIT (HTTP 127.0.0.1 + TUI web). No vendored. ([OpenCode](/docs/es/automation/opencode/)) |
| Plugin de memoria de OpenCode | Da al modelo de OpenCode las herramientas de solo lectura `memory_search` / `memory_expand` de EYAS y ninguna que escriba memoria. Una tarea `opencode_run` lee el ámbito de proyecto de su conversación, las demás sesiones solo la memoria global y un servidor externo conectado ninguna. Cada proceso de OpenCode que arranca EYAS tiene su propia clave, que muere con el proceso ([Memoria de EYAS dentro de OpenCode](/docs/es/automation/opencode/#eyas-memory-inside-opencode)) |
| Nodo remoto | Otra máquina que esta instancia alcanza (SSH y amigos) ([Nodos](/docs/es/admin/nodes/)) |
| Paquete de extensión | Pack de skills de terceros del catálogo, chequeo MIT ([Extensiones](/docs/es/admin/extensions/)) |
| Recordly | Grabador de pantalla de escritorio AGPL; compañero de terceros en Extensiones, no incluido, no es motor de Estudio ([Recordly](/docs/es/admin/extensions/#recordly)) |
| Grounding | Exigir evidencia de búsqueda antes de afirmar hechos |
| Hybrid search | FTS + vector (RRF) |
| Search source | Árbol indexado con nombre bajo Fuentes de búsqueda |
| Code source pin | Selección de conversación o proyecto de qué fuentes puede consultar el agente |
| Working directories | Carpetas con nombre (nombre + ruta absoluta) de lectura/escritura; la primera es cwd. Tipo y/o proyecto; la conversación hereda. Las herramientas de archivo quedan encerradas aquí — una conversación sin ninguna recibe su propio workspace de EYAS |
| Workspace de EYAS | La carpeta que EYAS crea para una conversación sin directorios de trabajo propios; nunca dentro de un checkout de git (`EYAS_WORKSPACES_DIR` para moverla) |
| Plan primero | Modo del compositor: el modelo escribe un plan y espera **Aprobar** / **Saltar plan** / **Rechazar** antes de ejecutar herramientas |
| Skill import roots | `skills.importRoots` / `agent.importRoots` en `local.yaml` — carpetas markdown extra, leídas en cada arranque. Por defecto vacío. Las raíces dentro de las carpetas de otra herramienta se omiten |
| Wiki de proyecto | Páginas por proyecto (`/projects/:id/wiki`); auto-update opcional de tickets cerrados y decisiones de equipo |
| needsPin | Respuesta de herramienta cuando hay varias versiones odoo-family listas y ninguna está fijada |
| Prompt Enhancer | Coach de borradores de conversación |
| Prompt Coach | Coach de prompts durables de proyecto / agente |
| Forge | Cambios de soul/identidad aprobados |
| God Mode | La misma tarea la corren en carrera los modelos del roster de Ajustes; un chair desempata |
| Security gate | Política previa a la acción |
| CASL | Biblioteca de autorización |
| Orchestration | Solo/Auto/Deep: política de especialistas (más God Mode) |
| Effort | Profundidad de razonamiento (Automático, Ninguno, Mínimo, Bajo, Medio, Alto, Muy alto, Máximo). El selector lista solo los niveles que ofrece el modelo; Automático hereda (Deep → Máximo, colega, conversación que delega, nivel de enrutado) o usa el predeterminado del modelo; cada llamada se ajusta a lo que admite el modelo que responde, y cada respuesta muestra el esfuerzo con el que se ejecutó |
| Nivel releído | Claude Code CLI, Grok CLI y Kimi Code CLI informan del nivel de esfuerzo con el que corrieron de verdad, y eso es lo que muestran la respuesta y su traza. En cualquier otro proveedor es el nivel que envió EYAS tras ajustarlo al modelo ([Cómo aplica cada proveedor el nivel de esfuerzo](/docs/es/ai/providers/#effort-by-provider)) |
| SLA breach | Señal proactiva de trabajo overdue o stale |
| A2A | Protocolo agente-a-agente (card + ejecución de tareas) |
