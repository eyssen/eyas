---
title: Keresés
description: Hibrid keresés, többverziós kódforrások és citációk.
---

## Globális keresés

| Vezérlő | Jelentés |
|---------|----------|
| Keresőmező | Minden indexelt forrás (top bar is) |
| Találatlista | Board, memória, doksi, kód, … |
| N results in M files | Összesítő |
| Preview | Kijelölt találat fájltartalma |

---

## Hibrid retrieval

Az EYAS **FTS (Orama)** + **vektor** cosine indexet fuzionál **RRF**-fel. Ha nincs embedding, **csak FTS** marad (őszinte degradáció).

| Funkció | Jelentés |
|---------|----------|
| **Embed-on-index** | Chunkok embeddinget tárolnak, ha van embed provider |
| **Content-hash reuse** | Újraindexeléskor változatlan tartalomnál az embedding újrahasznosul |
| **Citációk** | `search_indexed` → stabil `citationId` / `cite` (`[source:…]`) |
| **list_search_sources** | Ágens tool: források listázása találgatás helyett |
| **Grounding** | Completeness critic: kutatás / forrásból implementálás előtt retrieval bizonyíték kell |

Indexeld a kódbázist és a doksikat, hogy az ágensek **a te anyagodból** dolgozzanak.

---

## Search Sources

**Útvonal:** `/search-sources` (Settings → Search sources).

**Több Odoo-verzió:** **egy source = egy checkout** (pl. Community 18, Enterprise 18, saját addons). Ne tegyél több verziót egy path-listába.

| Mező | Jelentés |
|------|----------|
| **Name** | Megjelenő név (pl. `Odoo 18 Community`) |
| **Type** / **Indexer** | Forrás típusa / pipeline (`code` forráskódhoz) |
| **Paths** | Abszolút gyökér — forrásonként **egy** path ajánlott |
| **Label** | Rövid pin-azonosító (pl. `18c`, `18e`, `eyssen-erp`) |
| **Version** | Verzió (pl. `18`, `19`) |
| **Edition** | Kiadás (pl. `community`, `enterprise`) |
| **Family** | Odoo checkoutoknál **`odoo`** — multi-version védelem |
| **Exclude** | Zaj kiszűrése (`i18n`, `static`, …); family `odoo` esetén alapértelmezett kizárások is vannak |
| **Create / Reindex / Delete** | Létrehozás, újraindexelés, törlés |
| **Last indexed** | Utolsó sikeres index |

Státusz: **idle · indexing · ready · error**. Az **indexing** alatt a chunk szám kötegenként nő; megszakítás után a következő Reindex a változatlan fájlokat kihagyja.

### Env bootstrap (opcionális)

| Env | Jelentés |
|-----|----------|
| `EYAS_ODOO_SOURCES_JSON` | Ajánlott: JSON tömb `{ path, label?, version?, edition?, family?, name? }` — induláskor idle Search Source-okat hoz létre, ha a path még nincs regisztrálva |
| `EYAS_ODOO_SOURCE_PATHS` | `:` / `;` elválasztott gyökerek; lightweight `odoo_search_*` + bootstrap, ha nincs labeles source |

Bootstrap után **Reindex** minden forráson.

---

## Többverziós pin (melyik fát használhatja az ágens?)

Ha több **odoo-family** source **ready**, az EYAS **nem keveri** csendben a verziókat. Feloldás:

1. Explicit tool arg (`sourceIds`, `labels`, `version`, `edition`)
2. **Conversation pin** — jobb panel **Források** fül (checkboxok)
3. **Project default** — Projects → **Alapértelmezett kódforrások**
4. Project type `indexed_sources` (ha van)
5. Ütközés esetén tool válasz: **`needsPin`** + elérhető label lista

### Conversation → Források fül

Jobb oldali context rail:

**Előzmények | Források | Következő | Fájlok**

| Vezérlő | Jelentés |
|---------|----------|
| Forráslista | Összes Search Source (label, verzió, status, path, chunk) |
| Checkbox | Több forrás is kijelölhető |
| **Összes** / **Törlés (auto)** | Mind / pin törlése |
| **Auto** | Nincs conversation-pin |
| **N kijelölve** | Aktív pin |
| **Search sources kezelése** | Link a `/search-sources`-re |

Mentés: `searchContext: { sourceIds: […] }`. Ágens: `get_search_context` / `set_search_context`.

### Project default

**Projects** → project szerkesztés → **Alapértelmezett kódforrások** (multi-checkbox).

Automatikusan érvényesül:

- **Új conversation** a projecten (board vagy chat)
- Conversation **Project** mezőjének átállításakor (ha a kliens nem küld külön `searchContext`-et)

A **Források** fülön conversation-szinten felülírható.

### Ágens toolok

| Tool | Cél |
|------|-----|
| `list_search_sources` | Források listája |
| `get_search_context` / `set_search_context` | Pin olvasás / írás |
| `search_indexed` | Hibrid keresés a pin szerint |
| `odoo_search_model` / `field` / `xml_id` | Helyi Odoo scan a pinelt rootokon; cite: `[source:odoo-src:label:file:line]` |

---

## Kapcsolódó

- [Beszélgetések — Források fül](/docs/hu/daily/conversations/)
- [Projektek — alap kódforrások](/docs/hu/daily/projects/)
- [Konfiguráció — env](/docs/hu/deploy/configuration/)
- [Toolok](/docs/hu/automation/tools/)
