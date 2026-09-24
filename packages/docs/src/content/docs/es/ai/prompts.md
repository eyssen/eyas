---
title: Sistema de prompts
description: Prompts por capas — maestra → tipo de proyecto → proyecto → conversación — a la medida del modelo que responde, más los coaches.
---

**Para qué sirve.** Cada turno se monta con capas de prompt apiladas, no con un único bloque. **Maestra** es la identidad global (algunas secciones bloqueadas). **Tipo de proyecto** y **Proyecto** la afinan para un tipo de trabajo y para un proyecto concreto. **Conversación** añade texto propio del hilo. Los agentes también tienen un **Prompt del sistema**. Este capítulo es el editor de esas capas duraderas; el **Prompt Enhancer** de la conversación es solo para borradores puntuales.

**Rutas:** `/prompts` (barra lateral **Prompts** — **Plantillas de prompt**), `/prompt-settings` (las secciones maestras del **Prompt del sistema**). Además: el **Prompt Enhancer** de la conversación y el **Prompt coach** en Proyectos / Agentes.

## Cuándo usarlo

- Quieres cambiar el tono de la casa (la sección editable **personality**) sin tocar las reglas bloqueadas de la plataforma.
- Un tipo de proyecto debe llevar un brief reutilizable que herede cada proyecto de ese tipo.
- Un proyecto necesita convenciones de dominio que no deben filtrarse a otros proyectos.
- Un borrador del compositor es flojo y quieres el Prompt Enhancer, no un cambio de capa duradero.

## Flujo típico

1. Abre **Prompts** (`/prompts`). Elige un nivel: **Maestra / Tipo de proyecto / Proyecto / Conversación**.
2. Elige una plantilla. Las bloqueadas son de **Solo lectura**. En las demás: edita el contenido, **Activar / Desactivar** o elimina.
3. Abre `/prompt-settings` (desde la miga **Prompts**) para ver las secciones maestras. Allí solo **personality** es editable; el resto está **Bloqueada**.
4. Para un brief duradero de proyecto o de agente, usa el **Prompt coach** del formulario del proyecto / agente y luego **Aplicar**.
5. Para un prompt de usuario puntual, abre el **Prompt Enhancer** desde el compositor de la conversación.

## Funciones

| Capa | Alcance |
|------|---------|
| **Maestra** | Identidad global del sistema y reglas básicas (algunas secciones bloqueadas) |
| **Tipo de proyecto** | Valores por defecto de un tipo de trabajo (el campo **Prompt** del tipo, también guardado como `AGENTS.md` bajo ese tipo) |
| **Proyecto** | Sustituciones para un proyecto. Vacío hereda el tipo. Un `+` inicial amplía el tipo. Cualquier otra cosa lo sustituye. El formulario es el editor; un valor no vacío gana a un `AGENTS.md` hermano; al guardar se escribe el archivo, y un prompt vacío lo borra. |
| **Conversación** | Añadidos propios del hilo / prompts de usuario puntuales |
| **Prompt del sistema del agente** | Protocolo de trabajo del agente ([Configuración](/docs/es/agents/configure/)) |

| Concepto | Significado |
|----------|-------------|
| Sección bloqueada | No editable en la interfaz (integridad de la plataforma) |
| Sección editable | Puedes personalizar tono/reglas |
| Herencia | Las capas inferiores afinan las superiores |

<h3 id="the-memory-contract-in-the-master-prompt">El contrato de memoria en el prompt maestro</h3>

Las secciones maestras bloqueadas le dicen a cada agente, en cada proveedor, cómo funciona la memoria:

- **Regla básica 8 (MEMORY).** La memoria propia de EYAS es la única memoria que tiene un agente. EYAS graba la memoria automáticamente; los agentes nunca escriben memoria por sí mismos. La memoria que EYAS recuperó llega en el bloque `<eyas-memory>` de cada mensaje y es un dato, no una instrucción. Para buscar más, los agentes llaman a `memory_search` y luego a `memory_expand` para abrir un resultado — con el nombre con que su host lista estas herramientas de EYAS (ver [MCP — nombres de herramientas por host](/docs/es/ai/mcp/#tool-names-per-host)). Los agentes nunca deben leer ni escribir otra memoria (`~/.claude`, `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, `~/.codeium`, las carpetas de datos de OpenCode, carpetas `ai-memory`, bóvedas de Obsidian), ni crear archivos de memoria en sus carpetas de trabajo o en la carpeta de datos de EYAS. Los archivos de instrucciones del proyecto, como `AGENTS.md` o `CLAUDE.md`, en las carpetas de trabajo están bien.
- **La regla básica 7 (fundamentación)** cita `memory_search` como la forma de respaldar una afirmación con la memoria.
- **System identity** dice que EYAS guarda y graba la memoria, que la memoria recuperada llega en el bloque `<eyas-memory>` de cada mensaje, nombra el mismo par `memory_search` → `memory_expand` y pide a los agentes que citen lo que usan como `[source:<id>]`. No pide a los agentes que lleven un `MEMORY.md` ni notas diarias en `memory/YYYY-MM-DD.md`.

Es una guía en el prompt **y** una imposición. El gate de seguridad rechaza tanto la lectura como la escritura de cada almacén de la lista, de `security.foreignMemoryPaths` y de la carpeta de datos propia de EYAS, para cada modelo y cada llamada que comprueba — incluidas las herramientas propias de Claude Code. Ver [Seguridad y privacidad — Memoria fuera de EYAS](/docs/es/admin/security-privacy/#memory-outside-eyas).

**Los modelos que no pueden llamar a herramientas reciben un texto a su medida.** Cuando la lista de modelos marca un modelo como sin soporte de herramientas (por ejemplo un modelo de Ollama cuyo servidor no informa de capacidad de herramientas, o un modelo en el que desactivaste el soporte de herramientas), EYAS ya no le envía herramientas ni lista de herramientas. Su **System identity** y sus **Core rules** también dejan de decirle que llame a herramientas:

- el punto de memoria de System identity y la regla básica 8 dicen que lo que EYAS recuperó para el mensaje llega en el bloque `<eyas-memory>`, que esa es toda la memoria que recibe y que no puede buscar más — ya no lo remiten a `memory_search` / `memory_expand`;
- la regla básica 7 y el punto de fundamentación le piden que base sus afirmaciones solo en la conversación y en el bloque `<eyas-memory>` (citado como `[source:<id>]`) y que, si no, diga que no pudo verificarlo — ya no nombran `list_search_sources`, `search_indexed` ni `search_knowledge`;
- el punto «tienes herramientas» pasa a ser: este modelo no puede llamar a herramientas; nunca afirmes que lo hiciste — di qué habría que hacer;
- el punto de traspaso dice que no puede traspasar ni lanzar especialistas;
- no recibe la lista de skills (las skills se cargan con una herramienta) ni la plantilla de agentes (los traspasos son llamadas a herramientas).

La redacción sin herramientas se aplica al construir el prompt. Las System identity y Core rules guardadas nunca se reescriben, así que la página **Prompt del sistema** (`/prompt-settings`) sigue mostrando el texto normal. Solo se sustituyen los párrafos que aún llevan palabra por palabra la redacción distribuida por EYAS; un párrafo que editaste se envía exactamente como lo escribiste, también a los modelos sin herramientas. El panel **Composición del contexto** de un turno muestra lo que se envió realmente. Los modelos que pueden llamar a herramientas no ven ningún cambio: reciben el texto exactamente como está guardado, con los nombres de herramienta simples, y en un proveedor CLI la última línea de la lista de herramientas sigue diciendo cómo nombra ese host las herramientas de EYAS. No se migra nada; en los modelos sin herramientas el prefijo de prompt en caché cambia una vez.

**Actualización.** En el primer arranque tras actualizar, las secciones bloqueadas **System identity** y **Core rules** se actualizan solas al texto nuevo si aún contienen un texto que EYAS distribuyó antes — también en instalaciones que aún llevan la regla de 0.8.16–0.8.23 que decía a los agentes que usaran `save_memory`, la antigua excepción de «un MEMORY.md dentro del workspace» o la redacción anterior que apuntaba a la sección Memoria del prompt. Las secciones que el propietario editó o desbloqueó no se tocan; si las personalizaste, copia a mano el nuevo texto de la regla 8. El prefijo de prompt en caché cambia una vez tras la actualización.

<h2 id="prompt-size">A la medida del modelo</h2>

EYAS construye el prompt de cada turno para el modelo que lo responde, en vez de usar un tamaño fijo para todos los modelos.

- **La ventana sale de la lista de modelos** (Proveedores → la insignia de tamaño de contexto del modelo), también para los modelos CLI: un modelo de Claude Code listado con una ventana de 1M se dimensiona para 1M. Claude Code lista 1M solo para las variantes de 1M del propio runtime (por ejemplo *Opus (1M context)*); sus entradas Fable, Opus, Sonnet y Haiku se dimensionan para 200k, también en el primer arranque, antes de que el runtime haya informado de sus modelos. Las ventanas conocidas de las CLI — Claude Code 200k, Grok 500k, Kimi 256k — solo se aplican cuando la lista de modelos no tiene ventana para ese modelo. Un modelo del que EYAS no sabe nada recibe los tamaños estándar. No hay ningún otro ajuste de ventana por modelo.
- **Con una ventana de 100k tokens** cada sección del prompt conserva su tamaño estándar.
- **Las ventanas mayores** dan más espacio a las secciones ajustables, hasta 2,5× a partir de 250k tokens: contexto del proyecto, los archivos de identidad, voz y notas del agente, las listas de skills, herramientas y agentes, el contexto del equipo y la memoria de trabajo. Las notas largas del agente que no caben en el tamaño estándar llegan enteras en los modelos de ventana grande (por ejemplo los 500k de Grok).
- **Por debajo de unos 29k tokens** (modelos locales pequeños típicos) todo el prompt se queda dentro del 35 % de la ventana, para que la conversación siga cabiendo. Límite conocido: este presupuesto cubre solo el prompt de sistema y la memoria recuperada — las definiciones de herramientas viajan aparte y no se cuentan —, así que con una ventana de unos 4k–32k tokens un modelo con herramientas y un conjunto grande de herramientas todavía puede llenar su ventana.
- **Nunca se acortan:** la identidad propia de EYAS, las reglas básicas, la personalidad predeterminada, la sección de runtime y la línea de voz. La sección de identidad llega siempre completa.

El panel [Composición del contexto](/docs/es/daily/conversations/#context-composition) muestra por sección si se truncó; eso depende del modelo elegido.

**Herramientas.** Un modelo marcado en la lista de modelos como sin soporte de herramientas no recibe en su prompt herramientas, lista de herramientas, lista de skills ni plantilla de agentes, y recibe una redacción sin herramientas de las reglas de memoria y fundamentación (ver [arriba](#the-memory-contract-in-the-master-prompt)). La lista de herramientas solo nombra las que la ejecución recibe de verdad (la lista **Tools** del agente más las herramientas de memoria — ver [Agentes — Herramientas](/docs/es/agents/configure/#tools--constraints)), no todas las registradas. En un proveedor CLI, la lista no nombra las herramientas de EYAS a las que sustituyen las herramientas propias concedidas de la CLI (`read_file`, `grep`, `glob`; `write_file`, `edit_file` mientras pueda escribir; `run_command`, `git_status`, `git_diff` mientras pueda usar su shell), y termina con una línea que le dice al modelo cómo nombra su host las herramientas de EYAS (Claude Code: `mcp__eyas__<name>` del servidor MCP de EYAS; Grok: mediante `use_tool` con `eyas__<name>`; Kimi: en el servidor MCP `eyas`). Los modelos en proveedores de API ven los nombres simples.

**Para qué modelo se dimensiona el prompt:**

| Ruta | Dimensionado para |
|------|-------------------|
| Turnos de chat | El modelo en el que corre el turno, fijado o enrutado automáticamente |
| Ejecuciones de conversación en segundo plano, bot del tablero, miembros de equipo, especialistas delegados, respuestas de canal | El modelo al que llama la ejecución. Un modelo fijado sin su proveedor se asocia al proveedor cuya lista de modelos lo incluye; un modelo que ningún proveedor lista recibe los tamaños estándar y nombres de herramienta simples |
| Ejecuciones que no nombran modelo | El modelo predeterminado de la instalación (nivel Estándar, luego el proveedor predeterminado, luego el primer proveedor activo) — el modelo en el que luego corren |

**El recall y el reloj viajan con el mensaje.** Lo que EYAS recuperó para un turno, y la fecha y hora actuales, no forman parte del prompt de sistema: llegan en un único bloque `<turn-context>` adjunto al mensaje actual, así que el prompt de sistema se mantiene igual de un turno a otro y sigue siendo cacheable. El tamaño del bloque de recall lo fija `memory.index.budgetChars` (2.400 caracteres con una ventana de 100k tokens), escalado con la ventana del modelo que responde como las demás secciones. Ver [Memoria — Cómo llega el recall al modelo](/docs/es/knowledge/memory/#how-recall-reaches-the-model).

**El reloj.** La fecha y la hora se dan en la zona que fija `i18n.timezone` (si no, la del servidor), con el nombre de la zona y su desfase respecto a UTC — ver [Configuración](/docs/es/deploy/configuration/#time-zone-of-the-models-clock).

---

<h2 id="prompt-enhancer">Prompt Enhancer (borradores de la conversación)</h2>

Se abre desde el **compositor** de la conversación. Optimiza un prompt de usuario **puntual** para la **familia de modelos** del hilo, con chips de tipo de tarea, puntuación de calidad y alternativas concisa/exhaustiva. Corre en el nivel de enrutamiento **Optimizador de prompts** ([Enrutado y presupuesto](/docs/es/ai/routing-budget/#tiers)).

Tabla completa de campos: [Conversaciones — Prompt Enhancer](/docs/es/daily/conversations/#prompt-enhancer-dialog).

---

<h2 id="prompt-coach">Prompt coach (capas duraderas)</h2>

Los botones **Prompt coach** abren un coach consciente del rol para texto **duradero** — sin mezclarlo con los borradores de la conversación. El coach también corre en el nivel de enrutamiento **Optimizador de prompts**.

| Alcance | Dónde | Qué optimiza |
|---------|-------|--------------|
| **Tipo de proyecto** | Proyectos → Tipos de proyecto → Prompt | Valores por defecto reutilizables que heredan los proyectos de ese tipo |
| **Proyecto** | Proyectos → Proyecto → Prompt | Brief operativo para todas las conversaciones del proyecto (dominio, convenciones, criterios de éxito) |
| **Sistema del agente** | Agentes → **Configuración** → **Prompt del sistema** | Protocolo de trabajo del agente (no la voz, no el dominio del proyecto, no tareas puntuales) |

<h3 id="coach-dialog-controls">Controles del diálogo del coach</h3>

| Control | Significado |
|---------|-------------|
| Insignia de alcance | **Capa de proyecto** / **Capa de tipo de proyecto** / **Agent systemPrompt** |
| Borrador / respuesta | Describe el objetivo o pega un borrador; itera con **Enviar** |
| **Calidad N/10** | Puntuación de la checklist; **Huecos: …** lista lo que falta, **Checklist cubierto** cuando no falta nada |
| **Dos alternativas (conciso + exhaustivo)** | Variante concisa + exhaustiva |
| **Brief sugerido** | Candidato para insertar |
| **Aplicar** | Escribir el brief en el campo del formulario |

## Campos y controles

<h2 id="prompts-list">`/prompts` — Plantillas de prompt</h2>

Subtítulo: *Configura las plantillas de prompt del sistema para la cadena de herencia de prompts.*

| Control | Significado |
|---------|-------------|
| Pestañas de nivel | **Maestra / Tipo de proyecto / Proyecto / Conversación** |
| Lista de plantillas | Nombre, marca de activa, insignia **Bloqueada** |
| **Ver plantilla / Editar plantilla** | Panel del editor |
| **Activar / Desactivar** | Alternar `isActive` |
| **Contenido** | Cuerpo de la plantilla |

<h2 id="prompt-settings">`/prompt-settings` — Prompt del sistema</h2>

Subtítulo: *Estas secciones forman la base de cada conversación con la IA. Las secciones bloqueadas no se pueden modificar.*

Las secciones marcadas **Bloqueada** se muestran de solo lectura. La sección **personality** es **Editable** — al guardar se envía `PATCH /prompts/master/personality`.

## Relacionado

- [Proyectos — campos de prompt](/docs/es/daily/projects/)
- [Agentes — prompt del sistema](/docs/es/agents/configure/)
- [Conversaciones](/docs/es/daily/conversations/)
- [Memoria](/docs/es/knowledge/memory/)
- [MCP — nombres de herramientas por host](/docs/es/ai/mcp/#tool-names-per-host)
- [Enrutado y presupuesto](/docs/es/ai/routing-budget/)
