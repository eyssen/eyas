---
title: Ejecuciones y Mission Control
description: Supervisa ejecuciones en vivo — cancelar, reanudar, reintentar — y mira el tablero de ops.
---

**Para qué sirve.** **Ejecuciones de agentes** es la tabla de ejecuciones: vivas y terminadas, con estado, verificación, turnos, tokens y acciones. El **Centro de control** es el tablero de tarjetas en vivo. Usa la tabla para historial y recuperación; el Centro de control para el ahora.

## Cuándo usarlo

- Una ejecución está bloqueada, llegó al límite de turnos o falló — **Reanudar** (checkpoint) o **Reintentar** (desde el objetivo).
- Algo corre y necesitas cancelar sin abrir la conversación.
- Ver si el crítico marcó **Objetivo cumplido** / **Objetivo no cumplido**.
- Totales: en ejecución, esperando aprobación, completadas hoy, coste de hoy.
- Pausar, interrumpir o abrir la conversación desde una tarjeta en vivo.

## Flujo típico

1. Abre **Ejecuciones de agentes** en la barra lateral (**IA**) — ruta `/agent-runs`. O **Centro de control** bajo **Monitorización** — ruta `/mission-control`.
2. En Ejecuciones, mira **Estado** y **Verificación**. Activa: cancelar; **Fallida / Bloqueada / Cancelada / Límite de turnos**: **Reanudar** o **Reintentar**.
3. En el Centro de control, la tira de totales, luego en la tarjeta **Pausa / Reanudar / Interrumpir / Abrir conversación**.
4. La fila/tarjeta debe cambiar de estado en vivo. Abrir la conversación muestra el mismo run.

## Funciones

`/agent-runs` historial. `/mission-control` tarjetas en vivo. En conversación: progress y run tree.

## Cumplimiento de marca

Cuando una ejecución en segundo plano trabaja en un proyecto con marca y produce
algo a lo que una marca se aplica —una página renderizada, un borrador de correo,
un documento, un lienzo de diseño—, una comprobación contrasta el resultado con
la marca y devuelve al agente las desviaciones concretas una vez. «El titular usa
#ff0000; el primario de la marca es #1f4ed8» es el tipo de nota que da, no «hazlo
más bonito».

Solo se ejecuta después de que la comprobación de completitud haya pasado. A una
ejecución que no terminó su trabajo no se le habla de sus colores.

Es deliberadamente blanda. Nunca hace fallar una ejecución que no se pudo
comprobar —sin modelo, sin marca, sin nada con forma de marca en la salida—,
porque el trabajo ya está hecho. Donde la marca se aplica **con dureza** es en el
marco: la envoltura del correo, las plantillas de notificación y la herramienta
de HTML con marca construyen su estructura de forma determinista.

Comparte una única devolución por linaje de ejecución con la comprobación de
completitud. Desactívala con `agent.brandCriticEnabled: false`.
