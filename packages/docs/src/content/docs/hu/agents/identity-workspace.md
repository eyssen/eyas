---
title: Identitás és workspace
description: IDENTITY, AGENTS, TOOLS és MEMORY fájlok szerkesztése — és snapshot visszaállítása, ha kell.
---

**Mire való.** A workspace-fájlok az agent hosszú távú prózája: ki ő, hogyan viszonyul a csapathoz, hogyan használja az eszközöket, és mire emlékszik. Ez mélyebb, mint a Configuration űrlap. Ha az autonómia tiltja az önmódosítást, az identitásváltozás a [Forge](/docs/hu/agents/forge/) javaslaton jön, nem csendes felülíráson.

## Mikor használd

- Meg akarod írni (vagy visszaállítani) a **Who I am**, **My mission**, eszkalációs és elutasítási szabályokat.
- Az agentnek útmutatás kell a csapatról (`AGENTS`) vagy az eszközpolitikáról (`TOOLS`).
- Rossz szerkesztés landolt, és **History → Restore** kell.
- Forge soul-javaslatot veted össze a jelenlegi IDENTITY-vel.

## Tipikus munkafolyamat

1. Nyisd az **Agentek** listát → az agent → **Workspace** fül — útvonal `/agents/:id`.
2. Válassz fájlt (**Who I am**, **Team description**, **Tools**, **Memory**). Szerkessz **Editorban**, vagy nézd a **Preview**-t.
3. Az IDENTITY szekció-chipekkel ugorj a hiányzó címsorokra (vagy hozd létre őket). **Save**.
4. Nyisd a **History**-t, ha snapshot kell. Visszaállítás után a lemezen lévő fájlnak egyeznie kell a snapshottal.

## Funkciók

A hosszú távú viselkedés a `data/agents/<id>/` alatti **markdown fájlokban** él.

## Fájlok

| Címke | Jelentés |
|-------|----------|
| **Who I am** | IDENTITY — identitás, küldetés |
| **Team description** | AGENTS — csapat viszony |
| **Tools** | TOOLS — tool használati útmutató |
| **Memory** | MEMORY — memória jegyzetek |

## Szerkesztő

Editor / Preview, mentés, üres fájl jelzés.

## IDENTITY szekciók

Who I am · My mission · Ongoing proactive duties · When to escalate · When to refuse — kattintásra ugrás vagy hiányzó heading létrehozása.

## History

Snapshot lista, View, Restore (visszaállítás), összehasonlítás a jelenlegi verzióval.

## Mi hol változik

| Hol | Mit |
|-----|-----|
| Configuration űrlap | Név, modell, tool lista, budget |
| Workspace fájlok | Mély identitás, küldetés, tool policy |
| [Forge](/docs/hu/agents/forge/) | Jóváhagyandó soul/identity javaslatok |

## Kapcsolódó

- [Beállítás](/docs/hu/agents/configure/)
- [Forge](/docs/hu/agents/forge/)
