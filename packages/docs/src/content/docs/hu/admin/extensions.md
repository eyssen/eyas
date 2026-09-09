---
title: Bővítmények
description: Harmadik féltől származó készségcsomagok telepítése, bekapcsolása és áttekintése MIT-kompatibilis licencek mellett.
---

**Mire való.** A Bővítmények azoknak a készségcsomagoknak és eszközöknek a katalógusa, amelyeket licencelés miatt nem lehetett az EYAS-szal csomagolni. Maga az EYAS MIT marad. A GPL, LGPL, AGPL és SSPL (és hasonló copyleft) nincs a termékben; itt, csomagonként, a licencközlemény elolvasása után csatlakozol. Így adhatsz opcionális készségeket vagy kísérő eszközöket anélkül, hogy tiltott licencek keverednének a magfába.

## Mikor használd

- Olyan készségcsomagot akarsz, ami nincs a beépített katalógusban.
- Kísérő CLI vagy szolgáltatás kell (dokumentumkonverzió, vírusirtó, SAST), amellyel az EYAS külön folyamatként beszél.
- Telepítés előtt ellenőrizned kell, MIT-kompatibilis, copyleft vagy proprietary-e a csomag.
- Ki akarod kapcsolni a csomagot eltávolítás nélkül, vagy teljesen törölni.

## Tipikus munkafolyamat

1. Nyisd az oldalsáv **Beállítások** csoport **Modulok** → **Bővítmények** (`/extensions`).
2. Olvasd az **Automatikusan telepíthető csomagok** és a **Harmadik féltől származó kompatibilis eszközök** kártyáit. Név, licencjelvény, verzió, készítő, készségszám.
3. Auto csomagnál **Telepítés**. Olvasd a **Licencközlemény**t, majd **Elfogadás és telepítés** (vagy **Mégse**).
4. Telepítés után a kapcsoló **Bekapcsolás** / **Kikapcsolás**, a kuka eltávolít.
5. Harmadik fél csomagnál nyisd a **GitHub**ot, kövesd a **Telepítési útmutató**t, és magad telepítsd a projekt licence szerint. Az EYAS nem tölti le helyetted.

**Telepítve** jelvény és a fejléc telepített száma kell, hogy megjelenjen.

## Funkciók

Az alcím a szabály: egyes eszközök és készségcsomagok nem kerülhettek be; az auto csomagokat az EYAS a hozzájárulásoddal tölti le; a harmadik féltől származó eszközöket az eredeti forrásból, saját licencük alatt kell letölteni.

Licencjelvények:

| Osztály | Jelentés |
|---------|----------|
| MIT-kompatibilis | MIT, Apache-2.0, BSD, ISC, Unlicense és hasonlók — elvben csomagolható |
| Copyleft | GPL, LGPL, AGPL, MPL, CC-BY-SA és hasonlók — nincs a termékben; a telepítés tudatos opt-in. Az EYAS által letölthető copyleft csomagok **külön folyamatként** futnak, nem linkelődnek az EYAS-ba |
| Proprietary | Az EYAS nem terjeszti; magad töltöd le |
| Unknown | A licencszöveg nem osztályozható |

Az **Automatikusan telepíthető csomagok** archívumként jönnek (SHA-256 ellenőrzés, ha van), a data könyvtárba kerülnek, a elfogadott licenccel. A **Telepítés** elutasítva, ha nem fogadod el a közleményt. A kézi csomagok nem auto-telepíthetők.

A bekapcsolt csomagok készségfájljai a [Készségek](/docs/hu/automation/skills/) katalógusba kerülnek. A kártya készségszáma a deklarált készségek (a kísérő eszközöknél gyakran nulla). A kikapcsolás nem tölti ezeket; az eltávolítás törli a könyvtárat és a DB sort.

Ne telepíts olyan csomagot, amelynek licenceit nem tudod betartani. Az, hogy az EYAS MIT marad, nem menti fel a csomag feltételei alól.

## Mezők és vezérlők

<h2 id="catalogue">Katalógus</h2>

| Vezérlő | Jelentés |
|---------|----------|
| Telepített szám | Fejléc: hány csomag van telepítve |
| **Automatikusan telepíthető csomagok** | Az EYAS ezeket hozzájárulás után letöltheti |
| **Harmadik féltől származó kompatibilis eszközök** | Te töltöd le az eredeti forrásból |
| Név / leírás / verzió / **készítő** | Csomag azonosító |
| Licencjelvény | SPDX, kompatibilitási színnel |
| **Telepítve** | A csomag a lemezen van |
| Készségszám | Hány készséget deklarál |
| Címkék | Szűrőchipek, ha vannak |

<h2 id="install">Telepítés, bekapcsolás, kikapcsolás</h2>

| Vezérlő | Jelentés |
|---------|----------|
| **Telepítés** | Auto csomag hozzájárulásának indítása |
| **Licencközlemény** | A teljes szöveg, amit el kell fogadni |
| **Elfogadás és telepítés** | Licenc elfogadva, letöltés |
| **Mégse** | Közlemény bezárása telepítés nélkül |
| **Telepítés…** | Letöltés folyamatban |
| Kapcsoló | Telepített auto csomag **Bekapcsolás** / **Kikapcsolás** |
| Kuka | Telepített auto csomag eltávolítása |
| **GitHub** | Upstream oldal kézi csomagnál |
| **Telepítési útmutató** / **Részletek elrejtése** | Kézi útmutató kinyitása / bezárása |

<h2 id="recordly">Recordly (AGPL kísérő)</h2>

A Recordly asztali képernyőrögzítő (zoom, kurzor, webcam). **AGPL-3.0**, ezért az EYAS nem csomagolja és nem telepíti. A kártya a **Harmadik féltől származó kompatibilis eszközök** alatt van. A GitHubról töltöd le, a Recordlyban exportálsz **MP4/GIF**-et, majd a fájlt a [Dokumentumokba](/docs/hu/knowledge/documents/) csatolod. Nincs `recordly_*` ügynök-tool. További vágás ezen a gépen: [Video Use](/docs/hu/studio/videouse/). Ez **nem** [Stúdió](/docs/hu/studio/)-motor.

## Kapcsolódó

- [Beállítások áttekintés](/docs/hu/admin/settings/)
- [Értesítések](/docs/hu/admin/notifications/)
- [Távoli csomópontok](/docs/hu/admin/nodes/)
- [Kezek](/docs/hu/admin/hands/)
- [Készségek](/docs/hu/automation/skills/)
- [Eszközök](/docs/hu/automation/tools/)
- [Stúdió](/docs/hu/studio/)
- [Dokumentumok](/docs/hu/knowledge/documents/)
