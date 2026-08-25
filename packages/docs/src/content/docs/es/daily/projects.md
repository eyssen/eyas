---
title: Proyectos
description: Tipos, proyectos, etapas — campos y fuentes de código por defecto.
---

**Ruta:** `/projects`.

## Project

| Campo | Obligatorio | Significado |
|-------|-------------|-------------|
| **Name** | Sí | Nombre visible |
| **Type** | Sí | Tipo de proyecto |
| **Description** | No | Descripción corta |
| **Color** | No | Color |
| **Default Agent** | Sí | Agente de nuevas conversaciones |
| **Prompt** | No | System prompt extra |
| **Prompt coach** | — | Coach IA del brief del proyecto — [Prompts](/docs/es/ai/prompts/) |
| **Fuentes de código por defecto** | No | Multi-select de [Search Sources](/docs/es/daily/search/). Se aplica a **nuevas conversaciones** del proyecto y al **asignar** este proyecto a una conversación |
| Badge **N fuentes** | — | Cuántas fuentes por defecto hay |

Flujo: registrar checkouts en Search Sources → Reindex → marcar defaults en el proyecto → pestaña **Fuentes** de la conversación.

## Type

Name, Default Priority, Icon, Prompt, **Prompt coach**, Color.

## Stage

Name, Closed, Folded, Bot, Auto-assign (None o agente). Drag para reordenar.

## Relacionado

[Tablero](/docs/es/daily/board/) · [Conversaciones](/docs/es/daily/conversations/) · [Búsqueda](/docs/es/daily/search/)
