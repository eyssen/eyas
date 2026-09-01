---
title: Importación y exportación de datos
description: Asistente de importación para memoria, habilidades y reglas de workspace — escanear, elegir, aprobar.
---

**Para qué sirve.** Data-port es el **asistente de importación**. Escanea una ruta del servidor o un zip/markdown de otro asistente y propone dónde archivarlo. La memoria puede aplicarse; reglas e identidad de workspace son **solo propuesta** hasta que apruebes el merge. No es un dump de BD — usa [Copia de seguridad](/docs/es/admin/backup/). La exportación está **Próximamente**.

**Sitio:** Ajustes → **Portabilidad de datos**.

## Cuándo usarlo

- Notas duraderas de `~/.claude` o un vault Obsidian `ai-memory` hacia EYAS (la única memoria que leerán las rondas posteriores).
- Skills propias de Claude/Cursor → categoría **own**.
- Reglas/identidad como propuestas de merge, nunca auto-sobrescritura.

## Flujo típico

1. **Ajustes** → **Importar datos…**
2. **Sistema de origen** (auto, Claude Code, Cursor, Obsidian, generic-md, chat-export, eyas-export).
3. **Ruta del servidor** o **Elegir archivo…**. **Instrucciones** opcionales.
4. **Escanear**. Elige grupos.
5. **Importar N elementos**. Reglas/identidad: **Aprobar merge** / **Rechazar**.

No hace falta la carpeta perfecta. Un scan de **home** se queda en carpetas de asistente y **Documents** (llega al `ai-memory` de Obsidian). **No** recorre `GitHub` ni otros árboles de código. Ahí se **omiten** índices `MEMORY.md`, dumps de sesión (`claude-sessions`), docs de producto, `robots.txt`/LICENSE y `AGENTS.md` dentro de repos — aunque selecciones todo. Las notas de `ai-memory` / `.grok/memory` / `.claude/skills` se copian, `kind: reference` si no declaran kind. La ruta de origen no se vuelve a leer.

## Relacionado

- [Memoria](/docs/es/knowledge/memory/)
- [Habilidades](/docs/es/automation/skills/)
- [Copia de seguridad](/docs/es/admin/backup/)
- [Agentes — workspace](/docs/es/agents/identity-workspace/)
