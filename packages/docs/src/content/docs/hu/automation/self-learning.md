---
title: Öntanulás és skill-evolúció
description: Használati insightok, skill-javaslatok és emberi review-ra váró jelöltek.
---

**Mire való.** Két operátori felület. **Öntanulási insightok** (`/self-learning`) a tokenköltést és a visszatérő mintákat mutatja. **Skill-evolúció** (`/skill-evolution`) az AI-javasolt új készségek emberi kapuja. Semelyik nem ír viselkedést jóváhagyásig. Az autonómia-hurkokat csak akkor kapcsold be, ha akarsz háttérjavaslatokat — fizetős modellhívások.

**Útvonalak:** `/self-learning` (menü **Öntanulás**), `/skill-evolution`.

## Mikor használd

- Heti hatékonyság: token, költség, session, sikerarány.
- Ismétlődő munka skillé válhat — javaslatot akarsz, nem csendes auto-írást.
- A Skill-evolúción pending jelöltek vannak: **Jóváhagyás** vagy **Elutasítás**.
- A [Forge](/docs/hu/agents/forge/) identity/soul oldala mellé a skill-oldali megfelelő.

## Tipikus folyamat

1. **Öntanulás** (`/self-learning`): négy összefoglaló kártya, majd **Végrehajtási insightok**, **Tevékenységminták**, **Skill-javaslatok**.
2. **Elemzés futtatása** friss körhöz (`POST /self-learning/analyze`).
3. **Skill-evolúció** (`/skill-evolution`): **Függőben / Jóváhagyva / Elutasítva**.
4. **Részletek**, indoklás és javasolt tartalom, majd **Jóváhagyás** (katalógusba, még az [auto-adoption kapun](/docs/hu/automation/skills/) át) vagy **Elutasítás**.
5. Ellenőrzés a [Készségek](/docs/hu/automation/skills/) → **Leltár** alatt.

## Funkciók

| Terület | Jelentés |
|---------|----------|
| Insightok | Használatból tanult minták |
| Skill-javaslatok | Név + indok az insight oldalon — még nem jelölt |
| Skill-evolúció | Javasolt skill-fájlok tartalommal, bizalommal, session-számmal |
| Review / apply | Emberi kapu |

**Melyik modell írja őket.** Az öntanulási javaslatok, a Forge leírás-javaslatai és a Skill-evolúció skill-írása az EYAS háttérmodelljén futnak, mindegyik egy izolált hívásban: a **Heartbeat** routing-szint (elsődleges, majd tartalék), utána a telepítés alapértelmezése, utána az API providerek, végül az izolált hívásra képes CLI-k. Soha nem kerülnek olyan providerhez, amelyet a gateway magától választ. Ha egyik modell sem jogosult (például csak Grokos vagy csak Kimis telepítésen, amíg az izolációjuk nincs ellenőrizve), vagy a költségkeret *stop* állásban van, nincs modellhívás: az Öntanulás az általános javaslatmondatait mutatja, a Forge megtartja az összefűzött leírás-javaslatot, a Skill-evolúció pedig a sablon `SKILL.md`-t írja. Ezeket a hívásokat továbbra is az Autonómia feature flagjei kapuzzák. Lásd [Routing és költségkeret — A háttérmodell](/docs/hu/ai/routing-budget/#background-model).

## Mezők és vezérlők

<h2 id="insights">Öntanulási insightok (`/self-learning`)</h2>

Alcím: *Hatékonysági jelentések, tevékenységminták és optimalizálási javaslatok.*

| Vezérlő | Jelentés |
|---------|----------|
| **Elemzés futtatása** | Friss elemzés |
| **Összes token** | Heti riport |
| **Összes költség** | USD a heti riportban |
| **Munkamenetek** | Session szám |
| **Sikerarány** | Sikeres sessionök aránya |

**Végrehajtási insightok** — **Optimalizálás / Költség / Minőség / Sebesség**, current vs suggested, bizalom, indoklás. Üres: *Még nincs insight. Futtass elemzést.*

**Tevékenységminták** — név, kategória, látva N×, utoljára. Üres: *Még nincs tevékenységminta.*

**Skill-javaslatok** — név, leírás, indok, bizalom. Üres: *Még nincs skill-javaslat.* Ezek javaslatok; reviewolható jelöltté a Skill-evolúción válnak.

<h2 id="skill-evolution">Skill-evolúció (`/skill-evolution`)</h2>

Alcím: *AI-javasolt készségjelöltek használati minták alapján.*

| Vezérlő | Jelentés |
|---------|----------|
| Stat | **Függőben / Jóváhagyva / Elutasítva**, **Átlagos bizalom** |
| Keresés | *Jelöltek keresése…* |
| Szűrő **Összes / Függőben / Jóváhagyva / Elutasítva** | Státusz |
| **N munkamenet** | Hány sessionre épül |
| **Részletek mutatása / elrejtése** | Indoklás + javasolt tartalom |
| **Jóváhagyás / Elutasítás** | Emberi döntés |

Üres: *Még nincs skill-evolúciós jelölt. A rendszer a használati mintáid alapján javasol új készségeket.*

## Kapcsolódó

- [Készségek](/docs/hu/automation/skills/)
- [Forge](/docs/hu/agents/forge/)
- [Autonómia](/docs/hu/agents/autonomy/)
- [Proaktív](/docs/hu/automation/proactive/)
