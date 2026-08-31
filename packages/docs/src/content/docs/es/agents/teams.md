---
title: Equipos y delegación
description: Planifica trabajo multiagente — fases, handoffs y la propuesta que apruebas en el chat.
---

**Para qué sirve.** Los equipos son cómo un agente primario delega. Aquí configuras fases; en una conversación el agente puede proponer un plan que **Approve** o **Skip**. Las subconversaciones y el Team Dashboard muestran quién hace qué. Esto es colaboración, no God Mode (varios modelos compitiendo en la misma tarea).

## Cuándo usarlo

- El trabajo necesita especialistas en paralelo o en secuencia, no un agente solo.
- Worktrees de git para que editores en paralelo no choquen.
- Plantillas de especialista que faltan, desde la tarjeta (**Create now**).
- Memoria de equipo compartida: findings, decisions, blockers.

## Flujo típico

1. Abre **Agentes** y confirma que existen el primario y los especialistas (asistente de setup **Team agents**, o créalos aquí).
2. Inicia una conversación, pon **Orchestration** en **Auto** o **Deep**, envía un objetivo complejo.
3. Si aparece **Team proposal**, revisa fases (parallel / sequential) y **Approve** (o **Create now**).
4. **Team / Sub-conversations → Open Team Dashboard**. Debes ver chats de miembros, fase y entradas de memoria de equipo.

## Funciones

Primary delega. Team Builder (fases parallel/sequential). En chat: sub-conversaciones, dashboard, proposal Approve/Skip.

**Worktrees** en complex/epic (`.eyas-worktrees/`). Opcional `agent.verifyCommands` — [Configuración](/docs/es/deploy/configuration/).
