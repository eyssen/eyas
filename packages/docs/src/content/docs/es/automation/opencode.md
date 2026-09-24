---
title: OpenCode
description: Sidecar opcional del motor de código (MIT) con terminal web en la conversación — aislado en una carpeta propia de EYAS.
---

**Para qué sirve.** OpenCode es un agente de código en terminal (MIT, [opencode.ai](https://opencode.ai)). EYAS **no** importa su núcleo privado ni sus SDK de IA. La vía oficial: servidor HTTP local (`opencode serve` en 127.0.0.1) y un PTY POSIX hacia xterm.js. El chat envía la memoria recordada de EYAS con la tarea; `opencode_run` la ejecuta. Puedes ver o tomar el TUI en la terminal de la conversación. Cada proceso de OpenCode que arranca EYAS corre en una carpeta propia de EYAS, no en tu configuración diaria de OpenCode.

**Ruta:** `/opencode`. Barra lateral: **IA → OpenCode**. En una conversación, el icono de terminal de la barra superior.

## Cuándo usarlo

- Una tarea de código debe correr en el propio bucle de OpenCode, no como un montón de llamadas `write_file` de EYAS.
- Quieres **ver** el TUI o escribir en él.
- OpenCode debe consultar la memoria de EYAS con los mismos `memory_search` / `memory_expand` que cualquier otro modelo — solo lectura, limitado al proyecto de la conversación.
- Las tareas delegadas a OpenCode deben usar un modelo y una variante de razonamiento concretos (tarjeta **Modelo y razonamiento**).

## Flujo típico

1. Abre **OpenCode** (`/opencode`). Si la tarjeta dice **No listo**, instala el CLI (`curl -fsSL https://opencode.ai/install | bash` o `npm i -g opencode-ai`) o define `EYAS_OPENCODE_BIN`.
2. Inicia sesión de OpenCode **para EYAS**: abre una conversación, pulsa el icono de terminal y usa `/connect` en la terminal de OpenCode (ver [Inicio de sesión](#sign-in)).
3. Concede `opencode_status` / `opencode_run` al agente que debe delegar. Funciona con todos los proveedores: los modelos CLI (Claude Code, Grok, Kimi) también llegan a estas herramientas por el puente de EYAS. Si quieres, elige el modelo y la variante de razonamiento en la tarjeta **Modelo y razonamiento**.
4. Pide al colega que llame a `opencode_run` en una conversación. EYAS envía la tarea con su memoria recordada; OpenCode pregunta a EYAS antes de cada llamada a herramienta; la respuesta y los diffs vuelven como resultado de `opencode_run`.

## Funciones

| Pieza | Qué hace |
|-------|----------|
| Doctor | Fail-closed: si faltan el CLI o el PTY, devuelve un remedio, nunca un fallo |
| `opencode_status` | Verde. Listo / no listo + comprobaciones |
| `opencode_run` | Rojo, con aprobación. Solo corre dentro de una conversación. Sesión HTTP contra el sidecar; cada llamada a herramienta dentro de ella pregunta al gate de seguridad de EYAS |
| Terminal web | `@xterm/xterm` sobre `/api/v1/opencode/terminal/:id` (JWT). Al desconectar se mata el PTY |
| Plugin de memoria | `memory_search` / `memory_expand` dentro de OpenCode — los mismos nombres, descripciones y argumentos que en cualquier otra ejecución de EYAS, solo lectura. Nada en OpenCode puede escribir en la memoria de EYAS |
| Aislamiento | Siempre activo: una carpeta propia de EYAS, `<carpeta de datos de EYAS>/cli-homes/opencode` — ver abajo |

### Aislamiento {#isolation}

Cada proceso de OpenCode que arranca EYAS — el servidor en segundo plano para las tareas del chat y la terminal de OpenCode de una conversación — corre en `<carpeta de datos de EYAS>/cli-homes/opencode`. No hay interruptor: el antiguo ajuste de *config aislada* se eliminó, y un valor guardado antes se ignora.

| Área | Qué significa |
|------|---------------|
| **Propio de EYAS** | La config de OpenCode (`config/opencode/opencode.json`, escrita por EYAS, que solo carga el plugin de memoria de EYAS, `config/opencode/eyas/eyas-memory.ts`), los datos (incluido el inicio de sesión, `data/opencode/auth.json`, y las sesiones de OpenCode), el estado y la caché (incluida la caché de npm). El `HOME` de OpenCode es esa misma carpeta. |
| **No se carga** | `~/.claude/CLAUDE.md` del host, las skills de `~/.claude` y el resto de la compatibilidad de OpenCode con Claude Code; `~/.agents` y otras skills externas; el `opencode.json`, la carpeta `.opencode`, `AGENTS.md`, `CLAUDE.md` y `CONTEXT.md` propios del proyecto; los `~/.config/opencode` y `~/.local/share/opencode` de diario; las claves de API de proveedores del entorno del servidor (como `OPENAI_API_KEY`). |
| **Desactivado** | La autoactualización y compartir sesiones. |
| **Shell** | La herramienta de shell propia de OpenCode ve la carpeta de EYAS como su directorio personal, así que tu `~/.gitconfig` y tus claves SSH no le son visibles. |

El servidor en segundo plano escucha en 127.0.0.1 y está protegido con una contraseña aleatoria nueva en cada arranque.

**Dónde vive el plugin de memoria.** El plugin de memoria de EYAS se escribe en `<carpeta de datos de EYAS>/cli-homes/opencode/config/opencode/eyas/eyas-memory.ts`, junto a la carpeta `node_modules` donde OpenCode instala la dependencia `@opencode-ai/plugin` del plugin, y el `opencode.json` gestionado apunta a él. Las versiones anteriores lo escribían en `…/cli-homes/opencode/plugins/eyas-memory.ts`, donde OpenCode 1.18.29 no podía resolver ese import y se saltaba el plugin sin ningún error — el modelo de OpenCode no tenía entonces `memory_search` / `memory_expand`, y el hook de shell del plugin nunca se ejecutaba. EYAS borra la copia antigua en el siguiente arranque. Como antes, el primer arranque de OpenCode necesita acceso al registro de npm para instalar la dependencia del plugin; sin él, OpenCode se ejecuta sin las herramientas de memoria de EYAS.

### Inicio de sesión {#sign-in}

OpenCode inicia sesión él mismo en sus proveedores de modelos; EYAS no pasa claves de API a ese proceso. El inicio de sesión vive ahora en la carpeta de EYAS, así que **los usuarios existentes de OpenCode quedan desconectados una vez**. Abre la terminal de OpenCode de una conversación y usa `/connect`. No uses `opencode auth login` en una terminal propia fuera de EYAS: usa tu entorno normal e iniciaría sesión en tu OpenCode de diario, no en el de EYAS.

### Las tareas sin interfaz preguntan a EYAS {#headless-tasks-ask-eyas}

Las tareas de `opencode_run` preguntan a EYAS antes de cada llamada a herramienta: lecturas y ediciones de archivos, listar y buscar, comandos de shell, fetch y búsqueda web, acceso a carpetas fuera de la carpeta de la tarea, subagentes, LSP y skills.

- EYAS responde a cada petición con su [gate de seguridad](/docs/es/admin/security-privacy/), el mismo que usa con los demás asistentes. Las llamadas permitidas se ejecutan una vez; las denegadas se rechazan.
- Si el gate quiere una decisión humana, la llamada se rechaza y se pone una aprobación en la cola de [Aprobaciones](/docs/es/agents/autonomy/).
- Si el gate de seguridad no está disponible, se rechaza toda petición.
- EYAS solo responde por la tarea que lanzó, incluidos los subagentes que esa tarea arranca. En la terminal de OpenCode apruebas tú las llamadas a herramientas.
- Tras una tarea, EYAS borra la sesión de OpenCode. La respuesta y los diffs quedan en la conversación como resultado de `opencode_run`.

**Carpeta de la tarea.** `opencode_run` solo corre dentro de una conversación y se niega en cualquier otro sitio. La carpeta que nombras debe estar dentro de las carpetas de la conversación o, si no tiene ninguna, dentro de su propio workspace. Sin ella, EYAS usa la primera carpeta de la conversación y, si no, el workspace propio de la conversación — nunca la carpeta de instalación de EYAS. La terminal de OpenCode solo se abre para una conversación tuya: la conversación de otro usuario *no se encuentra*, tampoco para un administrador. Trabaja en las carpetas guardadas de esa conversación, que EYAS lee por sí mismo — la página no puede nombrar otras — y recurre al workspace de la conversación de la misma forma. Sus carpetas pasan la misma comprobación que las de cualquier otra ejecución: una carpeta que es un sitio protegido, está dentro de uno o lo contiene (los datos propios de EYAS, el almacenamiento de otra herramienta de IA, una bóveda de notas o tu carpeta personal) se deja fuera, la terminal se abre en la siguiente carpeta permitida o en el workspace de la conversación, y una línea en la parte superior de la terminal nombra la carpeta que quedó fuera. Lo mismo ocurre con una carpeta guardada que es el workspace de la conversación de otro usuario, está dentro de él o lleva a él (mediante un enlace) — guardada antes de que EYAS rechazara esas carpetas, o heredada de un proyecto; `opencode_run` también la deja fuera y rechaza una carpeta de tarea nombrada ahí. Los workspaces de tus otras conversaciones siguen siendo utilizables.

**No es un sandbox para su propio usuario.** Las carpetas de arriba solo deciden dónde arranca la terminal. Lo que corre en ella corre como el usuario del sistema operativo del servidor de EYAS: un comando que apruebas en la terminal de OpenCode (un comando de shell o el acceso a una carpeta fuera de la carpeta de la tarea) llega a todo lo que llega ese usuario, también a otras carpetas del servidor. Por eso, da el permiso de OpenCode solo a personas a quienes confiarías eso. La shell simple de la API de sesiones (`POST /api/v1/opencode/sessions` con `kind: "shell"`; la página web solo abre la terminal de OpenCode) es solo para el propietario y los administradores — necesita el permiso de gestión de OpenCode; cualquier otro recibe `403` — y arranca con el entorno de la terminal de OpenCode y la carpeta personal propia de EYAS, no con el entorno propio del servidor, así que ni la clave maestra de EYAS ni las claves de API de los proveedores están en ella. Por defecto, el rol user también puede abrir la terminal de OpenCode (el permiso de creación de OpenCode).

### Memoria enviada con una tarea {#memory-sent-with-a-task}

`opencode_run` envía el bloque de memoria recordada de EYAS — el mismo bloque que recibe cualquier otra ejecución — como texto de sistema de la tarea. Se dimensiona como el recall de cualquier otro modelo: `memory.index.budgetChars` (2.400 caracteres por defecto) es el tamaño con una ventana de contexto de 100k tokens, y el bloque crece con la ventana del modelo que ejecuta OpenCode, hasta 2,5× a partir de 250k tokens (6.000 caracteres por defecto); por debajo de unos 29k tokens se reduce, y una ventana muy pequeña no recibe ninguna memoria recordada. EYAS lee la ventana de la propia lista de modelos de OpenCode — el límite de entrada del modelo cuando OpenCode lista uno y, si no, su límite de contexto. Cuando la ventana es desconocida, el bloque es exactamente `memory.index.budgetChars`: no hay ningún modelo elegido en la tarjeta **Modelo y razonamiento** (OpenCode usa entonces su propio modelo predeterminado, que EYAS solo conoce por la respuesta); el modelo elegido no está en la lista de OpenCode o aparece sin límite (por ejemplo un modelo de un proveedor personalizado sin `limit` en su config de OpenCode); o la lista no se puede leer (se registra un aviso y la tarea se ejecuta igualmente). La lista se lee como mucho una vez por tarea, solo cuando hay un modelo elegido, y la petición no lleva nada de la tarea. Antes, las tareas de OpenCode recibían siempre exactamente `memory.index.budgetChars`, así que un modelo de ventana grande recibía menos memoria de la que le daría cualquier otro proveedor. El bloque lleva la misma pista que en cualquier otra ejecución: abrir una línea con `memory_expand`, buscar más con `memory_search`. Solo una tarea en un servidor externo conectado no recibe la pista (ese servidor no tiene herramientas de memoria de EYAS) y en su lugar incluye completas más de las mejores coincidencias. Ver [Memoria — Cómo llega el recall al modelo](/docs/es/knowledge/memory/#how-recall-reaches-the-model).

**Enmascarado antes de salir de EYAS.** OpenCode siempre cuenta como destino remoto, porque puede ejecutar cualquier modelo. El prompt de la tarea y la memoria recordada que se envía como texto de sistema de la tarea los enmascara la política de privacidad antes de que nada llegue a OpenCode, y el título de la sesión de OpenCode sale del prompt enmascarado. Las respuestas de `memory_search` / `memory_expand` dentro de OpenCode también se enmascaran. Si el análisis de privacidad falla, la tarea falla con *privacy scan failed — the task was not sent to OpenCode* y nada llega a OpenCode. Con la política de privacidad (o el módulo de privacidad) desactivada, no se enmascara nada. Ver [Seguridad y privacidad — Dónde se aplica el enmascarado](/docs/es/admin/security-privacy/#where-masking-applies).

### Memoria de EYAS dentro de OpenCode {#eyas-memory-inside-opencode}

El plugin de memoria de EYAS da al modelo de OpenCode exactamente dos herramientas, `memory_search` y `memory_expand`. Tienen los mismos nombres, descripciones y argumentos que en cualquier otra ejecución de EYAS, son de solo lectura y comparten el mismo presupuesto de 3 llamadas a herramientas de memoria por turno. OpenCode no tiene ninguna herramienta que guarde memoria: lo que EYAS recuerda lo decide EYAS, nunca el modelo de OpenCode.

Lo que pueden leer las herramientas depende de quién las llama:

- **Una tarea de `opencode_run`.** EYAS vincula la sesión de OpenCode que crea con la conversación y el usuario que lanzaron la tarea. Las herramientas leen entonces el proyecto de esa conversación, su tipo de proyecto y la memoria global, y comparten el presupuesto de 3 llamadas del turno que llama.
- **En cualquier otro caso** — una terminal de OpenCode que alguien abre en el panel, cualquier sesión que no creó EYAS, o una persona con sesión iniciada que no es el usuario de la sesión — las herramientas leen solo la memoria global.
- **Un servidor externo conectado** (URL de conexión) no tiene ningún acceso a la memoria de EYAS.

**La clave nunca sale de OpenCode ni está en ningún entorno.**

- Cada proceso de OpenCode que arranca EYAS — el servidor en segundo plano y cada terminal de OpenCode — recibe su propia clave en el descriptor de archivo 3, una conexión que solo tiene ese proceso. La clave nunca está en un entorno, una lista de argumentos ni un archivo. Muere cuando ese proceso termina o se reinicia.
- El plugin de EYAS lee la clave una vez, cuando OpenCode lo carga, la guarda en memoria y cierra el descriptor 3, así que nada de lo que OpenCode arranque después — incluidos los comandos de shell del modelo — la hereda. El entorno del proceso solo dice que la clave está en el descriptor 3 (`EYAS_OPENCODE_KEY_FD=3`), y una shell que ejecuta el modelo ve vacías esa variable y `OPENCODE_SERVER_PASSWORD`. `ps eww` o `/proc/<pid>/environ` del proceso de OpenCode no muestran ninguna clave.
- Cada llamada de memoria lleva, en lugar de la clave, una prueba de un solo uso para una sesión de OpenCode: una firma sobre el id de la sesión en la que se ejecuta la herramienta (lo fija OpenCode, no el modelo), un valor aleatorio y la hora. EYAS acepta una prueba una sola vez, durante 2 minutos y solo mientras ese proceso de OpenCode siga en marcha, y sirve la llamada solo para la sesión que nombra la prueba. Un id de sesión que el modelo pase como argumento de la herramienta no se envía a EYAS. Un comando que ejecuta el modelo no tiene ninguna clave, así que no puede hacer una llamada de memoria para ninguna sesión.
- Donde la clave no se puede entregar en el descriptor 3, OpenCode se ejecuta sin las herramientas de memoria de EYAS en lugar de recibir una clave de otra forma.

Cada llamada pasa por el mismo ejecutor de herramientas de EYAS que la llamada de memoria de cualquier otro modelo (gate de seguridad, permisos, presupuesto de consultas, registro de acceso a la memoria, máscara de privacidad).

**Límites que quedan.** OpenCode 1.18.29 lee su contraseña de servidor solo de su entorno. Una shell que ejecuta el modelo la ve vacía, pero cualquier proceso del mismo usuario del sistema que pueda leer el entorno de otro proceso puede leerla y manejar las sesiones de ese servidor de OpenCode a través de la propia API de OpenCode — por ejemplo para leer los mensajes de otra tarea en curso —, y eso incluye un comando que ejecute el modelo. El servidor propio de la terminal tiene su propio puerto y su propia contraseña; nunca recibe la contraseña del servidor en segundo plano, así que un comando en la terminal no la hereda. Ejecutar cada tarea en un servidor propio no cerraría esto, porque cada proceso del mismo usuario del sistema puede leer el entorno de todos los demás; solo lo cerraría un usuario del sistema aparte o un sandbox alrededor de OpenCode. OpenCode no tiene sandbox del kernel. Un proceso autorizado a leer la memoria de otro proceso (un depurador que el sistema permita, o root) todavía puede llegar a la clave.

**Qué registra EYAS.** La salida de las herramientas de OpenCode dentro de una tarea de `opencode_run` y la salida del panel de terminal solo se registran con `memory.l0.captureToolResults` activado (por defecto desactivado), como la salida de cualquier otra herramienta: bajo el proyecto de la conversación, con confianza *ingested*, y nunca se recuerdan literalmente. La salida de la terminal solo se registra para una conversación que existe y pertenece al usuario de la terminal. La respuesta final de OpenCode y los diffs no se guardan aparte: son el resultado de `opencode_run`. Ver [Memoria](/docs/es/knowledge/memory/).

**API (integradores).** `POST /api/v1/opencode/memory/search` y `POST /api/v1/opencode/memory/expand` reciben los argumentos de `memory_search` / `memory_expand`. El plugin se autentica con una prueba de sesión de un solo uso, `Authorization: Bearer eyas-ocs.<payload>.<signature>`, una por llamada, y la llamada actúa para la sesión que nombra la prueba: un cuerpo que nombra otra sesión en `sessionId` recibe `403`; una prueba falsificada, reutilizada o caducada, una prueba de un proceso que ya se detuvo, o la clave en bruto usada como bearer recibe `401`. Un usuario con sesión iniciada que tiene el derecho de crear sobre OpenCode puede seguir llamando a las rutas y nombrar una sesión en el cuerpo con `sessionId`; la llamada actúa para esa sesión solo si el usuario es su usuario vinculado y, si no, lee solo la memoria global. Una denegación de permisos es `403`. Las respuestas se enmascaran como cualquier resultado de herramienta de memoria enviado a un modelo remoto. Los antiguos `/api/v1/opencode/memory/query` y `/api/v1/opencode/memory/save` ya no existen (`404`). Las llamadas que modifican a `/api/v1/opencode/*` hechas con una cookie de sesión necesitan la cabecera `X-Eyas-Request`, como las demás APIs de administración (la UI web la envía).

### Modelo y razonamiento {#model-and-reasoning}

La tarjeta **Modelo y razonamiento** de la página de OpenCode elige el modelo y la variante de razonamiento de las tareas que el asistente delega en OpenCode (`opencode_run`).

- **Modelo** lista los modelos propios de OpenCode: los proveedores y modelos en los que tiene la sesión iniciada el sidecar de OpenCode propio de EYAS, leídos del servidor de OpenCode en ejecución. **Predeterminado de OpenCode** (vacío) no envía ningún modelo, así que OpenCode usa su propio predeterminado, exactamente como antes.
- **Variante de razonamiento** lista las variantes que OpenCode ofrece para el modelo elegido — por ejemplo low/medium/high/xhigh/max para Claude Opus 5.5, none…max para GPT-5.6, minimal/high para algunos modelos de Gemini. Se oculta cuando el modelo no tiene variantes. **Predeterminado del modelo** (vacío) no envía ninguna variante. Los nombres estándar (none, minimal, low, medium, high, xhigh, max) se muestran con las etiquetas de esfuerzo de EYAS; los nombres propios de un proveedor se muestran como los nombra OpenCode.
- Elegir otro modelo restablece la variante, salvo que el nuevo modelo ofrezca la misma. **Guardar** almacena la elección; requiere el derecho de gestión sobre OpenCode (propietario y admin por defecto).
- La lista necesita que el servidor de OpenCode esté en marcha. Arranca con la primera sesión de terminal de OpenCode o con la primera tarea delegada — la página no lo arranca. Hasta entonces la tarjeta lo indica y muestra solo la elección guardada; recarga la página cuando el servidor esté en marcha. Si OpenCode no puede devolver su lista, la tarjeta dice *No se pudo leer la lista de modelos de OpenCode.*
- En la ejecución, una variante guardada que el modelo ya no ofrece, o una que no se puede comprobar porque la lista no se puede leer, se descarta con un aviso en el log del servidor; la tarea se ejecuta con el modelo elegido y su razonamiento predeterminado. El resultado de la tarea nombra el modelo y la variante que se ejecutaron de verdad, tal como los informa OpenCode (campo `effective`), incluido qué modelo eligió OpenCode cuando no se fijó ninguno.
- La terminal de OpenCode no se ve afectada: su modelo se sigue eligiendo dentro de OpenCode.

Las instalaciones existentes empiezan con el modelo y la variante predeterminados de OpenCode; no hay nada que migrar.

**API (integradores).** `GET /api/v1/opencode/models` (lectura sobre OpenCode) devuelve `{running, providers: [{id, name, models: [{id, name, variants: [{id, level}], contextWindow?}]}], defaults}`; `contextWindow` es el límite de entrada del modelo (si no, su límite de contexto) cuando OpenCode lista uno. Nunca devuelve credenciales de proveedores y nunca arranca el servidor: sin servidor en marcha devuelve `running: false`; si la lista falla devuelve `502` con el código `OPENCODE_MODELS_UNAVAILABLE`. `PUT /api/v1/opencode/settings` acepta `model` (`{providerID, modelID}` o null) y `variant` (cadena o null), y rechaza cualquier cuerpo mal formado con `400` en lugar de ignorarlo.

### Conectarse a un servidor externo {#attaching-to-an-external-server}

Una URL de conexión (attach) a un servidor de OpenCode externo significa **sin aislamiento**: ese servidor mantiene su propia config, inicio de sesión y reglas de permisos, y no recibe herramientas de memoria de EYAS, ni clave de memoria, ni registro. La página de OpenCode muestra **Servidor** y **Aislamiento** como *Aviso* con esta advertencia.

### La página de OpenCode {#the-opencode-page}

La página muestra los nombres de las comprobaciones traducidos, una línea **Aislamiento**, una línea **Servidor**, una pista de inicio de sesión y la tarjeta **Modelo y razonamiento**.

### Actualización {#upgrade}

- Las versiones anteriores guardaban los archivos de OpenCode en `data/opencode` dentro de la carpeta de instalación. Esa carpeta ya no se usa. Saca lo que aún necesites de `data/opencode/workspaces` (sesiones de terminal anteriores) y después puedes borrarla.
- Las herramientas de OpenCode `eyas_query_memory` y `eyas_save_memory` se sustituyen por `memory_search` / `memory_expand`. Un OpenCode en marcha recoge el nuevo plugin en su siguiente arranque (un reinicio de EYAS).
- `EYAS_OPENCODE_PLUGIN_TOKEN` ya no existe: EYAS ni la lee ni la define. Cada proceso de OpenCode recibe su propia clave en el descriptor de archivo 3, y las llamadas de memoria llevan pruebas por sesión. Un servidor conectado ya no llega a la memoria de EYAS.
- El plugin de memoria se trasladó a `config/opencode/eyas/eyas-memory.ts` dentro de la carpeta de OpenCode propia de EYAS; el antiguo `plugins/eyas-memory.ts` se borra en el siguiente arranque. El modelo de OpenCode ahora tiene de verdad `memory_search` / `memory_expand` (verificado en OpenCode 1.18.29).
- La salida de herramientas y de terminal de OpenCode ya no se guarda salvo que `memory.l0.captureToolResults` esté activado.

## Relacionado

- [Herramientas](/docs/es/automation/tools/)
- [Memoria](/docs/es/knowledge/memory/)
- [Conversaciones](/docs/es/daily/conversations/)
- [Seguridad y privacidad](/docs/es/admin/security-privacy/)
