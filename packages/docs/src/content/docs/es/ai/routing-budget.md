---
title: Enrutado y presupuesto
description: Niveles de auto-enrutado, fallbacks, límites de gasto y asignación de modelos.
---

**Para qué sirve.** El enrutado elige *qué* modelo responde. El presupuesto limita *cuánto* gastas (aviso, degradar, hard-stop). Las asignaciones fijan el modelo por defecto de cada agente semilla tras el setup.

**Ruta:** `/providers` → **Niveles de enrutado** y **Presupuesto**. Asignaciones: Ajustes → **Asignaciones de modelo**.

## Cuándo usarlo

- Barato para triaje, más fuerte para código.
- El primario falla — **Fallback** explícito o auto-failover (`EYAS_AUTO_FAILOVER=1`, nunca pisa fallbacks ya puestos).
- Topes diario/semanal/mensual.
- Agentes semilla sin modelo tras el asistente.

## Flujo típico

1. **Proveedores** → **Niveles de enrutado**.
2. **Auto-enrutado On**.
3. Por nivel **Primario** + **Fallback** opcional.
4. **Presupuesto**: Daily/Weekly/Monthly, Warn / Downgrade / Hard stop.
5. **Ajustes** → **Asignaciones de modelo** → **Guardar asignaciones**.

Niveles: Triage, Quick, Standard, Complex, Code Execution, Heartbeat, Embedding, Prompt Enhancer.

## Relacionado

- [Proveedores](/docs/es/ai/providers/)
- [Agentes — presupuesto](/docs/es/agents/configure/)
- [Prompts](/docs/es/ai/prompts/)
- [Proactivo](/docs/es/automation/proactive/)
