---
title: Az első órád
description: Vezetett első óra a futó UI-ban — Kezdőlap, egy beszélgetés, egy táblakártya, és hol él a memória.
---

**Mire való.** A telepítés és a [setup varázsló](/docs/hu/setup-wizard/) kész. Ez az óra az élő terméken vezet végig, hogy tudd, hol indul a munka, hol követed, és hogyan marad meg egy tény. Nem mezőlista.

## Mikor használd

- Be tudsz jelentkezni, és a fő app nyitva van
- Egy hasznos beszélgetést akarsz, nem minden képernyő túráját
- Látni akarod, hogyan illeszkedik a **Kezdőlap**, a **Tábla**, a **Memória** és az **Agentek**

## Jelentkezz be, és landolj a Kezdőlapon

Nyisd meg a UI-t (alap: **http://localhost:3100**). Add meg a varázslóban létrehozott root owner **Felhasználónév**et és **Jelszó**t, majd kattints a **Bejelentkezés**re.

A **Kezdőlap**on landolsz (`/`). Mindenki ugyanazzal a gyári ráccsal indul, amíg nem szabod testre.

Először három csempét nézz meg:

- **Pulzus** — rád vár, fut, várakozik, mai költség, sikertelen feladatok
- **Figyelmet igényel** — jóváhagyások, elakadt munka, váró ágensek, lejárt tételek; a csempéről is tudsz cselekedni
- **Futó ágensek** — élő aktivitás; **Szüneteltetés**, **Folytatás** vagy **Leállítás**

A rács fölött maradhat egy ajánlott-beállítás sáv, amíg van hátralévő opcionális munka. Ezt az órát hagyd ki.

## Indíts egy beszélgetést

Az oldalsávon kattints az **Új beszélgetés**re. Az üres állapot: **Kezdj el egy beszélgetést…**.

Írj egy tényleg hasznos kérést — hogyan szeretnél dolgozni, egy döntés, vagy egy követendő feladat. A composer: **Írj egy üzenetet… (Shift+Enter: új sor)**. Küldd el.

Figyeld a streamet: **Gondolkodik** vagy **Gondolkodik…**, aztán **Válasz készítése…**. Ha az ágens toolt hív, nyisd ki a **Bemenet** / **Kimenet** (vagy **Hiba**) blokkot. A **Leállítás** megszakítja a futást.

Hagyd nyitva a szálat. Következőnek a táblára kerül.

## Tedd a Táblára

Az oldalsávon nyisd meg a **Tábla**t (`/board`). A beszélgetések kártyák. A tiéd gyakran már ott van, a szál címével (vagy **Névtelen**).

- Tűzd ki, hogy a kitűzősávon maradjon (**Kitűzve**).
- Vagy kattints az **Új**ra, írj **Beszélgetés címe…**-t, és hozz létre egy szálhoz kötött kártyát.

Most van hol beszélni, és van hol követni ugyanazt a munkát.

## Nézd meg, hol él a memória

Nyisd meg a **Memória**t (`/memory`). Kezdd az **Áttekintés** tabbal, aztán a **Vault fájlok**kal.

A 0.8.16-beta óta egy tartós tény, amit bármelyik beszélgetésben kimondasz, vault jegyzet lehet **anélkül, hogy kérnéd**. A capture globális, és alapból be van kapcsolva. A válasz kézbesítése *után* fut — soha nem a válasz kritikus útján. Rövid fordulók és small talk általában semmit nem írnak; ez helyes.

Lehet, hogy az első percben nem látsz új fájlt. Gyere vissza a **Vault fájlok**hoz egy hosszabb, tény-sűrű csere után, vagy írj jegyzetet kézzel. Az ágensek továbbra is menthetnek memóriát szándékosan.

## Ismerd meg az elsődleges ágenseket

Nyisd meg az **Agentek** listát (`/agents`). Szűrj **Elsődleges**-re. Ez a két társ, akiket a varázslóban neveztél el: a **Személyi asszisztens** (napi munka) és a **Rendszermérnök** (maga az EYAS). Ők maradnak; a beszélgetések jönnek-mennek.

Ebben az órában nem kell új ágenst létrehoznod.

## Mit tanulj ezután

- [Beszélgetések](/docs/hu/daily/conversations/) — composer, sávok, effort, orchestráció
- [Tábla](/docs/hu/daily/board/) — kártyák, stage-ek, nézetek
- [Ágensek áttekintés](/docs/hu/agents/overview/) — tierek, típusok, lista
- [Memória](/docs/hu/knowledge/memory/) — öt szint és vault jegyzetek
- [Skillek](/docs/hu/automation/skills/) — újrahasználható eljárások, amiket az ágensek betölthetnek
- [Eszközök](/docs/hu/automation/tools/) — élő katalógus; `browser_` a headless Playwright
- [Browser Use](/docs/hu/automation/browser-use/) — nyilvános oldal vs belépett Chrome vs Kezek
- [Alapfogalmak](/docs/hu/concepts/) — a mentális modell, miután körbekattintottál
