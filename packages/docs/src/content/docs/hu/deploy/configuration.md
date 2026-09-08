---
title: Konfiguráció
description: YAML defaultok, local overlay, env precedencia — miután választottál telepítési utat.
---

**Mire való.** Itt változtatod a listen címet, modulokat, autonómiát, memória-capture-t és az agent verify parancsait újraépítés nélkül. `local.yaml` és `EYAS_*` — ne a `config/default.yaml`-t, ha kerülhető (upgrade felülírja). Feltételezi, hogy már választottál: [natív](/docs/hu/deploy/native/), [Docker](/docs/hu/deploy/docker/) vagy [Kubernetes](/docs/hu/deploy/kubernetes/).

## Mikor használd

- Host/port, log level, modul tiltása.
- A **modellhívásos capture** ki (`memory.capture.enabled: false`) — alap be. Ez a nyers rögzítést **nem** állítja le: a `memory.l0.enabled` külön kapcsoló, szintén alapból be.
- A **nyers rögzítés** ki (`memory.l0.enabled: false`), ha nem akarsz minden üzenetről szó szerinti második másolatot a lemezen.
- Extra skill- vagy persona-mappák (`skills.importRoots` / `agent.importRoots`) a host Claude config bekapcsolása nélkül.
- `agent.verifyCommands`, hogy a kódoló futás ne legyen „kész” teszt nélkül.
- Több Odoo checkout `EYAS_ODOO_SOURCES_JSON`-nal.

## Tipikus folyamat

1. `local.yaml` a szállított defaultok mellé (vagy `EYAS_HOME` alá).
2. Csak a kellő kulcsok. `eyas config validate`.
3. `eyas restart` vagy `eyas config reload`.
4. **Beállítások** + `eyas doctor`.

## Funkciók

| Fájl | Szerep |
|------|--------|
| `config/default.yaml` | Szállított defaultok |
| `local.yaml` | Overlay merge |
| `.env` | Opcionális titkok (soha ne commitold) |

Precedencia: CLI flag → `EYAS_*` env → local YAML → default YAML.

Példa kulcsok: `server.host/port`, `database.path`, `log.level`, `modules.disabled`, `autonomy.identitySelfUpdate`, `memory.capture.enabled`, `memory.l0.enabled`.

### Tartós memória-capture

```yaml
memory:
  capture:
    enabled: true          # false = nincs post-turn vault írás
    minUserChars: 40
    maxPerConversation: 20
```

Alap **be**. Kis modellhívás a minősülő forduló *után* — soha a válasz kritikus útján. Lásd [Memória](/docs/hu/knowledge/memory/) és [GYIK](/docs/hu/reference/faq/).

### Nyers rögzítés (0.8.23-beta)

```yaml
memory:
  engine: legacy           # 'legacy' vagy 'v2'; a visszakeresés mindkettővel ugyanaz
  l0:
    enabled: true          # false = semmilyen nyers másolat nem marad
    captureToolResults: false
    toolResultMaxBytes: 8192
    idleFlushMinutes: 30
    chunkTokens: 8000
    extractInLegacy: true
```

Ez **nem** ugyanaz a kapcsoló, mint a fenti `memory.capture`. A capture vault-jegyzeteket ír, és egy kis modellhívásba kerül; a nyers rögzítés **minden eltárolt üzenetről szó szerinti második másolatot** tart meg — tömörítve és tartalom szerint címezve —, **modellhívás és API-költség nélkül**. Alapból be van kapcsolva.

| Kulcs | Alap | Jelentés |
|-------|------|----------|
| `memory.l0.enabled` | **`true`** | A nyers rögzítés főkapcsolója. `false` esetén semmit nem rögzít és nem is pufferel. |
| `memory.l0.extractInLegacy` | **`true`** | Minden kiírás után lefuttatja a determinisztikus feldolgozást (tények, összefoglaló, entitások, témák, fontosság), még akkor is, ha az `engine` még `legacy`. `false` esetén megmarad a nyers szöveg, de semmit nem vezet le belőle. |
| `memory.engine` | **`legacy`** | `legacy` vagy `v2`. Ma csak a feldolgozást kapuzza — a `v2` akkor is lefuttatja a determinisztikus menetet, ha az `extractInLegacy` `false`. Azt **nem** változtatja meg, mire emlékszik vissza egy beszélgetés. |
| `memory.l0.chunkTokens` | **`8000`** | Méret szerinti kiírás: egy beszélgetés puffere akkor íródik ki, ha a becsült tokenszáma eléri ezt. |
| `memory.l0.idleFlushMinutes` | **`30`** | Idő szerinti kiírás: percenkénti söprés írja ki azt a puffert, amelyik ennyi ideje tétlen. A beszélgetés lezárása és az EYAS leállítása is kiír, tehát a tiszta újraindítás semmit nem veszít el. |
| `memory.l0.captureToolResults` | **`false`** | A tool-kimenetet is rögzíti. **Bekapcsolás előtt olvasd el a következő bekezdést.** |
| `memory.l0.toolResultMaxBytes` | **`8192`** | Egyetlen rögzített tool-eredmény bájtplafonja, UTF-8 határon vágva, látható csonkolásjelzéssel. Csak tool-eredményre; az üzenetekre nincs plafon. |

**A `captureToolResults` nem véletlenül van kikapcsolva.** Egy rögzített tool-eredmény a teljes kimenet, szó szerint és szerkesztetlenül, plusz a hívás argumentumaiból 2048 levágott karakter: a `run_command` stdoutja, a `read_file` tartalma és egy élő `browser_totp` egyszer használatos kód is sima szövegként landol a nyers rétegben. Semmi nem maszkolja őket, és semmi nem titkosítja őket nyugalmi állapotban — a tömörítés nem titoktartás. Bekapcsolt kapcsolóval minden indulás pontosan erről ír figyelmeztetést a logba. Csak ott kapcsold be, ahol ez ezen a gépen elfogadható.

**Ezeket a sorokat egyelőre semmi nem olvassa.** A 0.8.23-beta csak írási út: nincs visszakeresés, nincs UI-oldal, nincs API-végpont, és nincs `eyas memory` parancs. A promptok továbbra is pontosan úgy állnak össze a vaultból és a korábbi beszélgetésekből, mint eddig, tehát a `memory.engine: v2` beállítása ma semmit nem változtat, amit látnál.

**A nyers napló nő, és semmi nem takarítja.** Ebben a kiadásban nincs megőrzési beállítás és nincs takarító job; egy rögzített üzenet nagyjából 5 KB lemezterület, az indexekkel együtt. Ha ezt még nem akarod megfizetni, állítsd a `memory.l0.enabled` kulcsot `false`-ra. Lásd [Memória](/docs/hu/knowledge/memory/).

### Memóriaindex és felidézés

| Kulcs | Alap | Jelentés |
|-------|------|----------|
| `memory.index.budgetChars` | **`2400`** | Az állandó memóriaindex karakterkerete fordulónként (≈ 600 token). Emeld 8000 körülre, ha a `user` és `feedback` jegyzeteid már nem férnek bele. Újraindítás kell hozzá. |
| `memory.recall.includeSecrets` | **`false`** | Megkapja-e a modell a `contains-secrets` címkéjű jegyzeteket, epizodikus sorokat és skilleket (olyan fájlok, amelyekben az importer hitelesítő adatot talált, és szó szerint eltárolt) a memóriaindexben, a kapcsolódó munkában és a `search_memory`-ban. Kikapcsolva tárolva vannak és a Memória oldalon látszanak, de promptba sosem kerülnek. Újraindítás kell hozzá. |

### Adatbázis-tartósság

A 0.8.23-beta óta minden EYAS adatbázis-kapcsolat `PRAGMA synchronous = NORMAL`-lal fut az SQLite alapértelmezett `FULL` helyett. A WAL-lal párosítva — amit az EYAS mindig is használt — ez azt jelenti:

- Egy **process**-összeomlás — kilőtt EYAS, lekezeletlen hiba — semmit nem veszít el abból, ami már commitolva van.
- Egy **operációs rendszer**-összeomlás vagy áramszünet pont egy commit pillanatában elveszítheti az utolsó tranzakciót.

Ez a WAL szokásos alkuja, és **minden** modulra vonatkozik, nem csak a memóriára. Ha a példányodban olyan munka van, amit nem tudsz újra bevinni, a tartósság kérdésére a [Mentés](/docs/hu/admin/backup/) a válasz, nem a commit-mód.

### Extra skill- és persona-gyökerek

A host Claude / Cursor skill-mappák **nem** élő tár. Az izoláció marad. Eljárások behozatalához listázd a mappákat ezen a példányon:

```yaml
skills:
  importRoots: []          # extra markdown skill mappák; üres = nincs
agent:
  importRoots: []          # extra persona markdown; üres = nincs
```

A szállított default üres lista. Az útvonalak a `local.yaml`-ba kerülnek, soha a termék-forrásba. Az importált skill ugyanazon id bundled másolata fölött nyer. Lásd [Készségek](/docs/hu/automation/skills/#import-roots).

## Agent verify és kódolás (0.8.6+)

```yaml
agent:
  criticEnabled: true
  criticMaxRounds: 1
  verifyCommands:
    - name: bun-test
      command: bun
      args: [test]
```

| Kulcs | Jelentés |
|-------|----------|
| `agent.verifyCommands` | `{ name, command, args?, timeoutMs? }` — **nincs shell**; hiba újra megnyitja az agentet |
| `agent.verifyCwd` | Munkakönyvtár |
| `EYAS_ODOO_SOURCE_PATHS` | Kettőspont/pontosvesszővel elválasztott Odoo checkout gyökerek |
| `EYAS_ODOO_SOURCES_JSON` | Többverziós bootstrap JSON tömb |
| `EYAS_AUTO_FAILOVER` | Üres routing-tartalék kitöltése második élő providerrel |
| `EYAS_BROWSER_USER_DATA_DIR` | Headless `browser_*` EYAS-profil (alap: `data/browser/profile`). Napi Chrome/Edge profil tiltott |
| `EYAS_AGENT_BROWSER_BIN` | Opcionális Vercel agent-browser CLI. Üres = PATH. Beállított, de hiányzó path = fail-closed. Profil: `data/browser/agent-browser/profile` |

Ezután **Keresési források**, **Újraindexelés**, projekt **Alapértelmezett kódforrások**. Beszélgetés **Források** fül — [Keresés](/docs/hu/daily/search/#multi-version-pin-which-tree-may-the-agent-use).

Tool policy hookok minden híváson (PreToolUse / PostToolUse) — [Eszközök](/docs/hu/automation/tools/).

## Kapcsolódó

- [CLI](/docs/hu/deploy/cli/)
- [Providerek](/docs/hu/ai/providers/)
- [Routing és költségkeret](/docs/hu/ai/routing-budget/)
- [Memória](/docs/hu/knowledge/memory/)
