---
title: Hangprofilok
description: Hogyan beszéljen az agent belül vs kívül — hat dimenzió, presetek, AUTO.
---

**Mire való.** A hang az, *hogyan* beszél az agent, nem *mit* tud. Minden agentnek két profilja van: **Internal communication** (te és a csapat) és **External communication** (ügyfelek, idegenek, nyilvános csatornák). A futásidő **AUTO**-t választ, hacsak a beszélgetésen nem írod felül a scope-ot.

## Mikor használd

- A csapattal más hangon akarsz beszélni, mint az ügyféllel.
- Presetből indulsz (Jarvis, Diplomat, Coach, …), aztán egy dimenziót finomítasz.
- Tiltott kifejezések kellenek (üres bocsánatkérés) vagy záró **Signature**.
- Egy beszélgetésnek Internal vagy External legyen, a defaulttól függetlenül.

## Tipikus munkafolyamat

1. Nyisd az **Agentek** listát → az agent → **Voice** fül — útvonal `/agents/:id`.
2. Válassz **Internal preset**et és **External preset**et, vagy hagyd **Custom**-on mezőszerkesztés után.
3. Állítsd a hat dimenziót mindkét blokkon, plusz **Blocked phrases** és **Signature**. **Save voice profile**.
4. A beszélgetésen a **Voice · INTERNAL / EXTERNAL / AUTO** badge-nek egyeznie kell; ott írd felül, ha ez a szál kivétel.

## Funkciók

| Profil | Mikor |
|--------|-------|
| **Internal communication** | Veled és a csapattal |
| **External communication** | Ügyfelek, idegenek, nyilvános csatornák |

A futásidő kontextusból választ (**AUTO**), hacsak a beszélgetésen nem írod felül.

## Presetek

**Internal preset** / **External preset** / **Custom** (mezőszerkesztéskor automatikus).

| Preset | Karakter |
|--------|----------|
| Jarvis | Formális, tömör, professzionális |
| Best buddy | Baráti, kiegyensúlyozott |
| Senior CEO | Komoly, nagyon direkt |
| Buddy Dev | Laza, fejlesztős |
| Standup | Játékos, provokatív |
| Diplomat | Formális, részletező |
| Coach | Direkt, motiváló |
| Tutor | Baráti, részletező |

## Dimenziók

| Dimenzió | Értékek |
|----------|---------|
| **Address** | Tegező · Magázó (maga) · Magázó (ön) · Kontextus-érzékeny |
| **Tone** | Komoly · Kiegyensúlyozott · Baráti · Laza · Játékos |
| **Verbosity** | Tömör · Kiegyensúlyozott · Részletes |
| **Directness** | Nagyon direkt · Direkt+udvarias · Diplomatikus · Közvetett |
| **Humor** | Nincs · Száraz/szellemes · Könnyed · Csípős |
| **Emoji** | Soha · Funkcionális · Gyakran |

Belső és külső blokkban külön állítható.

## Extra

| Mező | Jelentés |
|------|----------|
| **Blocked phrases** | Tiltott kifejezések (soronként) |
| **Signature** | Aláírás sor |
| **Save voice profile** | Mentés |

## Kapcsolódó

- [Beállítás](/docs/hu/agents/configure/)
- [Beszélgetések — voice scope](/docs/hu/daily/conversations/)
