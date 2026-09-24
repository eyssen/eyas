---
title: Ejecuciones y Mission Control
description: Supervisa ejecuciones de agentes en vivo — cancelar, reanudar, reintentar — y observa el tablero de operaciones.
---

**Para qué sirve.** **Ejecuciones de agentes** es la tabla de ejecuciones: en vivo y terminadas, con estado, verificación, turnos, tokens y acciones. **Mission Control** (en la barra lateral, **Centro de control**) es el tablero de operaciones en vivo con tarjetas de agentes — quién se está ejecutando, quién te espera, quién ha terminado. Usa la tabla para el historial y la recuperación; usa Mission Control para ver el ahora de un vistazo.

## Cuándo usarlo

- Una ejecución está bloqueada, llegó al límite de turnos o falló — quieres **Reanudar** (punto de control) o **Reintentar** (desde el objetivo).
- Algo se está ejecutando y necesitas **Cancelar** sin abrir la conversación.
- Quieres ver si el crítico de completitud marcó **Objetivo cumplido** / **Objetivo no cumplido**.
- Necesitas totales: en ejecución, esperando aprobación, completados hoy, coste de hoy.
- Quieres interrumpir una ejecución o abrir su conversación desde una tarjeta en vivo.

## Flujo típico

1. Abre **Ejecuciones de agentes** en la barra lateral (sección **IA**) — ruta `/agent-runs`. O **Centro de control** en **Monitorización** — ruta `/mission-control`.
2. En Ejecuciones de agentes, revisa **Estado** y **Verificación**. En una fila activa, **Cancelar**; en una fila fallida, bloqueada, cancelada o con límite de turnos, **Reanudar** o **Reintentar**.
3. En Mission Control, lee la franja de totales y actúa sobre una tarjeta (**Interrumpir**, **Abrir conversación**).
4. La fila o la tarjeta cambian de estado en vivo (WebSocket). Al abrir la conversación ves el progreso, el árbol de ejecución y las llamadas a herramientas de esa misma ejecución.

## Ejecuciones de agentes

**Ruta:** `/agent-runs`. Subtítulo: *Supervisión en vivo de las ejecuciones de agentes: las ejecuciones bloqueadas se detectan y se pueden cancelar.* Vacío: *Aún no hay ejecuciones de agentes.*

| Columna | Significado |
|---------|-------------|
| **Estado** | Ver los estados abajo |
| **Verificación** | Crítico de completitud: **Objetivo cumplido** / **Objetivo no cumplido** / **Sin verificar** (o — si nunca se comprobó) |
| **Agente** | Id del agente |
| **Tipo** | Tipo de ejecución (o —) |
| **Turnos** | Turnos usados |
| **Tokens** | Tokens usados |
| **Último avance** | Tiempo desde la última señal de vida |
| **Acciones** | **Cancelar** (en ejecución, bloqueada, actualizando) · **Reanudar** · **Reintentar** (fallida, bloqueada, cancelada, límite de turnos) |

### Estados

| Estado | Significado |
|--------|-------------|
| **En ejecución** | En curso |
| **Bloqueada** | Sin avance — se puede cancelar / reintentar |
| **Actualizando** | Reanudación en caliente en curso |
| **Esperando aprobación** | Aparcada a la espera de una aprobación de autonomía |
| **Completada** | Terminada |
| **Límite de turnos** | Alcanzó el presupuesto de turnos sin terminar — reanuda o reintenta |
| **Fallida** | Error |
| **Cancelada** | Detenida |

### Verificación

| Distintivo | Significado |
|------------|-------------|
| **Objetivo cumplido** | Un modelo revisor comparó el resultado con el objetivo y lo consideró cumplido |
| **Objetivo no cumplido** | El objetivo no se cumplió; las carencias se devolvieron al agente una vez |
| **Sin verificar** | No se pudo comprobar (no hay modelo revisor, o no se registró nada) |

**Sin verificar** también aparece cuando ningún modelo de segundo plano pudo hacer la comprobación (por ejemplo en una instalación solo con Grok cuyo aislamiento aún no está verificado), cuando el presupuesto de modelos está detenido o cuando fallaron todos los intentos; la ejecución en sí termina con normalidad.

**Qué pruebas acepta el crítico.** Cuando el objetivo de una ejecución necesita fuentes (investigar, consultar, citar, implementar, corregir, refactorizar…), el crítico busca fundamento, y juzga a todos los modelos por igual:

- **La memoria que EYAS entregó a la ejecución cuenta como prueba**, sea cual sea el proveedor o modelo que la ejecutó. Al modelo revisor se le indica qué elementos de memoria se entregaron y juzga si la respuesta está fundamentada.
- **Las pruebas de herramientas salen del registro de ejecución de herramientas de EYAS**, no solo de los nombres que informa el proveedor, así que un `memory_search` hecho por el puente de Claude Code o de Grok/Kimi cuenta igual que una llamada nativa.
- `memory_expand` también cuenta como prueba de recuperación.

Una ejecución sin memoria entregada, sin llamada a una herramienta de recuperación y sin cita `[source:…]` se marca como **Objetivo no cumplido** cuando su objetivo necesita fuentes. El crítico de completitud, y el plan de evaluación que se escribe para objetivos complejos en segundo plano, se ejecutan como una única llamada breve y aislada en el modelo de segundo plano de EYAS — sin herramientas y sin historial de conversación (ver [Enrutado y presupuesto — El modelo de segundo plano](/docs/es/ai/routing-budget/#background-model)). Sin ese modelo no se escribe ningún plan de evaluación.

### Reanudar y Reintentar con todos los proveedores

**Reanudar** continúa desde el último punto de control (protección de no repetición). **Reintentar** vuelve a planificar desde el objetivo; las llamadas destructivas ya ejecutadas siguen protegidas. Ambos funcionan igual para ejecuciones en Claude Code, Grok CLI y Kimi CLI que para proveedores de API:

- EYAS registra las herramientas que una CLI ejecutó por su cuenta (comandos de shell, escrituras y ediciones de archivos, herramientas de EYAS que llamó) en el historial de la ejecución y en su registro de ejecución de herramientas, con los nombres que usa EYAS (Bash aparece como `run_command`, y así sucesivamente).
- Tras un turno en el que la CLI ejecutó herramientas, y siempre que una ejecución se detiene a esperar una aprobación, EYAS guarda un punto de control: la conversación hasta ese momento más lo que respondió el modelo.
- Reanudar o Reintentar continúa desde ese punto de control, y el modelo recibe un resumen de las herramientas ya ejecutadas.
- Si el modelo intenta repetir una llamada destructiva que la ejecución original ya completó con éxito, EYAS la rechaza antes de que la CLI la ejecute: *already executed on the original run — duplicate side effect prevented*. La misma llamada con otros argumentos, o una llamada que falló la primera vez, se permite. También cubre las ediciones y los movimientos de archivos hechos por una CLI.
- La misma protección cubre las herramientas de EYAS que Grok y Kimi llaman por el puente de herramientas: una ejecución reanudada o reintentada que repite una llamada a herramienta de EYAS que la ejecución original ya completó (por ejemplo, enviar el mismo correo o la misma factura) se rechaza antes de ejecutarse, y la fila de la herramienta muestra **Omitido** con ese motivo. La misma herramienta con otros argumentos sigue ejecutándose. Demostrado en el Grok CLI instalado; cómo informa de estas llamadas un binario real de Kimi aún no se ha verificado en un equipo.
- En una ejecución en segundo plano en Grok o Kimi, una llamada a herramienta de EYAS de una categoría en **Aviso** o **Aprobar**, o una que la puerta de seguridad escala (incluso en **Auto**), espera aprobación; la ejecución supervisada se pausa como **Esperando aprobación** cuando termina el turno de la CLI, y aprobarla deja que exactamente esa llamada se ejecute una vez. Ver [Autonomía](/docs/es/agents/autonomy/).

### Cómo termina una ejecución

- Una ejecución que alcanza su límite de turnos termina con normalidad con el estado **Límite de turnos**, y se conserva la respuesta parcial.
- Una ejecución que agota su presupuesto de llamadas a herramientas también termina con normalidad; su estado sigue siendo **Completada**.
- Una parada del propio modelo por límite de turnos, longitud o negativa es un resultado, no un error.
- Una llamada a herramienta que nunca se ejecutó no se presenta como un éxito. El motivo es uno de: omitida por el límite por turno, omitida por el presupuesto de herramientas de la ejecución, omitida como duplicado al reanudar, rechazada por la puerta de seguridad o esperando aprobación. El chat muestra cada uno como su propio estado en la fila de la herramienta, un distintivo bajo la respuesta indica cómo terminó el turno, y una llamada que espera aprobación abre una tarjeta de aprobación en la conversación y una entrada en la cola de [Aprobaciones](/docs/es/agents/autonomy/) — ver [Conversaciones — Resultado del turno](/docs/es/daily/conversations/#turn-outcome).
- Cuando una ejecución termina con una respuesta, el capture de memoria duradera se ejecuta sobre ella — en ejecuciones en segundo plano, de especialista, delegadas, de pipeline, de A2A y de miembros de equipo igual que en los turnos de chat, con los mismos ajustes `memory.capture.*`. Una ejecución que no respondió nada no escribe ninguna fila de capture, y el libro mayor de captures registra de qué camino vino cada fila (`entry_path`). Ver [Memoria — El capture está encendido por defecto](/docs/es/knowledge/memory/#capture-is-on-by-default).

## Mission Control

**Ruta:** `/mission-control`. Subtítulo: *Vista en vivo de todos los agentes en ejecución.* Vacío: *No hay agentes en ejecución.* Aviso **Desconectado — reconectando…** cuando el socket está caído.

### Totales

| Métrica | Significado |
|---------|-------------|
| **En ejecución** | Activas ahora |
| **Esperando aprobación** | Te esperan |
| **Completados hoy** | Rendimiento de hoy |
| **Coste de hoy** | Gasto de hoy |

Las tarjetas se ordenan primero las que esperan aprobación, luego en ejecución, pausadas, inactivas, fallidas, completadas y canceladas; dentro de un estado, la actualizada más recientemente primero.

| Elemento de la tarjeta | Significado |
|------------------------|-------------|
| Estado | **Inactivo · En ejecución · Esperando aprobación · Pausado · Completado · Fallido · Cancelado** |
| **Turno / Tokens / Coste** | Consumo |
| ↳ *padre* | Otra ejecución lanzó esta |
| *N aprobación(es) pendiente(s)* | Cola de esta sesión |
| **Interrumpir** | Detiene la ejecución tras una confirmación (*¿Interrumpir este agente?*). Solo mientras se ejecuta, y solo para el usuario que la inició o un owner o admin |
| **Abrir conversación** | Ir al hilo |

La tarjeta no tiene control de pausa ni de reanudación. Para continuar una ejecución detenida, usa **Reanudar** o **Reintentar** en Ejecuciones de agentes.

## Dentro de una conversación

Mientras hay una ejecución activa también ves:

- Progreso del agente (*Paso N / Max* cuando el proveedor informa pasos; si no, *Llamadas a herramientas: N*; tokens sumados de la ejecución; Cancelar)
- Árbol de ejecución / flujo — con todos los proveedores, con estado y el coste de la ejecución
- Llamadas a herramientas desplegables, distintivos del resultado del turno y tarjetas de aprobación

Documentado en [Conversaciones](/docs/es/daily/conversations/).

Una ejecución trabaja en las carpetas de trabajo de su conversación. Una conversación sin carpetas propias tiene su propio espacio de trabajo de EYAS, que recibe al crearse o, en conversaciones antiguas, con el siguiente mensaje — una ejecución nunca elige una carpeta por su cuenta. Ver [Conversaciones — Carpetas](/docs/es/daily/conversations/#working-folders).

## Relacionado

- [Conversaciones](/docs/es/daily/conversations/)
- [Inicio — En ejecución ahora](/docs/es/daily/home/)
- [Autonomía](/docs/es/agents/autonomy/)
