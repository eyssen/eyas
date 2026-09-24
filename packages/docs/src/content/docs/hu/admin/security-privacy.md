---
title: Biztonság és adatvédelem
description: Biztonsági kapu, eseménystream, audit napló és az adatvédelmi policy — tool előtt és után.
---

**Mire való.** Három operátori felület. A **biztonsági kapu** a runtime policy, ami a toolhívást *mielőtt fut* engedélyezi, tiltja vagy eszkalálja. A **Biztonsági események** (`/security`) ezeknek a döntéseknek a streamje. Az **Napló** (`/audit`) a megváltoztathatatlan action log (opcionális rollback). Az **Adatvédelem** (`/privacy`) az a hely, ahol az adatvédelmi policyt szerkeszted és teszteled: mely személyes adatok maszkolódnak, amikor a szöveg távoli modell felé elhagyja az EYAS-t, mely új üzenetek kerülnek elutasításra — és ugyanaz a maszkolás, amelyet a tartós memória-capture a vault-írás *előtt* alkalmaz.

## Mikor használd

- Egy toolhívást elutasított a kapu, és látni akarod a kontrollpontot, a kockázatot és az indokot.
- Böngésző toolok ne érjenek privát/metadata hostot (SSRF).
- Autonómiát kapcsolsz, és látni akarod, mit eszkalál a kapu.
- PII szivárog-e logba, vault jegyzetbe, kimenő promptba.
- Tudni akarod, mit kap egy távoli modell, ha a promptban e-mail-cím, IBAN vagy adószám van.
- Egy modell egy útvonalra *Memory outside EYAS …* vagy *… is read and written only by EYAS* elutasítást kapott, és tudni akarod, miért — vagy látni akarod, mely helyek tiltottak ezen a szerveren.
- Tudni akarod, hogyan tartja távol az EYAS az AI parancssori eszközöket (Claude Code, Grok, Kimi, OpenCode) a gép saját beállításaitól, hogyan bizonyítja ezt, és hogy aktív-e a kernel fájl-sandboxuk.
- Egy üzenet *Az üzenet nem ment el — adatvédelem* elutasítást kapott, vagy módosítani akarod, mely értékek maszkolódnak vagy kerülnek elutasításra.
- Egy modell az EYAS izolációja nélkül futott, és a memóriáját minden modell elől el kell rejteni (lásd [Egy provider memóriájának karanténba helyezése](#quarantine-a-providers-memory)).

## Tipikus folyamat

1. Nyisd meg a **Biztonság** (`/security`) oldalt. Felül az **EYAS-on kívüli memória** kártya áll (ownerek és adminok). Az eseményeket döntés (**Engedélyezés / Elutasítás / Eszkaláció**), kockázat és kontrollpont szerint szűrheted.
2. **Napló** (`/audit`): ki mit csinált, modul, eredmény (**sikeres / hiba / elutasítva / visszavonva**), költség. Visszavonás megerősítéssel, ha van.
3. **Adatvédelem** (`/privacy`). Olvasd el a forgalmi számlálókat, igazítsd a policyt (művelet típusonként, egyéni minták, helyi gépek), és **Szabályzat mentése**, majd **PII-vizsgáló tesztelése** mintaszöveggel — az *Ahogy a távoli modell megkapja* rész az, amit egy távoli modell kapna.
4. [Autonómia](/docs/hu/agents/autonomy/) + [Titkok](/docs/hu/admin/secrets/).
5. SSH más gépre: [Csomópontok](/docs/hu/admin/nodes/) — destruktív mintákhoz explicit force flag.

## Funkciók

| Terület | Útvonal / jelentés |
|---------|-------------------|
| **Biztonsági kapu** | Runtime policy veszélyes toolok előtt |
| **Biztonsági események** | `/security` eseménystream, az **EYAS-on kívüli memória** kártyával |
| **Napló** | `/audit` megváltoztathatatlan műveletnapló |
| **Adatvédelem** | `/privacy` forgalmi számlálók, adatvédelmi policy szerkesztője, szkenner-teszt |

### Böngésző SSRF-védelem {#browser-ssrf-protection}

A böngésző toolok **privát / metadata** hostot blokkolnak. `browser_snapshot` kompakt accessibility fához; az index navigáció után érvénytelen. A headless profil az EYAS-é (`data/browser/profile`), a napi Chrome-profil tiltott (Chrome 136+). A `browser_evaluate` az oldalon fut, nem Node-ban. A `browser_totp` **sárga**: a seed a Titkokból/Keychainből jön, csak a rövid életű kód megy a `browser_fill`-be. Az action-cache JSON locatort tárol, titkot és kitöltött értéket nem. Az opcionális [Browser Use](/docs/hu/automation/browser-use/) sidecarek (ajánlott: agent-browser, `data/browser/agent-browser/profile`; régi Python CLI) soha nem kapcsolják ki a sandboxot, soha nem hívnak `chat`/AI Gateway-t, és soha nem a napi Chrome-profilra csatlakoznak.

### Csak olvasó git kattintás nélkül {#read-only-git-without-a-click}

A `git_status` és `git_diff` zöld. Ha a modell `run_command` / `Bash` argv-ja egyértelműen `git status` vagy `git diff` (nincs metachar, nincs `-C` / `--git-dir` / `--no-index`, nincs abszolút path), a gate ezekre a toolokra képezi, és **engedélyezi** — nincs jóváhagyási sor. A `git commit`, `git add`, `ls` és a metachar-os parancsok pirosak vagy elutasítottak. Lásd [Eszközök](/docs/hu/automation/tools/).

### Biztonsági bíró {#security-judge}

A sárga és piros toolhívások futás előtt AI-ellenőrzést kapnak. Ez egyetlen rövid, izolált hívás az EYAS háttérmodelljén — toolok és beszélgetés-előzmény nélkül, és soha nem olyan CLI-sessionben, amely betölti a CLI saját memóriáját vagy konfigját. Sorrendben a **Heartbeat** routing-szintet, aztán a **Gyors** szintet, aztán a telepítés alapértelmezését, aztán a többi jogosult providert használja (bármely API provider, a Claude Code, a Grok CLI, miután a provider betöltésekor (indulás, újratöltés, újra-engedélyezés) futó izolációs ellenőrzése vagy egy kör session-indítása sikeres volt, és a Kimi Code CLI, miután ezen a hoston elindult egy sessionje — ebbe beletartozik a betöltéskori modellfelderítés is, ha be van jelentkezve az EYAS-hoz). Második modellt csak hálózati, időtúllépési, túlterheléses vagy rate-limit hiba után próbál.

Ha egyik modell sem jogosult (például csak Grokos telepítésen, amelynek izolációja még nincs ellenőrizve), a modell-költségkeret leállt, vagy minden próbálkozás elbukik, a hívás **a te jóváhagyásodra eszkalálódik** (jóváhagyási kérés a sorban) — soha nem engedélyeződik. Korábban a sikertelen AI-ellenőrzés egyenesen blokkolta a hívást. Ha egy agent autonómia-kategóriája a 3. szinten (**Automatikus**) van, az EYAS kérdezés nélkül lefuttatja a hívást, ahogy eddig is tette, amikor egyáltalán nem volt beállított AI provider. Az ellenőrzés által nem értelmezhető válasz továbbra is tiltja a hívást. Ha a Claude Code az egyetlen modell, minden AI-ellenőrzés egy rövid, izolált Claude Code folyamatot indít.

### Memória az EYAS-on kívül {#memory-outside-eyas}

A biztonsági kapu minden modell és minden általa ellenőrzött toolhívás esetén elutasítja az EYAS-on kívüli memóriát — **az olvasást és az írást is**. Elutasítva:

- más asszisztensek memóriája és állapota: Claude Code (`~/.claude`, `~/.claude.json`), Grok, Codex, Gemini, Kimi, Cursor, Windsurf, az OpenCode mappái, a megosztott agent-skill mappák, Copilot, ugyanezek a ponttal kezdődő mappák más felhasználók home-jában, bármely `ai-memory` mappa és bármely memóriamappa egy tool ponttal kezdődő mappája alatt;
- az Obsidian vaultok (a `.obsidian` mappájuk vagy az Obsidian vaultlistája alapján felismerve) és az Obsidian alkalmazásbeállításai;
- minden, a `security.foreignMemoryPaths` alatt felsorolt útvonal (induláskor olvassa be; a nem abszolút bejegyzéseket figyelmeztetéssel a logban kihagyja);
- az EYAS saját adatmappája — vault, adatbázis (akkor is, ha a `database.path` máshová mutat), kulcsok, böngészőprofil és az EYAS saját CLI-bejelentkezési mappái (`data/cli-homes`);
- egy másik beszélgetés workspace-e, ha a hívás munkamappái ismertek.

Továbbra is engedélyezett: a beszélgetés saját workspace-e és mappái, a Studio projektek (`data/studio`), a böngészőletöltések (`data/browser/downloads`), és a közönséges projektfájlok, például `CLAUDE.md`, `AGENTS.md`, `.claude/settings.json`, `.claude/agents` és `docs/MEMORY.md`. Az a fájl, amelynek szövege csak *említi* ezeket az útvonalakat, rendben van — a kapu az útvonalat ítéli meg, nem a tartalmat —, és a Grep keresőmintáját soha nem kezeli útvonalként.

**Hol érvényes:** az EYAS saját agent-hurka által futtatott EYAS toolokra (API providerek); azokra az EYAS toolokra, amelyeket a Grok és a Kimi a tool bridge-en keresztül hív (a bridge a szerveren ismeri a kör mappáit, és egy kérés soha nem nevezhet meg sajátot); minden toolhívásra, amelyhez a Claude Code engedélyt kér; a Claude Code saját beépített tooljaira (Read, Write, Edit, Glob, Grep, Bash, NotebookEdit, WebFetch, …), amelyek **futás előtt** átmennek egy ellenőrzésen — beleértve azokat az olvasásokat is, amelyeket a Claude Code a munkamappáján belül egyébként magától engedne; minden Grok/Kimi engedélykérésre (a Grok minden natív tooljához engedélyt kér, az olvasásokhoz is); és minden fájlra, amelyet a Grok vagy a Kimi az EYAS-on keresztül olvas vagy ír. Hogy mely mappák számítanak a beszélgetéséinek, azt az EYAS dönti el — a még érvényes Mappái plusz az a mappa, amelyben a CLI elindult —, soha nem az, hogy a CLI szerint hol van. A háttérben futó OpenCode-feladatokat ugyanígy, a feladat mappáival ellenőrzi. A Grok, a Kimi és az OpenCode saját, EYAS-hoz tartozó home-ban fut, oda mutat a `~` és a `$HOME`: az ezekkel írt útvonalat az EYAS annak a home-nak és a te home-odnak megfelelően is megítéli, így a `~/../../vault` vagy a `$HOME/../../sqlite` nem éri el az EYAS adatait vagy egy másik CLI bejelentkezési mappáját.

**Egy mappát az is minősít, amit tartalmaz.** Egy CLI, például a Claude Code, kérdezés nélkül olvas és keres a munkamappáján belül — a kiadási ellenőrzés a valódi binárison igazolta, hogy az ilyen olvasások soha nem jutnak el a jóváhagyási lépésig. Ezért egy beszélgetés, projekt vagy projekttípus Mappáját az EYAS nemcsak akkor utasítja el, ha a fenti helyek egyikén belül van, hanem akkor is, ha egyet **tartalmaz**: az EYAS saját home-ját, adatmappáját, adatbázisát vagy workspace-mappáját (például az EYAS checkoutját, amelyben a `data/` van), egy másik AI-eszköz tárolóját vagy egy EYAS-os CLI bejelentkezési mappáját, egy jegyzettárat (vaultot), egy `ai-memory` mappát vagy egy `security.foreignMemoryPaths` bejegyzést (például egy vaultot tartalmazó `~/Documents` mappát). A korábban mentett, most elutasított mappák minden futásból kimaradnak, erről a chat értesítést mutat. Lásd [Beszélgetések — Mappák](/docs/hu/daily/conversations/#working-folders). A Claude Code-on a memória-policy ellenőrzése azokat az olvasásokat is elutasítja, amelyeket a Claude Code a munkamappáján belül magától engedne — egy vaultot vagy az EYAS adatait abszolút vagy relatív útvonalon, szimbolikus linken, Grep, Glob, LS vagy egy shelles `cat` útján elérve; ezt a valódi bináris igazolta.

**A keresést az minősíti, amit elérhet.** Egy CLI saját tooljaival végzett keresést az EYAS nemcsak akkor utasít el, ha a mappája védett, hanem akkor is, ha a keresett mappa **tartalmaz** egy védett helyet, és a befoglaló globjai elérhetik azt: a CLI-nek nem lehet megmondani, hogy azt a helyet hagyja ki, ezért a hívás még a futása előtt elutasításra kerül. Ez vonatkozik a Claude Code Grep, Glob és LS tooljára; a Grok grep és list_dir tooljára; az OpenCode grep, glob és list tooljára; valamint a Claude Code Bash tooljával, a Grok shelljével és az EYAS `run_command` tooljával futtatott, rekurzívan kereső shellparancsokra — `grep -r`/`-R`, `rg`, `ag`, `ack`, `find`, `fd`, `tree`, `du`, `ls -R`, rekurzív `cp`/`rsync`/`scp`/`zip`/`tar`/`ditto`, `locate`/`mdfind`, `git grep --no-index` —, illetve azokra, amelyek glob-szavakat használnak, például `cat ~/.*/projects/*/memory/*.md`. A védett helyek a fent felsoroltak.

- **Elutasítva**, például: Grep a `~` mappában `**/memory/*.md` globbal; Glob a `~` mappában `**/MEMORY.md`-re; `grep -r token ~`; Grep a `~/Documents` mappában, ha vault van benne; olyan Grep, amelynek útvonala az EYAS checkoutja vagy egy fölötte lévő mappa, például `grep -rn x ~/GitHub`, ha a checkout benne van (a checkoutban van a `data/`).
- **Továbbra is engedélyezett:** az a keresés, amelynek mappája vagy globja nem érheti el a védett helyet — például a checkout `src` mappája mint útvonal, vagy az `src/**/*.ts` glob a checkouttal mint útvonallal —, és minden keresés egy közönséges projektmappában. Egy fájl here-dokumentummal való megírása (`cat > a.ts <<'EOF'` … `EOF`) nem keresés: a sorai adatok, soha nem glob-szavak vagy parancsok. A kizáró globok (`!…`) nem szűkítik a keresést. Egy perjel nélküli glob (`*.md`) a ripgrephez hasonlóan bármilyen mélységben illeszkedik, így minden almappát elér; a shelles glob-szavak ott vannak lehorgonyozva, ahol le vannak írva.
- **Ugyanaz az elutasítás.** Ugyanaz a kemény, determinisztikus elutasítás, mint minden más memóriaútvonal-elutasítás: nincs AI-bíró, nincs jóváhagyás, semmilyen engedély nem nyitja meg, nem számít bele a 3 tiltásos zárolásba, és kikapcsolt kapuval is érvényes. Egy **Elutasítás** sort ír a Biztonsági események alá (`deterministic` kontrollpont), és beleszámít az [EYAS-on kívüli memória kártya](#memory-outside-eyas-card) elutasítási számába.
- **Hogyan találja meg a helyeket.** Az EYAS által név szerint ismert helyeket mindig ellenőrzi: más eszközök tárait, a regisztrált Obsidian vaultokat, a `security.foreignMemoryPaths` bejegyzéseit, az EYAS adatmappáját és adatbázisát, a CLI home-okat és más beszélgetések workspace-eit. A csak a `.obsidian` mappájukról ismert vaultokat, az `ai-memory` mappákat, az eszközök ponttal kezdődő mappái alatti memóriamappákat és a védett helyekre mutató szimbolikus linkeket a keresett mappa korlátozott átnézésével találja meg: az első 2000 mappa, 8 szint mélységig, soha nem a `node_modules` vagy a `.git`/`.hg`/`.svn` mappákon belül. Ezen a korláton túl csak a név szerint ismert helyeket ellenőrzi. A shellparancsok értelmezése továbbra is legjobb szándékú: a változókat nem követi; a `cd`-t, az `eval`-t, az `sh -c`-t, a szkriptjét here-dokumentumból olvasó shellt, a foglalt szavakat (`if`, `then`, `do`, `{`, `!`), az átirányításokat, például `2>/dev/null`, és a kapcsos zárójeles alternatívákat, például `~/{.,}`, igen. Az `xargs` vagy `parallel` által futtatott keresés a mappáit olyan bemenetből kapja, amelyet a parancssor nem mutat, ezért a `/` keresésének számít.
- **Az EYAS saját `grep` és `glob` toolja** egy ilyen mappára soha nem kap elutasítást: kihagyják a védett mappákat, és mostantól a védett fájlokat is — a keresett mappában tartott adatbázist vagy a `security.foreignMemoryPaths` alatt felsorolt fájlt, akkor is, ha közvetlenül meg van nevezve.
- **Kimi Code CLI** (a kimi-cli 1.52.0 forráskódja alapján; hoston nem ellenőrizve): a Kimi saját Grep és Glob toolja soha nem kérdezi az EYAS-t, így az EYAS nem tud elutasítani egy védett hely fölött induló Kimi-keresést. A Kimi Globja a munkamappáján belül marad, a Grepje viszont bármely mappát elfogad, és a Kiminek nincs kernel sandboxa. A Kimi shellparancsai kérdeznek, de a kérés nem olyan formában hordozza a parancsot, amelyet az útvonal-ellenőrzés olvasni tud, így az AI-bíró vagy egy ember dönt.

**Hogyan utasít el:** azonnal és determinisztikusan. Nincs AI-bíró, nincs jóváhagyási kérdés, és semmilyen jóváhagyás vagy engedély nem nyitja meg. Az elutasítás nem számít bele a 3 tiltásos zárolásba, így egy tiltott útvonalat újrapróbáló modell nem zárja ki 10 percre a többi toolt. Kikapcsolt biztonsági kapuval is érvényes. Minden elutasítás egy sor a **Biztonsági események** alatt — **Elutasítás** döntés, `deterministic` kontrollpont és indok. Az ellenőrzés hibánál zár: ha nem tud válaszolni, a hívást elutasítja. Csak az egyáltalán tool nélküli, egyszeri háttérhívás fut nélküle.

**Mit kap a modell:**

- *Memory outside EYAS (&lt;store&gt;) — use memory_search / memory_expand from EYAS*
- *EYAS data directory (&lt;part&gt;) is read and written only by EYAS*
- *EYAS-owned CLI home (cli-homes) is read and written only by EYAS*
- *Not this conversation's workspace (…) — work in this conversation's folders*
- *Search too broad [memory-path:search-scope:&lt;target&gt;]: the folder searched contains &lt;what&gt;, and this tool cannot leave it out — search a narrower folder that does not contain it* — egy másik eszköz memóriájánál ezt fűzi hozzá: *; for memory use memory_search / memory_expand from EYAS*. A cél `foreign-memory`, `eyas-data`, `provider-home` vagy `other-workspace`. A chat **Elutasítva** toolsora ezt lefordított sorrá alakítja, például *Túl tág keresés: a mappa egy másik eszköz memóriáját is tartalmazza, amelyet csak az EYAS olvashat. A modell azt a választ kapta, hogy szűkebb mappában keressen.* — vagy az EYAS saját adatait, az EYAS által őrzött CLI-bejelentkezéseket, illetve egy másik beszélgetés munkaterületét nevezi meg.

A Grok CLI nem adja tovább az indokot a modelljének: ha az EYAS elutasítja a Grok egyik toolhívását, a Grok befejezi azt a választ, és a chat az elutasított toolsort mutatja, utána semmit. Kérd újra, az a lépés nélkül — egy *Túl tág keresés* elutasítás után szűkebb mappával. A Claude Code folytatja, és megkapja az indokot, így egy keresést magától újrapróbálhat szűkebb mappában. Lásd [Providerek — Grok CLI és Kimi Code CLI](/docs/hu/ai/providers/#grok-cli-and-kimi-code-cli).

**A kernel réteg.** Egy shellparancs olyan útvonalat is elérhet, amely nem látszik a parancs szövegéből, és egyes CLI-toolok egyáltalán nem kérdezik az EYAS-t. Ezekhez a Claude Code shellje és a Grok CLI saját toolai az operációs rendszer fájl-sandboxában futnak (macOS Seatbelt, Linux bubblewrap), amely a kernel szintjén blokkolja ugyanezeket a helyeket: más toolok memóriáját, az EYAS privát adatait és más beszélgetések workspace-eit. `security.cliSandbox: auto` (az alapértelmezés) mellett a CLI nélküle fut, ahol nem érhető el, és a chat ezt egyszer jelzi; `required` mellett az ilyen körök elutasításra kerülnek. `auto` módban a sandboxon kívül futni kérő Claude Code parancs mindig emberi jóváhagyásra vár — soha nem az AI-bíróra, soha nem az autonómia-létrára. A Kimi Code CLI-nek nincs kernel sandboxa, így a saját read, grep és glob tooljait továbbra is csak ott ellenőrzi az EYAS, ahol látja őket. Lásd [Providerek — Kernel fájl-sandbox](/docs/hu/ai/providers/#kernel-file-sandbox). Az [adatimportot](/docs/hu/admin/data-port/) nem érinti, mert az maga olvassa a többi eszköz tárait, nem modell-toolon keresztül.

**Migráció.** Azok az agentek, amelyek korábban közvetlenül olvasták a `~/.claude/CLAUDE.md`-t, a `~/.grok` memóriáját, vault-jegyzeteket vagy a `data/` alatti fájlokat, most elutasítást kapnak (a Biztonsági események mutatja). Ezt a tudást egyszer hozd be az EYAS-ba az adatimporttal. Azok az agentek vagy szokások is elutasítást kapnak, amelyek egy CLI saját tooljaival a teljes home-ban vagy egy szülőmappában kerestek: irányítsd őket egy almappára, vagy használd az EYAS `grep`/`glob` toolját, amely kihagyja a védett helyeket. Egy védett helyet tartalmazó Mappa — az EYAS checkoutja, egy vaultot tartalmazó `~/Documents` — már nem fogadható el: válassz szűkebb mappát, például a `~/Documents` alatti projektmappát vagy a repository egy külön klónját. Az EYAS-on kívül memóriát tartó MCP szerverek is tiltottak — lásd [MCP](/docs/hu/ai/mcp/#memory-store-servers-are-blocked).

### Az EYAS-on kívüli memória kártya {#memory-outside-eyas-card}

A **Biztonsági események** oldal (`/security`) egy **EYAS-on kívüli memória** kártyával nyílik. Csak az ownerek és az adminok látják, mert abszolút útvonalakat mutat a szerveren; a többi szerepkör betöltési hibát kap, útvonalak nélkül. A kártya ezeket mutatja:

- **Két számláló az utolsó 24 órára.** A *Memóriaszabályzati elutasítások* azokat a toolhívásokat számolja, amelyeket a memória-policy bármely csatornán elutasított — egy másik tool memóriájának, egy Obsidian vaultnak, az EYAS saját adatmappájának, adatbázisának vagy CLI-bejelentkezéseinek, illetve egy másik beszélgetés workspace-ének olvasását vagy írását, valamint a túl tágként elutasított kereséseket, amelyek mappája ezek egyikét tartalmazza. A *Sandboxon kívüli futtatást kérő parancsok* azokat a shellparancsokat számolja, amelyek a kernel sandboxon kívül akartak futni, és emberi jóváhagyásra kerültek.
- **Más eszközök memóriája ezen a szerveren** — más AI-toolok és jegyzetalkalmazások ismert tárai, amelyek itt léteznek (például `~/.claude`, `~/.grok`, `~/.codex`, az OpenCode mappái, az Obsidian alkalmazásbeállításai), az útvonalukkal, valamint hogy további hány ismert hely lesz védett, amint megjelenik. Egy mondat elmagyarázza, mi védett még, bárhol legyen: minden mappa, amelyben `.obsidian` mappa van (Obsidian vault), az `ai-memory` nevű mappák, valamint a `.claude`, `.grok`, `.codex` és hasonló eszközmappákban lévő memóriamappák.
- **Talált Obsidian vaultok** — az Obsidian saját vaultlistájának vaultjai, plusz azok, amelyeket az EYAS a toolhívások ellenőrzése közben a `.obsidian` mappájuk alapján ismert fel. A nem listázott vault a `.obsidian` mappája alapján ettől még védett.
- **Saját kiegészítéseid (security.foreignMemoryPaths)** — a konfiguráció extra útvonalai. A még nem létező útvonalak mellett *még nincs ezen a szerveren* áll; a nem abszolút útvonalú bejegyzések *figyelmen kívül hagyva* jelölést kapnak. Egy további mappa vagy fájl védelméhez add hozzá az abszolút útvonalát a konfigurációs fájl `security.foreignMemoryPaths` beállításához, és indítsd újra az EYAS-t (a listát induláskor olvassa be).
- **Az EYAS saját adatai** — az adatmappa, az adatbázis és a CLI-bejelentkezések (az EYAS saját CLI home-jai). Ezeket csak az EYAS olvassa és írja; a modellek a beszélgetésük workspace-ét, a Studio projekteket és a böngészős letöltéseket használhatják.
- **Beszélgetések munkaterületei** — a workspace-ek gyökere. Ott minden beszélgetés modellje csak a saját workspace-ét látja.
- **A CLI-szolgáltatók kernel fájl-sandboxa** — a `security.cliSandbox` mód (`auto` vagy `required`), és minden bekapcsolt CLI providernél (Claude Code, Grok CLI, Kimi Code CLI), hogy a saját toolai a kernel sandboxban futnak-e: *aktív*, *nem érhető el* vagy *nem támogatott*, az okkal (a bubblewrap nincs telepítve, a socat hiányzik — a Claude Code-nak kell —, a user namespace-ek ki vannak kapcsolva, nem támogatott operációs rendszer, vagy a CLI nem kínál ilyet). `required` mellett, sandbox nélkül a kártya jelzi, hogy azon a CLI-n a tooloket használó körök elutasításra kerülnek. `auto` módban *nem érhető el* vagy *nem támogatott* állapotnál a CLI saját toolai sandbox nélkül futnak, és az EYAS továbbra is ellenőriz minden toolhívást, amelyet lát. `auto` módban, aktív Claude Code sandboxszal a sandboxon kívül futni kérő Claude Code parancs mindig emberi jóváhagyásra vár.

**API.** `GET /api/v1/security/memory-policy` (`SecurityEvent` olvasási jog). Nincs új beállítás vagy környezeti változó.

### Az AI parancssori eszközök izoláltan futnak {#ai-command-line-tools-run-isolated}

- A **Claude Code** mindig izoláltan fut: nincs host `settings.json`, `CLAUDE.md`, skillek, MCP szerverek vagy auto-memória, nincs átirat a hoston, engedélylistás környezetet kap, és egy induláskori ellenőrzés leállítja a futást, ha bármi más betöltődött. Lásd [Providerek — Claude Code izoláció](/docs/hu/ai/providers/#claude-code-isolation).
- A **Grok CLI és a Kimi Code CLI** az EYAS saját home-jaiban fut (`data/cli-homes/…`, itt vannak az EYAS-os bejelentkezéseik), a natív tooljaik előtt megkérdezik az EYAS-t, és csak azután futnak, hogy az EYAS ellenőrizte az izolációjukat — az ellenőrzésen elbukó kör leáll, és soha nem kerül át másik modellhez. Lásd [Providerek — Grok CLI és Kimi Code CLI](/docs/hu/ai/providers/#grok-cli-and-kimi-code-cli).
- Az **OpenCode**, az opcionális sidecar, az EYAS saját mappájában fut (`cli-homes/opencode`, itt van a bejelentkezése), és nem tölt be host asszisztens-utasításokat, skilleket vagy projektkonfigot. A fej nélküli OpenCode-feladatok minden toolhívás előtt megkérdezik az EYAS biztonsági kapuját. Az OpenCode az EYAS memóriáját csak a csak olvasó `memory_search` / `memory_expand` toolokon át éri el; memóriát író toolja nincs. Minden OpenCode folyamat, amelyet az EYAS indít, saját kulcsot kap a 3-as fájlleírón — soha nem környezeti változóban, argumentumlistában vagy fájlban —, és a kulcs a folyamattal együtt megszűnik. Maga a kulcs soha nem hagyja el az OpenCode-ot: minden memóriahívás egy egyszer használható bizonyítást visz arra az egy OpenCode-munkamenetre, amelyben a tool fut, így sem a modell által futtatott parancs, sem egy másik folyamat nem olvashatja egy másik munkamenet memóriáját. A megmaradó korlátok: az OpenCode a szerverjelszavát csak a környezetéből olvassa, így ugyanannak az operációsrendszer-felhasználónak egy olyan folyamata, amely olvashatja egy másik folyamat környezetét, az OpenCode saját API-ján át vezérelheti annak az OpenCode szervernek a munkameneteit; az OpenCode-nak nincs kernel sandboxa; és egy olyan folyamat, amely olvashatja egy másik folyamat memóriáját, elérheti a kulcsot. Egy külső OpenCode szerverre mutató csatolási URL nem izolált, és nem fér hozzá az EYAS memóriájához. Lásd [OpenCode](/docs/hu/automation/opencode/#eyas-memory-inside-opencode).
- **Kernel fájl-sandbox.** A Claude Code shellparancsai és a Grok CLI saját toolai az operációs rendszer fájl-sandboxában futnak, ahol ilyen elérhető (`security.cliSandbox`); a Kimi Code CLI-nek nincs ilyen. Lásd [Providerek — Kernel fájl-sandbox](/docs/hu/ai/providers/#kernel-file-sandbox).

### Hogyan bizonyított az izoláció {#how-isolation-is-proven}

Minden CLI-futást induláskor ellenőriz az EYAS (lásd fent). Ezen felül minden támogatott CLI-verziót kiadás előtt egy **kiadási ellenőrzés** bizonyít, a `bun run test:live-cli`, amelyet a fejlesztők és a kiadásért felelősök futtatnak. Ez a valódi Claude Code-ot és Grok CLI-t (és ahol telepítve van, a Kimi Code CLI-t) az EYAS saját providerein át indítja, egy eldobható, csapdákkal teli home-ban: mindent engedő host-beállítások, hookok és MCP szerverek, amelyek nyomot hagynának, ha lefutnának, `CLAUDE.md`, `AGENTS.md`, skillek, egy Obsidian-szerű vault, és egy saját konfigot tartalmazó projektmappa. Az ingyenes rész minden modellkérést egy helyi gépen futó álmodellhez küld, így nem kell hozzá fiók, és nem fogy token. A fizetős rész valódi modellköröket futtat az owner saját bejelentkezésével, és minden futását külön jóvá kell hagyni.

Az ellenőrzés ezt bizonyítja:

- semmilyen host- vagy projektkonfig, utasításfájl, hook vagy MCP szerver nem töltődik be;
- a Grok minden fájlolvasáshoz az EYAS-on keresztül kér engedélyt, és a vault kívül marad;
- az EYAS memória-policyja elutasítja a vaultot és az EYAS saját adatmappáját;
- az operációs rendszer fájl-sandboxa megállít egy rejtett vault-olvasást a Claude Code shelljében;
- egy normál workspace-olvasás továbbra is működik;
- az EYAS CLI home-jaiban nem marad sessiontár;
- a Grok és a Kimi semmit nem változtat a host home-ban;
- a Claude Code a hostra csak egy rövid, verziózott listán szereplő nyilvántartó fájlokat ír, beszélgetéstartalmat soha;
- a Claude Code ideiglenes mappája, ahová a háttérben futó shell-parancsok kimenete kerül, a futás saját mappája az EYAS-ban, és a futás végén eltűnik — a host `/tmp/claude-<uid>` mappájában semmi nem marad.

A lista: a `~/.claude.json`, az indulási és nyilvántartó kulcsokra korlátozva (első indulás, migrációk, feature-flag gyorsítótár, plugin-használati számlálók), plusz a biztonsági másolatai és a zárolási mappája; üres session- és jelölőmappák a `~/.claude` és a `~/.config/anthropic` alatt; beszélgetéstartalom nélküli shell-pillanatképek; az npm saját naplója az `npm root --global` hívásról a `~/.npm/_logs` alatt; a Bun gyorsítótára, ha a PATH-on lévő `node` a Bun; és kulcstartó nélküli hostokon a bejelentkezés-frissítő fájl. Átirat, teendőlista, fájlelőzmény, terv vagy promptelőzmény soha.

**Memóriateszt.** A Claude Code-on és a Grok CLI-n az ellenőrzés a memória-policyt a valódi biztonsági kapun át is lefuttatja. Egy csak a `security.foreignMemoryPaths` alatt felvett mappát elutasít a modell saját fájlolvasásánál és egy shelles `cat`-nél is, és elutasít egy írást az EYAS vaultjába. Minden elutasítás pontosan egy **Elutasítás** sor a Biztonsági eseményekben a memória-policytól (`deterministic` kontrollpont, soha nem rate-limit zárolás), és egy elutasított toolsor. Egy workspace-olvasás ezek után is működik, és az elutasított mappából semmi nem jut el a modellhez. Két további ingyenes eset a kereséseket fedi le: a Claude Code Grep, Glob és `grep -r` hívását, valamint a Grok grep és list_dir hívását a csapdákkal teli home-ban indítva a memória-policy a valódi kapun át egyenként elutasítja — auditálva, elutasított toolsorral —, miközben a projektmappában végzett keresés továbbra is működik. Egy harmadik azt mutatja, hogy a Claude Code az EYAS engedélyellenőrzésének megkérdezése nélkül olvas egy fájlt a munkamappájában, és hogy a memória-policy ellenőrzése elutasítja az ilyen olvasást, ha az egy vaultba esik.

**Bizonyított verziók:** Claude Code 2.1.281 és Grok CLI 1.0.41, csak az ingyenes rész. A Kimi Code CLI még nem bizonyított, és nincs memóriatesztje. Az ellenőrzés két eredménye beépült az induláskori ellenőrzésekbe:

- A Claude Code 2.1.281 két, a binárisba fordított plugint jelent: `agents-md` és `telemetry`. Ezeket az EYAS csak `<név>@builtin` formában fogadja el, mert az ellenőrzés bizonyította, hogy az EYAS izolációja alatt ártalmatlanok: sem a munkamappából, sem egy almappából nem jut `AGENTS.md` a modellhez. Minden más plugin — egy későbbi Claude Code új beépített pluginja is — továbbra is leállítja a futást.
- A Grok CLI 1.0.41 a gyártó által kezelt beállítások gyorsítótárát (`managed_config.toml`) írja az EYAS-os home-jába, egy normál fióknál üresen. Az üreset az EYAS elfogadja; a bármilyen beállítást tartalmazó továbbra is leállítja a kört.

Az **`eyas doctor`** CLI-providerenként egy sort mutat: *CLI isolation (Claude Code)*, *CLI isolation (Grok CLI)* és *CLI isolation (Kimi Code CLI)*. Mindegyik megnevezi a binárist, amelyet az EYAS futtat — hogyan találta meg (`EYAS_CLAUDE_CODE_BIN` / `EYAS_GROK_BIN` / `EYAS_KIMI_BIN`, a PATH-on, vagy az SDK-ba csomagolt), az útvonalát és a verzióját —, és hogy a kiadási ellenőrzés bizonyította-e azt a verziót. Eltérő verzió, verziót nem jelentő bináris vagy soha nem bizonyított CLI figyelmeztetés, nem leállás: az EYAS induláskor továbbra is ellenőriz minden sessiont. A nem telepített CLI rendben van; az érvénytelen `EYAS_*_BIN` hiba. A Grok és a Kimi sora az EYAS-os home-jukat is ellenőrzi (`<adatmappa>/cli-homes/<provider>`): ha még nincs létrehozva, rendben van; ha szimbolikus link vagy nem mappa, hiba (az EYAS nem futtatja a CLI-t; töröld, a következő futás újra létrehozza); ha más felhasználók is olvashatják, figyelmeztetés, mert a CLI bejelentkezését tartalmazza (`chmod 700 <mappa>`); ha egy ott kezelt fájl megváltozott, mióta az EYAS írta, figyelmeztetés — az EYAS a következő futás előtt újraírja ezeket a fájlokat, így a két futás közötti változás azt jelenti, hogy valami más szerkeszti azt a mappát. A doctor csak olvas: kizárólag a `--version` parancsot futtatja. Lásd [CLI](/docs/hu/deploy/cli/).

### Egy provider memóriájának karanténba helyezése {#quarantine-a-providers-memory}

Ha egy modell — jellemzően egy CLI, például a Grok CLI, a Kimi CLI vagy a Claude Code — az EYAS izolációja nélkül futott, válaszolhatott az EYAS-on kívüli memóriából, és a válaszai minden más körhöz hasonlóan bekerültek az EYAS memóriájába. Az owner minden modell elől elrejtheti, amit egy provider írt — a válaszait és a tool-kimeneteit, a belőlük levezetett tényeket és összefoglalókat, valamint a beszélgetései capture-jegyzeteit —, és később fel is oldhatja. Semmi nem törlődik, és az owner saját üzeneteihez soha nem nyúl. A kártya a **Memória → Áttekintés** alatt van; lásd [Memória — Egy provider memóriájának karanténba helyezése](/docs/hu/knowledge/memory/#quarantine-a-providers-memory). Minden alkalmazás és feloldás az audit naplóba kerül (`memory.quarantine.apply` / `memory.quarantine.release`).

### Távoli csomópont SSH {#remote-node-ssh}

Az SSH invoke őrzött parancs; **destruktív** minták force flaget kérnek. Nem-SSH típus not-implemented lehet.

### Memória nyugalmi állapotban {#memory-at-rest}

A tartós jegyzeteket a privacy modul **lemezre írás előtt** maszkolja, nem olvasáskor — az olvasáskori redakció nyers szöveget hagyna a fájlban és az FTS-indexben. Ugyanaz a függvény és ugyanazok a szabályok, mint a kimenő modellforgalomnál: a dátumok megmaradnak, a `mask` és `block` osztályú értékek pedig cserélődnek, így egy jegyzetbeli IBAN `[IBAN]`-ként tárolódik (a korábbi verziók a jegyzetekben csak az e-mail-címeket és a telefonszámokat cserélték). A nyers beszélgetésnapló, a beszélgetés-összefoglalók és a tények az EYAS-on belül maszkolatlanok maradnak, és csak akkor maszkolódnak, amikor elhagyják. A capture kapcsoló: `memory.capture.enabled` a `config/default.yaml`-ban (alap **be**). Lásd [Memória](/docs/hu/knowledge/memory/) és [GYIK](/docs/hu/reference/faq/).

**A modell által írt jegyzetek átmennek az utasításszűrőn.** A modell által írt vault-jegyzetek — a körönkénti memória-capture, az éjszakai konszolidáció összefoglalói és a csapatsession-összefoglalók — ugyanazon a szűrőn mennek át, amelyet az EYAS már a tényeknél és az összefoglalóknál is használ. Az a szöveg, amely az asszisztensnek szóló utasításnak látszik (*ignore previous instructions*, *from now on you are…*, hamis `<system>` címkék, *delete all memory*, angolul, magyarul, németül, spanyolul és franciául), soha nem íródik ki. Az elutasítások a szervernaplóban a detektor nevével jelennek meg, a szöveggel soha. Minden ilyen jegyzet frontmatterében `origin` is áll, és az EYAS modell által írtként jegyzi meg, soha nem a te szavaidként. Lásd [Memória — Miért utasít el bizonyos mondatokat](/docs/hu/knowledge/memory/#why-some-sentences-are-refused).

## Adatvédelmi policy {#privacy-policy}

Az EYAS nyersen tárolja az adatait, és **a személyes adatot akkor maszkolja, amikor a szöveg távoli modell felé elhagyja az EYAS-t**. A maszkolást egyetlen determinisztikus függvény végzi — promptra, memóriatool-eredményre, embeddingre és vault-jegyzetre egyaránt.

### Hogyan működik a felismerés {#how-detection-works}

A felismerés szabályalapú és determinisztikus: ugyanarra a szövegre mindig ugyanaz az eredmény, és személyes adat felismeréséhez semmi nem megy modellhez. **Soron belül** működik — a két sorra tört érték nem ismerhető fel, és a telefon- vagy adószó csak a számmal azonos sorban számít.

Soha nem számít személyes adatnak: a naptári dátum bármely szokásos formában (`2026-09-08`, `2026.09.30.`, `2026. 09. 30.`, `22.09.2026`, `09/22/2026`), az időpont, az ISO időbélyeg, az IP-cím, a szoftververzió (`1.0.40`, `0.8.29-beta`), a pénzösszeg (tizedes, vagy pénznem — HUF/Ft/EUR/€/$ — melletti szám), valamint a rekord-, ticket-, build-, commit- és időbélyeg-azonosító, az UUID, az ULID és a hash. A prompt *Current date* sora épen eljut minden modellhez.

### Mit ismer fel {#what-is-detected}

| Típus | Hogyan ismeri fel és ellenőrzi |
|-------|--------------------------------|
| `email` | Szabványos címforma |
| `phone` | `+`-szal kezdődő nemzetközi szám (8–15 számjegy); zárójeles körzetszámú szám; a magyar belföldi formátum (06/36 + körzetszám + 6–7 számjegy); vagy bármely 7–15 jegyű szám, amely előtt ugyanabban a sorban, 40 karakteren belül telefonszó áll. A telefonszavak csak egész szóként számítanak: phone, tel, mobile, cell, call, fax, WhatsApp, telefon, mobil, hívj, Handy, Telefonnummer, teléfono, móvil, téléphone, Tél., portable és hasonlók. A `+`, belföldi formátum és telefonszó nélkül, lazán leírt számokat szándékosan nem ismeri fel. |
| `iban` | Bármely ország IBAN-ja, egyben vagy szóközzel csoportosítva, a hivatalos mod-97 ellenőrzőösszeggel és az ország pontos hosszával ellenőrizve (a korábbi verziók csak a magyar IBAN-t ismerték fel) |
| `bank_account` | Magyar bankszámlaszám (giro), 8-8 vagy 8-8-8 számjegy (szóközzel vagy kötőjellel), a 9-7-3-1 blokkos ellenőrzőösszeggel ellenőrizve |
| `credit_card` | 13–19 számjegy kártyahálózati előtaggal, Luhn-ellenőrzéssel |
| `ssn` | Amerikai társadalombiztosítási szám, `AAA-GG-SSSS`, érvényes area, group és serial résszel |
| `personal_id` | Magyar személyazonosító igazolvány száma (6 számjegy + 2 nagybetű), önálló tokenként |
| `tax_number` | Magyar adószám (`12345676-2-42`) érvényes ellenőrző számjeggyel, 1–5 közötti ÁFA-kóddal és valós megyekóddal; magyar közösségi adószám (`HU12345676`); és a magyar adóazonosító jel (10 számjegy, 8-cal kezdődik), de csak érvényes ellenőrző számjeggyel **és** előtte álló adóazonosító-szóval (adóazonosító, adószám, tax ID, TIN, Steuer-ID, NIF, numéro fiscal, …). A szavak egész szóként számítanak, így a *routine*-ban lévő `tin` vagy a *syntax*-ban lévő `tax` semmit nem vált ki, és egy véletlen 10 jegyű szám a *tax* szó mellett nem adóazonosító. |
| `taj_number` | Magyar TAJ-szám, az ellenőrző számjegyével ellenőrizve |

Neveket és postai címeket nem ismer fel. Ezekre, és minden más szervezetspecifikus azonosítóra használj [egyéni mintákat](#custom-patterns).

Modellalapú szkenner nincs. A korábbi NER-szkenner, amely a prompt szövegét csendben elküldte egy helyi Ollamának, megszűnt; ha a `config/personality/privacy.yaml` `privacy.scanners` listájában még szerepel a `ner`, az EYAS figyelmen kívül hagyja, és figyelmeztetést logol.

### Műveletek {#actions}

Minden felismert típusnak egy művelete van:

| Művelet | Hatás |
|---------|-------|
| `off` | Figyelmen kívül hagyva |
| `warn` | Számolja és logolja; a szöveg változatlan marad |
| `mask` | Helyőrzőre cseréli, például `[EMAIL]` vagy `[IBAN]`, amikor a szöveg távoli modell felé elhagyja az EYAS-t |
| `block` | Kifelé ugyanúgy maszkolja; és az ilyet tartalmazó **új** chat- vagy csatornaüzenetet tárolás előtt elutasítja, ha távoli modellhez menne (lásd [Elutasított üzenetek](#refused-messages)) |

Beépített alapértékek: az `email` és a `phone` **mask**; az `iban`, `bank_account`, `tax_number`, `personal_id`, `credit_card` és `ssn` **block**; a `taj_number` **warn**.

**A maszkolás soha nem állít le modellhívást.** Egy block osztályú érték bárhol a promptban — például egy IBAN egy memóriajegyzetben — maszkolódik, és a kör folytatódik; az ilyen köröknél a memória-capture sem bukik el. A `block`-nak pontosan egy további hatása van: elutasítja az általad küldött **új** üzenetet.

### Elutasított üzenetek {#refused-messages}

Csak egy felhasználó által küldött **új** üzenet utasítható el — chatben, God mód beszélgetésben vagy egy csatornán (Telegram, Slack, Discord, e-mail, WhatsApp, Signal, …). Minden mást, amit az EYAS modellnek küld (előzmények, memória, tool-eredmények, csatolmányok kinyert szövege, embeddingek), soha nem utasít el; ezek kifelé maszkolódnak.

Egy üzenet akkor kerül elutasításra, ha block osztályú értéket tartalmaz, **és** távoli modellhez menne. Helyi az, amelynek endpoint-hostja loopback (`localhost`, `127.x`, `::1`) vagy szerepel a policy helyi gépei között; a CLI providerek (Claude Code, Grok CLI, Kimi CLI) és az ismeretlen endpointok távolinak számítanak. A cél az a modell, amelyen az üzenet futni fog (egy körre szóló modell-felülírás, a beszélgetés rögzített modellje, vagy a kollégája modellje). Az Auto-ra állított beszélgetés mindig távolinak számít, mert a modelljét az ellenőrzés után, üzenetenként választja az EYAS — kivéve, ha az Auto-routing globálisan ki van kapcsolva; ekkor a tárolt modelljét ítéli meg. God módban minden roster-résztvevőt megítél; ha bármelyik távoli, vagy üres a roster, az üzenet elutasításra kerül. Kikapcsolt policy vagy privacy modul mellett semmi nem kerül elutasításra.

- **Chatben** az elutasított üzenet nem tárolódik: nincs átiratbejegyzés, átnevezés, memória, modellhívás, sem God mód verseny. A beviteli mező fölött megjelenő **Az üzenet nem ment el — adatvédelem** kártya felsorolja a típusokat (az értékeket soha), és ezeket kínálja: **Küldés ezekkel az adatokkal kitakarva**, **Üzenet szerkesztése** és **Elvetés**. Lásd [Beszélgetések — Elutasított üzenetek](/docs/hu/daily/conversations/#refused-messages-privacy).
- **Csatornán** a küldő automatikus választ kap azon a nyelven, amelyen írt (angol, magyar, német, spanyol, francia vagy klingon; ha nem egyértelmű, angolul), amely megnevezi a típusokat, az értékeket soha, és arra kéri, hogy ezek nélkül küldje újra. Nem jön létre beszélgetés, üzenet vagy agent-futás; a bejövő esemény **kihagyva** státuszt kap `privacy_blocked` hibával, és csak a maszkolt szövege marad meg. Lásd [Csatornák](/docs/hu/communication/channels/#refused-messages).
- A policy változása előtt már tárolt üzeneteket az EYAS utólag nem utasítja el.

Minden elutasítás `privacy.inbound_refused`, minden *maszkolt küldés* `privacy.inbound_masked` audit-műveletet ír; mindkettő a típusokat, a beszélgetést (chat) vagy a bejövő esemény azonosítóját (csatornák) és a felhasználót rögzíti — értéket soha.

### Egyéni minták {#custom-patterns}

Minden egyéni mintának van `name`-je, `regex`-e, egy kisbetűs `type` slugja, amelyből a helyőrző lesz (például `[INTERNAL_PROJECT]`), és saját `action`-je. Az [Adatvédelem oldalon](#privacy) adhatod hozzá őket (legfeljebb 50-et); az azonos típusú mintáknál az első minta művelete érvényes. A minták soron belül működnek: soha nem illeszkednek sortörésen át, a `^` / `$` pedig a sor elejéhez és végéhez horgonyoz. A nem biztonságos (katasztrofális visszalépésre hajlamos) vagy le nem forduló mintát kihagyja, és a szerverlogban jelzi. Az üres stringre is illeszkedő minta már nem akasztja meg a szkennert.

### Helyi gépek: ki kapja maszkolatlanul a szöveget {#local-hosts-who-receives-text-unmasked}

A szöveg csak akkor megy maszkolatlanul, ha a modell endpointja ezen a gépen van: loopback endpoint (`localhost`, `127.x.x.x`, `::1`) vagy a policy **Helyi gépek** listájában felsorolt host (legfeljebb 32 hostnév vagy IP-cím, séma és port nélkül). Ezt az az endpoint-host dönti el, ahová a provider küld — soha nem a provider neve:

- A helyi Ollama vagy LM Studio mentes; a **távoli `OLLAMA_HOST` maszkolt**. Ha egy távoli Ollama hostnál a régi Ollama-kivételre építettél, vedd fel azt a hostot a helyi gépek közé.
- A fel nem sorolt LAN-hostok, a felhő API-k, az ismeretlen endpointok és minden CLI provider (Claude Code, Grok CLI, Kimi CLI) távolinak számít — az EYAS nem látja, hová küldi a forgalmát egy CLI.
- A régi `auto_local` művelet (átirányítás helyi Ollamára) megszűnt; a régi `auto_local` szabály `mask`-ként működik, és figyelmeztetés kerül a logba.

### Tárolt completionök (OpenAI) {#stored-completions-openai}

A beépített **OpenAI** providerhez menő kérések kifejezetten kikapcsolják az OpenAI *stored completions* funkcióját, chatnél, streamingnél és toolhívásoknál egyaránt. Az OpenAI így nem tartja meg az EYAS-beszélgetéseket a distillation- vagy evaluation-funkcióihoz, akkor sem, ha a *store completions* be van kapcsolva az OpenAI-fiókodban vagy -projektedben. Semmit nem kell beállítani. Akkor is érvényes, ha az `OPENAI_BASE_URL` átirányítja a beépített OpenAI providert. Az OpenAI-kompatibilis providerek (xAI, Mistral, Groq, DeepSeek és a kompatibilis katalógus többi tagja, OpenRouter, Kimi API, LM Studio) nem kapják meg a jelzőt, mert egyes szolgáltatások elutasítják az ismeretlen paramétereket; hogy ők mit tartanak meg, azt a saját fiókbeállításaik és feltételeik határozzák meg. Az embeddingeket nem érinti.

### Hol hat a maszkolás {#where-masking-applies}

A maszkolás a modell-gatewayen belül történik, **minden próbálkozásnál, arra a providerre, amelyik ténylegesen válaszol**. Ha egy hívást újrapróbál, vagy egy szint tartalék providerére esik át, minden próbálkozás a saját céljára maszkolódik: egy helyi Ollama elsődleges a nyers szöveget kapja, és ha elbukik, és a hívás egy felhős tartalékra kerül, a felhős provider a maszkolt szöveget kapja. A chat-kör előtti gyors routing-ellenőrzés is maszkolt.

Távoli cél esetén az EYAS maszkolja:

- a rendszerpromptot, szakaszonként: memória, persona- és agent-fájlok, projektkontextus, skillek, designok, és minden olyan szöveg, amelyet az EYAS nem tud szakaszhoz rendelni;
- a beszélgetés előzményeit;
- az EYAS memóriatooljainak eredményét, a hibaszövegeiket is: `memory_search`, `search_memory`, `memory_expand`, `search_knowledge`, `get_page`, `read_team_memory`;
- a távoli embedding providernek küldött szövegeket.

Nem maszkolja:

- az EYAS által maga írt szakaszokat — identitás, alapszabályok, a futásidejű blokk dátummal és idővel, munkamappák, a tool-, skill- és agent-listák, az orchestration-direktíva —, így a modell a mai dátumot és a mappáit mindig szó szerint olvassa;
- a workspace-toolok eredményét (fájlok, shell, git, grep, böngésző, dokumentumok, kódkeresés). A CLI-natív toolok úgysem maszkolhatók, és a maszkolás olyan helyőrzőket írna vissza — például `[EMAIL]` — a modell által szerkesztett fájlokba.

Ugyanaz a memóriaelem ugyanúgy maszkolódik, akár az EYAS teszi a promptba, akár a modell kéri le memóriatoollal — ugyanaz a függvény végzi. Ez **minden úton** igaz, amelyen egy modell EYAS-memóriát olvashat:

- azoknál a providereknél, amelyeknél a tool-hurok az EYAS-on belül fut (API és lokális providerek);
- a Claude Code folyamaton belüli EYAS-toolainál (`mcp__eyas__*`);
- a Grok CLI-nél és a Kimi CLI-nél az EYAS MCP-hídján át;
- az EYAS saját MCP szerverét hívó külső MCP klienseknél (`POST /api/v1/mcp/tools/call`);
- az OpenCode sidecarnál: az `opencode_run` feladat promptja és a rendszerszövegeként küldött felidézett memória maszkolódik, mielőtt eljut az OpenCode-hoz (az OpenCode session címe a maszkolt promptból készül), és ugyanígy az OpenCode-on belüli `memory_search` / `memory_expand` válaszai is.

Egy CLI, egy külső MCP kliens és az OpenCode mindig távolinak számít, mert bármilyen modellt futtathat: semmi, amit egy kérés tartalmaz, nem teheti őket helyivé, és a helyi gépek listája sem mentesíti őket. A mask és block osztályú értékek `[TYPE]` helyőrzőre cserélődnek; a dátumok, időpontok, azonosítók, számok és a JSON-szerkezet megmaradnak.

**Hibánál zár.** Ha maga az adatvédelmi szkennelés elbukik, a memóriatool-eredmény nem megy ki: a modell ezt kapja: *Error: memory tool result withheld (privacy scan failed)*, egy OpenCode-feladat pedig *privacy scan failed — the task was not sent to OpenCode* hibával elbukik — semmi nem jut el az OpenCode-hoz. A napló csak típusokat, darabszámokat és azonosítókat rögzít (beszélgetés, futás, agent, kör, tool, átviteli út), értéket soha: *Privacy: masked values in a tool result sent past the model gateway*, vagy *warn-class values in a tool result sent past the model gateway*.

A policy-változás a következő körtől érvényes. A már futó kör azzal a policyval megy végig, amellyel elindult, így egy tool-hurok egységesen maszkolódik.

### Hol él a policy {#where-the-policy-lives}

A policy az EYAS adatbázisában van. A `config/personality/privacy.yaml` a kiindulópontja: a fájl módosulásakor automatikusan, újraindítás nélkül újra beolvassa, egészen addig, amíg a policyt először el nem mented az [Adatvédelem oldalon](#privacy). Onnantól a mentett policy nyer, a fájl szerkesztéseit pedig figyelmen kívül hagyja, és figyelmeztet a logban.

A hiányzó vagy érvénytelen `privacy.yaml` már nem esik vissza csendben az alapértékekre: a hiba a fájl teljes útvonalával és az okokkal kerül a logba, és az utolsó jó policy marad érvényben. Első telepítésen, olvasható fájl nélkül, a beépített alapértékek érvényesek.

A régi formátumot (`scanners` / `rules` / `custom_patterns`) továbbra is elfogadja:

- Típusonként az első illeszkedő szabály dönt; az a típus, amelyre egyik szabály sem illik, `warn`.
- A `sanitize`-ból `mask` lesz; az `auto_local`-ból `mask` figyelmeztetéssel; a `ner`-t figyelmeztetéssel figyelmen kívül hagyja.
- A `scanners` listából hiányzó szkenner felismerései kikapcsolnak.
- A használhatatlan szabályokat és mintákat figyelmeztetéssel elveti.

**Audit.** Bekapcsolt `audit` mellett minden modellhívás, amely valamit maszkolt (vagy amelynél figyelmeztetett), **egyetlen** auditbejegyzést ír `privacy.egress` művelettel, a beszélgetésre célozva. Ez váltja a korábbi, találatonként egy `privacy.detected` bejegyzést, amely már nem íródik. A bejegyzés tartalmazza a beszélgetés, a futás, az agent és az összeállítás (vagy kör) azonosítóját; a providert; a célt (távoli); az átviteli utat (`gateway`, `embed`, `mcp-bridge`, `mcp-external`, `opencode`); a policy verzióját; a maszkolt és a figyelmeztetett darabszámot; a típusonkénti darabszámot; az érintett promptszakaszokat (`unattributed` = a rögzített szakaszokon kívüli rendszerszöveg); a beszélgetés-előzményekben talált egyezések számát; és az érintett memóriatoolokat. A gatewayen kívülre küldött memóriatool-eredmény saját bejegyzést kap. A felismert értékeket az EYAS soha nem naplózza és nem tárolja. A policy-változásokat mindig `privacy.policy.updated` auditálja (verzió, forrás, a megváltozott típusok és a mentő felhasználó — értékek soha). A logsorok: *Privacy: masked values in outgoing model traffic* vagy *warn-class values in outgoing model traffic*, és most már a beszélgetést, az összeállítást, a szakaszokat és a toolokat is megnevezik. A kontextus-inspektor szakaszonként mutatja, mi maszkolódott — lásd [Beszélgetések — Kontextus-összeállítás](/docs/hu/daily/conversations/#context-composition).

**Frissítés.** Nincs teendő: a régi formátumú `privacy.yaml` fájlok továbbra is működnek, és egy meglévő `privacy.yaml` az oldalon történő első mentésig továbbra is ellátja a policyt. Az a szöveg, amelyet a régi szkenner úgy tárolt, hogy egy dátumot `[PHONE]`-ra cserélt — például egy vault-jegyzetben —, nem javul meg magától, mert az eredeti érték elveszett; a forrásból való újraimport helyreállítja.

## Mezők és vezérlők

### Biztonsági események (`/security`) {#security-events}

Alcím: *Eszközfuttatási döntések és biztonsági napló.*

Az oldal az **EYAS-on kívüli memória** kártyával nyílik (ownerek és adminok) — lásd [fent](#memory-outside-eyas-card).

| Vezérlő | Jelentés |
|---------|----------|
| Statisztika | **Összes esemény**, **Elutasítási arány**, **Leggyakrabban blokkolt eszközök** |
| Döntésszűrő | **Mind / Engedélyezés / Elutasítás / Eszkaláció** |
| Kockázatszűrő | **Mind / alacsony / közepes / magas / kritikus** |
| Kontrollpont-szűrő | Szabad szöveg (*Kontrollpont szűrése…*) — `deterministic` az útvonal-elutasításoknál, például az EYAS-on kívüli memóriánál |
| Oszlopok | Időbélyeg, Eszköz, Döntés, Kontrollpont, Kockázat, Agent, Indok |

Üres: *Nincs biztonsági esemény.*

### Napló (`/audit`) {#audit}

Alcím: *Műveletnaplózás, pillanatképek és visszavonás-követés.*

| Vezérlő | Jelentés |
|---------|----------|
| Statisztika | **Összes bejegyzés**, **Művelet / nap**, **Vezető modul**, **Összköltség** |
| Szűrők | **Művelet**, **Modul**, **Ettől**, **Eddig** |
| Oszlopok | Időbélyeg, Felhasználó, Művelet, Modul, Cél, Eredmény, Költség |
| **Visszavonás** | Visszaállítás pillanatképből (megerősítéssel) |

Eredmények: **sikeres / hiba / elutasítva / visszavonva**.

### Adatvédelem (`/privacy`) {#privacy}

Az oldal három részből áll. (E verzió előtt minden Adatvédelem API-hívást nem hitelesítettként utasított el a szerver, így az oldal a bejelentkezési képernyőre dobhatott; ez javítva.)

**1. Statisztika** (az oldal tetején). A valós forgalom számlálói a szerver indulása óta — a memóriában tárolódnak, így újraindításkor nullázódnak; *A szerver indulása óta: &lt;idő&gt;* mutatja, mikor indultak, a **Frissítés** pedig újratölti őket. A szkenner-teszt futásai soha nem számítanak bele.

| Számláló | Jelentés |
|----------|----------|
| **Ellenőrzött távoli hívások** | Távoli célhoz szkennelt kimenő adatcsomagok: minden modellhívás-próbálkozás (az újrapróbálások és a szintek közötti tartalékra váltások külön számítanak), a távoli beágyazónak küldött embeddingek, és a gatewayen kívülre küldött memóriatool-eredmények (Claude Code / Grok / Kimi bridge-ek, külső MCP kliensek, az OpenCode sidecar). A helyi célra menő hívásokat az EYAS nem szkenneli és nem számolja |
| **Hívások maszkolt értékkel** | Ezek közül hányban cserélődött legalább egy érték |
| **Elutasított üzenetek** | Block osztályú érték miatt elutasított új chat-, God mód- és csatornaüzenetek |
| **Kérésre maszkolva elküldve** | Elutasított chatüzenetek, amelyeket a küldő utána a **Küldés ezekkel az adatokkal kitakarva** gombbal elküldött |
| **Talált PII-típusok** | Típusonkénti találatok, *Találatok szkennerenként* (regex / custom) sorral |

**2. Adatvédelmi szabályzat szerkesztő.** Fejléc a policy verziójával (*N. verzió*) és a forrásával: *A config/personality/privacy.yaml fájlból importálva…* (a fájl minden változáskor újra betöltődik, amíg itt nem mented), *Ezen az oldalon kezelve. A privacy.yaml módosításait a rendszer figyelmen kívül hagyja.*, vagy *Beépített alapértékek: a privacy.yaml nem olvasható.* Amíg a policy még a fájlból jön, egy piros sáv — *Hiba a privacy.yaml fájlban: &lt;hiba&gt;* — jelzi a hiányzó vagy érvénytelen fájlt a teljes útvonalával.

| Vezérlő | Jelentés |
|---------|----------|
| **Adatvédelmi szabályzat bekapcsolva** | Kikapcsolva semmit nem ismer fel, nem maszkol és nem utasít el |
| **Audit** | Minden modellhívást vagy memóriatool-eredményt, amelyben maszkolt vagy figyelmeztetett érték volt, rögzít az audit naplóban (típusok és darabszámok, értékek soha). A policy-változásokat mindig auditálja |
| **Művelet típusonként** | A négy művelet magyarázata (**Ki**, **Figyelmeztetés**, **Maszkolás**, **Tiltás**) és beépített típusonként egy sor (`email`, `phone`, `iban`, `bank_account`, `credit_card`, `ssn`, `personal_id`, `tax_number`, `taj_number`) a nevével, egy egysoros leírással arról, mit ismer fel, és egy műveletválasztóval |
| **Egyéni minták** | Sorok **Név**, **Reguláris kifejezés**, **Típus** (kisbetűs slug, például `project_code`; nagybetűvel ebből lesz a helyőrző, pl. `[PROJECT_CODE]`) és **Művelet** mezővel; **Minta hozzáadása** / **Minta törlése**; legfeljebb 50. A minták soronként illeszkednek; az azonos típusú mintáknál az első minta művelete érvényes. A nem biztonságos (katasztrofális visszalépésre hajlamos) vagy érvénytelen reguláris kifejezést mentéskor elutasítja, az okkal a mező alatt |
| **Helyi gépek** | Gépnevek vagy IP-címek (séma, port és útvonal nélkül; legfeljebb 32), amelyeken futó modellvégpontok maszkolatlanul kapják a szöveget, mint a localhost. Az érvénytelen bemenetet mentés előtt elutasítja |
| **Szabályzat mentése** / **Módosítások elvetése** | *Nem mentett módosítások* jelzéssel. A mentés a teljes policyt lecseréli, és az adatbázisban tárolja; onnantól a policyt ez az oldal kezeli, a `privacy.yaml` szerkesztéseit pedig figyelmen kívül hagyja (figyelmeztetéssel a naplóban). A következő modellhívástól érvényes — a már futó kör azzal a policyval megy végig, amellyel elindult. Ha a szerver elutasítja a policyt, semmi nem változik, és minden hiba a saját mezőjénél látszik |

Csak az owner módosíthatja a policyt. Az adminok csak olvasható nézetben látják, ezzel: *A szabályzatot megtekintheted. Módosítani és a szkennertesztet használni csak a tulajdonos tudja.* Egy operátor mindent kikapcsolhat; ezt a változtatást is auditálja az EYAS.

**3. PII-vizsgáló tesztelése** (csak owner). Illessz be legfeljebb 100 000 karaktert, és **Szöveg vizsgálata**. Mindig a **mentett** policyt használja (amíg a szerkesztőben mentetlen módosítás van, erről egy tipp szól). Az eredmény: az ítélet egy új üzenetre — *Egy ilyen szövegű új üzenetet a rendszer elutasítana: &lt;típusok&gt;.* vagy *Egy ilyen szövegű új üzenetet a rendszer elfogadna.*; minden találat a típusával, pozíciójával, szkennerével és műveletével; és **Ahogy a távoli modell megkapja** — a szöveg, amelyben a mask és block osztályú értékek cserélődtek (a warn osztályúak maradnak). Kikapcsolt policynál: *Az adatvédelmi szabályzat ki van kapcsolva: semmit nem ismer fel.*

**API (integrátoroknak).**

- `GET /api/v1/privacy/policy` (owner és admin) → `{policy: {enabled, actions, customPatterns, localHosts, audit}, version, source ('yaml'|'ui'|'defaults'), seedError, updatedAt, rulesetVersion, builtinTypes, actions, limits: {customPatterns: 50, localHosts: 32}, canManage}`.
- `PUT /api/v1/privacy/policy` (owner) — a törzs a teljes policy (a kihagyott mezők az alapértéküket kapják; az ismeretlen kulcsokat elutasítja) → ugyanaz az alak, mint a `GET`-nél, vagy `400 {code: 'invalid_policy', issues: [{path, code, message}]}`, és semmi nem változik (a kódok között: `unsafeRegex`, `invalidRegex`, `invalidHost`, `invalid_enum_value`, `too_big`, `unrecognized_keys`).
- `POST /api/v1/privacy/scan` (owner; a `text` nemüres, legfeljebb 100 000 karakter) → `{enabled, rulesetVersion, matches: [{type, start, end, scanner, action, value: '***'}], inbound: {refused, types}, egressPreview}`. A `blocked`, `blockedTypes`, `warnings`, `sanitizedText` és `confidence` mező megszűnt. A statisztikába nem számít bele.
- `GET /api/v1/privacy/stats` (owner és admin) → `{since, egress: {calls, maskedCalls, byType}, inbound: {checked, refused, masked}, byScanner}`; a `totalScans`, `totalDetections`, `detectionsByType`, `detectionsByScanner` és `detectionsByAction` megszűnt.
- A `/api/v1/privacy/*` a munkamenet-sütivel indított módosító hívásoknál megköveteli az `X-Eyas-Request` fejlécet, mint a többi admin API (a webes felület küldi; az API-kulcsokat és a Bearer tokeneket nem érinti).

## Kapcsolódó

- [Autonómia](/docs/hu/agents/autonomy/)
- [Felhasználók](/docs/hu/admin/users/)
- [Eszközök](/docs/hu/automation/tools/)
- [Megfigyelhetőség](/docs/hu/admin/observability/)
- [Csomópontok](/docs/hu/admin/nodes/)
- [Memória](/docs/hu/knowledge/memory/)
- [OpenCode](/docs/hu/automation/opencode/)
- [CLI](/docs/hu/deploy/cli/)
