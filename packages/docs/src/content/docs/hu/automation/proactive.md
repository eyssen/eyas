---
title: Proaktív asszisztens
description: Heartbeat-alapú riasztások, insightok és tanult leckék — az asszisztens, ami előhozza a munkát.
---

**Mire való.** A proaktív asszisztens figyeli, minek kell rád: lejárt beszélgetés, avult szál, anomália, lehetőség, emlékeztető. Nem helyettesíti a Táblát vagy a Kezdőlapot. A Kezdőlap **Figyelem** csempéje ugyanazokat a riasztásokat mutathatja; ez az oldal a teljes lista plusz **Tanult leckék**. A heartbeat maradjon **ki**, amíg nem érted a jóváhagyást és a költséget — ütemezett, fizetős modellhívásokat indít.

**Útvonal:** `/proactive`. Cím: **Proaktív irányítópult**. Alcím: *Aktív riasztások, insightok és tanult minták.* A Dashboard **Figyelmet igényel → Riasztás** tételein is megjelenik.

## Mikor használd

- Nudget akarsz, ha a munka lejárt vagy a beszélgetés avult.
- Bekapcsoltad a **Proaktív heartbeat**et az Autonómiánál, és kell az operátori felület.
- Egyszeri **Ellenőrzés most**, nem a következő heartbeat.
- Leckéket nézel, amiket korábbi riasztásokból tanult.

## Tipikus folyamat

1. **Proaktív heartbeat** az [Autonómia](/docs/hu/agents/autonomy/) alatt (Beállítások → Autonómia) csak ha akarsz háttérköltséget.
2. Nyisd a **Proaktív**at (`/proactive`).
3. **Aktív riasztások.** Prioritás: **Sürgős / Magas / Normál / Alacsony**. Típus: anomália, lehetőség, emlékeztető, insight.
4. **Ellenőrzés most** azonnali értékelés. Üres: *Minden rendben — nincs aktív riasztás*.
5. **Tanult leckék** — már alkalmazott minták (bizalom %).

## Funkciók

Bekapcsolva az Autonómiánál az EYAS periodikusan értékeli, értesítsen-e vagy cselekedjen (policy szerint).

A heartbeat **SLA breach** jeleket (`slaBreaches`) is kibocsáthat.

| Jel | Jelentés |
|-----|----------|
| **Overdue** | Beszélgetés / activity a határidőn túl |
| **Stale** | Túl régóta tétlen, de nyitott / dolgozik |

Operátori figyelem — Tábla-prioritás és [Kezdőlap](/docs/hu/daily/home/) ajánlások mellett.

## Mezők és vezérlők

<h2 id="alerts">Aktív riasztások</h2>

| Vezérlő | Jelentés |
|---------|----------|
| **Ellenőrzés most** | POST `/proactive/check` |
| **N sürgős** | Sürgős + magas darabszám |
| Prioritás | **Sürgős / Magas / Normál / Alacsony** |
| Típus | anomaly · opportunity · reminder · insight |
| Cím / törzs | Szöveg |
| Opcionális gomb | `actionLabel` — URL ha van |
| Időbélyeg | Létrehozás |

<h2 id="lessons">Tanult leckék</h2>

| Mező | Jelentés |
|------|----------|
| Cím / összefoglaló | Szöveg |
| **N% bizalom** | Mennyire biztos |
| Alkalmazva | Ha van |

Üres: *Még nincs tanult lecke.*

## Kapcsolódó

- [Autonómia](/docs/hu/agents/autonomy/)
- [Kezdőlap](/docs/hu/daily/home/)
- [Beszélgetések](/docs/hu/daily/conversations/)
- [Öntanulás](/docs/hu/automation/self-learning/)
- [Ütemező](/docs/hu/automation/scheduler/)
