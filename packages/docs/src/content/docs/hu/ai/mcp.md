---
title: MCP-szerverek
description: Model Context Protocol — aktív szerverek, katalógus-telepítés, memóriatár-szerverek tiltása és CLI tool-paritás.
---

**Mire való.** Az MCP (Model Context Protocol) az, ahogy az EYAS *külső* toolboxokat csatol: filesystem szervert, SaaS MCP-t, helyi `npx` folyamatot. Az itt felfedezett toolok ugyanúgy hozzárendelhetők, mint a beépítettek. Nem chat-[csatorna](/docs/hu/communication/channels/) és nem [Kapcsolat](/docs/hu/admin/connections/) leltársor — bár MCP-szervert Kapcsolatként is felvehetsz állapotfigyeléshez.

**Útvonal:** `/mcp-settings` (menü: **MCP-szerverek**). Cím: **MCP-szerverek**. Alcím: *Bővítsd az EYAS-t külső eszközökkel, erőforrásokkal és promptokkal a Model Context Protocol segítségével.* Fülek: **Aktív** · **Katalógus**.

## Mikor használd

- Egy agentnek olyan toolok kellenek, amelyeket az EYAS nem szállít (gyártói MCP, helyi filesystem szerver).
- Egy Grok vagy Kimi agent nem éri el az EYAS toolokat, és kell a híd öntesztjének eredménye.
- Egykattintásos katalógus-telepítést akarsz (API-kulccsal) parancs gépelése helyett.
- A Grok/Kimi CLI sessionök ugyanazokat a ToolExecutor toolokat lássák, mint a folyamaton belüli agentek.
- Egy szerver nem csatlakozik, és kell a **Teszt** / a felfedezett toolok száma.
- Egy szerver **Tiltva: memóriatár** jelzést mutat, vagy egy telepítést elutasított az EYAS, mert az EYAS-on kívül tartana memóriát.

## Tipikus folyamat

1. Nyisd meg az **MCP-szerverek** oldalt (`/mcp-settings`).
2. Böngészd a **Katalógus** fület, szűrj kategóriára. Szakaszok: **Használatra kész** / **Egykattintásos telepítés (API-kulcs szükséges)** / **Harmadik fél (kézi beállítás)** / **Nem elérhető — EYAS-on kívüli memória**.
3. **Telepítés** (ha kéri, add meg a kulcsokat, majd **Telepítés és csatlakozás**), vagy **Kézi** → **MCP-szerver hozzáadása** (név, átvitel, parancs vagy URL).
4. Az **Aktív** fülön ellenőrizd, hogy a szerver csatlakozott, futtasd a **Teszt**et, nézd meg a felfedezett toolokat / erőforrásokat / promptokat.
5. Ezeket a tool id-ket az agent **Beállítások** fülén rendeld hozzá. Lásd [Eszközök](/docs/hu/automation/tools/).

## Funkciók

A fejléc **N/M csatlakozva** értéket mutat. A katalógusbejegyzéseken **licenc**-badge van (MIT-kompatibilis / copyleft / proprietary / ismeretlen) — a copyleft és a proprietary is **külön folyamatként** fut; az EYAS MIT marad.

Egy MCP-szervert [Kapcsolat](/docs/hu/admin/connections/) leltársorként is felvehetsz (**MCP server** típus), hogy az Odoo/GitHub/stb. mellett az állapotát is kövesd.

A Magnific, a Higgsfield, a fal és a HeyGen a [Média](/docs/hu/ai/media/) alatt csatlakozik; az agent öt `media_*` toolt használ a nyers MCP-katalógusuk helyett.

Az **Agent Browser** (Vercel, Apache-2.0) egy Browser katalógussor: `agent-browser mcp --tools core,state`. Előbb telepítsd a CLI-t (`EYAS_AGENT_BROWSER_BIN` vagy PATH). Soha ne `--tools all` (az a `chat`-et is tartalmazza). Lásd [Browser Use](/docs/hu/automation/browser-use/).

A **Chrome DevTools MCP** (Google, Apache-2.0) egy **DevTools** katalógussor: `npx -y chrome-devtools-mcp@latest --isolated`, kikapcsolt telemetriával és `--categoryExperimentalWebmcp=true` beállítással. Csak kódolásra/hibakeresésre (konzol, hálózat, Lighthouse, WebMCP) — **nem** űrlapkitöltésre. A toolok `mcp_chrome-devtools_*` néven érkeznek. A WebMCP toolok (`list_webmcp_tools` / `execute_webmcp_tool`) csak akkor, ha a sidecar hirdeti őket; különben az EYAS nem találja ki őket. A `--autoConnect` és a napi Chrome-profil tiltott. Lásd [Browser Use](/docs/hu/automation/browser-use/#chrome-devtools-mcp).

## Mezők és vezérlők

<h2 id="active">Aktív szerverek</h2>

Minden szerverkártya mutatja a nevet, egy állapotjelző pontot, az átvitelt, a parancsot vagy az URL-t, és badge-eket:

| Vezérlő | Jelentés |
|---------|----------|
| **kikapcsolva** | A szerver létezik, de nincs engedélyezve |
| **Tiltva: memóriatár** | A szerver az EYAS-on kívül tart memóriát, vagy védett mappára mutat. Soha nem indul el, és a toolja egyik modellhez sem jut el; a **Teszt** és a **Frissítés** tiltva, a **Szerkesztés** és a **Törlés** továbbra is működik — lásd [lent](#memory-store-servers-are-blocked) |
| **OAuth** / **API-kulcs** | Hogyan hitelesít a szerver (nincs badge, ha nem kell hitelesítés) |
| **OAuth-os csatlakozás** | OAuth-szerverek: elindítja a böngészős bejelentkezést (`POST …/oauth/start` → átirányítás). A Magnificnál és a Higgsfieldnél **Csatlakozás Magnific / Higgsfield (OAuth)** a felirat |
| **A Beállítások → Média kezeli** | Akkor jelenik meg, ha a szerver a Médiához tartozik (`ownedBy` = `media`) |
| **N eszköz / N erőforrás / N prompt** | Felfedezett katalógus |
| **Teszt** → **Kapcsolat rendben / A teszt sikertelen** | Kapcsolatpróba; az utolsó teszt eredménye |
| **Frissítés** | A szerver tooljainak újrafelfedezése |
| **Szerkesztés** / **Törlés** | Parancs, URL vagy API-kulcs módosítása; a szerver eltávolítása |

<h2 id="add-server">Hozzáadás / szerkesztés</h2>

A **Kézi** gomb az **MCP-szerver hozzáadása** párbeszédablakot nyitja meg (meglévő szervernél **MCP-szerver szerkesztése**):

| Mező | Jelentés |
|------|----------|
| **Név** | Megjelenő id |
| **Átvitel** | **stdio (helyi folyamat)** · **HTTP (távoli)** · **SSE (streamelhető HTTP)** — az `sse` átvitel Streamable HTTP; **ne** toldj hozzá `/sse` utótagot. A session headert az EYAS kezeli. |
| **Parancs** / **Argumentumok** | Csak stdio: a folyamat (`npx`) és a szóközzel elválasztott argumentumai |
| **URL** | Csak HTTP / SSE: a végpont (`/sse` utótag nélkül) |
| **API-kulcs (opcionális)** | Csak HTTP / SSE: Bearer tokenként megy |

Az OAuth-tal bejelentkező szerverek a katalógusból vagy a Médiából jönnek; a párbeszédablakban nincs OAuth-opció.

<h2 id="catalog">Katalógus</h2>

| Vezérlő | Jelentés |
|---------|----------|
| Kategóriaszűrő | **Mind (N)** plusz kategóriánként |
| **Telepítés / Telepítve** | Egykattintásos, vagy már megvan |
| **Telepítési útmutató** / **Útmutató elrejtése** | A gyártói lépések kinyitása |
| Kulcsbekérő ablak | Kötelező kulcsok a **Telepítés és csatlakozás** előtt |
| Licencmegjegyzés | *… licenc alatt. Külön folyamatként fut — az EYAS MIT marad.* |

Üres aktív lista: *Nincs konfigurált MCP-szerver* — **Katalógus böngészése**.

<h3 id="memory-store-servers-are-blocked">A memóriatár-szerverek tiltottak</h3>

Egy MCP-szerver, amely egy második memóriát tart az EYAS-on kívül, minden modell számára élő olvasási/írási forrássá válna. Az ilyen szerverek minden modell számára tiltottak — API providereknél, Claude Code-nál, Grok CLI-nél és Kimi CLI-nél egyaránt. Az EYAS csak a saját tárain keresztül olvas és ír memóriát; más memória behozásának módja az egyirányú import (**Beállítások → Rendszer → Adat hordozhatóság → Adatok importálása**, lásd [Adatimport](/docs/hu/admin/data-port/)).

Mi számít memóriatárnak:

- A **Memory** (tudásgráf-szerver), a **Qdrant** és az **Obsidian** katalógusbejegyzés. Ezek a **Nem elérhető — EYAS-on kívüli memória** szakaszban szerepelnek, letiltott **Telepítés** gombbal, rövid magyarázattal és egy **Ugrás az Adat hordozhatósághoz** gombbal.
- A kézzel felvett szerver, amelynek parancsa vagy argumentumai ismert memóriacsomagot vagy -binárist neveznek meg: az MCP referencia memóriaszerver (`@modelcontextprotocol/server-memory`, `mcp-server-memory`), az MCPVault (`@bitbonsai/mcpvault`, `mcpvault`), az Obsidian MCP szerverek (`mcp-obsidian`, `obsidian-mcp`, `obsidian-mcp-server`), a Basic Memory, a Mem0/OpenMemory, valamint a megjelölt katalógusbejegyzések csomagjai (például `mcp-server-qdrant`). A verzió-utótag nem számít. Csak a csomag- és binárisneveket illeszti az EYAS, a megjelenített nevet soha, így az a szerver, amelyet csak *elneveztek* „memory”-nak, rendben települ.
- Az a szerver, amelynek argumentuma, `--flag=value` értéke, környezeti változójának értéke, parancsútvonala vagy `file://` URL-je védett mappára mutat: egy másik eszköz memóriájára vagy állapotára (`~/.claude`, `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, `~/.codeium`, az OpenCode mappái, `ai-memory` mappák, egy Obsidian vault, `security.foreignMemoryPaths` bejegyzések), az EYAS saját adatmappájára (vault, adatbázis, kulcsok — a beszélgetés-workspace-ek engedélyezettek maradnak) vagy az EYAS saját CLI-home-jaira. Az Obsidian vaultra vagy a `data/vault`-ra mutató Filesystem szerver tiltott; a közönséges projektmappára mutató rendben van. A `data/mcp-servers/` mappából futtatott szerverek — ide klónozza őket a `config/mcp.yaml` — szerverkódot tartalmaznak, nem memóriát, ezért engedélyezettek (a valódi útvonaluk alapján: az innen a vaultba mutató link továbbra is tiltott).

**Mi történik.** A katalógusból telepítést, a kézi felvételt vagy egy szerver ilyen konfigurációra szerkesztését az EYAS lefordított üzenettel elutasítja, és semmi nem mentődik. A tiltás bevezetése előtt beállított szervereket nem törli: induláskor **Tiltva** állapotot kapnak, soha nem indulnak el, és egyik `mcp_*` toolt sem kapja meg semmilyen modell. Az **Aktív** fül **Tiltva: memóriatár** badge-et mutat az okkal és az adatimportra mutató linkkel. Ha a policy már nem jelöli meg a szervert (például egy mappát kivettek a `security.foreignMemoryPaths`-ból), a következő induláskor kikerül a Tiltva állapotból. A `config/mcp.yaml` memóriatár-bejegyzéseit az EYAS hibával a logban kihagyja.

**Migráció.** A meglévő telepítések elveszítenek egy korábban működő Memory, Qdrant, Obsidian vagy MCPVault szervert, és minden vaultra vagy egy másik eszköz memóriájára mutató szervert. Ez szándékos: azt a memóriát egyszer másold be az EYAS-ba az adatimporttal.

**API (integrátoroknak).** A `GET /api/v1/mcp/servers` szerverenként `blocked: 'memory_store' | null` mezőt ad (`blocked` státusz). A `POST /api/v1/mcp/servers`, a `PUT /api/v1/mcp/servers/:id`, a `POST /api/v1/mcp/registry/:id/install` és a `POST /api/v1/mcp/servers/:id/refresh` `409 {error, code: 'memory_store_blocked'}` választ ad; a `POST /api/v1/mcp/servers/:id/test` `{ok: false, code: 'memory_store_blocked'}` értéket ad vissza. A katalógusbejegyzések `memoryStore: true` mezőt hordoznak.

---

<h2 id="cli-mcp-tool-parity-grok--kimi">CLI MCP tool-paritás (Grok / Kimi)</h2>

Az API és a folyamaton belüli providerek már osztoznak az EYAS toolokon. A **host CLI** providereknél:

| Provider | Viselkedés |
|----------|------------|
| **Claude Code** | Folyamaton belüli MCP-szerver `eyas` néven, `mcp__eyas__<name>` formában hívva. Nem az alábbi stdio hídon megy át, így nem függ a híd indítási öntesztjétől. Ez az egyetlen MCP-szerver, amelyet a Claude Code betölt. |
| **Grok CLI / Kimi Code CLI** | Stdio MCP-szerver + loopback híd (`/api/v1/internal/cli-mcp/tools/list` és `/tools/call`) körönkénti titokkal; az ACP `session/new` `mcpServers`-t kap, így a CLI host ugyanazokat a ToolExecutor toolokat hívhatja. Ez az egyetlen MCP-szerver, amelyhez csatlakozhatnak: host- és projekt-MCP-szervereket nem töltenek be (lásd [Providerek](/docs/hu/ai/providers/#grok-cli-and-kimi-code-cli)). |

Az OpenCode itt nem MCP host: egy `opencode_run` feladaton belül az EYAS memória-pluginjától kapja a `memory_search` / `memory_expand` toolt (lásd [lent](#tool-names-per-host) és [OpenCode](/docs/hu/automation/opencode/)).

**Mely EYAS toolokat kapja egy CLI.** Mindkét hídra egy szabály vonatkozik: az agent hatókörébe tartozó minden EYAS tool — a **Tools** listája plusz a `memory_search` és a `memory_expand` (üres lista = minden tool), **Solo** beszélgetésben a `run_specialist`, a `delegate_to_agent`, a `handoff_to_colleague` és a `propose_team` nélkül — **kivéve** azokat, amelyeknek a CLI-ben van engedélyezett saját megfelelője: `read_file`, `grep` és `glob` (a CLI olvasó toolai mindig engedélyezettek), `write_file` és `edit_file`, amíg az agent listája engedi az írást, valamint `run_command`, `git_status` és `git_diff`, amíg engedi a shellt. Ezekhez a CLI a saját shell- és fájltooljait használja a kör mappáiban, a [kernel fájl-sandbox](/docs/hu/ai/providers/#kernel-file-sandbox) és a memória-útvonal policy alatt. Az az EYAS tool, amelynek CLI-beli megfelelője nincs engedélyezve, ehelyett a hídon át érhető el — `run_command` nélküli listán a `git_status` és a `git_diff`. Az agent **Tools** listája a CLI saját író, shell- és webes tooljait is korlátozza (lásd [Agentek — Eszközök](/docs/hu/agents/configure/#tools--constraints)). A CLI-modellek megkapják az EYAS böngészőtoolokat is (`browser_*`, a mentett sessionöket és a `browser_totp`-t is beleértve), az `agent_browser_*`, a `browser_use_*` és az `opencode_*` toolokat. Ezek az EYAS-ban futnak, ugyanazzal a biztonsági kapuval, jóváhagyásokkal, jogosultságokkal és tool-hatókörrel, mint az API-modelleknél. Groknál és Kiminél a körönkénti kötés a szerveren tárolja a tool-hatókört: a `tools/list` pontosan az engedélyezett toolokat mutatja, a `tools/call` minden mást elutasít — még a biztonsági kapu megkérdezése előtt, így soha nem keletkezik belőle jóváhagyás —, és az elutasítás a kör toolsorán **Elutasítva** állapotként látszik. A CLI-modell rendszerpromptjában a tool-lista nem nevezi meg azokat az EYAS toolokat, amelyeket a CLI saját, engedélyezett toolai helyettesítenek.

Eredmény: a kódoló CLI-k és a webes agent út **egységes tool-felületet** lát, párhuzamos integrációk helyett. Claude Code-on minden hídon átmenő toolhívás hordozza a beszélgetést, a projektjét, a választ (kört) és a futást, így a memória-drill-down a többi providerhez hasonlóan **válaszonként 3 hívás**, a memóriatalálatok a beszélgetés projektjére, annak típusára és a globális memóriára zárva maradnak, a toolfuttatások pedig a felügyelt futáshoz rendelődnek. A beszélgetésen kívül érkező kérés nem egy üres beszélgetés-azonosítóhoz rendelődik. A Grok és Kimi agentek elérik a `memory_search` / `memory_expand` toolt, a táblát, a dokumentumokat, a keresést és a többi EYAS toolt. A segédfolyamat azt is közli a modellel, hogy az EYAS memóriája az egyetlen memória, és hogy a `memory_search` / `memory_expand` ettől a szervertől jön.

<h3 id="how-the-bridge-is-secured">Hogyan védett a híd</h3>

- Minden válaszkör saját véletlen titkot kap (192 bit).
- Az EYAS a szerveren rögzíti, melyik beszélgetéshez, agenthez, projekthez, körhöz és futáshoz tartozik a titok, hogy a kör figyelt (interaktív chat vagy csatornás beszélgetés) vagy autonóm (háttérfutás; a nem figyeltként megjelölt kör autonómnak számít), valamint egy folytatott futásnál a már végrehajtott hívások listáját. A segédfolyamat csak a titkot mutatja fel; semmi, amit küld, nem veheti rá a toolhívást, hogy másik beszélgetés, projekt vagy felhasználó nevében járjon el.
- A titkot a kör végén azonnal visszavonja (befejezve, elbukva, leállítva vagy félbehagyva), és az utolsó használata után 2 órával lejár, így egy hosszú, sokat dolgozó kör megtartja az EYAS tooljait.
- A láthatóan proxyn át, nem lokális címről érkező kérést elutasítja, érvényes titokkal is.
- A hídon át érkező toolhívásokról ugyanúgy születik döntés, mint a Claude Code toolhívásairól és az API-providerek saját tool-hurkában: először a toolkészlet-ellenőrzés (az agent listáján kívüli toolt a kapu előtt **Elutasítva** állapottal utasítja el, így soha nem kerül jóváhagyás a sorba), aztán az EYAS [biztonsági kapuja](/docs/hu/admin/security-privacy/), autonóm köröknél pedig az autonómia-létra; a jogosultság-ellenőrzés az agent nevében fut. Figyelt chatben vagy csatornás beszélgetésben az a hívás, amelyet a kapu engedélyez, lefut — egy jóváhagyást igénylőként megjelölt tool már nem vár a sorban csak azért, mert a modell Grok vagy Kimi —, az a hívás pedig, amelyet a kapu eszkalál, jóváhagyási kártyát mutat, a chat szüneteltetése nélkül. Autonóm futásban egy **Értesítés** vagy **Jóváhagyás** szintű hívás jóváhagyásra vár, egy eszkalált hívás pedig mindig emberre vár, **Automatikus** szinten is (korábban Grokon és Kimin kérdezés nélkül lefutott). Futó biztonsági kapu nélkül minden hídon át érkező hívás elutasításra kerül. A híd a szerveren ismeri a kör mappáit — a beszélgetés összes mappáját, nem csak az elsőt —, így az EYAS fájltoolok bennük működnek, és egy kérés soha nem nevezhet meg saját mappákat.
- Ha egy hídon át hívott EYAS toolt a kapu elutasít, vagy az jóváhagyásra vár, a kimenet a beszélgetés ugyanazon toolsorához jut vissza, a jóváhagyás Jóváhagyások-sorbeli bejegyzésével együtt. Felügyelt autonóm futásban egy ilyen jóváhagyás a CLI körének végén ugyanúgy szünetelteti a futást (**Jóváhagyásra vár**), mint a CLI saját tooljaira vonatkozó jóváhagyás; jóváhagyás után a futás folytatódik, és pontosan a jóváhagyott hívás egyszer engedélyezett.
- Ha egy folytatott vagy újrapróbált futás megismétel egy olyan EYAS toolhívást, amelyet az eredeti futás már befejezett, az EYAS még a futása előtt elutasítja, és a sor **Kihagyva** állapotot mutat — *already executed on the original run — duplicate side effect prevented*. Ugyanaz a tool más argumentumokkal továbbra is lefut. Grokon egy EYAS tool sora azokat az argumentumokat rögzíti, amelyeket a tool kapott (a `use_tool` `tool_input` mezőjét), nem a Grok burkolóját, így a folytatott futás felismeri az ismétlést. A kiadási ellenőrzés a telepített Grok CLI-n bizonyította; hogy egy valódi Kimi-bináris hogyan jelenti ezeket a hívásokat, azt hoston még nem ellenőrizték.
- A memóriatoolok (`memory_search`, `search_memory`, `memory_expand`, `search_knowledge`, `get_page`, `read_team_memory`) eredményét — a hibaszövegeiket is — az adatvédelmi policy maszkolja, mielőtt a CLI megkapja, pontosan úgy, mint a promptba kerülő memóriát: a CLI gyártója mindig távolinak számít, és ezen semmi nem változtat, amit a segédfolyamat küld. Ugyanez a maszkolás érvényes a Claude Code folyamaton belüli EYAS tooljaira is. Ha a szkennelés elbukik, az eredményt az EYAS visszatartja (*Error: memory tool result withheld (privacy scan failed)*). A többi tool eredménye változatlanul megy át. Lásd [Hol hat a maszkolás](/docs/hu/admin/security-privacy/#where-masking-applies).
- Pontosan két belső útvonal kerüli meg a webes bejelentkezést: `/api/v1/internal/cli-mcp/tools/list` és `/api/v1/internal/cli-mcp/tools/call`. Minden más belső útvonalhoz továbbra is bejelentkezés kell.

A segédfolyamat ugyanazzal a runtime-mal fut, mint az EYAS (Bun), a saját telepítési helyéről, így Docker image-ben is működik; megtalálásához az `EYAS_INSTALL_ROOT`-ot nem használja.

<h3 id="boot-self-test">Indítási önteszt</h3>

Induláskor az EYAS a teljes kéréslánccal teszteli a hidat, ugyanúgy, ahogy a segédfolyamat hívja majd. A siker logja: *CLI tool bridge self-test passed*. A hiba figyelmeztetés — *CLI tool bridge self-test failed — Grok/Kimi turns cannot reach EYAS tools (memory, board, …)* — mellékelt okkal; az indulás folytatódik, de a Grok és a Kimi ekkor EYAS toolok nélkül fut. Friss telepítésen a teszt a setup varázsló befejezéséig elhalasztódik (info log), és a következő induláskor fut le.

| Ok a figyelmeztetésben | Teendő |
|------------------------|--------|
| `tools/list returned HTTP 401 … Authentication required` | A futó buildből hiányzik a híd kivétele. Frissíts vagy építsd újra, majd indíts újra. |
| `stdio MCP server not found at …` | A buildből hiányzik a `dist/stdio-mcp-server.js`. Építsd újra `bun run build`-del (az ebből a verzióból épített Docker image-ek tartalmazzák), majd indíts újra. |
| `HTTP 404` | A Tools modul ki van kapcsolva, így nincs felkínálható EYAS tool. |

<h3 id="outside-mcp-clients">Külső MCP kliensek</h3>

Az EYAS saját MCP-szerverének (`/api/v1/mcp/tools/call`) klienseihez nem tartozik EYAS beszélgetés. Memóriatool-hívásaik csak a globális memóriát olvassák, 90 másodpercenként legfeljebb 3 hívással. Lásd [Memória — Mélyebbre: memory_search és memory_expand](/docs/hu/knowledge/memory/#looking-further-memory_search-and-memory_expand).

- **Maszkolva.** A külső MCP kliensnek küldött memóriatool-eredményeket az adatvédelmi policy ugyanúgy maszkolja, mint minden más távoli célnál — egy külső kliens bármilyen modellt futtathat, ezért mindig távolinak számít. Ha a szkennelés elbukik, az eredményt az EYAS visszatartja.
- **Validálva.** A hibás `tools/call` törzs HTTP `400`-at kap JSON-RPC hibával: `-32600` *Invalid Request* nem JSON vagy nem objektum törzsre, `-32602` *Invalid params* hiányzó névre vagy nem objektum `arguments`-re. Az ismeretlen tool `404` `-32601`-gyel.

<h2 id="tool-names-per-host">Toolnevek hostonként</h2>

Az EYAS tooloknak egy kanonikus nevük van (`memory_search`, `memory_expand`, …). Minden modellhost másként listázza őket:

| Host | Hogyan hívja a modell a `memory_search`-öt |
|------|-------------------------------------------|
| API providerek (Anthropic, OpenAI, Gemini, OpenRouter, Kimi API, Ollama, LM Studio, kompatibilis endpointok) | `memory_search` — a toolt maga az EYAS futtatja |
| Claude Code CLI | `mcp__eyas__memory_search` — a toolok az EYAS folyamaton belüli, `eyas` nevű MCP-szerveréről jönnek, amely nem a stdio hídon megy át, így nem függ a híd indítási öntesztjétől |
| Grok CLI | Az EYAS toolok nincsenek a Grok saját tool-listájában. A modell `search_tool`-lal találja meg őket, majd `use_tool`-t hív, `tool_name`-ként `eyas__memory_search`-csel, az argumentumokkal a `tool_input`-ban. A Grokban a sima `memory_search` a Grok saját beépített memóriatoolja, nem az EYAS memóriája, ezért az EYAS soha nem mondja egy Grok modellnek, hogy csupasz `memory_search`-öt hívjon. |
| Kimi Code CLI | `memory_search` az `eyas` nevű MCP-szerveren. A Kimi pontos elnevezése még nincs ellenőrizve, ezért az EYAS a szervert nevezi meg, nem egy minősített toolnevet. |
| OpenCode (egy `opencode_run` feladatban) | `memory_search` — az OpenCode-ban futó EYAS memória-plugin toolja, az EYAS saját nevével, leírásával és argumentumaival. A plugin a hívást az EYAS-nak küldi, amely a feladat beszélgetésére futtatja a valódi toolt. Csak a `memory_search` és a `memory_expand` érhető el, író tool nincs. |

Ha az EYAS tudja, melyik provider futtatja a kört, a rendszerprompt tool-listája egy sorral zárul, amely megmondja a modellnek, hogyan hívja a listázott toolokat a saját hostján — Claude Code-on azt, hogy az EYAS toolok az EYAS MCP-szerverről jönnek, és `mcp__eyas__<name>` formában hívhatók. A memória-tippek és a *N további jegyzet* sor ugyanígy nevezi meg a toolokat. Az API providereken futó modellek a sima neveket látják. Beállítani semmit nem kell. Ha egy beszélgetés más toolnév-konvenciójú providerre vált, a gyorsítótárazott prompt-előtag egyszer megváltozik (egyszeri prompt-cache miss).

## Kapcsolódó

- [Eszközök](/docs/hu/automation/tools/)
- [OpenCode](/docs/hu/automation/opencode/)
- [Média](/docs/hu/ai/media/)
- [Agent konfiguráció](/docs/hu/agents/configure/)
- [Kapcsolatok](/docs/hu/admin/connections/)
- [Providerek](/docs/hu/ai/providers/)
- [Adatimport](/docs/hu/admin/data-port/)
