---
title: Memoria
description: Lo que EYAS recuerda — notas de vault automáticas, cinco niveles, el registro en bruto de cada mensaje, y qué almacén usar.
---

**Para qué sirve.** La memoria es el almacén a largo plazo de EYAS. Un hecho duradero que dices en una conversación se convierte en nota de vault sin que nadie lo pida, y esa misma nota es lo que leen las conversaciones posteriores. Aquí inspeccionas bloques working, hechos episódicos, archivos de vault y la cola de revisión — no curas un wiki. Desde 0.8.23 EYAS guarda además un registro en bruto de cada mensaje que persiste; ese se escribe, pero todavía no se puede leer en ninguna parte, y **El registro en bruto** de abajo es todo lo que hay que saber sobre él.

## Cuándo usarlo

- Quieres que el asistente recuerde quién eres, cómo trabajas o las restricciones de un proyecto.
- Un hecho se dijo en el chat y quieres confirmar que aterrizó en el vault (o por qué se saltó el capture).
- Revisar, etiquetar, graficar o consolidar — o **Today's note**.
- Eliges entre Memoria, wiki de Conocimiento, Documentos y archivos de vault a mano (abajo).
- Quieres el capture apagado (`memory.capture.enabled: false`) — o también el registro en bruto (`memory.l0.enabled: false`).

## Flujo típico

1. Abre **Memoria** en la barra lateral (**Contenido**) — ruta `/memory`. (También en **Ajustes → IA y modelo**.)
2. Mira **Overview**, luego **Vault Files** para notas duraderas.
3. Ten una conversación de más de ~40 caracteres que enuncie un hecho duradero. Vuelve aquí tras la respuesta: una nota nueva (`user`, `feedback`, `domain`, `project` o `reference`).
4. Si no aparece nada: demasiado corto, capture off, o turno God Mode (esos no escriben nota de vault). Escribe la nota a mano en el vault si aun así la necesitas. Un turno God Mode sí deja en el registro en bruto la respuesta que ganó — ver **El registro en bruto** abajo.

## Qué almacén usar

| Almacén | Trabajo |
|---------|---------|
| **Memoria** (esta página) | Hechos automáticos + escritos por el agente. EYAS inyecta un índice de una línea en prompts posteriores. |
| **Conocimiento** wiki | Páginas que **tú** editas. El capture no escribe aquí. |
| **Documentos** | Archivos subidos para retrieval — no notas de identidad. |
| **Archivos de vault** (markdown a mano) | El mismo vault que el capture (`data/vault/…`). No `~/.claude` / `~/.grok`. |
| **Wiki del proyecto** | Páginas de ticket y decisión de un proyecto, no memoria global. |
| **Registro en bruto** | Cada mensaje que EYAS persiste, guardado una segunda vez palabra por palabra y comprimido. Se escribe automáticamente desde 0.8.23; todavía nada lo lee ni lo muestra. |

La memoria host de Claude / Grok en la máquina **no** es la fuente de verdad. Las llamadas CLI aisladas y `loadClaudeMd` off por defecto evitan que una segunda memoria se adelante al vault.

## Funciones

**Ruta:** `/memory`. Acciones: Today's note · Consolidate Now · Refresh. Pestañas: Overview · Working · Episodic · Vault · Archive · Graph · Tags · Review.

Working: TTL 24h. Episodic: salience, invalidated, proveniencia. Vault: markdown + frontmatter. Archive: baja salience.

## Notas duraderas

Una nota duradera es un hecho que permanece, no el registro de algo que pasó:
quién eres, cómo quieres que se trabaje, qué restricciones tiene un proyecto.
Cada una es un archivo markdown en el vault, y el agente recibe en cada turno
un **índice de una línea** — solo los resúmenes; lee la nota entera con
`search_memory` cuando hace falta.

Un segundo bloque por turno recupera **trabajo previo relacionado** del vault,
de la memoria episódica y de mensajes de conversaciones anteriores, usando el
mensaje actual como consulta. El modelo no tiene que llamar a `search_memory`
para que esos resultados aparezcan. Los cuerpos siguen cargándose con
`search_memory`. Los mensajes anteriores se pueden buscar porque ya están
guardados: este bloque no hace ninguna copia extra de ellos. (El registro en
bruto de abajo sí es una segunda copia, aparte y deliberada; todavía nada lo
lee.)

Lo gobiernan dos campos del frontmatter: `kind` (`user`, `feedback`, `domain`,
`project`, `reference` — también el orden) y `summary` (la línea del índice). `user` y
`feedback` van primero. `domain` es el tipo de proyecto (compartido entre hermanos);
`project` es este cliente. Sin `kind`, una nota en `procedural/` se lee como
`feedback` y el resto como `reference`, nunca como `user`. Sin `summary` se usa
la primera línea real, así que un archivo escrito a mano funciona sin
frontmatter específico de EYAS.

Ubicación: `data/vault/semantic|procedural|projects|project-types/`.

**Se llenan solas.** Una vez entregada la respuesta, una llamada a un modelo
pequeño lee el intercambio y se pregunta si hay en él algo que dentro de un mes
siga siendo cierto y siga sirviendo. Como mucho dos notas por turno, y en la
mayoría de los turnos, con razón, ninguna. Nunca ocurre dentro del camino
crítico de tu respuesta: una captura fallida cuesta una nota, jamás una
respuesta.

Delante de esa llamada solo hay una comprobación de longitud — un mensaje más
corto que `minUserChars` (40 caracteres por defecto) no la paga — y un techo de
`maxPerConversation` (20) llamadas por conversación. No hay lista de palabras
clave en ningún idioma. Se desactiva por completo con
`memory.capture.enabled: false` en `config/default.yaml`; escribir una nota a
mano y `save_memory` siguen funcionando igual.

Un hecho que se repite refuerza la nota que ya existe en vez de crear una
segunda: la nueva redacción se añade como viñeta fechada bajo `## History` y no
sobrescribe nada. El texto pasa por el módulo de privacidad antes de llegar al
disco, no al leerlo. Eso vale para las notas de vault; el registro en bruto de
abajo se guarda literal, sin ese paso.

**Memoria de proyecto.** Lo aprendido dentro de las conversaciones de un
proyecto se guarda en `projects/<id-del-proyecto>/`, se ordena por delante de
las notas `reference` generales mientras trabajas en ese proyecto y no aparece
en ningún otro sitio: las notas de otro proyecto nunca llegan a tu prompt. El
proyecto cajón de sastre **General**, donde arranca cada conversación, no cuenta
como identidad de proyecto: lo que se aprende ahí queda como un hecho sobre ti o
sobre cómo quieres que se trabaje, y por tanto te acompaña a todas partes.

Los agentes recuerdan con `search_memory`. El **`scope` por defecto es `current`**: este proyecto, su tipo y las notas globales user/feedback/reference. `scope: all` para todo el vault. La búsqueda de la página Memoria (`/memory`) no filtra.

### Notas de proyecto sin proyecto

Una nota cuyo `kind` es `project` o `domain` pero que no lleva `project:` /
`projectType:` es **global**: aparece en el índice permanente, en
`search_memory` y en el trabajo relacionado de cada conversación, ordenada como
nota de proyecto. Moverla a `projects/<id>/` — o poner `project:` en su
frontmatter — la limita a ese proyecto. Las notas traídas por una importación se
quedan así hasta que crees los proyectos correspondientes.

El índice permanente tiene un presupuesto de caracteres: `memory.index.budgetChars`,
2400 por defecto. Súbelo cuando tus líneas `user` y `feedback` ya no quepan.

### Los secretos importados quedan fuera del recall

El importador nunca descarta un archivo por contener una credencial. Se guarda literal y el elemento lleva la etiqueta `contains-secrets` — como etiqueta de nota, capacidad de skill o etiqueta episódica, según en qué se haya convertido.

Por defecto, un elemento así queda fuera de todo lo que el modelo alcanza por sí solo: el índice permanente, `search_memory`, el trabajo relacionado, la tarea de reflexión, el consolidador nocturno y el emparejador de skills. Nunca se incrusta ni se entrega al modelo de enriquecimiento opcional. La página de Memoria te lo sigue mostrando entero. Poner `memory.recall.includeSecrets: true` en `config/local.yaml` y reiniciar lo abre al modelo.

Esta puerta impide la inclusión automática; no es un aislamiento del sistema de archivos. Un agente con herramientas de lectura de archivos puede seguir leyendo el archivo original en disco. Una persona de agente importada y un archivo de reglas de workspace aprobado no llevan puerta alguna — ahí el contenido *es* el prompt —, así que revisa esas filas antes de aprobarlas.

Las etiquetas `legacy` (una carpeta de memoria antigua) y `third-party` (documentación de producto ajena) marcan notas normales y plenamente recuperables; solo dicen de dónde vino la nota. Todo elemento importado lleva además `source:<adaptador>`, que nombra el adaptador que lo leyó. Una nota escrita por ti puede declarar `contains-secrets` en su propio frontmatter y recibe el mismo trato. Véase [Importación y exportación de datos](/docs/es/admin/data-port/).

### El capture está encendido por defecto

El capture corre en **cada** conversación, en global, salvo `memory.capture.enabled: false` en `config/default.yaml`. Una llamada pequeña al modelo se engancha **después** de entregar la respuesta. Un capture fallido es una nota que falta, nunca una conversación fallida.

| Puerta | Por defecto | Significado |
|--------|-------------|-------------|
| `memory.capture.enabled` | **on** | Interruptor maestro |
| `minUserChars` | 40 | Puntos de código Unicode |
| `maxPerConversation` | 20 | Techo de gasto de modelo |

No hay lista de palabras clave. `{"notes":[]}` es la respuesta habitual y correcta (0–2 notas).

### CLI aislado — solo la memoria de EYAS

La extracción corre en un contexto de modelo **aislado**: sin settings del filesystem del host, sin memoria nativa del CLI, sin herramientas puenteadas, un solo turno. Las conversaciones en Claude Code CLI tienen **`loadClaudeMd` off** por defecto. Las llamadas aisladas y opt-out también ponen `CLAUDE_CODE_DISABLE_AUTO_MEMORY` y `strictMcpConfig`.

Grok / Kimi (ACP) no tienen interruptor de aislamiento; sus paneles lo dicen. Los agentes deben usar solo `search_memory` / `save_memory`; la puerta de escritura niega `~/.claude`, `~/.grok` y `ai-memory`.

Sin aislamiento el extractor leyó una vez la memoria host del dueño, dijo que el hecho «ya estaba grabado» y el vault de EYAS quedó vacío. Eso es el bug que esto cierra.

### Libro mayor de captures

Cada resultado que llega a la puerta escribe una fila `memory_capture_runs`. Dos silencios deliberados: capture apagado no escribe nada, y un run de fondo sin texto del asistente no llega a la puerta. Los turnos **God Mode** devuelven su propio stream antes del bloque posterior al turno, así que no escriben ni nota de vault ni fila aquí. El registro en bruto de abajo es un libro aparte y sí los cubre.

---

## El registro en bruto

**No se pierde nada de lo dicho.** Cada mensaje que EYAS deja escrito — el
tuyo, el del asistente y la salida de las corridas de agente en segundo plano —
se conserva ahora una segunda vez, palabra por palabra, en un registro en bruto
junto a la conversación misma. Se comprime al entrar (unas 2,7× más pequeño
sobre texto real) y se archiva bajo un hash de sus propios bytes, así que una
misma frase repetida dentro de una conversación se almacena una vez y se cuenta
dos.

**Lee esto antes que nada: todavía no puedes ver nada de eso.** Esta versión
solo pone en marcha la grabación. No hay página, ni buscador, ni comando que
lea de vuelta el registro en bruto, y nada de él se le pone delante al
asistente. Lo que llega hoy a tus prompts es exactamente lo que llegaba antes:
el índice de una línea del vault y el bloque de trabajo relacionado descritos
arriba. La recuperación llega en una versión posterior.

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
nunca: lo que escribes **tú** es de nivel propietario, lo que escribe el modelo
solo es derivado de ello, y la salida de una herramienta entra como material
traído de fuera. Un resumen nunca puede acabar mereciendo más confianza que las
palabras de las que salió.

### Qué deduce EYAS de ahí — sin ninguna llamada al modelo

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

Como arriba: nada de esto se puede leer todavía.

### Lo que te cuesta, y cómo apagarlo

El registro en bruto crece con el uso, y **todavía no lo poda nada**: en esta
versión no hay ajuste de retención ni tarea de limpieza. Medido, un mensaje
grabado cuesta del orden de 5 KB en disco contando sus índices, así que espera
que la base de datos crezca bastante más rápido que antes.

Tres ajustes en `config/default.yaml`, todos bajo `memory`:

| Ajuste | Por defecto | Significado |
|--------|-------------|-------------|
| `memory.l0.enabled` | **on** | Interruptor maestro. `false` no graba absolutamente nada; surte efecto en el siguiente reinicio |
| `memory.l0.extractInLegacy` | **on** | `false` conserva el texto y no deduce nada de él — ni hechos, ni resúmenes, ni temas |
| `memory.engine` | `legacy` | Qué motor sirve la memoria. Ponerlo en `v2` no cambia hoy nada que puedas observar |

`memory.capture.enabled: false` **no** apaga el registro en bruto. Ese gobierna
las notas de vault y la pequeña llamada al modelo que hay detrás; los dos son
independientes, y apagar uno deja el otro corriendo.

`eyas doctor` informa de si hay compresión disponible y qué implementación se
usa. Si no hay ninguna, EYAS lo dice en el log y no graba nada, en vez de llenar
un búfer en silencio.

### Los resultados de herramientas no se graban — y por qué dejarlo así

`memory.l0.captureToolResults` está **apagado por defecto**. Lee esto antes de
encenderlo.

Con él encendido, el registro en bruto guarda la **salida entera de cada llamada
a herramienta, palabra por palabra y sin editar**, más los primeros 2048
caracteres de los argumentos con los que se llamó. Es decir: la salida completa
de un comando, el contenido de cada archivo que lee el asistente y cualquier
código de un solo uso o token que una herramienta llegue a devolver — todo ello
en la base de datos como texto normal. Nada lo enmascara, nada lo revisa, y
comprimir no es cifrar. Las notas de vault pasan por el módulo de privacidad
antes de escribirse; los resultados de herramientas grabados, no.

Cada resultado grabado se limita a `memory.l0.toolResultMaxBytes` (8 KB) y se
corta en un límite de carácter con una marca de truncado visible. Con el flag
encendido, EYAS imprime en cada arranque un aviso que dice exactamente esto.

### Por qué se rechazan algunas frases

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
marca a veces como no fiable. Como todavía nada lee estas capas, el único efecto
hoy es un número en el libro mayor de corridas.

---

## Memory blocks compartidos

Además de la UI de cinco niveles, tools de agente para **bloques con scope** (estilo Letta): company / agent / team / run.

Tools: `memory_block_read` · `memory_block_write`.

## Relacionado

- [Base de conocimiento](/docs/es/knowledge/knowledge-base/)
- [Documentos](/docs/es/knowledge/documents/)
- [Wiki del proyecto](/docs/es/knowledge/client-wiki/)
- [Proveedores](/docs/es/ai/providers/) (aislamiento CLI / `loadClaudeMd`)
- [Configuración](/docs/es/deploy/configuration/) (claves `memory.l0.*`)
- [Herramientas](/docs/es/automation/tools/)
