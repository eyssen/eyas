---
title: Beállítások áttekintés
description: Rendszerközpont — megjelenés, nyelv, kártyák, linkek.
---

**Mire való.** A **Rendszer** oldal (`/settings`) a beállítások központja: statisztikák, rendszerinformáció, megjelenés és nyelv, modell-hozzárendelések, az Isten mód névsora, valamint az oldalsáv-csoportok, amelyek minden további admin felületet megnyitnak. Az [Értesítések](/docs/hu/admin/notifications/), a [Bővítmények](/docs/hu/admin/extensions/), a [Távoli csomópontok](/docs/hu/admin/nodes/) és a [Kezek](/docs/hu/admin/hands/) saját oldalak, az oldalsávból nyílnak — nem ezen az oldalon vannak.

**Útvonal:** `/settings` (oldalsáv **Rendszer**).

## Statisztikák

**Providerek** (aktív / összes) · **Modellek** (engedélyezve / összes) · **Titkok** (titkosítva) · **Felhasználók** (regisztrálva).

## Providerek összefoglaló

A providerek listája aktív-jelzővel és az engedélyezett / összes modell számával. A providernevek ugyanazok a terméknevek, mint a Providerek oldalon (ott a teljes beállítás).

## Rendszerinformáció

| Mező | Jelentés |
|------|----------|
| **Verzió** | EYAS-verzió |
| **Állapot** | Egészségi állapot |
| **Futtatókörnyezet** | Bun |
| **Adatbázis** | SQLite (WAL) |

## Kártyák ezen az oldalon

| Kártya | Cél |
|--------|-----|
| **Frissítések** | Frissítések keresése és telepítése a GitHubról |
| **Adat hordozhatóság** | Importvarázsló ([Adatimport és -export](/docs/hu/admin/data-port/)) |
| **Megjelenés** | **Téma** (világos/sötét), **Nyelv** (en / hu / de / es / fr / tlh) és **Sablon** |
| **Modell-hozzárendelések** | Agentenkénti választás, mindegyik *Provider / modell* alakban látszik és így is mentődik, így egy modellazonosító, amelyet két provider is listáz, soha nem kétértelmű. Lásd [Routing és költségkeret — Modell-hozzárendelések](/docs/hu/ai/routing-budget/#model-assignments). A setup varázsló AI modellek lépése ugyanígy működik |
| **Isten mód** | 2–5 modellből álló névsor, amely ugyanazon a feladaton versenyez, plusz elnök, költségplafon és a munkamappák megőrzése. Lásd [Beszélgetések — Isten mód](/docs/hu/daily/conversations/). |
| **Csapat-agentek** | Specialisták kiválasztása |
| **Autonómia és önfejlesztés** | A háttérben futó önfejlesztő ciklusok, alapból mind kikapcsolva — lásd [Autonómia](/docs/hu/agents/autonomy/) |

## Oldalsáv-csoportok

| Csoport | Linkek |
|---------|--------|
| **Általános** | Rendszer, Felhasználók, API-kulcsok, Titkok, [Kapcsolatok](/docs/hu/admin/connections/) (`/connections`) |
| **AI és modell** | Providerek, Média, Promptok, Memória, MCP-szerverek |
| **Modulok** | Projektek, Dokumentumok, Keresési források, [Értesítések](/docs/hu/admin/notifications/) (`/notifications-settings`), Proaktív, Öntanulás, [Bővítmények](/docs/hu/admin/extensions/) (`/extensions`) |
| **Infrastruktúra** | [Kezek](/docs/hu/admin/hands/) (`/hands`), [Ingress](/docs/hu/admin/ingress/), [Csomópontok](/docs/hu/admin/nodes/) (`/nodes`), Mentés, Megbeszélések |

## Kapcsolódó

- [Providerek](/docs/hu/ai/providers/)
- [Autonómia](/docs/hu/agents/autonomy/)
- [Kapcsolatok](/docs/hu/admin/connections/)
- [Értesítések](/docs/hu/admin/notifications/)
- [Bővítmények](/docs/hu/admin/extensions/)
- [Távoli csomópontok](/docs/hu/admin/nodes/)
- [Kezek](/docs/hu/admin/hands/)
