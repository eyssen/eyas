---
title: Autonómia
description: Mennyit tehetnek az ágensek megkérdezés nélkül.
---

**Útvonalak:** `/autonomy` és Beállítások → **Autonomy features**.

Az autonómia a **felügyelet nélküli** viselkedést szabályozza: heartbeat, öntanulás, identity update, és mi igényel **emberi approvalt**.

## Elvek

1. Az erős loopok **alapból ki** vannak.  
2. Az approvalok a Dashboard **Needs attention** és a beszélgetés **Waiting approval** alatt jelennek meg.  
3. A YAML `autonomy.identitySelfUpdate` is korlátozhatja az IDENTITY közvetlen írását.

## Feature flagek

Heartbeat/proactive, reflection/briefing, Forge javaslatok, self-learning, identity self-update — mindegyik kapcsoló, nem töröl adatot.

## Kapcsolódó

- [Kezdőlap](/docs/hu/daily/home/)
- [Forge](/docs/hu/agents/forge/)
- [Proaktív asszisztens](/docs/hu/automation/proactive/)
