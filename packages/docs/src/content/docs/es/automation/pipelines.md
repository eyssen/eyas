---
title: Pipelines
description: Ejecuciones ticket-to-code — ingest, aclarar, diseñar, implementar, review, PR, deploy.
---

**Para qué sirve.** Un pipeline es un trabajo orquestado de varios pasos. La superficie de producto hoy es **ticket-to-code**: un ticket del Tablero (o un id manual) por ingest → PM Clarify → Architect Design → Implement → Review → PR → Deploy, con puerta humana. No es un editor genérico de flujos.

**Ruta:** `/pipelines`. Barra: **Pipelines**.

## Cuándo usarlo

- Un ticket del Tablero debe volverse código, por etapas, no en un solo chat.
- Puerta de review o deploy.
- La ejecución falló o se canceló — **Reanudar**.
- Historial ticket → etapa → fin.

## Flujo típico

1. **Pipelines** (`/pipelines`).
2. **Iniciar una ejecución**: fuente **board** / **manual**, **Ticket id**, **Iniciar**.
3. Página de la ejecución. Las etapas se encienden en orden.
4. **En espera de aprobación** → **Aprobar**. **Cancelar** / **Reanudar**.
5. **Actualizar** (no hay polling). Listo con **Completado**.

Fuentes: **board** interno y **manual**. Etapas: Ingest, PM Clarify, Architect Design, Dev Implement, Review, Open PR, Deploy.

## Relacionado

- [Ejecuciones](/docs/es/agents/runs/)
- [Proyectos](/docs/es/daily/projects/)
- [Tablero](/docs/es/daily/board/)
- [Habilidades](/docs/es/automation/skills/)
