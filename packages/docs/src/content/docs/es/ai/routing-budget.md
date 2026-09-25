---
title: Enrutado y presupuesto
description: Niveles de enrutamiento automático, alternativas, llamadas de modelo en segundo plano, límites de gasto y asignación de modelos por agente.
---

**Para qué sirve.** El enrutamiento decide *qué* modelo responde — a qué modelo queda fijada una conversación nueva, entre qué niveles se enruta una conversación en Auto y en qué modelo corre el trabajo en segundo plano de EYAS. El presupuesto decide *cuánto* gastas antes de que EYAS avise, degrade o se detenga en seco. Las asignaciones de modelo fijan un modelo predeterminado en cada agente integrado tras la configuración. Juntos evitan que una instancia con varios proveedores use siempre el modelo caro o se quede sin dinero en silencio.

**Ruta:** `/providers` (barra lateral **Proveedores**) → pestañas **Niveles de enrutamiento** y **Presupuesto**. Asignaciones de modelo: Ajustes (`/settings`) → tarjeta **Asignaciones de modelo**.

## Cuándo usarlo

- Las conversaciones en Auto deben recibir un modelo barato para preguntas rápidas y uno más potente para código.
- El trabajo en segundo plano — títulos, el heartbeat, el juez de seguridad, la captura de memoria — debe correr en un modelo que elijas (el nivel **Latido**).
- Un proveedor principal en la nube o CLI falla a ratos y quieres una **Alternativa** explícita (o la conmutación automática opcional).
- Necesitas límites diarios/semanales/mensuales, un umbral de aviso, una degradación y una parada en seco.
- Los agentes integrados siguen sin modelo tras el asistente — asígnalos en Ajustes.

## Flujo típico

1. Abre **Proveedores** (`/providers`) → **Niveles de enrutamiento**.
2. Revisa arriba la tarjeta **Llamadas de modelo en segundo plano**: cada grupo de trabajo en segundo plano debería mostrar un modelo, no *Sin modelo — alternativa determinista*.
3. Pon **Permitir enrutamiento automático** en **Activado** si las conversaciones en Auto pueden enrutarse analizando el mensaje (pista: *Si está activado, una conversación configurada con enrutamiento automático elige su modelo en cada mensaje. Las conversaciones con un modelo fijo o con el predeterminado del colega nunca se redirigen.*).
4. En cada nivel fija el proveedor y el modelo **Principal**, una **Alternativa** opcional y el **Esfuerzo** predeterminado del nivel.
5. Abre **Presupuesto**: rellena **Diario / Semanal / Mensual** en **Límites de gasto**, y después **Avisar al / Degradar al / Detener al** en **Umbrales**.
6. Abre **Ajustes** → **Asignaciones de modelo** para fijar un proveedor y un modelo en cada agente semilla, y pulsa **Guardar asignaciones**.

## Funciones

<h3 id="auto-failover">Conmutación automática entre proveedores (opcional)</h3>

Cuando la **conmutación automática** está activada (`EYAS_AUTO_FAILOVER=1`, o `model.autoFailover: true` en la configuración), al arrancar un segundo proveedor activo rellena los huecos de **Alternativa** vacíos de los niveles. **Las alternativas que fijaste tú nunca se sobrescriben.**

Úsala para ganar resiliencia cuando un proveedor principal en la nube o CLI falla a ratos; para controlar coste y calidad, sigue siendo mejor elegir tú las alternativas.

Los presupuestos mensuales de tokens por agente son aparte (pestaña **Configuración** del agente).

<h3 id="default-binding">Qué modelo responde cuando nada lo nombra</h3>

Algunas llamadas de EYAS no nombran proveedor ni modelo: el primer mensaje de una conversación nueva (la conversación conserva luego ese modelo — ver [Conversaciones — Qué modelo responde](/docs/es/daily/conversations/#which-model-answers)), las ediciones de diseño con IA y las ejecuciones de agentes cuyo agente no tiene modelo. Van al **predeterminado de la instalación**, que se comprueba en este orden:

1. el nivel de enrutamiento **Estándar**, si su proveedor está activado;
2. si no, el proveedor y el modelo predeterminados de la instalación — los fijas al elegir la **CLI principal** en el [asistente de configuración](/docs/es/setup-wizard/), o con `PUT /api/v1/model/defaults`;
3. si no, el proveedor activado que va primero por orden alfabético y tiene al menos un modelo activado.

Ningún proveedor se prefiere por su nombre, y el orden en que arrancan los proveedores no importa. Si no existe nada de esto, la llamada falla con *No default model binding: configure the Standard tier or a default provider* en vez de adivinar. Las versiones anteriores enviaban esas llamadas a Anthropic si estaba configurado, o si no al proveedor que se registrara primero — así que en una instalación con varios proveedores y sin nivel Estándar, estas llamadas pueden ir ahora a otro proveedor que antes. Fijar el nivel Estándar (o el proveedor predeterminado) lo controla.

<h3 id="background-model">El modelo en segundo plano</h3>

El trabajo en segundo plano de EYAS nunca corre en el proveedor que la pasarela elija por casualidad. Pasa por un único resolutor que prueba candidatos fijos en orden y solo usa un modelo capaz de ejecutar una llamada **aislada** — sin herramientas, un solo turno, nada de la memoria ni la configuración propias de la CLI. Son elegibles todos los proveedores de API, Claude Code, y Grok CLI / Kimi Code CLI una vez que EYAS ha verificado su aislamiento en este equipo. Una CLI que no puede aislarse no se usa nunca, ni como candidata ni como **Alternativa** de un nivel.

| Trabajo en segundo plano | Candidatos, por orden |
|--------------------------|-----------------------|
| Títulos de conversación | Solo el nivel **Latido** — nunca el modelo propio de la conversación ni otro proveedor |
| Captura de memoria, consolidación nocturna, el briefing de reflexión, el briefing del heartbeat, sugerencias de Autoaprendizaje, propuestas de Forge, redacción de skills, enriquecimiento del Data Port | Nivel **Latido** (principal y luego alternativa) → predeterminado de la instalación → proveedores de API por orden alfabético → CLIs que pueden ejecutarse aisladas |
| Juez de seguridad, crítico de completitud, plan de rúbrica para objetivos complejos en segundo plano | **Latido** → **Rápido** → predeterminado de la instalación → otros proveedores elegibles |
| Propuesta de equipo y el replanificador entre fases | **Rápido** → **Estándar** → predeterminado de la instalación → otros proveedores elegibles |
| Investigación (ampliación de consultas, puntuación de fuentes, redacción, verificación cruzada) | **Estándar** → predeterminado de la instalación → proveedores de API → CLIs que pueden ejecutarse aisladas |
| Clasificador del enrutamiento automático | Solo el nivel **Clasificación** (principal y luego alternativa) — ver [Auto-enrutado](#auto-routing) |

Un segundo candidato solo se prueba tras un fallo de red, de tiempo de espera, de sobrecarga o de límite de tasa, nunca después de que el primero haya respondido (en la práctica solo lo hace el grupo de seguridad). Una **parada** del presupuesto significa ninguna llamada.

<h4 id="background-effort">Esfuerzo de las llamadas en segundo plano</h4>

Cada llamada en segundo plano pide el esfuerzo de razonamiento fijado en el primer nivel de enrutamiento de su propósito: el nivel **Latido** para el trabajo de memoria, el de aprendizaje, los títulos y los controles de seguridad; **Rápido** para la replanificación y las propuestas de equipo; **Estándar** para la investigación; **Clasificación** para el clasificador del enrutamiento automático. Se aplica el mismo esfuerzo del nivel sea cual sea el modelo que acabe respondiendo — el modelo propio del nivel, el predeterminado de la instalación, un proveedor de API o una CLI que puede ejecutarse aislada —, y se ajusta a ese modelo: un nivel no admitido pasa al más cercano que acepte. Clasificación, Rápido y Latido están por defecto en *Bajo*, así que por defecto la mayoría de las llamadas en segundo plano piden Bajo; la investigación sigue a Estándar, que por defecto está en Automático. Un nivel en Automático no envía ningún parámetro de esfuerzo. Cuando el modelo no tiene control de esfuerzo, o EYAS no puede saber qué modelo responde (una CLI llamada sin un modelo concreto, algo habitual en instalaciones solo con CLI), no se envía nada y se aplica el valor predeterminado del propio modelo.

<h4 id="background-traced">Trazadas y contabilizadas</h4>

Cada llamada en segundo plano se traza como un turno de conversación — proveedor, modelo, tokens, coste, latencia, su propósito, el esfuerzo pedido y el efectivo — y su coste cuenta para los límites diario, semanal y mensual del presupuesto, igual que los turnos de conversación. Una llamada en segundo plano que no pudo ejecutarse porque no había ningún modelo elegible no hace ninguna llamada al modelo: no deja traza y no cuesta nada. Ver [Observabilidad — Uso](/docs/es/admin/observability/#usage-tab).

Cada llamada en segundo plano envía sus instrucciones como un prompt de sistema real y exactamente un mensaje de usuario, en todos los proveedores — nunca como una línea de usuario o de asistente.

<h4 id="background-no-model">Cuando ningún modelo es elegible</h4>

Por ejemplo en una instalación solo con Grok o solo con Kimi antes de verificar su aislamiento, EYAS no hace ninguna llamada al modelo y cada función conserva su resultado determinista: el fragmento del primer mensaje sigue siendo el título; el heartbeat envía la alerta *Heartbeat: items may need your attention* con su lista de motivos; Autoaprendizaje muestra sus sugerencias genéricas; Forge conserva la propuesta concatenada; Skill Evolution escribe la plantilla `SKILL.md`; la captura de memoria registra que se omitió; la consolidación deja los grupos para otra noche; el briefing conserva su parte determinista; el juez de seguridad escala a tu aprobación; el crítico marca la ejecución como *Sin verificar*; la propuesta de equipo es un solo agente; la investigación arma su informe con las mejores fuentes. En una instalación donde Claude Code es el único modelo, cada una de esas llamadas lanza un proceso breve y aislado de Claude Code.

<h3 id="background-model-calls-card">Tarjeta de llamadas de modelo en segundo plano</h3>

La pestaña **Niveles de enrutamiento** empieza con la tarjeta **Llamadas de modelo en segundo plano**. Muestra adónde va ahora el trabajo en segundo plano de EYAS, sin hacer ninguna llamada al modelo. Hay una fila por grupo:

| Grupo | Qué abarca |
|-------|------------|
| **Memoria: captura, consolidación, reflexión, enriquecimiento de importaciones** | Captura, consolidación nocturna, el briefing de reflexión, enriquecimiento de importaciones del Data Port |
| **Aprendizaje: latido, autoaprendizaje, Forge, redacción de skills** | El heartbeat, Autoaprendizaje, Forge, redacción de skills |
| **Títulos de conversación** | Títulos automáticos |
| **Seguridad: juez de seguridad, crítico de completitud, rúbrica de objetivos** | Juez de seguridad, crítico de completitud, rúbrica de objetivos |
| **Planificación: propuesta de equipo, replanificador** | Propuesta de equipo, el replanificador entre fases |
| **Investigación** | Ejecuciones de investigación |
| **Triaje del enrutamiento automático** | El clasificador del enrutamiento automático |

Cada fila muestra o bien el proveedor y el modelo que usaría la próxima llamada del grupo, como *Proveedor · Modelo*, con una insignia que indica de dónde sale — **Nivel** (el nivel de enrutamiento del grupo, principal y luego alternativa), **Predeterminado** (el predeterminado de la instalación), **Proveedor de API** o **CLI aislada** (una CLI que puede ejecutar llamadas aisladas; solo muestra el nombre del proveedor, porque ejecuta su propio modelo predeterminado) —, o bien **Sin modelo — alternativa determinista**, con el motivo:

- *Ningún proveedor puede ejecutar una llamada aislada* — no hay nada elegible activado, por ejemplo una instalación solo con Grok o solo con Kimi antes de que EYAS verifique su aislamiento, o un nivel que nombra una CLI así;
- *Su nivel no está configurado* — solo para títulos y triaje, que usan únicamente su nivel;
- *Límite de presupuesto alcanzado* — una parada del presupuesto bloquea todas las llamadas en segundo plano.

La tarjeta muestra el primer candidato. Si algún grupo no tiene proveedor elegible, un aviso rojo indica que parte del trabajo en segundo plano no tiene ningún modelo que pueda usar, así que ejecuta su alternativa integrada sin llamar a ningún modelo, y te pide activar un proveedor de API o una CLI cuyo aislamiento haya verificado EYAS. Un nivel sin configurar o una parada del presupuesto muestran su motivo en la fila, pero sin aviso. La tarjeta se actualiza cada vez que abres la pestaña Niveles de enrutamiento y tras cada cambio de nivel en ella.

**API (integradores).** `GET /api/v1/routing/auxiliary` (lectura de Settings; `401` sin sesión, `403` sin el permiso) devuelve `{ groups: [ { group, purposes, target: { provider, model | null, route } | null, reason | null } ] }` — `group` es `memory`, `learning`, `title`, `safety`, `planning`, `research` o `triage`; `route` es `tier`, `default`, `api` o `isolated-cli`; `reason` es `no_eligible_provider`, `tier_not_configured` o `budget_stop`. Solo responde `503` si el servicio de modelo en segundo plano no está disponible. Las llamadas en segundo plano aparecen etiquetadas con su propósito en las trazas de [Observabilidad](/docs/es/admin/observability/).

## Campos y controles

<h2 id="auto-routing">Auto-enrutado</h2>

| Control | Significado |
|---------|-------------|
| **Permitir enrutamiento automático** Activado/Desactivado | Permite el enrutamiento automático para las conversaciones en Auto. No enruta otras conversaciones |
| Pista | *Si está activado, una conversación configurada con enrutamiento automático elige su modelo en cada mensaje. Las conversaciones con un modelo fijo o con el predeterminado del colega nunca se redirigen.* |

**Solo se enrutan las conversaciones en Auto.** Una conversación conserva el modelo en el que corre: un modelo fijo, o el modelo de su colega, nunca se clasifica. En una conversación en Auto, su mensaje se clasifica y se enruta al nivel **Rápido**, **Estándar**, **Complejo** o **Ejecución de código**. Mientras el interruptor está desactivado, una conversación en Auto usa su modelo guardado y lo indica. Cuando todos los niveles apuntan al mismo modelo (por ejemplo en una instalación con una sola CLI), no se clasifica nada. El enrutamiento automático se elige por conversación en el selector de modelo de su barra superior; la entrada aparece atenuada mientras **Permitir enrutamiento automático** está desactivado. Ver [Conversaciones — Qué modelo responde](/docs/es/daily/conversations/#which-model-answers).

**El clasificador.** Primero van las reglas de palabras clave, que no cuestan nada: un mensaje que colocan (por ejemplo una traducción, una revisión de código o una petición de depuración) no llama a ningún modelo. Solo un mensaje que no saben colocar se envía al modelo del nivel **Clasificación** — su Principal, o su Alternativa cuando el Principal no se puede usar, y solo si ese proveedor puede ejecutar llamadas aisladas. Nunca recurre al nivel Estándar, al predeterminado de la instalación ni a otro proveedor. La llamada es aislada (sin herramientas, sin memoria ni configuración del proveedor, sin sesión guardada), envía solo los primeros 500 caracteres del mensaje, pasa por el mismo enmascaramiento de privacidad y la misma trazabilidad que cualquier otra llamada al modelo y cuenta para los límites de gasto. Si no existe tal modelo, se alcanzó la parada del presupuesto o la respuesta no es una categoría y complejidad válidas, decide la clasificación por palabras clave y el turno no se retrasa. En una instalación solo con Claude Code, un mensaje no clasificado en una conversación en Auto sigue esperando a una llamada breve y aislada de Claude Code antes de que empiece la respuesta.

<h2 id="tiers">Niveles de enrutamiento</h2>

Cada nivel tiene un proveedor y un modelo **Principal** y una **Alternativa** opcional:

| Nivel | Uso típico |
|-------|------------|
| **Clasificación** | El clasificador del enrutamiento automático para mensajes que las reglas de palabras clave no saben colocar (solo principal y alternativa) |
| **Rápido** | Respuestas rápidas y baratas |
| **Estándar** | Calidad por defecto — también el predeterminado de la instalación para llamadas que no nombran modelo ([arriba](#default-binding)) |
| **Complejo** | Tareas difíciles |
| **Ejecución de código** | Trabajo con mucho código |
| **Latido** | Primera opción para el trabajo en segundo plano de EYAS — títulos (el único candidato), el heartbeat, la captura de memoria, el juez de seguridad y más ([arriba](#background-model)) |
| **Embedding** | Solo alimenta el índice de búsqueda antiguo del vault y episódico. El recall de memoria nunca lo usa: el recall siempre genera los embeddings en local (ver [Memoria — La búsqueda vectorial siempre corre en local](/docs/es/knowledge/memory/#vector-search-always-runs-locally)). Si el nivel nombra un proveedor que no genera embeddings, ese índice también usa el embedder local; cuando cambia su embedder, el índice se vacía una vez y se reconstruye solo |
| **Optimizador de prompts** | El Prompt Enhancer del compositor de la conversación y el Prompt coach de proyectos y agentes ([Prompts](/docs/es/ai/prompts/)) |

| Campo | Significado |
|-------|-------------|
| **Selecciona un proveedor…** | Proveedor principal del nivel |
| **Selecciona un modelo…** | Modelo principal |
| **Alternativa** (**Selecciona una alternativa…** / **Ninguno**) | Respaldo si falla el principal |
| **Esfuerzo** | El esfuerzo de razonamiento predeterminado del nivel (todos los niveles salvo **Embedding**) — ver [abajo](#tier-effort) |

En una instalación con Kimi Code CLI, los niveles que el propio EYAS había fijado en las filas retiradas *Kimi Code CLI (K3)*, *(K2.7 Code)* o *(K2.6)* pasan al arrancar a **Kimi Code CLI** (la fila predeterminada), que es lo que siempre ejecutaron; una instalación nueva solo con Kimi arranca todos los niveles en ella, sin alternativa. Ver [Proveedores — Modelos de Kimi y thinking](/docs/es/ai/providers/#kimi-models-and-thinking).

<h3 id="tier-effort">Esfuerzo predeterminado del nivel</h3>

Cada nivel de enrutamiento salvo **Embedding** tiene un selector de **Esfuerzo**: el esfuerzo de razonamiento predeterminado de las llamadas dirigidas a ese nivel. **Clasificación**, **Rápido** y **Latido** están por defecto en *Bajo*; los demás niveles en *Automático* (el valor predeterminado del propio modelo). El selector solo lista los niveles que acepta el modelo del nivel; si eliges un modelo que no ofrece el nivel guardado, se cambia antes de guardar y se indica (*Esfuerzo ajustado de … a …*), y un nivel que el modelo no acepta se rechaza con *El modelo no ofrece este nivel de esfuerzo. No se guardó nada.*

El predeterminado del nivel se aplica en dos sitios:

- **Un mensaje enrutado por el nivel**, cuando nada más arriba en el orden fija un nivel: nivel propio de la conversación > Profundo (Máximo) > colega > conversación que delega > nivel de enrutamiento > predeterminado del modelo.
- **Las llamadas en segundo plano de EYAS** cuyo primer nivel es ese — Latido para la memoria, el aprendizaje, los títulos y los controles de seguridad; Rápido para la replanificación y las propuestas de equipo; Estándar para la investigación; Clasificación para el clasificador ([arriba](#background-effort)).

Así que cambiar el esfuerzo de un nivel cambia tanto los mensajes enrutados por él como las llamadas en segundo plano que lo usan. Las instalaciones existentes recibieron el valor *Bajo* una vez, en el primer arranque tras la actualización; un nivel que vuelvas a poner en Automático se queda en Automático. `PUT /api/v1/routing/tiers/:tier` valida su cuerpo: un nivel desconocido devuelve `404`, y un esfuerzo que el modelo del nivel no acepta devuelve `400` con el código `EFFORT_UNSUPPORTED` y los niveles aceptados. Ver [Proveedores — Esfuerzo de razonamiento](/docs/es/ai/providers/#reasoning-effort).

<h2 id="budget">Presupuesto / límites de gasto</h2>

| Campo | Significado |
|-------|-------------|
| **Diario / Semanal / Mensual** (**Límites de gasto**) | Límites en dólares del periodo; vacío significa *ilimitado* |
| **Avisar al** (**Umbrales**) | Umbral de aviso, como fracción del límite (se muestra en porcentaje; por defecto 0,8 = 80 %) |
| **Degradar al** | Pasar a modelos más baratos (por defecto 1,0 = 100 %) |
| **Detener al** | Bloquear más gasto, llamadas en segundo plano incluidas (por defecto 1,2 = 120 %) |

<h2 id="model-assignments">Asignaciones de modelo (Ajustes)</h2>

El sustituto autenticado del paso opcional de modelos de IA del asistente (ese paso se bloquea en cuanto termina la configuración).

| Control | Significado |
|---------|-------------|
| Nombre del agente | Agente integrado / semilla |
| Selector de modelo | **— ninguno —** o un modelo de los proveedores activados, mostrado como *Proveedor / modelo* |
| **Guardar asignaciones** | PUT `/api/v1/model/agent-assignments` (`manage Model`) |

Al guardar se almacenan juntos el proveedor y el modelo, así que un id de modelo que listan dos proveedores nunca es ambiguo. La API acepta `{assignments: {agentId: {providerId, modelId}}}` o el antiguo `{agentId: modelId}`; en ese caso, un id de modelo que listan varios proveedores se guarda sin proveedor. Si algún modelo no está en el catálogo, devuelve `400` con `code: unknown_model` y los `agents`, y no se escribe nada.

La tarjeta se oculta mientras no haya agentes semilla o modelos.

## Relacionado

- [Proveedores](/docs/es/ai/providers/)
- [Observabilidad](/docs/es/admin/observability/)
- [Agentes — presupuesto de tokens](/docs/es/agents/configure/)
- [Prompts](/docs/es/ai/prompts/)
- [Proactivo](/docs/es/automation/proactive/)
