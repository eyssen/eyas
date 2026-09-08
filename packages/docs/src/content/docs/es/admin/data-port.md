---
title: Importación y exportación de datos
description: Asistente de importación para memoria, habilidades y reglas de workspace — escanear, elegir, aprobar.
---

**Para qué sirve.** Data-port es el **asistente de importación**. Escanea una ruta del servidor o un zip/markdown subido desde otro asistente (Claude Code, Grok CLI, Cursor, Codex CLI, Gemini CLI, Windsurf, GitHub Copilot, Obsidian, una exportación de chat, una exportación previa de EYAS o una carpeta markdown normal) y propone dónde archivarlo. La memoria puede aplicarse; reglas e identidad de workspace son **solo propuesta** hasta que apruebes el merge. No es un dump de BD — usa [Copia de seguridad](/docs/es/admin/backup/). La exportación está **Próximamente**.

**Sitio:** Ajustes → **Portabilidad de datos**. Encabezado: *Importa memoria, skills y reglas desde sistemas de IA anteriores. La exportación llega más tarde.*

## Cuándo usarlo

- Notas duraderas de `~/.claude` o un vault Obsidian `ai-memory` hacia EYAS (la única memoria que leerán las rondas posteriores).
- Skills propias de Claude/Cursor → categoría **own**.
- Reglas/identidad como propuestas de merge, nunca auto-sobrescritura.
- Un zip de una exportación previa escaneado sin copiar archivos al servidor a mano.

## Flujo típico

1. **Ajustes** → **Portabilidad de datos** → **Importar datos…**
2. **Sistema de origen**: **Auto-detectar**, Claude Code, Grok CLI, Cursor, Codex CLI, Gemini CLI, Windsurf / Codeium, GitHub Copilot, Obsidian, Exportación de chat, Exportación EYAS, Carpeta markdown. Los ids que usa la API son `claude-code`, `grok-cli`, `cursor`, `codex`, `gemini-cli`, `windsurf`, `copilot`, `obsidian`, `chat-export`, `eyas-export` y `generic-md`.
3. **Ruta del servidor** (absoluta en esta máquina) **o** **Elegir archivo…** (zip o un único markdown/JSON). Las **Instrucciones** opcionales guían el ranking.
4. **Escanear**. Revisa el árbol de carpetas y los grupos (Memoria, Índice de memoria, Sesiones, Skills, Reglas, Identity, Personas de agente, Conocimiento, Código fuente, No importable) y elige qué conservar. Deja **Enriquecer los metadatos con el modelo** sin marcar para una importación totalmente determinista.
5. **Importar N elementos**. Memoria/skills se aplican; reglas/identidad esperan como **Propuestas de cambio de workspace** — **Aprobar fusión** o **Rechazar**.

## Funciones

| Capacidad | Significado |
|-----------|-------------|
| Importación | Ruta en el servidor y/o subida (zip) |
| Destinos | Memoria (kind + nivel), sesiones episódicas, skills con sus archivos empaquetados, personas de agente, reglas de workspace, prompt del tipo de proyecto |
| Merge | **Solo propuesta** para reglas/identidad — se aplica tras aprobación explícita |
| Enriquecimiento | **Desactivado por defecto** — una casilla opcional, solo metadatos, nunca el cuerpo |
| Idioma | La memoria importada conserva el idioma de origen |
| Categoría de skills | Importado → **own** |
| Reversión | Deshacer un trabajo entero — requiere el permiso **`delete`** sobre Data Port |
| Exportación | **Próximamente** — un paquete `eyas-export-v1` (vault, skills, workspaces, `episodic.jsonl`). Un paquete puede llevar notas con credenciales, así que antes de salir la ruta recibirá la misma comprobación de llamante solo-propietario que protege el recall de memoria; `create` sobre Data Port no bastará |

## Qué va a dónde

No hace falta la carpeta perfecta. **Todo lo que hay bajo la ruta se mapea.** No hay lista de conservación ni tope: el escaneo recorre cada directorio bajo la raíz, del tamaño que sea. Un árbol diez veces mayor que un directorio home habitual se lista e importa entero — el coste es tiempo y disco, nunca una omisión. Solo quedan sin recorrer las *clases* de directorio que jamás pueden contener memoria: carpetas de dependencias (`node_modules`), de control de versiones (`.git`, `.hg`, `.svn`), `.cache`, `__pycache__`, `.venv` / `venv`, salidas de compilación (`dist`, `build`, `out`, `.next`, `.turbo`, `target`) cuando hay un manifiesto de build al lado, raíces de perfil de navegador (Chrome, Chromium, Firefox, Antigravity — reconocidas por sus archivos marcadores, estén donde estén), raíces de almacenamiento en la nube (`Library/CloudStorage` y `Library/Mobile Documents`, reconocidas por el lugar que macOS les da, más las carpetas de sincronización antiguas como Dropbox, reconocidas por sus propios archivos marcadores — una carpeta que solo se *llama* OneDrive o Dropbox es una carpeta corriente y sí se recorre), la papelera (`.Trash`, `.Trashes`, `$RECYCLE.BIN`, `.local/share/Trash`) y `Library/Caches`. Cada una sigue siendo **una fila visible** con su recuento de archivos y el motivo *Carpeta no explorada: `<clase>`*, así que nada desaparece en silencio. Un directorio alcanzado por enlace simbólico se recorre una vez — decide la ruta real — y un bucle se informa en lugar de volver a entrarse. `.DS_Store` aparece como estado de la aplicación.

| Origen | Capa de EYAS |
|--------|--------------|
| Nota con `type: user` / `feedback` / `project` / `reference` (Claude Code, Obsidian, Grok) | Nota de vault con ese mismo **kind**; `feedback` en `procedural/`, el resto en `semantic/`; el archivo conserva el **nombre del archivo de origen**, así que los `[[wikienlaces]]` siguen resolviéndose |
| Índice `MEMORY.md` | Una sola nota de vault con la etiqueta `index`; una línea de gancho pasa a ser el resumen de la nota a la que apunta cuando esa nota no declara una `description` propia |
| Resúmenes de sesión, notas de sesión (`type: claude-session` / `grok-session`) y transcripciones — `*.jsonl` de Claude Code incluidas las de subagentes, transcripciones de agente de Cursor, rollouts de Codex, exportaciones de ChatGPT / Claude.ai | Memoria episódica, una fila por sesión — una sesión muy larga en partes ordenadas, nunca cortada — con los turnos literales. **Todo viene marcado por defecto**; si no lo quieres, desmarca el grupo *Sesiones*. La salida de herramienta guardada junto a una sesión se lista, pero sin marcar |
| Carpetas de memoria antiguas (`memory.local-backup-*`, `memory.old`, `*.bak`) | Nota de vault con la etiqueta `legacy`; un nombre ya ocupado recibe un hermano `-2` en lugar de perderse |
| Tus propios documentos, en cualquier punto bajo la raíz | Nota de vault; el kind sale de `type:` cuando la nota declara uno, si no `reference` |
| Documentación de producto de terceros | Nota de vault con la etiqueta `third-party`, marcada — si no la quieres, desmarca el grupo |
| Archivos de reglas dentro de repositorios (`.cursor/rules/*.mdc`, `.cursorrules`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `global_rules.md`) | Propuesta, estén donde estén en el árbol |
| Archivos de código fuente | Listados e importables, pero **sin** marcar — no son memoria ni instrucciones |
| Texto de datos y configuración (`.yaml`, `.toml`, `.csv`, `.log`, el `settings.json` de un asistente …) | Listados e importables, pero **sin** marcar |
| `SKILL.md` con `references/` y `scripts/` | Una habilidad **own**: el paquete entero literal, con los archivos copiados también a `data/skills/imported/<nombre>-<hash>/`. El cuerpo de la habilidad nombra ese directorio por su **ruta absoluta en disco**, para que un script empaquetado pueda ejecutarse desde allí |
| `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.mdc` de Cursor, reglas de Windsurf y Copilot | Propuesta para el `AGENTS.md` del **asistente principal** — o, si eliges *Prompt del tipo de proyecto*, para el tipo de proyecto `general` — añadida al aprobar, nunca sobrescrita |
| Personas de `.claude/agents/*.md` | Definiciones de agente (nombres de herramienta mapeados a herramientas de EYAS) |

**Nada se recorta ni se salta en silencio.** Los archivos se leen enteros al importar y no hay límite de tamaño: un archivo de texto de más de 4 MiB (50 MiB en una exportación de chat) se importa completo y solo lleva una marca de tamaño en su fila. Los cuerpos se escriben **byte a byte**, líneas en blanco iniciales y finales incluidas; el único salto de línea final que añade el escritor del vault y una marca de orden de bytes UTF-8 descartada son los únicos cambios. Cada elemento aplicado registra qué adaptador lo leyó realmente (`source.adapter` y la etiqueta `source:<adaptador>` — un resumen de Grok hallado bajo un trabajo Claude Code autodetectado queda etiquetado `grok-cli`), todas las rutas donde apareció el contenido, y el sha256 de su contenido en el registro — lo mismo para notas de vault, filas episódicas, skills, archivos empaquetados de skill, agentes y propuestas. El frontmatter original, la ruta, el hash y la fecha de modificación viajan con la nota bajo `source:`. Todo archivo que el escaneo no importa es una fila visible con su motivo. Repetir una importación devuelve **Sin cambios** para las notas ya presentes y nunca sobrescribe: una nota distinta con el mismo nombre recibe el sufijo `-2` y la etiqueta `conflict-with:`. Reimportar un archivo de reglas aún no aprobado no acumula una segunda propuesta para él.

**Un proyecto o tipo de proyecto declarado que aún no existe no se pierde.** Cuando el frontmatter de una nota importada declara un `project` (o `projectType`), el importador la archiva bajo `projects/<id>/` (o `project-types/<id>/`) solo si ese proyecto o tipo de proyecto ya existe en esta instancia de EYAS; si no, la nota entra sin ámbito y con la etiqueta `declared-project:<id>` (o `declared-project-type:<id>`). Crear el proyecto después y reimportar la archiva entonces bajo el id declarado, o puedes mover la nota tú mismo.

**Cualquier asistente.** Los orígenes se reconocen mediante adaptadores: Claude Code, Grok CLI, Cursor, Codex CLI, Gemini CLI, Windsurf, GitHub Copilot (solo con la estructura documentada), Obsidian, exportaciones JSON de ChatGPT / Claude.ai / genéricas, eyas-export y markdown normal (`generic-md`). Un archivo alcanzado por varias rutas (un vault enlazado dentro de `~/.grok/memory`) se convierte en una sola nota.

**El enriquecimiento por modelo está desactivado por defecto.** El paso de revisión lleva la casilla **Enriquecer los metadatos con el modelo**. Sin marcar — el caso normal — toda la importación es determinista y no gasta ni una llamada al modelo. Marcada, y con un modelo configurado, las notas *sin* tipo declarado reciben un kind sugerido, un resumen y etiquetas. No hay tope de elementos; el coste es tiempo. El cuerpo nunca se reescribe, nada se omite por decisión del modelo, y un elemento etiquetado `contains-secrets` nunca se envía. El panel de resultado indica cuántas notas se enriquecieron.

**Deshacer.** Cada trabajo se puede revertir desde el panel de resultado o desde la lista *Importaciones anteriores*: se eliminan notas, filas episódicas, habilidades (y sus archivos copiados), agentes y secciones de reglas aprobadas; las propuestas pendientes se rechazan. La reversión es destructiva, así que exige el permiso **`delete` sobre Data Port** — con los valores de fábrica, solo propietario y admin; a los demás el botón les falla con un error de permisos. Una nota de vault que hayas **editado desde la importación** se deja en paz y se informa como *omitida* en vez de borrarse.

Las herramientas de lectura siguen abiertas en las rutas de memoria del host para que este importador pueda copiar esas notas; escribir o usar shell hacia `~/.claude` / `~/.grok` / `ai-memory` está denegado. Véase [Memoria](/docs/es/knowledge/memory/).

## Secretos

Un archivo que la heurística de secretos marca se **importa literal, igual que cualquier otro archivo**, y queda etiquetado `contains-secrets`. Nada se descarta nunca por contener una credencial: aquí la seguridad es una medida de *recall*, no de importación. La etiqueta viaja como etiqueta de nota, capacidad de skill, etiqueta episódica y `[contains-secrets]` en el título de una propuesta, y el asistente marca la fila para que la veas antes de importar.

La heurística busca un bloque de clave privada, un token de proveedor, un literal `KEY=value` o un nombre de archivo con forma de `.env`. El código que *consulta* un secreto — `keychain_lookup(...)`, `os.environ[...]`, `getenv(...)` — y los marcadores de posición de documentación como `<your-key>`, `xxx` o `.env.example` no se marcan.

**Qué hace la etiqueta.** Una nota, fila episódica o skill etiquetada `contains-secrets` queda fuera de todo lo que el modelo alcanza por sí solo: el índice permanente de memoria, el trabajo relacionado, `search_memory`, la tarea de reflexión, el consolidador nocturno, el emparejador de skills y el prompt de sistema ensamblado. Nunca se entrega al modelo de enriquecimiento opcional y nunca se incrusta. En la página de Memoria la sigues viendo entera. Para abrirla al modelo, pon `memory.recall.includeSecrets: true` en `config/local.yaml` y reinicia — véase [Configuración](/docs/es/deploy/configuration/).

**Esto es una puerta contra la inclusión automática, no un aislamiento del sistema de archivos.** La etiqueta impide que un elemento marcado entre solo en un prompt. No impide que un agente con herramientas de lectura de archivos lea el archivo original en disco, y no cifra nada. Si una credencial no debería estar en esta máquina, rótala: el trabajo del importador es mantenerla fuera de un prompt que no pediste, no volverla inalcanzable.

**Dos tipos no llevan puerta, porque ahí el contenido *es* el prompt.** Una persona de agente importada y un archivo de reglas de workspace aprobado se usan **literalmente en los prompts del asistente**, así que una credencial dentro de ellos llega al modelo en cada turno y el filtrado de recall no se aplica — ponerles puerta desactivaría justo el agente que importaste. Aun así quedan etiquetados `contains-secrets` para que los encuentres, y el asistente de importación dice lo mismo en esas filas: revísalas antes de importar.

**Los archivos con forma de credencial** — `.env`, `credentials.json`, archivos de clave — se listan y son importables, pero **no vienen marcados**. Una nota, regla, skill o transcripción que solo *contiene* una clave conserva su propio kind, sigue marcada y lleva la etiqueta.

## Escala

Cada candidato es una fila de la base de datos, así que ni el asistente ni el servidor sostienen jamás la lista completa.

**El escaneo corre en segundo plano.** Responde de inmediato y el árbol de carpetas se va llenando mientras recorre, informando de carpetas visitadas, archivos vistos y filas listadas. Un directorio home entero tarda minutos. Puedes detenerlo, y lo que haya mapeado hasta entonces sigue siendo revisable.

**El paso de revisión es un árbol de carpetas, una lista virtualizada y una vista previa.** Todas las carpetas están mapeadas, incluidas las clases no recorridas — estas muestran su recuento de archivos y la clase que dejó fuera al recorrido. **Seleccionar todo lo importable**, **Ninguno** y **Volver a lo sugerido** actúan sobre el escaneo entero. Por debajo, la selección va por gestos y no fila a fila: cada carpeta y cada tipo llevan una casilla de tres estados, así que un clic desmarca todas las transcripciones en todas las carpetas. El número junto a cada casilla es la respuesta del propio servidor para la selección en pantalla, de modo que lo que lees es lo que la importación archivará. La vista previa muestra los primeros 64 KiB de un archivo; la importación lo sigue tomando entero.

**La importación fluye por lotes.** Los elementos van en lotes de 100, cada lote se confirma, el progreso se informa cada 100 elementos y el índice de búsqueda se reconstruye una sola vez al final. Puedes detenerla tras el lote en curso — lo ya archivado se queda y puede revertirse. Si el servidor se reinicia a mitad de la importación, el trabajo continúa desde su último lote confirmado en vez de empezar de cero. Se muestran tanto el tiempo de escaneo como el de importación.

**Un solo archivo grande marca el límite de memoria, no el árbol entero.** Importar un contenedor — una transcripción, una exportación de chat, una base de datos de Codex — cuesta varias veces su propio tamaño de archivo en memoria transitoria, porque el archivo se mantiene como un único búfer mientras se renderiza cada unidad de su interior. Cuántas veces depende de qué sea el archivo: unas tres para una transcripción de una línea por turno, y siete o más para una exportación de chat, que se analiza entera en un solo grafo de objetos. La fase de importación cuesta más que el escaneo: una transcripción de 19 MB midió 100 MiB al escanear y 235 MiB al importar. Una exportación de chat de 90 MB llega cerca de 900 MiB residentes, para lo que el valor por defecto de 1Gi del chart de Helm tiene sitio y el arranque heredado de 512Mi no.

**La memoria por fila se mantiene plana, por muchas filas que haya.** Al terminar un escaneo no queda nada: un segundo escaneo del mismo árbol de 26 000 filas no añade absolutamente nada al heap. Aun así, la memoria residente puede parecer alta después, porque el asignador conserva las páginas que ya pidió al sistema — eso es el asignador, no el escaneo. El límite lo pone tu archivo individual más grande, no el tamaño del árbol.

**Repetir solo añade lo nuevo.** Todo lo ya presente informa **Sin cambios**, y una importación posterior nunca revierte una anterior.

Dos hechos del motor, dichos para que nada te sorprenda:

- Un archivo empaquetado de skill de más de 200 000 caracteres se incrusta en el cuerpo de la skill hasta ese punto, con una marca que nombra la copia completa. La copia en el directorio de recursos de la skill es exacta byte a byte y completa.
- Un único archivo de texto mayor que un valor de texto que el motor pueda sostener (unos 512 MiB) se lista, se calcula su hash y es seleccionable como cualquier otro, pero se informa con el motivo *Mayor que un valor de texto que el motor puede sostener* en vez de archivarse. La fila dice por qué.

**Una salvedad sobre la identidad.** Las sesiones y las skills no tienen identidad de ruta: se reconocen por el digest de su contenido. Por eso una edición que solo cambie espacios en un archivo de origen tras una importación produce una *segunda* fila episódica (y una segunda skill, cuando el paquete lleva archivos) en lugar de actualizar la primera. Las notas de vault, que sí tienen identidad de ruta, se re-sellan en el sitio.

## Campos y controles

<h2 id="wizard">Asistente de importación</h2>

Pasos: **source → scanning → review → running → done**.

| Control | Significado |
|---------|-------------|
| **Sistema de origen** | Perfil de la lista de arriba |
| **Ruta del servidor** | Ruta absoluta — una carpeta o un directorio home entero. Al elegir un **Sistema de origen** distinto de Auto-detectar se listan sus **Ubicaciones habituales**, tomadas del propio adaptador |
| **Subir archivo o archivo comprimido** | ZIP de una exportación anterior, o un único archivo markdown/JSON. El límite de 50 MiB es solo de la subida; un escaneo por ruta no tiene ninguno |
| **Instrucciones** | Opcional — qué buscar. Solo guía el ranking; nada se descarta por ellas |
| **Escanear** | Mapear el árbol en segundo plano — carpetas visitadas, archivos vistos, filas listadas y **Detener el escaneo** |
| Carpetas encontradas por el scan | Todas las carpetas que mapeó el escaneo, con interruptores por carpeta, recuentos del subárbol y **Motivos que llevan las filas de esta carpeta** — importables o no, incluida la clase de una carpeta no recorrida |
| Filtro por tipo | **Todos / Memoria / Índice de memoria / Sesiones / Skills / Reglas / Identity / Personas de agente / Conocimiento / Código fuente / No importable** |
| **Seleccionar todo lo importable / Ninguno / Volver a lo sugerido** | Selección masiva sobre el escaneo entero, no solo la página |
| Casillas de carpeta y de tipo | Tres estados — un clic marca o desmarca todo lo importable bajo una carpeta, o todas las filas de un tipo en todas las carpetas |
| **Vista previa** | Los primeros 64 KiB del archivo — la importación lo sigue tomando entero |
| **Enriquecer los metadatos con el modelo** | Desactivado por defecto — opcional, solo metadatos, nunca el cuerpo, nunca un elemento marcado |
| **Importar N elementos** | Iniciar el trabajo en segundo plano |
| **Detener esta importación** | Se detiene tras el lote en curso; lo archivado se queda |
| Estadísticas | **Seleccionados / Aplicados / Sin cambios / Propuestas / Omitidos / Errores** |
| **Omitidos, por motivo** | Recuento por código de motivo (véase abajo) |
| **Escaneado en / Importado en** | Cuánto duró cada fase |
| **Aprobar fusión / Rechazar** | Propuestas de workspace — nunca auto-merge |
| **Revertir esta importación** | Deshacer el trabajo entero — requiere `delete` sobre Data Port |
| **Importaciones anteriores** | Los últimos cinco trabajos, cada uno con su botón de reversión |

Scan vacío: *No se encontró nada importable en esta ubicación.*

## Códigos de motivo

Cada fila de la lista de revisión lleva un motivo, y todo resultado que no sea una aplicación limpia se cuenta en **Omitidos, por motivo**. Ambos salen de un vocabulario fijo — nunca texto libre —, de modo que el asistente muestra la etiqueta de abajo mientras la API y los registros llevan el código.

| Código | Significado |
|------|---------------|
| `directory-skipped` | Clase de carpeta nunca recorrida — una fila contada, con su recuento de archivos y la clase |
| `binary` | Archivo binario |
| `outside-root` | Fuera de la carpeta elegida |
| `duplicate-content` | Contenido idéntico |
| `unreadable` | No se pudo leer |
| `empty` | Archivo vacío |
| `derived-index` | Índice generado |
| `transcript` | Transcripción de conversación (importada entera) |
| `session-summary` | Resumen de sesión |
| `session-artifact` | Salida de herramienta guardada con una sesión |
| `persona` | Persona de agente |
| `slash-command` | Comando slash |
| `cursor-rule` | Archivo de reglas de Cursor |
| `memory-note` | Nota de memoria |
| `memory-index` | Índice de memoria |
| `skill-package` | Paquete de skill |
| `skill` | Archivo de skill |
| `orphan-asset` | Archivo adjunto de una skill que no se importó |
| `rules-file` | Archivo de reglas |
| `config` | Archivo de configuración |
| `source-code` | Archivo de código fuente — importable, sin marcar |
| `data-file` | Texto de datos o configuración — importable, sin marcar |
| `symlink-upload` | Enlace simbólico en la subida |
| `needs-bun` | Requiere el runtime Bun |
| `not-downloaded` | Guardado en la nube, no descargado — listado con lo que sabe el sistema de archivos, nunca traído |
| `invalid-json` | JSON no válido |
| `unknown-json` | JSON no reconocido |
| `unrecognised` | No reconocido |
| `app-state` | Estado de la aplicación |
| `identity` | Archivo de identidad |
| `not-durable` | Texto de terceros o de plantilla — solo etiqueta |
| `tools-policy` | Política de herramientas |
| `not-importable` | No contiene nada importable |
| `missing-unit` | Su parte del archivo ya no estaba |
| `unsupported-target` | Destino no admitido |
| `service-unavailable` | El servicio no estaba disponible |
| `not-a-persona` | No es una persona de agente |
| `no-agent` | No hay agente que lo reciba |
| `exceeds-string-limit` | Mayor que un valor de texto que el motor puede sostener — listado, aún sin archivar |
| `unchanged` | Ya importado, sin cambios |
| `error` | Falló con un error |

`not-durable` y `transcript` son solo etiquetas: ninguna desmarca nada. El tipo **Desconocido** ya no se produce — solo sobrevive en escaneos hechos antes de esta versión.

## Relacionado

- [Memoria](/docs/es/knowledge/memory/)
- [Habilidades](/docs/es/automation/skills/)
- [Copia de seguridad](/docs/es/admin/backup/)
- [Agentes — workspace](/docs/es/agents/identity-workspace/)
