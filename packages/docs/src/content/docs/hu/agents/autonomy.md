---
title: Autonómia
description: Mennyit tehetnek az agentek megkérdezés nélkül — jóváhagyási sor és három szint.
---

**Mire való.** Az autonómia a biztonsági tárcsa. Műveletosztályonként **Értesítés** (előbb kérdez), **Jóváhagyás** (javaslat + egy kattintás) vagy **Automatikus** (csinálja, aztán jelent). A kimenő és visszafordíthatatlan műveletek **Értesítés**en zároltak. Ugyanez az oldal a **függő jóváhagyások** sora, ami a futást parkoltatja, amíg nem döntesz.

## Mikor használd

- A beszélgetés **Waiting approval**, és **Jóváhagyás** vagy **Elutasítás** kell anélkül, hogy találgatnád, mi van parkolva.
- A visszafordítható munka (fájlszerkesztés, kutatás) **Automatikus** legyen, de zárolt kimenő osztályt soha ne emelj.
- A folytatás megbukott, pedig már jóváhagytad — a beragadt sor még rád vár.
- Heartbeatet, Forge-javaslatokat vagy identity önmódosítást flagként akarod ki/be kapcsolni.

## Tipikus munkafolyamat

1. Nyisd az **Autonómiát** az oldalsávon (**Megfigyelés** szakasz) — útvonal `/autonomy`. A feature flagek a **Beállítások → Rendszer** (Autonomy features kártya) alatt vannak.
2. Olvasd a **Függő jóváhagyások** sort. Minden sornál **Jóváhagyás** vagy **Elutasítás**. Az **Erre váró futás** a beszélgetésbe visz, ha kontextus kell.
3. A **Visszafordítható** csoportban állíts kategóriát **Értesítés / Jóváhagyás / Automatikus** szintre (a zároltak nem mehetnek Értesítés fölé).
4. A parkolt futásnak folytatódnia kell (vagy rejectnél állva maradnia). A Kezdőlap **Figyelmet igényel** és a beszélgetés **Waiting approval** badge-ének el kell tűnnie.

## Funkciók

Az autonómia a **felügyelet nélküli** viselkedést szabályozza. A erős loopok **alapból ki** vannak.

### Szintek

| Szint | Címke | Hint |
|-------|-------|------|
| 1 | **Értesítés** | Előbb kérdez |
| 2 | **Jóváhagyás** | Javaslat + egykattintásos jóváhagyás |
| 3 | **Automatikus** | Önálló + utólagos jelentés |

Csoportok: **Visszafordítható** (emelheted) és **Kimenő / visszafordíthatatlan (zárolt)** (nem mehet Értesítés fölé). **Függő jóváhagyások**: Approve/Reject, *Semmi sem vár jóváhagyásra.*, **Erre váró futás**.

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
