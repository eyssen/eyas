---
title: Projektek
description: Beszélgetések csoportosítása típusokba, projektekbe és közös stage-ekbe — default ágenssel és kódforrásokkal.
---

**Mire való.** A projektek a beszélgetések csoportosítása. A **projekt típus** a sablon; a **projekt** a példány (default ágens, prompt, kódforrások); a **stage-ek** a közös kanban-oszlopok, amiket minden projekt használ. A Tábla-kártyák és a chat **Project** / **Stage** mezői ez a szerkezet.

## Mikor használd

- Új munkaterület kell saját default ágenssel és (Odoo-nál) default kódfákkal.
- Újrafelhasználható típust akarsz (prioritás, ikon, prompt), hogy az új projektek egyformán induljanak.
- Stage-et akarsz hozzáadni, behajtani vagy lezárni, amit minden tábla mutat.
- A projektben létrehozott beszélgetések automatikusan örököljék az indexelt forrásokat.
- Egy stage-be lépő kártyához automatikusan ágens rendelődjön.

## Tipikus munkafolyamat

1. Nyisd a **Beállítások → Projektek** menüt (oldalsáv **Beállítások**, **Modulok** csoport) — útvonal `/projects`.
2. Hozz létre **Project Type**-ot, ha sablon kell, majd **New Project** (név, típus, default ágens, opcionális **Default code sources**).
3. A **Stages** alatt adj hozzá vagy rendezd az oszlopokat (**Closed**, **Folded**, **Bot**, **Auto-assign**).
4. Nyisd a **Táblát**, válaszd a projektet — ezeket a stage-eket kell oszlopként látnod, és egy új beszélgetésnek ugyanazokat a kódforrásokat kell rögzítenie.

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
| **Prompt** | Nem | Extra system prompt a projekt beszélgetéseihez |
| **Prompt coach** | — | AI coach a projekt operating briefhez — [Prompt rendszer](/docs/hu/ai/prompts/) |
| **Alapértelmezett kódforrások** | Nem | Multi-select a [Search Sources](/docs/hu/daily/search/) közül. **Új conversation** a projecten, illetve a conversation **Project** mezőjének erre állításakor automatikusan ez a pin kerül a **Források** fülre |
| Badge **N forrás** | — | Hány default code source van kijelölve |

### Alapértelmezett kódforrások (többverziós Odoo)

1. Regisztráld a checkoutokat a **Search Sources**-ban (egy source = egy verzió, **Label** + **Family: odoo**).
2. **Reindex** → **ready**.
3. Project űrlapon pipáld a default forrásokat.
4. Conversation → jobb panel **Források** — a pin megjelenik; conversation-szinten felülírható.

Lásd [Keresés — multi-version pin](/docs/hu/daily/search/).

## Project Type mezők

Name, Default Priority (Low→Urgent), Icon (+ Clear), Prompt, **Prompt coach** (típus-defaultok), Color.

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
