---
title: Meetingek
description: Meetingfelvételek beolvasása (Fireflies és hasonlók) átiratba, összefoglalóba és action itemekbe.
---

**Mire való.** A Meetingek a felvételek ingest felülete: meetingek listázása, átiratok és összefoglalók húzása a providertől, action itemek a többi munka mellett. A termék-UI még **Coming Soon**; a backend provider (Fireflies) már be van kötve, és API-kulcs nélkül fail-closed.

## Mikor használd

- Fireflies (vagy későbbi provider) meetingjeit az EYAS-ban akarod látni, nem csak a vendor appjában.
- Átirat, összefoglaló vagy action-item lista kell a Tábla follow-upjai mellett — ha az ingest kész.
- Azt ellenőrzöd, miért üres a lista: nincs `fireflies-api-key` secret, vagy még a tervezett banner van kint.

## Tipikus munkafolyamat

1. Nyisd a **Beállítások → Megbeszélések** menüt (oldalsáv **Beállítások**, **Infrastruktúra** csoport) — útvonal `/meetings`.
2. Olvasd a **Coming Soon** / **Planned** bannert: *Meeting integration is under development. Connect your meeting provider in a future update.*
3. Ha Fireflies-kulcs van `fireflies-api-key` secretként (system scope), az API listázhat; az oldal akkor táblázatot mutat. Kulcs nélkül a provider unconfigured marad, üres listát ad — soha nem hamisít átiratot.
4. Vagy az üres állapotot kell látnod (*No meetings recorded yet*), vagy sorokat címmel, dátummal, időtartammal, résztvevőkkel és státusszal.

## Funkciók

Alcím az appban: *Meeting recordings, transcripts, and action items.*

| Vezérlő / oszlop | Jelentés |
|------------------|----------|
| **Coming Soon** + **Planned** | A UI még fejlesztés alatt |
| **Title** | Cím |
| **Date** | Dátum |
| **Duration** | Perc |
| **Participants** | Létszám |
| Status | Provider státusz |

A Fireflies-adapter rögzített GraphQL hostot hív, SSRF-safe fetchen át. Unconfigured: üres lista; a detail hívás „not configured” hibát ad. Nincs mock adat.

## Kapcsolódó

- [Tábla](/docs/hu/daily/board/)
- [Titkok](/docs/hu/admin/secrets/)
- [Memória](/docs/hu/knowledge/memory/)
