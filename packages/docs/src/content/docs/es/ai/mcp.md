---
title: Servidores MCP
description: Model Context Protocol — servidores activos, instalación desde el catálogo, bloqueo de almacenes de memoria y paridad de herramientas de las CLI.
---

**Para qué sirve.** MCP (Model Context Protocol) es la forma en que EYAS conecta cajas de herramientas *externas*: un servidor de sistema de archivos, un MCP de un SaaS, un proceso `npx` local. Las herramientas que se descubren aquí se pueden asignar como las integradas. No es un [canal](/docs/es/communication/channels/) de chat ni una fila del inventario de [Conexiones](/docs/es/admin/connections/) — aunque también puedes registrar un servidor MCP como Conexión para seguir su estado.

**Ruta:** `/mcp-settings` (barra lateral **Servidores MCP**). Título: **Servidores MCP**. Subtítulo: *Amplía EYAS con herramientas, recursos y prompts externos mediante el Model Context Protocol.* Pestañas: **Activos** · **Catálogo**.

## Cuándo usarlo

- Un agente necesita herramientas que EYAS no trae (un MCP de un proveedor, un servidor local de sistema de archivos).
- Un agente de Grok o Kimi no alcanza las herramientas de EYAS y necesitas el resultado de la autoprueba del puente.
- Quieres instalar desde el catálogo con un clic (clave API) en vez de escribir un comando.
- Las sesiones de Grok/Kimi CLI deben ver las mismas herramientas de ToolExecutor que los agentes in-process.
- Un servidor está desconectado y necesitas **Probar** / el número de herramientas descubiertas.
- Un servidor muestra **Bloqueado: almacén de memoria**, o se rechazó una instalación porque guardaría memoria fuera de EYAS.

## Flujo típico

1. Abre **Servidores MCP** (`/mcp-settings`).
2. Explora el **Catálogo** y filtra por categoría. Secciones: **Listo para usar** / **Instalación con un clic (requiere clave API)** / **Terceros (configuración manual)** / **No disponible — memoria fuera de EYAS**.
3. **Instalar** (rellena las claves si te las pide y pulsa **Instalar y conectar**) o **Manual** → **Añadir servidor MCP** (nombre, transporte, comando o URL).
4. En **Activos**, confirma que el servidor está conectado, ejecuta **Probar** y revisa las herramientas / recursos / prompts descubiertos.
5. Asigna esos ids de herramienta en la pestaña **Configuración** del agente. Ver [Herramientas](/docs/es/automation/tools/).

## Funciones

La cabecera muestra **N/M conectados**. Las entradas del catálogo llevan una insignia de **licencia** (compatible con MIT / copyleft / propietaria / desconocida) — las copyleft y las propietarias siguen ejecutándose como **proceso independiente**; EYAS sigue siendo MIT.

También puedes registrar un servidor MCP como fila del inventario de [Conexiones](/docs/es/admin/connections/) (tipo **MCP server**) para seguir su estado junto a Odoo, GitHub, etc.

Magnific, Higgsfield, fal y HeyGen se conectan en [Media](/docs/es/ai/media/); el agente usa cinco herramientas `media_*` en lugar de sus catálogos MCP en bruto.

**Agent Browser** (Vercel, Apache-2.0) es una fila de catálogo de Browser: `agent-browser mcp --tools core,state`. Instala antes la CLI (`EYAS_AGENT_BROWSER_BIN` o PATH). Nunca `--tools all` (incluye `chat`). Ver [Browser Use](/docs/es/automation/browser-use/).

**Chrome DevTools MCP** (Google, Apache-2.0) es una fila de catálogo de **DevTools**: `npx -y chrome-devtools-mcp@latest --isolated` con la telemetría desactivada y `--categoryExperimentalWebmcp=true`. Solo para programación/depuración (consola, red, Lighthouse, WebMCP) — **no** para rellenar formularios. Las herramientas llegan como `mcp_chrome-devtools_*`. Las herramientas WebMCP (`list_webmcp_tools` / `execute_webmcp_tool`) solo aparecen si el sidecar las anuncia; si no, no se inventan. `--autoConnect` y el perfil diario de Chrome se rechazan. Ver [Browser Use](/docs/es/automation/browser-use/#chrome-devtools-mcp).

## Campos y controles

<h2 id="active">Servidores activos</h2>

Cada tarjeta de servidor muestra el nombre, un punto de estado, el transporte, el comando o la URL, e insignias:

| Control | Significado |
|---------|-------------|
| **desactivado** | El servidor existe pero no está activado |
| **Bloqueado: almacén de memoria** | El servidor guarda memoria fuera de EYAS o apunta a una carpeta protegida. Nunca se inicia y sus herramientas no llegan a ningún modelo; **Probar** y **Actualizar** están desactivados, **Editar** y **Eliminar** siguen funcionando — ver [abajo](#memory-store-servers-are-blocked) |
| **OAuth** / **Clave API** | Cómo se autentica el servidor (sin insignia si no necesita nada) |
| **Conectar con OAuth** | Servidores OAuth: inicia el inicio de sesión en el navegador (`POST …/oauth/start` → redirección). Magnific y Higgsfield muestran **Conectar con Magnific / Higgsfield (OAuth)** |
| **Gestionado en Ajustes → Media** | Aparece cuando el servidor pertenece a Media (`ownedBy` es `media`) |
| **N herramientas / N recursos / N prompts** | Catálogo descubierto |
| **Probar** → **Conexión correcta / La prueba falló** | Comprobar la conexión; el resultado de la última prueba |
| **Actualizar** | Volver a descubrir las herramientas del servidor |
| **Editar** / **Eliminar** | Cambiar el comando, la URL o la clave API; quitar el servidor |

<h2 id="add-server">Diálogo de añadir / editar</h2>

**Manual** abre **Añadir servidor MCP** (**Editar servidor MCP** para uno existente):

| Campo | Significado |
|-------|-------------|
| **Nombre** | Id visible |
| **Transporte** | **stdio (proceso local)** · **HTTP (remoto)** · **SSE (HTTP en streaming)** — el transporte `sse` es Streamable HTTP; **no** añadas `/sse`. EYAS gestiona la cabecera de sesión. |
| **Comando** / **Argumentos** | Solo stdio: el proceso (`npx`) y sus argumentos separados por espacios |
| **URL** | Solo HTTP / SSE: el endpoint (sin sufijo `/sse`) |
| **Clave API (opcional)** | Solo HTTP / SSE: se envía como token Bearer |

Los servidores que inician sesión con OAuth vienen del catálogo o de Media; el diálogo no tiene opción de OAuth.

<h2 id="catalog">Catálogo</h2>

| Control | Significado |
|---------|-------------|
| Filtro de categoría | **Todos (N)** más una por categoría |
| **Instalar / Instalado** | Con un clic, o ya presente |
| **Guía de configuración** / **Ocultar guía de configuración** | Desplegar las instrucciones del proveedor |
| Diálogo de claves | Claves necesarias antes de **Instalar y conectar** |
| Aviso de licencia | *Con licencia … Se ejecuta como proceso independiente: EYAS sigue siendo MIT.* |

Lista de activos vacía: *No hay servidores MCP configurados* — **Explorar catálogo**.

<h3 id="memory-store-servers-are-blocked">Los servidores de almacén de memoria están bloqueados</h3>

Un servidor MCP que guarda una segunda memoria fuera de EYAS se convertiría en una fuente viva de lectura/escritura para todos los modelos. Esos servidores están bloqueados para todos los modelos — proveedores de API, Claude Code, Grok CLI y Kimi CLI por igual. EYAS solo lee y escribe memoria a través de sus propios almacenes; la forma de traer otra memoria es una importación unidireccional (**Ajustes → Sistema → Portabilidad de datos → Importar datos**, ver [Importación de datos](/docs/es/admin/data-port/)).

Qué cuenta como almacén de memoria:

- Las entradas del catálogo **Memory** (servidor de grafo de conocimiento), **Qdrant** y **Obsidian**. Aparecen en **No disponible — memoria fuera de EYAS**, con **Instalar** desactivado, una explicación breve y un botón **Ir a Portabilidad de datos**.
- Un servidor añadido a mano cuyo comando o argumentos nombran un paquete o binario de memoria conocido: el servidor de memoria de referencia de MCP (`@modelcontextprotocol/server-memory`, `mcp-server-memory`), MCPVault (`@bitbonsai/mcpvault`, `mcpvault`), los servidores MCP de Obsidian (`mcp-obsidian`, `obsidian-mcp`, `obsidian-mcp-server`), Basic Memory, Mem0/OpenMemory y los paquetes de las entradas marcadas del catálogo (por ejemplo `mcp-server-qdrant`). El sufijo de versión no importa. Solo se comparan nombres de paquete y de binario, nunca el nombre visible, así que un servidor que simplemente se *llama* «memory» se instala con normalidad.
- Un servidor cuyo argumento, valor de `--flag=value`, valor de variable de entorno, ruta del comando o URL `file://` apunta a una carpeta protegida: la memoria o el estado de otra herramienta (`~/.claude`, `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, `~/.codeium`, las carpetas de OpenCode, carpetas `ai-memory`, una bóveda de Obsidian, entradas de `security.foreignMemoryPaths`), la carpeta de datos propia de EYAS (vault, base de datos, claves — los workspaces de las conversaciones siguen permitidos) o los homes de CLI propios de EYAS. Un servidor Filesystem que apunta a una bóveda de Obsidian o a `data/vault` queda bloqueado; uno que apunta a una carpeta de proyecto normal está bien. Los servidores que EYAS ejecuta desde `data/mcp-servers/` — la carpeta en la que los clona `config/mcp.yaml` — son código de servidor, no memoria, y están permitidos (se juzga su ruta real, así que un enlace desde ahí al vault sigue bloqueado).

**Qué pasa.** Instalar desde el catálogo, añadir a mano o editar un servidor hasta dejarlo en una configuración así se rechaza, con un mensaje traducido, y no se guarda nada. Los servidores configurados antes de que existiera el bloqueo no se borran: al arrancar se marcan como **Bloqueado**, nunca se inician y ninguna de sus herramientas `mcp_*` llega a ningún modelo. La pestaña **Activos** muestra una insignia **Bloqueado: almacén de memoria** con el motivo y un enlace a la importación de datos. Si la política deja de marcar un servidor (por ejemplo, se quitó una carpeta de `security.foreignMemoryPaths`), sale del estado Bloqueado en el siguiente arranque. Las entradas de `config/mcp.yaml` que son almacenes de memoria se omiten con un error en el log.

**Migración.** Las instalaciones existentes pierden un servidor Memory, Qdrant, Obsidian o MCPVault que antes funcionaba, y cualquier servidor que apunte a un vault o a la memoria de otra herramienta. Es intencionado: copia esa memoria a EYAS una vez con la importación de datos.

**API (integradores).** `GET /api/v1/mcp/servers` incluye `blocked: 'memory_store' | null` por servidor (estado `blocked`). `POST /api/v1/mcp/servers`, `PUT /api/v1/mcp/servers/:id`, `POST /api/v1/mcp/registry/:id/install` y `POST /api/v1/mcp/servers/:id/refresh` responden `409 {error, code: 'memory_store_blocked'}`; `POST /api/v1/mcp/servers/:id/test` devuelve `{ok: false, code: 'memory_store_blocked'}`. Las entradas del catálogo llevan `memoryStore: true`.

---

<h2 id="cli-mcp-tool-parity-grok--kimi">Paridad de herramientas MCP de las CLI (Grok / Kimi)</h2>

Los proveedores de API e in-process ya comparten las herramientas de EYAS. Para los proveedores **CLI del host**:

| Proveedor | Comportamiento |
|-----------|----------------|
| **Claude Code** | Servidor MCP in-process llamado `eyas`, invocado como `mcp__eyas__<name>`. No pasa por el puente stdio de abajo, así que no depende de su autoprueba al arrancar. Es el único servidor MCP que carga Claude Code. |
| **Grok CLI / Kimi Code CLI** | Servidor MCP stdio + puente de loopback (`/api/v1/internal/cli-mcp/tools/list` y `/tools/call`) con un secreto por turno; `session/new` de ACP recibe `mcpServers` para que la CLI pueda llamar a las mismas herramientas de ToolExecutor. Es el único servidor MCP al que pueden conectarse: no se cargan los servidores MCP del host ni del proyecto (ver [Proveedores](/docs/es/ai/providers/#grok-cli-and-kimi-code-cli)). |

OpenCode no es aquí un host MCP: dentro de una tarea `opencode_run` recibe `memory_search` / `memory_expand` del plugin de memoria de EYAS (ver [abajo](#tool-names-per-host) y [OpenCode](/docs/es/automation/opencode/)).

**Qué herramientas de EYAS recibe una CLI.** Una sola regla para ambos puentes: todas las herramientas de EYAS del ámbito del agente — su lista **Tools** más `memory_search` y `memory_expand` (una lista vacía significa todas), sin `run_specialist`, `delegate_to_agent`, `handoff_to_colleague` ni `propose_team` en una conversación **Solo** — **salvo** aquellas para las que la CLI tiene un equivalente propio concedido: `read_file`, `grep` y `glob` (las herramientas de lectura de la CLI siempre están concedidas), `write_file` y `edit_file` mientras la lista del agente conceda la escritura, y `run_command`, `git_status` y `git_diff` mientras conceda el shell. Para esas, la CLI usa su propio shell y sus herramientas de archivo en las carpetas del turno, bajo el [sandbox de archivos del kernel](/docs/es/ai/providers/#kernel-file-sandbox) y la política de rutas de memoria. Una herramienta de EYAS cuyo equivalente en la CLI no está concedido se ofrece por el puente en su lugar — `git_status` y `git_diff` en una lista sin `run_command`. La lista **Tools** del agente también limita las herramientas propias de escritura, shell y web de la CLI (ver [Agentes — Herramientas](/docs/es/agents/configure/#tools--constraints)). Los modelos CLI también reciben las herramientas de navegador de EYAS (`browser_*`, incluidas las sesiones guardadas y `browser_totp`), `agent_browser_*`, `browser_use_*` y `opencode_*`. Se ejecutan en EYAS con el mismo gate de seguridad, las mismas aprobaciones, permisos y ámbito de herramientas que en los modelos de API. Para Grok y Kimi, el vínculo por turno guarda el ámbito de herramientas en el servidor: `tools/list` muestra exactamente las herramientas permitidas, `tools/call` rechaza cualquier otra — antes de preguntar al gate de seguridad, así que nunca crea una aprobación — y el rechazo aparece en la fila de herramienta del turno como **Denegado**. La lista de herramientas del prompt de sistema de un modelo CLI no nombra las herramientas de EYAS a las que sustituyen las herramientas propias concedidas de la CLI.

Resultado: las CLI de programación y la ruta web del agente ven **una misma superficie de herramientas** en vez de inventar integraciones paralelas. En Claude Code, cada llamada puenteada lleva la conversación, su proyecto, la respuesta (turno) y la ejecución, así que la consulta de memoria es de **3 llamadas por respuesta**, como en los demás proveedores, los resultados de memoria siguen fijados al proyecto de la conversación, su tipo y la memoria global, y las ejecuciones de herramientas se atribuyen a la ejecución supervisada. Una petición hecha fuera de una conversación no se atribuye a un id de conversación vacío. Los agentes de Grok y Kimi alcanzan `memory_search` / `memory_expand`, el tablero, los documentos, la búsqueda y el resto de herramientas de EYAS. El ayudante también le dice al modelo que la memoria de EYAS es la única memoria y que `memory_search` / `memory_expand` vienen de este servidor.

<h3 id="how-the-bridge-is-secured">Cómo se protege el puente</h3>

- Cada turno de respuesta recibe su propio secreto aleatorio (192 bits).
- EYAS registra en el servidor a qué conversación, agente, proyecto, turno y ejecución pertenece el secreto, si el turno es atendido (un chat interactivo o una conversación de canal) o autónomo (una ejecución en segundo plano; un turno no marcado como atendido cuenta como autónomo), y la lista de llamadas ya ejecutadas de una ejecución reanudada. El proceso ayudante solo presenta el secreto; nada de lo que envía puede hacer que una llamada actúe por otra conversación, proyecto o usuario.
- El secreto se revoca en cuanto termina el turno (completado, fallido, detenido o abandonado) y caduca 2 horas después de su último uso, así que un turno largo y activo conserva sus herramientas de EYAS.
- Una petición que llega visiblemente a través de un proxy desde una dirección no local se rechaza, aunque traiga un secreto válido.
- Las llamadas puenteadas pasan por la misma decisión que las llamadas a herramientas de Claude Code y el propio bucle de herramientas de los proveedores de API: primero la comprobación del conjunto de herramientas (una herramienta fuera de la lista del agente se rechaza como **Denegado** antes del gate, así que nunca pone una aprobación en cola), luego el [gate de seguridad](/docs/es/admin/security-privacy/) de EYAS y, en los turnos autónomos, la escala de autonomía; las comprobaciones de permisos se hacen como el agente. En un chat atendido o una conversación de canal, una llamada que el gate permite se ejecuta — una herramienta marcada como que requiere aprobación ya no espera en la cola solo porque el modelo sea Grok o Kimi —, y una llamada que el gate escala muestra una tarjeta de aprobación sin pausar el chat. En una ejecución autónoma, una llamada en **Aviso** o **Aprobar** espera aprobación, y una llamada escalada siempre espera a una persona, incluso en **Auto** (antes se ejecutaba sin preguntar en Grok y Kimi). Sin un gate de seguridad en marcha, se rechaza cada llamada puenteada. El puente conoce en el servidor las carpetas del turno — todas las de la conversación, no solo la primera —, así que las herramientas de archivo de EYAS funcionan en ellas, y una petición nunca puede nombrar carpetas propias.
- Cuando una herramienta de EYAS puenteada se rechaza o espera una aprobación, el resultado vuelve a la misma fila de herramienta de la conversación, con la entrada de la aprobación en la cola de Aprobaciones. En una ejecución autónoma supervisada, esa aprobación pausa la ejecución (**Esperando aprobación**) cuando termina el turno de la CLI, igual que una aprobación de las herramientas propias de la CLI; una vez aprobada, la ejecución continúa y se permite exactamente la llamada aprobada una vez.
- Una ejecución reanudada o reintentada que repite una llamada a herramienta de EYAS que la ejecución original ya completó se rechaza antes de ejecutarse, y la fila muestra **Omitido** — *already executed on the original run — duplicate side effect prevented*. La misma herramienta con otros argumentos sigue ejecutándose. En Grok, la fila de una herramienta de EYAS registra los argumentos que recibió la herramienta (el `tool_input` de `use_tool`), no el envoltorio de Grok, así que la ejecución reanudada reconoce la repetición. Demostrado en el Grok CLI instalado con la comprobación de publicación; cómo informa de estas llamadas un binario real de Kimi aún no se ha verificado en un equipo.
- Los resultados de las herramientas de memoria (`memory_search`, `search_memory`, `memory_expand`, `search_knowledge`, `get_page`, `read_team_memory`), incluidos sus textos de error, los enmascara la política de privacidad antes de que la CLI los reciba, igual que la memoria del prompt: el proveedor de la CLI siempre cuenta como remoto y nada de lo que envía el ayudante lo cambia. El mismo enmascaramiento se aplica a las herramientas de EYAS in-process de Claude Code. Si el análisis falla, el resultado se retiene (*Error: memory tool result withheld (privacy scan failed)*). Los resultados de las demás herramientas pasan sin cambios. Ver [Dónde se aplica el enmascaramiento](/docs/es/admin/security-privacy/#where-masking-applies).
- Exactamente dos rutas internas se saltan el inicio de sesión web: `/api/v1/internal/cli-mcp/tools/list` y `/api/v1/internal/cli-mcp/tools/call`. Todas las demás rutas internas siguen exigiendo sesión.

El ayudante se ejecuta con el mismo runtime que EYAS (Bun), desde su propia ubicación de instalación, así que también funciona en imágenes Docker; `EYAS_INSTALL_ROOT` no se usa para encontrarlo.

<h3 id="boot-self-test">Autoprueba al arrancar</h3>

Al arrancar, EYAS prueba el puente a través de toda la pila de peticiones, igual que lo llamará el ayudante. El éxito se registra como *CLI tool bridge self-test passed*. El fallo es un aviso — *CLI tool bridge self-test failed — Grok/Kimi turns cannot reach EYAS tools (memory, board, …)* — con el motivo adjunto; el arranque continúa, pero Grok y Kimi corren entonces sin herramientas de EYAS. En una instalación nueva, la prueba se aplaza hasta completar el asistente de configuración (log informativo) y se ejecuta en el siguiente arranque.

| Motivo en el aviso | Qué hacer |
|--------------------|-----------|
| `tools/list returned HTTP 401 … Authentication required` | A la versión en marcha le falta la excepción del puente. Actualiza o recompila y reinicia. |
| `stdio MCP server not found at …` | A la compilación le falta `dist/stdio-mcp-server.js`. Recompila con `bun run build` (las imágenes Docker de esta versión lo incluyen) y reinicia. |
| `HTTP 404` | El módulo Tools está desactivado, así que no hay herramientas de EYAS que ofrecer. |

<h3 id="outside-mcp-clients">Clientes MCP externos</h3>

Los clientes del servidor MCP propio de EYAS (`/api/v1/mcp/tools/call`) no tienen conversación de EYAS. Sus llamadas a herramientas de memoria solo leen la memoria global, con un límite de 3 llamadas cada 90 segundos. Ver [Memoria — Buscar más a fondo](/docs/es/knowledge/memory/#looking-further-memory_search-and-memory_expand).

- **Enmascarados.** Los resultados de herramientas de memoria enviados a un cliente MCP externo los enmascara la política de privacidad como cualquier otro destino remoto — un cliente externo puede usar cualquier modelo, así que siempre cuenta como remoto. Un análisis fallido retiene el resultado.
- **Validados.** Un cuerpo de `tools/call` mal formado recibe HTTP `400` con un error JSON-RPC: `-32600` *Invalid Request* para un cuerpo que no es JSON o no es un objeto, `-32602` *Invalid params* si falta el nombre o `arguments` no es un objeto. Una herramienta desconocida es `404` con `-32601`.

<h2 id="tool-names-per-host">Nombres de herramientas por host</h2>

Las herramientas de EYAS tienen un nombre canónico (`memory_search`, `memory_expand`, …). Cada host de modelo las lista de forma distinta:

| Host | Cómo llama el modelo a `memory_search` |
|------|----------------------------------------|
| Proveedores de API (Anthropic, OpenAI, Gemini, OpenRouter, Kimi API, Ollama, LM Studio, endpoints compatibles) | `memory_search` — EYAS ejecuta la herramienta |
| Claude Code CLI | `mcp__eyas__memory_search` — las herramientas vienen del servidor MCP in-process de EYAS llamado `eyas`, que no pasa por el puente stdio y por eso no depende de su autoprueba al arrancar |
| Grok CLI | Las herramientas de EYAS no están en la lista propia de Grok. El modelo encuentra una con `search_tool` y luego llama a `use_tool` con `tool_name` `eyas__memory_search` y sus argumentos en `tool_input`. Un `memory_search` a secas en Grok es la herramienta de memoria integrada del propio Grok, no la memoria de EYAS, así que EYAS nunca le pide a un modelo de Grok que llame a un `memory_search` a secas. |
| Kimi Code CLI | `memory_search` en el servidor MCP llamado `eyas`. El nombre exacto en Kimi aún no está verificado, así que EYAS nombra el servidor en vez de un nombre de herramienta calificado. |
| OpenCode (en una tarea `opencode_run`) | `memory_search` — una herramienta del plugin de memoria de EYAS dentro de OpenCode, con el nombre, la descripción y los argumentos propios de EYAS. El plugin envía la llamada a EYAS, que ejecuta la herramienta real para la conversación de la tarea. Solo ofrece `memory_search` y `memory_expand`, nada que escriba. |

Cuando EYAS sabe qué proveedor ejecuta un turno, la lista de herramientas del prompt de sistema termina con una línea que le dice al modelo cómo llamar a las herramientas listadas en su host — en Claude Code, que las herramientas de EYAS vienen del servidor MCP de EYAS y se llaman como `mcp__eyas__<name>`. Las pistas de memoria y la línea *N notas más* nombran las herramientas del mismo modo. Los modelos en proveedores de API ven los nombres simples. No hay nada que configurar. Cuando una conversación cambia a un proveedor con otra forma de nombrar las herramientas, el prefijo de prompt en caché cambia una vez (un fallo de caché puntual).

## Relacionado

- [Herramientas](/docs/es/automation/tools/)
- [OpenCode](/docs/es/automation/opencode/)
- [Media](/docs/es/ai/media/)
- [Configurar agentes](/docs/es/agents/configure/)
- [Conexiones](/docs/es/admin/connections/)
- [Proveedores](/docs/es/ai/providers/)
- [Importación de datos](/docs/es/admin/data-port/)
