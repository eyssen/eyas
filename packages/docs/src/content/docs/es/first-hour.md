---
title: Tu primera hora
description: Primera hora guiada en la UI en marcha — Inicio, una conversación, una tarjeta del tablero y dónde vive la memoria.
---

**Para qué sirve.** La instalación y el [asistente](/docs/es/setup-wizard/) ya están hechos. Esta hora recorre el producto en vivo para que sepas dónde empieza el trabajo, dónde se sigue y cómo se quedan los hechos. No es una lista de campos.

## Cuándo usarlo

- Puedes iniciar sesión y la app principal está abierta
- Quieres una conversación útil, no un tour de cada pantalla
- Necesitas ver cómo encajan **Inicio**, **Tablero**, **Memoria** y **Agentes**

## Inicia sesión y aterriza en Inicio

Abre la UI (por defecto **http://localhost:3100**). Introduce el **Usuario** y la **Contraseña** del owner raíz que creaste en el asistente y pulsa **Iniciar sesión**.

Aterrizas en **Inicio** (`/`). Todo el mundo parte de la misma cuadrícula de fábrica hasta que la personalizas.

Mira primero tres mosaicos:

- **Pulso** — te necesita, en curso, en espera, coste hoy, trabajos fallidos
- **Requiere atención** — aprobaciones, trabajo atascado, agentes en espera, vencidos; puedes actuar desde el mosaico
- **Agentes en ejecución** — actividad en vivo; **Pausar**, **Reanudar** o **Detener**

Puede haber una franja de configuración recomendada encima de la cuadrícula. Ignórala esta hora.

## Empieza una conversación

En la barra lateral, pulsa **Nueva conversación**. El estado vacío dice **Inicia una conversación…**.

Escribe una petición que te sirva de verdad — cómo quieres que trabajen contigo, una decisión o una tarea que quieras seguir. El compositor: **Escribe un mensaje… (Shift+Enter para nueva línea)**. Envíalo.

Observa el stream: **Pensando** o **Pensando…**, luego **Redactando respuesta…** o **Ejecutando herramientas…**. Las filas de herramientas muestran id, args cortos y el resultado — las ediciones de archivo abren un **Diff**. **Detener** cancela la ejecución. El icono de mapa del compositor es **Plan primero**.

Deja el hilo abierto. A continuación va al tablero.

## Ponlo en el Tablero

Abre **Tablero** en la barra lateral (`/board`). Las conversaciones son tarjetas. La tuya suele estar ya ahí, con el título del hilo (o **Sin título**).

- Fíjala para que quede en la tira de pines (**Fijado**).
- O pulsa **Nuevo**, escribe un **Título de la conversación…** y crea una tarjeta ligada a un hilo.

Ahora tienes un sitio para hablar y un sitio para seguir el mismo trabajo.

## Dónde vive la memoria

Abre **Memoria** (`/memory`). Empieza por **Resumen** y luego **Archivos del vault**.

Desde 0.8.16-beta, un hecho duradero que enuncies en cualquier conversación puede convertirse en una nota del vault **sin que lo pidas**. La captura es global y está activada por defecto. Corre después de entregar la respuesta — nunca en el camino crítico de la respuesta. Los turnos cortos y la charla suelen no escribir nada; eso es correcto.

Puede que no veas un archivo nuevo en el primer minuto. Vuelve a **Archivos del vault** tras un intercambio más largo y denso en hechos, o escribe una nota a mano. Los agentes siguen pudiendo guardar memoria a propósito.

## Conoce a tus agentes primarios

Abre **Agentes** (`/agents`). Filtra **Principal**. Son los dos compañeros que nombraste en el asistente: el **Asistente personal** (el día a día) y el **Ingeniero de sistema** (el propio EYAS). Ellos se quedan; las conversaciones van y vienen.

No hace falta crear más agentes esta hora.

## Qué aprender después

- [Conversaciones](/docs/es/daily/conversations/) — compositor, rieles, esfuerzo, orquestación
- [Tablero](/docs/es/daily/board/) — tarjetas, etapas, vistas
- [Resumen de agentes](/docs/es/agents/overview/) — niveles, tipos, lista
- [Memoria](/docs/es/knowledge/memory/) — cinco niveles y notas del vault
- [Skills](/docs/es/automation/skills/) — procedimientos reutilizables que los agentes pueden cargar
- [Herramientas](/docs/es/automation/tools/) — catálogo en vivo; busca `browser_` para Playwright headless
- [Browser Use](/docs/es/automation/browser-use/) — público vs Chrome con sesión vs Manos
- [Conceptos básicos](/docs/es/concepts/) — el modelo mental, cuando ya hayas clicado un rato
