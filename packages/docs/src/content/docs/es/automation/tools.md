---
title: Herramientas
description: Catálogo de capacidades invocables — riesgo, aprobación y asignación a agentes.
---

**Para qué sirve.** Las herramientas (tools) son las acciones que un agente puede ejecutar de verdad: leer un archivo, buscar en un índice, abrir un navegador, enviar un borrador de correo. Esta página es el catálogo en vivo de todo lo registrado en esta instancia. La asignación sigue en la pestaña **Configuración** del agente; aquí revisas el nombre, la categoría, el riesgo y si una llamada espera aprobación.

**Ruta:** `/tools`. Barra lateral: **Herramientas**. Subtítulo: *Herramientas registradas disponibles para la ejecución de agentes.*

## Cuándo usarlo

- Quieres saber qué herramientas existen antes de poner sus ids en un agente.
- Una llamada se bloqueó y necesitas el nivel de riesgo y si **requiere aprobación**.
- Estás conectando MCP o una Conexión y quieres ver las herramientas descubiertas junto a las integradas.
- Necesitas el esquema de entrada de una herramienta que el agente llama mal una y otra vez.

## Flujo típico

1. Abre **Herramientas** en la barra lateral (`/tools`).
2. Busca por nombre o descripción, o filtra por categoría y nivel de riesgo.
3. Despliega **Mostrar esquema** en una tarjeta cuando necesites la forma JSON de la entrada.
4. Pon el id de la herramienta en la pestaña **Configuración** del agente, en **Herramientas (separadas por comas)**. Ver [Configurar](/docs/es/agents/configure/).
5. Las llamadas peligrosas siguen pasando por el [gate de seguridad](/docs/es/admin/security-privacy/) al ejecutarse — una fila del catálogo no concede permisos.

## Funciones

La cabecera cuenta las **herramientas** y cuántas **requieren aprobación**. Cada tarjeta muestra un id en monoespaciado, una descripción breve, una insignia de categoría, una insignia de riesgo (`green riesgo`, `yellow riesgo` o `red riesgo`) y un escudo ámbar cuando hace falta aprobación.

| Concepto | Significado |
|----------|-------------|
| Nombre de la herramienta | Id estable usado en la configuración del agente y en los logs |
| Descripción | Qué hace la herramienta (se muestra en el catálogo) |
| Categoría | Agrupación del registro: `memory`, `knowledge`, `search`, `documents`, `board`, `shell`, `browser`, `conversation`, `communication`, `research`, `agent`, `custom` (las herramientas de MCP y de conexiones traen las suyas) |
| Nivel de riesgo | **green / yellow / red** — el low / medium / high del gate de seguridad |
| **aprobación requerida** | El ejecutor no ejecuta la llamada hasta que una persona la apruebe |
| Esquema de entrada | JSON Schema de los argumentos; **Mostrar esquema** / **Ocultar esquema** |
| Permisos | CASL en la API más el gate de seguridad en cada llamada. Un modelo solo puede ejecutar una herramienta que se ofreció a su agente: cualquier otro nombre se rechaza (*'&lt;tool&gt;' is not in this agent's toolset*), sin solicitud de aprobación, en todos los proveedores — ver [Configurar — Herramientas](/docs/es/agents/configure/#tools--constraints) |
| Sandbox | Algunas herramientas se ejecutan en entornos restringidos |

Vacío: *Aún no hay herramientas registradas.* La carga (*Cargando herramientas…*) y los errores de carga (*No se pudieron cargar las herramientas: …*) aparecen como texto en la página, no como una pantalla vacía.

Las herramientas respaldadas por MCP se configuran en [Servidores MCP](/docs/es/ai/mcp/), y las credenciales de sistemas externos en [Conexiones](/docs/es/admin/connections/).

<h3 id="tool-execution-log">Registro de ejecución de herramientas</h3>

Cada llamada a una herramienta queda en el registro de ejecución de herramientas: el nombre canónico de la herramienta, su entrada, su salida o texto de error, la duración, y la conversación, el agente y la ejecución supervisada a la que pertenece.

- Las llamadas que ejecuta el ejecutor de EYAS — en proveedores de API, y las herramientas de EYAS que una CLI llama por el puente de EYAS — las registra el ejecutor, una vez cada una.
- Las herramientas que una CLI ejecutó en su propio bucle — Claude Code, Grok CLI y Kimi Code CLI, como su shell o sus lecturas de archivos — también reciben una fila, con el nombre canónico (el `Bash` de Claude Code se registra como `run_command`). EYAS no las ejecutó, así que solo las anota: ya se ejecutaron bajo las comprobaciones de permisos de EYAS para esa CLI.
- Estas filas son la evidencia de herramientas con la que el crítico de completitud mide una ejecución, y alimentan los informes de Autoaprendizaje y de eficiencia — igual en todos los proveedores.
- El registro no es memoria: de él no llega nada a la memoria de EYAS. Si la salida de las herramientas se guarda en memoria lo decide únicamente `memory.l0.captureToolResults` — ver [Memoria](/docs/es/knowledge/memory/).

La columna **Herramientas** de [Observabilidad — Uso](/docs/es/admin/observability/#usage-tab) cuenta las mismas llamadas por traza.

## Campos y controles

<h2 id="catalogue">Filtros del catálogo</h2>

| Control | Significado |
|---------|-------------|
| Búsqueda | *Buscar herramientas…* — coincide con el nombre o la descripción |
| **Todas las categorías** | Limitar a una categoría del registro |
| **Todos los niveles de riesgo** | Limitar a un nivel de riesgo |

<h2 id="built-in-tool-groups">Grupos de herramientas integradas (destacados)</h2>

<h3 id="coding-surface">Superficie de código (independiente del modelo)</h3>

Herramientas de sistema de archivos de primera clase para que **cualquier** modelo (Grok, Claude API, Kimi, local, …) pueda editar código sin depender de las herramientas integradas del SDK de Claude Code:

| Herramienta | Propósito | Riesgo |
|-------------|-----------|--------|
| `read_file` | Leer un archivo de texto (desplazamiento/límite de líneas) | green |
| `write_file` | Crear/sobrescribir un archivo | yellow |
| `edit_file` | Sustitución exacta de texto (edición puntual) | yellow |
| `grep` | Búsqueda de contenido en el workspace | green |
| `glob` | Buscar archivos por patrón | green |
| `git_status` / `git_diff` | Ayudas de revisión de solo lectura | green |
| `run_command` | Ejecución de programas sin shell (aprobación) | red |

Las rutas quedan encerradas en las **carpetas de trabajo** de la conversación (o en el **worktree** del agente) — una conversación sin carpetas propias trabaja en su propio workspace de EYAS. No hay recurso al directorio del proceso de EYAS. Se deniegan las rutas sensibles (`.env`, `master.key`, `.ssh`, …) y también la memoria fuera de EYAS — la memoria de otras herramientas, las bóvedas de Obsidian, la carpeta de datos propia de EYAS y el workspace de otra conversación —, tanto para leer como para escribir ([Seguridad y privacidad — Memoria fuera de EYAS](/docs/es/admin/security-privacy/#memory-outside-eyas)). Una carpeta que expondría memoria o credenciales no se puede guardar como carpeta de trabajo ([Conversaciones — Carpetas](/docs/es/daily/conversations/#working-folders)). En una carpeta que solo contiene uno de esos sitios — un repositorio con el `data/` de EYAS, `~/Documents` con una bóveda dentro —, `grep` y `glob` nunca entran en las subcarpetas protegidas (la carpeta de datos de EYAS, una bóveda de Obsidian anidada, la memoria de otra herramienta, un home de CLI, el workspace de otra conversación), así que una búsqueda nunca devuelve resultados de ellas. Un symlink dentro de la carpeta de trabajo que apunta fuera de ella se rechaza, también cuando su destino aún no existe (vale para las rutas de `read_file`, `write_file`, `edit_file` y `browser_upload`). Prefiere `edit_file` a reescribir archivos enteros.

**git de solo lectura sin clic.** Si el agente llama a `run_command` (o a un `Bash` de CLI) con una lista de argumentos que es inequívocamente `git status` o `git diff` — sin metacaracteres de shell, sin `-C` / `--git-dir` / `--no-index`, sin ruta absoluta —, el gate de seguridad la remapea a `git_status` / `git_diff` y **la permite**. No recibes ninguna solicitud de aprobación. `git commit`, `git add`, `ls` y cualquier comando con metacaracteres siguen en rojo o se rechazan. Las herramientas propias `git_status` / `git_diff` son verdes.

**Verify before done:** configura `agent.verifyCommands` en YAML (p. ej. `bun test`) para lanzar comprobaciones deterministas tras una ejecución; los fallos vuelven a abrir el agente con el resumen del error.

**Hooks:** cada llamada pasa por los hooks PreToolUse / PostToolUse del ToolExecutor (universales, no solo de Claude). Las herramientas integradas de Claude Code pasan además la comprobación de la política de memoria de EYAS antes de ejecutarse.

**Los modelos CLI usan sus propias herramientas de archivo.** A Claude Code, Grok y Kimi no se les ofrece esta superficie de código (`run_command`, `read_file`, `write_file`, `edit_file`, `grep`, `glob`, `git_status`, `git_diff`) por el puente de EYAS, porque tienen las suyas: las ejecutan en las carpetas del turno, bajo el gate de seguridad, la política de rutas de memoria y — para el shell de Claude Code y las herramientas de Grok — el [sandbox de archivos del kernel](/docs/es/ai/providers/#kernel-file-sandbox). Todas las demás herramientas de EYAS les llegan.

<h3 id="search-grounding">Búsqueda y grounding</h3>

| Herramienta | Propósito |
|-------------|-----------|
| `list_search_sources` | Listar las fuentes (etiqueta, versión, edición, familia, rutas, estado) antes de inventar datos |
| `get_search_context` | Mostrar qué fuentes están fijadas para esta conversación |
| `set_search_context` | Fijar o quitar fuentes (`sourceIds`, `labels`, `version`, `edition`, o `clear: true`) |
| `search_indexed` | Búsqueda híbrida FTS + vectorial con **citas**; respeta la fijación de la conversación/proyecto; `sourceIds` / `labels` / `version` / `edition` opcionales |

Cuando hay varias fuentes **odoo-family** listas y nada fijado, las herramientas devuelven **`needsPin`** en vez de mezclar versiones. Ver [Búsqueda — fijación multiversión](/docs/es/daily/search/#pin-multi-versión).

<h3 id="memory">Memoria</h3>

| Herramienta | Propósito |
|-------------|-----------|
| `memory_search` | Busca en la memoria de EYAS — resúmenes, hechos, notas del vault, transcripciones importadas —, nunca en la de la CLI del host. De solo lectura y fijada por EYAS al proyecto de la conversación, su tipo y la memoria global; un argumento `scope` o de proyecto se ignora. Devuelve ids que se abren con `memory_expand`. |
| `memory_expand` | Abre un resultado por id (`vt:`, `gs:`, `en:`, … — de `memory_search` o de una línea de memoria permanente), dentro del mismo bloqueo de proyecto |
| `search_memory` | Alias de `memory_search`, con el mismo bloqueo de proyecto |
| `save_memory` | Retirada — no escribe nada. EYAS graba la memoria automáticamente; los agentes nunca escriben memoria por sí mismos |

`memory_search` y `memory_expand` están siempre disponibles, diga lo que diga la lista **Tools** de un agente, y son las únicas herramientas de memoria que recibe un modelo en cualquier host — proveedores de API, Claude Code, Grok, Kimi, y OpenCode dentro de una tarea `opencode_run`. Las tres herramientas de búsqueda/apertura comparten un presupuesto de **3 llamadas por respuesta** en todos los proveedores. Quien llama fuera de una conversación de EYAS — un cliente MCP externo, o una sesión de OpenCode que EYAS no inició para una tarea — solo lee la memoria global, 3 llamadas cada 90 segundos. `memory_block_read` y `memory_block_write` están retiradas: lo que se guardaba en bloques se copió una vez a la memoria de EYAS y se encuentra con `memory_search`; un agente cuya lista aún las nombra simplemente ya no las recibe. Los resultados de las herramientas de memoria los enmascara la política de privacidad en todos los transportes (proveedores de API, los puentes de las CLI, clientes MCP externos, OpenCode). Ver [Memoria](/docs/es/knowledge/memory/).

<h3 id="browser">Navegador</h3>

Playwright headless (`browser_*`) usa el mismo Chromium que la cadena de impresión de diseños. Prefiere los índices numerados de `browser_snapshot` al CSS. Los índices y el `snapshotId` mueren al navegar o volver atrás — haz un snapshot nuevo. Las cookies persisten en un perfil **propio de EYAS** (`data/browser/profile`, o `EYAS_BROWSER_USER_DATA_DIR`) — nunca en el perfil diario de Chrome (Chrome 136+ bloquea CDP en el perfil Default). Las descargas van a [Documentos](/docs/es/knowledge/documents/).

| Herramienta | Propósito |
|-------------|-----------|
| `browser_navigate` | Abrir una URL; la protección **SSRF** bloquea hosts privados/de metadatos |
| `browser_snapshot` | Árbol de accesibilidad + lista interactiva numerada + `snapshotId` |
| `browser_click` / `browser_fill` / `browser_hover` / `browser_select` | Actuar por índice o CSS |
| `browser_tabs` | `list` / `open` / `switch` / `close` (no se puede cerrar la última pestaña) |
| `browser_back` / `browser_wait` | Atrás en el historial; esperar a un selector, URL, carga o tiempo |
| `browser_dialog` | Preparar aceptar/descartar para el próximo `alert`/`confirm`/`prompt` |
| `browser_upload` | Campo de archivo — rutas del workspace o ids de Documentos |
| `browser_evaluate` | JavaScript **en la página** (no Node); resultado JSON limitado |
| `browser_download` | Próxima descarga → Documentos, vinculada a la conversación |
| `browser_storage` | Guardar/cargar el `storageState` de Playwright (cookies + orígenes) |
| `browser_replay` / `browser_action_cache` | Reproducir un locator guardado (sin LLM). JSON en el proyecto o el vault. Nunca valores rellenados |
| `browser_totp` | TOTP desde Secretos / Llavero de macOS → `browser_fill`. Amarillo. La semilla nunca se devuelve |
| `browser_screenshot` / `browser_get_content` / `browser_close` | Captura, texto, terminar el proceso (el perfil queda en disco) |
| `agent_browser_status` / `agent_browser_run` | Sidecar agent-browser recomendado (referencias `@e1`, Apache-2.0) — [Browser Use](/docs/es/automation/browser-use/) |
| `browser_use_status` / `browser_use_exec` | Sidecar CLI de Python heredado ([Browser Use](/docs/es/automation/browser-use/)) |
| `opencode_status` / `opencode_run` | Sidecar opcional del motor de código OpenCode ([OpenCode](/docs/es/automation/opencode/)). Status es verde; run es rojo + aprobación. `opencode_run` solo se ejecuta dentro de una conversación. Dentro de la tarea, OpenCode puede leer la memoria de EYAS con los mismos `memory_search` / `memory_expand` de solo lectura, fijados al proyecto de la conversación y compartiendo el presupuesto de 3 llamadas del turno que lo llamó; no puede escribir memoria de EYAS. |

Las herramientas de navegador de EYAS, `agent_browser_*`, `browser_use_*` y `opencode_*` también llegan a los modelos CLI (Claude Code, Grok, Kimi) por el puente de EYAS, con el mismo gate, las mismas aprobaciones y el mismo ámbito de herramientas que en los modelos de API.

<h3 id="studio">Studio (módulo opcional)</h3>

Motores locales, no Media. Ver [Studio](/docs/es/studio/).

| Herramienta | Propósito |
|-------------|-----------|
| `hyperframes_*` | Composición HTML → MP4 determinista ([Hyperframes](/docs/es/studio/hyperframes/)) |
| `videouse_*` | Metraje + EDL → MP4 ([Video Use](/docs/es/studio/videouse/)) |

El pulido de capturas de pantalla no es una herramienta de Studio. Recordly es un complemento AGPL en [Extensiones](/docs/es/admin/extensions/#recordly) — no hay herramientas `recordly_*`.

<h3 id="email">Correo (borrador → aprobación → envío)</h3>

| Herramienta | Propósito |
|-------------|-----------|
| `email_create_draft` | Crear un borrador local |
| `email_approve_draft` | Marcar el borrador como aprobado |
| `email_send_draft` | Enviar **solo** si está aprobado |

<h3 id="odoo">Odoo (módulo opcional)</h3>

**Instancia en vivo** (JSON-RPC):

| Herramienta | Propósito |
|-------------|-----------|
| `odoo_search_tasks` | Buscar tickets/tareas (sobre todo lectura) |
| `odoo_get_task` | Obtener una tarea |
| `odoo_message_post` | Publicar un mensaje en el chatter |
| `odoo_write_task` | Escritura controlada |

**Índice de código local** (cadena de programación):

| Herramienta | Propósito |
|-------------|-----------|
| `odoo_search_model` | Buscar `_name` / `_inherit` en el Python local |
| `odoo_search_field` | Buscar asignaciones `fields.*` |
| `odoo_search_xml_id` | Buscar ids de registros XML |

Las raíces se resuelven desde: **fijación** de conversación/proyecto → Fuentes de búsqueda (`family: odoo`) → `EYAS_ODOO_SOURCES_JSON` / `EYAS_ODOO_SOURCE_PATHS`. Filtros opcionales de la herramienta: `label`, `labels`, `sourceIds`, `version`, `edition`. Citas: `[source:odoo-src:label:file:line]`.

Skill: `coding/odoo/odoo-dev-chain`. Credenciales en vivo mediante [Conexiones](/docs/es/admin/connections/) (tipo Odoo). Varias versiones en la interfaz: [Búsqueda](/docs/es/daily/search/) · [Proyectos](/docs/es/daily/projects/) · pestaña **Fuentes** de la conversación.

<h3 id="connections-inventory">Inventario de conexiones</h3>

| Herramienta | Propósito |
|-------------|-----------|
| `connections_list` / `connections_catalog` | Inventario + catálogo |
| `connections_test` | Comprobación de estado |
| `connections_propose` | Proponer una conexión para aprobación humana |

<h3 id="media">Media (módulo opcional)</h3>

Conecta Magnific, Higgsfield, fal o HeyGen en [Media](/docs/es/ai/media/). Los agentes reciben cinco herramientas compartidas, no una por modelo del proveedor. Vídeo de presentador / talking head: fija `provider: heygen`.

| Herramienta | Propósito | Riesgo |
|-------------|-----------|--------|
| `media_generate` | Iniciar imagen / vídeo / audio / escalado / edición / 3D | yellow |
| `media_wait` | Consultar hasta que el trabajo termine | yellow |
| `media_catalog` | Listar modelos de un tipo | green |
| `media_balance` | Créditos restantes | green |
| `media_history` | Trabajos recientes | green |

Los archivos terminados entran en [Documentos](/docs/es/knowledge/documents/) y se adjuntan al turno que los produjo.

<h3 id="other-groups">Otros grupos registrados</h3>

Aparecen en el catálogo cuando su módulo está activado: herramientas de **board**, de **conversation**, de **document**, de **knowledge**, de **research**, de **schedule**, **channel** enviar/listar, **A2A delegate** y, opcionalmente, **Google Docs**.

Enrutado de agentes (lo registra el módulo agent, no se duplica en este catálogo):

| Herramienta | Propósito | Riesgo |
|-------------|-----------|--------|
| `run_specialist` | Lanza un especialista activo y espera el resumen. Alias: `delegate_to_agent`. La única forma de ejecutar especialistas en todos los proveedores — no se ofrece la herramienta de subagentes propia de Claude Code. | green |
| `handoff_to_colleague` | Abre el hilo de inicio de otro colega y arranca allí una ejecución de inmediato, con el encargo como objetivo; se rechaza mientras ese hilo esté ocupado. | green |
| `assign_task` | Tarjeta asíncrona del tablero para un agente activo. | green |
| `propose_team` | Tarjeta si faltan roles, el trabajo es épico o se pide un equipo expresamente. | yellow |
| `propose_agent_creation` | Propone una plantilla de especialista nueva. | yellow |

Ver [Equipos y delegación](/docs/es/agents/teams/).

<h3 id="cli-mcp-parity">Paridad CLI MCP</h3>

Cuando los agentes corren en **Grok CLI** o **Kimi Code CLI**, EYAS inyecta un puente MCP stdio para que esos hosts compartan las mismas herramientas de ToolExecutor que las sesiones in-process / Claude Code — incluidas las de memoria. Cada turno tiene su propio secreto, ligado en el servidor a esa conversación, agente, proyecto, carpetas y ámbito de herramientas, y las llamadas puenteadas siguen pasando por el gate de seguridad. En ambos puentes — el servidor MCP in-process de EYAS de Claude Code y el puente de Grok/Kimi —, una CLI recibe exactamente la lista **Tools** del agente más `memory_search` / `memory_expand` (todas las herramientas si la lista está vacía), ninguna herramienta de delegación en una conversación Solo y no las herramientas para las que está concedido el equivalente propio de la CLI (`read_file`, `grep`, `glob` siempre; `write_file`, `edit_file` mientras la lista conceda la escritura; `run_command`, `git_status`, `git_diff` mientras conceda el shell). La misma lista también limita las herramientas propias de escritura, shell y web de la CLI (ver [Agentes — Herramientas](/docs/es/agents/configure/#tools--constraints)). Una llamada a cualquier otra herramienta se rechaza y aparece como **Denegado**. EYAS prueba el puente en cada arranque y registra un aviso cuando Grok/Kimi no alcanzan las herramientas de EYAS. Cada host nombra las herramientas a su manera (Grok: `use_tool` con `eyas__<nombre>`). Ver [MCP](/docs/es/ai/mcp/#cli-mcp-tool-parity-grok--kimi).

## Relacionado

- [Agentes — configurar herramientas](/docs/es/agents/configure/)
- [Equipos y delegación](/docs/es/agents/teams/)
- [Gate de seguridad](/docs/es/admin/security-privacy/)
- [Conexiones](/docs/es/admin/connections/)
- [Skills](/docs/es/automation/skills/)
- [Servidores MCP](/docs/es/ai/mcp/)
- [OpenCode](/docs/es/automation/opencode/)
- [Media](/docs/es/ai/media/)
- [Studio](/docs/es/studio/)
- [Browser Use](/docs/es/automation/browser-use/)
- [Extensiones](/docs/es/admin/extensions/#recordly)
