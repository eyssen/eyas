---
title: Projektek
description: Beszélgetések csoportosítása típusokba, projektekbe és közös stage-ekbe — default ágenssel és kódforrásokkal.
---

**Mire való.** A projektek a beszélgetések csoportosítása. A **projekt típus** a sablon; a **projekt** a példány (default ágens, prompt, kódforrások); a **stage-ek** a közös kanban-oszlopok, amiket minden projekt használ. A Tábla-kártyák és a chat **Project** / **Stage** mezői ez a szerkezet.

## Mikor használd

- Új munkaterület kell saját default ágenssel, munkakönyvtárakkal és (opcionálisan) default kódfákkal.
- Újrafelhasználható típust akarsz (prioritás, ikon, prompt, munkakönyvtárak), hogy az új projektek egyformán induljanak.
- A projektben létrehozott beszélgetések automatikusan örököljék az indexelt forrásokat és a mappákat.
- Lezárt ticketek vagy csapatdöntések a projekt wikijére kerüljenek (projektenként opt-in).
- Egy stage-be lépő kártyához automatikusan ágens rendelődjön.

## Tipikus munkafolyamat

1. Nyisd a **Beállítások → Projektek** menüt (oldalsáv **Beállítások**, **Modulok** csoport) — útvonal `/projects`.
2. Hozz létre **Project Type**-ot, ha sablon kell (prompt, opcionális **Munkakönyvtárak**), majd **New Project** (név, típus, default ágens, opcionális **Munkakönyvtárak**, opcionális **Default code sources**, opcionális **Wiki auto-update**).
3. A **Stages** alatt adj hozzá vagy rendezd az oszlopokat (**Closed**, **Folded**, **Bot**, **Auto-assign**).
4. Nyisd a **Táblát**, válaszd a projektet — ezeket a stage-eket kell oszlopként látnod. Az új beszélgetés ugyanazokat a kódforrásokat pineli, és a munkakönyvtárakat másolja. A projektkártya **Wiki** linkje a `/projects/:projectId/wiki` oldalt nyitja.

## Funkciók

Alcím az appban: *Projekt típusok, projektek és stage workflow-k.*

## Szekciók

| Szekció | Cél |
|---------|-----|
| **Projects** | Projekt példányok |
| **Project Types** | Sablonok új projektekhez |
| **Stages** | Globális workflow stage-ek |

## Project mezők

| Mező | Kötelező | Jelentés |
|------|----------|----------|
| **Name** | Igen | Megjelenített név |
| **Type** | Igen | Projekt típus |
| **Description** | Nem | Rövid leírás |
| **Color** | Nem | Szín |
| **Default Agent** | Igen | Új beszélgetések ágense |
| **Prompt** | Nem | Extra system prompt. Üres = a típus briefje. `+` előtag = kiterjeszti. Minden más = felülírja. Az űrlap az, amit a modell lát; nemüres mentés `AGENTS.md`-t is ír (üres prompt törli). |
| **Prompt coach** | — | AI coach a projekt operating briefhez — [Prompt rendszer](/docs/hu/ai/prompts/) |
| **Munkakönyvtárak** | Nem | Elnevezett gyökerek (`Név` + abszolút path). Az első a **Fő**. Az új beszélgetések ezt öröklik. Üres lista a **típus** listáját másolja. Ha nincs path, minden beszélgetés a saját EYAS workspace-ében dolgozik ([Mappák](/docs/hu/daily/conversations/#working-folders)). |
| **Alapértelmezett kódforrások** | Nem | Multi-select a [Search Sources](/docs/hu/daily/search/) közül. **Új conversation** a projecten, illetve a conversation **Project** mezőjének erre állításakor automatikusan ez a pin kerül a **Források** fülre |
| **Wiki auto-update** | Nem | Alapból ki. **Lezárt ticketek** és **Csapatdöntések** külön. **Ticket-oldal törzse**: **Csak cím** / **Utolsó forduló** / **Teljes beszélgetés**. A gyűjtő **General** projekt soha nem kap oldalt. |
| **Wiki** | — | A projekt wikioldala |
| Badge **N forrás** | — | Hány default code source van kijelölve |

### Alapértelmezett kódforrások (többverziós Odoo)

1. Regisztráld a checkoutokat a **Search Sources**-ban (egy source = egy verzió, **Label** + **Family: odoo**).
2. **Reindex** → **ready**.
3. Project űrlapon pipáld a default forrásokat.
4. Conversation → jobb panel **Források** — a pin megjelenik; conversation-szinten felülírható.

Lásd [Keresés — multi-version pin](/docs/hu/daily/search/).

<h3 id="working-directories">Munkakönyvtárak</h3>

Hol olvashatnak és írhatnak a projekt beszélgetései. Ugyanez a forma a **típuson** (új projektek defaultja) és a **projekten** (felülírja a típust). A beszélgetés a **Munkakönyvtárak** vezérlőn még pinelheti, melyik a fő.

Az útvonalak példányadatok — soha nem termék-defaultok.

**Mely mappák menthetők.** A projekt, a projekttípus és a beszélgetés Mappái ugyanazt az ellenőrzést használják. Mentéskor az EYAS elutasít egy mappát, megnevezi, és a nyelveden megadja az okát: a fájlrendszer gyökere, a home mappád vagy bármely fölötte lévő mappa; egy másik AI-eszköz saját tárolóján belüli mappa (`~/.claude`, `~/.grok`, `~/.codex`, `~/.cursor`, …) vagy az EYAS CLI-bejelentkezési home-jai; Obsidian vaulton, `ai-memory` mappán vagy `security.foreignMemoryPaths` bejegyzésen belüli mappa; az EYAS saját adatmappáján belüli mappa (kivéve egyetlen beszélgetés-workspace-t, a Studio projekteket és a böngészőletöltéseket); érzékeny helyek (`.ssh`, `.env`, `master.key`, az adatbázis mappája); valamint relatív útvonal, nem létező mappa vagy fájl. Az a mappa is elutasításra kerül, amely ilyen helyet **tartalmaz**, és az üzenet megnevezi, mit talált benne: az EYAS saját home-ját, adatmappáját, adatbázisát vagy workspace-mappáját (az EYAS checkoutot, amelyben a `data/` van), egy másik AI-eszköz tárolóját vagy egy EYAS-os CLI-bejelentkezési mappát, egy jegyzet-vaultot, egy `ai-memory` mappát vagy egy `security.foreignMemoryPaths` bejegyzést (egy vaultot tartalmazó `~/Documents`). Egy CLI kérdezés nélkül olvas és keres a munkamappáján belül, ezért egy ilyen mappát nem biztonságos átadni; válassz szűkebbet, például a `~/Documents` alatti projektmappát vagy a repó egy külön klónját. A teljes lista: [Beszélgetések — Mappák](/docs/hu/daily/conversations/#working-folders).

Minden mentés a teljes listát ellenőrzi, ezért egy már elutasított mappát előbb vegyél ki, mielőtt más változást mentenél. A korábban mentett, most elutasított mappákat az EYAS nem írja át, de minden futás kihagyja őket — az EYAS saját fájltooljai, a biztonsági kapu és a CLI munkamappája —, és a chatben a kör egy értesítést mutat, amely megnevezi a mappát. Ha minden tárolt mappa elutasításra kerül, az EYAS saját fájltooljainak nincs mappájuk, a CLI pedig a beszélgetés saját EYAS workspace-ében dolgozik. A **Project Types** űrlap mostantól az űrlapon mutatja a mentési hibát (korábban a sikertelen mentés néma volt). Az API a `POST`/`PATCH /api/v1/projects` és `/api/v1/project-types` hívásra elutasított mappánál `400 {error, code, path, found}` választ ad (a `found` a mappán belüli védett hely a `containsEyasData`, `containsProviderHome` és `containsVault` kódnál); a nem üres útvonalakból álló listától (vagy `null`-tól) eltérő `workingDirectories` érték kód nélküli `400`, a `null` vagy a `[]` pedig továbbra is üríti a listát.

<h3 id="wiki-auto-update">Wiki auto-update</h3>

Alapból ki. **Lezárt ticketek** és/vagy **Csapatdöntések** csak ezen a projekten. Lezárt táblakártya → `ticket-<id>`, ha a ticketek be vannak kapcsolva. Team-session findings/döntés → `decision-<id>`, ha a döntések be vannak kapcsolva (különben a vault promoter fut). Az UI-n mentett wiki oldal átveszi a tulajdont — későbbi auto-update nem írja felül. Részletek: [Projekt-wiki](/docs/hu/knowledge/client-wiki/).

## Project Type mezők

Name, Default Priority (Low→Urgent), Icon (+ Clear), Prompt, **Prompt coach** (típus-defaultok), **Munkakönyvtárak** (új projektek default mappái), Color.

## Stage mezők

| Mező | Jelentés |
|------|----------|
| **Name** | Oszlop cím a Boardon |
| **Closed** | Végső (kész) stage |
| **Folded** | Alapból összecsukott oszlop |
| **Bot** | AI figyeli a stage-et |
| **Auto-assign** | Belépő kártyák ágense (+ autonóm futtatás); `None` = ki |

Húzással rendezhető a sorrend.

## Kapcsolódó

- [Tábla](/docs/hu/daily/board/)
- [Beszélgetések](/docs/hu/daily/conversations/)
- [Keresés](/docs/hu/daily/search/)
- [Projekt-wiki](/docs/hu/knowledge/client-wiki/)
- [Prompt rendszer](/docs/hu/ai/prompts/)
