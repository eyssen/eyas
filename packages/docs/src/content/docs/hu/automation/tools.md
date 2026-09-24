---
title: Eszközök
description: Hívható képességek katalógusa — kockázat, jóváhagyás és hozzárendelés az agentekhez.
---

**Mire való.** Az eszközök (toolok) azok a műveletek, amelyeket egy agent ténylegesen el tud végezni: fájlt olvas, indexben keres, böngészőt nyit, e-mail-piszkozatot küld. Ez az oldal az ezen a példányon regisztrált összes tool élő katalógusa. A hozzárendelés továbbra is az agent **Beállítások** fülén történik; itt a nevet, a kategóriát, a kockázatot, és azt nézed meg, vár-e egy hívás jóváhagyásra.

**Útvonal:** `/tools`. Menü: **Eszközök**. Alcím: *Az agentek által használható regisztrált eszközök.*

## Mikor használd

- Mielőtt tool id-ket írsz egy agentre, látni akarod, mi létezik.
- Egy hívást blokkoltak, és kell a kockázati szint, meg hogy **jóváhagyást igényel**-e.
- MCP-t vagy Kapcsolatot kötsz be, és a felfedezett toolokat a beépítettek mellett akarod látni.
- Kell egy tool bemeneti sémája, mert az agent folyton rosszul hívja.

## Tipikus folyamat

1. Nyisd meg az **Eszközök** menüpontot (`/tools`).
2. Keress név vagy leírás szerint, vagy szűrj kategóriára és kockázati szintre.
3. Nyisd ki a kártyán a **Séma megjelenítése** részt, ha kell a JSON bemenet alakja.
4. Írd a tool id-t az agent **Beállítások** fülén az **Eszközök (vesszővel elválasztva)** mezőbe. Lásd [Konfiguráció](/docs/hu/agents/configure/).
5. A veszélyes hívások futáskor továbbra is átmennek a [biztonsági kapun](/docs/hu/admin/security-privacy/) — egy katalógussor nem jogosultság.

## Funkciók

A fejléc számolja az **eszköz**öket, és hogy hány **jóváhagyást igényel**. Minden kártyán monospace id, rövid leírás, kategória-badge, kockázati badge (`green kockázat`, `yellow kockázat` vagy `red kockázat`) és borostyán pajzs, ha jóváhagyás kell.

| Fogalom | Jelentés |
|---------|----------|
| Tool név | Stabil id az agent-configban és a logokban |
| Leírás | Mit csinál a tool (a katalógusban látszik) |
| Kategória | Csoportosítás a regiszterből: `memory`, `knowledge`, `search`, `documents`, `board`, `shell`, `browser`, `conversation`, `communication`, `research`, `agent`, `custom` (az MCP- és kapcsolat-toolok a sajátjukat hozzák) |
| Kockázati szint | **green / yellow / red** — a biztonsági kapu low / medium / high szintje |
| **jóváhagyás szükséges** | A végrehajtó nem futtatja a hívást, amíg egy ember jóvá nem hagyja |
| Bemeneti séma | Az argumentumok JSON Schemája; **Séma megjelenítése** / **Séma elrejtése** |
| Jogosultság | CASL az API-n, plusz a biztonsági kapu minden hívásnál. A modell csak olyan toolt futtathat, amelyet az agentje megkapott: minden más nevet az EYAS jóváhagyási kérdés nélkül elutasít (*'&lt;tool&gt;' is not in this agent's toolset*), minden providernél — lásd [Konfiguráció — Toolok](/docs/hu/agents/configure/#tools--constraints) |
| Homokozó | Egyes toolok korlátozott környezetben futnak |

Üres: *Még nincs regisztrált eszköz.* A betöltés (*Eszközök betöltése…*) és a betöltési hiba (*Nem sikerült betölteni az eszközöket: …*) szövegként jelenik meg az oldalon, nem üres képernyőként.

Az MCP-alapú toolokat az [MCP-szerverek](/docs/hu/ai/mcp/) alatt, a külső rendszerek hitelesítő adatait a [Kapcsolatok](/docs/hu/admin/connections/) alatt állítod be.

<h3 id="tool-execution-log">Toolfuttatási napló</h3>

Minden toolhívás bekerül a toolfuttatási naplóba: a tool kanonikus neve, a bemenete, a kimenete vagy hibaszövege, az időtartam, valamint a beszélgetés, az agent és a felügyelt futás, amelyhez tartozik.

- Az EYAS végrehajtó által futtatott hívásokat — API providereken, és azokat az EYAS toolokat, amelyeket egy CLI az EYAS hídon át hív — a végrehajtó naplózza, mindegyiket egyszer.
- Azok a toolok is kapnak sort, amelyeket egy CLI a saját ciklusában futtatott — Claude Code, Grok CLI és Kimi Code CLI, például a shelljük vagy a fájlolvasásuk —, a kanonikus néven (a Claude Code `Bash` toolja `run_command` néven kerül a naplóba). Ezeket nem az EYAS futtatta, ezért csak rögzíti őket: az EYAS adott CLI-re vonatkozó jogosultság-ellenőrzése alatt már lefutottak.
- Ezek a sorok azok a tool-bizonyítékok, amelyekhez a teljességi kritikus egy futást mér, és ezekből dolgoznak a Self-learning és a hatékonysági jelentések is — minden providernél ugyanúgy.
- A napló nem memória: belőle semmi nem jut az EYAS memóriájába. Azt, hogy a toolok kimenete rögzül-e a memóriában, egyedül a `memory.l0.captureToolResults` dönti el — lásd [Memória](/docs/hu/knowledge/memory/).

Az [Observability — Használat](/docs/hu/admin/observability/#usage-tab) **Eszközök** oszlopa trace-enként ugyanezeket a hívásokat számolja.

## Mezők és vezérlők

<h2 id="catalogue">Katalógus-szűrők</h2>

| Vezérlő | Jelentés |
|---------|----------|
| Keresés | *Eszközök keresése…* — névre vagy leírásra illeszt |
| **Minden kategória** | Szűkítés egy regiszter-kategóriára |
| **Minden kockázati szint** | Szűkítés egy kockázati szintre |

<h2 id="built-in-tool-groups">Beépített toolcsoportok (kiemelések)</h2>

<h3 id="coding-surface">Kódolási felület (modellfüggetlen)</h3>

Első osztályú fájlrendszer-toolok, hogy **minden** modell (Grok, Claude API, Kimi, lokális, …) tudjon kódot szerkeszteni a Claude Code SDK beépített tooljai nélkül:

| Tool | Cél | Kockázat |
|------|-----|----------|
| `read_file` | Szövegfájl olvasása (sor-offset/limit) | green |
| `write_file` | Fájl létrehozása/felülírása | yellow |
| `edit_file` | Pontos stringcsere (célzott szerkesztés) | yellow |
| `grep` | Tartalomkeresés a workspace-ben | green |
| `glob` | Fájlkeresés mintára | green |
| `git_status` / `git_diff` | Csak olvasó review-segédek | green |
| `run_command` | Shell nélküli programfuttatás (jóváhagyással) | red |

Az útvonalak a beszélgetés **munkamappáira** (vagy az agent **worktree**-jére) vannak zárva — a saját mappa nélküli beszélgetés a saját EYAS workspace-ében dolgozik. Az EYAS process könyvtárára nincs visszaesés. Az érzékeny útvonalak (`.env`, `master.key`, `.ssh`, …) tiltottak, és ugyanígy az EYAS-on kívüli memória is — más eszközök memóriája, Obsidian vaultok, az EYAS saját adatmappája és egy másik beszélgetés workspace-e —, olvasásra és írásra egyaránt ([Biztonság és adatvédelem — Memória az EYAS-on kívül](/docs/hu/admin/security-privacy/#memory-outside-eyas)). Olyan mappát, amely memóriát vagy hitelesítő adatokat tenne elérhetővé, munkamappaként el sem lehet menteni ([Beszélgetések — Mappák](/docs/hu/daily/conversations/#working-folders)). Olyan mappában, amely csak tartalmaz ilyen helyet — egy repó az EYAS `data/` mappájával, a `~/Documents` egy vaulttal —, a `grep` és a `glob` soha nem lép be a védett almappákba (az EYAS adatmappája, egy beágyazott Obsidian vault, egy másik eszköz memóriája, egy CLI home, egy másik beszélgetés workspace-e), így a keresés soha nem ad vissza belőlük találatot. A munkamappán belüli, kifelé mutató symlinket az EYAS elutasítja, akkor is, ha a célja még nem létezik (ez a `read_file`, `write_file`, `edit_file` és `browser_upload` útvonalakra vonatkozik). Teljes fájl-újraírás helyett inkább `edit_file`.

**Olvasó git kattintás nélkül.** Ha az agent olyan argumentumlistával hívja a `run_command`-ot (vagy egy CLI `Bash`-t), amely egyértelműen `git status` vagy `git diff` — nincs shell-metakarakter, nincs `-C` / `--git-dir` / `--no-index`, nincs abszolút útvonal —, a biztonsági kapu `git_status` / `git_diff`-re képezi, és **engedélyezi**. Nem kapsz jóváhagyási kérdést. A `git commit`, a `git add`, az `ls` és minden metakarakteres parancs piros marad, vagy elutasított. A külön `git_status` / `git_diff` toolok zöldek.

**Verify before done:** az `agent.verifyCommands` YAML-ben (pl. `bun test`) determinisztikus ellenőrzéseket futtat egy futás után; hiba esetén az agent a hibaösszefoglalóval újra megnyílik.

**Hookok:** minden toolhívás átmegy a ToolExecutor PreToolUse / PostToolUse hookjain (univerzális, nem csak Claude). A Claude Code saját beépített tooljai emellett a futásuk előtt átmennek az EYAS memória-policy ellenőrzésén is.

**A CLI-modellek a saját fájltooljaikat használják.** A Claude Code, a Grok és a Kimi nem kapja meg ezt a kódolási felületet (`run_command`, `read_file`, `write_file`, `edit_file`, `grep`, `glob`, `git_status`, `git_diff`) az EYAS hídon, mert megvan nekik a sajátjuk: ezeket a kör mappáiban futtatják, a biztonsági kapu, a memória-útvonal policy és — a Claude Code shelljénél és a Grok tooljainál — a [kernel fájl-sandbox](/docs/hu/ai/providers/#kernel-file-sandbox) alatt. Minden más EYAS tool eljut hozzájuk.

<h3 id="search-grounding">Keresés és grounding</h3>

| Tool | Cél |
|------|-----|
| `list_search_sources` | Források listája (címke, verzió, kiadás, család, útvonalak, állapot), mielőtt tényt találna ki |
| `get_search_context` | Mely források vannak rögzítve ehhez a beszélgetéshez |
| `set_search_context` | Források rögzítése vagy törlése (`sourceIds`, `labels`, `version`, `edition`, vagy `clear: true`) |
| `search_indexed` | Hibrid FTS + vektoros keresés **hivatkozásokkal**; tiszteletben tartja a beszélgetés/projekt rögzítését; opcionális `sourceIds` / `labels` / `version` / `edition` |

Ha több **odoo-family** forrás kész, és semmi nincs rögzítve, a toolok verziók keverése helyett **`needsPin`**-t adnak vissza. Lásd [Keresés — több verzió rögzítése](/docs/hu/daily/search/#többverziós-pin-melyik-fát-használhatja-az-ágens).

<h3 id="memory">Memória</h3>

| Tool | Cél |
|------|-----|
| `memory_search` | Keresés az EYAS memóriájában — összefoglalók, tények, vault-jegyzetek, importált átiratok —, soha nem a host CLI-ében. Csak olvas, és az EYAS a beszélgetés projektjére, annak típusára és a globális memóriára zárja; a `scope` vagy projekt argumentumot figyelmen kívül hagyja. `memory_expand`-dal megnyitható azonosítókat ad vissza. |
| `memory_expand` | Egy találat megnyitása azonosító alapján (`vt:`, `gs:`, `en:`, … — a `memory_search`-ből vagy egy állandó memóriasorból), ugyanazon a projektzáron belül |
| `search_memory` | A `memory_search` aliasa, ugyanazzal a projektzárral |
| `save_memory` | Kivezetve — semmit nem ír. A memóriát az EYAS automatikusan rögzíti; az agentek maguk soha nem írnak memóriát |

A `memory_search` és a `memory_expand` mindig elérhető, bármit mond is az agent **Tools** listája, és minden hoston ez az egyetlen két memóriatool, amelyet egy modell megkap — API providereken, Claude Code-on, Grokon, Kimin, és az OpenCode-ban egy `opencode_run` feladaton belül. A három kereső/megnyitó tool közös kerete **válaszonként 3 hívás** minden providernél. Az EYAS beszélgetésen kívüli hívó — egy külső MCP kliens, vagy egy olyan OpenCode session, amelyet nem az EYAS indított egy feladathoz — csak a globális memóriát olvassa, 90 másodpercenként 3 hívással. A `memory_block_read` és a `memory_block_write` kivezetve: ami a blokkokban volt, az egyszer átmásolódott az EYAS memóriába, és a `memory_search`-csel megtalálható; az az agent, amelynek listája még megnevezi őket, egyszerűen nem kapja meg őket. A memóriatoolok eredményét az adatvédelmi policy minden átviteli úton maszkolja (API providerek, a CLI hidak, külső MCP kliensek, OpenCode). Lásd [Memória](/docs/hu/knowledge/memory/).

<h3 id="browser">Böngésző</h3>

A headless Playwright (`browser_*`) ugyanazt a Chromiumot használja, mint a design print pipeline. CSS helyett inkább a `browser_snapshot` számozott indexeit használd. Az indexek és a `snapshotId` navigációra vagy visszalépésre érvénytelenné válnak — készíts új snapshotot. A sütik egy **EYAS-hoz tartozó** profilban maradnak meg (`data/browser/profile`, vagy `EYAS_BROWSER_USER_DATA_DIR`) — soha nem a napi Chrome-profilban (a Chrome 136+ blokkolja a Default profil CDP-jét). A letöltések a [Dokumentumok](/docs/hu/knowledge/documents/) közé kerülnek.

| Tool | Cél |
|------|-----|
| `browser_navigate` | URL megnyitása; az **SSRF**-védelem blokkolja a privát/metadata hostokat |
| `browser_snapshot` | Accessibility fa + számozott interaktív lista + `snapshotId` |
| `browser_click` / `browser_fill` / `browser_hover` / `browser_select` | Művelet index vagy CSS alapján |
| `browser_tabs` | `list` / `open` / `switch` / `close` (az utolsó fül nem zárható be) |
| `browser_back` / `browser_wait` | Vissza az előzményben; várakozás selectorra, URL-re, betöltésre vagy időre |
| `browser_dialog` | Elfogadás/elutasítás élesítése a következő `alert`/`confirm`/`prompt`-ra |
| `browser_upload` | Fájlmező — workspace-útvonalak vagy Dokumentum id-k |
| `browser_evaluate` | JavaScript **az oldalon** (nem Node); a JSON eredmény korlátozott |
| `browser_download` | A következő letöltés → Dokumentumok, a beszélgetéshez kötve |
| `browser_storage` | Playwright `storageState` mentése/betöltése (sütik + originek) |
| `browser_replay` / `browser_action_cache` | Mentett locator visszajátszása (LLM nélkül). JSON a projektben vagy a vaultban. Kitöltött értéket soha nem tartalmaz |
| `browser_totp` | TOTP a Titkokból / macOS Keychainből → `browser_fill`. Sárga. A seed soha nem jön vissza |
| `browser_screenshot` / `browser_get_content` / `browser_close` | Képernyőkép, szöveg, a folyamat vége (a profil a lemezen marad) |
| `agent_browser_status` / `agent_browser_run` | Ajánlott agent-browser sidecar (`@e1` hivatkozások, Apache-2.0) — [Browser Use](/docs/hu/automation/browser-use/) |
| `browser_use_status` / `browser_use_exec` | Régi Python CLI sidecar ([Browser Use](/docs/hu/automation/browser-use/)) |
| `opencode_status` / `opencode_run` | Opcionális OpenCode kódoló-motor sidecar ([OpenCode](/docs/hu/automation/opencode/)). A status zöld; a run piros + jóváhagyás. Az `opencode_run` csak beszélgetésen belül fut. A feladaton belül az OpenCode ugyanazzal a csak olvasó `memory_search` / `memory_expand` párossal olvashatja az EYAS memóriáját, a beszélgetés projektjére zárva, és a hívó kör 3 hívásos keretén osztozva; EYAS memóriát nem írhat. |

Az EYAS böngészőtoolok, az `agent_browser_*`, a `browser_use_*` és az `opencode_*` a CLI-modellekhez (Claude Code, Grok, Kimi) is eljutnak az EYAS hídon, ugyanazzal a kapuval, jóváhagyásokkal és tool-hatókörrel, mint az API-modelleknél.

<h3 id="studio">Stúdió (opcionális modul)</h3>

Helyi motorok, nem Média. Lásd [Stúdió](/docs/hu/studio/).

| Tool | Cél |
|------|-----|
| `hyperframes_*` | HTML kompozíció → determinisztikus MP4 ([Hyperframes](/docs/hu/studio/hyperframes/)) |
| `videouse_*` | Felvétel + EDL → MP4 ([Video Use](/docs/hu/studio/videouse/)) |

A képernyőrögzítés csiszolása nem Stúdió-tool. A Recordly AGPL kísérő a [Bővítmények](/docs/hu/admin/extensions/#recordly) alatt — nincsenek `recordly_*` toolok.

<h3 id="email">E-mail (piszkozat → jóváhagyás → küldés)</h3>

| Tool | Cél |
|------|-----|
| `email_create_draft` | Helyi piszkozat létrehozása |
| `email_approve_draft` | Piszkozat jóváhagyottnak jelölése |
| `email_send_draft` | Küldés, **csak** ha jóváhagyott |

<h3 id="odoo">Odoo (opcionális modul)</h3>

**Élő példány** (JSON-RPC):

| Tool | Cél |
|------|-----|
| `odoo_search_tasks` | Ticketek/feladatok keresése (főleg olvasás) |
| `odoo_get_task` | Egy feladat lekérése |
| `odoo_message_post` | Chatter-üzenet küldése |
| `odoo_write_task` | Kapuzott írás |

**Helyi forrásindex** (kódolási lánc):

| Tool | Cél |
|------|-----|
| `odoo_search_model` | `_name` / `_inherit` keresése a helyi Pythonban |
| `odoo_search_field` | `fields.*` hozzárendelések keresése |
| `odoo_search_xml_id` | XML rekord-id-k keresése |

A gyökerek feloldása: beszélgetés/projekt **rögzítés** → Keresési források (`family: odoo`) → `EYAS_ODOO_SOURCES_JSON` / `EYAS_ODOO_SOURCE_PATHS`. Opcionális toolszűrők: `label`, `labels`, `sourceIds`, `version`, `edition`. Hivatkozások: `[source:odoo-src:label:file:line]`.

Skill: `coding/odoo/odoo-dev-chain`. Élő hitelesítés a [Kapcsolatok](/docs/hu/admin/connections/) alatt (Odoo típus). Több verzió a felületen: [Keresés](/docs/hu/daily/search/) · [Projektek](/docs/hu/daily/projects/) · a beszélgetés **Források** füle.

<h3 id="connections-inventory">Kapcsolat-leltár</h3>

| Tool | Cél |
|------|-----|
| `connections_list` / `connections_catalog` | Leltár + katalógus |
| `connections_test` | Állapotellenőrzés |
| `connections_propose` | Kapcsolat javaslása emberi jóváhagyásra |

<h3 id="media">Média (opcionális modul)</h3>

A Magnific, a Higgsfield, a fal vagy a HeyGen a [Média](/docs/hu/ai/media/) alatt csatlakoztatható. Az agentek öt közös toolt kapnak, nem egyet gyártói modellenként. Talking-head / presenter videóhoz rögzítsd: `provider: heygen`.

| Tool | Cél | Kockázat |
|------|-----|----------|
| `media_generate` | Kép / videó / hang / felskálázás / szerkesztés / 3D indítása | yellow |
| `media_wait` | Lekérdezés, amíg a job véget nem ér | yellow |
| `media_catalog` | Modellek listája egy fajtához | green |
| `media_balance` | Maradék kredit | green |
| `media_history` | Legutóbbi jobok | green |

A kész fájlok a [Dokumentumok](/docs/hu/knowledge/documents/) közé kerülnek, és az őket létrehozó körhöz csatolódnak.

<h3 id="other-groups">További regisztrált csoportok</h3>

Ezek akkor jelennek meg a katalógusban, ha a moduljuk be van kapcsolva: **board** toolok, **conversation** toolok, **document** toolok, **knowledge** toolok, **research** toolok, **schedule** toolok, **channel** küldés/lista, **A2A delegate**, és opcionálisan **Google Docs**.

Agent-routing (az agent-modul regisztrálja, ebben a katalógusban nincs duplikálva):

| Tool | Cél | Kockázat |
|------|-----|----------|
| `run_specialist` | Egy bekapcsolt specialista elindítása, és várakozás az összefoglalóra. Alias: `delegate_to_agent`. Minden providernél ez az egyetlen módja a specialisták futtatásának — a Claude Code saját subagent-toolját az EYAS nem kínálja fel. | green |
| `handoff_to_colleague` | Megnyitja egy másik kolléga home-szálát, és azonnal futást indít benne, az eligazítással mint céllal; amíg az a szál foglalt, elutasítja. | green |
| `assign_task` | Aszinkron táblakártya egy bekapcsolt agentnek. | green |
| `propose_team` | Kártya hiányzó szerepekre, epic munkára vagy kifejezett csapatkérésre. | yellow |
| `propose_agent_creation` | Új specialista-sablon javaslása. | yellow |

Lásd [Csapatok és delegálás](/docs/hu/agents/teams/).

<h3 id="cli-mcp-parity">CLI MCP paritás</h3>

Ha az agentek **Grok CLI**-n vagy **Kimi Code CLI**-n futnak, az EYAS egy stdio MCP hidat csatlakoztat, így ezek a hostok ugyanazokat a ToolExecutor toolokat kapják, mint a folyamaton belüli / Claude Code sessionök — a memóriatoolokat is. Minden körnek saját titka van, amelyet a szerver az adott beszélgetéshez, agenthez, projekthez, mappákhoz és tool-hatókörhöz köt, és a hídon érkező hívások is átmennek a biztonsági kapun. Mindkét hídon — a Claude Code folyamaton belüli EYAS MCP szerverén és a Grok/Kimi hídon — a CLI pontosan az agent **Tools** listáját kapja, plusz a `memory_search` / `memory_expand` toolt (üres listánál minden toolt), Solo beszélgetésben delegáló toolokat nem, és nem azokat a toolokat, amelyeknek a CLI-ben van engedélyezett saját megfelelője (`read_file`, `grep`, `glob` mindig; `write_file`, `edit_file`, amíg a lista engedi az írást; `run_command`, `git_status`, `git_diff`, amíg engedi a shellt). Ugyanez a lista a CLI saját író, shell- és webes tooljait is korlátozza (lásd [Agentek — Eszközök](/docs/hu/agents/configure/#tools--constraints)). Minden más tool hívását az EYAS elutasítja, és az **Elutasítva** állapotként látszik. Az EYAS minden induláskor teszteli a hidat, és figyelmeztetést logol, ha a Grok/Kimi nem éri el az EYAS toolokat. Minden host a maga módján nevezi a toolokat (Grok: `use_tool` `eyas__<name>` névvel). Lásd [MCP](/docs/hu/ai/mcp/#cli-mcp-tool-parity-grok--kimi).

## Kapcsolódó

- [Agentek — toolok beállítása](/docs/hu/agents/configure/)
- [Csapatok és delegálás](/docs/hu/agents/teams/)
- [Biztonsági kapu](/docs/hu/admin/security-privacy/)
- [Kapcsolatok](/docs/hu/admin/connections/)
- [Készségek](/docs/hu/automation/skills/)
- [MCP-szerverek](/docs/hu/ai/mcp/)
- [OpenCode](/docs/hu/automation/opencode/)
- [Média](/docs/hu/ai/media/)
- [Stúdió](/docs/hu/studio/)
- [Browser Use](/docs/hu/automation/browser-use/)
- [Bővítmények](/docs/hu/admin/extensions/#recordly)
