---
title: Equipos y delegación
description: Colegas con los que hablas, especialistas que lanzan, y cuándo sigue apareciendo una propuesta de equipo.
---

**Para qué.** Hablas con **colegas** (agentes primary y team). Tienen roles estrictos. Pasan el trabajo a otro colega o lanzan **especialistas** de un pool compartido — en automático, a menudo en paralelo. La tarjeta de propuesta de equipo solo aparece si falta un especialista, pediste un equipo, o el trabajo es épico.

Esto es colaboración, no God Mode.

## Cuándo usarlo

- Quieres hablar con el Personal Assistant o el System Engineer como personas.
- Un trabajo necesita varios especialistas a la vez (`run_specialist` en un turno).
- Git worktrees para que los editores en paralelo no choquen.
- Quieres un plan visible para **Approve** si el especialista aún no existe.

## Flujo

1. Abre un **colega** en la barra lateral.
2. Encárgale el trabajo. `handoff_to_colleague` o `run_specialist`.
3. Las ejecuciones de especialistas aparecen como subconversaciones. La memoria de equipo funciona sin tarjeta (sesión implícita).
4. Con varios especialistas: **Team Dashboard**.
5. **Team proposal** con `/team` o trabajo épico — **Approve** o **Skip**.

## Conceptos

| Concepto | Significado |
|----------|-------------|
| **Colega** | Agente primary o team con hilo de inicio. |
| **Especialista** | Trabajador estrecho. Pool compartido. |
| **`run_specialist`** | Spawn en línea. Verde. Alias: `delegate_to_agent`. |
| **`handoff_to_colleague`** | Hilo de inicio del otro colega. Verde. |
| **`assign_task`** | Tarjeta de tablero asíncrona. Verde si el destino está activo. |
| **`propose_team`** | Tarjeta para roles que faltan / épico / petición explícita. Amarillo. |

## Relacionado

- [Conversaciones](/docs/es/daily/conversations/)
- [Ejecuciones](/docs/es/agents/runs/)
- [Resumen de agentes](/docs/es/agents/overview/)
