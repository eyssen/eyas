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
2. Crea un **Project Type** si hace falta plantilla (prompt, **Directorios de trabajo** opcionales), luego **New Project** (nombre, tipo, agente, **Directorios de trabajo** opcionales, fuentes opcionales, **Wiki auto-update** opcional).
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
| **Directorios de trabajo** | No | Nombre + ruta absoluta. El primero es **Primario**. Las conversaciones nuevas heredan la lista. Lista vacía copia la del **tipo**. Si no hay ninguno, cada conversación trabaja en su propio workspace de EYAS ([Carpetas](/docs/es/daily/conversations/#working-folders)). |
| **Fuentes de código por defecto** | No | Multi-select de [Search Sources](/docs/es/daily/search/). Se aplica a **nuevas conversaciones** del proyecto y al **asignar** este proyecto a una conversación |
| **Wiki auto-update** | No | Por defecto off. **Tickets cerrados** / **Decisiones de equipo** por separado. Cuerpo del ticket: solo título / último turno / conversación completa. **General** no recibe páginas. |
| **Wiki** | — | Wiki del proyecto |
| Badge **N fuentes** | — | Cuántas fuentes por defecto hay |

Flujo: registrar checkouts en Search Sources → Reindex → marcar defaults en el proyecto → pestaña **Fuentes** de la conversación.

**Qué carpetas se pueden guardar.** El proyecto, el tipo de proyecto y las Carpetas de la conversación comparten una misma comprobación. Al guardar se rechaza una carpeta y se nombra, con el motivo en tu idioma: la raíz del sistema de archivos, tu carpeta personal o cualquier carpeta por encima; una carpeta dentro del almacenamiento propio de otra herramienta de IA (`~/.claude`, `~/.grok`, `~/.codex`, `~/.cursor`, …) o de los directorios personales de inicio de sesión de CLI de EYAS; una carpeta dentro de una bóveda de Obsidian, una carpeta `ai-memory` o una entrada de `security.foreignMemoryPaths`; una carpeta dentro de la carpeta de datos propia de EYAS (salvo un único workspace de conversación, los proyectos de Studio y las descargas del navegador); ubicaciones sensibles (`.ssh`, `.env`, `master.key`, la carpeta de la base de datos); y una ruta relativa, una carpeta que no existe o un archivo. Una carpeta también se rechaza cuando **contiene** uno de esos sitios, y el mensaje nombra lo que se encontró dentro: el directorio propio de EYAS, su carpeta de datos, su base de datos o su carpeta de workspaces (el checkout de EYAS que contiene `data/`), el almacenamiento de otra herramienta de IA o una carpeta de inicio de sesión de CLI de EYAS, una bóveda de notas, una carpeta `ai-memory` o una entrada de `security.foreignMemoryPaths` (un `~/Documents` que contiene una bóveda). Una CLI lee y busca dentro de su carpeta de trabajo sin preguntar, así que no es seguro entregarle una carpeta así; elige una más concreta, como la carpeta del proyecto dentro de `~/Documents` o un clon aparte del repositorio. Lista completa: [Conversaciones — Carpetas](/docs/es/daily/conversations/#working-folders).

Cada guardado comprueba la lista entera, así que quita una carpeta ahora rechazada antes de guardar otros cambios. Las carpetas guardadas antes que ahora se rechazan no se reescriben, pero cada ejecución las deja fuera — las herramientas de archivo propias de EYAS, el security gate y la carpeta de trabajo de la CLI —, y el turno del chat muestra un aviso que nombra la carpeta. Si se rechazan todas las carpetas guardadas, las herramientas de archivo propias de EYAS no tienen carpeta, y una CLI trabaja en el propio workspace de EYAS de la conversación. El formulario de **Tipos de proyecto** ahora muestra el error de guardado en el propio formulario (antes, un guardado fallido era silencioso). La API responde a una carpeta rechazada en `POST`/`PATCH /api/v1/projects` y `/api/v1/project-types` con `400 {error, code, path, found}` (`found` es el sitio protegido dentro de la carpeta, para los códigos `containsEyasData`, `containsProviderHome` y `containsVault`); un valor de `workingDirectories` que no es una lista de rutas no vacías (o `null`) es un `400` sin código, y `null` o `[]` siguen vaciando la lista.

## Type

Name, Default Priority, Icon, Prompt, **Prompt coach**, **Directorios de trabajo** (valores por defecto para proyectos nuevos de este tipo), Color.

## Stage

Name, Closed, Folded, Bot, Auto-assign (None o agente). Drag para reordenar.

## Relacionado

[Tablero](/docs/es/daily/board/) · [Conversaciones](/docs/es/daily/conversations/) · [Búsqueda](/docs/es/daily/search/) · [Wiki de proyecto](/docs/es/knowledge/client-wiki/) · [Prompts](/docs/es/ai/prompts/)
