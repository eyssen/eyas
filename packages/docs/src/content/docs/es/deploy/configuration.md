---
title: Configuración
description: YAML por defecto, overlays locales, precedencia de env — después de elegir un camino de instalación.
---

**Para qué sirve.** La configuración es cómo cambias la dirección de escucha, los módulos, la autonomía, el capture de memoria y los comandos de verificación de los agentes sin reconstruir nada. Edita `local.yaml` y las variables de entorno `EYAS_*` — no `config/default.yaml` si puedes evitarlo (las actualizaciones sobrescriben los valores por defecto que se distribuyen). Este capítulo da por hecho que ya elegiste [nativo](/docs/es/deploy/native/), [Docker](/docs/es/deploy/docker/) o [Kubernetes](/docs/es/deploy/kubernetes/).

## Cuándo usarlo {#when-to-use-it}

- Host/puerto, nivel de log, desactivar un módulo.
- Capture de llamada al modelo off (`memory.capture.enabled: false`) — por defecto on. Esto **no** para el capture en bruto: `memory.l0.enabled` es un interruptor aparte, también on por defecto.
- Capture en bruto off (`memory.l0.enabled: false`) si no quieres una segunda copia literal de cada mensaje guardada en disco.
- Carpetas extra de skills o personas (`skills.importRoots` / `agent.importRoots`) desde carpetas normales — las carpetas propias de otro asistente se omiten.
- `agent.verifyCommands` para que una corrida de código no esté «lista» hasta que pasen los tests.
- Varios checkouts Odoo vía `EYAS_ODOO_SOURCES_JSON`.
- Decirle al modelo la hora local correcta (`i18n.timezone`).
- Mover el directorio de datos (`EYAS_DATA_DIR`) o los workspaces de conversación (`EYAS_WORKSPACES_DIR`), o fijar el binario de Claude Code, Grok o Kimi (`EYAS_CLAUDE_CODE_BIN`, `EYAS_GROK_BIN`, `EYAS_KIMI_BIN`).
- Proteger más almacenes de memoria frente a los modelos (`security.foreignMemoryPaths`), o exigir el sandbox de archivos del kernel para las herramientas propias de las CLI (`security.cliSandbox: required`).
- Dar a los turnos de CLI más o menos tiempo antes de detenerlos por silencio (`model.cli.idleTimeoutMs`, `model.cli.toolTimeoutMs`).

## Flujo típico {#typical-workflow}

1. Copia o crea `local.yaml` junto a los valores por defecto distribuidos (o define `EYAS_HOME` para que viva con esa instancia).
2. Cambia solo las claves que necesites. Valida: `eyas config validate`.
3. Reinicia (`eyas restart`). EYAS lee `default.yaml` y `local.yaml` una sola vez al arrancar; `eyas config reload` **no** recarga estos dos archivos. Los archivos de `config/personality/` que lo indican (por ejemplo `privacy.yaml`) se recogen sin reiniciar.
4. Compruébalo en **Ajustes** y con `eyas doctor`.

## Funciones {#features}

| Archivo | Papel |
|---------|-------|
| `config/default.yaml` | Valores por defecto distribuidos |
| `local.yaml` | Capa que se fusiona encima |
| `.env` | Secretos opcionales (nunca los subas al repositorio) |

Precedencia: flags de CLI → entorno `EYAS_*` → YAML local → YAML por defecto.

Claves de ejemplo en default.yaml: `server.host/port`, `database.path`, `log.level`, `i18n.timezone`, `modules.disabled`, `autonomy.identitySelfUpdate`, `security.foreignMemoryPaths`, `security.cliSandbox`, `model.cli.idleTimeoutMs`, `model.cli.toolTimeoutMs`, `memory.capture.enabled`, `memory.l0.enabled`.

### Zona horaria del reloj del modelo {#time-zone-of-the-models-clock}

```yaml
i18n:
  timezone: "America/New_York"   # nombre IANA; sin definir = la zona del propio servidor
```

Cada turno le dice al modelo la fecha y la hora actuales. `i18n.timezone` fija la zona que usa: un nombre IANA como `America/New_York`, `Europe/Berlin` o `UTC`. Sin definir (el valor por defecto) significa la zona del propio servidor — la variable de entorno `TZ` o, si no, el ajuste del sistema operativo. Los contenedores Docker suelen correr en UTC salvo que se defina `TZ`.

La fecha y la hora salen siempre de la misma zona, y la línea de la hora nombra la zona y su desfase UTC, por ejemplo `Current time: 23:30 (America/New_York, UTC-04:00)`. Las versiones anteriores daban la hora en una zona fija de Europa Central mientras la fecha salía de UTC, así que cerca de medianoche podían no coincidir y cualquier instalación fuera de esa zona recibía una hora local equivocada.

Un valor inválido detiene el arranque con un error de configuración: *i18n.timezone: Unknown time zone — use an IANA name such as Europe/Berlin or UTC*. Defínelo en `local.yaml`; se aplica tras un reinicio.

### Directorio de datos y vault {#data-directory-and-vault}

El directorio de datos contiene la base de datos, el vault de memoria, los archivos de agentes, las copias y el resto del estado de la instancia. Es `<EYAS home>/data` por defecto, o la carpeta que nombre `EYAS_DATA_DIR`.

El vault de memoria vive siempre en `<data dir>/vault` y no tiene ajuste de ruta propio: para moverlo, mueve el directorio de datos con `EYAS_DATA_DIR`. (La antigua clave `memory.vault.path` de `config/personality/memory.yaml` nunca hizo nada y se ha eliminado.)

Las instalaciones sin `EYAS_DATA_DIR` — incluidas la imagen Docker y el chart Helm que se entregan, que montan el `/app/data` por defecto — conservan el vault exactamente donde estaba. Las versiones anteriores guardaban el vault en `<EYAS home>/data/vault` aunque `EYAS_DATA_DIR` apuntara a otro sitio. En una instalación que define `EYAS_DATA_DIR`, el primer arranque tras actualizar copia el vault antiguo una vez, pero solo mientras el vault del directorio de datos no contenga ninguna nota `.md` y el antiguo `<EYAS home>/data/vault` sí contenga notas:

- **Copia, nunca mueve**: la carpeta antigua queda intacta, se conservan el contenido y las fechas de modificación de los archivos, y no se sobrescribe nada de lo que ya haya en el vault nuevo. Un aviso en el log dice que se hizo la copia y que la carpeta antigua se puede borrar una vez comprobada la copia.
- Si la copia falla (por ejemplo, no se puede escribir en el directorio de datos), el vault nuevo queda vacío, se registra un error con el remedio y la copia se reintenta en el siguiente arranque.
- Si las dos carpetas ya contienen notas, no se copia ni se fusiona nada. EYAS usa solo `<data dir>/vault` y registra un aviso en cada arranque hasta que se quite la carpeta antigua; copia a mano al vault cualquier nota que aún necesites.

`eyas doctor` muestra la ruta del vault en su línea **Vault** y avisa de un vault antiguo junto a un directorio de datos movido — ver [CLI](/docs/es/deploy/cli/#what-doctor-checks). El [Backup](/docs/es/admin/backup/) incorporado archiva `<EYAS home>/data`; si `EYAS_DATA_DIR` apunta a otro sitio, incluye esa carpeta en tus propias copias.

### Workspaces de conversación {#conversation-workspaces}

Una conversación sin carpetas propias trabaja en su propio **workspace de EYAS** (ver [Conversaciones — Carpetas](/docs/es/daily/conversations/#working-folders)). Los workspaces nunca se colocan dentro de un checkout de git, porque un modelo CLI (Claude Code, Grok, Kimi) arrancado dentro de un repositorio git trata ese repositorio como su proyecto: carga sus archivos de instrucciones, el estado de git, las reglas de permisos y la memoria por proyecto. La ubicación de los workspaces es, por orden:

1. `EYAS_WORKSPACES_DIR`, si está definida. Usa una ruta absoluta.
2. Si no, `<data dir>/workspaces`, cuando el directorio de datos no está dentro de un checkout de git (imágenes Docker y Kubernetes, instalaciones empaquetadas — ahí no cambia nada).
3. Si no (una instalación desde el código fuente ejecutada desde un clon de git), una carpeta por instancia en el directorio de datos de aplicación de tu usuario:
   - macOS: `~/Library/Application Support/eyas/<instance>/workspaces`
   - Linux: `$XDG_DATA_HOME/eyas/<instance>/workspaces`, por defecto `~/.local/share/eyas/<instance>/workspaces`
   - Windows: `%LOCALAPPDATA%\eyas\<instance>\workspaces`

`<instance>` es el nombre de la carpeta home de EYAS más un hash corto del directorio de datos, así que dos instancias en la misma máquina (por ejemplo una de desarrollo y una en producción) nunca comparten workspaces.

**Actualización (automática, una vez).** Cuando la ubicación cambió — un directorio de datos dentro de un checkout de git, o `EYAS_WORKSPACES_DIR` apuntando a otro sitio —, el primer arranque mueve los workspaces creados automáticamente desde `<data dir>/workspaces` a la nueva ubicación y reapunta las conversaciones que los usaban. Las carpetas que elegiste tú nunca se mueven ni se editan. Si en la nueva ubicación ya existe una carpeta con el mismo nombre, la antigua se queda donde está, esa conversación la sigue usando y se registra un aviso. Reiniciar otra vez no cambia nada.

Cuando la ubicación de los workspaces está fuera del directorio de datos, la copia de datos no la incluye; los archivos de salida de los agentes se conservan igualmente, porque se copian a Documentos como adjuntos de la conversación. Ver [Backup](/docs/es/admin/backup/).

### Memoria fuera de EYAS {#memory-outside-eyas}

```yaml
security:
  foreignMemoryPaths: []   # rutas absolutas extra que los modelos no pueden leer ni escribir
  cliSandbox: auto         # auto | required
```

EYAS lee y escribe memoria solo a través de sus propios almacenes. `security.foreignMemoryPaths` se aplica: se lee al arrancar, y el gate de seguridad rechaza ahí las lecturas y escrituras de cualquier modelo. `security.cliSandbox` decide qué pasa cuando no está disponible el sandbox de archivos del kernel para las herramientas propias de las CLI.

| Clave | Por defecto | Significado |
|-------|-------------|-------------|
| `security.foreignMemoryPaths` | **`[]`** | Almacenes extra que los modelos no pueden leer ni escribir, además de la lista incorporada de abajo. Rutas absolutas; un `~` inicial se expande; una cadena vacía se rechaza. Una carpeta listada queda protegida con todo lo que contiene. Las entradas que no son rutas absolutas se ignoran, con un aviso en el log. Se lee al arrancar — requiere reinicio. La misma lista bloquea también los servidores MCP que apunten ahí, las Carpetas de conversación dentro de ella y las raíces de importación dentro de ella, y forma parte de la lista de denegación del sandbox del kernel. **Eventos de seguridad → Memoria fuera de EYAS** lista tus entradas y marca las que faltan y las ignoradas. |
| `security.cliSandbox` | **`auto`** | El sandbox de archivos del kernel (macOS Seatbelt, Linux bubblewrap) para el shell de Claude Code y las herramientas propias de Grok CLI. `auto`: se usa donde está disponible; donde no, la CLI sigue ejecutando sus herramientas y el chat muestra un aviso único por conversación, y un comando de Claude Code que pide ejecutarse fuera del sandbox siempre espera la aprobación de una persona. `required`: un turno de CLI con herramientas se rechaza antes de arrancar la CLI cuando no hay sandbox disponible (Kimi Code CLI no tiene ninguno, así que sus turnos con herramientas se rechazan siempre), y Claude Code nunca puede ejecutar un comando fuera de él. No hay `off`; cualquier otro valor es un error de configuración y EYAS no arranca. Las llamadas en segundo plano sin herramientas nunca se rechazan por falta de sandbox. Ver [Proveedores — Sandbox de archivos del kernel](/docs/es/ai/providers/#kernel-file-sandbox). |

Lo que la política protege sin ningún ajuste:

- el estado en la carpeta home de otros asistentes: `~/.claude` y `~/.claude.json` (Claude Code), `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, `~/.codeium` (Windsurf), `~/.agents` y `~/.config/agents` (skills compartidas), `~/.copilot`;
- las carpetas de config, datos y estado de OpenCode (ubicaciones XDG y sus alternativas `~/.config`, `~/.local/share` y `~/.local/state`);
- los ajustes de la propia aplicación Obsidian, y todo vault de Obsidian, encontrado por su carpeta `.obsidian` o por la lista de vaults de Obsidian (un vault creado mientras EYAS corre se detecta en unos 30 segundos);
- cualquier carpeta llamada `ai-memory`, y cualquier carpeta `memory` o `memories` bajo una carpeta punto de herramienta (`.claude`, `.grok`, `.codex`, `.gemini`, `.kimi`, `.cursor`, `.codeium`, `.windsurf`), también dentro de un proyecto;
- las mismas carpetas punto en las carpetas home de otros usuarios.

Los archivos normales de proyecto siguen usables: `.claude/settings.json` y `.claude/agents` de un proyecto, `CLAUDE.md`, `docs/MEMORY.md`.

La carpeta de datos propia de EYAS también es privada. Los modelos solo pueden usar los workspaces de conversación — cada conversación solo el suyo, también cuando `EYAS_WORKSPACES_DIR` los saca de la carpeta de datos —, los proyectos de Estudio (`data/studio`) y las descargas del navegador (`data/browser/downloads`). El vault, la base de datos, las claves, el perfil del navegador y las carpetas de inicio de sesión de los CLI propiedad de EYAS (`data/cli-homes`) son solo de EYAS; el archivo de la base de datos está protegido incluso cuando `database.path` apunta fuera de la carpeta de datos. Los symlinks no lo esquivan: una ruta se juzga tal como está escrita y según adónde lleva realmente.

**Qué se aplica.** Cada ruta de cada llamada a herramienta que ve el gate de seguridad se comprueba contra esta política — herramientas de EYAS en proveedores de API, herramientas de EYAS que Grok y Kimi llaman a través del puente de herramientas, cada llamada a herramienta para la que Claude Code pide permiso, las herramientas propias de Claude Code (mediante una comprobación que corre antes de cada una) y cada petición de permiso y de archivo de Grok/Kimi. Una ruta protegida se rechaza al instante, tanto para leer como para escribir: sin juez de IA, sin petición de aprobación, ningún permiso concedido la abre, y el rechazo no cuenta para el bloqueo por 3 denegaciones. También rige con el gate de seguridad apagado. Cada rechazo es una fila en **Eventos de seguridad**. Ver [Seguridad y privacidad — Memoria fuera de EYAS](/docs/es/admin/security-privacy/#memory-outside-eyas).

La misma política también impide guardar una carpeta así como Carpeta de conversación o directorio de trabajo de un proyecto (ver [Conversaciones — Carpetas](/docs/es/daily/conversations/#working-folders)), bloquea los servidores MCP que apuntan a ella (ver [MCP](/docs/es/ai/mcp/#memory-store-servers-are-blocked)) y omite las raíces de importación dentro de ella (abajo). Las herramientas de archivo propias de EYAS rechazan un symlink dentro de la carpeta de trabajo que apunte fuera de ella — también cuando su destino aún no existe.

**La capa del kernel.** Los destinos de shell que el texto del comando no muestra, y las lecturas de CLI que nunca preguntan a EYAS, los cubre el sandbox de archivos del kernel donde se ejecuta (el shell de Claude Code, las herramientas propias de Grok CLI). En Linux necesita bubblewrap (`bwrap`) — más `socat` para Claude Code — y user namespaces sin privilegios; la imagen de EYAS no los incluye (bubblewrap es LGPL; instalarlo es decisión del operador). `eyas doctor` muestra el estado en su línea **CLI sandbox**. Kimi Code CLI no tiene sandbox del kernel, así que sus propias herramientas de lectura, grep y glob siguen cubiertas solo donde EYAS las ve.

### Proveedores CLI: directorios personales y entorno {#cli-providers-homes-and-environment}

EYAS arranca las herramientas de IA de línea de comandos con un entorno corto en lista blanca, nunca con el entorno completo del servidor:

| CLI | Directorio personal | Qué recibe |
|-----|---------------------|------------|
| Claude Code | El `HOME` del host (solo comparte el inicio de sesión) | `PATH`, locale y zona horaria, proxies y paquetes de CA, `HOME`, las variables de inicio de sesión de Anthropic / Claude OAuth / Bedrock / Vertex, más `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` y `DISABLE_AUTOUPDATER=1` |
| Grok CLI | `<data dir>/cli-homes/grok-cli` | `PATH`, locale y zona horaria, `TMPDIR`, `TERM`, `USER`, `LOGNAME`, `SHELL`, variables de proxy y de paquetes de CA, y los interruptores de aislamiento de EYAS |
| Kimi Code CLI | `<data dir>/cli-homes/kimi-cli` | Igual que Grok |
| OpenCode | `<data dir>/cli-homes/opencode` | Ver [OpenCode](/docs/es/automation/opencode/) |

No se pasan: las claves de API de otros proveedores, los secretos de EYAS, una `XAI_API_KEY`, `CLAUDE_CONFIG_DIR`, ni ningún otro ajuste `CLAUDE_CODE_*`, `GROK_*`, `KIMI_*` o `XDG_*` del servidor. Los directorios personales propios de EYAS en `data/cli-homes` guardan los inicios de sesión de Grok y Kimi para EYAS y están protegidos frente a todos los modelos. Claude Code y Grok no se actualizan solos mientras EYAS los ejecuta; actualiza tú las CLIs. No hay ajustes para nada de esto. Ver [Proveedores](/docs/es/ai/providers/#claude-code-isolation).

### Tiempos de espera de los turnos de CLI {#cli-turn-timeouts}

```yaml
model:
  cli:
    idleTimeoutMs: 600000     # 10 min de silencio sin ninguna herramienta en marcha
    toolTimeoutMs: 1200000    # 20 min de silencio con una herramienta en marcha
```

Los turnos de Claude Code, Grok CLI y Kimi Code CLI no se detienen tras un tiempo fijo. Un turno de CLI solo se detiene cuando la CLI se queda callada: `idleTimeoutMs` sin ningún mensaje mientras no hay herramienta en marcha, o `toolTimeoutMs` sin ningún mensaje mientras una herramienta está en marcha. Cualquier mensaje de la CLI — texto en streaming, una herramienta que empieza o termina, una solicitud de permiso — vuelve a poner el reloj a cero, y no hay límite para la duración del turno entero; **Detener** sigue terminando un turno en cualquier momento, y el barrido de ejecuciones atascadas sigue aplicándose. Un turno detenido por silencio informa de un timeout, que cuenta como reintentable: el gateway puede reintentarlo una vez, o pasar a otro modelo, solo cuando todavía no se había transmitido nada, y el programador de reintentos automáticos puede reintentar una ejecución en segundo plano.

Ambos valores van en milisegundos y deben ser números enteros positivos; los valores cero, negativos, fraccionarios o de texto se rechazan al cargar la configuración. Se leen al inicio de cada turno de CLI desde la configuración en marcha, así que un valor cambiado se aplica tras reiniciar EYAS. Mantén `toolTimeoutMs` por encima de 15 minutos para que no se corten los especialistas lanzados con `run_specialist`.

### Capture de memoria duradera {#durable-memory-capture}

```yaml
memory:
  capture:
    enabled: true          # false = sin notas de vault tras el turno
    minUserChars: 40
    maxPerConversation: 20
    maxInputChars: 4000
```

| Clave | Por defecto | Significado |
|-------|-------------|-------------|
| `memory.capture.enabled` | **`true`** | Tras una ejecución que cumple las condiciones, una pequeña llamada al modelo en segundo plano de EYAS decide si hay en ella un hecho duradero y escribe hasta dos notas de vault — nunca en el camino crítico de la respuesta. Se ejecuta en todas las formas en que EYAS ejecuta un modelo: turnos de chat, ejecuciones de tarjetas en segundo plano, ejecuciones de especialistas y delegadas (incluidas las etapas de pipeline), tareas A2A, miembros de equipo y respuestas de canal. `false` lo detiene en todas ellas; el registro en bruto de abajo es un interruptor aparte. |
| `memory.capture.minUserChars` | **`40`** | Un mensaje más corto (en caracteres) nunca provoca una llamada al modelo. En un mensaje de canal o una tarea A2A solo cuentan las palabras propias del remitente, así que un «ok» corto por un canal no provoca ninguna llamada. |
| `memory.capture.maxPerConversation` | **`20`** | Techo de llamadas al modelo de capture por conversación. Un especialista o miembro de equipo se ejecuta en su propia subconversación, así que tiene su propio techo; una conversación de canal comparte un único techo entre todos sus mensajes. |
| `memory.capture.maxInputChars` | **`4000`** | Tu mensaje y la respuesta se recortan cada uno a este número de caracteres antes de que los vea el modelo de capture. |

La llamada corre en un proveedor de API o en una CLI que puede ejecutarse aislada, nunca en una que no puede; sin modelo elegible, el capture registra una omisión y no hace ninguna llamada. Una ejecución que no respondió nada no escribe ninguna fila de capture. **Coste:** cada especialista, miembro de equipo y respuesta de canal cuya instrucción tenga al menos `minUserChars` caracteres puede gastar ahora una llamada extra al modelo en segundo plano. Quién escribió el mensaje decide cómo se lee: una tarea delegada, un encargo de equipo o el objetivo de una tarjeta es una instrucción de tarea que puede haber escrito un agente, y un mensaje de canal o una tarea A2A son palabras de un tercero — que nunca crean una nota sobre quién eres ni sobre cómo trabajar, y cuyas notas se guardan con confianza de par. El libro mayor `memory_capture_runs` gana una columna `entry_path` (`interactive`, `background`, `delegation`, `pipeline`, `a2a`, `team`, `channel`; vacía en las filas escritas antes de esta versión), que se añade automáticamente. No hay ajustes nuevos. Ver [Memoria — El capture está encendido por defecto](/docs/es/knowledge/memory/#capture-is-on-by-default) y [FAQ](/docs/es/reference/faq/).

### Capture en bruto {#raw-capture}

```yaml
memory:
  engine: legacy           # solo controla la extracción determinista; la recuperación es la misma en ambos casos
  l0:
    enabled: true          # false = no guardar ninguna copia en bruto
    captureToolResults: false
    captureThinking: false
    toolResultMaxBytes: 8192
    idleFlushMinutes: 30
    chunkTokens: 8000
    extractInLegacy: true
```

No es el mismo interruptor que `memory.capture` de arriba. El capture escribe notas de vault y cuesta una pequeña llamada al modelo; el capture en bruto guarda una **segunda copia literal de cada mensaje persistido** — comprimida y direccionada por contenido — **sin llamada al modelo y sin coste de API**. Está on por defecto.

| Clave | Por defecto | Significado |
|-------|-------------|-------------|
| `memory.l0.enabled` | **`true`** | Interruptor maestro del capture en bruto. `false` no graba nada y no acumula nada en búfer. |
| `memory.l0.extractInLegacy` | **`true`** | Ejecuta la pasada determinista (hechos, resumen, entidades, temas, importancia) tras cada volcado mientras `engine` siga en `legacy`. `false` conserva el texto en bruto y no deduce nada de él. |
| `memory.engine` | **`legacy`** | `legacy` o `v2`. Solo decide si corre la extracción determinista de hechos: `v2` extrae siempre; `legacy` extrae mientras `memory.l0.extractInLegacy` esté activado (el valor por defecto). El recall es siempre el recall por capas, sea cual sea el valor. |
| `memory.l0.chunkTokens` | **`8000`** | Disparador de volcado por tamaño: el búfer de una conversación se escribe en cuanto su recuento estimado de tokens llega a esta cifra. |
| `memory.l0.idleFlushMinutes` | **`30`** | Disparador de volcado por tiempo: un barrido cada minuto escribe cualquier búfer que lleve inactivo este tiempo. Cerrar la conversación y parar EYAS también vuelcan, así que un reinicio limpio no pierde nada. |
| `memory.l0.captureToolResults` | **`false`** | Captura también la salida de cada herramienta que llama una ejecución de agente, sea cual sea el modelo: las herramientas propias de EYAS, las herramientas de EYAS que una CLI llama por el puente, las herramientas integradas de Claude Code, Grok y Kimi, las herramientas que OpenCode ejecuta dentro de una tarea `opencode_run` y la salida del panel de terminal de OpenCode. Solo se graban las llamadas que se ejecutaron (las fallidas, marcadas como error); no las rechazadas, omitidas o a la espera de aprobación, ni los resultados vacíos, ni las repeticiones, ni las llamadas a herramientas fuera de una ejecución de agente. **Lee el párrafo siguiente antes de activarlo.** |
| `memory.l0.captureThinking` | **`false`** | Conservar el razonamiento («thinking») de cualquier modelo que lo informe, una entrada por llamada al modelo. Solo para auditoría: nunca se convierte en hechos, nunca se recupera. Se guarda literal y sin censurar; mientras está activado se escribe un aviso al arrancar. |
| `memory.l0.toolResultMaxBytes` | **`8192`** | Tope en bytes del registro de lo que devolvió una llamada a herramienta capturada — nombre de la herramienta, salida, indicador de error, desenlace y quién la ejecutó —, cortado en un límite UTF-8 con una marca de truncado visible. Los argumentos de la llamada no cuentan: se guardan al lado del registro, recortados a sus primeros 2048 caracteres. Solo resultados de herramientas; los mensajes no tienen tope. |

`captureToolResults` y `captureThinking` se leen al inicio de cada ejecución desde la configuración en marcha; como el resto de `local.yaml`, un cambio se aplica tras reiniciar EYAS.

**`captureToolResults` está apagado por algo.** Un resultado de herramienta capturado es la salida entera, literal y sin censurar, más los primeros 2048 caracteres de los argumentos de la llamada: la stdout de `run_command`, el contenido de `read_file` y un código de un solo uso vigente de `browser_totp` acaban todos como texto plano en la capa en bruto. Nada los censura y nada los cifra en reposo — comprimir no es confidencialidad. Con el flag activado, cada arranque registra un aviso al respecto. Actívalo solo donde eso sea aceptable para esta máquina. Una llamada grabada nunca se recupera ni se cita en un prompt — ni en la memoria que se añade a un turno, ni en `memory_search`, `memory_expand`, la búsqueda de la página Memoria o el resumen de una conversación. Solo su salida da forma a los temas y nombres que EYAS extrae de la conversación; los argumentos se guardan junto al registro como procedencia y nunca se indexan ni se extraen (ver [Memoria — Los resultados de herramientas no se graban](/docs/es/knowledge/memory/#tool-results-are-not-recorded--and-why-to-leave-it-that-way)).

**Ninguna página muestra estas filas.** No hay página en la UI, ni endpoint de API, ni comando `eyas memory` para el registro en bruto. El asistente solo llega a él a través del recall — los resúmenes y hechos derivados de él, y las filas en bruto que se abren con `memory_expand`. La tarjeta **Motor de recuperación** de **Memoria → Resumen** muestra si el registro en bruto, la captura de la salida de herramientas y la captura del razonamiento están activos de verdad.

**El capture en bruto crece y nada lo poda.** En esta versión no hay ajuste de retención ni tarea de limpieza; un mensaje capturado cuesta unos 5 KB en disco contando índices. Si prefieres no pagar eso todavía, pon `memory.l0.enabled: false`. Ver [Memoria](/docs/es/knowledge/memory/).

### Índice de memoria y recall {#memory-index-and-recall}

| Clave | Por defecto | Significado |
|-------|-------------|-------------|
| `memory.index.budgetChars` | **`2400`** | Caracteres del bloque entero de memoria recordada por turno (≈ 600 tokens), marco incluido: notas permanentes, notas recuperadas para el mensaje y coincidencias a texto completo juntas. El tamaño está pensado para un modelo con una ventana de contexto de 100k tokens y escala con la ventana del modelo que responde (hasta 2,5× a partir de 250k tokens, menos por debajo de unos 29k tokens) — también para una tarea de OpenCode (`opencode_run`), dimensionada para la ventana que OpenCode lista para el modelo elegido, o exactamente este valor cuando esa ventana es desconocida. Las notas permanentes dejan hasta la mitad del bloque para lo recuperado. Las notas que no caben se resumen en una línea final (*… N more notes not shown*) y siguen alcanzables con la búsqueda de memoria. Súbelo cuando tus notas `user` y `feedback` ya no quepan. Requiere reinicio. |
| `memory.recall.includeSecrets` | **`false`** | Si las notas, filas episódicas y skills etiquetadas `contains-secrets` (archivos en los que el importador encontró credenciales, guardados literales) — y las filas en bruto, hechos y resúmenes derivados de ellas — llegan al modelo a través del recall, `memory_search` y `memory_expand`, y reciben vectores de búsqueda. Desactivado, quedan guardadas y visibles en la página de Memoria, pero nunca llegan a un prompt. Requiere reinicio. |

El recall — qué contiene, cómo se construye su consulta y cómo llega a cada modelo — se describe en [Memoria — Cómo llega el recall al modelo](/docs/es/knowledge/memory/#how-recall-reaches-the-model). La tarjeta **Motor de recuperación** de **Memoria → Resumen** muestra el presupuesto y el interruptor `includeSecrets` con los que corre EYAS (ver [Memoria — Motor de recuperación](/docs/es/knowledge/memory/#recall-engine)).

**Eliminado: `memory.relatedWork.*`.** El bloque aparte *Related prior work* (`enabled`, `minQueryChars`, `maxHits`, `budgetChars`, `maxSnippetChars`) ha desaparecido; el trabajo previo llega ahora dentro del bloque de memoria recordada, dimensionado con `memory.index.budgetChars`. Un `local.yaml` existente que aún define estas claves sigue cargando; se ignoran.

**Nota de actualización.** Las versiones anteriores traían `memory.index.budgetChars: 8000` en `config/default.yaml`; el valor que se entrega ahora es `2400`, igual que el valor por defecto incorporado. Para conservar el tamaño anterior, añade esto a `config/local.yaml` y reinicia:

```yaml
memory:
  index:
    budgetChars: 8000
```

### Durabilidad de la base de datos {#database-durability}

Desde 0.8.23-beta cada conexión de base de datos de EYAS ejecuta `PRAGMA synchronous = NORMAL` en vez del `FULL` por defecto de SQLite. Junto con WAL, que EYAS siempre ha usado, esto significa:

- Una caída del **proceso** — EYAS matado, un error no controlado — no pierde nada ya confirmado.
- Una caída del **SO** o un corte de corriente justo en el instante de un commit puede perder la última transacción.

Es el trato estándar de WAL y vale para **todos** los módulos, no solo la memoria. Si tu instancia guarda trabajo que no podrías volver a introducir, la durabilidad la da el [Backup](/docs/es/admin/backup/), no el modo de commit.

### Raíces adicionales de skills y personas {#extra-skill-and-persona-roots}

```yaml
skills:
  importRoots: []
agent:
  importRoots: []
```

La lista enviada está vacía. Rutas en `local.yaml`, nunca en el código del producto. Estas raíces se leen en **cada arranque**, así que son una fuente en vivo — solo para carpetas normales (por ejemplo una carpeta de equipo como `/opt/team-skills`). Las skills importadas ganan a las copias bundled del mismo id. Ver [Habilidades](/docs/es/automation/skills/#import-roots).

**Raíces que EYAS omite.** Una raíz que está dentro de, o contiene, las carpetas propias de otro asistente o app de notas no se escanea:

- las carpetas personales de otras herramientas: `~/.claude` (así que también `~/.claude/skills`, `~/.claude/agents` y `~/.claude/plugins/…`), `~/.claude.json`, `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, `~/.codeium`, `~/.copilot`, y las carpetas compartidas de skills `~/.agents` y `~/.config/agents`;
- las carpetas de config, datos y estado de OpenCode;
- los ajustes de la app Obsidian y cualquier bóveda de Obsidian;
- las carpetas listadas en `security.foreignMemoryPaths`;
- los directorios personales de CLI propios de EYAS (`data/cli-homes`).

Una raíz como tu carpeta personal entera también se omite, porque contiene estas carpetas. Por cada raíz omitida, el servidor escribe un aviso en el log al arrancar, por ejemplo *skills.importRoots: /Users/me/.claude/skills is inside Claude Code (~/.claude) — not scanned; import these files once with Settings → System → Data portability → Import data*, y `eyas doctor` muestra un aviso **Import roots** que nombra el ajuste y la carpeta.

**Qué hacer.** Las skills y los agentes ya importados desde una carpeta así se quedan en EYAS; solo dejan de refrescarse desde ella. Para traer ese contenido, o refrescarlo, haz una vez una [Importación de datos](/docs/es/admin/data-port/) de la carpeta — se copia a EYAS con su origen registrado — y luego quita la entrada de `local.yaml`.

**Las personas editadas en EYAS nunca se sobrescriben** con su archivo de `agent.importRoots`. Un archivo crea su agente en el primer arranque y después solo lo actualiza mientras el nombre, rol, descripción, system prompt y herramientas del agente sigan exactamente como los dejó la última importación; ver [Agentes — Configurar](/docs/es/agents/configure/#imported-personas).

## Verify de agentes y variables de entorno {#agent-verify-and-environment-variables}

```yaml
agent:
  criticEnabled: true
  criticMaxRounds: 1
  # Comprobaciones deterministas tras una ejecución en segundo plano (vacío = desactivado)
  verifyCommands:
    - name: bun-test
      command: bun
      args: [test]
  # verifyCwd: /absolute/path/to/repo   # por defecto: process.cwd()
```

| Clave | Significado |
|-------|-------------|
| `agent.verifyCommands` | Lista de `{ name, command, args?, timeoutMs? }` — **sin shell**; un fallo reabre el agente con el resumen del error |
| `agent.verifyCwd` | Directorio de trabajo de esos comandos |
| `EYAS_ODOO_SOURCE_PATHS` | Raíces locales de checkouts de Odoo separadas por dos puntos o punto y coma, para las herramientas ligeras `odoo_search_*` y el bootstrap opcional de fuentes |
| `EYAS_ODOO_SOURCES_JSON` | Bootstrap multiversión preferido: array JSON de `{ "path", "label?", "version?", "edition?", "family?", "name?", "tags?" }` — crea al arrancar **Fuentes de búsqueda** inactivas si esas rutas aún no están registradas |
| `EYAS_AUTO_FAILOVER` | Rellena, si lo activas, los fallbacks vacíos de los niveles de enrutado con un segundo proveedor activo |
| `EYAS_BROWSER_USER_DATA_DIR` | Perfil de Chromium propio de EYAS para `browser_*` headless (por defecto `data/browser/profile`). Los perfiles diarios de Chrome/Edge se rechazan |
| `EYAS_AGENT_BROWSER_BIN` | Ruta opcional a la CLI agent-browser de Vercel. Vacía = PATH. Definida pero ausente = fail-closed (sin fallback al PATH). Perfil: `data/browser/agent-browser/profile` |
| `EYAS_DATA_DIR` | Directorio de datos (base de datos, vault, archivos de agentes, …). Por defecto `<EYAS home>/data`. Ver [Directorio de datos y vault](#data-directory-and-vault) |
| `EYAS_WORKSPACES_DIR` | Ruta absoluta para los workspaces de conversación. Por defecto: ver [Workspaces de conversación](#conversation-workspaces) |
| `EYAS_CLAUDE_CODE_BIN` | Ruta absoluta al ejecutable `claude` que corre EYAS. Vacía = `claude` en el PATH y, si no, la copia incluida en el SDK (doctor avisa). Definida pero inválida = fail-closed (sin fallback). Ver [Proveedores — Runtime de Claude Code](/docs/es/ai/providers/#claude-code-runtime) |
| `EYAS_GROK_BIN` / `EYAS_KIMI_BIN` | Ruta absoluta al ejecutable `grok` / `kimi` que corre EYAS. Vacía = el binario del PATH. Definida pero inválida = fail-closed: el proveedor no se registra. Ver [Proveedores — Grok CLI y Kimi Code CLI](/docs/es/ai/providers/#grok-cli-and-kimi-code-cli) |
| `LM_STUDIO_URL` | Servidor LM Studio (por defecto `http://localhost:1234`; una barra final no molesta) |
| `EYAS_OPENCODE_PLUGIN_TOKEN` | Ya no existe: EYAS ni la lee ni la define. Cada proceso de OpenCode que arranca EYAS (el servidor en segundo plano y cada terminal de OpenCode) recibe su propia clave en el descriptor de archivo 3, nunca en un entorno, y cada llamada de memoria lleva una prueba por sesión de un solo uso; la clave se revoca cuando ese proceso termina o se reinicia. El entorno de OpenCode solo lleva `EYAS_OPENCODE_KEY_FD=3`, que define el propio EYAS. Ver [OpenCode](/docs/es/automation/opencode/#eyas-memory-inside-opencode) |

### Ejemplo de Odoo multiversión {#multi-version-odoo-example}

```bash
export EYAS_ODOO_SOURCES_JSON='[
  {"path":"/path/to/odoo-18-community","label":"18c","version":"18","edition":"community","family":"odoo"},
  {"path":"/path/to/odoo-18-enterprise","label":"18e","version":"18","edition":"enterprise","family":"odoo"},
  {"path":"/path/to/custom-addons","label":"addons","version":"18","edition":"custom","family":"odoo"}
]'
```

Luego abre **Fuentes de búsqueda**, pulsa **Reindexar** en cada fuente y define **Fuentes de código por defecto** en cada [proyecto](/docs/es/daily/projects/). Las conversaciones fijan fuentes en la pestaña **Fuentes** — ver [Búsqueda](/docs/es/daily/search/#pin-multi-versión).

Los hooks de política de herramientas corren en cada llamada a herramienta (PreToolUse / PostToolUse) a través del ToolExecutor — ver [Herramientas](/docs/es/automation/tools/).

## Relacionado {#related}

- [CLI](/docs/es/deploy/cli/)
- [Proveedores](/docs/es/ai/providers/)
- [Enrutado y presupuesto](/docs/es/ai/routing-budget/)
- [Memoria](/docs/es/knowledge/memory/)
