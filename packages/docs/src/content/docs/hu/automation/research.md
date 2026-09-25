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

**Melyik modell végzi a munkát.** A lekérdezésbővítés, a források pontozása, a szekciók megírása és a keresztellenőrzés az EYAS háttérmodelljén fut: először a **Standard** routing-szinten, aztán az alapértelmezett modellen, aztán az API providereken, végül az izolált hívásra képes CLI-ken — soha nem azon a provideren, amelyet a gateway épp kiválaszt. Minden hívás izolált, egyszeri hívás (toolok, provider- vagy host-memória nélkül, egyetlen kör), megjelenik a tracingben, és beszámít a költségkeretbe. Lásd [Routing és költségkeret — A háttérmodell](/docs/hu/ai/routing-budget/#background-model).

**A webes tartalom adat, nem utasítás.** A keresési címek, kivonatok, URL-ek, oldalkivonatok és a belőlük írt szekciók egy határolt blokkban jutnak el a modellhez, amelynek hívásonként saját véletlen jelölője van. A modell azt az utasítást kapja, hogy a blokkon belüli tartalom adat, soha nem utasítás, így egy rosszindulatú oldal nem tudja lezárni a blokkot, és nem adhat parancsot.

**Jelentés modell nélkül.** A jelentés akkor is elkészül, ha egyetlen háttérmodell sem tudja megírni: egyik provider sem tud izolált háttérhívást futtatni (például csak Grokos vagy csak Kimis telepítésen, amíg az izolációjuk nincs ellenőrizve), a költségkeret leállt, vagy a modellhívás elbukott, illetve használhatatlan választ adott. Ilyenkor csak az eredeti témára keres; a forrásokat a keresési sorrend szerint rangsorolja (a legjobbak maradnak); a törzsben minden legjobb forráshoz egy szekció tartozik a címével, kivonatával és URL-jével; keresztellenőrzés nincs; és ha nincs elérhető modell, az oldalakat sem tölti le. Egy ilyen jelentés a szekciók fölött bannert mutat: *Modell nélkül összeállítva: egyetlen háttérmodell sem tudta összegezni ezt a jelentést (nincs olyan, amely elszigetelt háttérhívást futtathat, a költségkeret leállt, vagy a hívás sikertelen volt), ezért a legjobb források a kivonataikkal szerepelnek.* Az agent `research` toolja ilyen jelentésre `degraded: true` értéket ad vissza. Korábban a modellhiba **Hiba** állapottal zárta a jobot. A meglévő jelentések nem változnak.

A **Felszínes** kevesebb kapcsolódó lekérdezést bont ki és kevesebb találatot tart; a **Mély** többet bont, több találatot kér lekérdezésenként, és több, legalább 0,5 relevanciájú forrást tart meg.

A keresés Brave, ha létezik a `brave-search-api-key` titok; különben mock (UI-ellenőrzésre jó, élő webre nem). A kulcsot a [Titkok](/docs/hu/admin/secrets/) alá tedd.

A kész jelentés címe a lekérdezés, **Kész**, mélység (*felszínes* / *mély*), forrásszám, befejezési idő. A törzs modell által írt **szekciók** (cím + szöveg). A **Források** `[n]` cím (link) és **N% releváns**.

Sikertelen job — nem modellből eredő hibánál, például ha maga a keresés bukik el: **A kutatás sikertelen** és a hibaszöveg. Ezen a lapon nincs törlés vagy export.

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
| **Hiba** | A workflow elhasalt (modellhiba már nem így zárja a jobot — helyette a jelentés modell nélkül készül el) |

<h2 id="report">Jelentés panel</h2>

| Vezérlő | Jelentés |
|---------|----------|
| **Kutatás folyamatban…** | Folyamatban, aktuális állapotjelvénnyel |
| **A kutatás sikertelen** | Hibacím; a törzs a hibaszöveg |
| Mélység / forrásszám / befejezve | Fejléc meta kész jelentésen |
| Szekció cím + tartalom | Generált összefoglaló blokkok |
| *Modell nélkül összeállítva: …* banner | A jelentés háttérmodell nélkül készült — minden legjobb forráshoz egy szekció, keresztellenőrzés nélkül |
| **Források** | Sorszámozott linkek **N% releváns** |

## Kapcsolódó

- [Memória](/docs/hu/knowledge/memory/)
- [Dokumentumok](/docs/hu/knowledge/documents/)
- [Keresés](/docs/hu/daily/search/)
- [Titkok](/docs/hu/admin/secrets/)
- [Beállítások áttekintés](/docs/hu/admin/settings/)
