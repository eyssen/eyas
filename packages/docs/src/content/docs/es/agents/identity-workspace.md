---
title: Identidad y workspace
description: Edita IDENTITY, AGENTS, TOOLS y MEMORY — y restaura una instantánea si hace falta.
---

**Para qué sirve.** Los archivos de workspace son la prosa duradera del agente: quién es, cómo se relaciona con el equipo, cómo debe usar las herramientas y de qué se acuerda. Más profundo que el formulario Configuration. Si la autonomía prohíbe la autoactualización, los cambios de identidad llegan por [Forge](/docs/es/agents/forge/), no por una reescritura silenciosa.

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
