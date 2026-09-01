---
title: Média
description: Csatlakoztasd a Magnific, Higgsfield vagy fal szolgáltatást. Az ágensek öt közös toolon generálnak. Hasonlítsd össze a backendeket, és válassz egyet — vagy többet.
---

**Mire való.** A Média az, ahogy az EYAS képet, videót, hangot, szerkesztést és 3D-t generál, nagyít, és megvár. Te választod a backendeket; az ágens **egy tool-készletet** használ. A három vendor közül egyik sem alapértelmezett. Nulla csatlakoztatott provider üres, fail-closed állapot — soha nincsenek hamis pixelek.

**Útvonal:** `/media`. Oldalsáv: **Média** (a Providerek után). Cím: **Média**.

## Mikor használd

- Az ágensnek képet kell generálnia vagy nagyítania, videót készítenie, vagy hosszú jobot megvárnia.
- Van Magnific, Higgsfield vagy fal fiókod, és **nem** akarod a vendor 50 toolját a modellre önteni.
- A kreditek pénzbe kerülnek — napi/havi plafon vagy típusonkénti default kell.
- A kész fájlok a [Dokumentumokba](/docs/hu/knowledge/documents/) és a termelő chat-körre kerüljenek.

## Tipikus folyamat

1. Nyisd a **Médiát** (`/media`).
2. Olvasd el a **Melyik backend?** blokkot, majd **Csatlakozás** egy (vagy több) szolgáltatóhoz. Magnific és Higgsfield böngészős OAuth; fal API-kulcs.
3. Státusz: **Csatlakozva**. Állítsd az **Útválasztást** (alapértelmezett / tartalék / ezen is futtasd) típusonként, és opcionálisan a **Keretet**.
4. Kérdezz a beszélgetésben. Az ágens hívja: `media_catalog`, majd `media_generate`, majd `media_wait`.
5. Ha a job kész, az EYAS bemásolja a fájlt a Dokumentumokba, és a körhöz csatolja. A vendor CDN-URL lejár — a tárolt dokumentumra hagyatkozz, ne az URL-re.

## Melyik backend? {#compare}

A vendor-marketing táblák „célközönségről” és „webes UI vs API-ról” szólnak. Az EYAS-ban a hasznos kérdések mások: **mire a legerősebb, hogyan lépsz be, hogyan mennek a kreditek, és mi lesz a fájllal.**

| Szempont | Magnific | Higgsfield | fal |
|----------|----------|------------|-----|
| **Erősség** | Fotórealisztikus still, promptos **Creative** upscale, hű **Precision** upscale | Filmes videó, karakter-azonosság (Soul) | Óriás modellkatalógus, ár ellenőrzése futás előtt |
| **Típusok az EYAS-ban** | Nagyítás, kép, szerkesztés (videó / hang / 3D is) | Videó, kép (hang is) | Kép, videó, hang, 3D, nagyítás |
| **Belépés** | OAuth (Magnific-fiók) | OAuth (Higgsfield-fiók) | Bearer API-kulcs (`fal-api-key`) |
| **Kredit** | Ugyanaz az egyenleg, mint a Magnific-weben. A webes **Unlimited nem érvényes** MCP/API-ra | Az MCP **mindig** kreditet von, még unlimited webes csomagnál is | Maga az MCP ingyenes; a modellfutásért fizetsz |
| **Eredmény** | CDN-URL — az EYAS lemásolja | Az URL kb. **hét nap** múlva lejár — az ingest kötelező | CDN-URL — akkor is másoljuk |
| **Először ezt, ha…** | Nagyítás, retus, still kell | Klipp vagy rögzített karakter kell | Sok modell vagy előzetes ár kell |

**Ajánlás**

1. **Egy backendet köss be arra a munkára, ami tényleg van.** Still és nagyítás → Magnific. Videó / karakterzár → Higgsfield. Széles katalógus vagy „mennyibe kerül?” → fal.
2. **Másodikat akkor adj hozzá, ha a típus változik**, ne „hátha kell”. Az **alapértelmezett / tartalék** kiesést fed; az **Ezen is futtasd** *ugyanazt* a promptot extra vendorokra küldi, és **kétszeres kredit**. Hagyd üresen, hacsak nem kértél egymás melletti kimenetet.
3. **Ne kapcsold be a nyers vendor-MCP toolokat**, hacsak nem debugolsz. Az ágensre önti a Magnific/Higgsfield/fal tool-listát, és kikerüli az ingestet.

A kép és a prompt **elmegy erről a gépről** a csatlakoztatott vendorhoz. Úgy kezeld, mint minden más SaaS-t.

## Öt tool

| Tool | Cél | Kockázat |
|------|-----|----------|
| `media_generate` | Job indítása (`image`, `video`, `audio`, `upscale`, `edit`, `3d`) | sárga |
| `media_wait` | Vár, amíg a job véges (alap 180s, max 600s) | sárga |
| `media_catalog` | Modellek listája típusra — mielőtt id-t találsz ki | zöld |
| `media_balance` | Maradék kredit a csatlakoztatott provideren | zöld |
| `media_history` | Helyi, közelmúltbeli jobok | zöld |

Ha nincs provider, vagy nem csatlakoztatottra pinnes, strukturált hiba mutat a `/media` oldalra.

## Beállítások a `/media` lapon

**Útválasztás.** Egy sor típusonként. **Alapértelmezett**: ki futtatja, ha az ágens nem nevez meg providert. **Tartalék**: ha az alapértelmezett nincs csatlakoztatva. **Ezen is futtasd**: extra lista — csak fan-outhoz.

Javasolt defaultok (csak ha a provider csatlakoztatva van, és a sort nem pined): nagyítás / kép / szerkesztés → Magnific; videó → Higgsfield; hang / 3D → fal.

**Keret.** Opcionális napi és havi kreditplafon **providerenként**. A plafont túllépő hívás **a vendor előtt** elhasal. Ismeretlen kreditmennyiség nem blokkol.

**Nyers vendor-MCP toolok.** Alapból ki. Be = az ágens látja a `mcp_magnific_*` / `mcp_higgsfield_*` / `mcp_fal_*` toolokat is. Hagyd ki.

## Kredit és ingest

A kész jobok URL-jét letöltjük (max 200 MB, **nincs JPEG-újratömörítés**) a Dokumentumokba, a beszélgetéshez AI-forrásként kötjük, és a termelő kör csatolmányaihoz adjuk. A visszaadott `documentIds`-re hagyatkozz, ne a vendor URL-re.

Nagyításnál az **eredeti** fájlt küldd (`documentId` vagy URL). Ne JPEG-eld a canvas screenshotját.

## Hibaelhárítás

| Tünet | Mit próbálj |
|-------|-------------|
| A státusz **Nincs csatlakoztatva** marad OAuth után | Fejezd be a belépést a böngészőben, térj vissza a `/media` lapra. **Teszt**. |
| Az ágens azt mondja, nincs provider ehhez a típushoz | Kösd be a típust listázó backendet, vagy állíts defaultot. |
| A job kész, de nincs kép a chatben | Nézd a **Legutóbbi feladatokat** és a [Dokumentumokat](/docs/hu/knowledge/documents/). A vendor URL lejárhatott. |
| A kredit gyorsabban fogy a vártnál | Az **Ezen is futtasd** be van kapcsolva, vagy két provider van pinelve. Nézd a Keretet. |
| Az átirányítás az MCP Szerverekre visz | Nyisd a `/media` lapot, és **Teszteld** a kártyát. A Médiából csatlakozz, ne csak az MCP-katalógusból. |

## Kapcsolódó

- [MCP szerverek](/docs/hu/ai/mcp/) — a média által kezelt sorok: *A Beállítások → Média kezeli*
- [Eszközök](/docs/hu/automation/tools/)
- [Dokumentumok](/docs/hu/knowledge/documents/)
- [Kapcsolatok](/docs/hu/admin/connections/)
- [Providerek](/docs/hu/ai/providers/) — nyelvi modellek, nem képbackendek
