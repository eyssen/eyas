---
title: Seguridad y privacidad
description: Gate de seguridad, flujo de eventos, auditoría y la política de privacidad — antes y después de las herramientas.
---

**Para qué sirve.** Detrás de este capítulo hay tres superficies de operador. El **gate de seguridad** es la política de ejecución que permite, niega o escala una llamada a herramienta *antes* de que se ejecute. **Eventos de seguridad** (`/security`) es el flujo de esas decisiones. **Auditoría** (`/audit`) es el registro inmutable de acciones (con reversión opcional). **Privacidad** (`/privacy`) es donde editas y pruebas la política de privacidad: qué datos personales se enmascaran cuando un texto sale de EYAS hacia un modelo remoto, qué mensajes nuevos se rechazan — y la misma máscara que el capture de memoria durable aplica *antes* de escribir el vault.

## Cuándo usarlo

- Se negó una llamada a herramienta y necesitas el punto de control, el riesgo y el motivo.
- Quieres confirmar que las herramientas de navegador no pueden llegar a hosts privados o de metadatos (SSRF).
- Vas a activar la autonomía y quieres ver qué escalará el gate.
- Debes comprobar si hay PII filtrándose a los logs, a las notas del vault o a los prompts de salida.
- Quieres saber qué recibe un modelo remoto cuando un prompt lleva una dirección de correo, un IBAN o un número fiscal.
- A un modelo se le rechazó una ruta con *Memory outside EYAS …* o *… is read and written only by EYAS*, y quieres saber por qué — o ver qué sitios están vetados en este servidor.
- Necesitas saber cómo se mantienen las herramientas de IA de línea de comandos (Claude Code, Grok, Kimi, OpenCode) apartadas de la configuración propia de la máquina, cómo se demuestra y si su sandbox de archivos del kernel está activo.
- Un mensaje se rechazó con *Mensaje no enviado: privacidad*, o quieres cambiar qué valores se enmascaran o se rechazan.
- Un modelo se ejecutó sin el aislamiento de EYAS y su memoria debe ocultarse a todos los modelos (ver [Poner en cuarentena la memoria de un proveedor](#quarantine-a-providers-memory)).

## Flujo típico

1. Abre **Seguridad** (`/security`). Arriba está la tarjeta **Memoria fuera de EYAS** (propietarios y administradores). Filtra los eventos por decisión (**Permitir / Denegar / Escalar**), riesgo y punto de control.
2. Abre **Auditoría** (`/audit`) para ver quién hizo qué, módulo, resultado (**correcto / error / denegado / revertido**) y coste. La reversión es una acción con confirmación cuando se ofrece.
3. Abre **Privacidad** (`/privacy`): lee los contadores de tráfico, ajusta la política (acción por tipo, patrones personalizados, hosts locales) y **Guardar política**; después **Probar el analizador de PII** con un texto de ejemplo — *Tal como lo recibe un modelo remoto* es lo que recibiría un modelo remoto.
4. Combínalo con [Autonomía](/docs/es/agents/autonomy/) (aprobaciones) y [Secretos](/docs/es/admin/secrets/).
5. Para SSH a otras máquinas, ver [Nodos](/docs/es/admin/nodes/) — los patrones destructivos necesitan un indicador de forzado explícito.

## Funciones

| Área | Ruta / significado |
|------|--------------------|
| **Gate de seguridad** | Política de ejecución antes de las herramientas peligrosas |
| **Eventos de seguridad** | Flujo de eventos `/security`, con la tarjeta **Memoria fuera de EYAS** |
| **Auditoría** | `/audit`, registro inmutable de acciones |
| **Privacidad** | `/privacy`: contadores de tráfico, editor de la política de privacidad, probador de escaneo |

### Protección SSRF del navegador {#browser-ssrf-protection}

Las herramientas de navegador bloquean peticiones a hosts **privados / de metadatos** (metadatos de la nube, loopback, RFC1918, etc.) para reducir el riesgo de falsificación de peticiones del lado del servidor. Prefiere `browser_snapshot` (elementos interactivos numerados) a las capturas cuando los agentes solo necesitan la estructura. Los índices dejan de valer tras navegar. El perfil headless es de EYAS (`data/browser/profile`); el perfil diario de Chrome se rechaza (Chrome 136+ bloquea CDP en el perfil Default). `browser_evaluate` se ejecuta en la página, no en Node. `browser_totp` es **amarillo**: lee una semilla de Secretos/Llavero y devuelve solo un código de vida corta (pásalo a `browser_fill`). El JSON de la caché de acciones guarda locators, nunca secretos ni valores rellenados. Los sidecars opcionales de [Browser Use](/docs/es/automation/browser-use/) (recomendado: agent-browser en `data/browser/agent-browser/profile`; CLI de Python heredada) nunca desactivan el sandbox de Chromium automáticamente, nunca llaman a `chat` / AI Gateway y nunca se conectan al perfil diario de Chrome.

### Git de solo lectura sin clic {#read-only-git-without-a-click}

`git_status` y `git_diff` son verdes. Cuando el modelo envía en su lugar `run_command` / `Bash` cuyo argv es inequívocamente `git status` o `git diff` (sin metacaracteres, sin `-C` / `--git-dir` / `--no-index`, sin ruta absoluta), el gate reasigna la llamada a esas herramientas y **la permite** — sin fila de aprobación. `git commit`, `git add`, `ls` y cualquier comando con metacaracteres siguen en rojo o se rechazan. Ver [Herramientas](/docs/es/automation/tools/).

### Juez de seguridad {#security-judge}

Las llamadas a herramientas amarillas y rojas pasan una comprobación de IA antes de ejecutarse. Esa comprobación es una llamada corta y aislada en el modelo en segundo plano de EYAS — sin herramientas, sin historial de conversación, nunca una sesión de CLI que cargue la memoria o la config propias de la CLI. Usa el nivel de enrutado **Heartbeat**, luego **Quick**, luego el valor por defecto de la instalación y luego otros proveedores elegibles (cualquier proveedor de API, Claude Code, Grok CLI una vez superada su comprobación de aislamiento al cargar el proveedor (arranque, recarga, reactivación) o el inicio de sesión de un turno, y Kimi Code CLI una vez que ha arrancado una sesión en este host, lo que incluye el descubrimiento de modelos al cargar mientras tiene sesión iniciada para EYAS). Un segundo modelo solo se prueba tras un fallo de red, timeout, sobrecarga o límite de peticiones.

Cuando ningún modelo es elegible (por ejemplo, una instalación solo con Grok cuyo aislamiento aún no está verificado), el presupuesto de modelos está detenido o todos los intentos fallan, la llamada se **escala a tu aprobación** (una petición de aprobación en la cola) — nunca se permite. Antes, una comprobación de IA fallida bloqueaba la llamada directamente. Si la categoría de autonomía de un agente está en el nivel 3 (**Auto**), EYAS ejecuta la llamada sin preguntar, como ya hacía cuando no había ningún proveedor de IA configurado. Una respuesta que la comprobación no puede leer sigue denegando la llamada. En una instalación donde Claude Code es el único modelo, cada comprobación de IA arranca un proceso corto y aislado de Claude Code.

### Memoria fuera de EYAS {#memory-outside-eyas}

El gate de seguridad rechaza la memoria fuera de EYAS — **tanto lecturas como escrituras** — para todos los modelos y cada llamada a herramienta que comprueba. Se rechaza:

- la memoria y el estado de otros asistentes: Claude Code (`~/.claude`, `~/.claude.json`), Grok, Codex, Gemini, Kimi, Cursor, Windsurf, las carpetas de OpenCode, las carpetas compartidas de skills de agentes, Copilot, las mismas carpetas con punto en los directorios personales de otros usuarios, cualquier carpeta `ai-memory` y cualquier carpeta de memoria bajo la carpeta con punto de una herramienta;
- las bóvedas de Obsidian (reconocidas por su carpeta `.obsidian` o por la lista de bóvedas de Obsidian) y los ajustes de la app Obsidian;
- cada ruta listada en `security.foreignMemoryPaths` (se lee al arrancar; las entradas que no son rutas absolutas se ignoran con un aviso en el log);
- la carpeta de datos propia de EYAS — vault, base de datos (también cuando `database.path` apunta a otro sitio), claves, perfil del navegador y las carpetas de inicio de sesión de CLI propias de EYAS (`data/cli-homes`);
- el workspace de otra conversación, siempre que se conozcan las carpetas de trabajo de la llamada.

Sigue permitido: el workspace y las carpetas de la propia conversación, los proyectos de Studio (`data/studio`), las descargas del navegador (`data/browser/downloads`) y los archivos de proyecto normales como `CLAUDE.md`, `AGENTS.md`, `.claude/settings.json`, `.claude/agents` y `docs/MEMORY.md`. Un archivo cuyo texto solo *menciona* estas rutas está bien — el gate juzga la ruta, no el contenido —, y el patrón de búsqueda de Grep nunca se trata como una ruta.

**Dónde se aplica:** las herramientas de EYAS que ejecuta el propio bucle de agente de EYAS (proveedores de API); las herramientas de EYAS que Grok y Kimi llaman a través del puente de herramientas (el puente conoce en el servidor las carpetas del turno, y una petición nunca puede nombrar las suyas); cada llamada a herramienta para la que Claude Code pide permiso; las herramientas integradas propias de Claude Code (Read, Write, Edit, Glob, Grep, Bash, NotebookEdit, WebFetch, …), que pasan una comprobación **antes de ejecutarse** — incluidas las lecturas que Claude Code permitiría por su cuenta dentro de su carpeta de trabajo; cada petición de permiso de Grok/Kimi (Grok pregunta por todas sus herramientas nativas, lecturas incluidas); y cada archivo que Grok o Kimi leen o escriben a través de EYAS. Qué carpetas cuentan como de la conversación lo decide EYAS — sus Carpetas que siguen pasando la validación más la carpeta en la que se arrancó la CLI —, nunca dónde dice la CLI que está. Las tareas de OpenCode sin interfaz se comprueban igual, con las carpetas de la tarea. Grok, Kimi y OpenCode se ejecutan en su propio directorio personal de EYAS, al que apuntan `~` y `$HOME`: una ruta escrita con ellos se juzga como ese directorio y también como el tuyo, así que `~/../../vault` o `$HOME/../../sqlite` no llegan a los datos de EYAS ni a la carpeta de inicio de sesión de otra CLI.

**Una carpeta se juzga por lo que contiene.** Una CLI como Claude Code lee y busca dentro de su carpeta de trabajo sin preguntar — la comprobación de publicación confirmó en el binario real que esas lecturas nunca llegan al paso de aprobación. Por eso una Carpeta de conversación, de proyecto o de tipo de proyecto se rechaza no solo cuando está dentro de uno de los sitios anteriores, sino también cuando **contiene** uno: el directorio propio de EYAS, su carpeta de datos, su base de datos o su carpeta de workspaces (por ejemplo el checkout de EYAS que contiene `data/`), el almacenamiento de otra herramienta de IA o una carpeta de inicio de sesión de CLI de EYAS, una bóveda de notas, una carpeta `ai-memory` o una entrada de `security.foreignMemoryPaths` (por ejemplo un `~/Documents` que contiene una bóveda). Las carpetas guardadas antes que ahora se rechazan quedan fuera de cada ejecución, con un aviso en el chat. Ver [Conversaciones — Carpetas](/docs/es/daily/conversations/#working-folders). En Claude Code, la comprobación de la política de memoria también rechaza las lecturas que Claude Code permite por su cuenta dentro de su carpeta de trabajo — una bóveda o los datos de EYAS alcanzados por una ruta absoluta o relativa, un enlace simbólico, Grep, Glob, LS o un `cat` en el shell; esto se demostró en el binario real.

**Las búsquedas se juzgan por lo que pueden alcanzar.** Una búsqueda con las herramientas propias de una CLI se rechaza no solo cuando su carpeta está protegida, sino también cuando la carpeta en la que busca **contiene** un sitio protegido y sus globs de inclusión pueden llegar a él: a la CLI no se le puede decir que deje ese sitio fuera, así que la llamada se rechaza antes de ejecutarse. Esto cubre Grep, Glob y LS de Claude Code; grep y list_dir de Grok; grep, glob y list de OpenCode; y los comandos de shell ejecutados con el Bash de Claude Code, el shell de Grok y `run_command` de EYAS que buscan de forma recursiva — `grep -r`/`-R`, `rg`, `ag`, `ack`, `find`, `fd`, `tree`, `du`, `ls -R`, `cp`/`rsync`/`scp`/`zip`/`tar`/`ditto` recursivos, `locate`/`mdfind`, `git grep --no-index` — o que usan palabras glob como `cat ~/.*/projects/*/memory/*.md`. Los sitios protegidos son los de la lista anterior.

- **Se rechaza**, por ejemplo: Grep en `~` con el glob `**/memory/*.md`; Glob en `~` de `**/MEMORY.md`; `grep -r token ~`; Grep en `~/Documents` cuando dentro hay una bóveda; un Grep cuya ruta es el checkout de EYAS o una carpeta por encima, como `grep -rn x ~/GitHub` cuando el checkout está dentro (el checkout contiene `data/`).
- **Sigue permitido:** una búsqueda cuya carpeta o glob no puede llegar al sitio protegido — por ejemplo la carpeta `src` del checkout como ruta, o el glob `src/**/*.ts` con el checkout como ruta — y toda búsqueda en una carpeta de proyecto normal. Escribir un archivo con un here-document (`cat > a.ts <<'EOF'` … `EOF`) no es una búsqueda: sus líneas son datos, nunca palabras glob ni comandos. Los globs de exclusión (`!…`) no acotan una búsqueda. Un glob sin barra (`*.md`) coincide a cualquier profundidad, como en ripgrep, así que llega a todas las subcarpetas; las palabras glob del shell se anclan donde están escritas.
- **El mismo rechazo.** Es el mismo rechazo firme y determinista que cualquier otro rechazo de rutas de memoria: sin juez de IA, sin aprobación, ningún permiso concedido lo abre, no cuenta para el bloqueo por 3 denegaciones y rige con el gate apagado. Escribe una fila **Denegar** en Eventos de seguridad (punto de control `deterministic`) y cuenta en el número de rechazos de la [tarjeta Memoria fuera de EYAS](#memory-outside-eyas-card).
- **Cómo se encuentran los sitios.** Los sitios que EYAS conoce por nombre se comprueban siempre: los almacenes de otras herramientas, las bóvedas de Obsidian registradas, `security.foreignMemoryPaths`, la carpeta de datos y la base de datos de EYAS, los directorios personales de las CLI y los workspaces de otras conversaciones. Las bóvedas conocidas solo por su carpeta `.obsidian`, las carpetas `ai-memory`, las carpetas de memoria bajo carpetas con punto de herramientas y los enlaces simbólicos hacia sitios protegidos se encuentran con un recorrido acotado por la carpeta buscada: las primeras 2.000 carpetas, 8 niveles de profundidad, nunca dentro de `node_modules` ni de `.git`/`.hg`/`.svn`. Más allá de ese límite solo se comprueban los sitios con nombre. La lectura de comandos de shell sigue siendo de mejor esfuerzo: no se siguen las variables; sí `cd`, `eval`, `sh -c`, un shell que lee su script de un here-document, las palabras reservadas (`if`, `then`, `do`, `{`, `!`), las redirecciones como `2>/dev/null` y las alternativas entre llaves como `~/{.,}`. Una búsqueda que ejecuta `xargs` o `parallel` recibe sus carpetas de una entrada que la línea de comandos no muestra, así que cuenta como una búsqueda de `/`.
- **`grep` y `glob` propios de EYAS** nunca se rechazan por una carpeta así: dejan fuera las carpetas protegidas y ahora también los archivos protegidos — una base de datos guardada en la carpeta buscada, o un archivo listado en `security.foreignMemoryPaths`, también cuando se nombra directamente.
- **Kimi Code CLI** (según el código fuente de kimi-cli 1.52.0; no verificado en un equipo): Grep y Glob propios de Kimi nunca preguntan a EYAS, así que EYAS no puede rechazar una búsqueda de Kimi que empieza por encima de un sitio protegido. El Glob de Kimi se queda dentro de su carpeta de trabajo, pero su Grep acepta cualquier carpeta, y Kimi no tiene sandbox del kernel. Los comandos de shell de Kimi sí preguntan, pero la petición no lleva el comando en una forma que la comprobación de rutas pueda leer, así que decide el juez de IA o una persona.

**Cómo rechaza:** al instante y de forma determinista. No hay juez de IA ni petición de aprobación, y ninguna aprobación ni permiso concedido lo abre. El rechazo no cuenta para el bloqueo por 3 denegaciones, así que un modelo que reintenta una ruta prohibida no bloquea otras herramientas durante 10 minutos. También rige con el gate de seguridad apagado. Cada rechazo es una fila en **Eventos de seguridad** — decisión **Denegar**, punto de control `deterministic` y un motivo. La comprobación falla cerrada: si no puede responder, la llamada se rechaza. Solo una llamada única en segundo plano sin ninguna herramienta corre sin ella.

**Qué se le dice al modelo:**

- *Memory outside EYAS (&lt;store&gt;) — use memory_search / memory_expand from EYAS*
- *EYAS data directory (&lt;part&gt;) is read and written only by EYAS*
- *EYAS-owned CLI home (cli-homes) is read and written only by EYAS*
- *Not this conversation's workspace (…) — work in this conversation's folders*
- *Search too broad [memory-path:search-scope:&lt;target&gt;]: the folder searched contains &lt;what&gt;, and this tool cannot leave it out — search a narrower folder that does not contain it* — para la memoria de otra herramienta añade *; for memory use memory_search / memory_expand from EYAS*. El destino es `foreign-memory`, `eyas-data`, `provider-home` u `other-workspace`. La fila de herramienta **Denegado** del chat lo convierte en una línea traducida, por ejemplo *Búsqueda demasiado amplia: la carpeta también contiene la memoria de otra herramienta, que solo EYAS puede leer. Se pidió al modelo que buscara en una carpeta más concreta.* — o los datos propios de EYAS, los inicios de sesión de CLI que guarda EYAS, o el espacio de trabajo de otra conversación.

Grok CLI no pasa el motivo a su modelo: cuando EYAS rechaza una de las llamadas a herramienta de Grok, Grok termina esa respuesta, y el chat muestra la fila de herramienta rechazada y nada después. Vuelve a pedirlo sin ese paso — tras un rechazo *Búsqueda demasiado amplia*, con una carpeta más concreta. Claude Code sigue adelante y recibe el motivo, así que puede reintentar por sí mismo una búsqueda en una carpeta más concreta. Ver [Proveedores — Grok CLI y Kimi Code CLI](/docs/es/ai/providers/#grok-cli-and-kimi-code-cli).

**La capa del kernel.** Los comandos de shell pueden llegar a una ruta que el texto del comando no muestra, y algunas herramientas de CLI nunca preguntan a EYAS. Para esos casos, el shell de Claude Code y las herramientas propias de Grok CLI se ejecutan dentro del sandbox de archivos del sistema operativo (macOS Seatbelt, Linux bubblewrap), que bloquea los mismos sitios en el kernel: la memoria de otras herramientas, los datos privados de EYAS y los workspaces de otras conversaciones. Con `security.cliSandbox: auto` (por defecto), una CLI se ejecuta sin él donde no hay ninguno disponible y el chat lo dice una vez; con `required`, esos turnos se rechazan. En `auto`, un comando de Claude Code que pide ejecutarse fuera del sandbox siempre espera la aprobación de una persona — nunca el juez de IA, nunca la escala de autonomía. Kimi Code CLI no tiene sandbox del kernel, así que sus propias herramientas de lectura, grep y glob solo se comprueban donde EYAS las ve. Ver [Proveedores — Sandbox de archivos del kernel](/docs/es/ai/providers/#kernel-file-sandbox). La [importación de datos](/docs/es/admin/data-port/) no se ve afectada, porque lee ella misma los almacenes de otras herramientas y no a través de una herramienta del modelo.

**Migración.** Los agentes que antes leían directamente `~/.claude/CLAUDE.md`, la memoria de `~/.grok`, notas de bóvedas o archivos bajo `data/` ahora reciben un rechazo (Eventos de seguridad lo muestra). Trae ese conocimiento a EYAS una vez con la importación de datos. Los agentes o las costumbres que buscaban en todo el directorio personal o en una carpeta superior con las herramientas propias de una CLI también reciben un rechazo: apúntalos a una subcarpeta, o usa `grep`/`glob` de EYAS, que dejan fuera los sitios protegidos. Una Carpeta que contiene un sitio protegido — el checkout de EYAS, un `~/Documents` con una bóveda — ya no se acepta: elige una carpeta más concreta, como la carpeta del proyecto dentro de `~/Documents` o un clon aparte del repositorio. Los servidores MCP que guardan memoria fuera de EYAS también están bloqueados — ver [MCP](/docs/es/ai/mcp/#memory-store-servers-are-blocked).

### La tarjeta Memoria fuera de EYAS {#memory-outside-eyas-card}

La página **Eventos de seguridad** (`/security`) empieza con una tarjeta **Memoria fuera de EYAS**. Solo la ven propietarios y administradores, porque muestra rutas absolutas del servidor; los demás roles reciben un error de carga y ninguna ruta. Muestra:

- **Dos contadores de las últimas 24 horas.** *Rechazos de la política de memoria* cuenta las llamadas a herramientas que la política de memoria rechazó en cualquier canal — leer o escribir la memoria de otra herramienta, una bóveda de Obsidian, la carpeta de datos propia de EYAS, su base de datos o los inicios de sesión de las CLI, o el workspace de otra conversación, y las búsquedas rechazadas por demasiado amplias porque su carpeta contiene uno de ellos. *Comandos que pidieron salir del sandbox* cuenta los comandos de shell que pidieron ejecutarse fuera del sandbox del kernel y se enviaron a una persona para su aprobación.
- **Memoria de otras herramientas en este servidor** — los almacenes conocidos de otras herramientas de IA y apps de notas que existen aquí (por ejemplo `~/.claude`, `~/.grok`, `~/.codex`, las carpetas de OpenCode, los ajustes de la app Obsidian), con sus rutas, y cuántas ubicaciones conocidas más quedan protegidas en cuanto aparezcan. Una frase explica qué más está protegido esté donde esté: cualquier carpeta que contenga una carpeta `.obsidian` (una bóveda de Obsidian), las carpetas llamadas `ai-memory` y las carpetas de memoria dentro de `.claude`, `.grok`, `.codex` y carpetas de herramientas similares.
- **Vaults de Obsidian encontrados** — las bóvedas de la propia lista de bóvedas de Obsidian, más las que EYAS reconoció por su carpeta `.obsidian` al comprobar llamadas a herramientas. Una bóveda que no aparece en la lista sigue protegida por su carpeta `.obsidian`.
- **Tus añadidos (security.foreignMemoryPaths)** — las rutas extra de la configuración. Las rutas que aún no existen se marcan *aún no está en este servidor*; las entradas que no son rutas absolutas se marcan *ignorada*. Para proteger otra carpeta o archivo, añade su ruta absoluta a `security.foreignMemoryPaths` en el archivo de configuración y reinicia EYAS (la lista se lee al arrancar).
- **Datos propios de EYAS** — la carpeta de datos, la base de datos y los inicios de sesión de las CLI (los directorios personales de CLI propios de EYAS). Solo EYAS los lee y escribe; los modelos pueden usar el workspace de su conversación, los proyectos de Studio y las descargas del navegador.
- **Espacios de trabajo de las conversaciones** — la raíz de los workspaces. El modelo de cada conversación solo ve allí su propio workspace.
- **Sandbox de archivos del kernel de los proveedores CLI** — el modo de `security.cliSandbox` (`auto` o `required`) y, para cada proveedor CLI activado (Claude Code, Grok CLI, Kimi Code CLI), si sus propias herramientas se ejecutan en el sandbox del kernel: *activo*, *no disponible* o *no compatible*, con el motivo (bubblewrap no está instalado, falta socat — que Claude Code necesita —, user namespaces desactivados, sistema operativo no compatible, o la CLI no ofrece ninguno). Con `required` y sin sandbox, la tarjeta dice que en esa CLI se rechazan los turnos con herramientas. Con *no disponible* o *no compatible* en `auto`, las herramientas propias de la CLI se ejecutan sin el sandbox y EYAS sigue comprobando cada llamada a herramienta que ve. Con `auto` y un sandbox de Claude Code activo, un comando de Claude Code que pide ejecutarse fuera del sandbox siempre espera la aprobación de una persona.

**API.** `GET /api/v1/security/memory-policy` (read sobre `SecurityEvent`). No hay ajustes ni variables de entorno nuevos.

### Las herramientas de IA de línea de comandos corren aisladas {#ai-command-line-tools-run-isolated}

- **Claude Code** siempre corre aislado: sin `settings.json`, `CLAUDE.md`, skills, servidores MCP ni auto-memoria del host, sin transcripciones en el host, con un entorno en lista blanca y una comprobación al arrancar que detiene una ejecución si se cargó cualquier otra cosa. Ver [Proveedores — Aislamiento de Claude Code](/docs/es/ai/providers/#claude-code-isolation).
- **Grok CLI y Kimi Code CLI** corren en directorios personales propios de EYAS (`data/cli-homes/…`, que guardan sus inicios de sesión para EYAS), preguntan a EYAS antes de sus herramientas nativas y solo corren después de que EYAS haya comprobado que están aisladas — un turno que no pasa la comprobación se detiene y nunca se pasa a otro modelo. Ver [Proveedores — Grok CLI y Kimi Code CLI](/docs/es/ai/providers/#grok-cli-and-kimi-code-cli).
- **OpenCode**, el sidecar opcional, corre en una carpeta propia de EYAS (`cli-homes/opencode`, que guarda su inicio de sesión) y no carga instrucciones, skills ni config de proyecto de asistentes del host. Las tareas de OpenCode sin interfaz preguntan al gate de seguridad de EYAS antes de cada llamada a herramienta. OpenCode lee la memoria de EYAS solo con las herramientas de solo lectura `memory_search` / `memory_expand`; no tiene ninguna herramienta que escriba memoria. Cada proceso de OpenCode que arranca EYAS recibe su propia clave en el descriptor de archivo 3 — nunca en un entorno, una lista de argumentos ni un archivo —, y la clave muere con ese proceso. La clave en sí nunca sale de OpenCode: cada llamada de memoria lleva una prueba de un solo uso para la única sesión de OpenCode en la que se ejecuta la herramienta, así que ni un comando que ejecute el modelo ni otro proceso pueden leer la memoria de otra sesión. Límites que quedan: OpenCode lee su contraseña de servidor solo de su entorno, así que un proceso del mismo usuario del sistema que pueda leer el entorno de otro proceso puede manejar las sesiones de ese servidor de OpenCode a través de la propia API de OpenCode; OpenCode no tiene sandbox del kernel; y un proceso autorizado a leer la memoria de otro proceso puede llegar a la clave. Una URL de conexión a un servidor de OpenCode externo no está aislada y no tiene acceso a la memoria de EYAS. Ver [OpenCode](/docs/es/automation/opencode/#eyas-memory-inside-opencode).
- **Sandbox de archivos del kernel.** Los comandos de shell de Claude Code y las herramientas propias de Grok CLI se ejecutan dentro del sandbox de archivos del sistema operativo donde lo hay (`security.cliSandbox`); Kimi Code CLI no tiene ninguno. Ver [Proveedores — Sandbox de archivos del kernel](/docs/es/ai/providers/#kernel-file-sandbox).

### Cómo se demuestra el aislamiento {#how-isolation-is-proven}

Cada ejecución de una CLI se comprueba al arrancar (ver arriba). Además, cada versión de CLI que EYAS admite se demuestra antes de publicarse con una **comprobación de publicación**, `bun run test:live-cli`, que ejecutan los desarrolladores y los responsables de las publicaciones. Arranca Claude Code y Grok CLI reales (y Kimi Code CLI donde esté instalado) a través de los propios proveedores de EYAS, en un directorio personal desechable lleno de trampas: ajustes del host que lo permiten todo, hooks y servidores MCP que dejarían rastro si se ejecutaran, `CLAUDE.md`, `AGENTS.md`, skills, una bóveda al estilo Obsidian y una carpeta de proyecto con su propia config. La parte gratuita envía cada petición de modelo a un modelo falso en la máquina local, así que no necesita cuenta ni gasta tokens. La parte de pago ejecuta turnos reales de modelo con el inicio de sesión del propio propietario y se aprueba en cada ejecución.

La comprobación verifica que:

- no se carga ninguna config del host ni del proyecto, ningún archivo de instrucciones, hook ni servidor MCP;
- cada archivo que lee Grok se pide a través de EYAS, y la bóveda queda fuera;
- la política de memoria de EYAS rechaza la bóveda y la carpeta de datos propia de EYAS;
- el sandbox de archivos del sistema operativo detiene una lectura oculta de la bóveda en el shell de Claude Code;
- una lectura normal del workspace sigue funcionando;
- no queda ningún almacén de sesiones en los directorios personales de CLI de EYAS;
- Grok y Kimi no cambian nada en el directorio personal del host;
- Claude Code solo escribe en el host una lista corta y versionada de archivos de contabilidad, nunca contenido de conversaciones;
- la carpeta temporal de Claude Code, donde va la salida de los comandos de shell en segundo plano, es la carpeta propia de la ejecución en EYAS y desaparece al terminarla — no queda nada en el `/tmp/claude-<uid>` del host.

Esa lista: `~/.claude.json` limitado a claves de arranque y contabilidad (primer arranque, migraciones, caché de feature flags, contadores de uso de plugins), más sus copias de seguridad y su carpeta de bloqueo; carpetas vacías de sesión y de marcadores bajo `~/.claude` y `~/.config/anthropic`; instantáneas del shell sin contenido de conversaciones; el log propio de npm de `npm root --global` en `~/.npm/_logs`; la caché de Bun cuando el `node` del PATH es Bun; y, en hosts sin llavero, el archivo de renovación del inicio de sesión. Nunca una transcripción, una lista de tareas, un historial de archivos, un plan ni un historial de prompts.

**Prueba de memoria.** En Claude Code y Grok CLI la comprobación también pasa la política de memoria por el gate de seguridad real. Una carpeta registrada solo en `security.foreignMemoryPaths` se rechaza tanto a la lectura de archivos propia del modelo como a un `cat` en el shell, y una escritura en la bóveda de EYAS se rechaza. Cada rechazo es exactamente una fila **Denegar** en Eventos de seguridad de la política de memoria (punto de control `deterministic`, nunca un bloqueo por límite de peticiones) y una fila de herramienta rechazada. Una lectura del workspace después de esos rechazos sigue funcionando, y nada de la carpeta rechazada llega al modelo. Dos casos gratuitos más cubren las búsquedas: Grep, Glob y `grep -r` de Claude Code, y grep y list_dir de Grok, con raíz en el directorio personal lleno de trampas, los rechaza cada uno la política de memoria a través del gate real — auditados y con una fila de herramienta rechazada —, mientras una búsqueda en la carpeta del proyecto sigue funcionando. Un tercero muestra que Claude Code lee un archivo de su carpeta de trabajo sin pasar por la comprobación de permisos de EYAS, y que la comprobación de la política de memoria rechaza esa lectura cuando cae en una bóveda.

**Versiones demostradas:** Claude Code 2.1.281 y Grok CLI 1.0.41, solo la parte gratuita. Kimi Code CLI aún no está demostrado y no tiene prueba de memoria. Dos hallazgos de la comprobación están integrados en las comprobaciones de arranque:

- Claude Code 2.1.281 declara dos plugins compilados en el binario, `agents-md` y `telemetry`. Solo se aceptan como `<nombre>@builtin`, porque la comprobación demostró que son inofensivos bajo el aislamiento de EYAS: ningún `AGENTS.md` de la carpeta de trabajo ni de una subcarpeta llega al modelo. Cualquier otro plugin, incluido un nuevo plugin integrado de una versión posterior de Claude Code, sigue deteniendo la ejecución.
- Grok CLI 1.0.41 escribe una caché de ajustes gestionados por el proveedor (`managed_config.toml`) en su directorio personal de EYAS, vacía para una cuenta normal. Una vacía se acepta; una que contenga cualquier ajuste sigue deteniendo el turno.

**`eyas doctor`** muestra una línea por proveedor CLI: *CLI isolation (Claude Code)*, *CLI isolation (Grok CLI)* y *CLI isolation (Kimi Code CLI)*. Cada una nombra el binario que ejecuta EYAS — cómo se encontró (`EYAS_CLAUDE_CODE_BIN` / `EYAS_GROK_BIN` / `EYAS_KIMI_BIN`, en el PATH o incluido en el SDK), su ruta y su versión — y si la comprobación de publicación demostró esa versión. Una versión distinta, un binario que no informa de su versión o una CLI nunca demostrada es un aviso, no una parada: EYAS sigue comprobando cada sesión al arrancar. Una CLI no instalada está bien; un `EYAS_*_BIN` no válido es un fallo. Para Grok y Kimi la línea también comprueba su directorio personal de EYAS, `<carpeta de datos>/cli-homes/<proveedor>`: si aún no existe, está bien; si es un enlace simbólico o no es una carpeta, es un fallo (EYAS no ejecuta la CLI; bórralo y la siguiente ejecución lo recrea); si otros usuarios pueden leerlo, es un aviso, porque guarda el inicio de sesión de la CLI (`chmod 700 <carpeta>`); si un archivo que EYAS gestiona allí cambió desde que EYAS lo escribió, es un aviso — EYAS reescribe esos archivos antes de la siguiente ejecución, así que un cambio entre ejecuciones significa que otra cosa edita esa carpeta. Doctor solo lee: únicamente ejecuta `--version`. Ver [CLI](/docs/es/deploy/cli/).

### Poner en cuarentena la memoria de un proveedor {#quarantine-a-providers-memory}

Si un modelo — normalmente una CLI como Grok CLI, Kimi CLI o Claude Code — se ejecutó sin el aislamiento de EYAS, pudo responder con memoria ajena a EYAS, y sus respuestas se guardaron en la memoria de EYAS como cualquier otro turno. El propietario puede ocultar a todos los modelos lo que escribió un proveedor — sus respuestas y la salida de sus herramientas, los hechos y resúmenes derivados de ellas y las notas capturadas de sus conversaciones — y liberarlo después. No se borra nada, y los mensajes propios del propietario nunca se tocan. La tarjeta está en **Memoria → Resumen**; ver [Memoria — Poner en cuarentena la memoria de un proveedor](/docs/es/knowledge/memory/#quarantine-a-providers-memory). Cada aplicación y liberación se escribe en el registro de auditoría (`memory.quarantine.apply` / `memory.quarantine.release`).

### SSH a nodos remotos {#remote-node-ssh}

La **invocación SSH** de nodos remotos (desde Nodos) ejecuta comandos protegidos; los patrones de comando **destructivos** exigen un indicador de forzado explícito. Los tipos de nodo que no son SSH pueden devolver «no implementado» para la invocación.

### Memoria en reposo {#memory-at-rest}

Las notas duraderas se enmascaran en el módulo de privacidad **antes de tocar el disco**, no al leerlas — una redacción al leer dejaría el texto en bruto en el archivo y en el índice FTS. Es la misma función y las mismas reglas que para el tráfico saliente hacia los modelos: las fechas se conservan y los valores de clase mask y block se sustituyen, así que un IBAN en una nota se guarda como `[IBAN]` (las versiones anteriores solo sustituían correos y teléfonos en las notas). El registro en bruto de la conversación, los resúmenes de conversación y los hechos quedan sin enmascarar dentro de EYAS y solo se enmascaran cuando salen. El capture en sí se conmuta con `memory.capture.enabled` en `config/default.yaml` (por defecto **on**). Ver [Memoria](/docs/es/knowledge/memory/) y [FAQ](/docs/es/reference/faq/).

**Las notas escritas por un modelo pasan el filtro de instrucciones.** Las notas de vault que escribe un modelo — el capture de memoria por turno, los resúmenes de la consolidación nocturna y los resúmenes de las sesiones de equipo — pasan el mismo filtro que EYAS ya usa para hechos y resúmenes. Un texto que parece una instrucción para el asistente (*ignore previous instructions*, *from now on you are…*, etiquetas `<system>` falsas, *delete all memory*, en inglés, húngaro, alemán, español y francés) nunca se escribe. Los rechazos aparecen en el log del servidor con el nombre del detector, nunca con el texto. Cada nota así lleva además un `origin` en su frontmatter y se recuerda como escrita por un modelo, nunca como tus propias palabras. Ver [Memoria — Por qué se rechazan algunas frases](/docs/es/knowledge/memory/#why-some-sentences-are-refused).

## Política de privacidad {#privacy-policy}

EYAS guarda sus datos en bruto y **enmascara los datos personales cuando un texto sale de EYAS hacia un modelo remoto**. Una única función determinista hace el enmascarado, igual para prompts, resultados de herramientas de memoria, embeddings y notas del vault.

### Cómo funciona la detección {#how-detection-works}

La detección se basa en reglas y es determinista: el mismo texto da siempre el mismo resultado, y nunca se envía nada a un modelo para detectar datos personales. Está **limitada a la línea**: un valor partido en dos líneas no se detecta, y una palabra de teléfono o de impuestos solo cuenta si está en la misma línea que el número.

Nunca se tratan como datos personales: fechas de calendario en cualquier formato habitual (`2026-09-08`, `2026.09.30.`, `2026. 09. 30.`, `22.09.2026`, `09/22/2026`), horas, marcas de tiempo ISO, direcciones IP, versiones de software (`1.0.40`, `0.8.29-beta`), importes (decimales, o números junto a una moneda como HUF/Ft/EUR/€/$) e ids de registros, tickets, builds, commits y marcas de tiempo, UUID, ULID y hashes. La línea *Current date* del prompt llega intacta a todos los modelos.

### Qué se detecta {#what-is-detected}

| Tipo | Cómo se reconoce y se valida |
|------|------------------------------|
| `email` | Forma estándar de dirección |
| `phone` | Un número internacional que empieza por `+` (8–15 dígitos); un número con prefijo de zona entre paréntesis; el formato nacional húngaro (06/36 + prefijo + 6–7 dígitos); o cualquier número de 7–15 dígitos con una palabra de teléfono hasta 40 caracteres antes, en la misma línea. Las palabras de teléfono solo cuentan como palabras completas: phone, tel, mobile, cell, call, fax, WhatsApp, telefon, mobil, hívj, Handy, Telefonnummer, teléfono, móvil, téléphone, Tél., portable y similares. Los números escritos sin `+`, sin formato nacional y sin palabra de teléfono no se detectan a propósito. |
| `iban` | IBAN de todos los países, compactos o agrupados con espacios, validados con el checksum oficial mod-97 y la longitud exacta del país (las versiones anteriores solo detectaban IBAN húngaros) |
| `bank_account` | Números de cuenta giro húngaros, 8-8 u 8-8-8 dígitos (espacio o guion), validados con el checksum por bloques 9-7-3-1 |
| `credit_card` | 13–19 dígitos con prefijo de red de tarjeta, validados con Luhn |
| `ssn` | Número de la seguridad social de EE. UU. `AAA-GG-SSSS` con área, grupo y serie válidos |
| `personal_id` | Número del documento de identidad húngaro (6 dígitos + 2 mayúsculas) como token independiente |
| `tax_number` | Número fiscal húngaro (adószám, `12345676-2-42`) con dígito de control válido, código de IVA 1–5 y código de provincia real; número de IVA UE húngaro (`HU12345676`); y el identificador fiscal personal húngaro (adóazonosító jel, 10 dígitos que empiezan por 8) solo con dígito de control válido **y** una palabra de identificador fiscal delante (adóazonosító, adószám, tax ID, TIN, Steuer-ID, NIF, numéro fiscal, …). Las palabras solo cuentan completas, así que `tin` en *routine* o `tax` en *syntax* no disparan nada, y un número cualquiera de 10 dígitos junto a la palabra *tax* no es un número fiscal. |
| `taj_number` | Número TAJ húngaro, validado con su dígito de control |

Los nombres y las direcciones postales no se detectan. Usa [patrones personalizados](#custom-patterns) para ellos y para cualquier otro identificador propio de tu organización.

No hay escáner basado en modelo. El antiguo escáner NER, que enviaba en silencio el texto del prompt a un Ollama local, se ha eliminado; si `ner` sigue listado en `privacy.scanners` en `config/personality/privacy.yaml`, se ignora y se registra un aviso.

### Acciones {#actions}

Cada tipo detectado tiene una acción:

| Acción | Efecto |
|--------|--------|
| `off` | Se ignora |
| `warn` | Se cuenta y se registra; el texto queda como está |
| `mask` | Se sustituye por un marcador como `[EMAIL]` o `[IBAN]` cuando el texto sale de EYAS hacia un modelo remoto |
| `block` | Se enmascara igual a la salida; y un mensaje **nuevo** de chat o de canal que lo lleve se rechaza antes de guardarse cuando iría a un modelo remoto (ver [Mensajes rechazados](#refused-messages)) |

Por defecto: `email` y `phone` son **mask**; `iban`, `bank_account`, `tax_number`, `personal_id`, `credit_card` y `ssn` son **block**; `taj_number` es **warn**.

**Enmascarar nunca detiene una llamada al modelo.** Un valor de clase block en cualquier parte de un prompt — por ejemplo un IBAN en una nota de memoria — se enmascara y el turno sigue; el capture de memoria tampoco falla en esos turnos. `block` solo tiene un efecto más: rechaza un mensaje **nuevo** que envías.

### Mensajes rechazados {#refused-messages}

Solo se puede rechazar un mensaje **nuevo** que envía un usuario — en el chat, en una conversación de Modo Dios o a través de un canal (Telegram, Slack, Discord, correo, WhatsApp, Signal, …). Todo lo demás que EYAS envía a un modelo (historial, memoria, resultados de herramientas, texto extraído de los adjuntos, embeddings) nunca se rechaza; se enmascara al salir.

Un mensaje se rechaza cuando contiene un valor de clase block **y** además iría a un modelo remoto. Local significa que el host del endpoint del modelo es loopback (`localhost`, `127.x`, `::1`) o está en los hosts locales de la política; los proveedores CLI (Claude Code, Grok CLI, Kimi CLI) y los endpoints desconocidos cuentan como remotos. El destino es el modelo en el que se ejecutará el mensaje (una anulación de modelo para un turno, el modelo fijo de la conversación o el modelo de su colega). Una conversación puesta en Auto cuenta siempre como remota, porque su modelo se elige por mensaje después de la comprobación — salvo que el auto-enrutado esté desactivado globalmente, y entonces se juzga su modelo guardado. En Modo Dios se juzga a cada participante de la plantilla; si alguno es remoto, o la plantilla está vacía, el mensaje se rechaza. Con la política o el módulo de privacidad desactivados, no se rechaza nada.

- **En el chat,** el mensaje rechazado no se guarda: ninguna entrada en la transcripción, ningún cambio de nombre, ninguna memoria, ninguna llamada al modelo, ninguna carrera de Modo Dios. Una tarjeta sobre el compositor, **Mensaje no enviado: privacidad**, lista los tipos (nunca los valores) y ofrece **Enviar con estos datos enmascarados**, **Editar mensaje** y **Descartar**. Ver [Conversaciones — Mensajes rechazados](/docs/es/daily/conversations/#refused-messages-privacy).
- **En un canal,** el remitente recibe una respuesta automática en el idioma en que escribió (inglés, húngaro, alemán, español, francés o klingon; inglés si no está claro), que nombra los tipos, nunca los valores, y le pide que vuelva a enviarlo sin esos valores. No se crea ninguna conversación, mensaje ni ejecución de agente; el evento de entrada muestra el estado **omitido** con el error `privacy_blocked`, y solo se conserva su texto enmascarado. Ver [Canales](/docs/es/communication/channels/#refused-messages).
- Los mensajes ya guardados antes de un cambio de política no se rechazan después.

Cada rechazo escribe la acción de auditoría `privacy.inbound_refused`, y cada *enviar enmascarado* escribe `privacy.inbound_masked`; ambas registran los tipos, la conversación (chat) o el id del evento de entrada (canales) y el usuario — nunca un valor.

### Patrones personalizados {#custom-patterns}

Cada patrón personalizado tiene un `name`, una `regex`, un slug `type` en minúsculas que se convierte en el marcador (por ejemplo `[INTERNAL_PROJECT]`) y su propia `action`. Se añaden en la [página Privacidad](#privacy) (hasta 50); los patrones que comparten un tipo usan la acción del primer patrón. Los patrones están limitados a la línea: nunca coinciden a través de un salto de línea, y `^` / `$` anclan al inicio y al final de una línea. Un patrón inseguro (backtracking catastrófico) o que no compila se omite y se informa en el log del servidor. Un patrón que puede coincidir con una cadena vacía ya no cuelga el escáner.

### Hosts locales: quién recibe el texto sin enmascarar {#local-hosts-who-receives-text-unmasked}

El texto solo se envía sin enmascarar cuando el endpoint del modelo está en esta máquina: un endpoint loopback (`localhost`, `127.x.x.x`, `::1`) o un host listado en los **hosts locales** de la política (hasta 32 nombres de host o direcciones IP, sin esquema ni puerto). Lo decide el host del endpoint al que envía el proveedor, nunca el nombre del proveedor:

- Un Ollama o LM Studio local está exento; un **`OLLAMA_HOST` remoto se enmascara**. Si contabas con la antigua exención de Ollama para un host Ollama remoto, añade ese host a los hosts locales.
- Los hosts de la LAN no listados, las APIs cloud, los endpoints desconocidos y todos los proveedores CLI (Claude Code, Grok CLI, Kimi CLI) cuentan como remotos — EYAS no puede ver adónde envía un CLI su tráfico.
- La antigua acción `auto_local` (redirigir a un Ollama local) ya no existe; una regla `auto_local` heredada se trata como `mask`, con un aviso en el log.

### Completions almacenadas (OpenAI) {#stored-completions-openai}

Las peticiones al proveedor **OpenAI** integrado rechazan explícitamente las *stored completions* de OpenAI, tanto en chat como en streaming y en llamadas a herramientas. Así OpenAI no guarda las conversaciones de EYAS para sus funciones de destilación o evaluación, aunque *store completions* esté activado en tu cuenta o proyecto de OpenAI. No hay nada que configurar. También vale cuando `OPENAI_BASE_URL` redirige el proveedor OpenAI integrado. Los proveedores compatibles con OpenAI (xAI, Mistral, Groq, DeepSeek y el resto del catálogo compatible, OpenRouter, Kimi API, LM Studio) no reciben el indicador, porque algunos de esos servicios rechazan parámetros desconocidos; lo que guardan lo fijan sus propios ajustes de cuenta y condiciones. Los embeddings no se ven afectados.

### Dónde se aplica el enmascarado {#where-masking-applies}

El enmascarado ocurre dentro del gateway de modelos en **cada intento, para el proveedor que realmente responde**. Si una llamada se reintenta o salta al proveedor de fallback de un nivel, cada intento se enmascara para su propio destino: un Ollama local primario recibe el texto en bruto y, si falla y la llamada pasa a un fallback cloud, el proveedor cloud recibe el texto enmascarado. La comprobación rápida de enrutado que corre antes de un turno de chat también se enmascara.

Para un destino remoto, EYAS enmascara:

- el system prompt, sección por sección: memoria, persona y archivos del agente, contexto del proyecto, skills, diseños y cualquier texto que EYAS no pueda atribuir a una sección;
- el historial de la conversación;
- los resultados de las herramientas de memoria de EYAS, incluidos sus textos de error: `memory_search`, `search_memory`, `memory_expand`, `search_knowledge`, `get_page`, `read_team_memory`;
- los textos enviados a un proveedor de embeddings remoto.

No se enmascaran:

- las secciones que escribe EYAS mismo — identidad, reglas básicas, el bloque de runtime con fecha y hora, carpetas de trabajo, las listas de herramientas, skills y agentes, la directiva de orquestación —, así que el modelo siempre lee literalmente la fecha de hoy y sus carpetas;
- los resultados de las herramientas de workspace (archivos, shell, git, grep, navegador, documentos, búsqueda de código). Las herramientas nativas de los CLI no se pueden enmascarar de todos modos, y enmascarar escribiría marcadores como `[EMAIL]` de vuelta en los archivos que edita el modelo.

Un mismo elemento de memoria se enmascara igual tanto si EYAS lo mete en el prompt como si el modelo lo trae con una herramienta de memoria — es la misma función. Eso vale en **todos los caminos** que un modelo puede usar para leer la memoria de EYAS:

- los proveedores cuyo bucle de herramientas corre dentro de EYAS (proveedores API y locales);
- las herramientas de EYAS en proceso de Claude Code (`mcp__eyas__*`);
- Grok CLI y Kimi CLI por el puente MCP de EYAS;
- los clientes MCP externos que llaman al propio servidor MCP de EYAS (`POST /api/v1/mcp/tools/call`);
- el sidecar de OpenCode: el prompt de la tarea de `opencode_run` y la memoria recordada que se envía como su texto de sistema se enmascaran antes de llegar a OpenCode (el título de la sesión de OpenCode sale del prompt enmascarado), y lo mismo las respuestas de `memory_search` / `memory_expand` dentro de OpenCode.

Una CLI, un cliente MCP externo y OpenCode cuentan siempre como remotos, porque pueden ejecutar cualquier modelo: nada en una petición puede hacerlos locales, y la lista de hosts locales no los exime. Los valores de clase mask y block se sustituyen por marcadores `[TYPE]`; las fechas, las horas, los ids, los números y la estructura JSON se conservan.

**Falla cerrado.** Si el propio análisis de privacidad falla, el resultado de la herramienta de memoria no se envía: el modelo recibe *Error: memory tool result withheld (privacy scan failed)*, y una tarea de OpenCode falla con *privacy scan failed — the task was not sent to OpenCode* — no llega nada a OpenCode. El log registra solo tipos, recuentos e identidad (conversación, ejecución, agente, turno, herramienta, transporte), nunca un valor: *Privacy: masked values in a tool result sent past the model gateway* o *warn-class values in a tool result sent past the model gateway*.

Un cambio de política surte efecto desde el siguiente turno. Un turno ya en marcha conserva la política con la que empezó, así que un bucle de herramientas se enmascara de forma coherente.

### Dónde vive la política {#where-the-policy-lives}

La política se guarda en la base de datos de EYAS. `config/personality/privacy.yaml` es su semilla: se vuelve a importar automáticamente cuando el archivo cambia, sin reiniciar, hasta que la política se guarda por primera vez en la [página Privacidad](#privacy). A partir de ahí gana la política guardada y los cambios en el archivo se ignoran con un aviso en el log.

Un `privacy.yaml` ausente o inválido ya no vuelve en silencio a los valores por defecto: el error se registra con la ruta completa del archivo y los motivos, y sigue en vigor la última política buena. En una primera instalación sin archivo legible se aplican los valores por defecto incorporados.

El formato heredado (`scanners` / `rules` / `custom_patterns`) se sigue aceptando:

- Para cada tipo decide la primera regla que coincide; un tipo sin regla que coincida es `warn`.
- `sanitize` pasa a ser `mask`; `auto_local` pasa a ser `mask` con un aviso; `ner` se ignora con un aviso.
- Un escáner que falta en `scanners` apaga sus detecciones.
- Las reglas o patrones inutilizables se descartan con un aviso.

**Auditoría.** Con `audit` activado, cada llamada al modelo que enmascaró (o avisó de) algo escribe **una** entrada de auditoría, acción `privacy.egress`, dirigida a la conversación. Sustituye a las antiguas entradas `privacy.detected`, una por coincidencia, que ya no se escriben. La entrada lista los ids de conversación, ejecución, agente y composición (o turno); el proveedor; el destino (remoto); el transporte (`gateway`, `embed`, `mcp-bridge`, `mcp-external`, `opencode`); la versión de la política; los recuentos de enmascarados y avisados; los recuentos por tipo; las secciones del prompt implicadas (`unattributed` = texto de sistema fuera de las secciones registradas); el número de coincidencias en el historial de la conversación; y las herramientas de memoria implicadas. Un resultado de herramienta de memoria enviado fuera del gateway recibe su propia entrada. Los valores detectados nunca se registran ni se guardan. Los cambios de política se auditan siempre como `privacy.policy.updated` (versión, origen, tipos cambiados y el usuario que guardó — nunca valores). Las líneas de log dicen *Privacy: masked values in outgoing model traffic* o *warn-class values in outgoing model traffic*, y ahora nombran también la conversación, la composición, las secciones y las herramientas. El inspector de contexto muestra por sección del prompt qué se enmascaró — ver [Conversaciones — Composición del contexto](/docs/es/daily/conversations/#context-composition).

**Actualización.** No hay nada que hacer: los `privacy.yaml` existentes en el formato antiguo siguen funcionando, y un `privacy.yaml` existente sigue siendo la semilla de la política hasta el primer guardado en la página. El texto que el escáner antiguo guardó con una fecha sustituida por `[PHONE]` — por ejemplo en una nota del vault — no se repara automáticamente, porque el valor original se perdió; volver a importarlo desde la fuente lo restaura.

## Campos y controles

### Eventos de seguridad (`/security`) {#security-events}

Subtítulo: *Decisiones de ejecución de herramientas y registro de seguridad.*

La página empieza con la tarjeta **Memoria fuera de EYAS** (propietarios y administradores) — ver [arriba](#memory-outside-eyas-card).

| Control | Significado |
|---------|-------------|
| Estadísticas | **Total de eventos**, **Tasa de rechazo**, **Herramientas más bloqueadas** |
| Filtro de decisión | **Todos / Permitir / Denegar / Escalar** |
| Filtro de riesgo | **Todos / bajo / medio / alto / crítico** |
| Filtro de punto de control | Texto libre (*Filtrar punto de control…*) — `deterministic` para los rechazos de ruta como la memoria fuera de EYAS |
| Columnas | Marca de tiempo, Herramienta, Decisión, Punto de control, Riesgo, Agente, Motivo |

Vacío: *No se encontraron eventos de seguridad.*

### Auditoría (`/audit`) {#audit}

Subtítulo: *Registro de acciones, instantáneas y seguimiento de reversiones.*

| Control | Significado |
|---------|-------------|
| Estadísticas | **Total de entradas**, **Acciones / día**, **Módulo principal**, **Coste total** |
| Filtros | **Acción**, **Módulo**, **Desde**, **Hasta** |
| Columnas | Marca de tiempo, Usuario, Acción, Módulo, Objetivo, Resultado, Coste |
| **Revertir** | Restaurar desde una instantánea (con confirmación) |

Resultados: **correcto / error / denegado / revertido**.

### Privacidad (`/privacy`) {#privacy}

La página tiene tres partes. (Antes de esta versión, cada llamada a la API de Privacidad se rechazaba como no autenticada, así que la página podía rebotar a la pantalla de inicio de sesión; eso está corregido.)

**1. Estadísticas** (parte superior de la página). Contadores del tráfico real desde que arrancó el servidor — se guardan en memoria, así que un reinicio los pone a cero; *Desde que se inició el servidor: &lt;hora&gt;* muestra cuándo empezaron, y **Actualizar** los recarga. Las ejecuciones del probador de escaneo nunca se cuentan.

| Contador | Significado |
|----------|-------------|
| **Llamadas remotas revisadas** | Cargas salientes analizadas para un destino remoto: cada intento de llamada al modelo (los reintentos y los saltos al fallback de un nivel cuentan por separado), los embeddings enviados a un embedder remoto y los resultados de herramientas de memoria enviados fuera del gateway (puentes de Claude Code / Grok / Kimi, clientes MCP externos, el sidecar de OpenCode). Las llamadas a un destino local no se analizan ni se cuentan |
| **Llamadas con valores enmascarados** | De ellas, cuántas tuvieron al menos un valor sustituido |
| **Mensajes rechazados** | Mensajes nuevos de chat, de Modo Dios y de canal rechazados por un valor de clase block |
| **Enviados enmascarados a petición** | Mensajes de chat rechazados que el remitente envió después con **Enviar con estos datos enmascarados** |
| **Tipos de PII detectados** | Detecciones por tipo, con *Detecciones por escáner* (regex / custom) |

**2. Editor de la política de privacidad.** Una cabecera con la versión de la política (*Versión N*) y su origen: *Importada de config/personality/privacy.yaml…* (se vuelve a importar cada vez que cambia el archivo, hasta que guardes aquí), *Gestionada en esta página. Los cambios en privacy.yaml se ignoran.* o *Valores predeterminados integrados: no se pudo leer privacy.yaml.* Mientras la política siga viniendo del archivo, un banner rojo *Problema en privacy.yaml: &lt;error&gt;* muestra un archivo ausente o no válido con su ruta completa.

| Control | Significado |
|---------|-------------|
| **Política de privacidad activada** | Desactivada: no se detecta, enmascara ni rechaza nada |
| **Auditoría** | Registrar en la auditoría cada llamada al modelo o resultado de herramienta de memoria con valores enmascarados o avisados (tipos y recuentos, nunca los valores). Los cambios de política se auditan siempre |
| **Acción por tipo** | Una leyenda de las cuatro acciones (**Desactivado**, **Avisar**, **Enmascarar**, **Bloquear**, cada una explicada) y una fila por tipo integrado (`email`, `phone`, `iban`, `bank_account`, `credit_card`, `ssn`, `personal_id`, `tax_number`, `taj_number`) con su nombre, una descripción de una línea de lo que se detecta y un selector de acción |
| **Patrones personalizados** | Filas de **Nombre**, **Expresión regular**, **Tipo** (un slug en minúsculas como `project_code`; en mayúsculas se convierte en el marcador, p. ej. `[PROJECT_CODE]`) y **Acción**; **Añadir patrón** / **Quitar patrón**; hasta 50. Los patrones coinciden línea a línea; los patrones que comparten un tipo usan la acción del primer patrón. Una expresión regular insegura (retroceso catastrófico) o no válida se rechaza al guardar, con el motivo bajo el campo |
| **Hosts locales** | Nombres de host o direcciones IP (sin esquema, puerto ni ruta; hasta 32) cuyos endpoints de modelo reciben el texto sin enmascarar, como localhost. Una entrada no válida se rechaza antes de guardar |
| **Guardar política** / **Descartar cambios** | Con un indicador *Cambios sin guardar*. Guardar sustituye la política entera y la guarda en la base de datos; desde entonces la política se gestiona en esta página y los cambios en `privacy.yaml` se ignoran (se registra un aviso). Se aplica desde la próxima llamada al modelo — un turno ya en marcha conserva la política con la que empezó. Si el servidor rechaza la política, no cambia nada y cada problema se muestra en su campo |

Solo el propietario puede cambiar la política. Los administradores la ven en modo de solo lectura con *Puedes ver la política. Solo el propietario puede cambiarla o usar el probador de escaneo.* Un operador puede desactivarlo todo; ese cambio se audita.

**3. Probar el analizador de PII** (solo el propietario). Pega hasta 100 000 caracteres y pulsa **Analizar texto**. Usa siempre la política **guardada** (aparece una pista mientras el editor tiene cambios sin guardar). Resultado: el veredicto para un mensaje nuevo — *Un mensaje nuevo con este texto se rechazaría: &lt;tipos&gt;.* o *Un mensaje nuevo con este texto se aceptaría.*; cada detección con su tipo, posición, escáner y acción; y **Tal como lo recibe un modelo remoto** — el texto con los valores de clase mask y block sustituidos (los de clase warn se quedan). *La política de privacidad está desactivada: no se detecta nada.* cuando la política está apagada.

**API (integradores).**

- `GET /api/v1/privacy/policy` (propietario y admin) → `{policy: {enabled, actions, customPatterns, localHosts, audit}, version, source ('yaml'|'ui'|'defaults'), seedError, updatedAt, rulesetVersion, builtinTypes, actions, limits: {customPatterns: 50, localHosts: 32}, canManage}`.
- `PUT /api/v1/privacy/policy` (propietario) — el cuerpo es la política entera (los campos omitidos toman sus valores por defecto; las claves desconocidas se rechazan) → la misma forma que `GET`, o `400 {code: 'invalid_policy', issues: [{path, code, message}]}` sin cambiar nada (los códigos incluyen `unsafeRegex`, `invalidRegex`, `invalidHost`, `invalid_enum_value`, `too_big`, `unrecognized_keys`).
- `POST /api/v1/privacy/scan` (propietario; `text` no vacío, 100 000 caracteres como mucho) → `{enabled, rulesetVersion, matches: [{type, start, end, scanner, action, value: '***'}], inbound: {refused, types}, egressPreview}`. Los campos `blocked`, `blockedTypes`, `warnings`, `sanitizedText` y `confidence` ya no existen. No cuenta en las estadísticas.
- `GET /api/v1/privacy/stats` (propietario y admin) → `{since, egress: {calls, maskedCalls, byType}, inbound: {checked, refused, masked}, byScanner}`; `totalScans`, `totalDetections`, `detectionsByType`, `detectionsByScanner` y `detectionsByAction` ya no existen.
- `/api/v1/privacy/*` exige la cabecera `X-Eyas-Request` en las llamadas que modifican hechas con una cookie de sesión, como las demás APIs de administración (la UI web la envía; las claves de API y los tokens Bearer no se ven afectados).

## Relacionado

- [Autonomía](/docs/es/agents/autonomy/)
- [Usuarios](/docs/es/admin/users/)
- [Herramientas](/docs/es/automation/tools/)
- [Observabilidad](/docs/es/admin/observability/)
- [Nodos](/docs/es/admin/nodes/)
- [Memoria](/docs/es/knowledge/memory/)
- [OpenCode](/docs/es/automation/opencode/)
- [CLI](/docs/es/deploy/cli/)
