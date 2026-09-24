---
title: Arquitectura (enlace)
description: Dónde están las especificaciones técnicas, y las reglas transversales en las que se apoya el resto de este manual.
---

La documentación de usuario termina aquí. Para quienes implementan:

| Ruta | Contenido |
|------|-----------|
| `docs/eyas-architecture.md` | La arquitectura modular completa |
| `docs/superpowers/specs/` | Especificaciones de diseño |
| `docs/superpowers/plans/` | Planes de implementación |
| `CHANGELOG.md` | Publicaciones |

No trates esos archivos como manuales de usuario final. Las secciones siguientes resumen las reglas que se cumplen en todos los proveedores — modelos de API, Claude Code CLI, Grok CLI, Kimi Code CLI, runtimes locales y OpenCode — y enlazan a las páginas que las explican.

## Capa de soberanía de la memoria {#memory-sovereignty-layer}

EYAS es la única memoria que tiene un modelo. Un modelo solo la lee a través del bloque de recall de su mensaje y de las herramientas `memory_search` / `memory_expand`. Nunca escribe memoria — la registra EYAS — y no puede alcanzar memoria fuera de EYAS por ningún canal:

```text
La llamada a herramienta de un modelo llega por uno de estos canales:
  1. Herramientas de EYAS en el propio bucle de agente de EYAS (proveedores de API)
  2. Herramientas de EYAS que Grok CLI y Kimi Code CLI llaman por el puente
  3. Las herramientas integradas de Claude Code (una comprobación antes de
     ejecutarse) y las solicitudes de permiso de Claude Code
  4. Las solicitudes de permiso de Grok / Kimi, y los archivos que leen
     o escriben a través de EYAS
                         |
                         v
        UNA política de rutas. Protege:
          - la memoria de otras herramientas de IA
          - las bóvedas de Obsidian
          - las rutas de security.foreignMemoryPaths
          - la carpeta de datos de EYAS (vault, base de datos, claves, inicios de sesión de CLI)
          - los espacios de trabajo de otras conversaciones
                         |
             +-----------+-----------+
             v                       v
      rechazo firme              permitido
   (sin juez de IA, sin aprobación,
    no cuenta para el bloqueo,
    una fila en Eventos de seguridad)

Bajo la shell propia de las CLI, el sandbox de archivos del sistema
operativo bloquea los mismos lugares (Claude Code y Grok CLI; Kimi Code
CLI no tiene).

Memoria que entra:  el bloque <eyas-memory> + memory_search / memory_expand
Memoria que sale:   solo la escribe EYAS
```

Las tareas headless de OpenCode pasan la misma comprobación, y el modelo de OpenCode solo lee memoria con esas mismas dos herramientas.

- Dónde se aplica la política y qué se le dice al modelo: [Seguridad y privacidad — Memoria fuera de EYAS](/docs/es/admin/security-privacy/#memory-outside-eyas).
- Cómo se demuestra en las CLI reales antes de cada publicación: [Seguridad y privacidad — Cómo se demuestra el aislamiento](/docs/es/admin/security-privacy/#how-isolation-is-proven).
- Qué recibe el modelo a cambio: [Memoria — Cómo funciona el recall](/docs/es/knowledge/memory/#how-recall-works) y [La memoria fuera de EYAS se rechaza](/docs/es/knowledge/memory/#memory-outside-eyas-is-refused).

## Entrega de memoria {#memory-delivery}

La memoria recordada llega a todos los modelos de la misma manera, por cualquier vía de entrada.

- **Un productor.** El ensamblador del prompt es el único lugar donde se produce el recall, a través de un único servicio de recall. El chat, las ejecuciones en segundo plano y programadas, las ejecuciones del bot del tablero, los workers de God Mode, los especialistas y agentes delegados, los miembros de equipo, las respuestas de canal, los traspasos entre colegas y las tareas de OpenCode pasan todos por él. La consulta de recall la construye el propio servicio a partir de la conversación, así que todas las vías buscan igual.
- **Una ubicación.** El runner del agente adjunta el bloque del turno — la fecha y la hora actuales y, después, el bloque de recall — al mensaje actual del usuario al enviar la petición. El mensaje guardado nunca cambia, y una ejecución reanudada recibe un bloque nuevo en lugar del antiguo. Nada de lo que cambia de un turno a otro va en el system prompt, que por eso no cambia y se puede cachear (automático en la API de Anthropic).
- **A la medida del modelo.** El perfil de entrega de cada turno sale de un único resolvedor de ventana: la ventana del modelo en el catálogo; si no, la ventana conocida del proveedor CLI; si no, 200k tokens. Los presupuestos están fijados para una ventana de 100k tokens — ahí la parte del bloque de recall es `memory.index.budgetChars`, 2400 caracteres por defecto — y crecen con la ventana: hasta 2,5× a partir de 250k tokens, mientras que por debajo de 100k el presupuesto del prompt nunca ocupa más del 35 % de la ventana. La identidad maestra y las reglas nunca se recortan.
- **Nombres según el host.** Los nombres de herramienta son canónicos, y cada pista los nombra como los lista el host del modelo: `memory_search` en los proveedores de API, `mcp__eyas__memory_search` en Claude Code, `use_tool` con `eyas__memory_search` en Grok CLI y `memory_search` en el servidor MCP `eyas` en Kimi Code CLI. A un modelo que no puede llamar a herramientas no se le envían herramientas ni pista de drill-down, y recibe hasta cuatro notas con su texto completo en vez de dos.
- **Drill-down.** `memory_search` y `memory_expand` permiten juntas 3 llamadas por turno, en todos los proveedores. EYAS resuelve su ámbito de proyecto en el servidor a partir de la conversación, nunca de un argumento de la herramienta.
- **Audiencia.** La memoria del propietario no se empuja a lectores externos. Las tareas de pares A2A y las respuestas de canal con voz externa — o cuya voz no puede determinarse — solo reciben la fecha y la hora, y el turno registra que el recall se retuvo. Las herramientas de memoria siguen bajo el gate de seguridad.
- **Visible.** Cada turno registra lo que recibió: en el recuadro **Memoria entregada** de su composición del contexto y en `memoryTiersUsed` de su traza. La tarjeta **Entrega de memoria por proveedor** de **Observabilidad → Contexto** compara proveedores. Ver [Conversaciones — Composición del contexto](/docs/es/daily/conversations/#context-composition) y [Observabilidad y ops](/docs/es/admin/observability/#memory-delivery-by-provider).

## Un enlace de modelo, un ámbito de herramientas, una forma de lanzar especialistas {#binding-tools-specialists}

- **Un enlace de modelo por turno.** Cada turno corre en el modelo al que está enlazada su conversación — un modelo fijo, el predeterminado del colega o el Auto-enrutado. El enlace se conoce antes de ensamblar el prompt, así que el tamaño del prompt y sus nombres de herramienta se ajustan a ese modelo. Un modelo que elegiste nunca se cambia en silencio; un modelo que EYAS fijó por sí mismo recurre a otro con una nota. Ver [Conversaciones — Qué modelo responde](/docs/es/daily/conversations/#which-model-answers).
- **Una forma de lanzar especialistas.** Los especialistas siempre corren a través de EYAS con `run_specialist`, en todos los proveedores, como subconversaciones con su propia ejecución supervisada. No se ofrece la herramienta de subagentes propia de Claude Code. Ver [Equipos y delegación](/docs/es/agents/teams/).
- **Un ámbito de herramientas.** A un agente se le ofrecen su lista de herramientas más `memory_search` y `memory_expand` (una lista vacía significa todas las herramientas), y el modo Solo quita las herramientas de delegación. El mismo ámbito rige en todas las vías de ejecución y en todos los proveedores, también para las herramientas de EYAS que una CLI alcanza por el puente; una llamada fuera de él se rechaza. Ver [Crear y configurar — Herramientas y restricciones](/docs/es/agents/configure/#tools--constraints).

## Esfuerzo de razonamiento y versiones de CLI probadas {#effort-and-cli-versions}

- **Esfuerzo.** El nivel se decide por modelo, en el momento en que un modelo responde — de nuevo tras el enrutado, un reintento o un fallback —, y se ajusta a lo que ese modelo admite. Cada proveedor solo lo traduce a su propio parámetro, y un modelo del que EYAS no tiene datos verificados no recibe ninguno. Claude Code CLI, Grok CLI y Kimi Code CLI informan del nivel con el que corrieron de verdad. Ver [Proveedores — Cómo aplica cada proveedor el nivel de esfuerzo](/docs/es/ai/providers/#effort-by-provider).
- **Versiones de CLI probadas.** El aislamiento de las CLI se comprueba al arrancar cada sesión, y cada versión de CLI se demuestra antes de publicarse con la comprobación de publicación (`bun run test:live-cli`). `eyas doctor` compara el binario instalado con la última versión probada. Ver [Proveedores — Versiones de CLI probadas](/docs/es/ai/providers/#proven-cli-versions).

## Observabilidad en todos los proveedores {#observability-on-every-provider}

- **Llamadas a herramientas, contadas una vez.** Una traza cuenta las llamadas que el modelo devolvió a EYAS para que las ejecutara y las que una CLI resolvió en su propio bucle — sus herramientas integradas y las de EYAS por el puente —, cada una una vez, igual en todos los proveedores.
- **Las herramientas que ejecuta una CLI se registran, no se vuelven a ejecutar.** Una herramienta que una CLI ejecutó por sí misma recibe una fila en el registro de ejecución de herramientas con su nombre canónico y su ejecución. EYAS no la ejecuta ni la autoriza una segunda vez, y nada del registro llega a la memoria: si la salida de las herramientas se guarda en memoria lo decide únicamente `memory.l0.captureToolResults`. Ver [Herramientas — Registro de ejecución de herramientas](/docs/es/automation/tools/#tool-execution-log).
- **Memoria por turno.** Las trazas llevan `memoryTiersUsed`, los elementos recordados contados por prefijo de id de memoria, y `GET /api/v1/observability/memory-parity` agrega el recall y los drill-downs por proveedor que respondió. Ver [Observabilidad y ops](/docs/es/admin/observability/#usage-tab).
- **Las llamadas a modelos de EYAS.** El trabajo en segundo plano — títulos, captura de memoria, el juez de seguridad, … — corre en el modelo en segundo plano y se traza y cuenta contra el presupuesto como un turno de conversación. Ver [Enrutado y presupuesto — El modelo en segundo plano](/docs/es/ai/routing-budget/#background-model).

## Para colaboradores {#for-contributors}

- **Llamadas a modelos.** El código del backend llama directamente al gateway de modelos solo desde una lista corta y revisada: el runner del agente, la ruta de streaming del chat, las rutas de la API de modelos, el tracing, el propio gateway y unas pocas llamadas interactivas aisladas de una sola vez (Plan primero, el revisor de God Mode, Design). El trabajo en segundo plano pasa por el servicio del modelo en segundo plano. `tests/modules/model/no-direct-model-calls.test.ts` falla ante cualquier otra llamada directa.
- **Este manual.** El inglés es la fuente, y las cinco traducciones mantienen los mismos encabezados en el mismo orden. Un encabezado traducido conserva el ancla inglesa con el sufijo `## Encabezado {#english-id}`, de modo que los enlaces `/docs/<lang>/<page>/#<id>` y los hashes de ayuda de la aplicación funcionan en todos los idiomas y el encabezado sigue en el índice de la página. Un id que contiene `--` no sobrevive al paso tipográfico, que se ejecuta antes; ese encabezado usa un `<h3 id="…">` en bruto. Una sola prueba, `tests/contracts/handbook-locale-parity.test.ts`, falla cuando una página listada difiere entre idiomas (encabezados, anclas, la forma del encabezado, filas de tabla) o cuando cualquier enlace del manual apunta a un ancla que su página no tiene. Estructura y tono de las páginas: `packages/docs/PAGE_TEMPLATE.md`.
