---
title: Csapatok és delegálás
description: Többágenses munka tervezése — fázisok, handoffok, és a javaslat, amit a chatben jóváhagysz.
---

**Mire való.** A csapatok azok, ahogy az elsődleges agent delegál. Itt fázisokat állítasz; a beszélgetésben az agent tervet javasolhat, amit **Approve** vagy **Skip**. Az al-beszélgetések és a Team Dashboard mutatja, ki mit csinál. Ez együttműködés, nem God Mode (több modell ugyanazon a feladaton versenyez).

## Mikor használd

- A munkához specialisták kellenek párhuzamosan vagy sorban, nem egy agent magában.
- Git worktree-k kellenek, hogy a párhuzamos szerkesztők ne ütközzenek.
- Hiányzó specialista-sablonokat a javaslatkártyáról kell létrehozni (**Create now**).
- Közös csapatmemóriát akarsz (finding, decision, blocker).

## Tipikus munkafolyamat

1. Nyisd az **Agentek** listát, és ellenőrizd, hogy az elsődleges plusz specialisták léteznek (setup varázsló **Team agents**, vagy itt hozod létre).
2. Indíts beszélgetést, állítsd az **Orchestration**t **Auto** vagy **Deep** értékre, és küldj összetett célt.
3. Ha **Team proposal** kártya jelenik meg, nézd a fázisokat (parallel / sequential), majd **Approve** (vagy **Create now** a hiányzó specialistákhoz).
4. Nyisd a **Team / Sub-conversations → Open Team Dashboard**. Látnod kell a tag-chateket, a fázist és a csapatmemória-bejegyzéseket.

## Funkciók

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
