---
title: Futtatások és Mission Control
description: Élő agent-futások felügyelete — leállítás, folytatás, újrapróbálás — és az élő ops tábla.
---

**Mire való.** Az **Agent-futások** a végrehajtások táblája: élő és kész, státusszal, verifikációval, körökkel, tokenekkel és műveletekkel. Az **Irányítóközpont** az élő kártyatábla — ki fut, ki vár rád, ki van szünetelve. A tábla a történelemhez és a helyreállításhoz; az Irányítóközpont a mostani pillanathoz.

## Mikor használd

- A futás elakadt, elérte a max kört, vagy megbukott — **Folytatás** (checkpoint) vagy **Újra** (a céltól).
- Valami fut, és leállítás kell a beszélgetés megnyitása nélkül.
- Látni akarod, a teljesség-kritikus **Cél teljesült** / **Cél nem teljesült** jelzést adott-e.
- Összesítők kellenek: fut, jóváhagyásra vár, ma kész, mai költség.
- Szünet, megszakítás, vagy a beszélgetés megnyitása élő kártyáról.

## Tipikus munkafolyamat

1. Nyisd az **Agent-futások** menüt az oldalsávon (**AI** szakasz) — útvonal `/agent-runs`. Vagy az **Irányítóközpontot** a **Megfigyelés** alatt — útvonal `/mission-control`.
2. Az Agent-futásokon nézd a **Státusz**t és a **Verifikáció**t. Aktív sornál leállítás; **Sikertelen / Beragadt / Megszakítva / Kör-limit** sornál **Folytatás** vagy **Újra**.
3. Az Irányítóközponton olvasd az összesítő sávot, majd a kártyán **Szüneteltetés**, **Folytatás**, **Megszakítás**, **Beszélgetés megnyitása**.
4. A sor/kártya státuszának élőben kell változnia. A beszélgetés megnyitása ugyanannak a futásnak a progresszét, run tree-jét és tool-hívásait mutatja.

## Funkciók

## Agent Runs

**Útvonal:** `/agent-runs`. Alcím: *Élő felügyelet — az elakadt futások észlelhetők és leállíthatók.* Üres: *Még nincsenek agent-futások.*

| Oszlop | Jelentés |
|--------|----------|
| **Státusz** | Lásd alább |
| **Verifikáció** | Teljesség-kritikus: **Cél teljesült** / **Cél nem teljesült** / **Nem ellenőrzött** (vagy — ha soha nem nézték) |
| **Agent** | Agent azonosító |
| **Kind** | Futás típusa (vagy —) |
| **Turns** | Felhasznált körök |
| **Tokens** | Tokenek |
| **Last progress** | Utolsó heartbeat óta |
| Műveletek | Leállítás (aktív) · **Folytatás** · **Újra** |

### Státuszok

**Fut · Beragadt · Frissül · Jóváhagyásra vár · Kész · Kör-limit · Sikertelen · Megszakítva**

**Folytatás** az utolsó checkpointtól (ne-ismételd). **Újra** a céltól tervez újra; a már lefutott destruktív hívások védve maradnak.

## Mission Control

**Útvonal:** `/mission-control`. Alcím: *Az összes futó agent élő nézete.* Üres: *Egy agent sem fut.* **Disconnected — reconnecting…** ha a socket le van szakadva.

Összesítők: **Running · Waiting approval · Completed today · Cost today**. Kártyaműveletek: **Pause / Resume / Interrupt / Open conversation** (tulajdonos vagy admin).

Az Irányítóközpont a mostani pillanathoz; az Agent-futások a történelemhez és a helyreállításhoz.

## Beszélgetésben

Agent progress, run tree, tool hívások — [Beszélgetések](/docs/hu/daily/conversations/).

## Kapcsolódó

- [Kezdőlap](/docs/hu/daily/home/)
- [Autonómia](/docs/hu/agents/autonomy/)

## Arculati megfelelés

Ha egy háttérfutás olyan projektben dolgozik, amelyhez arculat tartozik, és
olyasmit állít elő, amire az arculat vonatkozik — renderelt oldal, e-mail
piszkozat, dokumentum, design-vászon —, egy ellenőrzés összeveti az eredményt az
arculattal, és a konkrét eltéréseket egyszer visszaadja az ügynöknek. „A címsor
#ff0000-t használ; az arculat elsődleges színe #1f4ed8" — ilyen megjegyzést ad,
nem azt, hogy „legyen szebb".

Csak akkor fut, ha a teljességi ellenőrzés már átment. Aki nem fejezte be a
munkáját, annak nem a színeiről beszélünk.

Tudatosan puha. Sosem buktat el olyan futást, amit nem lehetett ellenőrizni —
nincs modell, nincs arculat, nincs arculat-jellegű kimenet —, mert a munka már
kész, és egy szín nem ér annyit, hogy visszavonjuk. Az arculat **keményen** a
kereten van kikényszerítve: az e-mail-héj, az értesítés-sablonok és a branded-HTML
tool determinisztikusan az arculatból épül, és ebből egy ügynök sem tudja
kibeszélni magát.

A teljességi ellenőrzéssel közösen egyetlen visszaadást használ futás-vonalanként,
tehát a kettő együtt sem tudja oda-vissza pattogtatni a futást. Kikapcsolás:
`agent.brandCriticEnabled: false`.
