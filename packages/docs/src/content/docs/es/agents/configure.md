---
title: Crear y configurar
description: Nombre, modelo, herramientas, presupuesto y canales de un agente.
---

**Para qué sirve.** La pestaña **Configuration** es la identidad SQL: nombre, rol, modelo, esfuerzo, herramientas, restricciones y presupuesto mensual de tokens. Los archivos de workspace y la voz son otras pestañas. Esto es lo que rellenas al crear a alguien y lo que cambias cuando su trabajo se desplaza.

## Cuándo usarlo

- Estás creando un agente y necesitas nombre, tipo, modelo y lista de herramientas.
- Un agente de código debe tener `read_file` / `edit_file` / `grep` sin depender de un CLI.
- Un tope mensual de tokens, o `0` = ilimitado.
- Telegram (u otro canal) de entrada debe llegar a este agente.
- El prompt coach debe tensar el system prompt — no la voz, no el dominio del proyecto.

## Flujo típico

1. Abre **Agentes** → el agente (o **Create Agent**) — ruta `/agents/:id`, pestaña **Configuration**.
2. Rellena **Name**, **Role**, **Tier**, **Agent Type**, **Model** (o **Auto (routing decides)**), **Tools**, **Constraints**.
3. **Monthly Token Budget** si quieres tope. En **Channels**, enlaza un canal si el inbound debe aterrizar aquí.
4. **Save Changes**. Una conversación nueva asignada a este agente debe usar este modelo, herramientas y prompt.

## Funciones

**Classification:** Tier, Agent Type.  
**Persona:** Name, Role, Description, Persona, Goal, Backstory, Avatar, System Prompt, **Prompt coach** (protocolo operativo del agente — [prompts](/docs/es/ai/prompts/)).  
**Model:** Model/Auto, Effort, Max Turns.  
**Tools / Capabilities / Constraints.**  
Para coding (cualquier modelo): `read_file, write_file, edit_file, grep, glob, git_status, git_diff, run_command`. Los agentes creados antes de 0.8.6 **no** los heredan solos — hay que añadirlos. Catálogo: [Herramientas](/docs/es/automation/tools/).  
**Monthly Token Budget** (0=ilimitado). Save Changes. Channels Bind/Unbind.
