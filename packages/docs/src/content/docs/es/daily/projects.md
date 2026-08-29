---
title: Proyectos
description: Agrupa conversaciones en tipos, proyectos y etapas compartidas — con agente y fuentes de código por defecto.
---

**Para qué sirve.** Los proyectos agrupan conversaciones. Un **tipo de proyecto** es la plantilla; un **proyecto** es la instancia (agente por defecto, prompt, fuentes de código); las **etapas** son las columnas kanban compartidas. Las tarjetas del Tablero y los campos **Project** / **Stage** del chat son esta estructura.

## Cuándo usarlo

- Un cuerpo de trabajo nuevo con su propio agente por defecto y (en Odoo) árboles de código por defecto.
- Un tipo reutilizable (prioridad, icono, prompt) para que los proyectos nuevos arranquen igual.
- Añadir, plegar o cerrar una etapa que verá cada tablero.
- Las conversaciones creadas en este proyecto deben heredar fuentes indexadas.
- Una etapa debe asignar un agente al entrar una tarjeta.

## Flujo típico

1. Abre **Ajustes → Proyectos** (barra lateral **Ajustes**, grupo **Módulos**) — ruta `/projects`.
2. Crea un **Project Type** si hace falta plantilla, luego **New Project** (nombre, tipo, agente por defecto, **Default code sources** opcional).
3. En **Stages**, añade u ordena columnas (**Closed**, **Folded**, **Bot**, **Auto-assign**).
4. Abre **Tablero**, elige el proyecto: esas etapas deben ser las columnas, y una conversación nueva debe fijar las mismas fuentes.

## Funciones

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
