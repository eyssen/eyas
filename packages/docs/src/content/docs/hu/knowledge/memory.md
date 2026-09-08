---
title: Memória
description: Amire az EYAS emlékszik — automatikus vault-jegyzetek, öt szint, minden üzenet nyers naplója, és melyik tárat mikor használd.
---

**Mire való.** A memória az EYAS saját hosszú távú tára. Egy tartós tényt, amit a beszélgetésben kimondasz, vault-jegyzet lesz belőle kérés nélkül, és ugyanezt a jegyzetet olvassa vissza minden későbbi beszélgetés. Ezen az oldalon a working blokkokat, az epizodikus tényeket, a vault-fájlokat és a review sort nézed — nem wiki-t szerkesztesz. A 0.8.23 óta az EYAS minden általa eltárolt üzenetről nyers naplót is vezet; azt írja, de egyelőre sehol nem olvasható vissza — és mindent, amit tudni kell róla, **A nyers napló** szakasz mond el alább.

## Mikor használd

- Az asszisztensnek emlékeznie kell rád, a munkamódodra, vagy egy projekt korlátaira.
- Tény hangzott el a chatben, és ellenőrizni akarod, bekerült-e a vaultba (vagy miért maradt ki a capture).
- Review, tag, gráf vagy konszolidáció kell — vagy a **Today's note**.
- Választanod kell Memória, Tudásbázis-wiki, Dokumentumok és kézzel írt vault-fájl között (lásd alább).
- Erre a példányra ki akarod kapcsolni a capture-t (`memory.capture.enabled: false`) — vagy a nyers naplót is (`memory.l0.enabled: false`).

## Tipikus munkafolyamat

1. Nyisd a **Memóriát** az oldalsávon (**Tartalom** szakasz) — útvonal `/memory`. (Szerepel a **Beállítások → AI és modell** alatt is.)
2. Nézd az **Overview**-t (számok, salience, friss epizodikus), majd a **Vault Files**-t a tartós jegyzetekhez.
3. Folytass egy ~40 karakternél hosszabb beszélgetést, ami tartós tényt mond. A válasz után ide vissza: új vault-jegyzetet kell látnod (`user`, `feedback`, `domain`, `project` vagy `reference`).
4. Ha semmi nem jelent meg: túl rövid volt, a capture ki van, vagy God Mode kör volt (azok nem írnak vault-jegyzetet). Írj jegyzetet kézzel a vaultba, ha akkor is kell. A God Mode körből a győztes válasz attól még bekerül a nyers naplóba — lásd **A nyers napló** szakaszt alább.

## Melyik tárat használd

| Tár | Feladat |
|-----|---------|
| **Memória** (ez az oldal) | Automatikus + agent-írta tények. Az EYAS egy-soros indexet tesz a későbbi promptokba. Ez a forrás, „mit tud rólad az asszisztens.” |
| **Tudásbázis** wiki | Kurált oldalak, **te** szerkeszted (space-ek, fa, verziók). A capture ide nem ír. |
| **Dokumentumok** | Feltöltött fájlok (PDF, kép, …) retrievalhez — nem identitás-jegyzetek. |
| **Vault-fájlok** (kézzel írt markdown) | Ugyanaz a vault, mint a capture (`data/vault/…`). Írj egyet magad; az EYAS felveszi. **Ne** a `~/.claude` vagy `~/.grok` legyen ez a tár. |
| **Projekt-wiki** | Projektenkénti ticket- és döntésoldalak, nem globális memória. |
| **Nyers napló** | Minden üzenet, amit az EYAS eltárol, szó szerint és tömörítve megőrizve még egyszer. A 0.8.23 óta automatikusan íródik; egyelőre semmi nem olvassa és nem jeleníti meg. |

A gép host Claude / Grok memóriája **nem** a forrás. Az izolált CLI-hívások és az alapból ki `loadClaudeMd` azért vannak, hogy egy második memória ne előzze meg a vaultot.

## Funkciók

Alcím az appban: *5-tier hybrid memory — working, episodic, semantic/procedural vault, archive.*

## Műveletek

Today's note · Consolidate Now · Refresh.

## Tabok

Overview · Working · Episodic · Vault Files · Archive · Graph · Tags · Review.

## Working

24h TTL blokkok: chars, accessed, expires.

## Episodic

salience, invalidated, source, agent, access/conversation count, dátumok, embedding hash.

## Vault

Fájllista, frontmatter, tags/links, content, backlinks.

## Archive

Alacsony salience, consolidator menti ide. Promotion → vault, demotion → archive az Overview-n.

## Tartós jegyzetek

A tartós jegyzet egy megmaradó tény, nem egy esemény feljegyzése: ki vagy,
hogyan szeretnéd, hogy dolgozzanak, mik egy projekt megszorításai. Mindegyik
egy-egy markdown fájl a vaultban, és az ügynök minden fordulóban egy
**egysoros indexet** kap belőlük — csak az összefoglalókat. A teljes jegyzetet
`search_memory`-val olvassa el, ha a sor érdekesnek bizonyul.

Egy második, fordulónkénti blokk **kapcsolódó korábbi munkát** hoz be a vaultból,
az epizodikus memóriából és a korábbi beszélgetésüzenetekből — a mostani üzenet
a lekérdezés. A modellnek nem kell `search_memory`-t hívnia ahhoz, hogy ezek a
találatok megjelenjenek. A törzsek továbbra is a `search_memory`-n keresztül
töltődnek. A korábbi üzenetek azért kereshetők, mert már tárolva vannak — ez
a blokk nem készít róluk újabb másolatot. (Az alábbi nyers napló ettől
független, szándékos második másolat; egyelőre semmi nem olvassa.)

Két frontmatter-mező vezérli:

| Mező | Mit csinál |
|------|------------|
| `kind` | `user`, `feedback`, `domain`, `project` vagy `reference` — egyben a rangsor is |
| `summary` | Az az egy sor, ami az indexben megjelenik |

A `user` és a `feedback` van elöl, mert ezek minden válasz elkészítését
befolyásolják. A `domain` a projekttípus (az azonos típusú ügyfelek osztoznak
rajta); a `project` ez az egy ügyfél. A `kind` nélküli jegyzet `feedback`, ha a `procedural/` alatt
van, egyébként `reference` — **soha nem `user`**: egy be nem sorolt jegyzetet
rólad szóló ténynek nyilvánítani annyi, mint minden prompt elejére tenni.
`summary` híján a jegyzet első valódi sora kerül be, tehát egy bármilyen
szerkesztőben kézzel írt fájl EYAS-specifikus frontmatter nélkül is működik.

Hol vannak: `data/vault/semantic/`, `data/vault/procedural/`,
`data/vault/projects/`, `data/vault/project-types/`. Írj bele egyet, és az EYAS felveszi.

**Ezek maguktól töltődnek.** Miután a válasz már megérkezett, egy kis
modellhívás elolvassa a fordulót, és megkérdezi: van-e benne bármi, ami egy
hónap múlva is igaz és hasznos lesz. Legfeljebb két jegyzetet adhat vissza, és a
fordulók többségén helyesen egyet sem. Mindez soha nem a válaszod kritikus
útján történik, és egy elbukott rögzítés egy hiányzó jegyzetbe kerül, nem a
válaszodba.

A hívás előtt egyetlen hosszellenőrzés áll — a `minUserChars`-nál (alapból 40
karakter) rövidebb üzenet soha nem ér modellhívást —, plusz beszélgetésenként
legfeljebb `maxPerConversation` (20) hívás. Kulcsszólista egyik nyelven sincs.
Az egészet a `config/default.yaml`-ben a `memory.capture.enabled: false`
kapcsolja ki. A kézzel írt jegyzet és a `save_memory`-t hívó ügynök változatlanul
működik.

Ha egy tényt megismételsz, az a már meglévő jegyzetet erősíti meg, nem csinál
mellé másodikat: az új megfogalmazás dátumozott felsorolásként kerül a
`## History` alá, a régit soha nem írja felül. A szöveg még lemezre írás előtt
átmegy a privacy modulon, nem visszaolvasáskor. Ez a vault-jegyzetekre igaz;
az alábbi nyers naplóba viszont szó szerint, ezt a lépést kihagyva kerül be a
szöveg.

**Projektmemória.** Egy projekt beszélgetéseiben tanult tény a
`projects/<projekt-id>/` alá kerül, abban a projektben az általános
referencia-jegyzetek elé sorolódik, és máshol meg sem jelenik — egy másik
projekt jegyzetei soha nem jutnak el a promptodig. A gyűjtő **General**
projekt, amelyben minden beszélgetés alapból indul, nem projektidentitás: az ott
tanult tények rólad vagy a munkamódszerről szóló tényként maradnak meg, tehát
mindenhová veled tartanak, nem tűnnek el egy gyűjtőprojektben.

Az ágensek a `search_memory`-val emlékeznek. Alap **`scope` = `current`**: ez a projekt, a típusa, plusz a globális user / feedback / reference jegyzetek — más projektek nem. `scope: all`, ha a teljes vault kell. A Memória oldal keresése (`/memory`) szűretlen.

### Projekt nélküli projekt-jegyzetek

Az a jegyzet, amelynek a `kind`-ja `project` vagy `domain`, de nincs benne
`project:` / `projectType:`, **globális**: minden beszélgetésnél megjelenik az
állandó indexben, a `search_memory` találatai közt és a kapcsolódó munkában,
projekt-jegyzetként rangsorolva. Ha a `projects/<id>/` alá mozgatod — vagy
`project:` mezőt írsz a frontmatterébe —, arra az egy projektre szűkül. Az
importált jegyzetek addig maradnak így, amíg létre nem hozod a hozzájuk tartozó
projekteket.

Az állandó indexnek karakterkerete van: `memory.index.budgetChars`, alapból
2400. Emeld meg, ha a `user` és `feedback` sorok már nem férnek bele.

### Az importált titkok kimaradnak a felidézésből

Az importer soha nem hagy ki egy fájlt azért, mert hitelesítő adatot tartalmaz.
Szó szerint tárolódik, a tétel pedig `contains-secrets` címkét kap — jegyzet-
címkeként, skill-képességként vagy epizodikus címkeként, aszerint, mi lett
belőle.

Alapból az ilyen tétel kimarad mindenből, amit a modell magától elér: az
állandó indexből, a `search_memory`-ból, a kapcsolódó munkából, a reflexiós
jobból, az éjszakai konszolidálóból és a skill-illesztőből. Sosem kap
beágyazást, és sosem kerül az opcionális dúsító modell elé. A Memória oldal
viszont továbbra is teljes egészében mutatja neked. Ha a `config/local.yaml`
fájlban `memory.recall.includeSecrets: true` értéket állítasz és újraindítasz,
a modell felé is megnyílik.

Ez a kapu az automatikus behúzást akadályozza; nem fájlrendszer-homokozó. Egy
fájlolvasó eszközökkel bíró agent továbbra is elolvashatja az eredeti fájlt a
lemezen. Az importált agent-persona és a jóváhagyott workspace-szabályfájl
egyáltalán nincs kapuzva — ott a tartalom *maga* a prompt —, ezért ezeket a
sorokat jóváhagyás előtt nézd át.

A `legacy` (régi memóriamappa) és a `third-party` (más terméke
dokumentációja) címke közönséges, teljesen felidézhető jegyzetet jelöl; csak
azt mondják meg, honnan jött a jegyzet. Minden importált tétel `source:<adapter>`
címkét is visel, amely megnevezi az őt beolvasó adaptert. Egy saját kezűleg írt
jegyzet a frontmatterjében maga is deklarálhat `contains-secrets` címkét, és
ugyanezt a bánásmódot kapja. Lásd: [Adatimport és -export](/docs/hu/admin/data-port/).

### A capture alapból be van kapcsolva

A capture **minden** beszélgetésen fut, globálisan, hacsak a
`memory.capture.enabled: false` nincs a `config/default.yaml`-ben. Egy kis
modellhívás **a válasz kézbesítése után** csatlakozik — soha nem a kritikus
úton. A sikertelen capture hiányzó jegyzet, soha nem sikertelen beszélgetés.

| Kapu | Alap | Jelentés |
|------|------|----------|
| `memory.capture.enabled` | **be** | Főkapcsoló |
| `minUserChars` | 40 | Unicode kódpontok; rövidebb üzenet kihagyja a modellhívást |
| `maxPerConversation` | 20 | Modell-költési plafon (sikeres, unparsable és error számít; too-short skip nem) |

Nincs kulcsszólista egyik nyelven sem. A `{"notes":[]}` a gyakori és helyes
extractor-válasz (0–2 jegyzet).

### Izolált CLI — csak az EYAS memóriája

Az extraction **izolált** modellkontextusban fut: nincs host filesystem-settings,
nincs CLI-natív memória, nincsenek bridgelt toolok, egyetlen kör. A Claude Code
CLI-s beszélgetések alapból **`loadClaudeMd` ki** — nem töltik a `~/.claude`
settings-t, CLAUDE.md-t, host skilleket, projekt `.mcp.json`-t. Az izolált és
opt-out hívások `CLAUDE_CODE_DISABLE_AUTO_MEMORY` és `strictMcpConfig` flaget is
állítanak.

A Grok / Kimi (ACP) nem ad izolációs kapcsolót; a provider paneljük ezt mondja,
nem tettet. Az agenteknek csak `search_memory` / `save_memory` jár, a
fájlíró kapu tiltja a `~/.claude`, `~/.grok` és `ai-memory` utakat.

Izoláció nélkül az extractor egyszer a tulajdonos host-memóriáját olvasta,
„már rögzítve” választ adott, és az EYAS vault üres maradt. Ezt a hibát zárja.

### Capture-futás napló

Minden kimenetel, ami a kapuig eljut, `memory_capture_runs` sort ír: skip okkal,
extraction a kindokkal, plusz `provider` oszlop (`provider/model`, vagy null ha
nem hívtak modellt). Két csend szándékos: kikapcsolt capture semmit nem ír, és a
háttérfutás assistant-szöveg nélkül nem éri el a kaput. A **God Mode** körök a
saját streamjükkel térnek vissza a post-turn blokk előtt, ezért sem
vault-jegyzetet, sem itteni sort nem írnak. Az alábbi nyers napló ettől
független nyilvántartás, és rájuk is kiterjed.

---

## A nyers napló

**Semmi nem vész el abból, ami elhangzott.** Minden üzenetet, amit az EYAS
lejegyez — a tiédet, az asszisztensét és a háttérben futó ágensek kimenetét —,
mostantól másodszor is megőriz, szó szerint, egy nyers naplóban a beszélgetés
mellett. Beíráskor tömörödik (valódi szövegen nagyjából 2,7-szer kisebb lesz),
és a saját bájtjaiból számolt hash alá kerül, tehát egy beszélgetésen belül
megismételt mondat egyszer tárolódik és kétszer számít.

**Ezt olvasd el először: egyelőre semmit nem látsz belőle.** Ez a kiadás csak a
rögzítést indítja el. Nincs oldal, nincs keresőmező és nincs parancs, ami
visszaolvasná a nyers naplót, és semmi nem kerül belőle az asszisztens elé. A
promptjaidba ma pontosan az jut el, ami eddig is: az egysoros vault-index és a
fentebb leírt kapcsolódó-munka blokk. A visszakeresés egy későbbi kiadásban jön.

Ami ma megváltozott számodra, az az, hogy hol élnek a szavaid. A beszélgetés
már nem az egyetlen példánya annak, ami elhangzott benne: ha lezárod,
archiválod vagy törlöd a beszélgetést, a nyers napló megmarad, és sehol nincs
gomb, ami törölné. Ha ezt nem így akarod, kapcsold ki a nyers naplót, mielőtt
olyasmire használod az EYAS-t, aminek később nyoma se maradjon (lásd alább).

Az írás kötegelt, nem azonnali. Az üzenetek beszélgetésenként állnak sorban, és
akkor íródnak ki, ha a beszélgetés lezárul (vagy lezárt stage-be kerül), ha
nagyjából 8000 token gyűlt össze, ha a beszélgetés 30 percig tétlen volt, vagy
ha az EYAS leáll — az újraindítás semmit nem veszít el abból, ami már elhangzott.

Minden üzenetre rákerül az is, honnan származik, és ez a bélyeg soha nem
öröklődik: amit **te** írtál, az tulajdonosi szintű, amit a modell írt, az csak
abból származtatott, a tool-kimenet pedig kívülről érkezett. Egy összefoglaló
így soha nem lehet megbízhatóbb annál a szövegnél, amiből készült.

### Mit vezet le belőle — modellhívás nélkül

Minden kiírás után az EYAS visszaolvassa, amit épp leírt, és magától kiveszi
belőle:

- a **tényeket** a szöveg `key: value` soraiból, plusz néhányat a beszélgetés
  saját tábla-kártyájáról (cím, projekt, projekttípus, ágens);
- egy **rövid összefoglalót**, legfeljebb 280 karakterben — az első és az utolsó
  üzenet, plusz néhány a köztük lévő legjellemzőbb mondatokból;
- az **entitásokat**: dátumok, `@mentions`, `#tickets`, kódazonosítók,
  backtickek közé zárt kifejezések, nagybetűs nevek;
- a **témákat** és egy **fontossági pontszámot**, amit a beszélgetés hossza,
  a benne a te részed aránya, a döntést jelző szóhasználat (öt nyelven), a
  lezártság és a kitűzés együtt ad ki.

Ebből semmi nem hív modellt. Nem keres meg providert, nem használ API-kulcsot,
nem költ a keretből, és nincs rajta mit beállítani. Cserébe gondosan olvas, nem
okosan: azt találja meg, ami nyíltan ki van mondva, és elszalasztja azt, ami
csak sejtetve volt.

A tények nem gyűlnek egymásra. Ha ugyanazt mondod el újra, az a már meglévő
tényhez kapcsolódik. Ha ugyanarról újat mondasz — egy határidő hétfőről
péntekre csúszik —, a régi tény záró dátumot kap és nyugdíjba megy, nem íródik
felül, tehát pontosan egy érvényes válasz van, mögötte érintetlen történettel.
Semmi nem módosul a helyén, és semmi nem vész el. Egy tény ráadásul soha nem
örököl olyan projekt- vagy beszélgetéscímkét, amit nem visel az összes forrása.

Ahogy fent: ebből sem olvasható vissza egyelőre semmi.

### Mibe kerül, és hogyan kapcsolod ki

A nyers napló a használattal nő, és **egyelőre semmi nem takarítja** — ebben a
kiadásban nincs megőrzési beállítás és nincs takarító job. Mérve egy rögzített
üzenet nagyságrendileg 5 KB lemezterület, az indexeivel együtt, tehát az
adatbázis érezhetően gyorsabban fog nőni, mint eddig.

Három beállítás a `config/default.yaml`-ben, mind a `memory` alatt:

| Beállítás | Alap | Jelentés |
|-----------|------|----------|
| `memory.l0.enabled` | **be** | Főkapcsoló. `false` esetén semmit nem rögzít; a következő újraindításkor lép életbe |
| `memory.l0.extractInLegacy` | **be** | `false` esetén megmarad a szöveg, de semmit nem vezet le belőle — se tény, se összefoglaló, se téma |
| `memory.engine` | `legacy` | Melyik motor szolgálja ki a memóriát. `v2`-re állítva ma semmi megfigyelhető nem változik |

A `memory.capture.enabled: false` **nem** kapcsolja ki a nyers naplót. Az a
vault-jegyzeteket és a mögöttük álló kis modellhívást szabályozza; a kettő
független, és bármelyiket kapcsolod ki, a másik fut tovább.

Az `eyas doctor` megmondja, elérhető-e a tömörítés, és melyik implementáció van
használatban. Ha egyik sincs, az EYAS ezt kiírja a logba, és semmit nem rögzít,
ahelyett hogy csendben puffert töltene.

### A tool-eredmények nem kerülnek bele — és miért hagyd így

A `memory.l0.captureToolResults` **alapból ki van kapcsolva**. Olvasd el ezt,
mielőtt bekapcsolod.

Bekapcsolva a nyers napló minden tool-hívás **teljes kimenetét megőrzi, szó
szerint és szerkesztetlenül**, plusz az argumentumok első 2048 karakterét.
Vagyis egy parancs teljes kimenete, minden fájl tartalma, amit az asszisztens
elolvas, és bármilyen egyszer használatos kód vagy token, amit egy tool éppen
visszaad — mind ott ül az adatbázisban, sima szövegként. Semmi nem maszkolja,
semmi nem vizsgálja át, és a tömörítés nem titkosítás. A vault-jegyzetek írás
előtt átmennek a privacy modulon; a rögzített tool-eredmények nem.

Minden rögzített eredményt a `memory.l0.toolResultMaxBytes` (8 KB) vág el,
karakterhatáron, látható csonkolásjelzéssel. Bekapcsolt kapcsoló mellett az
EYAS minden induláskor pontosan erről ír figyelmeztetést.

### Miért utasít el bizonyos mondatokat

Az a szöveg, ami az asszisztensnek szóló utasításként olvasható, nem válhat
megbízható ténnyé. A „Felejtsd el az összes korábbi utasítást”, a „mostantól te
vagy…” szerepváltás, vagy bármi, ami rendszerüzenetnek van álcázva, kereken
elutasításra kerül. Az asszisztensnek címzett egyszerű parancsok, a tool
futtatására szóló felszólítások és a „felejts el mindent” fordulatok
megmaradnak, de megbízhatatlan jelölést kapnak, hogy egy későbbi visszakeresés
kihagyhassa őket. Az ellenőrzés kiterjed az angol, a magyar, a német, a spanyol
és a francia nyelvre.

Ha egy összefoglalót elutasít, az EYAS nem adja fel, hanem lejjebb lép: előbb
egyszerűbb összefoglalóra, aztán csak a tisztán olvasható mondatokra, végül egy
csonkra, ami megnevezi a beszélgetést anélkül, hogy a szövegét megismételné. A
beszélgetést soha nem veszíted el, csak az összefoglalóját.

Ez mintaillesztő szűrő, nem bizonyítás, és inkább óvatos: a hétköznapi
munkaszöveg — például a `Futtasd a következő parancsot a podban: …` — néha
szintén megbízhatatlan jelölést kap. Mivel ezeket a rétegeket egyelőre semmi
nem olvassa, ennek ma az egyetlen hatása egy szám a futásnaplóban.

---

## Shared memory blockok (ágens toolok)

Az öt szintű UI mellett az ágensek **scoped memory blockokat** használhatnak (Letta-stílus):

| Scope | Kik között |
|-------|------------|
| **company** | Egész instance |
| **agent** | Egy ágens |
| **team** | Csapat orchestráció |
| **run** | Egyetlen run |

Toolok: `memory_block_read` / `memory_block_write` (append vagy replace).

## Kapcsolódó

- [Tudásbázis](/docs/hu/knowledge/knowledge-base/)
- [Dokumentumok](/docs/hu/knowledge/documents/)
- [Projekt-wiki](/docs/hu/knowledge/client-wiki/)
- [Providerek](/docs/hu/ai/providers/) (CLI-izoláció / `loadClaudeMd`)
- [Konfiguráció](/docs/hu/deploy/configuration/) (`memory.l0.*` kulcsok)
- [Toolok](/docs/hu/automation/tools/)
