---
title: Tábla
description: Mozgasd a beszélgetéseket a stage-ek között — kanban, lista, idővonal, graph és dashboard.
---

**Mire való.** A Tábla a beszélgetések munkafelülete. Minden kártya egy szál: húzod a stage-ek között, szűrsz projektre, és rákattintva beszélsz. A kanban, lista, idővonal, graph és dashboard ugyanazt a szűrt készletet olvassa.

## Mikor használd

- Egy projekt minden nyitott szálát oszlopokban akarod látni (vagy az összes projektet egyszerre).
- Tovább akarod vinni a munkát, kitűzni egy kártyát, vagy észrevenni a lejárt / elakadt / jóváhagyásra váró tételeket.
- Rendezhető listát, esedékesség-idővonalat vagy egy orkesztrációs futás gráfját akarod.
- A mai átbocsátást, költséget és élő futásokat akarod a tábla elhagyása nélkül.
- Új beszélgetést indítasz adott projektben és stage-ben.

## Tipikus munkafolyamat

1. Nyisd a **Táblát** az oldalsávon (**Fő** szakasz) — útvonal `/board`.
2. Válassz projektet (vagy **All projects**). Válts **Kanban** / **List** / **Timeline** / **Graph** / **Dashboard** nézetre.
3. Húzd a kártyát új stage-be, vagy kattints rá a beszélgetés megnyitásához.
4. Az új oszlopban kell látnod a kártyát (és a beszélgetés **Stage** mezője egyezik). A szűrők nézetváltáskor megmaradnak.

## Funkciók

A beszélgetéseket kártyaként követi projektek és stage-ek mentén.

## Projekt szűrő

| Vezérlő | Jelentés |
|---------|----------|
| **All projects** | Minden projekt |
| Projekt választó | Egy projekt |
| *No projects yet* | Előbb hozz létre projektet |

## Új beszélgetés

**New** + **Conversation title…** — új kártya/szál indítása.

## Nézetek

| Nézet | Mit mutat |
|-------|-----------|
| **Kanban** | Oszlopok (stage / group-by), drag-and-drop |
| **List** | Táblázatos sorok |
| **Timeline** | Idősávok, due, runok |
| **Graph** | Orchestration vagy stage flow |
| **Dashboard** | Aggregált metrikák |

**Group by:** Stage, Priority, Assignee (+ Unassigned).

## Kártya jelek

Title, Pinned, Working / Waiting / Approval / Error, subtasks N/M, context %, Overdue, $cost, aging (h/d/stuck).

## Oszlop

Fold column, Drop here, WIP n/limit.

## Szűrők

Stage, Priority, Tags, Active/Done/All, Name…, Content…  
Prioritás: Urgent · High · Normal · Low.

A **tagek board-szűrők, nem projektfa.** A kategórianevek (például `module`, `area`) a példányon jönnek létre; az érték a beszélgetésen van. Válassz projektet, aztán taget — ez a szelet a projekten belül, nem alproject. A beszélgetés tagjei egy `tags: …` sorban jelennek meg a prompt suffixében (nem a cache-prefixben).

## Lista műveletek

Oszlopok: P, ID, Title, Project, Updated.  
Műveletek: Pin, Archive, törlés + Undo.

## Timeline

Ablak: 1h / 24h / 7d / 30d. Események: Agent runs, Due, Updated, Now.

## Board dashboard

Open tasks, Done today, In progress, Running, Waiting approval, Cost today, Throughput, Activity, Priority mix, Tasks per stage, Live/Disconnected.

## Graph

Orchestration / Stage flow módok + orchestration run választó.

## Kapcsolódó

- [Beszélgetések](/docs/hu/daily/conversations/)
- [Projektek](/docs/hu/daily/projects/)
