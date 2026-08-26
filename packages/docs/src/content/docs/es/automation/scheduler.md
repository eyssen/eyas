---
title: Programador
description: Jobs, triggers, vistas, health.
---

**Ruta:** `/scheduler`. Vistas List / Gantt / Calendar (zoom Day/Week/Month).

## Crear job

Name · Handler · Trigger Cron/Interval/Event · cron/interval ms/event name · Agent ID · Prompt · Create.

Una expresión cron no válida o un intervalo inferior a un segundo se rechaza al pulsar **Create**, con el motivo mostrado en el formulario: *«Esa programación no es válida, la tarea nunca se ejecutaría. Revisa la expresión cron o el intervalo.»* Antes, esa tarea se creaba pero nunca se ejecutaba, sin aviso. Un disparador **Event** se sigue aceptando, pero esa tarea no puede iniciarse sola — queda marcada como **Nunca se dispara**.

## Acciones

Run Now · Pause/Resume · Reschedule · Delete · Show infrastructure jobs.

**Run Now** solo se deshabilita cuando la tarea no tiene handler registrado, o está deshabilitada/en dead-letter, con el motivo en el tooltip; una tarea marcada como **Nunca se dispara** o **Sin programar** sí puede ejecutarse así — en una tarea Event es la única forma de que llegue a ejecutarse. **Reschedule** → **Apply** rechaza una expresión cron no válida o un intervalo inferior a un segundo, y el motivo aparece bajo el campo. Una etiqueta en la fila (**Sin handler** / **Nunca se dispara** / **Sin programar**) indica por qué una tarea no puede ejecutarse: sin handler registrado (su módulo probablemente está desactivado), un tipo de disparador que no se dispara solo (Event), o una programación que no se pudo activar (cron no válido o intervalo inferior a un segundo) — pasa el cursor por encima para ver el motivo. **Show infrastructure jobs** nunca oculta una tarea que no puede ejecutarse — una tarea de sistema rota sigue visible aunque el filtro esté desactivado.

## Ejecuciones recientes

Lista de ejecuciones pasadas: cada fila muestra la hora de inicio, la duración y quién la disparó (`system` cuando la disparó un temporizador, un agente, o un id de usuario).

## Kinds

System handler · Agent routine.

## Health

Leader/Follower · active · running · failed 24h · dead-letter · overdue · **N no pueden ejecutarse** (tareas que no se ejecutarán tal como están configuradas).
