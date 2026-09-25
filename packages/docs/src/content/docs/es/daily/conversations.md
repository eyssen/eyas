---
title: Conversaciones
description: Habla con agentes — envía trabajo, adjunta diseños y dirige la orquestación en un hilo.
---

**Para qué sirve.** Una conversación es el lugar donde hablas con un agente. Los mensajes van en el panel principal; proyecto, etapa, fuentes, archivos y ejecución viven en la columna derecha. El mismo hilo es una tarjeta del Tablero, así que chat y pipeline siguen siendo un solo registro.

## Cuándo usarlo

- Quieres que un agente haga un trabajo y ver la respuesta, las llamadas a herramientas y el progreso en un solo sitio.
- Necesitas fijar qué árbol de código indexado (versión de Odoo, addons) puede buscar este hilo, y qué **carpetas de trabajo** pueden tocar las herramientas de archivo.
- Quieres elegir con qué modelo responde la conversación — un modelo fijo, el enrutamiento automático o el predeterminado del colega (el selector de modelo de la barra superior).
- Una habilidad coincidió y espera — la aceptas, la omites en este hilo o la desactivas globalmente.
- Quieres que el modelo escriba un plan y espere antes de ejecutar cualquier herramienta (**Plan primero**).
- Quieres que varios modelos compitan en la misma tarea (**Modo Dios**), o que los colegas incorporen especialistas (`run_specialist`) sin tarjeta de equipo.
- Quieres que un lienzo de diseño viaje con cada turno, o que el Prompt Enhancer dé forma al borrador antes de enviarlo.

## Flujo típico

1. Abre un **colega** en la lista **Colegas** de la barra lateral (su hilo de inicio), pulsa **Nueva conversación** (sección **Principal**) o abre una tarjeta del **Tablero** / de **Conversaciones recientes** en Inicio. Ruta `/conversations/:id`.
2. Define **Proyecto:**, **Etapa:** y el agente antes del primer mensaje (el agente se bloquea después). El selector de agente lista a tus colegas **Principal** y **Equipo**. Fija **Fuentes** si hay varios árboles de código indexados. Revisa **Carpetas de trabajo** — un hilo nuevo hereda la lista del proyecto (o la del tipo de proyecto cuando el proyecto no tiene).
3. Escribe en el compositor. Usa el **Prompt Enhancer** si el borrador necesita forma; el icono de mapa es **Plan primero** (escribe un plan y espera antes de las herramientas). Adjunta archivos o, desde la barra superior, **Diseños**.
4. Si aparece una tarjeta de propuesta de habilidad, elige **Úsala**, **Ahora no** o **Desactivar**. Envía. La respuesta llega en streaming con filas de herramientas en vivo, el pie *Proveedor · modelo* debajo y la franja fina de contexto que muestra lo llena que está la ventana del modelo. **Detener** cancela la ejecución.

## Funciones

Disposición: la **barra superior** y la **barra de campos** sobre **mensajes + compositor** (panel principal); a la derecha, la franja **En ejecución** (árbol de ejecución, progreso del agente, subconversaciones) sobre el **riel de contexto** (chatter: historial, fuentes, carpetas, siguientes pasos, archivos).

## Estado de la conversación

| Estado | Significado |
|--------|-------------|
| **Inactivo** | No hay ninguna ejecución de agente activa |
| **Trabajando…** | El agente se está ejecutando |
| **Esperando** | Espera una entrada tuya o externa |
| **Esperando aprobación** | Bloqueado por una aprobación humana (seguridad / autonomía) |
| **Esperando el plan** | Turno de Plan primero: la tarjeta del plan espera **Aprobar** / **Omitir plan** / **Rechazar** |
| **Archivado** | Hilo cerrado / archivado |

---

## Barra superior

De izquierda a derecha: la flecha de volver, el título (haz clic para renombrarlo — ver [Título automático](#automatic-title)), la insignia de estado, el nombre del colega, un icono de ayuda, la prioridad, el icono del terminal de OpenCode, el icono **Diseños**, el ámbito de voz y el selector de modelo. La franja fina del borde superior es la franja de contexto ([Composición del contexto](#context-composition)).

| Control | Significado |
|---------|-------------|
| **Baja / Normal / Alta / Urgente** | Prioridad de negocio de la conversación (también se ve en el Tablero) |
| Icono de terminal (*Terminal OpenCode*) | Abre un terminal de OpenCode para esta conversación sobre el riel derecho. Solo lo ven el propietario y los administradores (el permiso de gestión de OpenCode) — ver [OpenCode — Quién puede abrir una terminal](/docs/es/automation/opencode/#who-can-open-a-terminal) |
| **Diseños** (icono de formas) | Lienzos que viajan con cada turno — ver [Diseños adjuntos](#attached-designs) |
| **Voz: …** | El ámbito de voz activo y su anulación — ver [Ámbito de voz](#voice-scope) |
| **Modelo** (a la derecha) | Haz clic para elegir cómo escoge su modelo esta conversación. Tiene un cuadro de búsqueda (*Buscar modelos…*) y tres tipos de opción: **Modelo fijo** — cada modelo activado de un proveedor activado, agrupado como *Modelo fijo · &lt;proveedor&gt;* (por ejemplo *Modelo fijo · Claude Code CLI*); **Enrutamiento automático** — EYAS elige un modelo para cada mensaje; **Predeterminado del colega (&lt;modelo&gt;)** — solo en una conversación con un colega y en las subconversaciones. |
| *Modelo predeterminado — se fija con el primer mensaje* | Una conversación nueva sin colega: el modelo predeterminado actual se fija en ella con el primer mensaje y se queda aunque los valores por defecto cambien después |
| Tooltip | Qué modelo responde al siguiente mensaje y por qué, por ejemplo *Responde con Claude Code CLI / sonnet — el modelo fijado en esta conversación*. Otros motivos: el modelo propio del colega; el modelo de la conversación que delegó esta; el enrutamiento automático elige el modelo para cada mensaje (se muestra: el nivel Standard); el modelo predeterminado |
| Icono de aviso | Se aplica una alternativa (el modelo del colega o el modelo propio de la conversación no está disponible, o el enrutamiento automático está desactivado o no tiene nivel), o ningún modelo puede responder. Pasa el cursor por encima para ver el motivo |
| **Enrutamiento automático** en gris | El enrutamiento automático no está permitido: *activa «Permitir enrutamiento automático» en Proveedores.* |
| Selector atenuado | El Modo Dios está activo: *El Modo Dios usa la plantilla de Ajustes* |

Los nombres de los proveedores son los mismos en toda la aplicación — en el selector, en el pie de la respuesta, en los mensajes de error y en la página Proveedores.

### Qué modelo responde {#which-model-answers}
Una conversación conserva el modelo en el que se ejecuta; los mensajes no se reenrutan uno a uno. Cómo, lo eliges en el selector de modelo (arriba).

- **Modelo fijo.** Una conversación fijada a un modelo responde siempre con él. Una conversación nueva sin colega que no nombra modelo recibe el valor por defecto de la instalación — el nivel de enrutamiento Standard, si no el proveedor por defecto, si no el primer proveedor activo con un modelo, CLI incluidas — con su **primer mensaje**, y lo conserva desde entonces. Cambiar después el proveedor por defecto o los niveles de enrutamiento no mueve las conversaciones existentes. Las conversaciones creadas antes conservan el proveedor y el modelo que ya tenían guardados; una conversación antigua sin modelo guardado recibe el valor por defecto actual con su siguiente mensaje.
- **Predeterminado del colega.** Una conversación con un colega, y una subconversación, sigue el modelo propio del colega; si no, el modelo de la conversación que la delegó; si no, el modelo predeterminado, fijado con su primer mensaje. Un especialista lanzado con `run_specialist` / `delegate_to_agent`, una tarjeta repartida con `assign_task` y una subconversación creada con `create_sub_conversation` se ejecutan con el modelo **en el que realmente se ejecutó el turno que delega** — no con una copia de los ajustes guardados del padre. El hilo de inicio de un colega abierto por un traspaso sigue el modelo del colega, no el de la conversación que traspasó. Si el modelo del colega no está disponible (su proveedor está desactivado o el modelo está desactivado), la conversación recurre a su modelo guardado o al predeterminado y la respuesta registra la nota `agent-binding-unavailable`; EYAS nunca elige otro proveedor por su nombre.
- **El enrutamiento automático** es una elección por conversación. Solo una conversación puesta en Auto pasa por triaje: su mensaje se clasifica y se enruta al nivel Quick, Standard, Complex o Code. El interruptor **Permitir enrutamiento automático** de la página Proveedores solo lo *permite*; mientras está apagado, la entrada del selector aparece en gris, y una conversación Auto existente usa su modelo guardado y lo indica. Las conversaciones existentes no se pasan a Auto automáticamente. Ver [Enrutamiento y presupuesto](/docs/es/ai/routing-budget/#auto-routing).
- **Un modelo que eliges nunca se cambia en silencio.** Si un modelo que elegiste en el selector deja de estar disponible (él o su proveedor se desactivan, o una CLI deja de ofrecerlo), EYAS no responde con otro modelo: el mensaje se rechaza y no se guarda, con *El modelo &lt;proveedor&gt; / &lt;modelo&gt; no está disponible: él o su proveedor están desactivados. Elige otro modelo en el selector de modelo de la parte superior de la conversación, o actívalo en Proveedores.* El selector muestra el modelo en rojo con el mismo motivo, y elegir otro modelo lo resuelve. Las ejecuciones de tarjetas en segundo plano de una conversación así fallan igual.
- **Los modelos que fijó EYAS recurren a otro con una nota.** El predeterminado fijado con el primer mensaje, las conversaciones de antes de que existiera el selector y el modelo que delega de una subconversación: cuando uno de ellos no está disponible, la conversación responde con el modelo predeterminado y lo indica (icono de aviso y tooltip). Vuelve automáticamente en cuanto su propio modelo regresa. Solo si tampoco hay un valor por defecto se rechaza el mensaje (código `model_binding_unavailable`). Sin ningún modelo configurado, la ejecución falla con *No hay ningún modelo configurado…* (código `no_model_configured`) y no se reintenta.

**Quién respondió.** Cada respuesta del asistente muestra un pequeño pie *Proveedor · modelo* (por ejemplo *Grok CLI · grok-4*). Su tooltip dice *Respondido por …* y añade por qué se usó ese modelo y cualquier alternativa aplicada. Si un failover respondió con otro modelo, el pie nombra el modelo que respondió de verdad. Una respuesta que aún está en streaming muestra el modelo en cuanto empieza el turno; las respuestas del Modo Dios muestran el modelo ganador.

**El contexto se conserva al cambiar.** Cambiar de proveedor o de modelo conserva el contexto de la conversación. EYAS envía la conversación entera desde su propio almacén en cada turno; ningún proveedor — Claude Code, Grok CLI y Kimi Code CLI incluidos — guarda ni reanuda una sesión propia. Ver [Proveedores — Continuidad de la conversación](/docs/es/ai/providers/#conversation-continuity).

**API (integradores).** `POST /api/v1/conversations` guarda `providerId` + `modelId` solo si ambos nombran un modelo activado de un proveedor activo (si no, no se guarda nada y el valor por defecto se fija con el primer mensaje), y acepta un `modelBinding` opcional (`pinned` | `auto` | `inherit`; `inherit` necesita un colega, si no `400 binding_inherit_needs_agent`) y un `effort` inicial opcional. `POST /api/v1/projects/:id/conversations` (una tarjeta en el tablero de un proyecto) aplica la misma regla. `PATCH /api/v1/conversations/:id` acepta `modelBinding` y `providerId` + `modelId`, siempre enviados juntos y validados (`400 model_binding_unavailable` para un modelo desconocido o desactivado); un PATCH que envía un par lo marca como tu elección (un indicador que el cliente no puede fijar directamente). `GET` devuelve `effectiveBinding` (proveedor, modelo, por qué y soporte de imágenes) y `autoRoutingEnabled`, y el stream en vivo anuncia el binding cuando empieza un turno. Una anulación de proveedor + modelo para un solo turno en `POST …/messages` debe enviar ambos. Los objetos de conversación ya no incluyen `sdkSessionId`, y un `PATCH` que lo envíe se ignora.

### Composición del contexto {#context-composition}
La franja fina del borde superior de la conversación es clicable: abre el panel **Composición del contexto** del turno actual — cada sección que entró en el prompt de ese turno, en el orden en que se ensambló, con su tamaño, si se truncó y su contenido en bruto. Es por turno, no un acumulado de toda la conversación.

La zona **turn** contiene lo que va adjunto a tu mensaje en lugar de al prompt de sistema: **turn-time** (la fecha y la hora actuales) y **memory-recall** (el bloque de memoria recordada, sus ids y su presupuesto). La sección de runtime ya no lleva la fecha y la hora, y las antiguas secciones *memory-index* y *related-work* han desaparecido. Ver [Memoria — Cómo llega el recall al modelo](/docs/es/knowledge/memory/#how-recall-reaches-the-model).

El tamaño de las secciones sigue al modelo que responde el turno — fijo o elegido por el enrutamiento automático —, así que si una sección se truncó depende de la ventana de contexto de ese modelo. Un modelo de ventana grande recibe más sitio para el contexto del proyecto y los archivos del agente; un modelo local pequeño recibe un prompt que aún deja sitio a la conversación. Ver [Prompts — a la medida del modelo](/docs/es/ai/prompts/#prompt-size). En un bucle de agente, el panel refleja la última llamada al modelo del turno.

**Lo llena que está la ventana.** La franja muestra lo llena que está de verdad la ventana de contexto del modelo:

- **Medido.** Cuando el proveedor informa del tamaño del prompt de la última llamada al modelo, la franja usa ese número y su tooltip dice *medido* (Anthropic y compatibles con Anthropic, la familia OpenAI incluidos OpenRouter, Kimi API y LM Studio, Gemini y Claude Code).
- **Estimado.** Si no, muestra una estimación, marcada con `~` y *estimado*: el prompt de sistema más el historial de la conversación enviado con el turno. Ollama, Grok CLI y Kimi Code CLI muestran siempre la estimación (Ollama deja fuera la parte que reutiliza de su caché; las CLI de Grok y Kimi informan de un total de sus pasos internos).
- **La ventana** es la propia del modelo elegido, en todos los proveedores: gana la ventana indicada para el modelo en Proveedores, así que un modelo CLI listado con una ventana de 1M usa 1M. Cuando el runtime informa de la ventana del modelo que respondió (Claude Code lo hace), esa gana. Las ventanas fijas de las CLI (Claude Code 200k, Grok 500k, Kimi 256k) solo son el recurso para un modelo del que la lista no tiene ventana. Las entradas Fable, Opus, Sonnet y Haiku de Claude Code indican 200k — la ventana que el runtime da a esos nombres —, también antes de que el runtime haya informado de sus modelos; solo una entrada que el runtime ofrece como su variante de 1M (por ejemplo *Opus (1M context)*) se lista con 1M. Tras cambiar la conversación a otro modelo, la franja usa al momento la ventana del nuevo modelo.
- Los colores (por debajo del 50 % / por debajo del 75 % / 75 % o más) siguen los colores de éxito, aviso y destructivo del tema. El mismo número mueve la franja *% context* de la tarjeta del tablero. Los turnos antiguos muestran su estimación hasta el siguiente turno.

**Privacidad por sección.** Cada sección del prompt registrada tiene una insignia de privacidad:

| Insignia | Significado |
|----------|-------------|
| *N enmascarados · &lt;tipos&gt;* | Los valores se sustituyeron por marcadores como `[EMAIL]` antes de que el modelo los viera (por ejemplo *2 enmascarados · Correo electrónico, IBAN*) |
| *no analizado (generado por EYAS)* | La identidad, las reglas, el reloj del runtime, las carpetas de trabajo, las listas de herramientas/habilidades/agentes y la directiva de orquestación se envían tal cual |
| *nada enmascarado* | La sección se analizó y no hubo que enmascarar nada |
| *destino local — sin enmascarar* | El modelo se ejecuta en esta máquina (loopback o un host listado en Privacidad → Hosts locales), así que a propósito no se enmascara nada |
| Sin insignia | No se registró nada para la sección: las secciones enviadas dentro de tu mensaje (el bloque de memoria por turno), las secciones que no se pudieron localizar en el prompt (se analizan igualmente, con el resto del texto de sistema) y los turnos en los que aún no se registraba el enmascarado |

Cuando se enmascaró algo, aparece un conmutador **Tal como se compuso / Tal como se envió al modelo**; *Tal como se envió al modelo* muestra la sección con los marcadores exactamente como los recibió el modelo. Una línea nombra la versión de la política de privacidad usada (*Política de privacidad regex@2/policy@N*), y una línea *Resultados enmascarados de herramientas de memoria: memory_search (2), …* lista los resultados de herramientas de memoria en los que se enmascararon valores — incluidos los que Claude Code, Grok y Kimi obtuvieron por el puente de herramientas de EYAS. Ver [Seguridad y privacidad — Dónde se aplica el enmascarado](/docs/es/admin/security-privacy/#where-masking-applies).

**Memoria entregada.** Un recuadro muestra qué memoria llegó al modelo, igual sea lo que sea lo que respondió el turno (proveedores de API, Claude Code, Grok, Kimi o un modelo local), una línea por dato:

- *Dimensionado para &lt;modelo&gt; · ventana de &lt;N&gt; tokens* — el modelo para el que se dimensionaron el prompt y el presupuesto de memoria; *ventana desconocida, se usó la base de 100k tokens* cuando EYAS no conoce la ventana de ese modelo.
- *&lt;hits&gt; elementos recuperados (&lt;expanded&gt; completos) · &lt;tokens&gt; / &lt;budget&gt; tokens* — el bloque de memoria recordada adjunto a este mensaje (notas permanentes más los elementos recuperados para él), cuántos llevaron adjunto su texto completo y el tamaño estimado del bloque frente a su tope para esta ventana. Si no, *No se recuperó memoria para este mensaje*, o *Recuperación retenida: &lt;motivo&gt;* — la respuesta va a alguien que no eres tú (un par A2A o una respuesta de canal con voz externa); la ventana de contexto del modelo no deja espacio; no hay memoria que recuperar desde aquí; la recuperación falló y el turno solo llevó la hora.
- *Consultas de memoria: &lt;calls&gt; de &lt;limit&gt; llamadas en este turno · &lt;items&gt; elementos leídos* — las llamadas propias del modelo a `memory_search` / `memory_expand` / `search_memory` en este turno frente al tope por turno de 3 (el mismo en todos los proveedores), contadas hasta la última llamada que encontró algo. Los turnos en los que aún no se contaban las llamadas solo muestran los *elementos leídos*. *Consultas de memoria no disponibles: las herramientas de memoria no llegan a este modelo* cuando el modelo no puede llamar a herramientas o el puente de herramientas de las CLI no pasó su autotest.
- *Prompt de sistema: …* (solo Grok y Kimi) — *entregado como prompt de sistema (verificado)*, *enviado como prompt de sistema (sin verificar)* o *incluido dentro del mensaje*.

El recuadro no aparece en los turnos registrados antes de que existiera, ni cuando no se ensambló ningún prompt. Como el resto del detalle por turno, se conserva 7 días por defecto y después se purga. La tarjeta **Entrega de memoria por proveedor** de [Observabilidad → Contexto](/docs/es/admin/observability/) compara esta entrega entre proveedores.

### Título automático {#automatic-title}
Una conversación nueva empieza con las primeras palabras de tu mensaje como título; después, una llamada corta al modelo puede sustituirlo por uno mejor. Esa llamada solo se ejecuta en el nivel de enrutamiento **Heartbeat**, como llamada aislada, y nunca se carga al modelo propio de la conversación ni a otro proveedor. Cuando el nivel Heartbeat no tiene un modelo elegible (por ejemplo, en una instalación solo con Grok o solo con Kimi antes de verificar su aislamiento), el fragmento del primer mensaje se queda como título. Haz clic en el título para renombrarlo tú.

### Ámbito de voz {#voice-scope}
| Control | Significado |
|---------|-------------|
| **Voz: INTERNO / EXTERNO / AUTO** | Qué perfil de voz está activo ([Perfiles de voz](/docs/es/agents/voice/)); *(predet.)* tras AUTO significa que se aplica el valor por defecto del agente, sin anulación |
| Selector (*Anular ámbito de voz*) | **Auto**, **Forzar: Interno** o **Forzar: Externo** |

---

## Campos de la conversación (contexto)

La barra de campos bajo la barra superior contiene, de izquierda a derecha: proyecto, carpetas de trabajo, agente, etapa, esfuerzo, orquestación y fecha límite. Los responsables y las etiquetas aparecen cuando la conversación los tiene.

| Campo | Significado |
|-------|-------------|
| **Proyecto:** | Proyecto propietario, agrupado por tipo de proyecto (*Ninguno* si no hay). Cambiar de proyecto **vuelve a aplicar las fuentes de código predeterminadas de ese proyecto** en la pestaña Fuentes (salvo que fijes fuentes explícitamente en la misma actualización) y sustituye la lista de carpetas de trabajo. Antes del primer mensaje, también selecciona el agente predeterminado del proyecto. |
| **Carpetas de trabajo** | Qué raíces con nombre puede leer y escribir este hilo; el selector fija cuál es la **principal** (cwd). Un hilo sin carpetas propias trabaja en su propio **espacio de trabajo de EYAS** (ver [Carpetas](#working-folders)); **Sin carpeta** solo aparece si no se puede escribir en la ubicación de los espacios de trabajo. La lista se edita en la pestaña **Carpetas** del riel. |
| Agente | Colega asignado — **bloqueado tras el primer mensaje** (*El agente no se puede cambiar después del primer mensaje*). El chat solo ofrece la lista **Tools** de este colega más `memory_search` y `memory_expand` (sin colega, la lista del agente predeterminado del proyecto); una lista vacía, o ningún agente, significa todas las herramientas. La lista se aplica en todos los proveedores, y un modelo no puede ejecutar una herramienta que no se le ofreció. Ver [Agentes — Herramientas](/docs/es/agents/configure/#tools--constraints). |
| **Etapa:** | Etapa dentro del pipeline del proyecto |
| Esfuerzo | Profundidad de razonamiento. El selector lista solo los niveles que ofrece el modelo de la conversación (de Ninguno, Mínimo, Bajo, Medio, Alto, Muy alto, Máximo; un modelo de encendido/apagado muestra Desactivado / Activado). **Automático** no guarda nada y nombra lo que hereda — *Automático · Máximo (Profundo)*, *Automático · Alto (colega)*, *Automático · Muy alto (conversación que delega)* o *Automático · predeterminado del modelo (Medio)*. Más alto = más profundo, más lento y más caro. Un nivel que el modelo no admite no se guarda, y un mensaje indica los niveles que sí admite. Cuando cambia el modelo, el nivel guardado se queda; uno que el nuevo modelo no tiene se muestra como *Muy alto → Alto (… no ofrece Muy alto)* y cada turno se ajusta. Ver [Proveedores — Esfuerzo de razonamiento](/docs/es/ai/providers/#reasoning-effort). |
| **Orquestación: …** | **Solo** = sin especialistas, traspasos ni propuestas de equipo, con cualquier proveedor (en los modelos CLI, el puente de EYAS incluido): `run_specialist`, `delegate_to_agent`, `handoff_to_colleague` y `propose_team` no se ofrecen; las herramientas de memoria y `assign_task` se mantienen. **Automático** = el modelo incorpora especialistas cuando hace falta. **Profundo** = reparto agresivo con `run_specialist`; Profundo fija el esfuerzo predeterminado en Máximo, y los especialistas sin esfuerzo propio lo heredan. Todos los modelos reciben la misma instrucción Profundo: dividir el trabajo no trivial, ejecutar un especialista por cada parte independiente en paralelo con un encargo preciso y autosuficiente, pasar el trabajo al colega al que le corresponde, proponer un equipo solo cuando todavía no existe un especialista necesario, verificar los resultados importantes y hacer la síntesis final. El último elemento, **Modo Dios**, hace competir la misma tarea con la plantilla de Ajustes (ver [Modo Dios](#modo-dios)). |
| Fecha límite | Plazo de la conversación (también un campo de negocio con seguimiento) |

### Indicadores de complejidad

Cuando la conversación no se ejecuta en el modo simple, una insignia bajo la barra de campos muestra su modo, con la clase de complejidad al lado cuando se conoce.

| Insignia | Significado |
|----------|-------------|
| **Gestionado** | Camino estructurado / supervisado |
| **Autónomo** | Camino con más autonomía |
| **Asistente** | Flujo guiado por asistente |

---

## Flujo de mensajes

| Control / etiqueta | Significado |
|--------------------|-------------|
| *Inicia una conversación…* | Estado vacío |
| **Pensando / Pensando…** | El modelo está razonando (puede mostrar un recuento de caracteres) |
| *Redactando respuesta…* | La respuesta llega en streaming |
| *Ejecutando herramientas…* | Una o más herramientas están en marcha |
| **Detener** | Cancelar la ejecución actual |
| *El agente trabaja en segundo plano…* | Saliste de la página y volviste mientras el agente seguía trabajando — los mensajes aparecerán cuando estén listos |
| Adjunto | Imagen o archivo integrado del hilo (*Abrir el archivo*) |

### Traza de herramientas {#tool-trace}
Cada llamada a herramienta es una fila en vivo del flujo: nombre de la herramienta, una vista previa corta de los argumentos, un resultado corto, la duración y un icono con su estado. Haz clic en la fila para desplegarla.

Las filas se ven igual en todos los proveedores — proveedores de API, Claude Code, Grok CLI y Kimi Code CLI. Usan los nombres comunes de herramientas de EYAS (`read_file`, `run_command`, `edit_file`, …, o el nombre propio de una herramienta de EYAS como `memory_search`), muestran la entrada de la llamada y su salida (una salida muy larga se corta a 64 KiB y se marca), su duración y un diff en las ediciones de archivo. Cuando el nombre propio del proveedor para una herramienta difiere del de EYAS (por ejemplo *Edit* de Claude Code para `edit_file`), se muestra al pasar el cursor por el nombre de la herramienta (*Nombre de la herramienta en el proveedor: …*). El texto de error de una llamada fallida se muestra una sola vez.

| Estado | Significado |
|--------|-------------|
| **En curso** | La llamada está en marcha |
| **Correcto** | La herramienta se ejecutó e informó de vuelta |
| **Fallido** | La herramienta se ejecutó y devolvió un error |
| **Denegado** | Rechazada — por el security gate, la política de memoria (incluida una búsqueda demasiado amplia), o porque el modelo nombró una herramienta que no se le ofreció, o una herramienta propia de una CLI que la lista de **Herramientas** del agente retiene |
| **Requiere aprobación** | Espera una decisión humana (ver [Aprobaciones en el chat](#approvals-in-the-chat)) |
| **Omitido** | Nunca se ejecutó — el presupuesto de llamadas a herramientas, el límite por turno o una repetición en una ejecución reanudada |
| **Resultado desconocido** | La fila seguía abierta cuando terminó el turno |

Una fila solo se marca como hecha cuando la herramienta informó de vuelta de verdad; una llamada denegada, en espera u omitida nunca se muestra en verde. Ver [Proveedores — El mismo chat en todos los proveedores](/docs/es/ai/providers/#same-chat-on-every-provider).

**Una llamada rechazada termina una respuesta de Grok.** Cuando EYAS rechaza una de las llamadas a herramienta de Grok — por ejemplo una lectura de memoria fuera de EYAS —, Grok termina esa respuesta: el chat muestra la fila **Denegado** y nada después. El modelo de Grok no ve el motivo de EYAS, así que vuelve a pedirlo sin ese paso. Claude Code, en cambio, continúa y recibe el motivo (*Memory outside EYAS … use memory_search / memory_expand from EYAS*). Observado con Grok CLI 1.0.41; ver [Proveedores — Grok CLI y Kimi Code CLI](/docs/es/ai/providers/#grok-cli-and-kimi-code-cli).

**Una búsqueda rechazada por demasiado amplia.** Cuando una búsqueda propia de una CLI (Grep, Glob, un comando de shell recursivo) empieza en una carpeta que también contiene un sitio protegido, se rechaza, y la fila **Denegado** lo dice en tu idioma: *Búsqueda demasiado amplia: la carpeta también contiene la memoria de otra herramienta, que solo EYAS puede leer. Se pidió al modelo que buscara en una carpeta más concreta.* — o los datos propios de EYAS, los inicios de sesión de CLI que guarda EYAS, o el espacio de trabajo de otra conversación. Claude Code recibe el motivo y puede reintentar en una carpeta más concreta; Grok termina su respuesta, así que vuelve a pedirlo nombrando una carpeta más concreta. Ver [Seguridad y privacidad — Memoria fuera de EYAS](/docs/es/admin/security-privacy/#memory-outside-eyas).

**Herramientas de EYAS en Grok.** La fila de una herramienta de EYAS que llamó Grok muestra los argumentos que la herramienta recibió de verdad, no el envoltorio interno `use_tool` de Grok (`tool_name`, `tool_input`, `variant`).

| Etiqueta | Significado |
|----------|-------------|
| **Diff** | Las ediciones de archivo (`edit_file` / `write_file`) muestran un diff unificado en el hilo — no solo la descripción del modelo |
| **Entrada / Salida / Error** | Los datos en bruto, cuando no hay diff de archivo o los necesitas |

Nada de esta fila concede permisos. Las herramientas amarillas y rojas siguen esperando [aprobación](/docs/es/agents/autonomy/). `git status` / `git diff` de solo lectura (también cuando el modelo los envió como `run_command`) no piden clic — ver [Herramientas](/docs/es/automation/tools/).

### Resultado del turno {#turn-outcome}
Bajo cada respuesta del asistente, junto a quién respondió y al chip de esfuerzo, aparece una insignia cuando el turno no terminó simplemente con normalidad:

| Insignia | Significado |
|----------|-------------|
| **Límite de turnos alcanzado** | El turno agotó su presupuesto de turnos (ver [Progreso del agente](#agent-progress)) |
| **Límite de salida alcanzado** | La respuesta llegó al límite de tokens de salida del modelo |
| **Rechazado por el modelo** | El modelo se negó |
| **Presupuesto de herramientas agotado** | Se acabó el presupuesto de llamadas a herramientas del turno |
| **Detenido** | Pulsaste Detener |
| **Fallido** | El turno falló; el tooltip nombra qué salió mal (por ejemplo el límite de solicitudes) |
| **Esperando aprobación** | Una llamada a herramienta espera una decisión humana |

La respuesta escrita hasta ese momento se conserva siempre; el tooltip de la insignia lo dice (*El turno terminó antes de tiempo; se conserva la respuesta obtenida hasta entonces.*). La respuesta muestra además los tokens como *N entrada · N salida*, donde *entrada* es el prompt entero, partes en caché incluidas, y el coste: *$x* cuando lo informó el proveedor, *~$x* cuando EYAS lo estimó a partir del número de tokens (el tooltip dice cuál), o *Uso no informado* cuando el proveedor no informó de nada — nunca $0. Un coste no informado no se suma al total de la conversación. *Aprobaciones solicitadas: N* enlaza con la cola de aprobaciones.

Cada mensaje del asistente guarda cómo fue su turno: el resultado y el motivo de parada; los tokens (entrada sin caché, salida, lecturas y escrituras de caché, razonamiento); el coste y su origen (informado por el proveedor, estimado por EYAS o no informado); el número de pasos, llamadas a herramientas y aprobaciones; el proveedor y el modelo; los avisos; y, en un turno fallido, el tipo y el código del error. Las respuestas delegadas, de especialistas, de pipeline y de canal guardan lo mismo. Se devuelve como `turnMeta` en cada mensaje de `GET /api/v1/conversations/:id` y en el frame `done` del stream; los mensajes más antiguos no lo tienen.

### Errores y avisos {#errors-and-notices}
Un turno fallido muestra un mensaje en tu idioma por cada tipo de fallo: el proveedor no aceptó el inicio de sesión o la clave de API, se alcanzó el límite de solicitudes, el proveedor está sobrecargado, no hubo respuesta a tiempo, error de red, solicitud cancelada, solicitud rechazada, la ejecución del modelo terminó sin completar la respuesta, la CLI se detuvo porque no se pudo confirmar su aislamiento, u otro. Mensajes más concretos cubren estos casos:

- aislamiento de la CLI rechazado, con la lista de cada comprobación fallida ([Proveedores — Comprobación de aislamiento](/docs/es/ai/providers/#isolation-check-before-every-turn));
- la CLI no tiene la sesión iniciada para EYAS;
- se exige un sandbox de archivos del kernel (`security.cliSandbox: required`) pero no está disponible ([Proveedores — Sandbox de archivos del kernel](/docs/es/ai/providers/#kernel-file-sandbox));
- el modelo o el proveedor de la conversación está desactivado o no disponible;
- no hay ningún modelo configurado;
- el modelo no admite el nivel de esfuerzo.

El texto en bruto del proveedor nunca es el mensaje; queda bajo un **Mostrar detalles** plegable. Los fallos que se arreglan en la configuración del proveedor (inicio de sesión, aislamiento, sandbox, binding del modelo, ningún modelo configurado, autenticación) muestran un botón **Abrir la configuración del proveedor**. Si el turno había escrito parte de una respuesta antes de fallar, esa parte se queda en la conversación, también tras recargar, y el error dice *Se guardó la parte de la respuesta escrita antes del fallo.* El error en sí nunca se guarda como texto del mensaje, porque si no se reenviaría al modelo como historial. Un turno detenido también conserva lo que escribió, y los tokens y el coste de los turnos fallidos y detenidos se registran. Si el servidor rechaza un mensaje, el chat muestra *El servidor no aceptó el mensaje (HTTP n).*; una conexión cortada muestra *La conexión con el servidor se cortó antes de que llegara la respuesta. Recarga la conversación para ver qué se guardó.*

Los avisos aparecen como líneas discretas bajo el turno y siguen ahí tras recargar:

- *El entorno del modelo compactó su contexto de trabajo durante este turno para hacer sitio.* — EYAS sigue conservando toda la conversación;
- *Imágenes no mostradas al modelo (N): …* — el modelo no puede ver imágenes (ver [Proveedores — Imágenes](/docs/es/ai/providers/#images-and-models-that-cannot-see-them));
- *&lt;proveedor&gt; ejecuta sus propias herramientas sin sandbox de archivos del kernel en este servidor.* — aparece cuando una CLI ejecuta sus propias herramientas sin el sandbox (`security.cliSandbox: auto`); EYAS sigue revisando cada llamada a herramienta que ve;
- *La carpeta &lt;ruta&gt; quedó fuera de este turno: EYAS ya no deja que un modelo trabaje ahí…* — una Carpeta guardada antes ahora se rechaza, así que este turno se ejecutó sin ella (ver [Carpetas](#working-folders)).

### Aprobaciones en el chat {#approvals-in-the-chat}
Cuando una llamada a herramienta necesita una decisión humana, aparece una tarjeta bajo la conversación: *Se necesita aprobación: &lt;herramienta&gt;*, un **Motivo** plegable, **Aprobar** y **Rechazar** (cuando la llamada se puso en la cola de aprobaciones) y **Abrir aprobaciones**, que lleva a la página de [Autonomía](/docs/es/agents/autonomy/). Los botones usan el mismo permiso que la cola de aprobaciones; un usuario sin él ve *No tienes permiso para decidir aprobaciones. Un propietario o un administrador puede decidirla en la cola de aprobaciones.* Una solicitud ya decidida en otro sitio lo indica. Tras aprobar, pide al asistente que lo intente de nuevo: esa llamada exacta (misma herramienta, mismos argumentos) ahora está permitida una vez. Las tarjetas desaparecen al enviar el siguiente mensaje.

En un chat que estás atendiendo, una llamada que el security gate permite se ejecuta; la tarjeta solo aparece cuando el gate escala, y el chat no se pausa. Es igual con todos los proveedores — también para las herramientas de EYAS a las que Grok y Kimi llegan por el puente de herramientas, que ya no esperan aprobación solo porque una herramienta esté marcada como que la requiere. Los niveles de autonomía se aplican a las ejecuciones en segundo plano, no a los chats atendidos (ver [Autonomía](/docs/es/agents/autonomy/)).

### Progreso del agente {#agent-progress}
El panel de progreso está en la franja **En ejecución** de la derecha, que se abre sola mientras un agente se ejecuta. Muestra el nombre del colega, o *Asistente* para el asistente sin colega.

| Etiqueta | Significado |
|----------|-------------|
| **Paso N / Máx.** | Se muestra cuando el proveedor informa de sus pasos (Claude Code); solo entonces aparece la barra de pasos |
| **Llamadas a herramientas: N** | Se muestra en los demás casos (Grok CLI, Kimi Code CLI y los proveedores de API que no informan de pasos) |
| **En ejecución** | Ejecución en curso |
| **N tokens facturados** | Entrada más salida de toda la ejecución, sumadas sobre cada llamada al modelo según lo informado por el proveedor — no es el tamaño de la conversación. Un agente CLI reenvía todo lo leído en cada turno interno, así que puede superar con mucho lo que escribiste |
| **Cancelar** | Abortar la ejecución |

**Presupuesto de turnos.** Un turno de chat puede hacer hasta **25** idas y vueltas con el modelo por defecto. Cuando el colega de la conversación (o el agente predeterminado de su proyecto) tiene sus propios **Turnos máx.**, se usa ese número. El presupuesto es el mismo en todos los proveedores; en Claude Code, Grok y Kimi es además el tope interno de turnos de la propia CLI para ese turno de chat. Las ejecuciones delegadas, de especialistas y de pipeline (10 por defecto) y las respuestas de canal (20 por defecto) mantienen su propio presupuesto.

---

## Compositor (entrada)

| Control | Significado |
|---------|-------------|
| *Escribe un mensaje… (Shift+Enter para nueva línea)* | Entrada principal — Enter envía |
| **Adjuntar archivo** | Añadir un adjunto al siguiente mensaje |
| **Prompt Enhancer** | *Prompt Enhancer — te ayuda a refinar tu prompt*: abre el diálogo iterativo para refinar el prompt antes de enviar |
| **Plan primero** (icono de mapa) | *Plan primero — escribe un plan y espera aprobación antes de ejecutar herramientas*: este envío escribe un plan y espera — no se ejecuta ninguna herramienta hasta que respondas a la tarjeta del plan |
| Error | Un turno fallido muestra un único mensaje traducido, con **Mostrar detalles** y, donde ayuda, **Abrir la configuración del proveedor** — ver [Errores y avisos](#errors-and-notices). Por ejemplo *Grok CLI se detuvo: EYAS no pudo confirmar que se ejecuta aislado (…). El turno no se pasó a otro modelo.* |
| Chip de imagen | Con una imagen adjunta y un modelo que no puede ver imágenes: *&lt;modelo&gt; no puede ver imágenes: solo sabrá que hay una imagen adjunta.* No se muestra en Modo Dios |
| **Mensaje no enviado: privacidad** | El mensaje llevaba un valor que la política de privacidad bloquea e iba a ir a un modelo remoto — ver [Mensajes rechazados](#refused-messages-privacy) |

### Mensajes rechazados (privacidad) {#refused-messages-privacy}
Un mensaje **nuevo** que envías en el chat o en Modo Dios se rechaza cuando contiene un valor cuya acción de privacidad es **block** — por defecto un IBAN, un número de cuenta bancaria, un número fiscal, un número de documento de identidad, un número de tarjeta o un SSN de EE. UU., más cualquier patrón personalizado en block — **y** además iría a un modelo remoto. Solo se puede rechazar tu mensaje nuevo: el historial, la memoria, los resultados de herramientas y el texto extraído de los adjuntos nunca se rechazan; se enmascaran al salir. Las direcciones de correo y los números de teléfono (clase mask) y los tipos de clase warn nunca se rechazan.

- **Adónde va.** El destino es el modelo en el que se ejecutará el mensaje (una anulación para un turno, el modelo fijo de la conversación o el modelo de su colega). Local significa que el endpoint del modelo es loopback (`localhost`, `127.x`, `::1`) o está en los hosts locales de la política de privacidad; los proveedores CLI (Claude Code, Grok CLI, Kimi Code CLI) y los endpoints desconocidos cuentan como remotos. Una conversación puesta en Auto cuenta siempre como remota, porque su modelo se elige después de la comprobación — salvo que el enrutamiento automático esté desactivado globalmente, y entonces se juzga su modelo guardado. En Modo Dios se juzga a cada participante de la plantilla: si alguno es remoto, o la plantilla está vacía, el mensaje se rechaza.
- **No se guarda nada.** El mensaje desaparece de la transcripción, la conversación no se renombra, no se graba memoria, no se llama a ningún modelo y no arranca ninguna carrera de Modo Dios. Una tarjeta sobre el compositor, **Mensaje no enviado: privacidad**, lista por nombre los tipos rechazados (nunca los valores) y ofrece **Enviar con estos datos enmascarados** (lo vuelve a enviar con solo los valores bloqueados sustituidos por marcadores como `[IBAN]`; el texto enmascarado es lo que se guarda, se muestra y se envía), **Editar mensaje** (devuelve el texto y sus adjuntos al compositor) y **Descartar**.
- Volver a ejecutar un turno detenido (tras una propuesta de habilidad o una aprobación de plan) no se comprueba de nuevo. Con la política de privacidad desactivada, o el módulo de privacidad apagado, no se rechaza nada.

Cada rechazo se audita como `privacy.inbound_refused` y cada reenvío enmascarado como `privacy.inbound_masked`, con los tipos, la conversación y el usuario — nunca un valor. **API:** `POST /api/v1/conversations/:id/messages` acepta un `privacy: "mask"` opcional (cualquier otro valor → `400`). Un rechazo es HTTP `422 {error: 'privacy_blocked', code: 'privacy_blocked', message, types, maskedContent}`, enviado antes de que empiece ningún stream. Ver [Seguridad y privacidad](/docs/es/admin/security-privacy/#refused-messages).

### Diálogo del Prompt Enhancer {#prompt-enhancer-dialog}
Un coach iterativo que **adapta el prompt a la familia de modelos de la conversación** (Claude, OpenAI, Gemini, Grok, Kimi, …) antes de enviar. Descripción: *Coach de prompts iterativo — optimizado para la familia de modelos de la conversación. Elige tipo de tarea, refina y Apply.*

| Control | Significado |
|---------|-------------|
| Área de objetivo / borrador | Describe lo que quieres refinar (*Escribe un borrador de prompt o un objetivo — te ayudo a refinarlo.*) |
| **Optimizado para …** | Familia de modelos objetivo — por defecto, el modelo en el que realmente se ejecuta la conversación |
| Chips de tipo de tarea | **General · Código · Investigación · Análisis · Escritura · Agéntico · Archivos / visión** — orientan la estructura y la checklist |
| **Adjuntar archivo** | Archivos de contexto solo para el enhancer (o para traspasarlos) |
| **Enviar** | Seguir refinando con el enhancer |
| **Calidad N/10** | Puntuación heurística de calidad; **Faltan: …** lista los puntos de la checklist que faltan; **Checklist cubierto** cuando está completo |
| **Dos alternativas (conciso + exhaustivo)** | Pedir variantes **Conciso** / **Exhaustivo** / **Recomendado** |
| **Prompt final sugerido** | Texto candidato para insertar |
| **traspasar N archivos** | Si los adjuntos pasan también al chat principal |
| **Apply** | Insertar el prompt final (o la última respuesta) en el compositor principal |

Para prompts de sistema **duraderos** de proyecto / agente (no borradores de chat puntuales), usa el [Prompt Coach](/docs/es/ai/prompts/#prompt-coach) en Proyectos y en la configuración del agente.

---

## Riel de contexto (chatter) {#context-rail-chatter}
La columna derecha tiene arriba la franja **En ejecución**, debajo — mientras está abierto — el terminal de OpenCode, y luego las pestañas:

**Historial · Fuentes · Carpetas · Siguiente · Archivos** (más **Dios** mientras el Modo Dios está activo o después de una carrera)

### Historial (mensajes / filtros)

| Control | Significado |
|---------|-------------|
| **Historial** | Notas cronológicas y actualizaciones del tablero |
| **Todo / Notas / Cambios** | Filtrar notas o cambios de campos |
| *Añadir una nota…* + **Añadir nota** | Nota humana en el registro (no es un turno de chat con el modelo) |
| Insignias **Nota** / **Actualización** | Tipo de entrada |
| **Hoy / Ayer** | Agrupación temporal |

### Fuentes (código / pin de Odoo)

Selección múltiple de las **fuentes de búsqueda indexadas** que puede usar esta conversación (por ejemplo Odoo 18c + addons propios). Así no se mezclan varias versiones de Odoo en un mismo hilo.

| Control | Significado |
|---------|-------------|
| Lista de casillas | Todas las fuentes de búsqueda registradas (etiqueta, versión, estado, ruta) |
| **Todas** / **Vaciar (auto)** | Fijar todas las fuentes / quitar el pin |
| **Auto** | Sin pin en la conversación — se aplica el valor por defecto del proyecto o las reglas multiversión `needsPin` |
| **N elegidas** | Número de fuentes seleccionadas |
| **Gestionar fuentes →** | Abrir `/search-sources` |

**Herencia:** las conversaciones nuevas de un proyecto, y asignar un proyecto a una conversación existente, copian las **fuentes de código predeterminadas** del proyecto. Aquí siempre puedes anularlas.

Configuración completa: [Búsqueda — pin multiversión](/docs/es/daily/search/#pin-multi-versión) · [Proyectos](/docs/es/daily/projects/).

### Carpetas (directorios de trabajo) {#working-folders}
Raíces con nombre que esta conversación puede leer y escribir. La primera ruta es el directorio de trabajo **principal** (cwd). Las herramientas de archivo (`read_file`, `edit_file`, `grep`, …) quedan encerradas en estas rutas — no hay recurso al directorio del proceso de EYAS. Claude Code, Grok CLI, Kimi Code CLI y OpenCode arrancan en la primera carpeta que sigue pasando la validación y, si no, en el espacio de trabajo de EYAS propio de la conversación — nunca en el directorio propio del servidor de EYAS.

| Control | Significado |
|---------|-------------|
| **Carpetas de trabajo** (barra de campos) | Fijar qué raíz con nombre es la principal |
| Pestaña **Carpetas** | **Añadir carpeta** (nombre + ruta absoluta), **Subir** / **Bajar**, **Quitar**; la primera entrada es la **Principal** |
| *Este proyecto aún no tiene carpetas predeterminadas.* | Define los valores por defecto en el [proyecto](/docs/es/daily/projects/) (o en su tipo) |

Las conversaciones nuevas copian la lista del proyecto; una lista de proyecto vacía copia la del **tipo**. Cambiar de proyecto sustituye esta lista. Las rutas pertenecen a la instancia, no a los valores por defecto del producto.

**Carpetas que no se pueden guardar.** Al guardar se rechaza una carpeta y se te dice por qué, nombrándola, en tu idioma:

- la raíz del sistema de archivos, tu carpeta personal o cualquier carpeta por encima (por ejemplo `/Users` o `/home`) — desde ahí un modelo podría llegar a la memoria de todas las herramientas y a tus credenciales; elige en su lugar una carpeta de proyecto dentro de tu carpeta personal;
- una carpeta dentro del almacenamiento propio de otra herramienta de IA (`~/.claude`, `~/.claude.json`, `~/.grok`, `~/.codex`, `~/.gemini`, `~/.cursor`, `~/.codeium`, `~/.kimi`, `~/.agents`, `~/.config/agents`, `~/.copilot`, las carpetas de config/datos/estado de OpenCode, o una carpeta `memory` de `.claude`/`.grok`/… dentro de un repositorio), o los directorios de inicio de sesión de CLI que EYAS guarda para Grok y Kimi (`data/cli-homes`);
- una carpeta dentro de una bóveda de notas o un almacén de memoria: cualquier bóveda de Obsidian, los ajustes de la app Obsidian, una carpeta llamada `ai-memory` o una ruta listada en `security.foreignMemoryPaths`;
- una carpeta dentro de la carpeta de datos propia de EYAS (bóveda de memoria, base de datos, claves) — salvo un único espacio de trabajo de conversación, los proyectos de Studio y las descargas del navegador; la propia carpeta de espacios de trabajo se rechaza, porque contiene el espacio de trabajo de cada conversación;
- el espacio de trabajo de la conversación de otro usuario — el espacio de trabajo de una conversación, una carpeta dentro de él o un enlace hacia él solo es carpeta de esa conversación y de tus otras conversaciones (incluidas tus conversaciones de equipo y de especialistas); también se rechaza la carpeta temporal de una ejecución bajo `_runs`;
- ubicaciones sensibles: `.ssh`, archivos `.env`, `master.key`, la carpeta de la base de datos;
- una ruta que no es absoluta, una carpeta que no existe o no se puede leer, y un archivo en lugar de una carpeta;
- una carpeta que **contiene** un sitio protegido — el mensaje nombra lo que se encontró dentro: el directorio propio de EYAS, su carpeta de datos, su base de datos o la carpeta de espacios de trabajo de las conversaciones (por ejemplo el checkout del código de EYAS que contiene `data/`, o el propio directorio de EYAS aunque `EYAS_DATA_DIR` haya movido los datos a otro sitio); el almacenamiento de otra herramienta de IA o una carpeta de inicio de sesión de CLI de EYAS (por ejemplo un `~/.config` que contiene la carpeta de OpenCode, o un repositorio con `.claude/memory`); una bóveda de notas (una carpeta con `.obsidian` dentro, o una bóveda de la lista de bóvedas de Obsidian — por ejemplo un `~/Documents` que contiene *Obsidian Vault*), una carpeta `ai-memory` o una entrada de `security.foreignMemoryPaths`.

**Por qué se rechaza una carpeta que solo contiene uno de estos sitios.** Una CLI como Claude Code lee y busca dentro de su carpeta de trabajo sin preguntar, y la comprobación de publicación confirmó en el binario real que esas lecturas nunca llegan al paso de aprobación. Por eso no es seguro entregar a un modelo una carpeta que contiene un sitio protegido. Elige en su lugar una carpeta más concreta, como la carpeta del proyecto dentro de `~/Documents` o un clon aparte del repositorio. Las bóvedas y carpetas de memoria conocidas solo por su forma se encuentran con un recorrido acotado — 8 niveles de profundidad, como mucho 2.000 carpetas, saltando `.git` y carpetas similares y `node_modules`; una lectura dentro de una más profunda se sigue rechazando ruta a ruta, y `grep` y `glob` propios de EYAS nunca miran dentro de una subcarpeta protegida. Si se rechazan las carpetas de una conversación nueva, la conversación no se crea.

**Las carpetas guardadas antes que ahora se rechazan** no se reescriben, pero cada ejecución las deja fuera: las herramientas de archivo propias de EYAS, el security gate y la carpeta de trabajo de Claude Code, Grok, Kimi y OpenCode. El prompt del sistema ya no las nombra. En el chat, el turno muestra el aviso *La carpeta &lt;ruta&gt; quedó fuera de este turno: EYAS ya no deja que un modelo trabaje ahí, porque es un lugar protegido, está dentro de uno o contiene uno (los datos propios de EYAS, el almacenamiento de otra herramienta de IA, una bóveda de notas o tu carpeta personal). Cambia las Carpetas de esta conversación o de su proyecto.* Una carpeta que simplemente falta no se ve afectada. En las ejecuciones de tarjetas en segundo plano, de equipo y de especialistas, la exclusión solo aparece en el log del servidor. Si se rechazan todas las carpetas guardadas, las herramientas de archivo propias de EYAS no tienen carpeta, y una CLI trabaja en el propio espacio de trabajo de EYAS de la conversación. Kimi Code CLI sigue las mismas reglas de carpetas; su comportamiento aquí aún no se ha verificado en un equipo. Cada guardado comprueba la lista entera, así que quita una carpeta ahora rechazada antes de guardar otros cambios de la lista. La API responde a una carpeta rechazada con `400 {error, code, path, found}`, donde `code` es uno de `home`, `providerHome`, `vault`, `eyasData`, `sensitive`, `otherWorkspace`, `containsEyasData`, `containsProviderHome`, `containsVault`, `notAbsolute`, `notFound`, `notDirectory`, y `found` — que se envía con los tres códigos `contains…` — es el sitio protegido encontrado dentro de la carpeta.

**Toda conversación tiene una carpeta de trabajo.** Una conversación que no recibe carpetas de ti, del proyecto ni de su tipo obtiene su propio **espacio de trabajo de EYAS** al crearse — en cualquier proyecto, también cuando la petición envía una lista de carpetas vacía. Las conversaciones antiguas sin carpetas, y aquellas a las que se les quitaron todas, reciben su espacio de trabajo con el siguiente mensaje. Aparece en la pestaña **Carpetas** como cualquier carpeta. Los archivos que el modelo escribe ahí se copian a los adjuntos de la conversación ([Documentos](/docs/es/knowledge/documents/)), junto con los trabajos de medios y los renders de Studio — también en un turno que se ejecutó sin la canalización de herramientas de EYAS. **Sin carpeta** solo aparece si no se puede escribir en la ubicación de los espacios de trabajo. Las carpetas que pones tú nunca se sustituyen.

Los espacios de trabajo nunca están dentro de un checkout de git: un modelo CLI (Claude Code, Grok, Kimi) arrancado dentro de un repositorio git trata ese repositorio como su proyecto y carga sus archivos de instrucciones, el estado de git, las reglas de permisos y la memoria por proyecto. Dónde viven, y cómo moverlos con `EYAS_WORKSPACES_DIR`, está en [Configuración — Espacios de trabajo de las conversaciones](/docs/es/deploy/configuration/#conversation-workspaces).

### Campos de negocio (con seguimiento)

| Campo | Significado |
|-------|-------------|
| **Etapa** | Etapa del pipeline |
| **Proyecto** | Enlace al proyecto |
| **Prioridad** | Prioridad |
| **Estado** | Estado |
| **Fecha límite** | Plazo |

Los cambios aparecen como entradas **Actualización** en la pestaña **Historial**.

### Actividades

La pestaña **Siguiente** (*Próximos pasos para este registro*) lista las actividades de la conversación.

| Control | Significado |
|---------|-------------|
| **Programar** | Abrir el formulario de programación |
| **Tipo** | Tipo de actividad (pendiente, seguimiento, revisión, …) |
| **Resumen** | Texto de resumen opcional |
| **Fecha límite** | Cuándo vence |
| **Programar actividad** | Confirmar |
| **Marcar como hecha** | Completar una actividad |
| **Vencidas / Hoy / Planificadas** | Agrupación |
| **N completadas** | Número de hechas |

### Siguiente / Archivos / En ejecución

| Área | Significado |
|------|-------------|
| **Siguiente** | Actividades y siguientes pasos de este registro (arriba) |
| **Archivos** | Adjuntos de la conversación, incluidos los archivos que el modelo escribió en su espacio de trabajo |
| **En ejecución** | La franja plegable sobre las pestañas: el árbol de ejecución, el progreso del agente y el árbol de subconversaciones. Se abre sola mientras un agente se ejecuta y está separada del Historial, así que la actividad del agente nunca se mezcla con las notas de negocio |

---

## Funciones de equipo

### Árbol de subconversaciones

| Control | Significado |
|---------|-------------|
| **Equipo / Subconversaciones** | Hilos hijo creados para el trabajo multiagente (en la franja En ejecución) |
| **Expandir** (*Abrir Team Dashboard*) | Abrir la capa del dashboard |
| **turno N** | Progreso de un subhilo |

### Team Dashboard

| Control | Significado |
|---------|-------------|
| **Team Dashboard** / **Contraer** | Título / cierre de la capa |
| **Fase:** | Fase de orquestación actual |
| **N turno / N tokens** | Uso |
| Categorías **Hallazgo / Decisión / Bloqueante / Pregunta / Dato** | Tipos de entrada de la memoria compartida del equipo |
| **Ver chat** | Saltar al subchat de un miembro |
| **Memoria del equipo** | Hallazgos, decisiones y bloqueantes agregados |

### Tarjeta de propuesta de equipo

El reparto habitual de especialistas (`run_specialist`) **no** muestra esta tarjeta. Aparece con `/team`, una petición explícita de equipo, especialistas que faltan o trabajo épico. La propuesta la escribe el modelo en segundo plano en una llamada aislada; sin un modelo en segundo plano elegible, la tarjeta propone un solo agente (ver [Equipos y delegación](/docs/es/agents/teams/)).

| Control | Significado |
|---------|-------------|
| **Propuesta de equipo** | Plan de ejecución multiagente |
| **~N tokens · coste** | Estimación |
| **Fases** | Fases en paralelo o en secuencia |
| **Especialistas faltantes** | Plantillas aún no creadas |
| **Crear ahora** | Crear los agentes que faltan |
| **Aceptar / Modificar / Omitir / Omitir (arriesgado)** | Aceptar el plan, modificarlo (cuando está disponible) u omitirlo |

### Traspaso {#handoff}
Cuando un colega toma el relevo (`handoff_to_colleague`), la fila de herramienta tiene **Abrir &lt;nombre&gt;** hacia su hilo de inicio, y el colega **arranca de inmediato** allí: el encargo del traspaso se convierte en el objetivo de la ejecución y en su consulta de recuperación de memoria, y la ejecución es supervisada, autónoma y controlada por la escala de [autonomía](/docs/es/agents/autonomy/), como la ejecución de una tarjeta del tablero. Un traspaso a un colega que está ocupado en su hilo de inicio (un turno de chat o una ejecución anterior aún trabajando, o una ejecución esperando aprobación) se rechaza con un mensaje de *ocupado* — inténtalo más tarde o usa `assign_task`. Los traspasos a uno mismo o a un especialista se rechazan, y un traspaso repetido nunca arranca una segunda ejecución.

<h3 id="run-tree--workflow">Árbol de ejecución / flujo de trabajo</h3>
Muestra en la franja En ejecución la estructura de ejecución del turno actual (etiqueta **Flujo de trabajo**), en todos los proveedores — proveedores de API (Anthropic, OpenAI, Gemini, OpenRouter, Kimi API, modelos locales, …) igual que Claude Code, Grok CLI y Kimi Code CLI.

- El nodo de la conversación muestra en vivo la herramienta actual, el contador de turnos (en una CLI, sus propios pasos internos), los tokens usados hasta el momento y un estado: **Pendiente**, **En curso**, **Completado**, **Fallido**, **Cancelado** o **En pausa**. Una ejecución que espera una aprobación humana se muestra **En pausa**.
- Cada mensaje nuevo empieza un árbol nuevo: el árbol del turno anterior se sustituye, no se amplía.
- Cuando termina una ejecución, la cabecera muestra su coste en dólares estadounidenses: el coste propio del proveedor cuando lo informa (Claude Code, también en una ejecución fallida) o, si no, calculado a partir del uso de tokens con los precios configurados (se aplican los overrides de `model.pricing`). Cuando un proveedor no informó de su uso, el coste muestra *—* y el tooltip dice *Coste desconocido: el proveedor no informó de su uso* — nunca un $0 inventado.
- **Planes de Grok y Kimi.** Cuando el modelo lleva una lista de tareas, cada entrada aparece bajo la conversación como un **Paso del plan** con un icono de lista y su estado (pendiente, en curso, completado).
- Los especialistas aparecen igual en todos los proveedores; las ejecuciones de Claude Code no muestran nodos propios. En las ejecuciones de equipo, cada miembro muestra en vivo su herramienta actual, sea cual sea su proveedor.
- Los árboles guardados antiguos se siguen reproduciendo.

---

## Modo Dios

El Modo Dios ejecuta **la misma tarea** en paralelo en varios modelos y después compara los resultados. No es un cuarto estilo de orquestación: Solo / Automático / Profundo siguen describiendo cómo cada trabajador descompone el trabajo. El Modo Dios solo decide que compiten varios modelos (no un equipo de especialistas). Se pueden combinar: Modo Dios + Profundo significa que cada modelo competidor puede repartir el trabajo por su cuenta.

**No hay fusión automática.** Gana un espacio de trabajo; las ideas únicas de los demás se listan para que las apliques tú.

| Tema | Significado |
|------|-------------|
| **Plantilla** | **Ajustes → Modo Dios** (tarjeta bajo Asignaciones de modelo). Elige 2–5 pares proveedor/modelo activos. Un número par exige un presidente de desempate. |
| **Menú** | Último elemento del control de orquestación de la conversación (tras un separador): Solo, Automático, Profundo y **Modo Dios**. Elegir Modo Dios lo activa y **deja** Solo/Automático/Profundo como están (los trabajadores heredan ese estilo). Elegir Solo/Automático/Profundo desactiva el Modo Dios. Sin una plantilla válida, el elemento dice *Añade al menos 2 modelos en Ajustes → Modo Dios*. |
| **Coste** | El primer envío tras activarlo pide confirmación (*¿Iniciar una ejecución en Modo Dios?* — plantilla, estimación, tope). Los envíos posteriores en la misma conversación solo muestran el banner. Si la estimación supera el tope, el envío se bloquea hasta que subas el tope o desactives el Modo Dios. |
| **Carpetas** | Los trabajadores se ejecutan en copias aisladas de las carpetas de trabajo de la conversación (un worktree de git cuando es posible). Sin carpetas, la ejecución arranca igual, sin aislamiento de archivos. |
| **Ganador + ideas** | Solo los archivos cambiados del ganador llegan a las carpetas de la conversación. Las ideas únicas de los demás aparecen en la pestaña **Dios** — las aplicas tú; nada se fusiona automáticamente. |

### Plantilla en Ajustes

En [Ajustes](/docs/es/admin/settings/), bajo Asignaciones de modelo, la tarjeta **Modo Dios** es la plantilla global que usa cada conversación en Modo Dios.

| Campo | Significado |
|-------|-------------|
| **Añadir modelo** | 2–5 pares proveedor/modelo activos. No se permiten duplicados. |
| **Presidente de desempate** | Uno de esos modelos. **Obligatorio si el número es par**; recomendado siempre (un trabajador fallido puede dejar un resto par). El presidente es un competidor, no un juez aparte. |
| **Tope de coste (USD)** | Opcional. Si la estimación previa lo supera, la ejecución no arranca. Si el gasto lo cruza a mitad de carrera, se cancelan los trabajadores inacabados y el ganador se decide entre los que terminaron. |
| **Conservar carpetas de trabajo (horas)** | Los árboles aislados se borran pasadas estas horas (72 por defecto). |

Guardar la plantilla no cambia las ejecuciones ya arrancadas: cada envío toma una instantánea de la plantilla.

El selector de modelo de la conversación aparece atenuado y se ignora en un envío en Modo Dios — se ejecuta la plantilla de Ajustes, y cada trabajador se ejecuta siempre con su modelo de la plantilla. Un esfuerzo fijado en la conversación se copia a cada participante y Profundo se transmite como modo de los participantes; después, el nivel de cada participante se ajusta a su propio modelo. Los votos de la revisión cruzada también usan el esfuerzo de la conversación.

### Activar el Modo Dios

1. Abre el menú de orquestación de la conversación y elige **Modo Dios**.
2. Envía un mensaje. El primer envío muestra una confirmación de coste (cuántos modelos compiten, USD estimado, tope). Pulsa **Enviar** para arrancar.
3. Mientras está activo, queda un banner **Modo Dios · N · ~$x** en la conversación. En el riel derecho aparece la pestaña **Dios**.
4. **Detener** cancela toda la carrera, no solo un trabajador.

### Aislamiento y ganador

Cada trabajador recibe su propia carpeta (un worktree de git cuando el directorio de trabajo es un repositorio; si no, una copia). Mientras trabajan no ven los archivos de los demás.

Al elegir ganador, **solo los archivos cambiados del ganador** se copian a las carpetas de la conversación. Los archivos de los demás trabajadores quedan en sus árboles aislados hasta la limpieza por retención. Si la conversación no tiene carpetas de trabajo, no hay nada que promover; el ganador se elige igualmente a partir de las respuestas escritas.

### La pestaña Dios

La pestaña **Dios** del riel aparece mientras el Modo Dios está activo, **o** cuando la conversación ya ha tenido al menos una ejecución en Modo Dios (sigue visible si luego lo desactivas).

#### Cabecera

La fase actual, más los tokens, USD y duración totales.

| Fase | Significado |
|------|-------------|
| **Preparando** | Instantánea de la plantilla, carpetas aisladas |
| **Carrera** | Los trabajadores ejecutan el mismo mensaje del usuario en paralelo |
| **Revisión** | Los que terminaron puntúan el trabajo de los demás y votan |
| **Decisión** | Ganador registrado |
| **Promoción** | Los archivos del ganador se copian a las carpetas de la conversación |
| **Completado / Fallido / Cancelado** | Estado final |

Un trabajador fallido también muestra el error del proveedor (por ejemplo una API sobrecargada).

#### Pasos

Un registro con marca de tiempo de lo que ocurrió de verdad:

| Paso | Significado |
|------|-------------|
| Ejecución iniciada | Carrera creada con la plantilla actual |
| Workers en paralelo | Cada modelo activo empieza la misma tarea |
| *Modelo* terminó / falló | Acabó el intento propio de ese trabajador |
| Revisión cruzada | Los que terminaron leen los resúmenes de los demás y votan |
| Ganador: *modelo* | Decisión registrada |
| Promoviendo el espacio del ganador | Los archivos del ganador se copian a las carpetas de la conversación |
| Ejecución completada / fallida / cancelada | Estado final |

Las ejecuciones anteriores a este registro muestran una línea de tiempo reconstruida a partir de las horas de fin.

#### Cómo se eligió al ganador

Este bloque indica la regla aplicada, el recuento de votos y **quién votó a quién**.

| Regla | Cuándo |
|-------|--------|
| **Mayoría** | Un modelo recibió más votos válidos que cualquier otro. Un modelo **no puede votarse a sí mismo**; esos votos se descartan. |
| **Empate — el desempate eligió** | Dos o más modelos empatados, y el presidente está entre ellos. |
| **Empate — el más rápido** | Dos o más modelos empatados, y el presidente falta o no está entre ellos. Gana el empatado que terminó primero. |
| **Solo uno terminó** | El resto falló o se canceló; el único superviviente gana y no hay votación de revisión cruzada. |

Si falla una llamada de revisión, ese trabajador simplemente no tiene voto. La decisión sigue adelante con los votos emitidos.

#### Revisión cruzada

Tras la carrera, los que terminaron hacen **una** revisión cruzada estructurada (no un debate en vivo). Cada revisor vota en una llamada aislada con su propio modelo de la plantilla, sin herramientas. Las respuestas y los cambios de archivos de los demás se le pasan como datos claramente marcados, nunca como instrucciones, así que un texto en la salida de otro no puede decirle a un revisor cómo votar. Por cada revisor, la pestaña muestra sin clics extra:

- a quién votó
- puntuaciones 1–5: **calidad**, **completitud**, **riesgo**
- su comentario escrito sobre el trabajo de los demás
- ideas únicas que, según él, los demás no vieron
- los riesgos que señaló

Despliega la tarjeta de un modelo para ver **su propio** trabajo (el que produjo antes de revisar) y cualquier error del trabajador.

#### Ideas únicas

Una lista deduplicada de ideas de los **no ganadores** que no aparecen ya en la lista propia del ganador. Si las quieres en el espacio de trabajo promovido, las aplicas tú — nada se fusiona automáticamente.

### Conversaciones hijas

Cada trabajador es una conversación hija con un título como `God <modelo>`. Pueden aparecer en la lista de conversaciones como subconversaciones. Se ejecutan con el Modo Dios **desactivado**, para que no puedan arrancar otra carrera.

La comparación global (tasa de victorias por modelo, múltiplo medio de coste frente a un solo modelo) está en [Observabilidad](/docs/es/admin/observability/). Al pulsar allí una ejecución se abre la pestaña Dios de esa conversación.

---

## Propuestas de habilidad

Una habilidad coincidente es una **propuesta que el turno espera** — nada de esa habilidad se ejecuta hasta que respondes. La tarjeta muestra el nombre de la habilidad, el patrón que coincidió y una puntuación.

| Control | Significado |
|---------|-------------|
| **Una habilidad coincide, ¿la uso?** | Encabezado |
| **Úsala** | Aceptar en esta conversación; el turno sigue con la habilidad |
| **Ahora no** | Rechazar solo en esta conversación |
| **Desactivar** | Rechazar aquí **y** desactivar la habilidad globalmente (solo owner/admin). No volverá a coincidir hasta que alguien la reactive en [Habilidades](/docs/es/automation/skills/) |

Tu respuesta se recuerda para esta conversación. Quien puede chatear pero no gestionar habilidades sigue viendo **Úsala** y **Ahora no**.

---

## Plan primero {#plan-mode}
El icono de mapa del compositor es **Plan primero** (*Plan primero — escribe un plan y espera aprobación antes de ejecutar herramientas*). Ese envío **no** ejecuta herramientas, y el estado del hilo pasa a **Esperando el plan**. El plan lo escribe el modelo propio de la conversación en una llamada aislada — sin herramientas, un solo turno, nunca otro proveedor. Si esa llamada falla, el turno se ejecuta sin plan.

La tarjeta **Plan para este turno** muestra el objetivo, los pasos numerados (con sus criterios de éxito) y, cuando el plan la da, una línea *Reversión: …* que dice cómo se desharía.

| Control | Significado |
|---------|-------------|
| **Aprobar** | Ejecutar este plan |
| **Omitir plan** | Ejecutar el turno sin el plan |
| **Rechazar** | Detener — no se ha ejecutado nada |

Mientras la tarjeta espera no se ha ejecutado nada. Las herramientas amarillas y rojas de la ejecución posterior siguen pasando por la [Autonomía](/docs/es/agents/autonomy/) como siempre.

---

## Diseños adjuntos {#attached-designs}
El icono de formas de la barra superior de la conversación es **Diseños**. Los lienzos adjuntos viajan con cada turno de este hilo (el agente puede pedir partes con `design_read`). Los diseños de un proyecto se copian a una conversación nueva cuando la creas en ese proyecto; después, la conversación es dueña de los enlaces.

| Control | Significado |
|---------|-------------|
| **Diseños adjuntos** | Desplegable con todos los lienzos, con una marca en los enlazados aquí |
| Contador | Cuántos hay adjuntos |
| **Abrir Diseño** | Ir a `/design` |
| *Todavía no hay diseños.* | Lista vacía — crea primero un lienzo |

---

## Relacionado

- [Fuentes de búsqueda y pin multiversión](/docs/es/daily/search/)
- [Proyectos — directorios de trabajo y wiki](/docs/es/daily/projects/)
- [Agentes — visión general](/docs/es/agents/overview/)
- [Equipos y delegación](/docs/es/agents/teams/)
- [Proveedores](/docs/es/ai/providers/)
- [Tablero](/docs/es/daily/board/)
- [Perfiles de voz](/docs/es/agents/voice/)
- [Memoria](/docs/es/knowledge/memory/)
- [Lienzos de diseño](/docs/es/knowledge/design/)
- [Habilidades](/docs/es/automation/skills/)
- [OpenCode](/docs/es/automation/opencode/)
- [Observabilidad — pestaña God Mode](/docs/es/admin/observability/)
