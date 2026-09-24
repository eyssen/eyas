---
title: Konfiguráció
description: YAML defaultok, local overlay, env precedencia — miután választottál telepítési utat.
---

**Mire való.** Itt változtatod a listen címet, modulokat, autonómiát, memória-capture-t és az agent verify parancsait újraépítés nélkül. `local.yaml` és `EYAS_*` — ne a `config/default.yaml`-t, ha kerülhető (upgrade felülírja). Feltételezi, hogy már választottál: [natív](/docs/hu/deploy/native/), [Docker](/docs/hu/deploy/docker/) vagy [Kubernetes](/docs/hu/deploy/kubernetes/).

## Mikor használd {#when-to-use-it}

- Host/port, log level, modul tiltása.
- A **modellhívásos capture** ki (`memory.capture.enabled: false`) — alap be. Ez a nyers rögzítést **nem** állítja le: a `memory.l0.enabled` külön kapcsoló, szintén alapból be.
- A **nyers rögzítés** ki (`memory.l0.enabled: false`), ha nem akarsz minden üzenetről szó szerinti második másolatot a lemezen.
- Extra skill- vagy persona-mappák (`skills.importRoots` / `agent.importRoots`) közönséges mappákból — egy másik asszisztens saját mappáit az EYAS kihagyja.
- `agent.verifyCommands`, hogy a kódoló futás ne legyen „kész” teszt nélkül.
- Több Odoo checkout `EYAS_ODOO_SOURCES_JSON`-nal.
- A modell a helyes helyi időt kapja (`i18n.timezone`).
- Az adatkönyvtár (`EYAS_DATA_DIR`) vagy a beszélgetés-workspace-ek (`EYAS_WORKSPACES_DIR`) áthelyezése, vagy a Claude Code, a Grok vagy a Kimi bináris rögzítése (`EYAS_CLAUDE_CODE_BIN`, `EYAS_GROK_BIN`, `EYAS_KIMI_BIN`).
- További memóriatárak védelme a modellek elől (`security.foreignMemoryPaths`), vagy a kernel fájl-sandbox megkövetelése a CLI-k saját tooljaihoz (`security.cliSandbox: required`).
- Több vagy kevesebb idő a CLI-köröknek, mielőtt csend miatt leállnak (`model.cli.idleTimeoutMs`, `model.cli.toolTimeoutMs`).

## Tipikus folyamat {#typical-workflow}

1. `local.yaml` a szállított defaultok mellé (vagy `EYAS_HOME` alá).
2. Csak a kellő kulcsok. `eyas config validate`.
3. `eyas restart`. Az EYAS a `default.yaml`-t és a `local.yaml`-t egyszer, induláskor olvassa be; az `eyas config reload` ezt a két fájlt **nem** tölti újra. A `config/personality/` alatti, erre felkészített fájlokat (például a `privacy.yaml`-t) újraindítás nélkül is felveszi.
4. **Beállítások** + `eyas doctor`.

## Funkciók {#features}

| Fájl | Szerep |
|------|--------|
| `config/default.yaml` | Szállított defaultok |
| `local.yaml` | Overlay merge |
| `.env` | Opcionális titkok (soha ne commitold) |

Precedencia: CLI flag → `EYAS_*` env → local YAML → default YAML.

Példa kulcsok: `server.host/port`, `database.path`, `log.level`, `i18n.timezone`, `modules.disabled`, `autonomy.identitySelfUpdate`, `security.foreignMemoryPaths`, `security.cliSandbox`, `model.cli.idleTimeoutMs`, `model.cli.toolTimeoutMs`, `memory.capture.enabled`, `memory.l0.enabled`.

### A modell órájának időzónája {#time-zone-of-the-models-clock}

```yaml
i18n:
  timezone: "America/New_York"   # IANA név; üres = a szerver saját zónája
```

Minden kör megmondja a modellnek az aktuális dátumot és időt. Az `i18n.timezone` állítja be, melyik zónában: IANA név, például `America/New_York`, `Europe/Berlin` vagy `UTC`. Beállítás nélkül (ez az alap) a szerver saját zónája érvényes — a `TZ` környezeti változó, különben az operációs rendszer beállítása. A Docker konténerek általában UTC-ben futnak, hacsak nincs `TZ` beállítva.

A dátum és az idő mindig ugyanabból a zónából jön, az idő sora pedig megnevezi a zónát és az UTC-eltolását, például `Current time: 23:30 (America/New_York, UTC-04:00)`. A korábbi verziók az időt egy rögzített közép-európai zónában adták meg, a dátumot viszont UTC-ből vették, így éjfél körül a kettő eltérhetett, és minden ezen a zónán kívüli telepítés rossz helyi időt kapott.

Érvénytelen érték konfigurációs hibával leállítja az indulást: *i18n.timezone: Unknown time zone — use an IANA name such as Europe/Berlin or UTC*. A `local.yaml`-ban állítsd be; újraindítás után lép életbe.

### Adatkönyvtár és vault {#data-directory-and-vault}

Az adatkönyvtárban van az adatbázis, a memória-vault, az agent-fájlok, a mentések és a példány többi állapota. Alapból `<EYAS home>/data`, vagy az `EYAS_DATA_DIR` által megnevezett mappa.

A memória-vault mindig a `<data dir>/vault` alatt van, és nincs saját útvonal-beállítása: áthelyezéséhez az adatkönyvtárat helyezd át az `EYAS_DATA_DIR`-rel. (A `config/personality/memory.yaml` régi `memory.vault.path` kulcsa soha nem csinált semmit, ezért kikerült.)

Az `EYAS_DATA_DIR` nélküli telepítéseken — ide tartozik a szállított Docker image és a Helm chart is, amelyek az alapértelmezett `/app/data`-t csatolják — a vault pontosan ott marad, ahol volt. A korábbi verziók a vaultot akkor is a `<EYAS home>/data/vault` alatt tartották, ha az `EYAS_DATA_DIR` máshová mutatott. Olyan telepítésen, amely beállítja az `EYAS_DATA_DIR`-t, a frissítés utáni első indulás egyszer átmásolja a régi vaultot — de csak akkor, ha az adatkönyvtárbeli vaultban még nincs `.md` jegyzet, a régi `<EYAS home>/data/vault`-ban viszont van:

- **Másol, soha nem mozgat**: a régi mappa érintetlen marad, a fájlok tartalma és módosítási ideje megmarad, és semmit nem ír felül, ami már az új vaultban van. Egy log-figyelmeztetés jelzi, hogy a másolás megtörtént, és hogy a régi mappa törölhető, miután ellenőrizted a másolatot.
- Ha a másolás elbukik (például az adatkönyvtár nem írható), az új vault üres marad, a logba hiba kerül a teendővel, és a következő indulás újra megpróbálja.
- Ha már mindkét mappában vannak jegyzetek, semmit nem másol és nem fésül össze. Az EYAS csak a `<data dir>/vault`-ot használja, és minden induláskor figyelmeztet, amíg a régi mappát el nem távolítod; a még szükséges jegyzeteket kézzel másold át a vaultba.

Az `eyas doctor` a **Vault** sorában mutatja a vault útvonalát, és figyelmeztet az áthelyezett adatkönyvtár mellett maradt régi vaultra — lásd [CLI](/docs/hu/deploy/cli/#what-doctor-checks). A beépített [Mentés](/docs/hu/admin/backup/) a `<EYAS home>/data`-t archiválja; ha az `EYAS_DATA_DIR` máshová mutat, azt a mappát vedd fel a saját mentéseid közé.

### Beszélgetés-workspace-ek {#conversation-workspaces}

A saját mappa nélküli beszélgetés a saját **EYAS workspace**-ében dolgozik (lásd [Beszélgetések — Mappák](/docs/hu/daily/conversations/#working-folders)). A workspace-ek soha nem kerülnek git checkoutba, mert egy git repóban indított CLI modell (Claude Code, Grok, Kimi) a repót a saját projektjének tekinti: betölti annak utasításfájljait, git státuszát, jogosultsági szabályait és projektenkénti memóriáját. A workspace-ek helye, sorrendben:

1. `EYAS_WORKSPACES_DIR`, ha be van állítva. Abszolút útvonalat adj meg.
2. Különben `<data dir>/workspaces`, ha az adatkönyvtár nincs git checkouton belül (Docker és Kubernetes image-ek, csomagolt telepítések — ott nem változott semmi).
3. Különben (git clone-ból futó forrástelepítés) egy példányonkénti mappa a felhasználód alkalmazásadat-könyvtárában:
   - macOS: `~/Library/Application Support/eyas/<instance>/workspaces`
   - Linux: `$XDG_DATA_HOME/eyas/<instance>/workspaces`, alapból `~/.local/share/eyas/<instance>/workspaces`
   - Windows: `%LOCALAPPDATA%\eyas\<instance>\workspaces`

Az `<instance>` az EYAS home mappa neve plusz az adatkönyvtár rövid hash-e, így egy gép két példánya (például egy dev és egy éles) soha nem osztozik workspace-eken.

**Frissítés (automatikus, egyszeri).** Ha a hely megváltozott — git checkouton belüli adatkönyvtár, vagy máshová mutató `EYAS_WORKSPACES_DIR` —, az első indulás átmozgatja az automatikusan létrehozott workspace-eket a `<data dir>/workspaces`-ből az új helyre, és átállítja rájuk az őket használó beszélgetéseket. Az általad választott mappákat soha nem mozgatja és nem módosítja. Ha az új helyen már van azonos nevű mappa, a régi a helyén marad, az a beszélgetés továbbra is azt használja, és a logba figyelmeztetés kerül. Az ismételt újraindítás semmin nem változtat.

Ha a workspace-ek helye az adatkönyvtáron kívül van, az adatmentés nem tartalmazza őket; az agentek kimeneti fájljai ettől még megmaradnak, mert beszélgetés-csatolmányként a Dokumentumokba másolódnak. Lásd [Mentés](/docs/hu/admin/backup/).

### Memória az EYAS-on kívül {#memory-outside-eyas}

```yaml
security:
  foreignMemoryPaths: []   # további abszolút útvonalak, amelyeket a modellek se nem olvashatnak, se nem írhatnak
  cliSandbox: auto         # auto | required
```

Az EYAS csak a saját tárain keresztül olvas és ír memóriát. A `security.foreignMemoryPaths` érvényesül: induláskor beolvassa, és a biztonsági kapu ott minden modell olvasását és írását elutasítja. A `security.cliSandbox` azt dönti el, mi történik, ha a CLI-k saját tooljaihoz nem érhető el a kernel fájl-sandbox.

| Kulcs | Alap | Jelentés |
|-------|------|----------|
| `security.foreignMemoryPaths` | **`[]`** | További tárak, amelyeket a modellek se nem olvashatnak, se nem írhatnak — az alábbi beépített listán felül. Abszolút útvonalak; a kezdő `~` kibontódik; üres stringet elutasít. A felsorolt mappa mindenestül védett. A nem abszolút bejegyzéseket figyelmen kívül hagyja, figyelmeztetéssel a logban. Induláskor olvassa be — újraindítás kell hozzá. Ugyanez a lista az oda mutató MCP szervereket, a benne lévő beszélgetés-Mappákat és a benne lévő import-gyökereket is tiltja, és a kernel sandbox tiltólistájának is része. A **Biztonsági események → Memória az EYAS-on kívül** kártya listázza a bejegyzéseidet, és jelöli a hiányzókat és a figyelmen kívül hagyottakat. |
| `security.cliSandbox` | **`auto`** | A kernel fájl-sandbox (macOS Seatbelt, Linux bubblewrap) a Claude Code shelljéhez és a Grok CLI saját tooljaihoz. `auto`: ahol elérhető, használja; ahol nem, a CLI ettől még futtatja a tooljait, a chat pedig beszélgetésenként egyszer értesítést mutat, és a sandboxon kívül futni kérő Claude Code parancs mindig emberi jóváhagyásra vár. `required`: sandbox híján a tooloket használó CLI-kört a CLI indulása előtt elutasítja (a Kimi Code CLI-nek nincs sandboxa, ezért a tooloket használó körei mindig elutasításra kerülnek), és a Claude Code soha nem futtathat parancsot a sandboxon kívül. `off` nincs; bármely más érték konfigurációs hiba, és az EYAS nem indul el. A tool nélküli háttérhívásokat sandbox hiánya miatt soha nem utasítja el. Lásd [Providerek — Kernel fájl-sandbox](/docs/hu/ai/providers/#kernel-file-sandbox). |

Amit a policy beállítás nélkül is véd:

- más asszisztensek állapota a home-mappában: `~/.claude` és `~/.claude.json` (Claude Code), `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, `~/.codeium` (Windsurf), `~/.agents` és `~/.config/agents` (megosztott skillek), `~/.copilot`;
- az OpenCode konfig-, adat- és állapotmappái (az XDG helyek és a `~/.config`, `~/.local/share`, `~/.local/state` tartalékok);
- az Obsidian saját alkalmazásbeállításai, és minden Obsidian vault, a `.obsidian` mappája vagy az Obsidian vaultlistája alapján (az EYAS futása közben létrehozott vaultot kb. 30 másodpercen belül felveszi);
- minden `ai-memory` nevű mappa, és minden `memory` vagy `memories` mappa egy tool pontmappája alatt (`.claude`, `.grok`, `.codex`, `.gemini`, `.kimi`, `.cursor`, `.codeium`, `.windsurf`), projekten belül is;
- ugyanezek a pontmappák más felhasználók home-mappájában.

A közönséges projektfájlok használhatók maradnak: egy projekt `.claude/settings.json`-ja és `.claude/agents`-e, a `CLAUDE.md`, a `docs/MEMORY.md`.

Az EYAS saját adatmappája is privát. A modellek csak ezeket használhatják: a beszélgetés-workspace-eket — minden beszélgetés csak a sajátját, akkor is, ha az `EYAS_WORKSPACES_DIR` az adatmappán kívülre teszi őket —, a Studio projekteket (`data/studio`) és a böngészős letöltéseket (`data/browser/downloads`). A vault, az adatbázis, a kulcsok, a böngészőprofil és az EYAS saját CLI-bejelentkezési mappái (`data/cli-homes`) kizárólag az EYAS-éi; az adatbázisfájl akkor is védett, ha a `database.path` az adatmappán kívülre mutat. Symlinkkel ez nem kerülhető meg: az útvonalat úgy is megítéli, ahogy le van írva, és úgy is, ahová valójában vezet.

**Ami érvényesül.** A biztonsági kapu által látott minden toolhívás minden útvonalát ehhez a policyhoz méri — az API providereken futó EYAS toolokat, a Grok és a Kimi által a tool bridge-en át hívott EYAS toolokat, minden toolhívást, amelyhez a Claude Code engedélyt kér, a Claude Code saját tooljait (egy mindegyikük előtt lefutó ellenőrzéssel), valamint minden Grok/Kimi engedély- és fájlkérést. A védett útvonalat azonnal elutasítja, olvasásra és írásra egyaránt: nincs AI-bíró, nincs jóváhagyási kérdés, semmilyen engedély nem nyitja meg, és az elutasítás nem számít bele a 3 tiltásos zárolásba. Kikapcsolt biztonsági kapuval is érvényes. Minden elutasítás egy sor a **Biztonsági események** alatt. Lásd [Biztonság és adatvédelem — Memória az EYAS-on kívül](/docs/hu/admin/security-privacy/#memory-outside-eyas).

Ugyanez a policy azt is elutasítja, hogy ilyen mappát beszélgetés-Mappaként vagy projekt-munkakönyvtárként ments (lásd [Beszélgetések — Mappák](/docs/hu/daily/conversations/#working-folders)), tiltja az oda mutató MCP szervereket (lásd [MCP](/docs/hu/ai/mcp/#memory-store-servers-are-blocked)), és kihagyja a benne lévő import-gyökereket (lent). Az EYAS saját fájl-tooljai elutasítják a munkamappán belüli, kifelé mutató symlinket — akkor is, ha a célja még nem létezik.

**A kernel réteg.** Azokat a shell-célokat, amelyek nem látszanak a parancs szövegéből, és azokat a CLI-olvasásokat, amelyekhez a CLI soha nem kérdezi az EYAS-t, a kernel fájl-sandbox fedi le, ahol fut (a Claude Code shellje, a Grok CLI saját toolai). Linuxon ehhez bubblewrap (`bwrap`) — a Claude Code-hoz `socat` is — és nem privilegizált user namespace-ek kellenek; az EYAS image ezeket nem tartalmazza (a bubblewrap LGPL licencű; a telepítése az üzemeltető döntése). Az `eyas doctor` a **CLI sandbox** sorában mutatja az állapotot. A Kimi Code CLI-nek nincs kernel sandboxa, így a saját read, grep és glob tooljait csak ott fedi le a policy, ahol az EYAS látja őket.

### CLI providerek: home-ok és környezet {#cli-providers-homes-and-environment}

Az EYAS az AI parancssori eszközöket rövid, engedélylistás környezettel indítja, soha nem a szerver teljes környezetével:

| CLI | Home | Mit kap |
|-----|------|---------|
| Claude Code | A host `HOME`-ja (csak a bejelentkezés közös) | `PATH`, nyelvi beállítás és időzóna, proxyk és CA-csomagok, `HOME`, az Anthropic / Claude OAuth / Bedrock / Vertex bejelentkezési változók, plusz `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` és `DISABLE_AUTOUPDATER=1` |
| Grok CLI | `<data dir>/cli-homes/grok-cli` | `PATH`, nyelvi beállítás és időzóna, `TMPDIR`, `TERM`, `USER`, `LOGNAME`, `SHELL`, proxy- és CA-csomag-változók, valamint az EYAS izolációs kapcsolói |
| Kimi Code CLI | `<data dir>/cli-homes/kimi-cli` | Ugyanaz, mint a Groknál |
| OpenCode | `<data dir>/cli-homes/opencode` | Lásd [OpenCode](/docs/hu/automation/opencode/) |

Nem kerül át: más providerek API-kulcsai, az EYAS titkai, egy `XAI_API_KEY`, a `CLAUDE_CONFIG_DIR`, és a szerver bármely más `CLAUDE_CODE_*`, `GROK_*`, `KIMI_*` vagy `XDG_*` beállítása. A `data/cli-homes` alatti EYAS-os home-ok tartalmazzák a Grok és a Kimi EYAS-os bejelentkezését, és minden modell elől védettek. A Claude Code és a Grok nem frissíti magát, amíg az EYAS futtatja; a CLI-ket magad frissítsd. Ezekhez nincs beállítás. Lásd [Providerek](/docs/hu/ai/providers/#claude-code-isolation).

### CLI-körök időkorlátja {#cli-turn-timeouts}

```yaml
model:
  cli:
    idleTimeoutMs: 600000     # 10 perc csend, amíg nem fut tool
    toolTimeoutMs: 1200000    # 20 perc csend, amíg tool fut
```

A Claude Code, a Grok CLI és a Kimi Code CLI köreit az EYAS nem állítja le egy rögzített idő után. Egy CLI-kör csak akkor áll le, ha a CLI elhallgat: `idleTimeoutMs` ideig nincs üzenet, miközben nem fut tool, vagy `toolTimeoutMs` ideig nincs üzenet, miközben tool fut. A CLI bármely üzenete — streamelt szöveg, egy tool indulása vagy befejezése, egy engedélykérés — újraindítja az órát, és az egész kör hosszára nincs korlát; a **Stop** továbbra is bármikor leállítja a kört, és a beragadt futásokat kereső söprés is érvényes marad. A csend miatt leállított kör időtúllépést jelent, ami újrapróbálhatónak számít: a gateway csak akkor próbálhatja újra egyszer, vagy válthat át máshová, ha még semmi nem streamelődött, a háttérfutást pedig az automatikus újrapróbáló ütemező indíthatja újra.

Mindkét érték ezredmásodpercben van, és pozitív egész számnak kell lennie; a nulla, negatív, tört vagy szöveges értéket a konfiguráció betöltésekor elutasítja. A futó konfigurációból minden CLI-kör elején olvassa be őket, így a módosított érték az EYAS újraindítása után érvényes. A `toolTimeoutMs` maradjon 15 perc fölött, hogy a `run_specialist`-tel indított specialistákat ne vágja el.

### Tartós memória-capture {#durable-memory-capture}

```yaml
memory:
  capture:
    enabled: true          # false = nincs fordulók utáni vault-jegyzet
    minUserChars: 40
    maxPerConversation: 20
    maxInputChars: 4000
```

| Kulcs | Alap | Jelentés |
|-------|------|----------|
| `memory.capture.enabled` | **`true`** | Egy minősülő futás után egy kis modellhívás az EYAS háttérmodelljén eldönti, van-e benne tartós tény, és legfeljebb két vault-jegyzetet ír — soha nem a válasz kritikus útján. Minden olyan úton lefut, ahol az EYAS modellt futtat: chatfordulók, háttérben futó kártyafutások, specialista- és delegált futások (a pipeline-szakaszokat is beleértve), A2A taskok, csapattagok és csatornaválaszok. `false` mindegyiken leállítja; az alábbi nyers rögzítés külön kapcsoló. |
| `memory.capture.minUserChars` | **`40`** | Az ennél rövidebb (karakterben mért) üzenet soha nem ér modellhívást. Csatornaüzenetnél vagy A2A tasknál csak a küldő saját szavai számítanak, így egy csatornán érkező rövid „ok” nem vált ki hívást. |
| `memory.capture.maxPerConversation` | **`20`** | A capture-modellhívások plafonja beszélgetésenként. Egy specialista vagy csapattag a saját al-beszélgetésében fut, így saját plafonja van; egy csatornás beszélgetés minden üzenete egyetlen közös plafonon osztozik. |
| `memory.capture.maxInputChars` | **`4000`** | Az üzeneted és a válasz is legfeljebb ennyi karakterre vágódik, mielőtt a capture-modell látja. |

A hívás API provideren vagy izoláltan futni képes CLI-n fut, soha nem olyanon, amely nem tud izolálni; jogosult modell híján a capture kihagyást rögzít, és nem hív modellt. Az a futás, amely semmit nem válaszolt, nem ír capture-sort. **Költség:** minden specialista, csapattag és csatornaválasz, amelynek utasítása legalább `minUserChars` hosszú, mostantól elkölthet egy további háttérmodell-hívást. Hogy ki írta az üzenetet, az dönti el, hogyan olvassa az EYAS: egy delegált feladat, egy csapat-eligazítás vagy egy kártya célja olyan feladat-utasítás, amelyet egy agent is írhatott, egy csatornaüzenet vagy egy A2A task pedig harmadik fél szavai — ezekből soha nem születik jegyzet arról, hogy ki vagy, vagy hogyan dolgozzon az EYAS, és a jegyzeteik peer bizalmi szinten tárolódnak. A `memory_capture_runs` napló egy `entry_path` oszlopot kap (`interactive`, `background`, `delegation`, `pipeline`, `a2a`, `team`, `channel`; a kiadás előtt írt soroknál üres), automatikusan hozzáadva. Új beállítás nincs. Lásd [Memória — A capture alapból be van kapcsolva](/docs/hu/knowledge/memory/#capture-is-on-by-default) és [GYIK](/docs/hu/reference/faq/).

### Nyers rögzítés {#raw-capture}

```yaml
memory:
  engine: legacy           # csak a determinisztikus kinyerést kapuzza; a felidézés mindkettővel ugyanaz
  l0:
    enabled: true          # false = semmilyen nyers másolat nem marad
    captureToolResults: false
    captureThinking: false
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
| `memory.engine` | **`legacy`** | `legacy` vagy `v2`. Csak azt dönti el, lefut-e a determinisztikus tény-kinyerés: `v2` mellett mindig; `legacy` mellett addig, amíg a `memory.l0.extractInLegacy` be van kapcsolva (ez az alapértelmezés). A felidézés mindig a rétegzett felidézés, bármelyik érték van beállítva. |
| `memory.l0.chunkTokens` | **`8000`** | Méret szerinti kiírás: egy beszélgetés puffere akkor íródik ki, ha a becsült tokenszáma eléri ezt. |
| `memory.l0.idleFlushMinutes` | **`30`** | Idő szerinti kiírás: percenkénti söprés írja ki azt a puffert, amelyik ennyi ideje tétlen. A beszélgetés lezárása és az EYAS leállítása is kiír, tehát a tiszta újraindítás semmit nem veszít el. |
| `memory.l0.captureToolResults` | **`false`** | Minden tool kimenetét is rögzíti, amelyet egy agent-futás hív, bármelyik modell válaszol: az EYAS saját tooljaiét, a CLI által a bridge-en át hívott EYAS toolokét, a Claude Code, a Grok és a Kimi beépített tooljaiét, az `opencode_run` feladaton belül futó OpenCode-toolokét és az OpenCode terminálpaneljének kimenetét. Csak a ténylegesen lefutott hívásokat rögzíti (a sikerteleneket hibaként jelölve); az elutasított, kihagyott és jóváhagyásra váró hívásokat, az üres eredményeket és az ismétléseket nem, ahogy az agent-futáson kívüli toolhívásokat sem. **Bekapcsolás előtt olvasd el a következő bekezdést.** |
| `memory.l0.captureThinking` | **`false`** | Megtartja minden olyan modell gondolkodását („thinking”), amely jelenti, modellhívásonként egy bejegyzésben. Csak auditra: soha nem lesz belőle tény, és soha nem kerül felidézésre. Szó szerint és szerkesztetlenül tárolódik; amíg be van kapcsolva, minden induláskor figyelmeztetés jelenik meg. |
| `memory.l0.toolResultMaxBytes` | **`8192`** | Annak a rekordnak a bájtplafonja, amit egy rögzített toolhívás visszaadott — toolnév, kimenet, hibajelző, kimenetel és hogy ki futtatta —, UTF-8 határon vágva, látható csonkolásjelzéssel. A hívás argumentumai nem számítanak bele: a rekord mellett, az első 2048 karakterükre vágva tárolódnak. Csak tool-eredményre; az üzenetekre nincs plafon. |

A `captureToolResults` és a `captureThinking` értékét az EYAS minden futás elején a futó konfigurációból olvassa; a `local.yaml` többi részéhez hasonlóan a módosítás az EYAS újraindítása után érvényes.

**A `captureToolResults` nem véletlenül van kikapcsolva.** Egy rögzített tool-eredmény a teljes kimenet, szó szerint és szerkesztetlenül, plusz a hívás argumentumainak első 2048 karaktere: a `run_command` stdoutja, a `read_file` tartalma és egy élő `browser_totp` egyszer használatos kód is sima szövegként landol a nyers rétegben. Semmi nem maszkolja őket, és semmi nem titkosítja őket nyugalmi állapotban — a tömörítés nem titoktartás. Bekapcsolt kapcsolóval minden indulás erről figyelmeztetést ír a logba. Csak ott kapcsold be, ahol ez ezen a gépen elfogadható. Egy rögzített hívás soha nem idéződik fel és nem kerül idézve promptba — sem a körhöz adott memóriába, sem a `memory_search`, a `memory_expand`, a Memória oldal keresése vagy egy beszélgetés-összefoglaló útján. Csak a kimenete alakítja a beszélgetésből kinyert témákat és neveket; az argumentumok eredetjelzésként a rekord mellett maradnak, és soha nem kerülnek indexbe vagy kinyerésbe (lásd [Memória — A tool-eredmények nem kerülnek bele](/docs/hu/knowledge/memory/#tool-results-are-not-recorded--and-why-to-leave-it-that-way)).

**Ezeket a sorokat egyetlen oldal sem mutatja.** A nyers naplóhoz nincs UI-oldal, API-végpont és `eyas memory` parancs. Az asszisztens csak a felidézésen keresztül éri el — a belőle levezetett összefoglalókon és tényeken át, illetve a `memory_expand`-dal megnyitott nyers sorokon át. A **Memória → Áttekintés** **Felidéző motor** kártyája megmutatja, hogy a nyers napló, az eszközkimenet és a gondolkodás rögzítése ténylegesen be van-e kapcsolva.

**A nyers napló nő, és semmi nem takarítja.** Ebben a kiadásban nincs megőrzési beállítás és nincs takarító job; egy rögzített üzenet nagyjából 5 KB lemezterület, az indexekkel együtt. Ha ezt még nem akarod megfizetni, állítsd a `memory.l0.enabled` kulcsot `false`-ra. Lásd [Memória](/docs/hu/knowledge/memory/).

### Memóriaindex és felidézés {#memory-index-and-recall}

| Kulcs | Alap | Jelentés |
|-------|------|----------|
| `memory.index.budgetChars` | **`2400`** | A teljes felidézett memóriablokk karakterkerete fordulónként (≈ 600 token), a keretezéssel együtt: az állandó jegyzetek, az üzenethez visszakeresett jegyzetek és a teljes szövegű találatok együtt. A méret a 100k tokenes kontextusablakú modellre szabott, és a válaszoló modell ablakával skálázódik (250k tokentől legfeljebb 2,5-szeresre, nagyjából 29k token alatt kevesebbre) — egy OpenCode-feladatnál (`opencode_run`) is, annak az ablaknak megfelelően, amelyet az OpenCode a kiválasztott modellhez listáz, vagy pontosan ezzel az értékkel, ha az ablak ismeretlen. Az állandó jegyzetek a blokk legfeljebb felét meghagyják a visszakeresetteknek. A be nem férő jegyzeteket egy záró sor összesíti (*… N more notes not shown*), és memóriakereséssel elérhetők maradnak. Emeld meg, ha a `user` és `feedback` jegyzeteid már nem férnek bele. Újraindítás kell hozzá. |
| `memory.recall.includeSecrets` | **`false`** | Eljutnak-e a modellhez a felidézésen, a `memory_search`-ön és a `memory_expand`-on keresztül — és kapnak-e keresővektort — a `contains-secrets` címkéjű jegyzetek, epizodikus sorok és skillek (olyan fájlok, amelyekben az importer hitelesítő adatot talált, és szó szerint eltárolt), valamint a belőlük levezetett nyers sorok, tények és összefoglalók. Kikapcsolva tárolva vannak és a Memória oldalon látszanak, de promptba sosem kerülnek. Újraindítás kell hozzá. |

A felidézést — mit tartalmaz, hogyan épül a lekérdezése, és hogyan jut el minden modellhez — a [Memória — Hogyan jut el a felidézés a modellhez](/docs/hu/knowledge/memory/#how-recall-reaches-the-model) írja le. A **Memória → Áttekintés** **Felidéző motor** kártyája mutatja a keretet és az `includeSecrets` kapcsolót, amellyel az EYAS fut (lásd [Memória — Felidéző motor](/docs/hu/knowledge/memory/#recall-engine)).

**Megszűnt: `memory.relatedWork.*`.** A külön *Related prior work* blokk (`enabled`, `minQueryChars`, `maxHits`, `budgetChars`, `maxSnippetChars`) megszűnt; a korábbi munka most a felidézett memóriablokkon belül érkezik, a `memory.index.budgetChars` szerinti méretben. A meglévő `local.yaml`, amely még beállítja ezeket a kulcsokat, továbbra is betöltődik; a kulcsokat az EYAS figyelmen kívül hagyja.

**Frissítési megjegyzés.** A korábbi verziók a `config/default.yaml`-ban `memory.index.budgetChars: 8000`-et szállítottak; a szállított érték most `2400`, ugyanannyi, mint a beépített alapérték. A régi méret megtartásához add ezt a `config/local.yaml`-hoz, és indíts újra:

```yaml
memory:
  index:
    budgetChars: 8000
```

### Adatbázis-tartósság {#database-durability}

A 0.8.23-beta óta minden EYAS adatbázis-kapcsolat `PRAGMA synchronous = NORMAL`-lal fut az SQLite alapértelmezett `FULL` helyett. A WAL-lal párosítva — amit az EYAS mindig is használt — ez azt jelenti:

- Egy **process**-összeomlás — kilőtt EYAS, lekezeletlen hiba — semmit nem veszít el abból, ami már commitolva van.
- Egy **operációs rendszer**-összeomlás vagy áramszünet pont egy commit pillanatában elveszítheti az utolsó tranzakciót.

Ez a WAL szokásos alkuja, és **minden** modulra vonatkozik, nem csak a memóriára. Ha a példányodban olyan munka van, amit nem tudsz újra bevinni, a tartósság kérdésére a [Mentés](/docs/hu/admin/backup/) a válasz, nem a commit-mód.

### Extra skill- és persona-gyökerek {#extra-skill-and-persona-roots}

```yaml
skills:
  importRoots: []          # extra markdown skill mappák; üres = nincs
agent:
  importRoots: []          # extra persona markdown; üres = nincs
```

A szállított default üres lista. Az útvonalak a `local.yaml`-ba kerülnek, soha a termék-forrásba. Ezeket a gyökereket az EYAS **minden induláskor** beolvassa, tehát élő forrást jelentenek — de csak közönséges mappákra (például egy `/opt/team-skills`-hez hasonló csapatmappára). Az importált skill ugyanazon id bundled másolata fölött nyer. Lásd [Készségek](/docs/hu/automation/skills/#import-roots).

**Gyökerek, amelyeket az EYAS kihagy.** Az a gyökér, amely egy másik asszisztens vagy jegyzetalkalmazás saját mappáin belül van, vagy ilyet tartalmaz, nem kerül beolvasásra:

- más eszközök home-mappái: `~/.claude` (tehát a `~/.claude/skills`, `~/.claude/agents` és `~/.claude/plugins/…` is), `~/.claude.json`, `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, `~/.codeium`, `~/.copilot`, valamint a megosztott skill-mappák, a `~/.agents` és a `~/.config/agents`;
- az OpenCode konfig-, adat- és állapotmappái;
- az Obsidian alkalmazásbeállításai és minden Obsidian vault;
- a `security.foreignMemoryPaths` alatt felsorolt mappák;
- az EYAS saját CLI-home-jai (`data/cli-homes`).

Egy olyan gyökér is kimarad, mint a teljes home mappád, mert ezeket a mappákat tartalmazza. Minden kihagyott gyökérhez a szerver induláskor figyelmeztetést naplóz, például *skills.importRoots: /Users/me/.claude/skills is inside Claude Code (~/.claude) — not scanned; import these files once with Settings → System → Data portability → Import data*, az `eyas doctor` pedig **Import roots** figyelmeztetést mutat a beállítás és a mappa megnevezésével.

**Teendő.** Az ilyen mappából már importált skillek és agentek az EYAS-ban maradnak; csak nem frissülnek belőle többé. A tartalom behozásához vagy frissítéséhez futtass egyszer egy [adatimportot](/docs/hu/admin/data-port/) a mappáról — az EYAS-ba másolódik, az eredetével együtt rögzítve —, majd töröld a bejegyzést a `local.yaml`-ból.

**Az EYAS-ban szerkesztett personákat** az `agent.importRoots` fájljuk **soha nem írja felül**. A fájl az első induláskor létrehozza az agentjét, és később csak addig frissíti, amíg az agent neve, szerepe, leírása, rendszerpromptja és toolja pontosan olyan, amilyennek az utolsó import hagyta; lásd [Agentek — Létrehozás és beállítás](/docs/hu/agents/configure/#imported-personas).

## Agent verify és környezeti változók {#agent-verify-and-environment-variables}

```yaml
agent:
  criticEnabled: true
  criticMaxRounds: 1
  # Determinisztikus ellenőrzések egy háttérfutás után (üres = kikapcsolva)
  verifyCommands:
    - name: bun-test
      command: bun
      args: [test]
  # verifyCwd: /absolute/path/to/repo   # alap: process.cwd()
```

| Kulcs | Jelentés |
|-------|----------|
| `agent.verifyCommands` | `{ name, command, args?, timeoutMs? }` lista — **nincs shell**; hiba esetén az agent a hibaösszefoglalóval újranyílik |
| `agent.verifyCwd` | Ezeknek a parancsoknak a munkakönyvtára |
| `EYAS_ODOO_SOURCE_PATHS` | Kettősponttal vagy pontosvesszővel elválasztott helyi Odoo checkout-gyökerek a könnyű `odoo_search_*` toolokhoz és az opcionális forrás-bootstraphez |
| `EYAS_ODOO_SOURCES_JSON` | Ajánlott többverziós bootstrap: `{ "path", "label?", "version?", "edition?", "family?", "name?", "tags?" }` elemek JSON-tömbje — induláskor tétlen **Keresési források** bejegyzéseket hoz létre, ha ezek az útvonalak még nincsenek regisztrálva |
| `EYAS_AUTO_FAILOVER` | Az üres routing-szint-tartalékok kitöltése egy második élő providerrel (bekapcsolandó) |
| `EYAS_BROWSER_USER_DATA_DIR` | EYAS-saját Chromium-profil a headless `browser_*` toolokhoz (alap: `data/browser/profile`). A napi Chrome/Edge profilt elutasítja |
| `EYAS_AGENT_BROWSER_BIN` | Opcionális Vercel agent-browser CLI útvonala. Üres = PATH. Beállított, de hiányzó útvonal = fail-closed (nincs PATH-tartalék). Profil: `data/browser/agent-browser/profile` |
| `EYAS_DATA_DIR` | Adatkönyvtár (adatbázis, vault, agent-fájlok, …). Alap: `<EYAS home>/data`. Lásd [Adatkönyvtár és vault](#data-directory-and-vault) |
| `EYAS_WORKSPACES_DIR` | Abszolút útvonal a beszélgetés-workspace-eknek. Alap: lásd [Beszélgetés-workspace-ek](#conversation-workspaces) |
| `EYAS_CLAUDE_CODE_BIN` | Abszolút útvonal a `claude` futtatható fájlra, amelyet az EYAS futtat. Üres = `claude` a PATH-on, utána a csomagolt SDK-példány (a doctor figyelmeztet). Beállított, de érvénytelen = fail-closed (nincs tartalék). Lásd [Providerek — Claude Code runtime](/docs/hu/ai/providers/#claude-code-runtime) |
| `EYAS_GROK_BIN` / `EYAS_KIMI_BIN` | Abszolút útvonal a `grok` / `kimi` futtatható fájlra, amelyet az EYAS futtat. Üres = a PATH-on lévő bináris. Beállított, de érvénytelen = fail-closed: a provider nem regisztrálódik. Lásd [Providerek — Grok CLI és Kimi Code CLI](/docs/hu/ai/providers/#grok-cli-and-kimi-code-cli) |
| `LM_STUDIO_URL` | LM Studio szerver (alap `http://localhost:1234`; a záró perjel sem gond) |
| `EYAS_OPENCODE_PLUGIN_TOKEN` | Megszűnt: az EYAS se nem olvassa, se nem állítja be. Minden OpenCode-folyamat, amelyet az EYAS indít (a háttérszerver és minden OpenCode-terminál), saját kulcsot kap a 3-as fájlleírón, soha nem környezeti változóban, és minden memóriahívás egy egyszer használható, munkamenetenkénti bizonyítást visz; a kulcs a folyamat kilépésekor vagy újraindításakor érvényét veszti. Az OpenCode környezete csak az `EYAS_OPENCODE_KEY_FD=3` változót hordozza, amelyet az EYAS maga állít be. Lásd [OpenCode](/docs/hu/automation/opencode/#eyas-memory-inside-opencode) |

### Többverziós Odoo-példa {#multi-version-odoo-example}

```bash
export EYAS_ODOO_SOURCES_JSON='[
  {"path":"/path/to/odoo-18-community","label":"18c","version":"18","edition":"community","family":"odoo"},
  {"path":"/path/to/odoo-18-enterprise","label":"18e","version":"18","edition":"enterprise","family":"odoo"},
  {"path":"/path/to/custom-addons","label":"addons","version":"18","edition":"custom","family":"odoo"}
]'
```

Ezután nyisd meg a **Keresési források** oldalt, futtasd minden forrásra az **Újraindexelés** műveletet, és állítsd be minden [projekten](/docs/hu/daily/projects/) az **Alapértelmezett kódforrások** mezőt. A beszélgetések a **Források** fülön rögzítik a forrásokat — lásd [Keresés](/docs/hu/daily/search/#többverziós-pin-melyik-fát-használhatja-az-ágens).

A tool policy hookok minden toolhíváson lefutnak (PreToolUse / PostToolUse) a ToolExecutoron keresztül — lásd [Eszközök](/docs/hu/automation/tools/).

## Kapcsolódó {#related}

- [CLI](/docs/hu/deploy/cli/)
- [Providerek](/docs/hu/ai/providers/)
- [Routing és költségkeret](/docs/hu/ai/routing-budget/)
- [Memória](/docs/hu/knowledge/memory/)
