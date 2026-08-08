---
title: Conversaciones
description: Chat — campos, stream, riel de contexto y Prompt Enhancer.
---

## Estado

Idle · Working · Waiting · Waiting approval · Archived.

## Header / prioridad

Provider, Model, Auto-routing. Priority Low–Urgent.

## Campos

Project, Stage, Agent (**bloqueado tras el 1er mensaje**), Effort Off–Max, Orchestration Solo/Auto/Deep.

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

Notas / cambios · Stage, Project, Priority, Status, Due · Activities · Files · Runtime · Next.

## Team

Sub-conversaciones, Team Dashboard, proposal Approve/Skip, run tree.

## Relacionado

[Agentes](/docs/es/agents/overview/) · [Tablero](/docs/es/daily/board/)
