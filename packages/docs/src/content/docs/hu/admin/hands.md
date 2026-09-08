---
title: Kezek
description: Párosíts egy helyi „kezet”, hogy az EYAS CLI-ket és asztali automatizálást használjon egy általad kontrollált gépen.
---

**Mire való.** A Kezek az EYAS Hand kliensek párosító központja — olyan gépek, amelyeket te kontrollálsz, és CLI-eszközöket, OS-automatizálást és/vagy computer-use-t adnak ennek a szervernek. Rövid életű párosítókód köti az eszközt; a csatlakozott kezek platformot, architektúrát, OS-t, képességeket és a felfedezett CLI/app eszközök számát jelentik. Ez nem távoli SSH-csomópont és nem Observability.

## Mikor használd

- Az ágensnek CLI-t vagy asztali műveletet kell futtatnia *a te* Mac, Windows vagy Linux gépeden, nem csak a szerverfolyamatban.
- Új Hand klienst párosítasz, és öt percig érvényes kód kell.
- Látni akarod, csatlakozott-e a kéz, mire képes (**CLI**, **OS-automatizálás**, **Számítógép-használat**), és hány eszközt talált.
- Le akarod választani a már nem megbízható eszközt.

## Tipikus munkafolyamat

1. Nyisd az oldalsáv **Beállítások** csoport **Infrastruktúra** → **Kezek** (`/hands`).
2. **Párosítókód generálása**. Nagy **Párosítókód** jelenik meg; **5 perc múlva lejár — add meg ezt a kódot a Hand eszközödön**.
3. Írd be a kódot a Hand kliensen. A kód lejáratkor eltűnik erről a lapról.
4. **Frissítés**, ha a kártya még nem látszik.
5. Ellenőrizd a platform · arch · OS, a képességjelvényeket és az eszköztszámot, majd tartsd vagy **Leválasztás**.

Üres: *Nincs csatlakozott kéz* / *Generálj egy párosítókódot, és csatlakoztass egy EYAS Hand klienst*. Párosítás után zöld pont és a rövid hand id.

## Funkciók

A párosítókód **300 másodperc** (öt perc), aztán eltűnik. A sikertelen generálás hibaszalagot mutat.

Minden csatlakozott kéz: név, rövid id, `platform · arch · osVersion`, **N eszköz**, protokollverzió, relatív **Utoljára látva**, képességjelvények. Platformikonok: Darwin, Windows, Linux (egyébként általános).

A kliens által jelentett képességek:

| Jelvény | Jelentés |
|---------|----------|
| **CLI** | Parancssori eszközök azon a gépen |
| **OS-automatizálás** | OS-szintű automatizálás |
| **Számítógép-használat** | Asztal / computer-use |

A felfedezett eszközök **cli** vagy **app** (id, név, útvonal, opcionális verzió). Ez a lap a **számot** mutatja, nem eszközönkénti listát.

A **Leválasztás** kiregisztrálja a kezet (és lebontja az MCP transzportot, ha az a kapcsolat). A **Frissítés** újratölti a listát.

## Mezők és vezérlők

<h2 id="pairing">Párosítókód</h2>

| Vezérlő | Jelentés |
|---------|----------|
| **Párosítókód generálása** / **Generálás…** | Kód a jelenlegi felhasználónak |
| **Párosítókód** | Nagy monoszóköz kód a Handre |
| *n* perc múlva lejár | TTL-szöveg; a kártya lejáratkor eltűnik |
| **Frissítés** | Csatlakozott kezek újratöltése |

<h2 id="connected-hands">Csatlakozott kezek</h2>

| Vezérlő | Jelentés |
|---------|----------|
| Név + rövid id | Címke és a `handId` első nyolc karaktere |
| platform · arch · osVersion | Gépazonosító |
| **N eszköz** | Hány CLI/app eszközt jelentett a kéz |
| Protokoll v*n* | Hand protokollverzió |
| **Utoljára látva** | Relatív idő (*az imént*, *N perce*, *N órája*, *N napja*) |
| **CLI** / **OS-automatizálás** / **Számítógép-használat** | Képességjelvények |
| Csatlakozott pont | Zöld, amíg a listán van |
| **Leválasztás** / **Leválasztás…** | Kéz kiregisztrálása |

## Kapcsolódó

- [Beállítások áttekintés](/docs/hu/admin/settings/)
- [Távoli csomópontok](/docs/hu/admin/nodes/)
- [Értesítések](/docs/hu/admin/notifications/)
- [Bővítmények](/docs/hu/admin/extensions/)
- [Eszközök](/docs/hu/automation/tools/)
- [MCP-szerverek](/docs/hu/ai/mcp/)
