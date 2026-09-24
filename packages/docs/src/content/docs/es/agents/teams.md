---
title: Equipos y delegación
description: Colegas con los que hablas, especialistas que lanzan y cuándo aparece aún una propuesta de equipo.
---

**Para qué sirve.** Hablas con **colegas** (agentes principales y de equipo). Tienen roles estrictos. Pasan el trabajo a otro colega o lanzan **especialistas** de un grupo compartido — automáticamente, a menudo en paralelo. La tarjeta de propuesta de equipo solo aparece si falta un especialista, pediste un equipo o el trabajo es épico.

Esto es colaboración, no el Modo Dios (varios modelos compitiendo en la misma tarea).

## Cuándo usarlo

- Quieres hablar con el Asistente personal o con el Ingeniero de sistemas como personas, no como un desplegable oculto.
- Un trabajo necesita varios especialistas a la vez (`run_specialist` en un mismo turno).
- Worktrees de git para que los editores en paralelo no choquen (sesiones implícitas con dos o más especialistas que escriben, y propuestas de equipo épicas).
- Sigues queriendo un plan visible que **Aceptar** cuando un especialista todavía no existe.

## Flujo típico

1. Abre un **colega** desde la barra lateral (**Colegas**), o elige uno en una conversación nueva.
2. Pídele el trabajo. Debe usar `handoff_to_colleague` o `run_specialist` en lugar de hacer el trabajo de otro rol.
3. Las ejecuciones de especialistas aparecen como subconversaciones. La memoria de equipo funciona sin tarjeta de propuesta (sesión implícita).
4. Pulsa **Abrir Team Dashboard** cuando haya varios especialistas trabajando a la vez.
5. La tarjeta **Propuesta de equipo** sigue apareciendo con `/team`, «usa un equipo» o trabajo épico — **Aceptar** u **Omitir**.

## Conceptos

| Concepto | Significado |
|----------|-------------|
| **Colega** | Agente principal o de equipo al que escribes directamente. Tiene un hilo propio y una voz (SOUL). |
| **Especialista** | Trabajador de ámbito acotado. Grupo compartido — cualquier colega puede lanzar cualquier especialista activado. |
| **`run_specialist`** | Lanzamiento en línea; espera un resumen. Verde (sin clic). Alias: `delegate_to_agent`. |
| **`handoff_to_colleague`** | Abre el hilo propio del otro colega y arranca allí una ejecución al momento, con el encargo como objetivo. Se rechaza con un mensaje *busy* mientras ese hilo está ocupado. Verde. Ver [Conversaciones — Traspaso](/docs/es/daily/conversations/#handoff). |
| **`assign_task`** | Tarjeta de tablero asíncrona. Verde si el destino está activado. |
| **`propose_team`** | Tarjeta para roles que faltan / trabajo épico / petición explícita. Amarillo. |
| **Hilo propio** | Una conversación continua por colega. |
| **Sesión de trabajo implícita** | Se crea en el primer lanzamiento de especialista para que la memoria de equipo funcione sin tarjeta. |

## Niveles

| Nivel | ¿Hablas con ellos? | Trabajo típico |
|-------|--------------------|----------------|
| **Principal** | Sí | Compañeros creados en la configuración inicial (Asistente, Ingeniero) |
| **Equipo** | Sí | Colegas permanentes (revisor, crítico, …) |
| **Especialista** | No (solo como hijo / tarea) | Ejecución en un único dominio |

## Una sola forma de ejecutar especialistas, con todos los proveedores

Los especialistas siempre se ejecutan a través de EYAS. Cuando un colega reparte trabajo — tanto en orquestación **Automático** como **Profundo** —, lanza especialistas con `run_specialist`, sea cual sea el proveedor en el que corre: Claude Code, Grok CLI, Kimi CLI o un proveedor de API. Claude Code no lanza subagentes ocultos propios: no se le ofrece su herramienta integrada Task/Agent.

Cada especialista se ejecuta con su configuración de agente de EYAS — prompt de persona, memoria de EYAS, herramientas configuradas — y aparece como una subconversación que puedes abrir, con su propia ejecución supervisada y su transcripción. El modo **Profundo** en Claude Code puede tardar más, porque cada especialista es una ejecución completa de EYAS.

**Profundo da a todos los modelos la misma instrucción:** dividir el trabajo no trivial y lanzar un especialista por cada parte independiente, en paralelo, cada uno con un encargo preciso y autocontenido; traspasar con `handoff_to_colleague` cuando el trabajo corresponde a otro colega; proponer un equipo solo cuando todavía no existe un especialista necesario; verificar los resultados importantes antes de concluir; y quedarse con la síntesis final.

**Seguridad.** La puerta de seguridad no preaprueba el nombre de la herramienta de subagentes de Claude Code. A Claude Code nunca se le ofrece esa herramienta, y una llamada a ella se trataría como no clasificada y se escalaría para aprobación en lugar de permitirse.

<h2 id="which-model-and-effort-a-specialist-or-member-uses">Qué modelo y qué esfuerzo usa un especialista o miembro</h2>

**Modelo.** El modelo de un agente es un par proveedor + modelo (ver [Crear y configurar — Modelo y esfuerzo](/docs/es/agents/configure/#model--effort)). Si está vacío, el agente usa el modelo propio de la conversación:

- Un **especialista** lanzado con `run_specialist` / `delegate_to_agent`, una tarjeta repartida con `assign_task` y una subconversación creada con `create_sub_conversation` se ejecutan en el modelo **en el que realmente corrió el turno que delega**. Ese par se guarda en la nueva subconversación; no se copia de los ajustes guardados de la conversación padre. En Claude Code, Grok y Kimi, el modelo del turno que delega llega también a las herramientas de EYAS llamadas por el puente.
- Un **miembro de equipo** usa su propio modelo; si no, el modelo actual del líder (el modelo en el que corre ahora la conversación padre; en una conversación con enrutamiento automático, su nivel Estándar); si no, el predeterminado de la instalación.
- Si no hay nada de esto, se usa el predeterminado de la instalación (nivel Estándar → proveedor predeterminado → primer proveedor activo con un modelo activado, incluidos los proveedores CLI), y se fija en esa conversación la primera vez que se ejecuta.
- Si no se puede usar el modelo propio del agente (su proveedor está desactivado o el modelo deshabilitado), la ejecución usa el modelo guardado de la conversación (el del turno que delega), si no el predeterminado, y la respuesta registra la nota `agent-binding-unavailable`. EYAS nunca elige otro proveedor por su nombre. Si no hay ningún modelo configurado, la ejecución falla con *No hay ningún modelo configurado…* y no se reintenta.

No existe un enrutador de modelos de equipo exclusivo de Anthropic: un miembro sin modelo no se ejecuta en la API de Anthropic solo porque haya una clave de Anthropic configurada, y las configuraciones de equipo no tienen `modelRouting`.

**Esfuerzo.** Un miembro o especialista con esfuerzo propio lo conserva. Uno sin él hereda el nivel de la conversación que delegó el trabajo, así que una conversación **Profundo** envía a sus especialistas a *Máximo* — lo que cuesta más. Luego cada nivel se ajusta al modelo que responde, y cada respuesta registra qué se pidió y qué se ejecutó. Ver [Proveedores — Esfuerzo de razonamiento](/docs/es/ai/providers/#reasoning-effort).

## Memoria y herramientas en las ejecuciones de equipo

- Los especialistas, los agentes delegados y los miembros de equipo reciben el mismo bloque de memoria recordada que un turno de chat, adjunto a su tarea o encargo (ver [Memoria — Cómo llega el recuerdo al modelo](/docs/es/knowledge/memory/#how-recall-reaches-the-model)).
- El encargo de cada miembro también se recuerda, como texto escrito por un agente y no por ti.
- El capture de memoria duradera también se ejecuta en cada especialista, agente delegado y miembro de equipo, con los mismos ajustes `memory.capture.*` que un turno de chat. La tarea o el encargo se lee como una instrucción que puede haber escrito un agente: solo se conservan los hechos que dice sobre ti, el proyecto o el mundo, nunca los pasos de la propia tarea. Cada uno se ejecuta en su propia subconversación, así que tiene su propio techo `maxPerConversation`, y cada ejecución cuya instrucción tenga al menos `minUserChars` caracteres puede gastar una llamada extra al modelo en segundo plano. Ver [Memoria — El capture está encendido por defecto](/docs/es/knowledge/memory/#capture-is-on-by-default).
- A cada miembro se le ofrece la lista de **Herramientas** de su agente más las herramientas de memoria ([Crear y configurar — Herramientas](/docs/es/agents/configure/#tools--constraints)), con todos los proveedores.
- En una ejecución de equipo, cada miembro muestra en vivo la herramienta que está usando, sea cual sea su proveedor.

## Propuesta de equipo y replanificación

La propuesta de equipo la escribe el modelo de segundo plano de EYAS en una llamada aislada sin herramientas, en los niveles de planificación: **Rápido**, luego **Estándar**, luego el predeterminado de la instalación u otro proveedor capaz de ejecutar llamadas aisladas. Sin un modelo de segundo plano elegible — por ejemplo en una instalación cuyo único modelo es una Grok CLI o Kimi CLI que EYAS aún no ha verificado como capaz de ejecutar llamadas aisladas, o cuando el presupuesto de modelos se ha agotado — la tarjeta propone un único agente (el primer agente activado). Entre fases, el replanificador funciona igual: sin un modelo de segundo plano elegible, el equipo mantiene su plan actual. Ver [Enrutado y presupuesto — El modelo de segundo plano](/docs/es/ai/routing-budget/#background-model).

## Worktrees y verificación

| Comportamiento | Cuándo |
|----------------|--------|
| **Worktrees de git** | Dos o más especialistas que escriben en una sesión implícita, y propuestas de equipo para objetivos **complex** / **epic** — bajo `.eyas-worktrees/` |
| **Comandos de verificación** | Opcional `agent.verifyCommands` en YAML — ver [Configuración](/docs/es/deploy/configuration/) |

## En las conversaciones

Ver [Conversaciones](/docs/es/daily/conversations/):

- Árbol de subconversaciones
- Team Dashboard (hallazgos, decisiones, bloqueos)
- Tarjeta de propuesta de equipo: **Aceptar** / **Omitir**, y **Crear ahora** para los especialistas que faltan
- **Abrir &lt;nombre&gt;** en la fila de la herramienta cuando un colega toma el relevo

## Configuración

El asistente de configuración crea dos colegas principales. El paso opcional **Agentes de equipo** añade más colegas y especialistas. Los especialistas también salen de plantillas o de **Crear agente**. Cámbialos después en **Agentes**.

## Relacionado

- [Conversaciones](/docs/es/daily/conversations/)
- [Ejecuciones y Mission Control](/docs/es/agents/runs/)
- [Agentes — vista general](/docs/es/agents/overview/)
