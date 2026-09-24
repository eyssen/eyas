---
title: Programador
description: Trabajos recurrentes, rutinas de agentes, calendario y Gantt, y trabajos que no pueden ejecutarse.
---

**Para qué sirve.** El programador es el reloj: handlers del sistema recurrentes (copia de seguridad, mantenimiento) y rutinas de agentes (un agente con un prompt en un cron). Creas trabajos, ves cuándo se ejecutaron por última vez y detectas los que nunca se dispararán. No es el Tablero — el Tablero sigue elementos de trabajo; esta página sigue temporizadores.

**Ruta:** `/scheduler`. Título: **Programación**. Subtítulo: *Trabajos recurrentes, rutinas de agentes e historial de ejecuciones.* Barra lateral: **Programador**.

## Cuándo usarlo

- Quieres que un agente ejecute un prompt cada mañana sin abrir una conversación.
- Una copia de seguridad u otro handler del sistema debe dispararse en un cron, y necesitas ver la última/próxima ejecución.
- Un trabajo está parado y necesitas la insignia **Sin handler / Nunca se dispara / Sin programar**, no un fallo silencioso.
- Una rutina debe razonar más a fondo (o más barato) de lo que suele hacerlo su agente — fija su **Esfuerzo**.
- Estás revisando el liderazgo del clúster, los trabajos atrasados o el dead-letter en una instalación con varias instancias.

## Flujo típico

1. Abre **Programador** en la barra lateral (`/scheduler`).
2. Elige **Lista**, **Gantt** o **Calendario**. En las vistas de línea de tiempo usa el zoom **Día / Semana / Mes**.
3. **Crear trabajo** — elige **Handler del sistema** o **Rutina de agente**, rellena **Nombre** y **Programación (cron)**, después el **Handler**, o en una rutina de agente el **ID del agente**, el **Prompt** y opcionalmente el **Esfuerzo** — y pulsa **Crear**.
4. Vigila la franja de salud. Una insignia de **no puede ejecutarse** significa que el trabajo no se ejecutará tal como está configurado; pasa el ratón por encima para ver la causa.
5. **Ejecutar ahora** lo dispara de inmediato (la única forma de que se ejecute un trabajo de Evento). **Pausar / Reanudar** cambian el trabajo en vivo; haz clic en un trabajo para **Reprogramar** o cambiar su **Esfuerzo**.

## Funciones

Tres vistas comparten los mismos trabajos: una tabla, un Gantt de barras pasadas/próximas y un calendario. **Mostrar trabajos de infraestructura** incluye los trabajos internos de infraestructura, pero nunca oculta un trabajo que no puede ejecutarse — un trabajo de sistema roto sigue visible aunque el filtro esté desactivado.

**Programaciones.** Un trabajo se dispara con una expresión cron, un intervalo fijo o un evento del bus. El formulario acepta una expresión cron o uno de los atajos `hourly`, `daily` (09:00), `weekdays` (de lunes a viernes a las 09:00), `weekly` (lunes 09:00) y `monthly` (el día 1, 09:00). Un disparador de intervalo o de evento se fija por la API o con la herramienta `schedule_create`; **Reprogramar** convierte un trabajo en uno de intervalo si introduces un número entero de milisegundos. El icono de la fila muestra el tipo de disparador.

<h3 id="agent-routines-run-in-a-conversation">Las rutinas de agente se ejecutan en una conversación</h3>

Cada ejecución de una rutina de agente (tipo **Rutina de agente**, o un trabajo creado con la herramienta `schedule_create`) crea una conversación y ejecuta en ella el agente elegido como una ejecución supervisada y autónoma en segundo plano — el mismo ejecutor que usan las tarjetas del tablero y los reintentos: el modelo propio del agente, el recall completo de la memoria de EYAS a partir del prompt del trabajo, diseños adjuntos, documentos, captura de memoria duradera y el crítico de completitud. Las herramientas sensibles pasan por la escala de [autonomía](/docs/es/agents/autonomy/).

- La conversación pertenece al usuario que creó el trabajo; si lo creó un agente o el sistema, al propietario. Su título es el nombre del trabajo, o *Scheduled: &lt;prompt&gt;*.
- **Ejecuciones recientes**, en el panel de detalle del trabajo, muestra un enlace **Abrir conversación** para cada ejecución, también las fallidas.
- Una ejecución que no puede arrancar hace fallar esa ejecución con un motivo que empieza por un código: `agent_unavailable` (el agente falta o está desactivado), `over_budget`, `invalid_config`, `conversation_busy`, `conversation_forbidden`, `runner_unavailable`, `owner_unavailable`. Los fallos cuentan para el límite de fallos consecutivos / dead-letter del trabajo.
- **Esfuerzo.** Una rutina de agente puede tener su propio **Esfuerzo** (ver [Crear trabajo](#create-job)). Cada ejecución escribe el esfuerzo del trabajo en su conversación, así que el chip de esfuerzo de la respuesta muestra el nivel del trabajo con origen *conversación*. Un trabajo en **Automático** no escribe nada: la ejecución toma el esfuerzo del agente (origen *colega*) o, si no lo tiene, el predeterminado del modelo. El nivel se ajusta al modelo en el que acaba la ejecución.

**Nota de actualización.** Las rutinas de agente creadas cuando las ejecuciones programadas de agentes aún no funcionaban fallaban en cada ejecución. Tras la actualización empiezan a ejecutarse — y a gastar tokens — en su siguiente disparo. Revísalas o páusalas antes.

**Avanzado (solo API).** Un `handlerConfig` con `conversationPolicy: 'reuse'` y un `conversationId` vuelve a ejecutar el trabajo en esa conversación, con el nuevo prompt como objetivo; la conversación debe pertenecer al mismo usuario y no estar en ejecución. Con `reuse`, el trabajo fija el esfuerzo de esa conversación en cada ejecución; con Automático, se borra un nivel que quedara en ella a mano o de una ejecución anterior. Crear o editar una rutina de agente cuyo `handlerConfig` no tiene `agentId` o `prompt`, no es JSON válido o lleva un `effort` no válido se rechaza con `400`. `effort` es `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, o `auto`/null (el esfuerzo del agente). El creador del trabajo es siempre el usuario con sesión iniciada; un `createdBy` en el cuerpo de la petición se ignora.

Una expresión cron no válida o un intervalo de menos de un segundo se rechazan — al pulsar **Crear**, al **Reprogramar** y por la API — con el motivo en el formulario: *«Esa programación no es válida, la tarea nunca se ejecutaría. Revisa la expresión cron o el intervalo.»* Un disparador de **Evento** se acepta, pero ese trabajo aún no puede dispararse solo — recibe la insignia **Nunca se dispara**.

## Campos y controles

<h2 id="views">Vistas</h2>

| Vista | Significado |
|-------|-------------|
| **Lista** | Tabla de trabajos |
| **Gantt** | Barras en la línea de tiempo |
| **Calendario** | Vista de calendario |
| Zoom **Día / Semana / Mes** | Escala del Gantt/calendario |

<h2 id="create-job">Crear trabajo</h2>

**Crear trabajo** abre el formulario **Nuevo trabajo programado**:

| Campo | Significado |
|-------|-------------|
| **Handler del sistema** / **Rutina de agente** | El tipo de trabajo |
| **Nombre** | Nombre visible; las conversaciones de ejecución de una rutina de agente llevan este título |
| **Programación (cron)** | Expresión cron o atajo (`hourly`, `daily`, `weekdays`, `weekly`, `monthly`); por defecto `0 9 * * *` |
| **Handler** | Solo handlers del sistema: elige un handler registrado con **Seleccionar handler…** |
| **ID del agente** | Solo rutinas de agente: el agente que se ejecuta |
| **Prompt** | Solo rutinas de agente: lo que debe hacer el agente — se convierte en el objetivo de la ejecución y en su consulta de recall de memoria |
| **Esfuerzo** | Opcional, solo rutinas de agente. El mismo selector de **Esfuerzo** que en las conversaciones; aparece en cuanto **ID del agente** contiene el id de un agente existente y activado, y lista solo los niveles que ofrece el modelo de ese agente. **Automático** (por defecto) muestra lo que usará una ejecución — el esfuerzo propio del agente, p. ej. *Automático · Bajo (colega)*, si no, el predeterminado del modelo, p. ej. *Automático · predeterminado del modelo (Medio)*. Un nivel elegido hace que todas las ejecuciones del trabajo lo usen, ajustado al nivel más cercano que ofrezca el modelo |
| **Crear** / **Cancelar** | Guardar el trabajo / cerrar el formulario |

<h2 id="job-kinds">Tipos de trabajo</h2>

| Tipo | Significado |
|------|-------------|
| **Handler del sistema** | Handler integrado de mantenimiento/automatización |
| **Rutina de agente** | Ejecuta un agente con un prompt según una programación |

<h2 id="row-actions">Filas de trabajo y panel de detalle</h2>

| Control | Significado |
|---------|-------------|
| **Pausado / En ejecución** | Estado de activación del trabajo |
| **Insignia de no ejecutable** | En la fila como **Sin handler**, **Nunca se dispara** o **Sin programar** — ningún handler registrado (probablemente su módulo está desactivado), un tipo de disparador que nunca se dispara solo (Evento) o una programación que no se pudo armar (cron no válido o intervalo de menos de un segundo). Pasa el ratón por encima para ver la causa. |
| **Última: … / Próxima: …** | Última y próxima hora de disparo |
| **N ejecuciones / N fallos** | Contadores |
| **Agente:** &lt;nombre&gt; | El agente que ejecuta una rutina de agente |
| **Ejecutar ahora** | Disparar de inmediato; solo está desactivado si el trabajo no tiene handler registrado, o está desactivado/en dead-letter, con el motivo en la información sobre herramientas. Un trabajo con la insignia **Nunca se dispara** o **Sin programar** se puede ejecutar así — para un trabajo de Evento es la única forma de que se ejecute |
| **Pausar / Reanudar** | Alternar |
| **Eliminar** | Quitar el trabajo + historial (tras *¿Eliminar este trabajo y su historial?*) |
| **Reprogramar** + **Aplicar** (panel de detalle) | Una nueva expresión cron o atajo, o un número entero de milisegundos para un intervalo; una programación no válida se rechaza y el motivo aparece bajo el campo |
| **Esfuerzo** (panel de detalle) | Solo rutinas de agente. Un cambio se guarda al momento; si falla, aparece *Error al guardar* y no cambia nada |
| **Buscar…** | Filtrar la lista |
| **Todas las fuentes** / **Todos los estados** | Limitar la lista a una fuente o a un estado |
| **Mostrar trabajos de infraestructura** | Incluir los trabajos internos de infraestructura |
| **Mostrar solo los trabajos que no pueden ejecutarse** | Filtro de la franja de salud; **Mostrar todos los trabajos de nuevo** restaura tus filtros anteriores |

<h2 id="recent-executions">Ejecuciones recientes</h2>

**Ejecuciones recientes**, en el panel de detalle del trabajo, lista las ejecuciones pasadas — hora de inicio, duración y quién disparó cada una (*Activado por:* `system` cuando la disparó un temporizador, un agente o un id de usuario) y, en una rutina de agente, un enlace **Abrir conversación** a la conversación de la ejecución (también en las fallidas). Vacío: *Aún no hay ejecuciones.*

<h2 id="health">Franja de salud</h2>

| Métrica | Significado |
|---------|-------------|
| **Líder / Seguidor** | Liderazgo del clúster (varias instancias) |
| **N activos** | Trabajos activos |
| **N en curso** | En ejecución ahora |
| **N fallos (24h)** | Fallos del último día |
| **N dead-letter** | Reintentos agotados |
| **N atrasados** | Programación perdida |
| **N no pueden ejecutarse** | Trabajos que no se ejecutarán tal como están configurados |

<h2 id="legend">Leyenda (línea de tiempo)</h2>

pasado · en curso · próximo · futuro · ejecuciones · pendiente

## Relacionado

- [CLI / configuración](/docs/es/deploy/configuration/)
- [Agentes](/docs/es/agents/overview/)
- [Autonomía](/docs/es/agents/autonomy/)
- [Proveedores — Esfuerzo de razonamiento](/docs/es/ai/providers/#reasoning-effort)
- [Copia de seguridad](/docs/es/admin/backup/)
- [Inicio](/docs/es/daily/home/)
