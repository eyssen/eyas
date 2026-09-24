---
title: CLI referencia
description: eyas serve/start/stop/doctor/config/module — bármelyik telepítési úton.
---

**Mire való.** Az `eyas` binárissal indítod, állítod le és diagnosztizálod a natív vagy konténeres telepítést, és kapcsolod a modulokat. Nem második termék — ugyanaz a process, ugyanaz az `EYAS_HOME`. Miután a `bin/` a `PATH`-on van (natív telepítő), vagy az image-en belül (`docker compose exec`), ezek a parancsok érvényesek.

## Mikor használd

- Előtérben (`serve`), ha a logot akarod nézni, vagy háttérben (`start` + pidfile).
- `doctor` bejelentés előtt: hiányzó CLI, melyik Claude Code bináris fut és be van-e jelentkezve, minden telepített AI CLI olyan verzió-e, amelyen az EYAS izolációs ellenőrzése már bizonyított, ép-e az EYAS home-ja, elérhető-e a CLI-k kernel fájl-sandboxa, hol a vault, melyik memória-beágyazót használja a felidézés, kihagyott import-gyökerek, foglalt port, docs/web dist.
- Modul kapcsolása a YAML kézi szerkesztése nélkül.
- Új verzió keresése GitHubon (`eyas update` család, ugyanaz a szolgáltatás, mint Beállítások → Frissítések).

## Tipikus folyamat

1. Telepítés [natívan](/docs/hu/deploy/native/) vagy [Dockerrel](/docs/hu/deploy/docker/).
2. `eyas doctor` — javítsd, amit jelez.
3. `eyas serve` (előtér) vagy `eyas start` (háttér). Ellenőrzés: `eyas status`.
4. YAML szerkesztése után `eyas config validate`, majd `eyas restart`: a `default.yaml` és a `local.yaml` csak induláskor töltődik be.
5. Szükség szerint `eyas stop` / `eyas restart`.

## Funkciók

| Parancs | Leírás |
|---------|--------|
| `eyas serve` | Előtérben futó HTTP szerver |
| `eyas start` | Háttérben (pidfile + log) |
| `eyas stop` | Háttérfolyamat leállítása |
| `eyas restart` | Újraindítás |
| `eyas status` | Health + PID |
| `eyas doctor` | Diagnosztika |
| `eyas version` | Verzió |
| `eyas config validate` | YAML validálás |
| `eyas config reload` | A `default.yaml` / `local.yaml` fájlt **nem** tölti újra — indíts újra helyette |
| `eyas module list` | Modulok listája |
| `eyas module enable/disable <id>` | Modul kapcsolása |
| `eyas update check` | Új verzió keresése GitHubon (`eyssen/eyas`); az alkalmazáshoz kész Mentés kell |
| `eyas migrate …` | Egyszeri v1→v2 prompt/workspace migráció (`run` / `rollback` / `drop-cols`) — nem napi üzemeltetés |

<h3 id="what-doctor-checks">Mit ellenőriz a <code>doctor</code></h3>

Minden sor *ok* (✓), *figyelmeztetés* (⚠) vagy *hiba* (✗). A doctor a hibák vagy figyelmeztetések számával zárul, és 1-es kilépési kóddal áll le, ha bármelyik sor hibás; a puszta figyelmeztetés nem változtat a kilépési kódon. Csak olvas: semmit nem javít, nem másol és nem hoz létre, a telepített CLI-ket pedig csak a verziójuk (`--version`), a Claude Code-ot a bejelentkezése (`claude auth status`) kiolvasásához indítja el.

A sorai közül néhány:

| Sor | Jelentés |
|-----|----------|
| **Claude Code runtime** | Melyik Claude Code binárist futtatja az EYAS: a forrás (`EYAS_CLAUDE_CODE_BIN` / `claude on PATH` / `SDK-bundled`), az útvonal és a verzió, eltér-e a verziója attól, amelyhez az EYAS SDK-kliense készült (*version skew*), és **signed in** igen/nem. Az érvénytelen `EYAS_CLAUDE_CODE_BIN` hiba. A csomagolt SDK-példány mint végső tartalék, a verzióeltérés és a kijelentkezett runtime figyelmeztetés. Az override által eltakart PATH-beli `claude` információként látszik (*not used by EYAS*). Lásd [Providerek — Claude Code runtime](/docs/hu/ai/providers/#claude-code-runtime). |
| **CLI isolation (Claude Code)**, **CLI isolation (Grok CLI)**, **CLI isolation (Kimi Code CLI)** | CLI-providerenként egy sor. Megmutatja, melyik binárist futtatja az EYAS — hogyan találta meg (`EYAS_CLAUDE_CODE_BIN` / `EYAS_GROK_BIN` / `EYAS_KIMI_BIN`, `claude on PATH` / `grok on PATH` / `kimi on PATH`, vagy `SDK-bundled`), az útvonalát és a verzióját —, és hogy az EYAS kiadás előtti izolációs ellenőrzése bizonyította-e ezt a verziót: ok *isolation proven on this version (&lt;dátum&gt;)*. Figyelmeztet, ha a verzió eltér az utoljára bizonyítottól, ha a bináris nem jelent verziót, és ha a CLI-t még egyetlen hoston sem bizonyították (egyelőre a Kimi Code CLI); a figyelmeztetés hozzáteszi, hogy az EYAS minden sessiont induláskor továbbra is ellenőriz. A nem telepített CLI *not installed* (ok). Az érvénytelen `EYAS_*_BIN` hiba, a teendővel. A Grok CLI és a Kimi Code CLI sora az EYAS home-jukat is ellenőrzi, `<data dir>/cli-homes/<provider>` — lásd a következő táblát. Az utoljára bizonyított verziók és a bizonyítás módja: [Biztonság és adatvédelem — Hogyan bizonyított az izoláció](/docs/hu/admin/security-privacy/#how-isolation-is-proven). |
| **CLI sandbox** | A `security.cliSandbox` mód, és minden telepített CLI-nél (Claude Code, Grok CLI, Kimi Code CLI), hogy a saját toolai a kernel fájl-sandboxban futnak-e: *active*, *unavailable* az okkal és a teendővel (telepítsd a bubblewrapot; telepítsd a socatot — a Claude Code-nak a bubblewrap mellett ez is kell; engedélyezd a nem privilegizált user namespace-eket, konténerben is), vagy *none* a Kiminél, amelynek nincs kernel sandboxa. A hiányzó sandbox figyelmeztetés, nem hiba: `auto` mellett a CLI nélküle fut, `required` mellett a toolokat használó köreit az EYAS elutasítja. Lásd [Providerek — Kernel fájl-sandbox](/docs/hu/ai/providers/#kernel-file-sandbox). |
| **Vault** | A memória-vault útvonala, `<data dir>/vault` (ok). Figyelmeztet, ha egy régi `<EYAS home>/data/vault` jegyzetei a következő induláskor átmásolódnak, és — teendővel együtt — ha az a régi mappa már nincs használatban, mert az adatkönyvtárbeli vaultban már vannak jegyzetek. A doctor maga soha nem másol semmit. Lásd [Konfiguráció — Adatkönyvtár és vault](/docs/hu/deploy/configuration/#data-directory-and-vault). |
| **SQLite** | Élő önteszt egy eldobható, memóriabeli adatbázison — az adatfájlodat meg sem nyitja. Jelenti az SQLite verzióját, hogy megvan-e az **FTS5** (nélküle hiba: a memória-, beszélgetés- és vault-keresés mind ezt igényli), és hogy betöltődik-e a `sqlite-vec` bővítmény — úgy, hogy tényleg beszúr egy sort és lefuttat egy legközelebbi-szomszéd lekérdezést, nem csak a verziót kérdezi meg. A hiányzó bővítmény figyelmeztetés a platformodra szabott teendővel, nem hiba. |
| **Import roots** | Használhatók-e a `skills.importRoots` / `agent.importRoots` gyökerek: ok, ha semmi nincs beállítva, vagy minden gyökér közönséges mappa; figyelmeztetés a beállítás és a mappa megnevezésével, ha egy gyökér egy másik asszisztens vagy jegyzetalkalmazás saját mappáin belül van, vagy ilyet tartalmaz (`~/.claude`, `~/.grok`, egy Obsidian vault, …), és ezért nem olvassa be. Lásd [Konfiguráció — Extra skill- és persona-gyökerek](/docs/hu/deploy/configuration/#extra-skill-and-persona-roots). |
| **Memory embedder** | Melyik beágyazót használja a memória-felidézés. Ok: *multilingual-e5-small, local (weights in &lt;folder&gt;)*, ha a `@huggingface/transformers` telepítve van, és a súlyok a `data/models` alatt vannak. Figyelmeztetés: a hash-alapú stem-beágyazó (`stem5-fnv-384`), mert a `@huggingface/transformers` nincs telepítve — teendő: futtasd a `bun add @huggingface/transformers` (vagy `bun install`) parancsot az EYAS mappájában, majd indíts újra. Figyelmeztetés: a csomag telepítve van, de a súlyok még nincsenek letöltve — a következő indulás letölti őket (kb. 130 MB) a Hugging Face-ről a `data/models` alá, addig a felidézés a tartalékot használja. Lásd [Memória — A vektoros keresés mindig helyben fut](/docs/hu/knowledge/memory/#vector-search-always-runs-locally). |
| **zstd** | Melyik tömörítő implementációt használja majd a nyers napló: a Bun sajátját, a Node-ét (22.15 vagy újabb), vagy a csomagolt WASM tartalékot. A tartalék figyelmeztetés — működik, és nagyjából kétszer lassabb. Ha egyik sincs, az hiba, és az EYAS ilyenkor semmit nem rögzít, ahelyett hogy olyan puffert töltene, amit soha nem tud kiírni. |

Az EYAS home ellenőrzése a **CLI isolation (Grok CLI)** és a **CLI isolation (Kimi Code CLI)** soron:

| Amit a doctor a `<data dir>/cli-homes/<provider>` helyen talál | Eredmény |
|----------------------------------------------------------------|----------|
| Még nincs létrehozva | ok — az első futás létrehozza |
| Szimbolikus link, vagy nem mappa | hiba — az EYAS nem hajlandó onnan futtatni a CLI-t. Teendő: töröld; a következő futás újra létrehozza |
| Más felhasználók által olvasható mappa | figyelmeztetés — a CLI bejelentkezését tartalmazza. Teendő: `chmod 700 <mappa>` |
| Egy EYAS által kezelt fájl hiányzik, vagy megváltozott, mióta az EYAS megírta (Grok: `config.toml`, `requirements.toml`, `trusted_folders.toml`; Kimi: `mcp.json` és az EYAS beállításai a `config.toml`-ban) | figyelmeztetés — az EYAS a következő futás előtt újraírja ezeket a fájlokat, így a két futás közötti változás azt jelenti, hogy valami más szerkeszti azt a mappát |
| Minden úgy van, ahogy az EYAS megírta | ok — *EYAS home and managed files intact* |

<h3 id="environment">Környezet</h3>

`EYAS_PORT`, `EYAS_HOST`, `EYAS_HOME`, `EYAS_DATA_DIR`, `EYAS_WORKSPACES_DIR`, `EYAS_CLAUDE_CODE_BIN`, `EYAS_GROK_BIN`, `EYAS_KIMI_BIN`, `EYAS_INSTALL_ROOT`, `EYAS_SKIP_WEB_BUILD`, `EYAS_SKIP_DOCS_BUILD`, `EYAS_FORCE_WEB_BUILD`, `EYAS_FORCE_DOCS_BUILD`. Hogy az útvonal- és runtime-változók mit csinálnak: [Konfiguráció](/docs/hu/deploy/configuration/).

Az alap port **3100**. Az `EYAS_SKIP_DOCS_BUILD=1` miatt ad 404-et a `/docs` — lásd [GYIK](/docs/hu/reference/faq/).

## Kapcsolódó

- [Konfiguráció](/docs/hu/deploy/configuration/)
- [Natív](/docs/hu/deploy/native/)
- [Providerek](/docs/hu/ai/providers/)
- [Biztonság és adatvédelem](/docs/hu/admin/security-privacy/)
- [GYIK](/docs/hu/reference/faq/)
- [Beállítások — Frissítések](/docs/hu/admin/settings/)
