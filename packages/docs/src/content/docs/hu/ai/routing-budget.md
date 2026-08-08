---
title: Routing és budget
description: Routing tierek, auto-routing, fallback, auto-failover, költési limitek.
---

## Auto-routing

On/Off — üzenetelemzés alapján modellválasztás.

## Tierek

Triage, Quick, Standard, Complex, Code Execution, Heartbeat, Embedding, Prompt Enhancer — mindegyikhez Primary provider/model + Fallback.

### Cross-provider auto-failover (opt-in)

Ha be van kapcsolva (`EYAS_AUTO_FAILOVER=1` vagy config), az üres tier **Fallback** slotok kitölthetők egy második élő providerből. **Már beállított fallbacket soha nem ír felül.**

## Budget

Daily / Weekly / Monthly limitek; Warn / Downgrade / Hard stop küszöbök. Ágens havi token budget külön (Configuration).
