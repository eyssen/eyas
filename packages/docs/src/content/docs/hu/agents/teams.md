---
title: Csapatok és delegálás
description: Team builder, fázisok, handoffok, többágenses együttműködés.
---

Az ágensek **delegálással**, beszélgetésbeli **team sessionökkel** és opcionális **team config** UI-jal működnek együtt.

| Fogalom | Jelentés |
|---------|----------|
| **Primary** | Napi munka; delegálhat |
| **Team / specialist** | Domain feladatok fogadója |
| **Handoff** | Munka átadása (gyakran artifacttal) |
| **Team session** | Többágenses run, sub-conversationökkel |
| **Team proposal** | Terv, amit a user approve-ol |

## Team Builder

**Team Builder**, fázisszám, becsült token. Fázis: **parallel** / **sequential**.

**Worktree:** complex/epic team javaslatnál az agentek `.eyas-worktrees/` alatt futnak.  
**Verify:** opcionális `agent.verifyCommands` a YAML-ban (lint/test a critic előtt) — [Konfiguráció](/docs/hu/deploy/configuration/).

## Beszélgetésben

Sub-conversation fa, Team Dashboard, Team proposal (Approve/Skip/Create specialists) — lásd [Beszélgetések](/docs/hu/daily/conversations/).

## Setup

A [setup varázsló](/docs/hu/setup-wizard/) opcionális **Csapat-agentek** lépése. Később: Ágensek.
