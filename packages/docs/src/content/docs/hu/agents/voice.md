---
title: Hangprofilok
description: Belső és külső hang — dimenziók, presetek, tiltott kifejezések, aláírás.
---

**Útvonal:** `/agents/:id` → **Voice**.

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
