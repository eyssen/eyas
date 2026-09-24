---
title: Memoria
description: Lo que EYAS recuerda — notas de vault automáticas, cinco niveles, el registro en bruto de cada mensaje, y qué almacén usar.
---

**Para qué sirve.** La memoria es el almacén a largo plazo de EYAS. Un hecho duradero que dices en una conversación se convierte en nota de vault sin que nadie lo pida, y esa misma nota es lo que leen las conversaciones posteriores. Aquí inspeccionas bloques working, hechos episódicos, archivos de vault y la cola de revisión — no curas un wiki. Cómo llega a un modelo lo que se recuerda se explica en [Cómo funciona el recall](#how-recall-works). Desde 0.8.23 EYAS guarda además un registro en bruto de cada mensaje que persiste; [El registro en bruto](#the-raw-record) de abajo es todo lo que hay que saber sobre él.

## Cuándo usarlo {#when-to-use-it}

- Quieres que el asistente recuerde quién eres, cómo trabajas o las restricciones de un proyecto.
- Un hecho se dijo en el chat y quieres confirmar que aterrizó en el vault (o por qué se saltó el capture).
- Revisar, etiquetar, graficar o consolidar — o **Nota de hoy**.
- Eliges entre Memoria, wiki de Conocimiento, Documentos y archivos de vault a mano (abajo).
- Quieres el capture apagado (`memory.capture.enabled: false`) — o también el registro en bruto (`memory.l0.enabled: false`).
- Un modelo se ejecutó sin el aislamiento de EYAS y lo que escribió debe ocultarse a todos los modelos (**Poner en cuarentena la memoria de un proveedor**, solo el propietario).
- Quieres ver sobre qué funciona aquí el recall — el embedder local, cuánta memoria tiene ya vectores y qué interruptores de captura están activos de verdad (la tarjeta **Motor de recuperación**).

## Flujo típico {#typical-workflow}

1. Abre **Memoria** en la barra lateral (sección **Contenido**) — ruta `/memory`. (También aparece en **Ajustes → IA y modelo**.)
2. Mira **Resumen** (contadores, relevancia, memorias episódicas recientes y la tarjeta **Motor de recuperación**) y luego **Archivos del vault** para las notas duraderas.
3. Ten una conversación de más de ~40 caracteres que enuncie un hecho duradero. Vuelve aquí tras la respuesta: deberías ver una nota de vault nueva (de tipo `user`, `feedback`, `domain`, `project` o `reference`).
4. Si no aparece nada: era demasiado corto, el capture está apagado, ningún modelo en segundo plano pudo ejecutar el capture (ver [El capture corre en el modelo en segundo plano](#capture-runs-on-the-background-model)), o fue un turno God Mode (el turno propio de la carrera no escribe nota de vault; la ejecución de cada worker se captura por su cuenta). Escribe la nota a mano en el vault si aun así la necesitas. Un turno God Mode sí deja en el registro en bruto la respuesta que ganó — ver [El registro en bruto](#the-raw-record).

## Qué almacén usar {#which-store-to-use}

| Almacén | Trabajo |
|---------|---------|
| **Memoria** (esta página) | Hechos que EYAS graba automáticamente — los agentes nunca escriben memoria por sí mismos. EYAS adjunta a cada turno posterior un índice de una línea y lo que recuperó para el mensaje. |
| **Conocimiento** wiki | Páginas que **tú** editas. El capture no escribe aquí. |
| **Documentos** | Archivos subidos para retrieval — no notas de identidad. |
| **Archivos de vault** (markdown a mano) | El mismo vault que el capture (`<data dir>/vault/…`, por defecto `data/vault/…`). No `~/.claude` / `~/.grok`. |
| **Wiki del proyecto** | Páginas de ticket y decisión de un proyecto, no memoria global. |
| **Registro en bruto** | Cada mensaje que EYAS persiste, guardado una segunda vez palabra por palabra y comprimido. Se escribe automáticamente desde 0.8.23; ninguna página lo muestra, y el asistente solo llega a él a través del recall. |

La memoria host de Claude / Grok en la máquina **no** es la fuente de verdad, y los modelos no pueden alcanzarla. Claude Code siempre corre aislado y no carga configuración ni auto-memoria del host; Grok y Kimi corren en su propio directorio personal de EYAS; el gate de seguridad rechaza tanto leer como escribir la memoria de cualquier otra herramienta; y los servidores MCP que guardan memoria fuera de EYAS están bloqueados. El prompt master dice lo mismo a cada agente (ver [Prompts — el contrato de memoria](/docs/es/ai/prompts/#the-memory-contract-in-the-master-prompt)). Ver [La memoria fuera de EYAS se rechaza](#memory-outside-eyas-is-refused).

## Funciones {#features}

Subtítulo en la app: *Sistema de memoria híbrida de 5 niveles — de trabajo, episódica, vault semántico/procedimental, archivo*.

### Acciones {#actions}

| Control | Significado |
|---------|-------------|
| **Nota de hoy** | Ir a la nota de hoy / crearla |
| **Consolidar ahora** | Ejecutar el consolidador (promover/degradar memorias) |
| **Actualizar** | Recargar las estadísticas |

Encima de las pestañas, la tarjeta **Informe matutino** muestra el último resumen de la reflexión nocturna cuando lo hay (la tarea de reflexión está apagada por defecto: `memory.reflection.enabled`).

### Pestañas {#tabs}

| Pestaña | Contenido |
|---------|-----------|
| **Resumen** | Estadísticas, gráficos de relevancia y memorias episódicas recientes; debajo, las tarjetas **Motor de recuperación** y **Poner en cuarentena la memoria de un proveedor** (solo el propietario) |
| **Memoria de trabajo** | Bloques de TTL corto (24 h) |
| **Memoria episódica** | Hechos/episodios con relevancia |
| **Archivos del vault** | Explorador del vault en markdown |
| **Archivo** | Elementos archivados de baja relevancia |
| **Grafo** | Vista de grafo de la memoria |
| **Etiquetas** | Explorador de etiquetas |
| **Revisión** | Cola de revisión para la higiene de la memoria |

### Resumen {#overview}

| Estadística | Significado |
|-------------|-------------|
| **Bloques de trabajo** | Bloques de trabajo activos (TTL 24h) |
| **Hechos episódicos** | Número de episódicos (+ invalidados) |
| **Archivos del vault** | Archivos markdown semánticos + procedimentales |
| **Archivados** | Número de archivados de baja relevancia |
| **Lista para promoción** → vault | Candidatos episódicos de alto valor |
| **Lista para degradación** → archivo | Candidatos de baja relevancia |
| Relevancia mín / prom / máx | Distribución |
| **Etiquetas principales** / **Episódica — Por fuente** | Desgloses |

Debajo de las estadísticas vienen las tarjetas [Motor de recuperación](#recall-engine) y [Poner en cuarentena la memoria de un proveedor](#quarantine-a-providers-memory).

### Detalle de las pestañas {#tab-details}

Cada fila de **Memoria de trabajo** muestra *N caracteres · accedido N veces · expira: (hora)*.

En **Memoria episódica**, un clic en una fila abre su detalle:

| Campo | Significado |
|-------|-------------|
| **Relevancia** | Puntuación de importancia |
| **invalidada** | Ya no es fiable ni vigente |
| **ID / Fuente / ID de fuente / Agente** | Procedencia |
| **Número de accesos / Número de conversaciones** | Uso |
| **Válida desde / Invalidada el / Creada / Último acceso** | Marcas de tiempo del ciclo de vida |
| **Hash de embedding** | Si el elemento tiene vector |
| **Etiquetas** | Las etiquetas del elemento |

**Archivos del vault**:

| Control | Significado |
|---------|-------------|
| **Archivos** | Rutas del vault |
| **Frontmatter** | Metadatos YAML |
| **etiquetas:** / **enlaces:** | Etiquetas y wikilinks |
| **Contenido** | Cuerpo markdown |
| **Retroenlaces** | Notas que enlazan aquí |

Cada fila de **Archivo** muestra *archivada (fecha) · original (fecha)* e *id · id original*. El consolidador mueve aquí los elementos de baja relevancia.

### Motor de recuperación {#recall-engine}

La tarjeta **Motor de recuperación** de **Resumen** muestra, solo en lectura, la maquinaria con la que recuerda cada modelo. Es la misma responda el proveedor de chat que responda, y en la tarjeta no se puede cambiar nada.

| Línea | Qué muestra |
|-------|-------------|
| **Modelo de vectores** | El modelo local que convierte la memoria y las consultas en vectores: *e5 multilingüe (local)* cuando se cargaron los pesos de multilingual-e5-small y, si no, *Embedder de raíces con hash (reserva local)*, con el id del modelo debajo. *Desactivado* solo si en este arranque no se pudo construir ningún embedder; el recall vectorial queda entonces apagado (ver [La búsqueda vectorial siempre corre en local](#vector-search-always-runs-locally)). |
| **Resúmenes con vector** / **Hechos con vector** | *X de Y*. Y son los resúmenes y hechos que el recall puede devolver: vigentes, no sustituidos, no en cuarentena; los etiquetados `contains-secrets` quedan fuera salvo que `memory.recall.includeSecrets` esté activado. X es cuántos de ellos tienen ya un vector del embedder actual. La diferencia se cierra segundos después de la siguiente escritura en memoria. Los vectores de un embedder anterior no cuentan; se sustituyen en el siguiente arranque. |
| **Vectores actualizados por última vez** | Cuándo corrió por última vez el trabajador de vectores en segundo plano en este proceso del servidor. Muestra *Aún no desde el inicio* hasta su primera pasada tras un reinicio, que llega un par de segundos después de arrancar. |
| **Particiones de proyecto** | Cuántos proyectos y tipos de proyecto tienen vectores archivados en su propia partición — lo que mantiene la memoria de un proyecto fuera del recall de otro. Solo cuentan las particiones que tienen vectores ahora; la memoria global siempre tiene la suya. |
| **Registro en bruto** | Si el [registro en bruto](#the-raw-record) se está grabando: `memory.l0.enabled` está activado y la captura arrancó al iniciar. |
| **Captura de la salida de herramientas** | `memory.l0.captureToolResults`. *Desactivado* siempre que el registro en bruto esté apagado, porque entonces no se graba nada. |
| **Captura del razonamiento** | `memory.l0.captureThinking`. También *Desactivado* siempre que el registro en bruto esté apagado. |
| **Recuperar notas con secretos** | `memory.recall.includeSecrets` |
| **Presupuesto de recuperación (ventana de 100k tokens)** | `memory.index.budgetChars` (2400 caracteres por defecto): el tamaño del bloque de recall con una ventana de contexto de 100k tokens; el bloque escala con la ventana del modelo que responde (ver [Líneas de memoria permanentes](#standing-memory-lines)). |

La tarjeta muestra la configuración con la que corre EYAS y la lee en cada carga de la página; un cambio en `local.yaml` se ve tras un reinicio. Detrás está `GET /api/v1/memory/engine`, que exige permiso de lectura sobre la memoria (roles owner, admin, user y agent; un invitado recibe `403`). Devuelve solo recuentos, interruptores y el id del embedder — nunca contenido de la memoria.

## Notas duraderas {#durable-notes}

Una nota duradera es un hecho que permanece, no el registro de algo que pasó:
quién eres, cómo quieres que se trabaje, qué restricciones tiene un proyecto.
Cada una es un archivo markdown en el vault, y el modelo recibe en cada turno
un **índice de una línea** — solo los resúmenes, cada línea con un id — dentro
del bloque de memoria recordada adjunto a tu mensaje (ver
[Cómo llega el recall al modelo](#how-recall-reaches-the-model)). Abre la
nota entera con `memory_expand` cuando la línea resulta importar, y busca más
allá con `memory_search` (ver [Buscar más allá](#looking-further-memory_search-and-memory_expand)).

El mismo bloque lleva también lo que EYAS **recuperó para el mensaje actual** —
resúmenes de conversación, hechos, notas de vault, memoria episódica y mensajes
anteriores — más el texto completo de las mejores coincidencias. El modelo no
tiene que llamar a `memory_search` para que esos resultados aparezcan. Los
mensajes anteriores se pueden buscar porque ya están guardados: el recall no
hace ninguna copia extra de ellos. (El registro en bruto de abajo sí es una
segunda copia, aparte y deliberada.) El bloque aparte *Related prior work* que
antes se añadía al system prompt ha desaparecido: el trabajo previo llega ahora
dentro del bloque de memoria recordada.

Lo gobiernan dos campos del frontmatter: `kind` (`user`, `feedback`, `domain`,
`project`, `reference` — también el orden) y `summary` (la línea del índice). `user` y
`feedback` van primero. `domain` es el tipo de proyecto (compartido entre hermanos);
`project` es este cliente. Sin `kind`, una nota en `procedural/` se lee como
`feedback` y el resto como `reference`, nunca como `user`. Sin `summary` se usa
la primera línea real, así que un archivo escrito a mano funciona sin
frontmatter específico de EYAS.

Ubicación: `<data dir>/vault/semantic|procedural|projects|project-types/` — por
defecto bajo `data/vault/`. El vault vive siempre en el directorio de datos y
sigue a `EYAS_DATA_DIR`; no tiene ajuste de ruta propio (ver
[Configuración — Directorio de datos y vault](/docs/es/deploy/configuration/#data-directory-and-vault)).
Escribe una tú mismo y EYAS la recoge.

**Se llenan solas.** Una vez entregada la respuesta — en un chat, una
ejecución de tarjeta en segundo plano, una ejecución de especialista o
delegada, la ejecución de un miembro de equipo, una tarea A2A o una respuesta
de canal —, una llamada pequeña al
modelo en segundo plano de EYAS lee el intercambio (ver
[El capture corre en el modelo en segundo plano](#capture-runs-on-the-background-model)) y se pregunta si hay en él algo que dentro de un mes
siga siendo cierto y siga sirviendo. Como mucho dos notas por turno, y en la
mayoría de los turnos, con razón, ninguna. Nunca ocurre dentro del camino
crítico de tu respuesta: una captura fallida cuesta una nota, jamás una
respuesta.

Delante de esa llamada solo hay una comprobación de longitud y un techo por conversación, y puedes apagarla — ver [El capture está encendido por defecto](#capture-is-on-by-default). Escribir una nota a mano siempre funciona. Los agentes no pueden escribir memoria: EYAS la graba automáticamente, y `save_memory` está retirada — no escribe nada y le dice al agente que use `memory_search` en su lugar. El modelo de OpenCode tampoco puede escribir: el plugin de memoria de EYAS dentro de OpenCode ofrece solo `memory_search` y `memory_expand`.

Una nota candidata pasa el mismo filtro de instrucciones que los hechos y los
resúmenes antes de escribirse (ver [Por qué se rechazan algunas frases](#why-some-sentences-are-refused)),
y cada nota que escribe un modelo lleva un `origin` en su frontmatter — `by:
capture`, más el proveedor, el modelo y la conversación cuando se conocen —, así
que se recuerda como escrita por un modelo, nunca como tus propias palabras.

Un hecho que se repite refuerza la nota que ya existe en vez de crear una
segunda: la nueva redacción se añade como viñeta fechada bajo `## History` y no
sobrescribe nada. El módulo de privacidad enmascara el texto antes de que llegue
al disco, no al leerlo, con la misma función y las mismas reglas que el tráfico
saliente hacia los modelos: las fechas se conservan y los valores de clase mask
y block se sustituyen — un IBAN en una nota se guarda como `[IBAN]`. Eso vale
para las notas de vault; el registro en bruto de abajo, los resúmenes de
conversación y los hechos se guardan literales dentro de EYAS y solo se
enmascaran cuando salen (ver [Memoria y privacidad](#memory-and-privacy)).

**Memoria de proyecto.** Lo aprendido dentro de las conversaciones de un
proyecto se guarda en `projects/<id-del-proyecto>/`, se ordena por delante de
las notas `reference` generales mientras trabajas en ese proyecto y no aparece
en ningún otro sitio: las notas de otro proyecto nunca llegan a tu prompt. El
proyecto cajón de sastre **General**, donde arranca cada conversación, no cuenta
como identidad de proyecto: lo que se aprende ahí queda como un hecho sobre ti o
sobre cómo quieres que se trabaje, y por tanto te acompaña a todas partes.

### El capture está encendido por defecto {#capture-is-on-by-default}

El capture corre en **cada** conversación, en global, salvo que pongas `memory.capture.enabled: false` (en `local.yaml`, y reinicia). Corre en todas las formas en que EYAS ejecuta un modelo: tus propios turnos de chat, ejecuciones de tarjetas en segundo plano, ejecuciones de especialistas y delegadas (`run_specialist` / `delegate_to_agent`, incluidas las etapas del pipeline de ticket a código), tareas A2A de un agente par, la ejecución de cada miembro de equipo y cada respuesta de canal (Telegram, correo, Slack, …). Todas pasan por la misma puerta y los mismos ajustes, y `memory.capture.enabled: false` apaga todos los caminos. Una ejecución que no respondió nada no escribe ninguna fila. Un mensaje más corto que `minUserChars` nunca provoca una llamada al modelo, y una conversación recibe como mucho `maxPerConversation` llamadas. Un especialista o miembro de equipo se ejecuta en su propia subconversación, así que tiene su propio techo; una conversación de canal comparte un único techo entre todos sus mensajes. Así, cada especialista, miembro de equipo y respuesta de canal cuya instrucción tenga al menos `minUserChars` caracteres puede gastar una llamada extra al modelo en segundo plano. Cuando no hay ningún modelo en segundo plano elegible, o el presupuesto está en *stop*, no se hace ninguna llamada y la ejecución se registra como omisión (ver [Libro mayor de captures](#capture-run-ledger)).

**Quién escribió el mensaje decide cómo se lee.**

- Tus propios mensajes de chat se leen como tuyos.
- Una tarea delegada, un encargo de equipo, un encargo de traspaso o el objetivo de una tarjeta se lee como una instrucción de tarea que puede haber escrito un agente para ti. Solo se conservan los hechos que dice sobre ti, el proyecto o el mundo, nunca los pasos de la propia tarea.
- Un mensaje de canal o una tarea A2A son palabras de un tercero. Nunca pueden crear una nota sobre quién eres (`user`) ni una regla sobre cómo trabajar (`feedback`) — díselas a EYAS en la app. Solo pueden producir notas `reference`, `project` o `domain`, que llevan `trust: peer` en su frontmatter y se guardan con confianza de par, no como derivadas del modelo. Una nota así nunca se suma a una de tus notas existentes: un hecho repetido recibe su propio archivo. La comprobación de longitud solo cuenta las palabras del remitente, así que un «ok» corto por un canal no provoca ninguna llamada al modelo.

| Puerta | Por defecto | Significado |
|--------|-------------|-------------|
| `memory.capture.enabled` | **on** | Interruptor maestro |
| `minUserChars` | 40 | Puntos de código Unicode |
| `maxPerConversation` | 20 | Techo de gasto de modelo (cuentan las ejecuciones correctas, no analizables, de forma rechazada, rechazadas por el filtro de instrucciones (`poison_gate`) y con error; no cuentan las omisiones por demasiado corto, sin modelo elegible ni por stop del presupuesto, porque no se llamó a ningún modelo) |
| `maxInputChars` | 4000 | Tu mensaje y la respuesta se recortan cada uno a este número de caracteres antes de que los vea el modelo de capture |

No hay lista de palabras clave. `{"notes":[]}` es la respuesta habitual y correcta (0–2 notas).

### El capture corre en el modelo en segundo plano {#capture-runs-on-the-background-model}

El capture de memoria, la consolidación nocturna y el resumen de reflexión usan todos el **modelo en segundo plano** de EYAS: un proveedor de API, o una CLI que puede hacer una llamada aislada (hoy Claude Code; Grok CLI y Kimi Code CLI una vez que EYAS ha verificado su aislamiento en este host). El orden es el nivel de enrutado Heartbeat, luego el valor por defecto de la instalación, luego los proveedores de API, luego las CLIs que pueden correr aisladas. Nunca recurre a un proveedor que el gateway elija por su cuenta, ni a una CLI que no puede aislarse.

Cada llamada de extracción, consolidación y reflexión es **aislada**: un turno, sin herramientas, sin memoria ni configuración nativas de la CLI, y con la instrucción enviada como system prompt. Cuando el modelo de extracción es remoto, los valores de clase block del intercambio le llegan enmascarados (`[IBAN]`) con las fechas intactas, así que un turno que menciona un IBAN sigue produciendo su nota.

Con un proveedor de API o Claude Code activado, no cambia nada visible. En una instalación sin modelo en segundo plano elegible — por ejemplo, solo con Grok o solo con Kimi antes de verificar su aislamiento:

- **El capture no hace ninguna llamada al modelo.** Cada turno que cumple las condiciones escribe una fila en el libro de captures con el motivo de omisión `no_eligible_model` y sin proveedor. Es una omisión registrada, no un error.
- **La consolidación nocturna** no convierte los recuerdos episódicos recurrentes en una nota de vault. Esos grupos se dejan intactos (ni resumidos ni invalidados) y se promueven otra noche, cuando exista un modelo elegible.
- **El resumen de reflexión / de la mañana** conserva solo su parte determinista (por ejemplo las tareas vencidas), sin logros, aprendizajes ni sugerencias escritos por el modelo.

Cuando el presupuesto de modelos está en *stop*, el capture registra el motivo de omisión `budget_stop` y no hace ninguna llamada.

Sin aislamiento el extractor leyó una vez la memoria host del dueño, dijo que el hecho «ya estaba grabado» y el vault de EYAS quedó vacío. Eso es el bug que esto cierra.

### Libro mayor de captures {#capture-run-ledger}

Cada resultado que llega a la puerta escribe una fila `memory_capture_runs`: las omisiones con su motivo (`too-short`, `cap-reached`, `unparsable`, `rejected-shape`, `poison_gate`, `no_eligible_model`, `budget_stop`, `error`), las extracciones con los kinds que escribieron (una ejecución `poison_gate` sigue contando las notas de la misma respuesta que sí se guardaron), más una columna `provider`: `proveedor/modelo`, `proveedor/ruta` cuando una CLI respondió sin nombrar su modelo (por ejemplo `claude-code/isolated-cli`), o null cuando no se llamó a ningún modelo. Una llamada de extracción fallida o vacía escribe una fila `error` que nombra el proveedor que se intentó. La columna `entry_path` registra de qué camino de ejecución vino la fila: `interactive`, `background`, `delegation`, `pipeline`, `a2a`, `team` o `channel` (vacía en las filas escritas antes de esta versión). Dos silencios deliberados: capture apagado no escribe nada, y una ejecución sin texto del asistente no llega a la puerta. Una carrera **God Mode** devuelve su propio stream antes del bloque posterior al turno, así que el turno propio de la carrera no escribe ni nota de vault ni fila aquí; cada worker se ejecuta como una ejecución en segundo plano propia y se captura allí, leyendo la tarea como una instrucción escrita por un agente. El registro en bruto de abajo es un libro aparte y sí los cubre.

## Cómo funciona el recall {#how-recall-works}

En cada turno, responda el modelo que responda, EYAS adjunta a tu mensaje lo que recuerda en un solo bloque:

- **Notas permanentes** — un índice de una línea de las notas duraderas y los resúmenes, cada línea con un id que el modelo puede abrir;
- **Resultados recuperados** — los resúmenes, hechos, notas, memorias episódicas y mensajes anteriores que encajan con este mensaje, ordenados por relevancia, antigüedad y autor;
- **Las mejores coincidencias a texto completo** — las dos primeras (cuatro para un modelo que no puede llamar a herramientas).

Todo sale solo de la memoria que la conversación puede ver (su proyecto, su tipo de proyecto y la memoria global), se busca en el idioma en que escribes y se pondera por confianza. El modelo puede buscar más allá con `memory_search` y `memory_expand`, tres llamadas por respuesta. Las secciones de abajo lo recorren una a una.

### Qué memoria ve una conversación {#which-memory-a-conversation-can-see}

Una conversación ve tres tipos de memoria: la de su propio proyecto, la de su
tipo de proyecto y la memoria global. Nunca ve la memoria de otro proyecto. Una
conversación fuera de cualquier proyecto — también una del proyecto por defecto
**General** — ve solo la memoria global.

Una sola regla cubre todo lo que recibe el modelo: la memoria inyectada en cada
turno, las líneas del índice permanente, el recall vectorial y las herramientas
`memory_search`, `memory_expand` y `search_memory`.

Lo que decide a dónde pertenece una nota de vault es su frontmatter:

| La nota declara | Visible en |
|-----------------|------------|
| `project:` | Solo ese proyecto, sea cual sea el tipo de nota. (Antes, las notas `user` / `feedback` / `reference` se mostraban en todas partes aunque nombraran un proyecto.) |
| solo `projectType:` | Los proyectos de ese tipo |
| ninguno de los dos | En todas partes (global) |

Mover una nota a `projects/<id>/` de un proyecto que existe, o añadir
`project:` a su frontmatter, la limita a ese proyecto — y también los hechos y
el resumen que EYAS deriva de ella: se recuerdan solo dentro de ese proyecto y
no en cada conversación. La búsqueda de la página Memoria (`/memory`) sigue sin
filtrar.

### Cómo llega el recall al modelo {#how-recall-reaches-the-model}

Lo que EYAS recuerda para un mensaje va adjunto **a ese mensaje**, no al system
prompt. Llega como un bloque delimitado, `<eyas-memory>`, dentro de un bloque
`<turn-context>` que EYAS añade al principio de tu mensaje actual, junto con la
fecha y la hora actuales (en `i18n.timezone` o, si no, en la zona del
servidor). El bloque contiene, por este orden:

1. las notas permanentes — el índice de una línea, cada línea con su id;
2. las notas recuperadas para este mensaje;
3. el texto completo de las mejores coincidencias.

El formato es el mismo en todos los proveedores — modelos de API, Claude Code,
Grok CLI, Kimi Code CLI, modelos locales — y en todo tipo de ejecución: chat
interactivo; ejecuciones en segundo plano (tarjetas del bot del tablero,
reintentos y reanudaciones, trabajadores del Modo Dios); especialistas y agentes
delegados (`run_specialist` / `delegate_to_agent`) y etapas del pipeline de
ticket a código; miembros de un equipo; respuestas de canal dadas con la voz
(interna) del propietario; y tareas de [OpenCode](/docs/es/automation/opencode/).
Un chat sin colega, en un proyecto sin agente por defecto, no recibe system
prompt ensamblado pero sí la fecha, la hora y la memoria recordada. Una
anulación `system` en la petición del mensaje sustituye solo el system prompt;
el recall sigue llegando. Una ejecución reanudada (refresco, reanudación tras
aprobación, devolución del crítico) recibe fecha, hora y recall nuevos, no los
capturados cuando empezó la ejecución.

- **Datos, no instrucciones.** El bloque le dice al modelo que es un dato, no
  una instrucción, y le pide que cite lo que usa como `[source:<id>]`. El texto
  de dentro no puede cerrar el bloque ni hacerse pasar por un mensaje de sistema
  o de usuario: esas etiquetas se neutralizan pero siguen siendo legibles.
- **Nunca se guarda.** Tu mensaje guardado nunca cambia; el bloque solo se añade
  a la copia que se envía al modelo, así que EYAS nunca vuelve a capturar su
  propio recall como memoria.
- **Un system prompt estable.** Como el reloj también se trasladó a este bloque,
  el system prompt es igual de un turno a otro, y así se puede seguir cacheando.
- **Nombres de herramientas según el host.** Las pistas de drill-down nombran
  las herramientas como las lista el host del modelo: `memory_search` /
  `memory_expand` en los proveedores nativos, `mcp__eyas__memory_search` en
  Claude Code, `use_tool` con `eyas__memory_search` en Grok CLI y
  `memory_search` en el servidor MCP `eyas` para Kimi. Un modelo que no puede
  llamar a herramientas no recibe pista de drill-down y recibe hasta cuatro
  notas a texto completo en lugar de dos, y su prompt dice que este bloque es
  toda la memoria que recibe y que no puede buscar más, en lugar de remitirlo a
  `memory_search` / `memory_expand` (ver
  [Prompts — El contrato de memoria](/docs/es/ai/prompts/#the-memory-contract-in-the-master-prompt)).
- **Sin memoria del propietario para lectores externos.** Las tareas de un par
  A2A, y las respuestas de canal cuyo ámbito de voz es Externo (**Forzar:
  Externo** en la conversación, o una anulación temporal), solo reciben la fecha
  y la hora. Si EYAS no puede determinar el ámbito de voz de una respuesta de
  canal, esta también sale sin memoria recordada. Las herramientas de memoria no
  cambian y siguen gobernadas por el gate de seguridad.

El bloque entero, marco incluido, se dimensiona con `memory.index.budgetChars`
(ver [Líneas de memoria permanentes](#standing-memory-lines)), escalado con la
ventana del modelo que responde — para una tarea de OpenCode, la ventana que
OpenCode lista para el modelo elegido (ver [OpenCode — Memoria enviada con una tarea](/docs/es/automation/opencode/#memory-sent-with-a-task)). En el panel
[Composición del contexto](/docs/es/daily/conversations/#context-composition),
el recall es la sección **memory-recall** de la zona **turn**, junto a
**turn-time** (el reloj); las secciones *memory-index* y *related-work* ya no
aparecen. El recuadro **Memoria entregada** del panel muestra, para todos los
proveedores, el modelo y la ventana para los que se dimensionó el bloque,
cuántos elementos se recuperaron y cuántos completos frente al tope del bloque,
por qué se retuvo el recall si fue así, y las consultas de memoria del turno
frente al tope de 3.

Para comparar proveedores en un periodo, **Observabilidad → Contexto** tiene la tarjeta **Entrega de memoria por proveedor**: por proveedor, cuántos turnos llevaron memoria, la media de elementos por capa y de tokens de memoria en esos turnos, y con qué frecuencia el modelo abrió la memoria por su cuenta. Cifras parecidas significan que cada modelo recibió la misma memoria. Ver [Observabilidad](/docs/es/admin/observability/).

### Con qué busca el recall {#what-recall-searches-with}

Cada turno busca en la memoria con la misma consulta, sea un chat o una
ejecución en segundo plano o programada de una conversación. La consulta se
construye, sin llamada al modelo, a partir de:

- tu mensaje actual (si está vacío, tu último mensaje en esta conversación);
- tu mensaje anterior distinto (primeros 400 caracteres);
- el título de la conversación (primeros 120 caracteres; un marcador *Untitled*
  se ignora);
- la descripción de tarea u objetivo de la conversación (primeros 400
  caracteres).

Tiene como mucho 1200 caracteres, tu mensaje va primero, y una parte que ya
está contenida en otra anterior (por ejemplo un título hecho a partir de tu
primer mensaje) no se repite. Solo se usan los mensajes de esta conversación,
nunca los de otra. Así, una respuesta corta como *sí, hazlo* recupera la tarea
de la que se habla, y una ejecución en segundo plano de una conversación sin
descripción sigue buscando por su título. (Antes, el chat buscaba solo con el
mensaje actual, y una ejecución en segundo plano solo con la descripción de la
tarea.)

**La búsqueda lee tu idioma.** El idioma se toma de la propia consulta. Para un
mensaje corto sin idioma claro, EYAS usa el idioma en el que se ha llevado la
conversación; si tampoco se conoce, se ignoran las palabras funcionales comunes
de todos los idiomas admitidos. Así, las palabras funcionales en húngaro,
alemán, español y francés (*hogy*, *csak*, *aber*, *para*, *avec* …) ya no
cuentan como términos de búsqueda ni dejan pasar notas no relacionadas, y las
consultas en klingon reciben el peso de palabras clave más fuerte. Las propias consultas `memory_search` del modelo — también las de OpenCode — resuelven su idioma de la misma forma.

### Cómo ordena el recall {#how-recall-ranks}

Todos los modelos, todos los caminos de entrada y las herramientas
`memory_search` / `memory_expand` usan la misma ordenación. No hay nada que
configurar ni que migrar.

- **Primero la relevancia**: lo bien que una nota o un mensaje anterior encaja
  con tu mensaje. Después, lo reciente que es y lo importante que es, más una
  pequeña bonificación para la memoria de la misma tarea (conversación) o del
  mismo proyecto.
- **La antigüedad cuenta según el tipo de memoria.** Los hechos envejecen más
  rápido (en torno a un mes), los mensajes anteriores en unos tres meses, los
  resúmenes y las notas de vault despacio (en torno a un año), y los resúmenes
  fijados nunca envejecen. Para una nota de vault, la antigüedad es cuándo la
  indexó EYAS por última vez — cuándo cambió la nota por última vez; para un
  mensaje anterior, cuándo se escribió. (Antes, cada nota y cada mensaje
  anterior contaban como recién hechos.)
- **Quién lo escribió pesa.** Tus propios mensajes y el texto escrito por los
  agentes o modelos de EYAS cuentan del todo; la salida de herramientas y el
  texto importado de terceros pesan 0,6×; el texto de remitentes de canales
  pesa 0,3×. Se usa la confianza que EYAS guardó al almacenar el elemento (ver
  [Confianza: quién lo escribió](#trust-who-wrote-it)).
- **Nunca se recuerdan:** el texto marcado como posible inyección de prompt (en
  cuarentena), tampoco a través del resumen de la conversación de la que salió,
  ni el razonamiento propio de un modelo, ni las llamadas a herramientas grabadas
  (ver [Los resultados de herramientas no se graban](#tool-results-are-not-recorded--and-why-to-leave-it-that-way)).
- **Un mensaje anterior son sus propias palabras.** Una línea recuperada de una
  conversación anterior muestra el propio texto de ese mensaje — el pasaje en
  torno a tus palabras de búsqueda, como mucho 280 caracteres — en lugar del
  resumen de la conversación o solo su id. Las notas de vault y los mensajes
  anteriores compiten en igualdad de condiciones (antes, las coincidencias de
  palabras clave de mensajes anteriores iban siempre por delante de las notas
  que coincidían), y una nota importada al registro en bruto vuelve una sola
  vez, como la nota.
- La búsqueda de la página de Memoria (`GET /api/v1/memory/search`) y la
  alternativa de `memory_search` también muestran el propio texto de los
  mensajes anteriores, nunca texto marcado, razonamiento del modelo ni llamadas a
  herramientas grabadas.

### La búsqueda vectorial siempre corre en local {#vector-search-always-runs-locally}

Sea cual sea el proveedor de chat que responde — Claude Code, Grok, Kimi o un
proveedor de API —, EYAS convierte la memoria en vectores en la propia máquina:
con el modelo multilingual-e5-small cuando sus pesos están disponibles y, si no,
con un embedder hash integrado más simple (menor calidad, sin descarga). El
texto de la memoria nunca se envía a la API de embeddings de un proveedor para
recordarlo.

- El nivel de enrutado **Embedding** ahora solo alimenta el índice de búsqueda
  antiguo del vault y episódico; el recall nunca lo usa. (Antes, definir ese
  nivel desactivaba en silencio el recall vectorial de resúmenes y hechos y los
  enviaba a esa API en cada arranque.) Cuando cambia el embedder de ese índice
  antiguo, el índice se vacía una vez y se reconstruye automáticamente.
- **La memoria nueva se puede buscar en segundos.** Cuando EYAS escribe en la
  memoria los mensajes retenidos de una conversación — al cerrarse la tarea,
  tras 30 minutos de inactividad o cuando el búfer se llena —, los resúmenes y
  hechos que extrae reciben sus vectores aproximadamente medio segundo después,
  no solo tras un reinicio.
- Los resúmenes sustituidos, los hechos sustituidos o borrados, los elementos en
  cuarentena y los marcados como portadores de secretos (salvo que
  `memory.recall.includeSecrets` esté activado) se quitan del índice vectorial,
  así que ya no ocupan huecos del recall.
- El modelo local e5 se carga al arrancar en toda instalación, también donde hay
  un nivel Embedding definido (unos 100 MB de RAM). Si no puede cargarse, EYAS
  usa el embedder de reserva y sigue funcionando. `eyas doctor` muestra cuál se
  está usando en su línea **Memory embedder** — ver [CLI](/docs/es/deploy/cli/#what-doctor-checks).

No hay nada que configurar ni que migrar: los vectores hechos por un embedder
anterior se sustituyen automáticamente en el siguiente arranque.

### Buscar más allá: memory_search y memory_expand {#looking-further-memory_search-and-memory_expand}

Cuando el bloque de memoria recordada no basta, el modelo llama a `memory_search` y luego a `memory_expand` para abrir un
resultado. `search_memory` es un alias de `memory_search`.

- **3 llamadas por respuesta, en todos los proveedores.** Las tres herramientas
  juntas permiten 3 llamadas por respuesta — modelos API, Claude Code, Grok y
  Kimi por igual. La cuenta vuelve a empezar con cada mensaje nuevo que envías y
  no se agota a mitad de respuesta, por largo que sea el bucle de herramientas
  propio del modelo.
- **Abrir un mensaje anterior.** `memory_expand` sobre un id `rw:` devuelve el
  texto original del mensaje, hasta 8000 caracteres, con su tipo de origen y su
  confianza. Añade el resumen de la conversación como contexto solo cuando ese
  resumen es recuperable a su vez (no está marcado ni se derivó de secretos,
  salvo que `memory.recall.includeSecrets` esté activado).
- **Fijadas al proyecto de la conversación, por EYAS en el servidor.** Envíe lo
  que envíe el modelo, un CLI o un puente, las herramientas leen el propio
  proyecto de la conversación, su tipo y la memoria global. Un argumento
  `scope` o de proyecto se ignora: mirar otro proyecto es algo que haces en la
  UI, nunca un argumento de herramienta. Una llamada que nombra una
  conversación que EYAS no conoce devuelve el error *memory scope unresolved* y
  ningún resultado.
- Los clientes externos del propio servidor MCP de EYAS no tienen conversación
  de EYAS: sus llamadas a herramientas de memoria leen solo la memoria global,
  con un límite de 3 llamadas cada 90 segundos. El mismo límite se aplica a las llamadas de OpenCode que no están ligadas a una tarea.
- **OpenCode** ofrece al modelo las mismas dos herramientas, con los mismos nombres y argumentos, solo de lectura. En una tarea que EYAS delega con `opencode_run` quedan fijadas al proyecto de esa conversación y comparten las 3 llamadas del turno que la lanzó. En cualquier otro caso — una sesión de terminal de OpenCode abierta en el panel, una sesión que EYAS no creó o un usuario con sesión iniciada que no es el de la sesión — leen solo la memoria global. Un servidor OpenCode conectado desde fuera no tiene ningún acceso a la memoria de EYAS. Ver [OpenCode](/docs/es/automation/opencode/).

Cada host lista estas herramientas con su propio nombre — `memory_search` en los
proveedores API, `mcp__eyas__memory_search` en Claude Code, `use_tool` con
`eyas__memory_search` en Grok. Ver [MCP — nombres de herramientas por host](/docs/es/ai/mcp/#tool-names-per-host).

### Líneas de memoria permanentes {#standing-memory-lines}

Cada línea del índice de memoria permanente muestra un id que `memory_expand`
abre: `(vt:<ruta>)` para una nota de vault, `(gs:<id>)` para un resumen de
conversación. `memory_expand` abre también ids de entidad (`en:<id>`): devuelve
el nombre, el tipo, los alias y hasta 10 hechos vigentes de la entidad, de la
memoria que la conversación puede ver.

Las líneas de resumen del índice son los resúmenes fijados, el propio resumen
del proyecto y hasta 5 resúmenes de tareas más recientes del mismo proyecto (o,
fuera de un proyecto, de otras conversaciones sin proyecto) — nunca los de otro
proyecto, nunca el de la propia conversación en curso y nunca los que están en
cuarentena. (Antes: los 20 resúmenes más importantes de cualquier proyecto.)

`memory.index.budgetChars` (2400 caracteres por defecto, unos 600 tokens) es el
tamaño del **bloque entero de memoria recordada**, marco incluido: notas
permanentes, notas recuperadas y coincidencias a texto completo juntas. Ese
valor está pensado para un modelo con una ventana de contexto de 100k tokens; el
bloque escala con la ventana del modelo que responde (hasta 2,5× a partir de
250k tokens, menos por debajo de unos 29k tokens, y nada en absoluto con una ventana muy
pequeña). Una tarea de OpenCode se dimensiona igual, para la ventana que
OpenCode lista para su modelo, o exactamente `memory.index.budgetChars` cuando
esa ventana es desconocida (antes, OpenCode recibía siempre el valor sin
escalar). Las notas permanentes van primero, pero
siempre dejan sitio — hasta la mitad del bloque — para lo recuperado para el
mensaje actual. Las notas que no caben se resumen en una línea final, *… N more
notes not shown*, que nombra la herramienta de drill-down como la lista el
host; siguen alcanzables con `memory_search`. Sube el presupuesto en
`config/local.yaml` (y reinicia) cuando tus líneas `user` y `feedback` ya no
quepan. Las versiones anteriores traían
8000 en `config/default.yaml` — ver la [nota de actualización](/docs/es/deploy/configuration/#memory-index-and-recall).

En el primer arranque tras actualizar, EYAS archiva cada vector de memoria
existente bajo su proyecto, una sola vez y por lotes (en el log: *L3
repartition: vectors filed under their project*). Si no puede terminar, registra
un aviso y lo reintenta en el siguiente arranque. No hay nada que hacer.

### Notas de proyecto sin proyecto {#project-notes-without-a-project}

Una nota cuyo `kind` es `project` o `domain` pero que no lleva `project:` /
`projectType:` es **global**: aparece en el índice permanente, en
`memory_search` y en el recall de cada conversación, ordenada como
nota de proyecto. Moverla a `projects/<id>/` — o poner `project:` en su
frontmatter — la limita a ese proyecto. Las notas traídas por una importación se
quedan así hasta que crees los proyectos correspondientes.

### Los secretos importados quedan fuera del recall {#imported-secrets-stay-out-of-recall}

El importador nunca descarta un archivo por contener una credencial. Se guarda literal y el elemento lleva la etiqueta `contains-secrets` — como etiqueta de nota, capacidad de skill o etiqueta episódica, según en qué se haya convertido.

Por defecto, un elemento así queda fuera de todo lo que el modelo alcanza por sí solo: el índice permanente, el recall, `memory_search`, la tarea de reflexión, el consolidador nocturno y el emparejador de skills. Nunca se incrusta ni se entrega al modelo de enriquecimiento opcional. La página de Memoria te lo sigue mostrando entero.

**Todo lo que se deriva de él también queda fuera.** La etiqueta pasa de la nota o del episodio a su copia en el registro en bruto, a cada hecho que EYAS extrajo de él y a cada resumen construido a partir de él; un hecho ya conocido también pasa a ser secreto cuando una nota etiquetada lo confirma más tarde. Una fila en bruto, un hecho o un resumen así no se incrusta, no aparece en las líneas permanentes, no lo devuelven `memory_search` ni `GET /api/v1/memory/search`, y no se puede abrir con `memory_expand`. Al expandir una entidad se dejan fuera sus hechos secretos, y un mensaje anterior cuya conversación tiene un resumen secreto se muestra sin ese resumen. (Antes, estos hechos y resúmenes derivados aún podían llegar al modelo.) Una nota escrita directamente en disco con `contains-secrets` en su frontmatter se trata como secreta incluso antes de que el indexador del vault la haya visto.

Poner `memory.recall.includeSecrets: true` en `config/local.yaml` y reiniciar lo abre todo al modelo, como antes.

**Actualización.** En el primer arranque tras actualizar, EYAS marca las filas en bruto, los hechos y los resúmenes existentes que salieron de notas y episodios etiquetados — una vez, antes de construir los vectores — y lo registra en una línea del log. Si más adelante otra nota o episodio recibe la etiqueta, el siguiente arranque marca también sus filas derivadas. Las marcas solo se añaden: quitar a mano `contains-secrets` de una nota no vuelve a hacer recuperables los resúmenes y hechos ya derivados de ella.

Esta puerta impide la inclusión automática; no es un aislamiento del sistema de archivos. Un agente con herramientas de lectura de archivos puede seguir leyendo el archivo original en disco. Una persona de agente importada y un archivo de reglas de workspace aprobado no llevan puerta alguna — ahí el contenido *es* el prompt —, así que revisa esas filas antes de aprobarlas.

Las etiquetas `legacy` (una carpeta de memoria antigua) y `third-party` (documentación de producto ajena) marcan notas normales y plenamente recuperables; solo dicen de dónde vino la nota. Todo elemento importado lleva además `source:<adaptador>`, que nombra el adaptador que lo leyó. Una nota escrita por ti puede declarar `contains-secrets` en su propio frontmatter y recibe el mismo trato. Véase [Importación y exportación de datos](/docs/es/admin/data-port/).

### Memoria y privacidad {#memory-and-privacy}

EYAS guarda la memoria en bruto y la enmascara a la salida. Cuando la memoria se
envía a un modelo remoto — inyectada en el prompt, o devuelta por
`memory_search`, `memory_expand` y las demás herramientas de memoria —, la
política de privacidad la enmascara para ese destino, y un mismo elemento de
memoria se enmascara igual por cualquiera de los dos caminos. Un modelo local
(loopback, o un host listado como local en la política de privacidad) la recibe
sin enmascarar. Las notas de vault se enmascaran además en reposo al escribirse
(las fechas se conservan).

Los resultados de las herramientas de memoria se enmascaran igual en **todos**
los caminos que un modelo puede usar para leer la memoria de EYAS: proveedores
de API y locales, las herramientas de EYAS en proceso de Claude Code, Grok y
Kimi por el puente MCP de EYAS, los clientes MCP externos del propio servidor
MCP de EYAS y el sidecar de OpenCode (el prompt de su tarea, la memoria
recordada que se envía con la tarea y las respuestas de sus herramientas `memory_search` / `memory_expand`).
Una CLI, un cliente MCP externo y OpenCode cuentan siempre como remotos. Si el
análisis de privacidad falla, el resultado se retiene en lugar de enviarse sin
enmascarar. Ver
[Seguridad y privacidad — Dónde se aplica el enmascarado](/docs/es/admin/security-privacy/#where-masking-applies).

### La memoria fuera de EYAS se rechaza {#memory-outside-eyas-is-refused}

A los agentes se les dice que la memoria de EYAS es la única memoria que tienen, que EYAS la graba y que la alcanzan con `memory_search` / `memory_expand`. Y eso también se aplica:

- **El gate de seguridad rechaza tanto lecturas como escrituras** de la memoria de otras herramientas (`~/.claude`, `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, las carpetas de OpenCode, las carpetas `ai-memory` y el resto de la lista), de las bóvedas de Obsidian, de cada ruta de `security.foreignMemoryPaths`, de la carpeta de datos propia de EYAS (vault, base de datos, claves, los directorios personales de inicio de sesión de CLI) y del workspace de otra conversación — para todos los modelos y cada llamada a herramienta que comprueba el gate. Al modelo se le dice, por ejemplo, *Memory outside EYAS (Claude Code) — use memory_search / memory_expand from EYAS* — salvo en Grok CLI, que termina su respuesta en la llamada rechazada sin que su modelo vea el motivo (ver [Proveedores — Grok CLI y Kimi Code CLI](/docs/es/ai/providers/#grok-cli-and-kimi-code-cli)). Antes solo se bloqueaban las escrituras y el acceso por shell a `~/.claude`, `~/.grok` y `ai-memory`, y las lecturas estaban permitidas.
- **Las herramientas propias de Claude Code** pasan la misma comprobación antes de ejecutarse, incluidas las lecturas que Claude Code permitiría por su cuenta dentro de su carpeta de trabajo.
- **Las búsquedas se juzgan por lo que pueden alcanzar.** Una búsqueda propia de una CLI (Grep, Glob, un comando de shell recursivo) cuya carpeta contiene la memoria de otra herramienta, una bóveda o los datos de EYAS se rechaza como *Search too broad*, porque la CLI no puede dejar ese sitio fuera; y una Carpeta que contiene un sitio así ya no se puede guardar. Ver [Seguridad y privacidad — Memoria fuera de EYAS](/docs/es/admin/security-privacy/#memory-outside-eyas).
- **El sandbox de archivos del kernel.** Los comandos de shell de Claude Code y las herramientas propias de Grok CLI se ejecutan además dentro del sandbox de archivos del sistema operativo donde lo hay, que bloquea los mismos sitios aunque un comando de shell llegue a ellos por caminos que EYAS no puede leer (ver [Proveedores — Sandbox de archivos del kernel](/docs/es/ai/providers/#kernel-file-sandbox)). **Eventos de seguridad** lista qué está protegido en este servidor en su tarjeta **Memoria fuera de EYAS**.
- **Las CLIs corren aisladas.** Claude Code no carga `CLAUDE.md`, ajustes, skills, servidores MCP ni auto-memoria del host; Grok CLI y Kimi Code CLI corren en su propio directorio personal de EYAS y nunca ven `~/.grok`, `~/.kimi` ni `~/.claude`. Ver [Proveedores](/docs/es/ai/providers/#claude-code-isolation).
- **Los servidores MCP que guardan una segunda memoria** (el servidor de grafo de conocimiento Memory, Qdrant, Obsidian, MCPVault, …) o que apuntan a una carpeta protegida están bloqueados para todos los modelos. Ver [MCP](/docs/es/ai/mcp/#memory-store-servers-are-blocked).

**Migración.** Los agentes que antes leían directamente `~/.claude/CLAUDE.md`, la memoria de `~/.grok`, notas de bóvedas o archivos bajo `data/` ahora reciben un rechazo (Eventos de seguridad muestra cada uno). Trae ese conocimiento a EYAS una vez con la [Importación de datos](/docs/es/admin/data-port/). Detalles y lo que aún no está cubierto: [Seguridad y privacidad — Memoria fuera de EYAS](/docs/es/admin/security-privacy/#memory-outside-eyas).

---

## El registro en bruto {#the-raw-record}

**No se pierde nada de lo dicho.** Cada mensaje que EYAS deja escrito — el
tuyo, el del asistente y la salida de las corridas de agente en segundo plano —
se conserva ahora una segunda vez, palabra por palabra, en un registro en bruto
junto a la conversación misma. Se comprime al entrar (unas 2,7× más pequeño
sobre texto real) y se archiva bajo un hash de sus propios bytes, así que una
misma frase repetida dentro de una conversación se almacena una vez y se cuenta
dos.

**Qué lo lee.** No hay página ni comando que te muestre el registro en bruto.
El asistente solo lo alcanza a través del recall de memoria, dentro del mismo
ámbito de proyecto que todo lo demás: los resúmenes y hechos que EYAS deduce de
él (abajo) aparecen como líneas de memoria permanentes y resultados de
búsqueda, y `memory_search` / `memory_expand` pueden abrirlos, junto con filas
en bruto — ver [Qué memoria ve una conversación](#which-memory-a-conversation-can-see).

Lo que sí cambia hoy para ti es dónde viven tus palabras. Una conversación ya no
es la única copia de lo que se dijo en ella: cerrarla, archivarla o borrarla
deja el registro en bruto en pie, y no hay ningún botón en ninguna parte que lo
borre. Si eso no es lo que quieres, apaga el registro en bruto antes de usar
EYAS para cualquier cosa que después querrías que desapareciera (más abajo).

La escritura va por lotes, no es inmediata. Los mensajes se retienen por
conversación y se vuelcan cuando la conversación se cierra (o pasa a una etapa
cerrada), cuando se han acumulado unos 8000 tokens, cuando la conversación
lleva 30 minutos inactiva o cuando EYAS se apaga — un reinicio no pierde nada
de lo ya dicho.

Cada mensaje lleva además el sello de su procedencia, y ese sello no se hereda
nunca. Un resumen o un hecho nunca puede acabar mereciendo más confianza que las
palabras de las que salió — ver [Confianza: quién lo escribió](#trust-who-wrote-it).

### Confianza: quién lo escribió {#trust-who-wrote-it}

Cuánto se fía EYAS de un texto recordado depende de **quién lo escribió**, no
de en qué lado de la conversación apareció.

| Confianza | Qué cubre |
|-----------|-----------|
| **owner** | Lo que escribes en una conversación, incluido un turno de Modo Dios |
| **derived** | Texto que escribió un agente o el propio EYAS: las respuestas del modelo, una tarea que un agente delega en otro, un encargo de relevo, el prompt que Prompt coach / Prompt enhancer compone en torno a tu borrador, el objetivo de una tarjeta del tablero cuando corre en segundo plano y el encargo que recibe un miembro de un equipo |
| **peer** | Mensajes de remitentes de canales (Telegram, correo y otros canales) y tareas que otro sistema envía por A2A, y las notas de vault que el capture de memoria saca de ellos (`trust: peer`) |
| **ingested** | Salida de herramientas |
| **quarantined** | Texto marcado — se conserva, pero nunca se recuerda |

Los hechos y los resúmenes nunca merecen más confianza que el texto del que
salieron, así que una línea como *Target model: X* en un prompt del coach, o
*Deadline: Friday* en una tarea delegada, ya no puede convertirse en un hecho de
nivel propietario. El recall también pondera estos niveles (ver
[Cómo ordena el recall](#how-recall-ranks)): la salida de herramientas y el
texto importado de terceros cuentan 0,6×, los remitentes de canales 0,3×, el
texto en cuarentena nunca.

**También se recuerdan las instrucciones de segundo plano y de equipo:** el
objetivo de una tarjeta cuando una ejecución en segundo plano la arranca, y el
encargo de cada miembro de un equipo. Cada instrucción distinta se recuerda una
vez, por muchas veces que se reintente o reanude la ejecución. No aparece nada
nuevo en la propia conversación.

**Las notas de vault también tienen nivel de confianza.** Una nota que escribió
un modelo es *derived*, no tuya — las notas automáticas por turno, la
consolidación nocturna y los resúmenes de equipo. Las reconoces por una entrada
`origin` en el frontmatter (`by: capture`, `consolidation` o `team`, más el
proveedor, el modelo y la conversación cuando se conocen), la etiqueta
`auto-consolidated` o su enlace a la conversación que las capturó. Quitar a mano
el `origin` de una nota no devuelve a una nota de capture la confianza de
propietario, porque el enlace de capture la sigue marcando. Una nota que el
capture sacó de un mensaje de canal o de una tarea A2A lleva `trust: peer` y se
guarda con confianza de par; nunca refuerza una nota con más confianza que ella,
así que un hecho repetido recibe su propio archivo. Las notas que escribiste a mano o importaste tú
siguen siendo *owner*. Puedes añadir `trust:` al frontmatter de una nota, pero
solo puede **bajar** el nivel, nunca subirlo: `trust: quarantined` deja una nota
fuera de las líneas de memoria permanentes, y el asistente no puede abrirla con
`memory_expand` (el archivo sigue en el vault y en el explorador del Vault).

**Actualización.** En el primer arranque tras actualizar, EYAS lee cada nota del
vault una vez para registrar su nivel de confianza, así que ese arranque tarda
un poco más. Unos segundos después, una pasada única en segundo plano corrige la
memoria de las notas de vault existentes — las notas escritas por un modelo
pierden el nivel propietario, las notas de proyecto pasan a su proyecto — y
reconstruye sus hechos y su resumen. No hay nada que hacer, y la pasada no se
repite.

<h3 id="what-eyas-works-out-from-it--with-no-model-call">Qué deduce EYAS de ahí — sin ninguna llamada al modelo</h3>

Cada vez que se vuelca un lote, EYAS relee lo que acaba de escribir y deduce por
su cuenta:

- **hechos** a partir de líneas `key: value` del texto, más unos pocos de la
  propia tarjeta de la conversación en el tablero (título, proyecto, tipo de
  proyecto, agente);
- **un resumen corto** de 280 caracteres como máximo — el primer y el último
  mensaje más algunas de las frases más características de en medio;
- **entidades**: fechas, `@mentions`, `#tickets`, identificadores de código,
  términos entre backticks, nombres en mayúscula;
- **temas**, y una **puntuación de importancia** construida a partir de lo larga
  que es la conversación, cuánta parte es tuya, si contiene fórmulas de decisión
  (en cinco idiomas), si está cerrada y si la has fijado.

Nada de esto llama a un modelo. No se contacta con ningún proveedor, no se usa
ninguna API key, no se gasta presupuesto y no hay nada que configurar. La otra
cara del trato es que lee con cuidado, no con ingenio: encuentra lo que se dijo
llanamente y se pierde lo que solo estaba insinuado.

Los hechos no se amontonan. Decir lo mismo otra vez enlaza con el hecho que ya
está. Decir algo nuevo sobre el mismo asunto — una fecha límite que pasa del
lunes al viernes — retira el hecho antiguo poniéndole una fecha de fin en vez de
sobrescribirlo, así que hay exactamente una respuesta vigente y un historial
intacto detrás. Nada se edita en el sitio y nada se tira. Un hecho tampoco
hereda nunca una etiqueta de proyecto o de conversación que no lleven todas sus
fuentes.

Los resúmenes y los hechos son lo que leen las líneas de memoria permanentes
(ids `gs:`), el recall, `memory_search` y `memory_expand`. Reciben sus vectores
de búsqueda aproximadamente medio segundo después de escribirse un lote (ver
[La búsqueda vectorial siempre corre en local](#vector-search-always-runs-locally)).

### Lo que te cuesta, y cómo apagarlo {#what-it-costs-you-and-how-to-switch-it-off}

El registro en bruto crece con el uso, y **todavía no lo poda nada**: en esta
versión no hay ajuste de retención ni tarea de limpieza. Medido, un mensaje
grabado cuesta del orden de 5 KB en disco contando sus índices, así que espera
que la base de datos crezca bastante más rápido que antes.

Tres ajustes en `config/default.yaml`, todos bajo `memory`:

| Ajuste | Por defecto | Significado |
|--------|-------------|-------------|
| `memory.l0.enabled` | **on** | Interruptor maestro. `false` no graba absolutamente nada; surte efecto en el siguiente reinicio |
| `memory.l0.extractInLegacy` | **on** | `false` conserva el texto y no deduce nada de él — ni hechos, ni resúmenes, ni temas |
| `memory.engine` | `legacy` | Solo decide si corre la extracción determinista de hechos: `v2` extrae siempre; `legacy` extrae mientras `memory.l0.extractInLegacy` esté activado (el valor por defecto). El recall es siempre el recall por capas que describe esta página, sea cual sea el valor |

`memory.capture.enabled: false` **no** apaga el registro en bruto. Ese gobierna
las notas de vault y la pequeña llamada al modelo que hay detrás; los dos son
independientes, y apagar uno deja el otro corriendo.

`eyas doctor` informa de si hay compresión disponible y qué implementación se
usa. Si no hay ninguna, EYAS lo dice en el log y no graba nada, en vez de llenar
un búfer en silencio.

<h3 id="tool-results-are-not-recorded--and-why-to-leave-it-that-way">Los resultados de herramientas no se graban — y por qué dejarlo así</h3>

`memory.l0.captureToolResults` está **apagado por defecto**. Lee esto antes de encenderlo.

Un solo interruptor cubre cada herramienta que llama una ejecución de agente, responda el modelo que responda: las herramientas propias de EYAS; las herramientas de EYAS que Claude Code, Grok o Kimi llaman por el puente de EYAS; y las herramientas integradas de Claude Code, Grok y Kimi — ejecutar comandos, leer, escribir o buscar archivos. También cubre OpenCode: las herramientas que OpenCode ejecuta dentro de una tarea `opencode_run`, y la salida del terminal de OpenCode de la conversación (el icono de terminal en la barra superior de la conversación), que solo se graba para una conversación que existe y pertenece al usuario del terminal. La respuesta final y los diffs de OpenCode son el resultado de `opencode_run` y se graban como cualquier otro resultado de herramienta. (Antes, OpenCode guardaba la salida de su terminal y sus eventos dijera lo que dijera este interruptor.)

- Solo se graban las llamadas que de verdad se ejecutaron. Una llamada fallida se graba y se marca como error. Las llamadas rechazadas (denied), omitidas o a la espera de aprobación no se graban, ni tampoco los resultados vacíos ni las repeticiones de la misma llamada.
- Cada llamada grabada guarda lo que devolvió: el nombre de la herramienta, la salida, si falló, el desenlace y quién la ejecutó (EYAS o la propia CLI del modelo). Los primeros 2048 caracteres de sus argumentos se guardan al lado solo como procedencia: no se indexan a texto completo y nunca dan forma a los temas, nombres ni hechos que EYAS extrae.
- Solo se graban las llamadas hechas dentro de una ejecución de agente que pertenece a una conversación. Una herramienta llamada fuera de cualquier ejecución de agente (por ejemplo, por un cliente MCP externo) no se graba. La salida de terminal se graba solo para una conversación que existe y pertenece al usuario del terminal.
- Las llamadas grabadas se archivan en el proyecto de la conversación, con confianza *ingested* (ver [Confianza: quién lo escribió](#trust-who-wrote-it)).

Encendido, el registro en bruto guarda **la salida entera de cada llamada a herramienta, palabra por palabra y sin editar**, más los primeros 2048 caracteres de sus argumentos. Es decir: la salida completa de un comando, el contenido de cada archivo que lee el asistente y cualquier código de un solo uso o token que una herramienta devuelva — todo ello en la base de datos como texto normal. Nada lo enmascara, nada lo analiza, y la compresión no es cifrado. Las notas de vault pasan por el módulo de privacidad antes de escribirse; los resultados de herramientas grabados, no.

**Qué vuelve a un prompt.** Una llamada a herramienta grabada nunca se recupera ni se cita: ni en la memoria que EYAS añade a un turno, ni a través de `memory_search` o `memory_expand`, ni en la búsqueda de la página Memoria, ni en el resumen de su conversación. Solo su salida da forma a los temas y los nombres (un nombre de archivo o de función, por ejemplo) que EYAS extrae de la conversación; los argumentos no dan forma a nada. Así, una contraseña que una herramienta escribió en un formulario, un término de búsqueda o una ruta que pasó el modelo nunca se convierte en tema, nombre ni hecho, y un token que imprimió un comando o una página web que descargó una herramienta nunca reaparece en el prompt de otra conversación — tampoco cuando ese prompt va a un modelo remoto.

`memory.l0.toolResultMaxBytes` (8 KB) limita el registro de lo que devolvió la llamada — nombre de la herramienta, salida, indicador de error, desenlace y quién la ejecutó —, cortado en un límite de carácter con una marca de truncado visible. Los argumentos no cuentan para ese límite; se recortan aparte a sus primeros 2048 caracteres. Con el interruptor encendido, EYAS registra en cada arranque un aviso de que los resultados de herramientas se guardan literales y sin censurar y de que nada los analiza ni los cifra.

### Razonamiento del modelo (solo auditoría) {#model-reasoning-audit-only}

`memory.l0.captureThinking` (por defecto **apagado**) guarda en el registro en
bruto el razonamiento («thinking») de cualquier modelo que lo informe, una
entrada por llamada al modelo. Es solo para auditoría: nunca se convierte en
hechos ni se recupera en un prompt. Se guarda literal y sin censurar, como los
resultados de herramientas, y EYAS imprime un aviso al arrancar mientras está
encendido.

Los dos interruptores se leen al inicio de cada ejecución desde la
configuración en marcha; un cambio en `local.yaml` se aplica tras reiniciar
EYAS.

**Procedencia.** Los resultados de herramientas y el razonamiento grabados, y
las respuestas de las ejecuciones en segundo plano, de equipo y delegadas,
registran ahora el proveedor y el modelo que respondieron de verdad (no siempre
el pedido, por ejemplo tras un fallback) y cómo arrancó la ejecución:
interactiva, en segundo plano, de equipo, delegación, A2A, canal o pipeline.
Las filas antiguas simplemente no tienen estos campos.

### Por qué se rechazan algunas frases {#why-some-sentences-are-refused}

Un texto que suena a instrucción para el asistente no puede convertirse en un
hecho fiable. «Ignora todas las instrucciones anteriores», un cambio de rol del
tipo «a partir de ahora eres…» o cualquier cosa disfrazada de mensaje de sistema
se rechaza de plano. Las órdenes llanas dirigidas al asistente, las órdenes de
ejecutar una herramienta y las fórmulas del tipo «olvídalo todo» se conservan
pero se marcan como no fiables, para que una recuperación posterior pueda
dejarlas fuera. La comprobación cubre inglés, húngaro, alemán, español y
francés.

Cuando se rechaza un resumen, EYAS baja un escalón en vez de rendirse: primero a
un resumen más llano, luego solo a las frases que salen limpias y, por último, a
un esbozo que nombra la conversación sin repetir su texto. Nunca pierdes la
conversación, solo el resumen de ella.

Es un filtro de patrones, no una demostración, y peca de prudente: una prosa de
trabajo tan normal como `Ejecuta el siguiente comando en el pod: …` también se
marca a veces como no fiable. El texto marcado como posible inyección de prompt
(en cuarentena) nunca se recupera ni se abre con `memory_expand`, tampoco a
través del resumen de la conversación de la que salió.

**Las notas que escribe un modelo pasan el mismo filtro.** El capture de memoria
por turno, los resúmenes de la consolidación nocturna y los resúmenes de las
sesiones de equipo se comprueban antes de escribir nada en el vault, y
cualquier coincidencia rechaza la escritura:

- **Capture:** la nota rechazada se descarta. La ejecución de capture se
  registra con el motivo `poison_gate`, y cuenta para `maxPerConversation`,
  porque se llamó al modelo.
- **Consolidación:** no se escribe nada y los recuerdos episódicos se quedan; la
  siguiente ejecución nocturna vuelve a intentarlo.
- **Sesiones de equipo:** solo se deja fuera el hallazgo o la decisión
  problemáticos.

Los rechazos aparecen en el log del servidor con el nombre del detector, nunca
con el texto rechazado, así que un falso positivo es visible, nunca silencioso.

---

## Poner en cuarentena la memoria de un proveedor {#quarantine-a-providers-memory}

Úsalo cuando un modelo — normalmente una CLI como Grok CLI, Kimi Code CLI o Claude Code — se ejecutó sin el aislamiento de EYAS y pudo responder con memoria ajena
a EYAS, como la carpeta de memoria de otra herramienta o una bóveda de
Obsidian. Sus respuestas se guardaron en la memoria de EYAS como cualquier otro
turno y podían volver después a todos los modelos.

**Dónde:** **Memoria → Resumen**, tarjeta **Poner en cuarentena la memoria de
un proveedor**. Solo el propietario puede usarla; los admins y usuarios ven
*Solo el propietario puede poner en cuarentena o liberar la memoria.*

1. Marca uno o varios **Proveedores**. La lista muestra cada proveedor que ha
   escrito memoria, con el número de sus filas que aún se pueden recuperar.
2. Si quieres, fija las fechas **Desde** / **Hasta**. Son días locales
   completos e inclusivos; vacío significa sin límite.
3. Pulsa **Vista previa**. Muestra cuántas filas en bruto, hechos, resúmenes y
   notas capturadas se ocultarían, y de cuántas conversaciones. Todavía no
   cambia nada.
4. Pulsa **Cuarentena** y confírmalo en línea. Cancelar no cambia nada.

**Qué se oculta a todos los modelos**, en todos los caminos (el bloque de
memoria por turno, `memory_search` / `memory_expand`, el índice de memoria
permanente y la búsqueda vectorial):

- las respuestas del proveedor y la salida de herramientas de sus ejecuciones —
  según el proveedor registrado en cada fila; las filas antiguas sin él usan el
  proveedor al que está fijada la conversación;
- cada hecho y resumen derivado de ellas, incluido el resumen de una
  conversación que también cubre tus mensajes, y cualquier hecho con al menos
  una fuente así;
- las notas capturadas de las conversaciones afectadas. Se mueven a la carpeta
  del vault `.quarantine/<id>/…`, así que desaparecen del explorador del vault,
  del índice de notas y de la búsqueda.

**Qué no se ve afectado:** tus propios mensajes nunca se ponen en cuarentena; la
transcripción de la conversación no cambia; no se borra nada. Los turnos futuros
del proveedor se siguen guardando con normalidad — la cuarentena es una
limpieza, no un bloqueo, así que cambia la conversación a otro modelo o
asegúrate de que la CLI se ejecuta aislada. Las notas semánticas que la
consolidación nocturna escribió a partir de varias conversaciones no llevan
enlace a ninguna conversación y no se rastrean; revísalas en el explorador del
vault.

**Historial y liberación.** El historial lista cada cuarentena con sus
proveedores, la hora y los recuentos, y un botón **Liberar** (o *Liberada
&lt;fecha&gt;*). Liberar restaura exactamente los niveles de confianza que tenían
antes las filas y devuelve las notas a su sitio. Si una nota nueva ha ocupado la
ruta de una nota restaurada, la antigua vuelve como `<nombre>-restored.md`,
todavía marcada como escrita por un modelo. Una nota borrada a mano de la
carpeta `.quarantine` se informa como ausente; todo lo demás se restaura
igualmente. Lo que la comprobación automática de envenenamiento ya había puesto
en cuarentena sigue en cuarentena, igual que los hechos y resúmenes creados a
partir de filas en cuarentena después de la cuarentena. Poner de nuevo en
cuarentena la misma selección no hace nada; las cuarentenas solapadas se pueden
liberar por separado.

**Auditoría.** Cada aplicación y liberación se escribe en el registro de
auditoría (acciones `memory.quarantine.apply` / `memory.quarantine.release`,
módulo `memory`) y en el log del servidor; el registro exacto (ids de fila por
nivel de confianza previo, notas movidas) se guarda en el registro de purgas de
memoria.

**API (solo el propietario; `delete` sobre MemoryEntry).** El cuerpo es
`{providers: string[], from?: epochMs, to?: epochMs, conversationIds?:
string[]}`; un cuerpo no válido recibe `400`. `GET /api/v1/memory/quarantine`
devuelve `{entries, providers}`; `POST /api/v1/memory/quarantine/preview`
devuelve `{counts}`; `POST /api/v1/memory/quarantine` devuelve `201 {id,
counts}`, o `200 {id: null}` cuando no queda nada que poner en cuarentena; `POST
/api/v1/memory/quarantine/:id/release` devuelve `404` para un id desconocido y
`409` si ya se liberó.

## Memory blocks compartidos (retirados) {#shared-memory-blocks-retired}

Las herramientas de agente `memory_block_read` y `memory_block_write` ya no
existen. Lo que los agentes habían guardado en bloques no se pierde: en el
primer arranque tras la actualización, cada bloque se copia una vez a la
memoria de EYAS como nota escrita por un modelo, y desde entonces se encuentra
como cualquier otra memoria — en el recall permanente, con `memory_search` y con
`memory_expand` (como resultado `rw:`). Los bloques pasan a ser memoria global,
como lo eran en la práctica (cualquier agente podía leer cualquier bloque). Un
bloque cuyo texto parece una instrucción para el asistente se conserva para
auditoría, pero nunca se recupera. Un agente personalizado cuya lista de
herramientas aún nombra `memory_block_*` simplemente ya no recibe esas
herramientas; no falla nada.

## Relacionado {#related}

- [Base de conocimiento](/docs/es/knowledge/knowledge-base/)
- [Documentos](/docs/es/knowledge/documents/)
- [Wiki del proyecto](/docs/es/knowledge/client-wiki/)
- [Proveedores](/docs/es/ai/providers/) (aislamiento de CLI)
- [Seguridad y privacidad](/docs/es/admin/security-privacy/) (memoria fuera de EYAS)
- [Importación de datos](/docs/es/admin/data-port/)
- [Configuración](/docs/es/deploy/configuration/) (claves `memory.l0.*`)
- [Herramientas](/docs/es/automation/tools/)
- [OpenCode](/docs/es/automation/opencode/) (herramientas de memoria dentro de OpenCode)
- [Observabilidad](/docs/es/admin/observability/) (entrega de memoria por proveedor)
