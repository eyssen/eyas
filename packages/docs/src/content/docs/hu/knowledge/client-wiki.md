---
title: Ügyfél wiki
description: Ügyfélhez kötött wiki — egy ügyfél delivery jegyzetei, nem a globális Tudásbázis-fa.
---

**Mire való.** Az ügyfél wiki **ügyfelenkénti** oldalfa: playbookok, környezet-jegyzetek és delivery tények, amik nem szivároghatnak a globális Tudásbázisba vagy a Memóriába. Minden wiki ügyfél-id-re van kulcsolva. A UI szándékosan kicsi: keresés, fa, markdown nézet/szerkesztés.

## Mikor használd

- Az oldal **egy ügyfélről** szól (staging URL, ki ír alá, a konvencióik).
- Nem akarod ezt a szöveget a globális **Tudásbázis** fában, sem egy vault `user` jegyzetben, amit minden prompt lát.
- Kereshető fa kell tagekkel, breadcrumbdel, és **Auto-generated** jelöléssel a gép írta oldalakon.
- Választás: globális wiki → Tudásbázis; tartós identitás → Memória; fájlok → Dokumentumok; csak ez az ügyfél → ide.

## Tipikus munkafolyamat

1. Nyisd annak az ügyfélnek a wikijét (API `/api/v1/client-wiki/:clientId/…` — **nincs** globális oldalsáv-elem; ez nem a **Tudásbázis**).
2. Használd a **Search this wiki…** mezőt vagy a bal fát. Az automatikusan generált oldalak robot-előtagot mutatnak.
3. Kattints **Edit**, változtasd a markdownt, **Save** (vagy **Cancel**). Üres: *No pages yet.* / *Select a page to view.*
4. Látnod kell a breadcrumböt, opcionális összefoglalót és tageket, és a mentett markdownt. A globális Tudásbázis és a Memória változatlan marad.

## Funkciók

A jelenlegi UI stub, és ezt őszintén viseli: a törzs markdown monoszóköz blokkban (nézet) vagy textarea-ban (szerkesztés). A szerveroldali HTML létezik (`?render=html`), de nem ez az alapnézet.

| Vezérlő | Jelentés |
|---------|----------|
| **Search this wiki…** | Ügyfélre szűrt keresés; **Results** lista |
| Fa | Oldalak parent szerint; kattintásra nyílik |
| Breadcrumb | A jelenlegi oldal szülő-lánca |
| **Edit / Cancel / Save / Saving…** | Markdown oda-vissza |
| **Auto-generated** | A rendszertől jött, nem személytől |
| Summary | Opcionális dőlt blurb a cím alatt |
| Tags | `#tag` chipek |
| *No pages yet.* | Üres wiki |
| *Select a page to view.* | Nincs kiválasztva |

A History és Backlinks az API/locale-okban teljesebben él, mint ebben a stub UI-ban — ne várj Knowledge-szerű verziósort.

## Kapcsolódó

- [Tudásbázis](/docs/hu/knowledge/knowledge-base/)
- [Memória](/docs/hu/knowledge/memory/)
- [Projektek](/docs/hu/daily/projects/)
