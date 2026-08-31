---
title: Projekt-wiki
description: Projektenkénti wiki — ticket- és döntésoldalak egy projekthez, nem a globális Tudásbázis-fa.
---

**Mire való.** A projekt-wiki **projektenkénti** oldalfa: lezárt ticketek, team-session döntések, playbookok és delivery tények, amik nem szivároghatnak a globális Tudásbázisba vagy a Memóriába. Minden wiki projekt-id-re van kulcsolva. A UI szándékosan kicsi: keresés, fa, markdown nézet/szerkesztés.

## Mikor használd

- Az oldal **egy projektről** szól (lezárt ticket, rögzített döntés, a projekt környezeti jegyzetei).
- Nem akarod ezt a szöveget a globális **Tudásbázis** fában, sem egy vault `user` jegyzetben, amit minden prompt lát.
- Kereshető fa kell tagekkel, breadcrumbdel, és **Auto-generated** jelöléssel a gép írta oldalakon.
- Választás: globális wiki → Tudásbázis; tartós identitás → Memória; fájlok → Dokumentumok; csak ez a projekt → ide.

## Tipikus munkafolyamat

1. Nyisd a wikit a projektkártyáról (útvonal `/projects/:projectId/wiki` — **nincs** globális oldalsáv-elem; ez nem a **Tudásbázis**).
2. Használd a keresőt vagy a bal fát. Az automatikusan generált oldalak robot-előtagot és **Automatikusan generált** jelvényt mutatnak.
3. Kattints **Szerkesztés**, változtasd a markdownt, **Mentés** (vagy **Mégse**). Mentéskor az oldal emberi tulajdonba kerül: későbbi auto-update nem írja felül. Üres: *Még nincs oldal.* / *Válassz egy oldalt a megtekintéshez.*
4. Látnod kell a breadcrumböt, opcionális összefoglalót és tageket, és a mentett markdownt. A globális Tudásbázis és a Memória változatlan marad.

Az auto-update **alapból ki**. A projekt űrlapon külön kapcsolható a **Lezárt ticketek** és a **Csapatdöntések**. A ticket-oldal törzse **Csak cím**, hacsak nem az utolsó fordulót vagy a teljes beszélgetést választod.

Egy board-kártya lezárása `ticket-<id>` oldalt ír, ha a ticketek be vannak kapcsolva. Team session findings/döntések `decision-<id>` oldalt írnak, ha a döntések be vannak kapcsolva (különben a vault promoter fut). A seed catch-all projekt nem kap wiki oldalt.

## Funkciók

A jelenlegi UI stub, és ezt őszintén viseli: a törzs markdown monoszóköz blokkban (nézet) vagy textarea-ban (szerkesztés). A szerveroldali HTML létezik (`?render=html`), de nem ez az alapnézet.

| Vezérlő | Jelentés |
|---------|----------|
| **Keresés a wikiben…** | Projektre szűrt keresés; **Találatok** lista |
| Fa | Oldalak parent szerint; kattintásra nyílik |
| Breadcrumb | A jelenlegi oldal szülő-lánca |
| **Szerkesztés / Mégse / Mentés** | Markdown oda-vissza |
| **Automatikusan generált** | A rendszertől jött, nem személytől |
| Summary | Opcionális dőlt blurb a cím alatt |
| Tags | `#tag` chipek |
| *Még nincs oldal.* | Üres wiki |
| *Válassz egy oldalt a megtekintéshez.* | Nincs kiválasztva |

A History és Backlinks az API/locale-okban teljesebben él, mint ebben a stub UI-ban — ne várj Knowledge-szerű verziósort.

## Kapcsolódó

- [Tudásbázis](/docs/hu/knowledge/knowledge-base/)
- [Memória](/docs/hu/knowledge/memory/)
- [Projektek](/docs/hu/daily/projects/)
