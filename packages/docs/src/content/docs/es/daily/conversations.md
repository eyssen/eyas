---
title: Conversaciones
description: Chat — campos, stream, riel de contexto y Prompt Enhancer.
---

## Estado

Idle · Working · Waiting · Waiting approval · Archived.

## Header / prioridad

Provider, Model, Auto-routing. Priority Low–Urgent.

## Campos

**Project** (al cambiarlo se reaplica el pin de fuentes por defecto del proyecto), Stage, Agent (**bloqueado tras el 1er mensaje**), Effort Off–Max, Orchestration Solo/Auto/Deep. Último elemento: **Modo Dios** — véase [Modo Dios](#modo-dios).

## Stream

Thinking, Stop, tools, Turn N/Max, tokens, Cancel, complexity, Voice scope INTERNAL/EXTERNAL/AUTO.

## Composer

Mensaje, adjunto, **Prompt Enhancer**.

### Prompt Enhancer

Coach iterativo que adapta el prompt a la **familia de modelo** del hilo (Claude, OpenAI, Gemini, Grok, Kimi, …).

| Control | Significado |
|---------|-------------|
| Borrador / objetivo | Describe o pega un draft |
| **Optimized for …** | Familia de modelo objetivo |
| Chips de tipo de tarea | **General · Coding · Research · Analysis · Writing · Agentic · Files / vision** |
| **Quality N/10** | Puntuación; **Gaps** = checklist incompleta |
| **Propose two alternatives** | Concise / Thorough / Recommended |
| **Suggested final prompt** · **carry N files** · **Apply** | Insertar en el composer |

Para prompts **duraderos** de proyecto/agente: [Prompt Coach](/docs/es/ai/prompts/).

## Riel (chatter)

Pestañas: **Historial · Fuentes · Siguiente · Archivos**

| Área | Contenido |
|------|-----------|
| **Historial** | Notas / cambios, filtros |
| **Fuentes** | Multi-checkbox de Search Sources (versiones Odoo, etc.). Hereda el default del proyecto al crear o asignar proyecto. Detalle: [Búsqueda](/docs/es/daily/search/) |
| **Siguiente** | Activities |
| **Archivos** | Adjuntos |
| **Runtime** | Meta de ejecución (aparte del historial) |

## Team

Sub-conversaciones, Team Dashboard, proposal Approve/Skip, run tree.

## Modo Dios

El Modo Dios hace competir a **varios modelos** en la misma tarea y compara los resultados. No es un cuarto estilo de orquestación: Solo / Auto / Deep siguen describiendo cómo cada trabajador descompone el trabajo. El Modo Dios solo decide que varios modelos compiten (no un equipo de especialistas). Se pueden combinar: Modo Dios + Deep significa que cada modelo competidor puede descomponer el trabajo por su cuenta.

**No hay fusión automática.** Gana un espacio de trabajo; las ideas únicas de los demás se listan para que las apliques tú.

| Tema | Significado |
|------|-------------|
| **Plantilla** | **Ajustes → Modo Dios** (tarjeta bajo las asignaciones de modelo). Elige 2–5 pares proveedor/modelo activos. Un número par exige un presidente de desempate. |
| **Menú** | Último elemento del control **Orchestration** (tras un separador): Solo, Auto, Deep y **Modo Dios**. Activarlo **no cambia** Solo/Auto/Deep (los trabajadores heredan ese estilo). Elegir Solo/Auto/Deep desactiva el Modo Dios. |
| **Coste** | El primer envío tras activarlo pide confirmación (plantilla, estimación, tope). Los envíos posteriores solo muestran un banner. Si la estimación supera el tope, el envío se bloquea hasta que subas el tope o desactives el Modo Dios. |
| **Carpetas** | Los trabajadores corren en copias aisladas de las carpetas de trabajo (worktree git si es posible). Sin carpetas, la ejecución arranca igual, sin aislamiento de archivos. |
| **Ganador + ideas** | Solo los archivos cambiados del ganador llegan a las carpetas de la conversación. Las ideas únicas de los demás aparecen en la pestaña **God** — las aplicas tú; no hay fusión automática. |

### Plantilla en Ajustes

En [Ajustes](/docs/es/admin/settings/), bajo las asignaciones de modelo, la tarjeta **Modo Dios** es la plantilla global que usa cada conversación en Modo Dios.

| Campo | Significado |
|-------|-------------|
| **Modelos** | 2–5 pares proveedor/modelo activos. No se permiten duplicados. |
| **Presidente de desempate** | Uno de esos modelos. **Obligatorio si el número es par**; recomendado siempre (un trabajador fallido puede dejar un resto par). El presidente es un competidor, no un juez aparte. |
| **Tope de coste (USD)** | Opcional. Si la estimación previa supera el tope, la ejecución no arranca. Si el gasto lo cruza a mitad de carrera, se cancelan los trabajadores inacabados y se decide entre quienes terminaron. |
| **Conservar carpetas (horas)** | Los árboles aislados se borran pasadas estas horas (por defecto 72). |

Guardar la plantilla no reescribe ejecuciones ya arrancadas: cada envío toma una instantánea.

La franja proveedor/modelo de la conversación se ignora en un envío Modo Dios — corre la plantilla de Ajustes.

### Activar el Modo Dios

1. Abre el menú **Orchestration** de la conversación y elige **Modo Dios**.
2. Envía un mensaje. El primer envío pide confirmación de coste (quién corre, USD estimado, tope). Confirma para arrancar.
3. Mientras está activo, queda un banner **Modo Dios**. En el riel derecho aparece la pestaña **God**.
4. **Stop** cancela toda la carrera, no solo un trabajador.

### Aislamiento y ganador

Cada trabajador tiene su propia carpeta (worktree git si el directorio de trabajo es un repo; si no, una copia). Mientras trabajan no ven los archivos de los demás.

Al elegir ganador, **solo sus archivos cambiados** se copian a las carpetas de la conversación. Los de los demás quedan en sus árboles hasta la retención. Sin carpetas de trabajo no hay nada que promocionar; el ganador se elige igual a partir de las respuestas escritas.

### La pestaña God

La pestaña **God** del riel aparece mientras el Modo Dios está activo, **o** cuando la conversación ya tiene al menos una ejecución (sigue visible si luego lo desactivas).

#### Cabecera

Fase actual, más tokens, USD y duración totales.

| Fase | Significado |
|------|-------------|
| **Preparando** | Instantánea de la plantilla, carpetas aisladas |
| **Carrera** | Los trabajadores ejecutan el mismo mensaje en paralelo |
| **Revisión** | Los que terminaron se puntúan y votan |
| **Decisión** | Ganador registrado |
| **Promoción** | Archivos del ganador a las carpetas de la conversación |
| **Completado / Fallido / Cancelado** | Estado final |

Un trabajador fallido también muestra el error del proveedor (por ejemplo una API saturada).

#### Pasos

Registro con marca de tiempo de lo que ocurrió:

| Paso | Significado |
|------|-------------|
| Ejecución iniciada | Carrera creada con la plantilla actual |
| Workers en paralelo | Cada modelo activo empieza la misma tarea |
| *Modelo* terminó / falló | Acabó el intento propio de ese trabajador |
| Revisión cruzada | Los supervivientes leen los resúmenes y votan |
| Ganador: *modelo* | Decisión registrada |
| Promoviendo el espacio del ganador | Archivos a las carpetas de la conversación |
| Ejecución completada / fallida / cancelada | Estado final |

Las ejecuciones anteriores a este registro muestran una línea de tiempo reconstruida a partir de las horas de fin.

#### Cómo se eligió al ganador

Este bloque indica la regla aplicada, el recuento de votos y **quién votó a quién**.

| Regla | Cuándo |
|-------|--------|
| **Mayoría** | Un modelo recibió más votos válidos que cualquier otro. Un modelo **no puede votarse a sí mismo**; esos votos se descartan. |
| **Empate — el desempate eligió** | Dos o más modelos empatados, y el presidente está entre ellos. |
| **Empate — el más rápido** | Empate y el presidente falta o no está entre los empatados. Gana el empatado que terminó primero. |
| **Solo uno terminó** | El resto falló o se canceló; el superviviente gana y no hay votación cruzada. |

Si falla una llamada de revisión, ese trabajador simplemente no tiene voto. La decisión sigue con quien sí votó.

#### Lo que dijeron del trabajo de los demás

Tras la carrera, los supervivientes hacen **una** revisión cruzada estructurada (no un debate en vivo). Por cada revisor, sin clics extra:

- a quién votaron
- puntuaciones 1–5: **calidad**, **completitud**, **riesgo**
- su comentario escrito sobre el trabajo de los demás
- ideas únicas que, según ellos, los demás no vieron
- riesgos señalados

Despliega la tarjeta de un modelo para ver **su propio** trabajo (el que produjo antes de revisar) y cualquier error.

#### Ideas únicas

Lista deduplicada de ideas de los **no ganadores** que no aparecen ya en la lista del ganador. Si las quieres en el espacio promocionado, las aplicas tú — no hay fusión automática.

### Subconversaciones

Cada trabajador es una conversación hija con título `God <modelo>`. Pueden aparecer en la lista como subconversaciones. El Modo Dios está **apagado** en ellas para que no arranquen otra carrera.

Comparación global (tasa de victorias por modelo, múltiplo medio de coste frente a un solo modelo): [Observabilidad](/docs/es/admin/observability/). Al pulsar una ejecución se abre la pestaña God de esa conversación.

## Relacionado

[Búsqueda — pin multi-versión](/docs/es/daily/search/) · [Proyectos](/docs/es/daily/projects/) · [Agentes](/docs/es/agents/overview/) · [Tablero](/docs/es/daily/board/) · [Observabilidad — pestaña God Mode](/docs/es/admin/observability/)
