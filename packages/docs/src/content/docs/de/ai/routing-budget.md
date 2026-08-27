---
title: Routing & Budget
description: Routing-Tiers, Auto-Routing, Fallback, Auto-Failover, Limits.
---

## Auto-routing

On/Off — Modellwahl anhand der Nachricht.

## Tiers

Triage, Quick, Standard, Complex, Code Execution, Heartbeat, Embedding, Prompt Enhancer — je Primary + Fallback.

### Auto-Failover (opt-in)

Bei `EYAS_AUTO_FAILOVER=1` (oder Config) können **leere** Fallback-Slots von einem zweiten live Provider gefüllt werden. **Gesetzte Fallbacks werden nie überschrieben.**

## Budget

Daily / Weekly / Monthly · Warn / Downgrade / Hard stop. Agenten-Monatsbudget separat.
