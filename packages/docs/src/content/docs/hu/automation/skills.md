---
title: Készségek
description: Készségkatalógus — források, szűrők, leltár, auto-adoption és a beszélgetésbeli javaslatkapu.
---

**Mire való.** A készség (skill) egy markdown eljárás-csomag, amit az agent akkor tölt be, ha a munka illeszkedik a trigger mintáira. Ez az oldal a katalógus: létrehozol, engedélyezel, letiltsz és megvizsgálsz készségeket — beépített, saját, importált vagy generált. Nem eszköz. Az eszköz hívható képesség; a készség azt mondja meg, *hogyan* használd.

**Útvonal:** `/skills`. Alcím: *Készségsablonok, trigger-minták és a generált készségek kezelése.* Fülek: **Böngészés** · **Leltár**.

## Mikor használd

- Ismétlődő játékszabályt akarsz (Odoo kódolási lánc, runbook, házistílus).
- Más asszisztensből importáltál, és látni akarod, melyik id-másolat töltődik be.
- Egy beszélgetés készséget javasolt, és itt akarod elutasítani, vagy globálisan kikapcsolni a rossz illesztést.
- Generált készségek jelennek meg, és tudni akarod, miért mentek vagy nem mentek élőbe.

## Tipikus folyamat

1. Nyisd a **Készségek** menüt (`/skills`).
2. **Böngészés:** keress, vagy szűrj **Összes / Saját skillek / Beépített**, majd **Új készség**.
3. Töltsd ki: **Készség neve**, **Trigger minták (vesszővel elválasztva)**, **Készség tartalma / sablon**.
4. A **Leltár** mutatja, melyik másolat nyert, mennyit használták, engedélyezve van-e.
5. Beszélgetésben, ha készség illeszkedik, a forduló vár. **Használd**, **Most ne**, vagy (tulajdonos/admin) **Kapcsold ki**.

## Funkciók

### Készségjavaslat (beszélgetéskapu)

Az illeszkedő készség **javaslat, amire a forduló vár**. Addig semmi nem fut belőle. A kártya mutatja a nevet, az illeszkedési pontszámot és a mintát — így a rossz illesztés látszik.

| Vezérlő | Jelentés |
|---------|----------|
| **Használd** | Elfogadás erre a beszélgetésre; a forduló a készséggel folytatódik |
| **Most ne** | Elutasítás csak ebben a beszélgetésben; máshol engedélyezve marad |
| **Kapcsold ki** | Elutasítás **és** globális letiltás, amíg valaki a Készségeknél vissza nem kapcsolja. Csak tulajdonos és admin — aki beszélhet, de készséget nem kezel, annak igen/nem marad |

A válasz erre a beszélgetésre megjegyződik. A harmadik gomb a 0.8.15 változás: globális, nem egyszeri némítás.

Lásd [Beszélgetések](/docs/hu/daily/conversations/).

### Auto-adoption kapu (skill curator)

A generált / evolvált készségek **nem kerülnek automatikusan** élőbe, hacsak egy friss privát benchmark snapshot el nem éri a min. **pass ratio** és **átlag score** küszöböt. A manuális létrehozás/engedélyezés ettől független.

## Mezők és vezérlők

<h2 id="list-chrome">Lista</h2>

| Vezérlő | Jelentés |
|---------|----------|
| **engedélyezve** | Hány készség van bekapcsolva |
| **Új készség** | Létrehozó űrlap |
| Keresés | *Keresés név vagy trigger minta szerint…* |
| Szűrő **Összes / Saját skillek / Beépített** | Forrás |

<h2 id="sources">Források</h2>

| Címke | Jelentés |
|-------|----------|
| **Beépített** | Az EYAS-szal szállított |
| **Saját** | Te hoztad létre a UI-ban |
| **Generált** | Generálás / evolúció |
| **Saját** (kategória) | Importált vagy javasolt „own” |

<h2 id="create-form">Űrlap</h2>

| Mező | Jelentés |
|------|----------|
| **Készség neve** | Megjelenő név |
| **Trigger minták (vesszővel elválasztva)** | Mikor jöhet szóba |
| **Készség tartalma / sablon** | Markdown, amit az agent betölt |

<h2 id="row-actions">Sor műveletek</h2>

| Vezérlő | Jelentés |
|---------|----------|
| **Tartalom mutatása / Tartalom elrejtése** | Markdown kinyitása |

Üres: *Nincs készség. Hozz létre egyet a kezdéshez.*

### Bundled coding skill (példa)

| Útvonal | Cél |
|---------|-----|
| `coding/odoo/odoo-dev-chain` | Odoo implement/review: előbb `odoo_search_*` + file toolok |

A toolokat az agent tool-listája adja ([Konfiguráció](/docs/hu/agents/configure/), [Eszközök](/docs/hu/automation/tools/)).

## Skill leltár és „halott skill” detektor

A **Leltár** fül soronként mutatja: melyik másolat nyert, mit fed el, honnan jött, mennyit használták, engedélyezve van-e.

### Precedencia

Azonos skill-id esetén fix sorrend — sosem a fájlrendszer sorrendje:

**User > Generated > Imported (`skills.importRoots`) > Bundled (bővítmény) > Bundled (EYAS)**

Egyenlőségnél ABC: előbb a forrás-gyökér, aztán az út. A vesztesek **Elfedve** oszlopban maradnak.

<h3 id="import-roots">Extra skill-gyökerek</h3>

A host skillöket **ne** a Claude `settingSources` visszakapcsolásával hozd be — az izoláció maradjon ki. Extra markdown mappák a példány `local.yaml`-jában:

```yaml
skills:
  importRoots: []    # extra skill mappák (üres = nincs)
agent:
  importRoots: []    # extra persona / agent markdown
```

Alap: **üres lista**. Az útvonalak a példányon vannak, soha a szállított `src/`-ben. Az importált skill a fenti létrán a core fölött nyer. Lásd [Konfiguráció](/docs/hu/deploy/configuration/).

### A detektor csak javasol, sosem cselekszik

Háttérben átnézi az engedélyezett készségeket, és amit megjelöl, arra javaslatot tesz az [autonómia jóváhagyási sorba](/docs/hu/agents/autonomy/). **Letilt, sosem töröl.** A jóváhagyás csak a kapcsolót billenti — a fájl megmarad.

| Osztály | Miért | Alap |
|---------|-------|------|
| **árva** | a forrásfájl nincs meg | tény |
| **elfedett** | másik forrás mindig nyer | tény |
| **sosem használt** | 0 használat, 90 napnál régebbi | következtetés |
| **alvó** | volt használat, 180+ napja üres | következtetés |

(Alapértelmezések — példányonként állíthatók.)

Árva/elfedett azonnal javasolt. Sosem-használt/alvó: 30 napos türelem, és a saját (user) készségeid — plusz a szándékosan alvó runbookok — ki vannak véve az időalapú szabályok alól.

Ez a lifecycle másik vége az **auto-adoption kapuhoz** képest: az beenged, ez kilépést javasol.

## Kapcsolódó

- [Eszközök](/docs/hu/automation/tools/)
- [Öntanulás és skill-evolúció](/docs/hu/automation/self-learning/)
- [Autonómia](/docs/hu/agents/autonomy/)
- [Beszélgetések](/docs/hu/daily/conversations/)
- [Kutatás](/docs/hu/automation/research/)
