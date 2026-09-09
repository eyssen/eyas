---
title: Proyectos
description: Agrupa conversaciones en tipos, proyectos y etapas compartidas — con agente y fuentes de código por defecto.
---

**Para qué sirve.** Los proyectos agrupan conversaciones. Un **tipo de proyecto** es la plantilla; un **proyecto** es la instancia (agente por defecto, prompt, fuentes de código); las **etapas** son las columnas kanban compartidas. Las tarjetas del Tablero y los campos **Project** / **Stage** del chat son esta estructura.

## Cuándo usarlo

- Un cuerpo de trabajo nuevo con su propio agente por defecto, carpetas de trabajo y árboles de código opcionales.
- Un tipo reutilizable (prioridad, icono, prompt, directorios de trabajo) para que los proyectos nuevos arranquen igual.
- Las conversaciones creadas en este proyecto deben heredar fuentes indexadas y carpetas.
- Tickets cerrados o decisiones de equipo deben ir a la wiki del proyecto (opt-in).
- Una etapa debe asignar un agente al entrar una tarjeta.

## Flujo típico

1. Abre **Ajustes → Proyectos** (barra lateral **Ajustes**, grupo **Módulos**) — ruta `/projects`.
2. Crea un **Project Type** si hace falta plantilla (prompt, **Directorios de trabajo** opcionales), luego **New Project** (nombre, tipo, agente, **Directorios de trabajo**, fuentes opcionales, **Wiki auto-update** opcional).
3. En **Stages**, añade u ordena columnas (**Closed**, **Folded**, **Bot**, **Auto-assign**).
4. Abre **Tablero**, elige el proyecto: esas etapas son las columnas. La conversación nueva hereda fuentes y carpetas. **Wiki** en la tarjeta abre `/projects/:projectId/wiki`.

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
| **Prompt** | No | System prompt extra. Vacío hereda el tipo. `+` lo amplía. Cualquier otra cosa lo sustituye. El formulario es lo que ve el modelo; guardar escribe `AGENTS.md`. |
| **Prompt coach** | — | Coach IA del brief del proyecto — [Prompts](/docs/es/ai/prompts/) |
| **Directorios de trabajo** | Sí (para herramientas de archivo) | Nombre + ruta absoluta. El primero es **Primario**. Las conversaciones nuevas heredan la lista. Lista vacía copia la del **tipo**. Sin ruta, las herramientas de archivo se niegan. |
| **Fuentes de código por defecto** | No | Multi-select de [Search Sources](/docs/es/daily/search/). Se aplica a **nuevas conversaciones** del proyecto y al **asignar** este proyecto a una conversación |
| **Wiki auto-update** | No | Por defecto off. **Tickets cerrados** / **Decisiones de equipo** por separado. Cuerpo del ticket: solo título / último turno / conversación completa. **General** no recibe páginas. |
| **Wiki** | — | Wiki del proyecto |
| Badge **N fuentes** | — | Cuántas fuentes por defecto hay |

Flujo: registrar checkouts en Search Sources → Reindex → marcar defaults en el proyecto → pestaña **Fuentes** de la conversación.

## Type

Name, Default Priority, Icon, Prompt, **Prompt coach**, **Directorios de trabajo** (valores por defecto para proyectos nuevos de este tipo), Color.

## Stage

Name, Closed, Folded, Bot, Auto-assign (None o agente). Drag para reordenar.

## Relacionado

[Tablero](/docs/es/daily/board/) · [Conversaciones](/docs/es/daily/conversations/) · [Búsqueda](/docs/es/daily/search/) · [Wiki de proyecto](/docs/es/knowledge/client-wiki/) · [Prompts](/docs/es/ai/prompts/)
