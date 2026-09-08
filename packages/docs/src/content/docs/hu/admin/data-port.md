---
title: Adatimport és -export
description: Import varázsló memóriához, skillekhez és workspace-szabályokhoz — scan, kijelölés, jóváhagyás.
---

**Mire való.** Az adatport az **import varázsló**. Szerverútvonalat vagy feltöltött zip/markdownot szkennel másik asszisztensből (Claude Code, Grok CLI, Cursor, Codex CLI, Gemini CLI, Windsurf, GitHub Copilot, Obsidian, chat export, korábbi EYAS export vagy egy sima Markdown mappa), és javasolja, hova kerüljön. A memória alkalmazódhat; a workspace-szabályok és az identity **csak javaslat**, amíg nem hagyod jóvá a merge-t. Nem teljes DB-dump — helyreállításhoz [Mentés](/docs/hu/admin/backup/). Az export még **Hamarosan**.

**Helye:** Beállítások → **Adat hordozhatóság** kártya. *Memória, skillek és szabályok importálása korábbi AI rendszerekből. Az export később jön.*

## Mikor használd

- Tartós jegyzeteket hozol `~/.claude`-ból vagy Obsidian `ai-memory` vaultból az EYAS-ba (az egyetlen memória, amit a későbbi fordulók olvasnak).
- Egyedi skillek Claude/Cursorban — itt **saját** kategória.
- Agent workspace-szabályok/identity merge-javaslatként, soha auto-felülírva.
- Korábbi export zip, fájlmásolás nélkül.

## Tipikus folyamat

1. **Beállítások** → **Adat hordozhatóság** → **Adatok importálása…**
2. **Forrásrendszer**: **Automatikus felismerés**, Claude Code, Grok CLI, Cursor, Codex CLI, Gemini CLI, Windsurf / Codeium, GitHub Copilot, Obsidian, Chat export, EYAS export, Markdown mappa. Az API azonosítói: `claude-code`, `grok-cli`, `cursor`, `codex`, `gemini-cli`, `windsurf`, `copilot`, `obsidian`, `chat-export`, `eyas-export`, `generic-md`.
3. **Szerver útvonal** (abszolút ezen a gépen) **vagy** **Fájl választása…**. Opcionális **Instrukciók**.
4. **Feltérképezés**. Nézd át a mappafát és a csoportokat (Memória, Memória-index, Munkamenetek, Skillek, Szabályok, Identity, Agent-personák, Tudás, Forráskód, Nem importálható). Jelöld, mit tartasz. Teljesen determinisztikus importhoz hagyd üresen a **Metaadatok dúsítása modellel** kapcsolót.
5. **N elem importálása**. Memória/skillek alkalmazódnak; szabályok/identity **Workspace-módosítási javaslatok** — **Merge jóváhagyása** vagy **Elutasítás**.

## Funkciók

| Képesség | Jelentés |
|----------|----------|
| Import | Szerver útvonal és/vagy feltöltés (zip) |
| Célok | Memória (kind + szint), epizodikus munkamenetek, skillek a csomagolt fájljaikkal, agent-personák, workspace-szabályok, projekttípus-prompt |
| Merge | Szabályok/identity **csak javaslat** |
| Dúsítás | **Alapból kikapcsolva** — opcionális kapcsoló, csak metaadat, a törzs soha |
| Nyelv | Az importált memória megtartja a forrásnyelvet |
| Skill kategória | Importált → **saját** |
| Visszavonás | Egy egész job visszavonása — **`delete`** jogosultság kell hozzá a Data Porton |
| Export | **Hamarosan** — `eyas-export-v1` csomag (vault, skillek, workspace-ek, `episodic.jsonl`). Egy csomag titkot tartalmazó jegyzeteket is vihet, ezért indulás előtt ugyanazt a csak-tulajdonos hívóellenőrzést kapja meg, ami a memória-felidézést védi; a Data Port `create` joga önmagában nem lesz elég |

## Mi hova kerül

Nem kell tökéletes mappát választani. **Az útvonal alatt minden feltérképeződik.** Nincs keep-lista és nincs limit: a scan a gyökér alatt minden mappát bejár, bármekkora. Egy tipikus home-nál tízszer nagyobb fa is teljes egészében listázódik és importálódik — ennek ideje és lemezterülete van ára, sosem kihagyás. Csak azok a mappa*osztályok* maradnak bejáratlanul, amelyek soha nem tartalmazhatnak memóriát: függőségmappák (`node_modules`), verziókezelő mappák (`.git`, `.hg`, `.svn`), `.cache`, `__pycache__`, `.venv` / `venv`, build-kimenetek (`dist`, `build`, `out`, `.next`, `.turbo`, `target`), ha build-manifest van mellettük, böngészőprofil-gyökerek (Chrome, Chromium, Firefox, Antigravity — a jelölőfájljaik alapján, bárhol is legyenek), felhőtárhely-gyökerek (`Library/CloudStorage` és `Library/Mobile Documents`, a macOS által adott helyük alapján, valamint a régi szinkronmappák, például a Dropbox, a saját jelölőfájljaik alapján — a pusztán OneDrive vagy Dropbox *nevű* mappa hétköznapi mappa, és bejárja), a kuka (`.Trash`, `.Trashes`, `$RECYCLE.BIN`, `.local/share/Trash`) és a `Library/Caches`. Mindegyik így is **egyetlen látható sor** a fájlszámával és a *Nem átnézett mappa: `<osztály>`* okkal, tehát semmi nem tűnik el némán. A symlinkelt mappát egyszer járja be — a valódi útvonal dönt —, a hurkot pedig jelenti, nem lép bele újra. A `.DS_Store` alkalmazás-állapotként szerepel.

| Forrás | EYAS-réteg |
|--------|------------|
| Jegyzet `type: user` / `feedback` / `project` / `reference` jelöléssel (Claude Code, Obsidian, Grok) | Vault-jegyzet ugyanazzal a **kind** értékkel; a `feedback` a `procedural/`, a többi a `semantic/` mappába; a fájl **a forrás nevét** kapja, így a `[[wikilinkek]]` továbbra is feloldódnak |
| `MEMORY.md` index | Egyetlen `index` címkéjű vault-jegyzet; egy egysoros hook akkor lesz a hivatkozott jegyzet összefoglalója, ha az a jegyzet nem deklarál saját `description`-t |
| Munkamenet-összefoglalók, munkamenet-jegyzetek (`type: claude-session` / `grok-session`) és átiratok — Claude Code `*.jsonl` a subagent-átiratokkal együtt, Cursor agent-átiratok, Codex rollout-ok, ChatGPT / Claude.ai export | Epizodikus memória, munkamenetenként egy sor — a nagyon hosszú munkamenet sorszámozott részekben, sosem elvágva —, a fordulók szó szerint. **Alapból mind ki van jelölve**; ha nem kell, vedd ki a *Munkamenetek* csoport pipáját. A munkamenet mellé mentett eszközkimenet listázódik, de nincs kijelölve |
| Régi memóriamappák (`memory.local-backup-*`, `memory.old`, `*.bak`) | `legacy` címkéjű vault-jegyzet; a már foglalt név `-2` testvért kap, nem esik ki |
| A saját dokumentumaid, bárhol a gyökér alatt | Vault-jegyzet; a kind a `type:` értékéből jön, ha a jegyzet deklarál ilyet, egyébként `reference` |
| Harmadik felek termékdokumentációja | `third-party` címkéjű vault-jegyzet, kijelölve — ha nem kell, vedd ki a csoport pipáját |
| Repókon belüli szabályfájlok (`.cursor/rules/*.mdc`, `.cursorrules`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `global_rules.md`) | Javaslat, bárhol is legyenek a fában |
| Forráskódfájlok | Listázva és importálható, de **nincs** kijelölve — se nem memória, se nem utasítás |
| Adat- és konfigurációs szöveg (`.yaml`, `.toml`, `.csv`, `.log`, egy asszisztens `settings.json`-je …) | Listázva és importálható, de **nincs** kijelölve |
| `SKILL.md` a `references/` és `scripts/` mappákkal | Egy **saját** skill: a teljes csomag szó szerint, a fájlok a `data/skills/imported/<név>-<hash>/` mappába is lemásolva. A skill törzse **abszolút lemezes útvonallal** nevezi meg ezt a mappát, így a csomagolt szkript közvetlenül onnan futtatható |
| `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, Cursor `.mdc`, Windsurf- és Copilot-szabályok | Javaslat az **elsődleges asszisztens** `AGENTS.md` fájljához — vagy a *Projekttípus-prompt* választásakor a `general` projekttípushoz — jóváhagyáskor hozzáfűzve, soha felülírva |
| `.claude/agents/*.md` personák | Agent-definíciók (az eszköznevek EYAS-eszközökre leképezve) |

**Semmi nem vágódik el és nem marad ki némán.** A fájlokat az import egészben olvassa, és nincs méretkorlát: a 4 MiB-nál nagyobb szövegfájl (chat exportnál 50 MiB) teljes egészében bekerül, a során csak egy méretjelölés jelenik meg. A törzsek **bájtról bájtra** íródnak, a nyitó és záró üres sorokkal együtt; a vault-író egyetlen záró sortörése és az eldobott UTF-8 BOM az egyedüli változás. Minden alkalmazott tétel rögzíti, melyik adapter olvasta be (`source.adapter`, illetve a `source:<adapter>` címke — az automatikusan felismert Claude Code job alatt talált Grok-összefoglaló `grok-cli` címkét kap), az összes útvonalat, ahol a tartalom előkerült, és a tartalom sha256-át a ledgerben — vault-jegyzetnél, epizodikus sornál, skillnél, csomagolt skill-fájlnál, agentnél és javaslatnál egyaránt. Az eredeti frontmatter, útvonal, hash és módosítási idő a jegyzettel utazik a `source:` blokkban. Minden fájl, amit a scan nem importál, látható sor az okával. Az ismételt import a már meglévő jegyzeteknél **Változatlan** eredményt ad, és soha nem ír felül — az azonos nevű, eltérő jegyzet `-2` utótagot és `conflict-with:` címkét kap. Egy még jóvá nem hagyott szabályfájl újraimportálása nem hoz létre második javaslatot ugyanarra.

**Egy deklarált, de itt még nem létező projekt vagy projekttípus nem vész el.** Ha egy importált jegyzet frontmatterje `project`-et (vagy `projectType`-ot) deklarál, az importer csak akkor teszi a `projects/<id>/` (vagy `project-types/<id>/`) mappába, ha az a projekt vagy projekttípus már létezik ebben az EYAS-példányban; egyébként a jegyzet scope nélkül, `declared-project:<id>` (vagy `declared-project-type:<id>`) címkével kerül be. A projekt utólagos létrehozása és újraimportálás ekkor már a deklarált azonosító alá teszi, vagy a jegyzet saját kezű áthelyezése is megoldás.

**Bármely asszisztens.** A forrásokat adapterek ismerik fel: Claude Code, Grok CLI, Cursor, Codex CLI, Gemini CLI, Windsurf, GitHub Copilot (csak dokumentált elrendezés), Obsidian, ChatGPT / Claude.ai / általános JSON-export, eyas-export és sima markdown (`generic-md`). A több úton elért fájl (a `~/.grok/memory` alá symlinkelt vault) egy jegyzet lesz.

**A modell-dúsítás alapból ki van kapcsolva.** Az átnézés lépésben ott a **Metaadatok dúsítása modellel** kapcsoló. Bejelöletlenül — ez az alapállapot — az egész import determinisztikus, és egyetlen modellhívást sem használ. Bejelölve, beállított modell mellett a *deklarált típus nélküli* jegyzetek javasolt kind-ot, összefoglalót és címkéket kapnak. Tételkorlát nincs; ideje van ára. A törzs sosem íródik át, a modell szavára semmi nem marad ki, és a `contains-secrets` címkéjű tétel sosem kerül elküldésre. Az eredménypanel mutatja, hány jegyzet dúsult.

**Visszavonás.** Minden job visszavonható az eredménypanelről vagy a *Korábbi importok* listából: a jegyzetek, epizodikus sorok, skillek (és lemásolt fájljaik), agentek és jóváhagyott szabály-szakaszok eltűnnek; a függő javaslatok elutasítódnak. A visszavonás destruktív, ezért **`delete` jogosultságot kér a Data Porton** — a szállított alapbeállítás szerint csak owner és admin; másnak a gomb jogosultsági hibával áll meg. Az **import óta szerkesztett** vault-jegyzethez nem nyúl: törlés helyett a *kihagyott* listán jelenti.

A read toolok nyitva maradnak a host memória-pathokon, hogy ez az importer bemásolhassa őket; írás/shell `~/.claude` / `~/.grok` / `ai-memory` felé tiltva. Lásd [Memória](/docs/hu/knowledge/memory/).

## Titkok

A titok-heurisztika által megjelölt fájl **szó szerint, mint bármelyik másik fájl, bekerül**, és `contains-secrets` címkét kap. Semmi nem esik ki azért, mert titkot tartalmaz — itt a biztonság *felidézési*, nem importálási intézkedés. A címke jegyzetcímkeként, skill-képességként, epizodikus címkeként és a javaslat címében `[contains-secrets]` formában utazik, a varázsló pedig megjelöli a sort, hogy import előtt lásd.

A heurisztika privátkulcs-blokkot, szolgáltatói tokent, `KEY=value` literált vagy `.env`-szerű fájlnevet keres. Az a kód, amely *lekérdez* egy titkot — `keychain_lookup(...)`, `os.environ[...]`, `getenv(...)` —, valamint a dokumentációs helykitöltők, mint a `<your-key>`, az `xxx` vagy a `.env.example`, nem kapnak jelölést.

**Mit csinál a címke.** A `contains-secrets` címkéjű jegyzet, epizodikus sor vagy skill kimarad mindenből, amit a modell magától elér: az állandó memóriaindexből, a kapcsolódó munkából, a `search_memory`-ból, a reflexiós jobból, az éjszakai konszolidálóból, a skill-illesztőből és az összeállított rendszerpromptból. Az opcionális dúsító modellnek sosem adódik át, és sosem kap beágyazást. A Memória oldalon viszont teljes egészében látod. Ha meg akarod nyitni a modell felé, állítsd a `memory.recall.includeSecrets` kulcsot `true`-ra a `config/local.yaml`-ben, és indítsd újra — lásd a [Konfigurációt](/docs/hu/deploy/configuration/).

**Ez automatikus-behúzási kapu, nem fájlrendszer-homokozó.** A címke azt akadályozza meg, hogy a megjelölt tétel magától bekerüljön egy promptba. Nem akadályozza meg, hogy egy fájlolvasó eszközökkel bíró agent elolvassa az eredeti fájlt a lemezen, és semmit nem titkosít. Ha egy hitelesítő adatnak egyáltalán nem volna szabad ezen a gépen lennie, cseréld le: az importer dolga az, hogy ne kerüljön kéretlenül promptba, nem az, hogy elérhetetlenné tegye.

**Két fajta nincs kapuzva, mert ott a tartalom *maga* a prompt.** Az importált agent-persona és a jóváhagyott workspace-szabályfájl **szó szerint kerül az asszisztens promptjaiba**, így a benne lévő hitelesítő adat minden fordulóban eljut a modellhez, és a felidézési szűrés itt nem érvényes — a kapuzás pont azt az agentet kapcsolná ki, amit importáltál. Ezek is `contains-secrets` címkét kapnak, hogy megtaláld őket, és a varázsló ugyanezt írja ki ezeknél a soroknál: import előtt nézd át őket.

**A hitelesítőadat-szerű fájlok** — `.env`, `credentials.json`, kulcsfájlok — listázódnak és importálhatók, de **nincsenek kijelölve**. Az a jegyzet, szabály, skill vagy átirat, amely csak *tartalmaz* egy kulcsot, megtartja a saját kindját, kijelölve marad, és megkapja a címkét.

## Méret

Minden jelölt egy-egy adatbázissor, így sem a varázsló, sem a szerver nem tartja a memóriájában a teljes listát.

**A scan a háttérben fut.** Azonnal válaszol, a mappafa pedig menet közben töltődik fel, jelentve a bejárt mappákat, a látott fájlokat és a listázott sorokat. Egy teljes home percekbe telik. Megállíthatod, és ami addig feltérképeződött, továbbra is átnézhető.

**Az átnézés lépés mappafa, virtualizált lista és előnézet.** Minden mappa fel van térképezve, a bejáratlan osztályok is — ezeknél látszik a fájlszám és az az osztály, ami miatt a scan nem lépett be. A **Minden importálható kijelölése**, az **Egyik sem** és a **Vissza a javasolthoz** az egész scanre hat. Alattuk a kijelölés gesztusokkal megy, nem soronként: minden mappa és minden fajta háromállású jelölőnégyzetet kap, tehát egy kattintás minden mappában kiveszi az összes átirat pipáját. A jelölőnégyzetek melletti szám a szerver saját válasza a képernyőn lévő kijelölésre, tehát amit olvasol, azt fogja az import be is tölteni. Az előnézet a fájl első 64 KiB-ját mutatja; az import így is egészben viszi.

**Az import streamel.** A tételek 100-as kötegekben mennek, minden köteg commitolódik, a haladás 100 tételenként jelentődik, a keresési index pedig egyszer épül újra a végén. A folyamatot az aktuális köteg után megállíthatod — ami már bekerült, marad, és visszavonható. Ha a szerver import közben újraindul, a job az utolsó commitolt kötegtől folytatódik, nem elölről. A scan és az import ideje is látszik.

**A memóriaigényt egyetlen nagy fájl szabja meg, nem az egész fa.** Egy konténer — egy átirat, egy chat export, egy Codex-adatbázis — importálása a saját fájlméretének többszörösét igényli átmeneti memóriában, mert a fájl egyetlen pufferként áll rendelkezésre, miközben a benne lévő összes egység renderelődik. Hogy hányszorosát, az a fájl fajtájától függ: a fordulónként egy soros átiratnál nagyjából háromszorosát, a chat exportnál hétszeresét vagy többet, mert azt egyben, egyetlen objektumgráffá elemzi. Az import fázis többe kerül, mint a scan — egy 19 MB-os átirat scanelés közben 100 MiB-ot, importálás közben 235 MiB-ot mért. Egy 90 MB-os chat export csúcsa 900 MiB rezidens memória közelében van; erre a Helm chart 1Gi-s alapértéke elég, az 512Mi-s régi starter nem.

**A soronkénti memóriaigény akárhány sornál lapos marad.** A scan végeztével semmi nem marad benn: ugyanannak a 26 000 soros fának a második scanelése egyáltalán nem növeli a heapet. A rezidens memória utána mégis magasnak látszhat, mert az allokátor megtartja a rendszertől már elkért lapokat — ez az allokátor, nem a scan. A korlátot a legnagyobb egyedi fájlod adja, nem a fa mérete.

**Az ismételt futtatás csak az újat adja hozzá.** Ami már megvan, **Változatlan** eredményt ad, és egy későbbi import sosem von vissza egy korábbit.

Két motor-tény, hogy semmi ne érjen meglepetésként:

- A 200 000 karakternél hosszabb csomagolt skill-fájl eddig a pontig kerül be a skill törzsébe, egy jelöléssel, amely megnevezi a teljes másolatot. A skill asset-mappájában lévő másolat bájtpontos és hiánytalan.
- Az egyetlen szövegfájl, amely nagyobb, mint amit a motor egy szövegértékként kezelni tud (kb. 512 MiB), listázódik, hash-elődik és kijelölhető, mint bármelyik másik, de a *Nagyobb, mint amit a motor egy szövegértékként kezelni tud* okkal jelenik meg ahelyett, hogy bekerülne. A sor megmondja, miért.

**Egy kikötés az azonosságról.** A munkameneteknek és a skilleknek nincs útvonal-azonosságuk — a tartalmuk digestje azonosítja őket. Ha egy forrásfájlon az import után csak whitespace változik, az *második* epizodikus sort hoz létre (és második skillt, ha a csomag fájlokat is visz) ahelyett, hogy az elsőt frissítené. A vault-jegyzetek, amelyeknek van útvonal-azonosságuk, helyben frissülnek.

## Mezők és vezérlők

<h2 id="wizard">Import varázsló</h2>

Lépések: **forrás → feltérképezés → átnézés → fut → kész**.

| Vezérlő | Jelentés |
|---------|----------|
| **Forrásrendszer** | Fenti profilok |
| **Szerver útvonal** | Abszolút — egy mappa vagy egy teljes home könyvtár. Ha az **Automatikus felismerés** helyett konkrét forrásrendszert választasz, megjelennek a hozzá tartozó **Tipikus helyek**, magától az adaptertől |
| **Archívum vagy fájl feltöltése** | ZIP egy korábbi exportból, vagy egyetlen markdown/JSON fájl. Az 50 MiB-os törzsméret csak a feltöltésre vonatkozik; az útvonal-scanre nincs korlát |
| **Instrukciók** | Opcionális — mit keressen. Csak a rangsorolást vezeti; miatta semmi nem esik ki |
| **Feltérképezés** | A fa feltérképezése a háttérben — bejárt mappák, látott fájlok, listázott sorok és a **Scan leállítása** |
| A scan által talált mappák | Az összes feltérképezett mappa, mappánkénti kapcsolókkal, részfa-számokkal és **A mappában lévő sorok okai** listával — importálható és nem importálható egyaránt, beleértve a bejáratlan mappa osztályát |
| Típus szűrő | **Összes / Memória / Memória-index / Munkamenetek / Skillek / Szabályok / Identity / Agent-personák / Tudás / Forráskód / Nem importálható** |
| **Minden importálható kijelölése / Egyik sem / Vissza a javasolthoz** | Tömeges kijelölés az egész scanen, nem csak az adott oldalon |
| Mappa- és fajta-jelölőnégyzet | Háromállású — egy kattintás kijelöli vagy törli a mappa alatti összes importálhatót, illetve az adott fajta összes sorát minden mappában |
| **Előnézet** | A fájl első 64 KiB-ja — az import így is egészben viszi |
| **Metaadatok dúsítása modellel** | Alapból ki — opcionális, csak metaadat, a törzs soha, és megjelölt tétel soha |
| **N elem importálása** | Háttérjob |
| **Import leállítása** | Az aktuális köteg után áll meg; ami bekerült, marad |
| Stat | **Kijelölve / Alkalmazva / Változatlan / Javaslatok / Kihagyva / Hibák** |
| **Kihagyva, ok szerint** | Eredmények okkódonként (lásd lent) |
| **Scan ideje / Import ideje** | Melyik fázis mennyi ideig tartott |
| **Merge jóváhagyása / Elutasítás** | Workspace-javaslatok — soha auto-merge |
| **Import visszavonása** | Az egész job visszavonása — `delete` jogosultság kell a Data Porton |
| **Korábbi importok** | Az utolsó öt job, mindegyiknél saját visszavonás gomb |

Üres scan: *Nem találtunk importálható tartalmat ezen a helyen.*

## Okkódok

Az átnézés-lista minden sora hordoz egy okot, és minden eredmény, ami nem tiszta alkalmazás, a **Kihagyva, ok szerint** listában is megjelenik. Mindkettő egyetlen rögzített szótárból jön — sosem szabad szöveg —, így a varázsló a lenti címkét mutatja, míg az API és a naplók a kódot viszik.

| Kód | Jelentése |
|------|---------------|
| `directory-skipped` | Soha be nem járt mappaosztály — egyetlen megszámolt sor, a fájlszámmal és az osztállyal |
| `binary` | Bináris fájl |
| `outside-root` | A kiválasztott mappán kívül |
| `duplicate-content` | Azonos tartalom |
| `unreadable` | Nem olvasható |
| `empty` | Üres fájl |
| `derived-index` | Generált index |
| `transcript` | Beszélgetés-átirat (egészben importálva) |
| `session-summary` | Munkamenet-összefoglaló |
| `session-artifact` | Munkamenet mellé mentett eszközkimenet |
| `persona` | Agent-persona |
| `slash-command` | Slash parancs |
| `cursor-rule` | Cursor szabályfájl |
| `memory-note` | Memória-jegyzet |
| `memory-index` | Memória-index |
| `skill-package` | Skill-csomag |
| `skill` | Skill fájl |
| `orphan-asset` | Nem importált skill csatolt fájlja |
| `rules-file` | Szabályfájl |
| `config` | Konfigurációs fájl |
| `source-code` | Forráskódfájl — importálható, nincs kijelölve |
| `data-file` | Adat- vagy konfigurációs szöveg — importálható, nincs kijelölve |
| `symlink-upload` | Symlink a feltöltésben |
| `needs-bun` | Bun futtatókörnyezet kell hozzá |
| `not-downloaded` | A felhőben tárolva, nincs letöltve — a fájlrendszer adataiból listázva, sosem lehívva |
| `invalid-json` | Érvénytelen JSON |
| `unknown-json` | Ismeretlen JSON |
| `unrecognised` | Nem felismerhető |
| `app-state` | Alkalmazás-állapot |
| `identity` | Identitásfájl |
| `not-durable` | Harmadik féltől származó vagy sablonszöveg — csak címke |
| `tools-policy` | Eszköz-szabályzat |
| `not-importable` | Nincs benne importálható |
| `missing-unit` | A fájlbeli része eltűnt |
| `unsupported-target` | Nem támogatott cél |
| `service-unavailable` | A szolgáltatás nem volt elérhető |
| `not-a-persona` | Nem agent-persona |
| `no-agent` | Nincs fogadó agent |
| `exceeds-string-limit` | Nagyobb, mint amit a motor egy szövegértékként kezelni tud — listázva, még nincs betöltve |
| `unchanged` | Már importálva, változatlan |
| `error` | Hibával elszállt |

A `not-durable` és a `transcript` csak címke: egyik sem vesz ki semmit a kijelölésből. Az **Ismeretlen** fajta már nem keletkezik — csak a kiadás előtt készült scaneken él tovább.

## Kapcsolódó

- [Memória](/docs/hu/knowledge/memory/)
- [Készségek](/docs/hu/automation/skills/)
- [Mentés](/docs/hu/admin/backup/)
- [Agentek — workspace](/docs/hu/agents/identity-workspace/)
