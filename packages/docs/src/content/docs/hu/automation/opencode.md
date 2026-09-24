---
title: OpenCode
description: Opcionális MIT kódoló-motor sidecar élő webes terminállal a beszélgetésben — izolálva, az EYAS saját mappájában.
---

**Mire való.** Az OpenCode terminálos kódoló agent (MIT, [opencode.ai](https://opencode.ai)). Az EYAS **nem** importálja a privát magját és az AI SDK-jait. A hivatalos beágyazás: helyi HTTP szerver (`opencode serve` 127.0.0.1-en) plusz POSIX PTY, xterm.js-re streamelve. A chat a feladattal együtt elküldi az EYAS felidézett memóriáját, majd az `opencode_run` lefuttatja. A beszélgetés termináljában nézheted, vagy átveheted. Minden OpenCode folyamat, amelyet az EYAS indít, az EYAS saját mappájában fut, nem a mindennapi OpenCode-beállításaidban.

**Útvonal:** `/opencode`. Oldalsáv: **AI → OpenCode**. Beszélgetésben a felső sáv terminál ikonja.

## Mikor használd

- A kódolást az OpenCode saját ciklusában akarod, nem EYAS `write_file` halomban.
- **Nézni** vagy gépelni szeretnél a TUI-ba.
- Az OpenCode ugyanazokkal a `memory_search` / `memory_expand` toolokkal keressen az EYAS memóriájában, mint minden más modell — csak olvasva, a beszélgetés projektjére zárva.
- A delegált OpenCode-feladatok egy adott modellt és gondolkodási változatot használjanak (**Modell és gondolkodás** kártya).

## Tipikus folyamat

1. Nyisd az **OpenCode** (`/opencode`) oldalt. Ha **Nem kész**: telepítsd a CLI-t (`curl -fsSL https://opencode.ai/install | bash` vagy `npm i -g opencode-ai`), vagy állítsd be az `EYAS_OPENCODE_BIN` változót.
2. Jelentkeztesd be az OpenCode-ot **az EYAS számára**: nyiss egy beszélgetést, kattints a terminál ikonra, és az OpenCode terminálban használd a `/connect` parancsot (lásd [Bejelentkezés](#sign-in)).
3. Az ügynökön engedd az `opencode_status` / `opencode_run` toolokat. Minden providernél működik: a CLI-modellek (Claude Code, Grok, Kimi) is elérik ezeket a toolokat az EYAS bridge-en át. Ha akarod, a **Modell és gondolkodás** kártyán válaszd ki a modellt és a gondolkodási változatot.
4. Kérd a kollégát, hogy egy beszélgetésben hívja az `opencode_run`-t. Az EYAS a felidézett memóriájával együtt küldi el a feladatot; az OpenCode minden toolhívás előtt megkérdezi az EYAS-t; a válasz és a diffek az `opencode_run` eredményeként érkeznek vissza.

## Funkciók

| Elem | Mit csinál |
|------|------------|
| Doctor | Fail-closed: hiányzó CLI/PTY orvossággal, soha crash |
| `opencode_status` | Zöld. Kész / nem kész + ellenőrzések |
| `opencode_run` | Piros, jóváhagyás. Csak beszélgetésen belül fut. HTTP session a sidecar ellen; minden benne lévő toolhívás az EYAS biztonsági kapujától kér engedélyt |
| Webes terminál | `@xterm/xterm` a `/api/v1/opencode/terminal/:id` útvonalon (JWT). A kapcsolat bontása leállítja a PTY-t |
| Memória plugin | `memory_search` / `memory_expand` az OpenCode-on belül — ugyanazzal a névvel, leírással és argumentumokkal, mint minden más EYAS-futásban, csak olvasva. Az OpenCode-ban semmi nem írhat az EYAS memóriájába |
| Izoláció | Mindig be: az EYAS saját mappája, `<EYAS data dir>/cli-homes/opencode` — lásd lent |

### Izoláció {#isolation}

Minden OpenCode folyamat, amelyet az EYAS indít — a chat-feladatok háttérszervere és a beszélgetés OpenCode terminálja —, a `<EYAS data dir>/cli-homes/opencode` mappában fut. Be/ki kapcsoló nincs: a korábbi *isolated config* beállítás megszűnt, a korábban mentett értéket az EYAS figyelmen kívül hagyja.

| Terület | Mit jelent |
|---------|------------|
| **Az EYAS-é** | Az OpenCode konfigja (`config/opencode/opencode.json`, az EYAS írja, és csak az EYAS memória-plugint tölti be, a `config/opencode/eyas/eyas-memory.ts` fájlt), adatai (benne a bejelentkezés, `data/opencode/auth.json`, és az OpenCode sessionjei), állapota és gyorsítótára (az npm-gyorsítótárral együtt). Az OpenCode `HOME`-ja ugyanez a mappa. |
| **Nem töltődik be** | A host `~/.claude/CLAUDE.md`, a `~/.claude` skillek és az OpenCode Claude Code-kompatibilitásának többi része; a `~/.agents` és más külső skillek; a projekt saját `opencode.json`-ja, `.opencode` mappája, `AGENTS.md`, `CLAUDE.md` és `CONTEXT.md` fájlja; a mindennapi `~/.config/opencode` és `~/.local/share/opencode`; a szerverkörnyezet provider API-kulcsai (például `OPENAI_API_KEY`). |
| **Ki** | Automatikus frissítés és session-megosztás. |
| **Shell** | Az OpenCode saját shell-toolja az EYAS mappáját látja home-könyvtárként, így a `~/.gitconfig`-od és az SSH-kulcsaid nem látszanak neki. |

A háttérszerver a 127.0.0.1-en figyel, és minden indításkor friss, véletlen jelszóval védett.

**Hol van a memória-plugin.** Az EYAS memória-plugint a `<EYAS data dir>/cli-homes/opencode/config/opencode/eyas/eyas-memory.ts` fájlba írja, annak a `node_modules` mappának a szomszédságába, ahová az OpenCode a plugin `@opencode-ai/plugin` függőségét telepíti, és a kezelt `opencode.json` erre mutat. A korábbi verziók a `…/cli-homes/opencode/plugins/eyas-memory.ts` fájlba írták, ahonnan az OpenCode 1.18.29 nem tudta feloldani ezt az importot, és hibaüzenet nélkül kihagyta a plugint — az OpenCode modelljének így nem volt `memory_search` / `memory_expand` toolja, és a plugin shell-hookja sem futott le. A régi példányt az EYAS a következő induláskor törli. Ahogy eddig, az OpenCode első indulásához hozzá kell férnie az npm registryhez, hogy telepítse a plugin függőségét; enélkül az OpenCode az EYAS memóriatooljai nélkül fut.

### Bejelentkezés {#sign-in}

Az OpenCode maga jelentkezik be a modellproviderekhez; az EYAS nem ad át API-kulcsot abba a folyamatba. A bejelentkezés most az EYAS mappájában van, ezért **a meglévő OpenCode-felhasználók egyszer kijelentkeznek**. Nyisd meg egy beszélgetés OpenCode terminálját, és használd a `/connect` parancsot. Ne használd az `opencode auth login` parancsot egy saját, EYAS-on kívüli terminálban: az a normál környezetedet használja, és a mindennapi OpenCode-odat jelentkeztetné be, nem az EYAS-osat.

### A fej nélküli feladatok az EYAS-t kérdezik {#headless-tasks-ask-eyas}

Az `opencode_run` feladatok minden toolhívás előtt megkérdezik az EYAS-t: fájlolvasás és -szerkesztés, listázás és keresés, shellparancsok, webes lekérés és keresés, a feladatmappán kívüli mappák elérése, subagentek, LSP és skillek.

- Az EYAS minden kérésre a [biztonsági kapujával](/docs/hu/admin/security-privacy/) válaszol, ugyanazzal, amelyet a többi asszisztensnél is használ. Az engedélyezett hívások egyszer futnak; a tiltottakat elutasítja.
- Ha a kapu emberi döntést kér, a hívást elutasítja, és egy jóváhagyás kerül a [Jóváhagyások](/docs/hu/agents/autonomy/) sorába.
- Ha a biztonsági kapu nem érhető el, minden kérést elutasít.
- Az EYAS csak az általa indított feladatért felel, beleértve az abból indított subagenteket. Az OpenCode terminálban a toolhívásokat te magad hagyod jóvá.
- A feladat után az EYAS törli az OpenCode sessiont. A válasz és a diffek `opencode_run`-eredményként a beszélgetésben maradnak.

**Feladatmappa.** Az `opencode_run` csak beszélgetésen belül fut, máshol elutasítja a hívást. A megnevezett mappának a beszélgetés mappáin belül kell lennie — ha a beszélgetésnek nincs mappája, akkor a saját workspace-én belül. Ha nincs megnevezve, az EYAS a beszélgetés első mappáját használja, különben a beszélgetés saját workspace-ét — az EYAS telepítési mappáját soha. Az OpenCode terminál csak a saját beszélgetésedhez nyílik meg: más felhasználó beszélgetése *nem található*, adminnak is. A beszélgetés mentett mappáiban dolgozik, amelyeket az EYAS maga olvas ki — az oldal nem nevezhet meg másikat —, és ugyanígy a beszélgetés workspace-ére esik vissza. A mappái ugyanazon az ellenőrzésen mennek át, mint minden más futásé: az a mappa, amely védett hely, ilyenben van vagy ilyet tartalmaz (az EYAS saját adatai, egy másik AI-eszköz tárhelye, egy jegyzet-vault vagy a saját home mappád), kimarad, a terminál a következő engedélyezett mappában vagy a beszélgetés workspace-ében nyílik meg, és a terminál tetején egy sor megnevezi a kihagyott mappát. Ugyanígy kimarad az a mentett mappa, amely egy másik felhasználó beszélgetésének workspace-e, abban van, vagy (linken át) oda vezet — amelyet még azelőtt mentettek, hogy az EYAS elutasította volna az ilyet, vagy egy projektből öröklődött; az `opencode_run` is kihagyja, és elutasítja az oda megnevezett feladatmappát. A saját többi beszélgetésed workspace-e használható marad.

**Nem sandbox a saját felhasználója számára.** A fenti mappák csak azt döntik el, hol indul a terminál. Ami benne fut, az EYAS szerver operációsrendszer-felhasználójaként fut: egy parancs, amelyet az OpenCode terminálban jóváhagysz (egy shell-parancs vagy hozzáférés a feladatmappán kívüli mappához), mindent elér, amit az a felhasználó — a szerver más mappáit is. Ezért az OpenCode jogot csak olyanoknak add, akikre ezt rábíznád. A session-API sima shellje (`POST /api/v1/opencode/sessions` `kind: "shell"`-lel; a webes oldal csak az OpenCode terminált nyitja meg) csak a tulajdonosé és az adminoké — az OpenCode kezelési joga kell hozzá, bárki más `403`-at kap —, és az OpenCode terminál környezetével és az EYAS saját home mappájával indul, nem a szerver saját környezetével, így sem az EYAS mesterkulcsa, sem a providerek API-kulcsai nincsenek benne. Alapból a user szerepkör is megnyithatja az OpenCode terminált (az OpenCode létrehozási joga).

### A feladattal küldött memória {#memory-sent-with-a-task}

Az `opencode_run` az EYAS felidézett memóriablokkját — ugyanazt a blokkot, amelyet minden más futás is kap — a feladat rendszerszövegeként küldi. A mérete ugyanúgy alakul, mint bármely más modell felidézéséé: a `memory.index.budgetChars` (alapból 2400 karakter) a 100k tokenes kontextusablakhoz tartozó méret, és a blokk az OpenCode által futtatott modell ablakával nő, 250k tokentől egészen 2,5-szeresig (alapból 6000 karakter); nagyjából 29k token alatt csökken, és egy nagyon kicsi ablak egyáltalán nem kap felidézett memóriát. Az ablakot az EYAS az OpenCode saját modellistájából olvassa — a modell bemeneti limitjét, ha az OpenCode listáz ilyet, különben a kontextuslimitjét. Ha az ablak ismeretlen, a blokk pontosan `memory.index.budgetChars` méretű: ha a **Modell és gondolkodás** kártyán nincs modell kiválasztva (az OpenCode ilyenkor a saját alapértelmezett modelljét használja, amelyről az EYAS csak a válaszból értesül); ha a kiválasztott modell nincs az OpenCode listáján, vagy limit nélkül szerepel rajta (például egy egyéni provider modellje, amelynek az OpenCode-konfigjában nincs `limit`); vagy ha a lista nem olvasható (ilyenkor figyelmeztetés kerül a naplóba, és a feladat ettől még lefut). A listát feladatonként legfeljebb egyszer olvassa, csak ha van kiválasztott modell, és a kérés semmit nem visz a feladatból. Korábban az OpenCode-feladatok mindig pontosan `memory.index.budgetChars` méretet kaptak, így egy nagy ablakú modell kevesebb memóriát kapott, mint amennyit bármely más provider adott volna neki. A blokk ugyanazt a tippet tartalmazza, mint minden más futásban: egy sort a `memory_expand` nyit meg, tovább a `memory_search` keres. Csak a csatolt külső szerveren futó feladat nem kap tippet (annak a szervernek nincsenek EYAS memóriatooljai); helyette a legjobb találatok közül többet kap teljes szöveggel. Lásd [Memória — Hogyan jut el a felidézés a modellhez](/docs/hu/knowledge/memory/#how-recall-reaches-the-model).

**Maszkolva hagyja el az EYAS-t.** Az OpenCode mindig távoli célnak számít, mert bármilyen modellt futtathat. A feladat promptját és a feladat rendszerszövegeként küldött felidézett memóriát az adatvédelmi policy maszkolja, mielőtt bármi eljutna az OpenCode-hoz, és az OpenCode session címe is a maszkolt promptból készül. Az OpenCode-on belüli `memory_search` / `memory_expand` válaszai is maszkoltak. Ha az adatvédelmi szkennelés elbukik, a feladat *privacy scan failed — the task was not sent to OpenCode* hibával elbukik, és semmi nem jut el az OpenCode-hoz. Kikapcsolt adatvédelmi policy (vagy privacy modul) mellett semmi nem maszkolódik. Lásd [Biztonság és adatvédelem — Hol hat a maszkolás](/docs/hu/admin/security-privacy/#where-masking-applies).

### EYAS-memória az OpenCode-on belül {#eyas-memory-inside-opencode}

Az EYAS memória-plugin pontosan két toolt ad az OpenCode modelljének: `memory_search` és `memory_expand`. Ugyanaz a nevük, a leírásuk és az argumentumaik, mint minden más EYAS-futásban, csak olvasnak, és ugyanaz a körönkénti 3 memóriatool-hívásos keret vonatkozik rájuk. Memóriát mentő toolja az OpenCode-nak nincs: hogy mit jegyez meg az EYAS, azt az EYAS dönti el, soha nem az OpenCode modellje.

Hogy a toolok mit olvashatnak, az attól függ, ki hívja őket:

- **Egy `opencode_run` feladat.** Az EYAS az általa létrehozott OpenCode sessiont a feladatot indító beszélgetéshez és felhasználóhoz köti. A toolok ekkor a beszélgetés projektjét, projekttípusát és a globális memóriát olvassák, és a hívó kör 3 hívásos keretén osztoznak.
- **Minden más esetben** — egy OpenCode terminálban, amelyet valaki a panelen nyit meg, bármely sessionben, amelyet nem az EYAS hozott létre, vagy ha egy bejelentkezett hívó nem a session felhasználója — a toolok csak a globális memóriát olvassák.
- **Egy csatolt külső szerver** (csatolási URL) egyáltalán nem fér hozzá az EYAS memóriájához.

**A kulcs soha nem hagyja el az OpenCode-ot, és soha nincs környezeti változóban.**

- Minden OpenCode folyamat, amelyet az EYAS indít — a háttérszerver és minden OpenCode terminál —, saját kulcsot kap a 3-as fájlleírón, egy olyan kapcsolaton, amelyet csak az a folyamat birtokol. A kulcs soha nincs környezeti változóban, argumentumlistában vagy fájlban. Megszűnik, amikor a folyamat kilép vagy újraindul.
- Az EYAS plugin egyszer olvassa be a kulcsot, amikor az OpenCode betölti, a memóriában tartja, és lezárja a 3-as leírót, így semmi, amit az OpenCode később indít — a modell shellparancsait is beleértve —, nem örökli. A folyamat környezete csak azt közli, hogy a kulcs a 3-as leírón van (`EYAS_OPENCODE_KEY_FD=3`), a modell által futtatott shell pedig ezt a változót és az `OPENCODE_SERVER_PASSWORD`-öt is üresnek látja. Az OpenCode folyamatának `ps eww` kimenete vagy `/proc/<pid>/environ` fájlja nem mutat kulcsot.
- Minden memóriahívás a kulcs helyett egy egyszer használható bizonyítást visz egy OpenCode-munkamenetre: egy aláírást annak a munkamenetnek az azonosítójára, amelyben a tool fut (ezt az OpenCode állítja be, nem a modell), egy véletlen értékre és az időre. Az EYAS egy bizonyítást egyszer, 2 percig és csak addig fogad el, amíg az az OpenCode folyamat fut, és a hívást csak a bizonyításban megnevezett munkamenetnek szolgálja ki. A modell által tool-argumentumként átadott munkamenet-azonosító nem jut el az EYAS-hoz. A modell által futtatott parancsnál nincs kulcs, így az egyetlen munkamenet nevében sem tud memóriahívást indítani.
- Ahol a kulcsot nem lehet a 3-as leírón átadni, az OpenCode az EYAS memóriatooljai nélkül fut, ahelyett hogy más úton kapna kulcsot.

Minden hívás ugyanazon az EYAS tool-végrehajtón fut át, mint bármely más modell memóriahívása (biztonsági kapu, jogosultságok, lefúrási keret, memória-hozzáférési napló, adatvédelmi maszkolás).

**A megmaradó korlátok.** Az OpenCode 1.18.29 a szerverjelszavát csak a környezetéből olvassa. A modell által futtatott shell üresnek látja, de ugyanannak az operációsrendszer-felhasználónak bármely folyamata, amely olvashatja egy másik folyamat környezetét, kiolvashatja, és az OpenCode saját API-ján át vezérelheti annak az OpenCode szervernek a munkameneteit — például elolvashatja egy másik futó feladat üzeneteit —, és ez a modell által futtatott parancsra is igaz. A terminál saját szervere saját portot és jelszót kap; a háttérszerver jelszavát soha nem kapja meg, így a terminálban futó parancs nem örökli. Ha minden feladat saját szerveren futna, ez sem zárná be a rést, mert ugyanannak az operációsrendszer-felhasználónak minden folyamata olvashatja a többi környezetét; csak egy külön operációsrendszer-felhasználó vagy egy OpenCode köré tett sandbox zárná be. Az OpenCode-nak nincs kernel sandboxa. Egy olyan folyamat, amely olvashatja egy másik folyamat memóriáját (egy az operációs rendszer által engedett debugger vagy a root), továbbra is elérheti a kulcsot.

**Mit rögzít az EYAS.** Az OpenCode tool-kimenetét egy `opencode_run` feladatban és a terminálpanel kimenetét csak bekapcsolt `memory.l0.captureToolResults` mellett rögzíti (alapból ki), mint minden más tool kimenetét: a beszélgetés projektje alatt, *ingested* bizalmi szinttel, és szó szerint soha nem idézi fel. A terminál kimenetét csak olyan beszélgetésnél rögzíti, amely létezik, és a terminál felhasználójáé. Az OpenCode végső válaszát és a diffeket nem tárolja külön: ezek az `opencode_run` eredménye. Lásd [Memória](/docs/hu/knowledge/memory/).

**API (integrátoroknak).** A `POST /api/v1/opencode/memory/search` és a `POST /api/v1/opencode/memory/expand` a `memory_search` / `memory_expand` argumentumait fogadja. A plugin egy egyszer használható munkamenet-bizonyítással hitelesít, `Authorization: Bearer eyas-ocs.<payload>.<signature>`, hívásonként eggyel, és a hívás a bizonyításban megnevezett munkamenet nevében jár el: az a törzs, amely a `sessionId` mezőben másik munkamenetet nevez meg, `403`-at kap; a hamisított, újrajátszott vagy lejárt bizonyítás, egy már leállt folyamat bizonyítása, vagy a nyers kulcs bearerként használva `401`-et kap. Egy bejelentkezett felhasználó, akinek létrehozási joga van az OpenCode-on, továbbra is hívhatja az útvonalakat, és a törzsben a `sessionId` mezővel megnevezhet egy munkamenetet; a hívás csak akkor jár el annak a munkamenetnek a nevében, ha a felhasználó a munkamenethez kötött felhasználó, különben csak a globális memóriát olvassa. A jogosultsági elutasítás `403`. A válaszok úgy maszkolódnak, mint bármely távoli modellnek küldött memóriatool-eredmény. A régi `/api/v1/opencode/memory/query` és `/api/v1/opencode/memory/save` megszűnt (`404`). A `/api/v1/opencode/*` munkamenet-sütivel indított módosító hívásai megkövetelik az `X-Eyas-Request` fejlécet, mint a többi admin API (a webes felület küldi).

### Modell és gondolkodás {#model-and-reasoning}

Az OpenCode oldal **Modell és gondolkodás** kártyája választja ki a modellt és a gondolkodási változatot azokhoz a feladatokhoz, amelyeket az asszisztens az OpenCode-nak ad ki (`opencode_run`).

- A **Modell** lista az OpenCode saját modelljeit mutatja: azokat a providereket és modelleket, amelyekbe az EYAS saját OpenCode sidecarja be van jelentkezve, a futó OpenCode szervertől beolvasva. Az **OpenCode alapértelmezés** (üres) nem küld modellt, így az OpenCode a saját alapértelmezését használja, pontosan úgy, mint korábban.
- A **Gondolkodási változat** lista azokat a változatokat mutatja, amelyeket az OpenCode a kiválasztott modellhez kínál — például low/medium/high/xhigh/max a Claude Opus 5.5-höz, none…max a GPT-5.6-hoz, minimal/high egyes Gemini modellekhez. Ha a modellnek nincsenek változatai, a lista rejtve marad. **A modell alapértelmezése** (üres) nem küld változatot. A szabványos nevek (none, minimal, low, medium, high, xhigh, max) az EYAS effort-címkéivel jelennek meg; a provider-specifikus nevek úgy, ahogy az OpenCode nevezi őket.
- Másik modell választásakor a változat visszaáll, hacsak az új modell nem kínálja ugyanazt. A **Mentés** tárolja a választást; ehhez kezelési jog kell az OpenCode-on (alapból owner és admin).
- A listához futnia kell az OpenCode szervernek. Az első OpenCode terminál-sessionnel vagy delegált feladattal indul — az oldal nem indítja el. Addig a kártya ezt jelzi, és csak a mentett választást mutatja; ha a szerver már fut, töltsd újra az oldalt. Ha az OpenCode nem tudja visszaadni a listáját, a kártya ezt írja: *Nem sikerült beolvasni a modellek listáját az OpenCode-ból.*
- Futáskor az a mentett változat, amelyet a modell már nem kínál, vagy amely nem ellenőrizhető, mert a lista olvashatatlan, figyelmeztetéssel a szervernaplóban kimarad; a feladat a kiválasztott modellen, annak alapértelmezett gondolkodásával fut. A feladat eredménye megnevezi a ténylegesen futott modellt és változatot, ahogy az OpenCode jelenti őket (`effective` mező), azt is, melyik modellt választotta az OpenCode, ha nem volt beállítva.
- Az OpenCode terminált ez nem érinti: annak a modelljét továbbra is az OpenCode-on belül választod.

A meglévő telepítések az OpenCode alapértelmezett modelljén és változatán indulnak; nincs mit migrálni.

**API (integrátoroknak).** A `GET /api/v1/opencode/models` (OpenCode olvasási jog) ezt adja vissza: `{running, providers: [{id, name, models: [{id, name, variants: [{id, level}], contextWindow?}]}], defaults}`; a `contextWindow` a modell bemeneti limitje (különben a kontextuslimitje), ha az OpenCode listáz ilyet. Provider-hitelesítő adatokat soha nem ad vissza, és soha nem indítja el a szervert: futó szerver nélkül `running: false` a válasz; ha a lista lekérése elbukik, `502` az `OPENCODE_MODELS_UNAVAILABLE` kóddal. A `PUT /api/v1/opencode/settings` elfogadja a `model` (`{providerID, modelID}` vagy null) és a `variant` (string vagy null) mezőt, és bármilyen hibás törzset `400`-zal utasít el, ahelyett hogy figyelmen kívül hagyná.

### Csatlakozás külső szerverhez {#attaching-to-an-external-server}

Egy külső OpenCode szerverre mutató csatolási URL **izoláció nélkülit** jelent: az a szerver megtartja a saját konfigját, bejelentkezését és jogosultsági szabályait, és nem kap EYAS memóriatoolokat, memóriakulcsot és rögzítést. Az OpenCode oldal ilyenkor a **Szerver** és az **Izoláció** sort *Figyelmeztetés* állapotban mutatja, ezzel a közléssel.

### Az OpenCode oldal {#the-opencode-page}

Az oldal lefordított ellenőrzésneveket, egy **Izoláció** sort, egy **Szerver** sort, egy bejelentkezési tippet és a **Modell és gondolkodás** kártyát mutat.

### Frissítés {#upgrade}

- A korábbi verziók az OpenCode fájljait a telepítési mappa `data/opencode` alatt tartották. Ezt a mappát az EYAS már nem használja. Ami még kell, azt mozgasd ki a `data/opencode/workspaces` alól (korábbi terminál-sessionök), utána törölheted.
- Az `eyas_query_memory` és `eyas_save_memory` OpenCode-toolok helyére a `memory_search` / `memory_expand` lépett. Egy futó OpenCode a következő indulásakor (az EYAS újraindításakor) kapja meg az új plugint.
- Az `EYAS_OPENCODE_PLUGIN_TOKEN` már nem létezik: az EYAS se nem olvassa, se nem állítja be. Minden OpenCode folyamat saját kulcsot kap a 3-as fájlleírón, a memóriahívások pedig munkamenetenkénti bizonyításokat visznek. Egy csatolt szerver már nem éri el az EYAS memóriáját.
- A memória-plugin átköltözött az EYAS-hoz tartozó OpenCode-mappán belül a `config/opencode/eyas/eyas-memory.ts` fájlba; a régi `plugins/eyas-memory.ts` a következő induláskor törlődik. Az OpenCode modelljének most valóban van `memory_search` / `memory_expand` toolja (az OpenCode 1.18.29-en ellenőrizve).
- Az OpenCode tool- és terminálkimenete csak bekapcsolt `memory.l0.captureToolResults` mellett tárolódik.

## Kapcsolódó

- [Eszközök](/docs/hu/automation/tools/)
- [Memória](/docs/hu/knowledge/memory/)
- [Beszélgetések](/docs/hu/daily/conversations/)
- [Biztonság és adatvédelem](/docs/hu/admin/security-privacy/)
