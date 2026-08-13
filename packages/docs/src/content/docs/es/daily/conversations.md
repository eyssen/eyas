---
title: Conversaciones
description: Chat — campos, stream, riel de contexto y Prompt Enhancer.
---

## Estado

Idle · Working · Waiting · Waiting approval · Archived.

## Header / prioridad

Provider, Model, Auto-routing. Priority Low–Urgent.

## Campos

**Project** (al cambiarlo se reaplica el pin de fuentes por defecto del proyecto), Stage, Agent (**bloqueado tras el 1er mensaje**), Effort Off–Max, Orchestration Solo/Auto/Deep.

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

## Relacionado

[Búsqueda — pin multi-versión](/docs/es/daily/search/) · [Proyectos](/docs/es/daily/projects/) · [Agentes](/docs/es/agents/overview/) · [Tablero](/docs/es/daily/board/)
