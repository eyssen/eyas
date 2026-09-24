---
title: Szójegyzék
description: Termék fogalmak.
---

| Fogalom | Definíció |
|---------|-----------|
| Ágens | Konfigurált AI szereplő |
| Kolléga | Primary vagy team agent, akivel beszélsz; kollégánként egy home-szál (sidebar **Kollégák**) |
| Primary | Always-on kollégák a setupból (Személyi asszisztens + Rendszermérnök) |
| Specialista | Szűk munkás, akit bármelyik kolléga indíthat (`run_specialist`) |
| Home-szál | Kollégánként egy folytonos beszélgetés |
| Skill | Markdown eljárás-csomag |
| Készségjavaslat | Illeszkedő készség, amire a beszélgetés fordulója vár — **Használd**, **Most ne**, vagy tulajdonos/admin **Kapcsold ki** |
| Tool | Hívható képesség |
| Coding surface | Modellfüggetlen file toolok (`read_file`, `edit_file`, `grep`, …) az EYAS-ban, nem egy vendor SDK-ban |
| Worktree | Izolált git working tree párhuzamos író specialistáknak (`.eyas-worktrees/`) |
| Verify commands | Lint/test a run után, a critic előtt |
| Tool hook | PreToolUse / PostToolUse minden tool végrehajtásnál |
| Tool-kimenetel | Egy toolhívás lezárt státusza a tool-nyomkövetésben: *Sikeres*, *Sikertelen*, *Elutasítva*, *Jóváhagyásra vár* vagy *Kihagyva* (*Kimenetel ismeretlen*, ha a kör előbb véget ért). Egy sor csak akkor lesz zöld, ha a tool ténylegesen visszajelzett — minden providernél ugyanígy ([Tool-nyomkövetés](/docs/hu/daily/conversations/#tool-trace)) |
| Toolfuttatási napló | Minden toolhívás nyilvántartása: kanonikus név, bemenet, kimenet vagy hibaszöveg, időtartam, beszélgetés, agent és futás. Benne vannak azok a toolok is, amelyeket egy CLI a saját ciklusában futtatott (a Claude Code `Bash` toolja `run_command` néven). Ebből dolgozik a teljességi kritikus és a Self-learning; belőle semmi nem jut a memóriába ([Eszközök](/docs/hu/automation/tools/#tool-execution-log)) |
| Tábla | Munkakövető felület |
| Beszélgetés | Chat szál |
| A kör kimenete | Hogyan ért véget egy chatkör, egyetlen badge-ként a válasz alatt: befejezett körnél nincs badge, különben *Elérte a körlimitet*, *Elérte a kimeneti limitet*, *A modell elutasította*, *Elfogyott az eszközkeret*, *Leállítva*, *Sikertelen* vagy *Jóváhagyásra vár*. Az addig megírt válasz mindig megmarad ([A kör kimenete](/docs/hu/daily/conversations/#turn-outcome)) |
| Memória szint | Working→episodic→vault→archive |
| Nyers napló (L0) | Minden üzenet, amelyet az EYAS elment, még egyszer, szó szerint és tömörítve, valamint a toolok kimenete és a modell gondolkodása, ha ezek a kapcsolók be vannak kapcsolva. A modellek csak a felidézésen át érik el, a rögzített toolkimenetet és gondolkodást pedig soha nem idézi fel az EYAS. Kapcsoló: `memory.l0.enabled` ([A nyers napló](/docs/hu/knowledge/memory/#the-raw-record)) |
| Bizalmi szint | Ki írta a megjegyzett szöveget: *owner*, *derived*, *peer*, *ingested* vagy *quarantined*. Egy tény vagy összefoglaló soha nem kap nagyobb bizalmat, mint a szöveg, amelyből készült. Súly a felidézésben: 1 / 1 / 0,3 / 0,6 / soha ([Bizalom: ki írta](/docs/hu/knowledge/memory/#trust-who-wrote-it)) |
| Projekt-hatókör | Az a memória, amelyet egy beszélgetés láthat: a saját projektjéé, a projekttípusáé és a globális memória — másik projekté soha. Az EYAS a szerveren kényszeríti ki a felidézésre és minden memóriatoolra, bármit küld is a modell ([Melyik memóriát látja egy beszélgetés](/docs/hu/knowledge/memory/#which-memory-a-conversation-can-see)) |
| Memória-azonosító | A felidézett sor azonosítója, amelyet a `memory_expand` megnyit. Az előtagja a réteget jelöli: `vt:` vault-jegyzet, `gs:` összefoglaló, `ft:` tény, `en:` entitás, `ep:` epizód, `rw:` nyers napló (egy korábbi üzenet). A Megfigyelhetőség ezekkel a kódokkal számolja az átadott memóriát |
| Memory block | Kivezetve: a korábbi megosztott jegyzetek, amelyeket az agentek a `memory_block_*` toolokkal olvastak/írtak; frissítéskor egyszer átmásolódtak az EYAS memóriába |
| Vault | Markdown hosszú távú tudás |
| Capture run | Egy post-turn tartós-memória kinyerés; minden kimenetel `memory_capture_runs` sort ír. Kapcsoló: `memory.capture.enabled` |
| Design canvas | Több artboardos `.dc.html` + `canvas.json`, Claude Design fájlformátum EYAS runtime-mal |
| Provider | LLM backend |
| Provider-típus | `cli` (Claude Code CLI, Grok CLI, Kimi Code CLI), `local` (Ollama, LM Studio, vLLM) vagy `api` (minden hosztolt API). A `GET /api/v1/model/providers` a termék neve mellett adja vissza, és a Providerek oldal meg a Setup varázsló erről ismeri fel a CLI providert ([Providerek](/docs/hu/ai/providers/#built-in-providers)) |
| Rögzített modell | Az a modell, amelyen egy beszélgetés fut, és amelyet megtart. Az új beszélgetés, amely nem nevez meg modellt, az első üzenetnél a telepítés alapértelmezését kapja; az alapértelmezések későbbi módosítása nem mozdítja el. A modellválasztóban általad választott modellt az EYAS soha nem cseréli le csendben: ha elérhetetlenné válik, az üzenetet elutasítja |
| Modellválasztó | A beszélgetés felső sávjának vezérlője, amely rögzített modellt, Auto-routingot vagy a kolléga alapértelmezését választja, és megmondja, melyik modell válaszol a következő üzenetre és miért |
| Auto-routing | Beszélgetésenkénti választás: csak az Auto-ra állított beszélgetés üzeneteit osztályozza és routolja az EYAS a szintek között, és csak addig, amíg az **Automatikus útválasztás engedélyezése** be van kapcsolva |
| Kolléga alapértelmezése | A kollégával folytatott beszélgetés (és az al-beszélgetés) a kolléga modelljét követi, különben a delegáló beszélgetés modelljét, különben az alapértelmezést; ha a kolléga modellje nem elérhető, a kör megjegyzéssel esik vissza, soha nem némán |
| Háttérmodell | Az a modell, amelyen az EYAS háttérmunkája (címek, heartbeat, memória-rögzítés, biztonsági bíró, kutatás, …) fut — csak izolált hívásra képes provider, rögzített szintsorrendben próbálva. A Routing szintek **Háttérben futó modellhívások** kártyája megmutatja, hová megy az egyes csoportok munkája |
| Kernel fájl-sandbox | Az operációs rendszer fájl-sandboxa (macOS Seatbelt, Linux bubblewrap), amelyben a Claude Code shellparancsai és a Grok CLI saját toolai futnak, és amely blokkolja az EYAS-on kívüli memóriát és az EYAS privát adatait; a Kimi Code CLI-nek nincs ilyenje. `security.cliSandbox: auto \| required` |
| Karantén (provider-memória) | Owner-művelet a Memória → Áttekintés fülön, amely minden modell elől elrejti, amit egy provider írt, és később fel is oldható; semmi nem törlődik |
| CLI home | Az EYAS saját mappája, amelyben a Grok CLI, a Kimi Code CLI és az OpenCode fut (`<data dir>/cli-homes/<provider>`) az operátor saját beállításai helyett; itt van az EYAS-os bejelentkezésük. A Claude Code a host home-ját használja, és csak a bejelentkezését osztja meg |
| Bejelentkezés az EYAS számára | Az EYAS saját CLI home-jába tett Grok CLI / Kimi Code CLI bejelentkezés (eszközkód, vagy Groknál xAI API-kulcs) — a host bejelentkezését az EYAS nem használja |
| Izolációs ellenőrzés | Az EYAS ellenőrzése, hogy egy CLI (Claude Code, Grok, Kimi) semmit nem töltött be a hostról; az ezen elbukó kör leáll, és soha nem kerül át másik modellhez |
| Kiadási ellenőrzés | `bun run test:live-cli`, kiadás előtt: a valódi Claude Code és Grok CLI (és ahol telepítve van, a Kimi Code CLI) az EYAS-on át fut egy eldobható, csapdákkal teli home-ban, hogy bizonyítsa: a hostról semmi nem töltődik be, és az EYAS-on kívüli memória elutasítva marad. Az ingyenes része helyi álmodellel fut, és nem fogyaszt tokent ([Hogyan bizonyított az izoláció](/docs/hu/admin/security-privacy/#how-isolation-is-proven)) |
| Bizonyított CLI-verzió | Az a CLI-verzió, amelyen a kiadási ellenőrzés legutóbb átment: Claude Code 2.1.281 és Grok CLI 1.0.41; a Kimi Code CLI még nem. Az `eyas doctor` figyelmeztet, ha a telepített verzió eltér; minden session induláskor így is ellenőrzésen megy át ([Bizonyított CLI-verziók](/docs/hu/ai/providers/#proven-cli-versions)) |
| Körblokk | A `<turn-context>` blokk, amelyet az EYAS minden körben az aktuális üzeneted elejére tesz: az aktuális dátum és idő, majd a felidézési blokk. Minden körben frissen készül, és csak a modellnek megy el — az üzeneteddel soha nem tárolódik —, így a rendszerprompt körről körre változatlan marad ([Hogyan jut el a felidézés a modellhez](/docs/hu/knowledge/memory/#how-recall-reaches-the-model)) |
| Felidézési blokk | A körblokkon belüli határolt `<eyas-memory>` blokk: az állandó jegyzetek, az ehhez az üzenethez visszakeresett jegyzetek és a legjobb találatok teljes szövege. Minden providernél ugyanilyen, és a válaszoló modell kontextusablakához méreteződik |
| Drill-down | Amikor a modell maga nyit meg memóriát a `memory_search` / `memory_expand` toolokkal: válaszonként 3 hívás minden providernél, mindig a beszélgetés projekt-hatókörén belül. Minden host a maga módján nevezi meg a toolokat (Claude Code-ban `mcp__eyas__memory_search`, Grok CLI-ben `use_tool` az `eyas__memory_search` névvel); a toolt hívni nem tudó modell nem kap drill-down lehetőséget, helyette több jegyzetet kap teljes szöveggel ([Mélyebbre: memory_search és memory_expand](/docs/hu/knowledge/memory/#looking-further-memory_search-and-memory_expand)) |
| Átadási profil | Amit az EYAS a kört megválaszoló modellről tud: a kontextusablaka, hív-e toolokat, hogyan nevezi a hostja az EYAS toolokat, és tud-e drill-downt. Ebből méreteződik a prompt és a felidézési blokk, a toolt hívni nem tudó modell pedig egyetlen toolt sem kap. Körönként az **Átadott memória** doboz mutatja ([Kontextus-összeállítás](/docs/hu/daily/conversations/#context-composition)) |
| Felidéző motor | Amin át minden modell felidéz: egy helyi embedder (multilingual-e5-small, különben egy hash-alapú tartalék), projekt-partíciónként tárolt vektorok, egy lekérdezés és egy rangsorolás. Csak olvashatóan a **Memória → Áttekintés** fül **Felidéző motor** kártyája mutatja ([Felidéző motor](/docs/hu/knowledge/memory/#recall-engine)) |
| Memóriaátadás szolgáltatónként | A **Megfigyelhetőség → Kontextus** kártyája, amely providerenként összeveti, hány kör kapott memóriát, átlagosan hány tételt rétegenként, mennyi memória-tokent és hány drill-downt körönként. Hasonló számok azt jelentik, hogy minden modell ugyanazt a memóriát kapta ([Observability és ops](/docs/hu/admin/observability/#memory-delivery-by-provider)) |
| Memória az EYAS-on kívül | Más eszközök memóriája, jegyzet-vaultok és az EYAS saját adatmappája — olvasásra és írásra is minden modell számára tiltott |
| MCP | Model Context Protocol |
| Connection | Névvel ellátott külső rendszer leltár (Odoo, GitHub, MCP, …) health + vault titkok |
| Csatorna | Külső üzenetküldő connector (Telegram, Slack, e-mail, …) — nem Connection, nem Kéz |
| Kéz (Hand) | Párosított helyi kliens OS/CLI/asztali toolokkal ([Kezek](/docs/hu/admin/hands/)) |
| Média | Hosted prompt→pixel kapu (Magnific, Higgsfield, fal, HeyGen). Öt `media_*` tool; egyik sem default. ([Média](/docs/hu/ai/media/)) |
| HeyGen | Opcionális talking-head / presenter videó backend a Média alatt (MCP OAuth, webes csomag kredit). Nem Stúdió. ([Média](/docs/hu/ai/media/)) |
| Stúdió | Helyi gyártómotorok (HTML vagy felvétel → fájl). Nem a Média. ([Stúdió](/docs/hu/studio/)) |
| Video Use | Stúdió-motor: nyers felvétel vágása EDL-ből ([Video Use](/docs/hu/studio/videouse/)) |
| Browser Use | Opcionális CLI-sidecar belépett Chrome-hoz CDP-n ([Browser Use](/docs/hu/automation/browser-use/)) |
| OpenCode | Opcionális MIT kódoló-motor sidecar (HTTP 127.0.0.1 + webes TUI). Nincs vendoring. ([OpenCode](/docs/hu/automation/opencode/)) |
| OpenCode memória-plugin | Az OpenCode modelljének az EYAS csak olvasható `memory_search` / `memory_expand` toolját adja, memóriát író toolt nem. Egy `opencode_run` feladat a beszélgetése projekt-hatókörét olvassa, más sessionök csak a globális memóriát, egy csatolt külső szerver pedig semmit. Minden OpenCode folyamat, amelyet az EYAS indít, saját kulcsot kap, amely a folyamattal együtt megszűnik ([EYAS-memória az OpenCode-on belül](/docs/hu/automation/opencode/#eyas-memory-inside-opencode)) |
| Távoli csomópont | Másik gép, amit ez a példány elér (SSH és társai) ([Csomópontok](/docs/hu/admin/nodes/)) |
| Bővítménycsomag | Harmadik feles skill pack a katalógusból, MIT-kompatibilis licencellenőrzés ([Bővítmények](/docs/hu/admin/extensions/)) |
| Recordly | AGPL asztali képernyőrögzítő; harmadik feles kísérő a Bővítményekben, nincs csomagolva, nem Stúdió-motor ([Recordly](/docs/hu/admin/extensions/#recordly)) |
| Grounding | Indexelt forrásból retrieval, mielőtt tényt állít |
| Hybrid search | FTS + vektor (RRF) |
| Search source | Névvel indexelt fa (path + opcionális label/version/edition/family) |
| Code source pin | Conversation vagy project kijelölése, mely search source-okat használhat az ágens |
| Working directories | Elnevezett mappák (`név` + abszolút path), ahol a beszélgetés olvashat/írhat; az első a primary cwd. Típuson és/vagy projekten; a beszélgetés örökli. A fájl-eszközök ide vannak zárva — ha egy beszélgetésnek nincs ilyenje, saját EYAS workspace-t kap |
| EYAS workspace | Az a mappa, amelyet az EYAS a saját munkakönyvtár nélküli beszélgetésnek hoz létre; soha nincs git checkouton belül (áthelyezése: `EYAS_WORKSPACES_DIR`) |
| Először terv | Composer mód: a modell tervet ír, és **Jóváhagyás** / **Terv kihagyása** / **Elutasítás**ra vár, mielőtt tool futna |
| Skill import roots | Példány `skills.importRoots` / `agent.importRoots` a `local.yaml`-ban — extra markdown mappák, minden induláskor beolvasva. Alap üres. A más eszközök mappáin belüli gyökereket az EYAS kihagyja |
| Projekt-wiki | Projektenkénti oldalak (`/projects/:id/wiki`); opcionális auto-update lezárt ticketekből és csapatdöntésekből |
| needsPin | Tool válasz, ha több odoo-family verzió ready, de nincs pin |
| Prompt Enhancer | Beszélgetés draft coach (modellcsalád-tudatos) |
| Prompt Coach | Tartós project / agent system prompt coach |
| Forge | Jóváhagyott soul/identity változások |
| God Mode | Ugyanazt a feladatot a Beállítások roster modelljei versenyeztetik; páros számnál chair dönt |
| Security gate | Pre-action policy |
| CASL | Authorization library |
| Orchestration | Solo/Auto/Deep specialista-policy (plusz God Mode) |
| Effort | Gondolkodási mélység (Automatikus, Nincs, Minimális, Alacsony, Közepes, Magas, Nagyon magas, Maximális). A választó csak a modell által kínált szinteket listázza; az Automatikus örököl (Mély → Maximális, kolléga, delegáló beszélgetés, routing-szint), vagy a modell alapértelmezését használja; minden hívás ahhoz igazodik, amit a válaszoló modell támogat, és minden válasz megmutatja, milyen efforttal futott |
| Visszaolvasott effort | A Claude Code CLI, a Grok CLI és a Kimi Code CLI jelenti, milyen effort-szinten futott ténylegesen, és a válasz meg a trace ezt mutatja. Minden más providernél azt a szintet mutatják, amelyet az EYAS a modellhez igazítva elküldött ([Hogyan alkalmazza az effort-szintet az egyes provider](/docs/hu/ai/providers/#effort-by-provider)) |
| SLA breach | Overdue / stale work jel a proactive heartbeatből |
| A2A | Agent-to-agent protokoll (card + task execution) |
