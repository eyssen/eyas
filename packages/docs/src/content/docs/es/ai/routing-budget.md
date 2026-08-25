---
title: Routing y presupuesto
description: Tiers de routing, auto-routing, fallback, auto-failover y límites.
---

## Auto-routing

On/Off — elección de modelo según el mensaje.

## Tiers

Triage, Quick, Standard, Complex, Code Execution, Heartbeat, Embedding, Prompt Enhancer — cada uno con Primary + Fallback.

### Auto-failover (opt-in)

Con `EYAS_AUTO_FAILOVER=1` (o config), los slots **Fallback** vacíos pueden rellenarse desde un segundo proveedor en vivo. **Nunca sobrescribe fallbacks ya definidos.**

## Presupuesto

Daily / Weekly / Monthly · Warn / Downgrade / Hard stop. Presupuesto mensual del agente por separado.
