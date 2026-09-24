---
title: Setup varázsló
description: Első indítás varázsló — minden lépés, mező és vezérlő magyarázata.
---

**Mire való.** Csak az első indításkor. A varázsló létrehozza a mesterjelszót, a fő tulajdonost, a két elsődleges agentet és az első modell-backendet, hogy a fő alkalmazás megnyíljon. Utána ezeket a **Beállítások**, a **Providerek** és az **Agentek** alatt módosítod — ne számíts arra, hogy a varázslót újra futtatod.

## Mikor használd

- A böngésző a `/setup` oldalra küldött, mert a setup nincs kész
- Kihagytál egy opcionális lépést, és a mezőlistát keresed
- Friss példányt állítasz helyre

Nem napi változtatásokra, ha az alkalmazás már nyitva van.

## Tipikus munkafolyamat

A varázsló **egyszer** fut, amíg a setup nincs kész. A böngésző a `/setup` oldalra kerül, amíg a kötelező lépések el nem készülnek. Az opcionális lépések kihagyhatók, és később a Beállításokban pótolhatók.

Minden lépésen megjelenő vezérlők:

| Vezérlő | Jelentés |
|---------|----------|
| **Nyelv** | A felület nyelve (`en` / `hu` / `de` / `es` / `fr` / `tlh`). A böngésző nyelvi beállításában tárolódik. |
| **Megjelenés** | Témasablon (pl. Halo, Nebula) + világos/sötét kapcsoló. |
| *N. lépés / M* | Haladás a hátralévő lépéseken. |
| **Tovább / Beállítás befejezése** | Az aktuális lépés mentése és továbblépés. |

## Lépések sorrendje (tipikus)

| Sorrend | Lépés | Kötelező | Modul |
|--------:|-------|----------|-------|
| — | Megjelenés / nyelv (a felület kerete) | — | frontend |
| 1 | **Mesterjelszó** | Igen | secrets |
| 2 | **Fő tulajdonos** | Igen | auth |
| 3 | Elsődleges agentek (*A két állandó AI-munkatársad*) | Igen | auth |
| 4 | **Csapat-agentek** | Nem | auth |
| 5 | **AI Provider** | Általában | model |
| 6 | **AI modellek** | Általában | model |

A lépéseket a modulok regisztrálják induláskor. A kötelező lépések nélkül a fő alkalmazás nem nyílik meg.

## Mesterjelszó

**Cél:** az összes tárolt titok (API-kulcsok, tokenek) titkosítása tárolt állapotban.

| Mező | Kötelező | Leírás |
|------|----------|--------|
| **Mesterjelszó** | Igen | A titkosítókulcs anyagához tartozó jelmondat. Legyen erős; ha elveszíted, a provider-kulcsokat újra meg kell adni. |
| **Jelszó megerősítése** | Igen | Egyeznie kell a mesterjelszóval. |

E lépés után a felületen megadott titkok a titkosított Secrets tárba kerülnek.

## Fő tulajdonos

**Cél:** a fő emberi adminisztrátor létrehozása (`role: owner`, `is_root_owner`).

| Mező | Kötelező | Leírás |
|------|----------|--------|
| **Felhasználónév** | Igen | Bejelentkezési név (helyőrző: `admin`). Egyedinek kell lennie. |
| **Jelszó** | Igen | Fiókjelszó (hash-elve; soha nem tárolódik nyílt szövegként). |
| **Megjelenített név** | Nem | A felületen látszó név (üresen a felhasználónév). |

A varázsló a munkamenet hátralévő részére **memóriában** tartja az owner hitelesítő adatait, hogy a hitelesített ownert igénylő opcionális lépések újabb bejelentkezés nélkül lefuthassanak. Ha a varázsló közben újratöltesz, és már csak opcionális lépések vannak hátra, a **Bejelentkezés** oldalra, majd vissza a `/setup` oldalra kerülhetsz.

## Elsődleges agentek

**Cél:** a két mindig elérhető **kolléga** létrehozása, akikkel beszélsz (oldalsáv **Kollégák**, kollégánként egy otthoni szál). A képernyőn: *A két állandó AI-munkatársad*.

| Mező | Kötelező | Leírás |
|------|----------|--------|
| **Személyi asszisztens — a napi AI-munkatársad** | Igen | A napi munkához használt agent neve (pl. Jarvis). Szint: elsődleges, típus: asszisztens. A **general** projekttípushoz kötve. |
| **Rendszermérnök — az EYAS egészségét felügyeli** | Igen | Az EYAS-t karbantartó agent neve (pl. R2D2). Szint: elsődleges, típus: mérnök. Az **eyas** projekttípushoz kötve. |

Mindkettőhöz létrejön:

- egy `agent_definitions` sor (modell, eszközök, munkaterület útvonala, …)
- egy munkaterület-fa a `data/agents/<id>/` alatt (IDENTITY, AGENTS, TOOLS, MEMORY, SOUL, …)
- egy kapcsolt **agent-felhasználó** rekord (`is_agent = 1`) a jogosultságokhoz és a megszólításhoz

Később az **Agentek** alatt átnevezheted és átállíthatod őket. A varázsló után az oldalsáv **Kollégák** listájáról nyithatók meg. Az Asszisztens koordinál, és nem szerkeszt forráskódot; a Mérnök felel a platformért és a kódért. Lásd [Csapatok és delegálás](/docs/hu/agents/teams/).

## Csapat-agentek (opcionális)

**Cél:** további **kollégák** (csapat szint) és **specialisták** (közös pool, amelyből bármelyik kolléga indíthat) bekapcsolása. Az elsődleges agenteknek nem kell javaslatkártya egy engedélyezett specialista hívásához.

| Vezérlő | Leírás |
|---------|--------|
| **Ajánlott** | Kiemelt sablonkészlet egy tipikus telepítéshez. |
| **Specialisták** | Az opcionális agent-sablonok teljes katalógusa. |
| **Összes kijelölése / Kijelölés törlése** | Tömeges kijelölés. |
| *N kiválasztva* | A kiválasztott sablonok száma. |
| **Kihagyás / Tovább** | Befejezés specialisták nélkül, vagy a kijelölés alkalmazása. |

A kijelölés sablonazonosítóként tárolódik, és valódi agentekké alakul (ugyanazzal a munkaterület-mintával, mint az elsődlegesek). Később a **Beállítások → Agentek** alatt módosíthatod.

## AI Provider

**Cél:** legalább egy modell-backend elérhető legyen.

### Host CLI-k (ha detektálva)

| Vezérlő | Leírás |
|---------|--------|
| Jelvény (*Claude Code detektálva és beállítva* / *Grok CLI …* / *Kimi Code CLI …*) | Helyi CLI megtalálva és használható — **API-kulcs nem kell**. Claude-nál a *detektálva és beállítva* azt jelenti, hogy a Claude Code runtime elindul **és be van jelentkezve** (claude.ai bejelentkezés, `ANTHROPIC_API_KEY` vagy Bedrock/Vertex beállítás); az, hogy a `claude` a PATH-on van, nem elég. Lásd [Providerek — Claude Code runtime](/docs/hu/ai/providers/#claude-code-runtime). |
| **Bejelentkezés az EYAS számára** (Grok / Kimi) | Mindig megjelenik, ha a Grok CLI vagy a Kimi Code CLI detektálva van. Az EYAS ezeket a CLI-ket a saját könyvtárában futtatja, és nem használja a gépen lévő bejelentkezésüket, ezért itt jelentkezz be egyszer az EYAS számára: **Bejelentkezés eszközkóddal** (mindkettő) — nyisd meg a linket bármely eszközön, és erősítsd meg a kódot, a szerveren nem kell böngésző —, vagy **Inkább API-kulccsal** (Grok, xAI API-kulcs). Lásd [Providerek — Bejelentkezés a Grokba és a Kimibe az EYAS számára](/docs/hu/ai/providers/#sign-in-grok-and-kimi-for-eyas). |
| **Elsődleges CLI** | Több detektált CLI esetén jelenik meg: melyik legyen az alapértelmezés az agentekhez és az útválasztáshoz. Ebből lesz a telepítés alapértelmezett providere és modellje, amely a modellt meg nem nevező belső hívásokat is kiszolgálja, ha nincs beállítva Normál szint — lásd [Routing és költségkeret](/docs/hu/ai/routing-budget/#default-binding). |
| **Másik providert használok** | Váltás felhős/helyi API-beállításra. |
| **Vissza a detektált CLI-khez** | Vissza a CLI-nézethez. |

### Kézi / API-providerek

| Vezérlő | Leírás |
|---------|--------|
| Providerlista | Ismert backendek (Anthropic, OpenAI, Gemini, xAI, Ollama, …). |
| **Aktív / Inaktív** | Használhatja-e az útválasztás a providert. |
| **Beállítás / Kulcs módosítása** | Az API-kulcs megadása. |
| API-kulcs mező (*Add meg az API-kulcsot…*) | Titok; a titkosított Secrets tárba kerül. |
| **Mentés** | A kulcs mentése, a provider használhatóvá tétele. |
| **Újraellenőrzés** | Helyi végpont újbóli ellenőrzése (pl. az Ollama URL). |
| **Tovább / Beállítás befejezése** | Akkor is továbblép, ha nincs aktív provider (később a Beállítások → Providerek alatt befejezheted) — lásd a képernyőn lévő megjegyzést. |

## AI modellek

**Cél:** konkrét modell hozzárendelése minden agenthez, ha egy provider már kész.

| Vezérlő | Leírás |
|---------|--------|
| **Agent** oszlop | Az előző lépésekből származó agentnév. |
| **Modell** oszlop | Az aktív providerek modelljei legördülő listában, mindegyik *Provider / modell* alakban (a legjobban illő előre kiválasztva); a **— nincs —** változatlanul hagyja az agent modelljét. |
| **Alkalmaz** | A hozzárendelések mentése. Mindegyik a kiválasztott provider + modell párként kerül elküldésre és tárolásra, így egy modellazonosító, amelyet két provider is listáz, soha nem kétértelmű; a modellkatalógusban nem szereplő párt kihagyja. |
| **Tovább a Providers oldalra** | Átugrás a teljes Providerek oldalra, ha semmi sincs beállítva. |
| **Beállítás befejezése** | A varázsló befejezése és belépés a fő alkalmazásba. |

Ha nincs detektált provider (*Nem található AI provider*), a varázsló után állíts be egyet a Providerek oldalon.

## A varázsló után

| Hova | Miért |
|------|-------|
| [Az első órád](/docs/hu/first-hour/) | Az élő felület bejárása: Kezdőlap, egy beszélgetés, Tábla, Memória |
| [Kezdőlap](/docs/hu/daily/home/) | Setup-ajánlások a hátralévő opcionális munkához |
| [Providerek](/docs/hu/ai/providers/) | További backendek, kulcsok, modellek |
| [Agentek](/docs/hu/agents/overview/) | Kollégák és specialisták áttekintése |
| [Csapatok és delegálás](/docs/hu/agents/teams/) | Hogyan adnak át munkát a kollégák és indítanak specialistákat |
| [Felhasználók](/docs/hu/admin/users/) | További emberi felhasználók (többfelhasználós használatnál) |

## Biztonsági megjegyzések

- A mesterjelszó a **titkokat** védi; önmagában nem titkosítja a SQLite-fájlt tárolt állapotban — védd a gazdagép lemezét és a mentéseket.
- A fő tulajdonos jelszava független a mesterjelszótól.
- Az agent-„felhasználók” nem emberi bejelentkezésre valók; az identitáshoz és a hozzáférés-kezeléshez léteznek.
