---
title: Ejecuciones y Mission Control
description: Historial y en vivo.
---

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
