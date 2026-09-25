---
title: Identidad y workspace
description: Edita IDENTITY, AGENTS, TOOLS y tus notas MEMORY — y restaura una instantánea si hace falta.
---

**Para qué sirve.** Los archivos de workspace son la prosa duradera del agente: quién es, cómo se relaciona con el equipo y cómo debe usar las herramientas — más un archivo **Memory** para tus propias notas sobre el agente. Más profundo que el formulario Configuration. Lo que EYAS recuerda no está aquí: EYAS graba la memoria por sí mismo y la muestra en la página [Memoria](/docs/es/knowledge/memory/). Si la autonomía prohíbe la autoactualización, los cambios de identidad llegan por [Forge](/docs/es/agents/forge/), no por una reescritura silenciosa.

## Cuándo usarlo

- Escribir (o restaurar) **Who I am**, **My mission**, reglas de escalado y de rechazo.
- Guía sobre el equipo (`AGENTS`) o la política de herramientas (`TOOLS`).
- Un mal edit — **History → Restore**.
- Contrastar una propuesta soul de Forge con el IDENTITY actual.

## Flujo típico

1. Abre **Agentes** → el agente → pestaña **Workspace** — ruta `/agents/:id`.
2. Elige un archivo (**Who I am**, **Team description**, **Tools**, **Memory**). **Editor** o **Preview**.
3. Los chips de IDENTITY saltan a (o crean) encabezados que faltan. **Save**.
4. **History** si necesitas una instantánea. Tras restaurar, el archivo en disco debe coincidir.

## Funciones

Selector de archivo, Editor/Preview/Save. Secciones IDENTITY. Historial con Restore. Config del formulario ≠ workspace ≠ Forge.

**Memory** (`MEMORY`) son tus propias notas sobre este agente. EYAS no envía este archivo al modelo y los agentes no pueden escribirlo. Al elegir **Memory** en el selector de archivo aparece esa indicación: *Tus propias notas sobre este agente. EYAS no envía este archivo al modelo y los agentes no pueden escribirlo. Lo que EYAS recuerda está en la página Memoria.* Puedes seguir editándolo, guardándolo y viendo su historial como antes.

### Qué pueden editar los agentes por sí mismos

Las herramientas `workspace_append` y `workspace_edit` solo editan **Team description** (`AGENTS.md`) y **Tools** (`TOOLS.md`). Los agentes ya no pueden escribir el archivo Memory (`MEMORY.md`) ni los archivos diarios de memoria (`memory/YYYY-MM-DD.md`): EYAS graba la memoria automáticamente y los agentes nunca escriben memoria por sí mismos.
