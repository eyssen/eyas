---
title: Kutatás
description: Felszínes vagy mély kutatási job indítása, állapot követése, jelentés és források.
---

**Mire való.** A Kutatás webes keresési jobot futtat egy kérdésből vagy témából, értékeli a forrásokat, és strukturált jelentést ír, amit később megnyithatsz. Az ágensek újrahasználhatják. Akkor használd, ha forrásolt összefoglaló kell, nem egyetlen chat-forduló. A felszínes gyorsabb; a mély több lekérdezést bont ki és több forrást tart meg.

## Mikor használd

- Jelentést akarsz URL-hivatkozásokkal, nem csak modellválaszt.
- Gyors menetet (**Felszínes (gyorsabb)**) vagy szélesebbet (**Mély (alapos)**) kell.
- Követni akarod a jobot: **Függőben** → **Keresés** → **Értékelés** → **Összegzés** → **Kész**.
- A job elhasalt, és a jobb oldalon kell a hibaszöveg.

## Tipikus munkafolyamat

1. Nyisd a **Kutatás**t az oldalsávon (`/research`).
2. **Új kutatás** alatt írd be a témát (helyőrző *Add meg a kutatás témáját…*).
3. Válassz: **Felszínes (gyorsabb)** vagy **Mély (alapos)**.
4. **Kutatás**. A job a bal listában megjelenik és ki van választva.
5. Várd, amíg a jobb panel **Kutatás folyamatban…** és az aktuális állapot. Az aktív jobok kb. két másodpercenként frissülnek.
6. **Kész** esetén olvasd a szekciókat és a **Források**t. A forrás címére kattintva nyílik az URL.

Üres lista: *Még nincs kutatási jelentés*. Nincs kiválasztva: *Válassz egy jelentést, vagy indíts új kutatást*.

## Funkciók

A job **Függőben** indul, majd **Keresés** (lekérdezésbővítés + webes keresés), **Értékelés** (relevancia), **Összegzés** (szekciók + keresztellenőrzés), aztán **Kész** vagy **Hiba**.

A **Felszínes** kevesebb kapcsolódó lekérdezést bont ki és kevesebb találatot tart; a **Mély** többet bont, több találatot kér lekérdezésenként, és több, legalább 0,5 relevanciájú forrást tart meg.

A keresés Brave, ha létezik a `brave-search-api-key` titok; különben mock (UI-ellenőrzésre jó, élő webre nem). A kulcsot a [Titkok](/docs/hu/admin/secrets/) alá tedd.

A kész jelentés címe a lekérdezés, **Kész**, mélység (*felszínes* / *mély*), forrásszám, befejezési idő. A törzs modell által írt **szekciók** (cím + szöveg). A **Források** `[n]` cím (link) és **N% releváns**.

Sikertelen job: **A kutatás sikertelen** és a hibaszöveg. Ezen a lapon nincs törlés vagy export.

## Mezők és vezérlők

<h2 id="new-job">Új kutatás</h2>

| Vezérlő | Jelentés |
|---------|----------|
| **Új kutatás** | Űrlap címe |
| Téma mező | Helyőrző *Add meg a kutatás témáját…* |
| Mélység | **Felszínes (gyorsabb)** vagy **Mély (alapos)** |
| **Kutatás** | Job indítása (üresen vagy küldés közben tiltva) |

<h2 id="statuses">Lista és állapotok</h2>

| Vezérlő | Jelentés |
|---------|----------|
| Bal lista | Lekérdezés, állapotjelvény, létrehozás dátuma. Kattintásra betölt |
| **Függőben** | Sorban, még nem keres |
| **Keresés** | Lekérdezésbővítés és webes keresés |
| **Értékelés** | Források pontozása és szűrése |
| **Összegzés** | Szekciók írása és keresztellenőrzés |
| **Kész** | Jelentés kész |
| **Hiba** | A workflow elhasalt |

<h2 id="report">Jelentés panel</h2>

| Vezérlő | Jelentés |
|---------|----------|
| **Kutatás folyamatban…** | Folyamatban, aktuális állapotjelvénnyel |
| **A kutatás sikertelen** | Hibacím; a törzs a hibaszöveg |
| Mélység / forrásszám / befejezve | Fejléc meta kész jelentésen |
| Szekció cím + tartalom | Generált összefoglaló blokkok |
| **Források** | Sorszámozott linkek **N% releváns** |

## Kapcsolódó

- [Memória](/docs/hu/knowledge/memory/)
- [Dokumentumok](/docs/hu/knowledge/documents/)
- [Keresés](/docs/hu/daily/search/)
- [Titkok](/docs/hu/admin/secrets/)
- [Beállítások áttekintés](/docs/hu/admin/settings/)
