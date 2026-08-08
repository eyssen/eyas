---
title: Setup varázsló
description: Első indítás varázsló — minden lépés és mező magyarázata.
---

A varázsló **egyszer** fut, amíg a kötelező lépések nincsenek kész. A böngésző a `/setup` oldalra kerül. Az opcionális lépések kihagyhatók és később a Beállításokban pótolhatók.

Minden lépésen megjelenő vezérlők:

| Vezérlő | Jelentés |
|---------|----------|
| **Nyelv** | Termék UI nyelve (`en` / `hu` / `de` / `es`). |
| **Megjelenés** | Téma sablon + világos/sötét. |
| **N. lépés / M** | Haladás. |
| **Tovább / Beállítás befejezése** | Lépés mentése és továbblépés. |

---

## Lépések sorrendje (tipikus)

| Sorrend | Lépés | Kötelező |
|--------:|-------|----------|
| 1 | **Mesterjelszó** | Igen |
| 2 | **Fő tulajdonos** | Igen |
| 3 | **Elsődleges ágensek** | Igen |
| 4 | **Csapat-agentek** | Nem |
| 5 | **AI Provider** | Általában |
| 6 | **AI modellek** | Általában |

A modulok bootstrapkor regisztrálják a lépéseket. A kötelezők nélkül a fő app nem nyílik meg.

---

## Mesterjelszó

**Cél:** az összes tárolt secret (API kulcs, token) titkosítása nyugalmi állapotban.

| Mező | Kötelező | Leírás |
|------|----------|--------|
| **Mesterjelszó** | Igen | A secret titkosítás jelszava. Erős legyen; elvesztése esetén a kulcsokat újra meg kell adni. |
| **Jelszó megerősítése** | Igen | Egyeznie kell a mesterjelszóval. |

---

## Fő tulajdonos (Root Owner)

**Cél:** a fő emberi admin fiók (`role: owner`, `is_root_owner`).

| Mező | Kötelező | Leírás |
|------|----------|--------|
| **Felhasználónév** | Igen | Bejelentkezési név (pl. `admin`), egyedi. |
| **Jelszó** | Igen | Fiókjelszó (hash-elve tárolva). |
| **Megjelenített név** | Nem | UI-ban látszó név (üresen = felhasználónév). |

A varázsló a session idejére **memóriában** tartja az owner hitelesítőt, hogy az opcionális (auth-köteles) lépések menjenek. Reload után, ha csak opcionális van hátra, átirányíthat a **Bejelentkezés**re, majd vissza a `/setup`-ra.

---

## Elsődleges ágensek

**Cél:** a két always-on társ létrehozása.

| Mező | Kötelező | Leírás |
|------|----------|--------|
| **Személyi asszisztens** | Igen | Napi munka ágens neve (pl. Jarvis). Tier: primary, típus: assistant. A **general** project type-hoz kötve. |
| **Rendszermérnök** | Igen | Az EYAS üzemeltető ágens neve (pl. R2D2). Tier: primary, típus: engineer. Az **eyas** project type-hoz kötve. |

Mindkettőhöz létrejön: `agent_definitions` sor, `data/agents/<id>/` workspace, és agent user rekord. Később az **Ágensek** oldalon finomhangolható.

---

## Csapat-agentek (opcionális)

**Cél:** specialista sablonok, amikre a primary ágensek delegálhatnak.

| Vezérlő | Leírás |
|---------|--------|
| **Ajánlott** | Kiemelt sablonkészlet. |
| **Specialisták** | Teljes katalógus. |
| **Összes kijelölése / Kijelölés törlése** | Tömeges váltás. |
| **N kiválasztva** | Darabszám. |
| **Kihagyás / Tovább** | Specialisták nélkül vagy a kijelölés alkalmazása. |

Később: Beállítások / Ágensek.

---

## AI Provider

**Cél:** legalább egy modell backend.

### Host CLI (ha detektált)

| Vezérlő | Leírás |
|---------|--------|
| Claude / Grok / Kimi badge | Helyi CLI kész — **API kulcs nem kell**. |
| **Elsődleges CLI** | Alap provider agentekhez és routinghoz. |
| **Másik providert használok** | Felhő/helyi API felé. |

### API providerek

| Vezérlő | Leírás |
|---------|--------|
| Provider lista | Anthropic, OpenAI, Gemini, xAI, Ollama, … |
| **Aktív / Inaktív** | Routing használhatja-e. |
| **Beállítás / Kulcs módosítása** | API kulcs megadása. |
| **API-kulcs** | Titkos; a Secrets tárba kerül. |
| **Mentés** | Kulcs mentése. |
| **Újraellenőrzés** | Helyi endpoint újra (pl. Ollama). |
| **Tovább** | Akkor is, ha még nincs aktív — a figyelmeztetés szerint később is beállítható. |

---

## AI modellek

**Cél:** modell hozzárendelése agentenként.

| Vezérlő | Leírás |
|---------|--------|
| **Agent** | Ágens neve. |
| **Modell** | Dropdown a provider modelljeiből (előválasztott best-fit). |
| **Alkalmaz** | Mentés. |
| **Tovább a Providers oldalra** | Ha nincs provider. |
| **Beállítás befejezése** | Kilépés a fő appba. |

---

## Setup után

| Hova | Miért |
|------|-------|
| [Irányítópult](/docs/hu/daily/dashboard/) | Hátralévő ajánlott setup tételek |
| [Providerek](/docs/hu/ai/providers/) | További backendek |
| [Ágensek](/docs/hu/agents/overview/) | Primary és specialisták |
| [Felhasználók](/docs/hu/admin/users/) | További emberi userek |

## Biztonság

- A mesterjelszó a **secrettket** védi, nem helyettesíti a lemez/backup védelmet.
- Az owner jelszó **független** a mesterjelszótól.
- Az agent userek nem emberi bejelentkezési fiókok.
