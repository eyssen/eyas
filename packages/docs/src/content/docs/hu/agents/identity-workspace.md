---
title: Identitás és workspace
description: Workspace fájlok IDENTITY, AGENTS, TOOLS, MEMORY — szerkesztő, szekciók, előzmények.
---

**Útvonal:** `/agents/:id` → **Workspace**.

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
