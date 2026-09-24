---
title: MCP Servers
description: Model Context Protocol — Qapbogh QIn'a'mey, tetlhvo' chel, qawHaq ngaSwI' bot, CLI jan rap je.
---

**nuq 'oH.** *Hur* jan tevmey rarmeH EYAS mIw 'oH MCP (Model Context Protocol): teywI' pat QIn'a', SaaS MCP, juH `npx` Qu'. naDev tu'lu'bogh janmey chenlu'pu'bogh janmey rur noblu'. ja'chuq [He](/docs/tlh/communication/channels/) 'oHbe', [rarmey](/docs/tlh/admin/connections/) tetlh tlhegh 'oHbe' — 'ach Dotlh DabejmeH MCP QIn'a' rar rur DaqonlaH je.

**He:** `/mcp-settings` (retlh tetlh **MCP Servers**). pong: **MCP QIn'a'mey**. bIng pong: *Model Context Protocol lo'taHvIS Hur janmey, lIwmey, mu'tlheghmey je EYAS yIjuv.* Dech: **Qap** · **tetlh**.

## ghorgh yIlo'

- EYAS qengbe'bogh janmey poQ ghoqwI' (nobwI' MCP, juH teywI' pat QIn'a').
- EYAS janmey SIchlaHbe' Grok pagh Kimi ghoqwI', 'ej rarwI' chov'egh jang DaneH.
- ra' DaghItlhbe'taHvIS tetlhvo' wa' Qeq chel (API ngoq) DaneH.
- qoD ghoqwI'pu' rur ToolExecutor janmey rap legh Grok/Kimi CLI ja'chuqmey.
- rarbe' QIn'a', 'ej **chov** / tu'lu'bogh janmey mI' DaneH.
- **bot: qawHaq ngaSwI'** 'ang QIn'a', pagh EYAS Hur qawHaq polmo' chel lajQo'lu'.

## motlh mIw

1. **MCP Servers** yIpoSmoH (`/mcp-settings`).
2. **tetlh** yInej, Segh yIwIv. 'ay'mey: **lo'laH** / **wa' Qeq chel (API ngoq nIS)** / **latlh (lo'wI' SeH)** / **lo'laHbe' — EYAS Hur qawHaq**.
3. **chel** (tlhoblu'chugh ngoqmey yIghItlh, ghIq **yIchel 'ej yIrar**) pagh **lo'wI' ta'** → **MCP QIn'a' yIchel** (pong, qeng, ra' pagh URL).
4. **Qap**Daq QIn'a' rarlu''a' yIchov, **chov** yIQap, tu'lu'bogh janmey / lIwmey / mu'tlheghmey yIlegh.
5. ghoqwI' **SeHmey** DechDaq jan IDmeyvetlh yInob. [janmey](/docs/tlh/automation/tools/) yIlegh.

## laHmey

**N/M rarlu'** 'ang nIv. tetlh Dochmey **chaw'** Degh ghaj (MIT rap / copyleft / proprietary / Sovbe'lu') — copyleft proprietary je **latlh Qu'** rur Qap taH; EYAS MIT taH.

[rarmey](/docs/tlh/admin/connections/) tetlh tlhegh rur (Segh **MCP server**) MCP QIn'a' DaqonlaH je, Odoo/GitHub/latlh retlh Dotlh DabejmeH.

Magnific, Higgsfield, fal, HeyGen [nagh beQ](/docs/tlh/ai/media/)Daq rar; MCP tetlhchaj ngeb rarbe' vagh `media_*` jan lo' ghoqwI'.

**Agent Browser** (Vercel, Apache-2.0) Browser tetlh tlhegh 'oH: `agent-browser mcp --tools core,state`. wa'DIch CLI yIlIng (`EYAS_AGENT_BROWSER_BIN` pagh PATH). `--tools all` not (`chat` ngaS). [Browser Use](/docs/tlh/automation/browser-use/) yIlegh.

**Chrome DevTools MCP** (Google, Apache-2.0) **DevTools** tetlh tlhegh 'oH: `npx -y chrome-devtools-mcp@latest --isolated`, telemetry chu'Ha'lu', `--categoryExperimentalWebmcp=true`. ngoq/Qagh chov neH (console, network, Lighthouse, WebMCP) — 'aghtaHghach teb **ghobe'**. `mcp_chrome-devtools_*` rur ghoS janmey. WebMCP janmey (`list_webmcp_tools` / `execute_webmcp_tool`) sidecar ja'chugh neH; pagh chenmoHlu'be'. `--autoConnect` jaj Chrome profile je lajQo'lu'. [Browser Use](/docs/tlh/automation/browser-use/#chrome-devtools-mcp) yIlegh.

## Dochmey 'ej SeHwI'mey

<h2 id="active">Qapbogh QIn'a'mey</h2>

Hoch QIn'a' chaw' 'ang: pong, Dotlh Degh, qeng, ra' pagh URL, Deghmey je:

| SeHwI' | Del |
|--------|-----|
| **chu'Ha'** | tu'lu' QIn'a' 'ach chu'lu'be' |
| **bot: qawHaq ngaSwI'** | EYAS Hur qawHaq pol QIn'a', pagh 'avlu'bogh pa' 'oS. tagh not, 'ej pagh patDaq ghoS janmeyDaj; **chov** **chu'qa'** je chu'Ha'lu', **choH** **Qaw'** je Qap taH — [bIng](#memory-store-servers-are-blocked) yIlegh |
| **OAuth** / **API ngaq** | chay' 'el QIn'a' (pagh poQchugh Degh pagh) |
| **OAuth rar** | OAuth QIn'a'mey: Internet jan 'el tagh (`POST …/oauth/start` → vIH). Magnific Higgsfield je **Magnific / Higgsfield OAuth rar** 'ang |
| **Media waw' vIqonnIS** | nagh beQ ghajbogh QIn'a' (`ownedBy` `media` 'oH) |
| **N jan / N lIw / N mu'tlhegh** | tu'lu'bogh tetlh |
| **chov** → **rar Qap / chov luj** | rar chov; Qav chov jang |
| **chu'qa'** | QIn'a' janmey tu'qa' |
| **choH** / **Qaw'** | ra', URL pagh API ngoq choH; QIn'a' teq |

<h2 id="add-server">chel / choH 'aghtaHghach</h2>

**lo'wI' ta'** **MCP QIn'a' yIchel** poSmoH (taHbogh QIn'a'vaD **MCP QIn'a' yIchoH**):

| Doch | Del |
|------|-----|
| **pong** | 'anglu'bogh ID |
| **qeng** | **stdio (naDev Qu')** · **HTTP (Hop)** · **SSE (HTTP qet)** — `sse` qeng Streamable HTTP 'oH; `/sse` yIchelQo'. session header SeH EYAS. |
| **ra'** / **mu'mey** | stdio neH: Qu' (`npx`) 'ej 'el vegh mu'meyDaj |
| **URL** | HTTP / SSE neH: Daq (`/sse` Hutlh) |
| **API ngoq (DuH)** | HTTP / SSE neH: Bearer token rur ngeHlu' |

tetlhvo' pagh nagh beQvo' ghoS OAuth lo'taHvIS 'elbogh QIn'a'mey; OAuth DuH ghajbe' 'aghtaHghach.

<h2 id="catalog">tetlh</h2>

| SeHwI' | Del |
|--------|-----|
| Segh SeHwI' | **Hoch (N)** 'ej Hoch Segh |
| **chel / chellu'ta'** | wa' Qeq, pagh tu'lu'ta' |
| **taghmeH Dev** / **taghmeH Dev yISo'** | nobwI' Devmey poSmoH |
| ngoq 'aghtaHghach | **yIchel 'ej yIrar**pa' poQlu'bogh ngoqmey |
| chaw' ghItlh | *… chaw'. latlh Qu' 'oH — EYAS MIT 'oHtaH.* |

chIm Qap tetlh: *MCP QIn'a' Hutlh* — **tetlh yInej**.

<h3 id="memory-store-servers-are-blocked">qawHaq ngaSwI' QIn'a'mey botlu'</h3>

EYAS Hur cha'DIch qawHaq polbogh MCP QIn'a' Hoch patvaD yIn laD/ghItlh Hal moj. vaj Hoch patvaD botlu' QIn'a'meyvetlh — API nobwI'pu', Claude Code, Grok CLI, Kimi CLI je. qawHaq ngaSwI'meyDaj'egh lo'taHvIS neH qawHaq laD ghItlh je EYAS; latlh qawHaq qemmeH wa' He tlhap yIlo' (**SeHmey → pat → De' vIH → De' yItlhap**, [De' tlhap](/docs/tlh/admin/data-port/)).

qawHaq ngaSwI' 'oH:

- tetlh Dochmey **Memory** (Sov mIr QIn'a'), **Qdrant**, **Obsidian**. **lo'laHbe' — EYAS Hur qawHaq** bIngDaq tetlhlu', **chel** chu'Ha'lu', QIj mach, 'ej **De' vIH yIghoS** Degh tlhej.
- ghop chellu'bogh QIn'a', ra'Daj pagh mu'meyDaj Sovlu'bogh qawHaq boq pagh Qap teywI' pongchugh: MCP qawHaq QIn'a' (`@modelcontextprotocol/server-memory`, `mcp-server-memory`), MCPVault (`@bitbonsai/mcpvault`, `mcpvault`), Obsidian MCP QIn'a'mey (`mcp-obsidian`, `obsidian-mcp`, `obsidian-mcp-server`), Basic Memory, Mem0/OpenMemory, 'ej perlu'bogh tetlh Dochmey boqmey (`mcp-server-qdrant` rur). chovnatlh retlh mu' potlhbe'. boq Qap teywI' pongmey neH rapmoHlu', 'ang pong not — "memory" *ponglu'* neHbogh QIn'a' motlh chellu'.
- mu'vo', `--flag=value`vo', env ngaQvo', ra' Hevo', pagh `file://` URLvo' 'avlu'bogh pa' 'oSbogh QIn'a': latlh jan qawHaq Dotlh je (`~/.claude`, `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, `~/.codeium`, OpenCode pa'mey, `ai-memory` pa'mey, Obsidian vault, `security.foreignMemoryPaths` Dochmey), EYAS De' pa''egh (vault, De' pa', ngoqmey — ja'chuq vum pa'mey chaw'lu' taH), pagh EYAS ghajbogh CLI juHmey. Obsidian vault pagh `data/vault` 'oSbogh Filesystem QIn'a' botlu'; motlh Qu' pa' 'oSbogh QaQ. `data/mcp-servers/`vo' Qapbogh QIn'a'mey — naDev lutlhIl `config/mcp.yaml` — QIn'a' ngoq 'oH, qawHaq 'oHbe', chaw'lu' (He teH luchovlu': naDevvo' vaultDaq rarbogh rar botlu' taH).

**nuq qaS.** tetlhvo' chel, ghop chel, pagh rurbogh SeHDaq QIn'a' choH — lajQo'lu', mughlu'bogh QIn tlhej, 'ej pagh pollu'. bot tu'lu'pa' cherlu'bogh QIn'a'mey teqlu'be': taghDI' **bot** per Suq, tagh not, 'ej `mcp_*` janmeychaj patDaq ghoS not. **Qap** qachDaq **bot: qawHaq ngaSwI'** Degh 'anglu', meq 'ej De' tlhap rar tlhej. QIn'a' per chut DaH ghobe'chugh (rur: `security.foreignMemoryPaths`vo' pa' teqlu'), veb taghDI' bot Dotlh mej. qawHaq ngaSwI' 'oHbogh `config/mcp.yaml` Dochmey buSHa'lu', logDaq Qagh tlhej.

**vIHmoH.** Qapbogh Memory, Qdrant, Obsidian, MCPVault QIn'a', 'ej vault pagh latlh jan qawHaq 'oSbogh Hoch QIn'a' — lIngmey tu'lu'bogh chaH chIl. Qubbogh 'oH: De' tlhap lo'taHvIS wa'logh qawHaqvetlh EYASDaq yIqonqa'.

**API (rarwI'pu').** `GET /api/v1/mcp/servers` Hoch QIn'a'vaD `blocked: 'memory_store' | null` ngaS (Dotlh `blocked`). `POST /api/v1/mcp/servers`, `PUT /api/v1/mcp/servers/:id`, `POST /api/v1/mcp/registry/:id/install`, `POST /api/v1/mcp/servers/:id/refresh` — `409 {error, code: 'memory_store_blocked'}` jang; `POST /api/v1/mcp/servers/:id/test` — `{ok: false, code: 'memory_store_blocked'}`. tetlh Dochmey `memoryStore: true` ghaj.

---

<h2 id="cli-mcp-tool-parity-grok--kimi">CLI MCP jan rap (Grok / Kimi)</h2>

EYAS janmey lo'chuq API qoD nobwI'pu' je. **juH CLI** nobwI'pu'vaD:

| nobwI' | chay' |
|--------|-------|
| **Claude Code** | qoD MCP QIn'a', pong `eyas`, `mcp__eyas__<pong>` rur ra'lu'. bIng stdio rarwI' lo'be', vaj rarwI' tagh chov'egh poQbe'. Claude Code laDbogh MCP QIn'a' wa' neH 'oH. |
| **Grok CLI / Kimi Code CLI** | stdio MCP QIn'a' + loopback rarwI' (`/api/v1/internal/cli-mcp/tools/list` 'ej `/tools/call`), Hoch mIwvaD pegh; ACP `session/new` `mcpServers` Suq, vaj CLI rap ToolExecutor janmey ra'laH. rarlaHbogh MCP QIn'a' wa' neH 'oH: juH Qu' je MCP QIn'a'mey laDbe'lu' ([nobwI'pu'](/docs/tlh/ai/providers/#grok-cli-and-kimi-code-cli)). |

naDev MCP juH 'oHbe' OpenCode: `opencode_run` Qu' qoDDaq EYAS qawHaq plugin `memory_search` / `memory_expand` nob ([bIng](#tool-names-per-host) [OpenCode](/docs/tlh/automation/opencode/) je yIlegh).

**CLI 'Iv EYAS janmey Suq.** cha' rarwI'vaD wa' chut: ghoqwI' He qoDDaq Hoch EYAS jan — **janmey** tetlhDaj `memory_search` `memory_expand` je (tetlh chIm — Hoch jan), **nIH** ja'chuqDaq `run_specialist`, `delegate_to_agent`, `handoff_to_colleague`, `propose_team` Hutlh — CLI janDaj'egh chaw'lu'bogh rap ghajbogh janmey **ghobe'**: `read_file`, `grep`, `glob` je (reH chaw'lu' CLI laDmeH janmey), ghoqwI' tetlh ghItlh chaw'taHvIS `write_file` `edit_file` je, 'ej shell chaw'taHvIS `run_command`, `git_status`, `git_diff` je. chaHvaD, mIw pa'meyDaq shell teywI' janmeyDaj'egh lo' CLI, [kernel teywI' Hung](/docs/tlh/ai/providers/#kernel-file-sandbox) qawHaq He chut je bIngDaq. CLI rapDaj chaw'lu'be'chugh, rarwI' lo'taHvIS EYAS jan noblu' — `run_command` Hutlhbogh tetlhDaq `git_status` `git_diff` je. CLI ghItlh, shell, web janmey'egh ngaQmoH ghoqwI' **janmey** tetlh je ([ghoqwI'pu' — janmey](/docs/tlh/agents/configure/#tools--constraints) yIlegh). EYAS Internet janmey (`browser_*`, pollu'bogh sessionmey `browser_totp` je), `agent_browser_*`, `browser_use_*`, `opencode_*` je Suq CLI patmey. EYASDaq Qap chaH, API patmey rur Hub lojmIt, chaw'mey, chaw' mIwmey, jan He je bIngDaq. GrokvaD KimivaD je, Hoch mIw rar jan He QIn'a'Daq pol: `tools/list` chaw'lu'bogh janmey neH 'ang, `tools/call` latlh lajQo' — Hub lojmIt tlhoblu'pa', vaj chaw' chenmoH not — 'ej mIw jan tlheghDaq **lajQo'lu'** rur 'ang lajQo'. CLI pat mu'tlheghDaq jan tetlh CLI janmey'egh chaw'lu'bogh tammoHbogh EYAS janmey pongbe'.

jang: rap jan Daq legh ngoq CLImey 'ej web ghoqwI' He je — janmey rap chenmoHbe'. Claude CodeDaq Hoch rarwI' jan ra' ja'chuq, Qu'Daj, jang (mIw), Qap je qeng, vaj latlh nobwI'pu' rur qawHaq nej **wa' jangvaD 3 ra'** 'oH, ja'chuq Qu'Daq, SeghDaq, qo' qawHaqDaq je ngaQtaH qawHaq jangmey, 'ej bejlu'bogh QapvaD jan Qapmey ghoSlu'. ja'chuq Hurvo' tlhob chIm ja'chuq IDvaD ghoSlu'be'. Grok 'ej Kimi ghoqwI'pu' `memory_search` / `memory_expand`, Qu' nav, ghItlhmey, nej, 'ej latlh EYAS janmey SIch. QaHwI' pat ja' je: EYAS qawHaq 'oH qawHaq wa' neH'e', 'ej QIn'a'vam `memory_search` / `memory_expand` nob.

<h3 id="how-the-bridge-is-secured">chay' rarwI' Hublu'</h3>

- Hoch jang mIw peghDaj Duj ghaj (192 bit).
- De'wI'Daq qon EYAS: pegh 'Iv ja'chuq, ghoqwI', Qu', mIw, Qap je ghaj; mIw Qoylu''a' (ja'chuq pagh He ja'chuq) pagh nIteb 'oH'a' ('em Qap; Qoylu' per ghajbe'bogh mIw nIteb rur toghlu'); 'ej taHqa'lu'bogh Qap ta'pu'bogh ra'mey tetlh. QaHwI' Qap pegh 'ang neH; ngeHbogh Doch pagh latlh ja'chuq, Qu', lo'wI'vaD jan ra' Qap 'e' chaw'be'.
- mIw rInDI' (rIn, luj, mev, woD) pegh Qawlu' SIbI', 'ej Qav lo' ret 2 rep Hegh — vaj EYAS janmeyDaj pol mIw tIq vumtaHbogh.
- latlh Daq Hurvo' proxy ghoSbogh tlhob lajQo'lu', pegh lugh ghajchugh je.
- rarwI' jan ra'mey Claude Code jan ra'mey API nobwI'pu' jan mIw'egh je rurqu' wuqlu': wa'DIch jan tetlh chov (ghoqwI' tetlh Hurbogh jan lojmIt retlh **lajQo'lu'**, vaj chaw' loS chenmoH not), ghIq EYAS [Hub lojmIt](/docs/tlh/admin/security-privacy/), 'ej nIteb mIwvaD nIteb vang patlh; ghoqwI' rur chaw' chovmey Qap. Qoylu'bogh ja'chuqDaq pagh He ja'chuqDaq lojmIt chaw'bogh ra' Qap — chaw' poQ per ghajbogh jan chaw' loS tetlhDaq loSbe'choH Grok pagh Kimi 'oHmo' pat neH — 'ej lojmIt vIHmoHbogh ra' chaw' chaw' 'ang, ja'chuq mevmoHbe'taHvIS. nIteb QapDaq **ghuH** pagh **chaw'** Seghbogh ra' chaw' loS, 'ej vIHmoHlu'bogh ra' reH ghot loS, **auto**Daq je (ngo', Grok KimiDaq tlhoblu'be'taHvIS Qap). QaptaHbogh Hub lojmIt Hutlhchugh, Hoch rarwI' ra' lajQo'lu'. mIw pa'mey Sov rarwI' De'wI'Daq — ja'chuq pa'mey Hoch, wa'DIch neH ghobe' — vaj chaHDaq Qap EYAS teywI' janmey, 'ej tlhob pa'mey Daj pong not.
- rarwI' EYAS jan lajQo'lu'DI' pagh chaw' loSDI', ja'chuqDaq jan tlhegh rapDaq ghoS jang, chaw' loS tetlhDaq Dochvetlh tlhej. bejlu'bogh nIteb QapDaq, CLI mIw rInDI' chaw'vetlh Qap mevmoH (**chaw' loS**), CLI janmey'egh chaw' rur; chaw'lu'DI' Qap taHqa' 'ej chaw'lu'bogh ra' neH wa'logh chaw'lu'.
- Qap wa'DIch ta'pu'bogh EYAS jan ra' nIDqa'bogh taHqa'lu'bogh pagh nIDqa'lu'bogh Qap, Qappa' lajQo'lu', 'ej tlhegh **juSlu'** 'ang — *already executed on the original run — duplicate side effect prevented*. latlh ngoQmey ghajbogh jan rap Qap taH. GrokDaq, EYAS jan tlhegh jan Suqbogh ngoQmey qon (`use_tool` `tool_input`), Grok ngaSwI' ghobe', vaj cha'logh ra' Sov taHqa'lu'bogh Qap. lIngbogh Grok CLIDaq nob chov tob; ra'meyvam chay' ja' Kimi QapwI' net, wej qachDaq chovlu'be'.
- qawHaq janmey (`memory_search`, `search_memory`, `memory_expand`, `search_knowledge`, `get_page`, `read_team_memory`) jangmey, Qagh ghItlhchaj je, So' pegh chut, CLI Suqpa' — mu'tlheghDaq qawHaq rur: reH Hop CLI nobwI', 'ej choHlaHbe' QaHwI' ngeHbogh vay'. Claude Code qoD EYAS janmeyDaq So' rap Qap. nej lujchugh, jang pollu' (*Error: memory tool result withheld (privacy scan failed)*). latlh janmey jangmey choHbe'lu'. [nuqDaq So'lu'](/docs/tlh/admin/security-privacy/#where-masking-applies) yIlegh.
- cha' qoD He neH web 'el SuD: `/api/v1/internal/cli-mcp/tools/list` 'ej `/api/v1/internal/cli-mcp/tools/call`. Hoch latlh qoD He 'el poQ taH.

QaHwI' EYAS Qap rap (Bun) lo', lIng DaqDajvo', vaj Docker ghItlhmeyDaq Qap je; QaHwI' tu'meH `EYAS_INSTALL_ROOT` lo'be'lu'.

<h3 id="boot-self-test">tagh chov'egh</h3>

EYAS taghDI', rarwI' chov tlhob naQ Hevo' — QaHwI' ra' rur. Qap: log *CLI tool bridge self-test passed*. luj: ghuHmoHwI' — *CLI tool bridge self-test failed — Grok/Kimi turns cannot reach EYAS tools (memory, board, …)* — meq tlhej; tagh taH, 'ach Grok Kimi je EYAS jan Hutlh Qap. chu' lIngDaq, lIng pIn'a' rInpa' chov mImlu' (info log), 'ej veb taghDI' Qap.

| ghuHmoHwI' meq | nuq yIta' |
|----------------|-----------|
| `tools/list returned HTTP 401 … Authentication required` | QaptaHbogh chenmoH rarwI' chaw' ghajbe'. yIchu'moH pagh yIchenqa', ghIq yItaghqa'. |
| `stdio MCP server not found at …` | chenmoH `dist/stdio-mcp-server.js` ghajbe'. `bun run build` lo' yIchenqa' (chovnatlhvamvo' chenlu'bogh Docker ghItlhmey ngaS), ghIq yItaghqa'. |
| `HTTP 404` | janmey pat chu'Ha'lu', vaj EYAS janmey nobbe'. |

<h3 id="outside-mcp-clients">Hur MCP rarwI'pu'</h3>

EYAS MCP QIn'a' (`/api/v1/mcp/tools/call`) rarwI'pu' EYAS ja'chuq ghajbe'. qawHaq jan ra'chaj qo' qawHaq neH laD, 90 lupDaq 3 ra' 'aqroS. [qawHaq — latlh nej](/docs/tlh/knowledge/memory/#looking-further-memory_search-and-memory_expand) yIlegh.

- **So'lu'.** Hur MCP rarwI'Daq ngeHlu'bogh qawHaq jan jangmey pegh chut So', latlh Hop Daq rur — Hur rarwI' Hoch pat QaplaH, vaj reH Hop rur toghlu'. nej lujchugh jang pollu'.
- **chovlu'.** lughbe'bogh `tools/call` porgh HTTP `400` Suq, JSON-RPC Qagh tlhej: JSON 'oHbe'bogh pagh Doch 'oHbe'bogh porghvaD `-32600` *Invalid Request*; pong Hutlhbogh pagh Doch 'oHbe'bogh `arguments`vaD `-32602` *Invalid params*. Sovbe'lu'bogh jan `404` 'ej `-32601`.

<h2 id="tool-names-per-host">Hoch juHvaD jan pongmey</h2>

EYAS janmey wa' pong ghaj (`memory_search`, `memory_expand`, …). Hoch pat juH latlh mIw tetlh:

| juH | chay' `memory_search` ra' pat |
|-----|-------------------------------|
| API nobwI'pu' (Anthropic, OpenAI, Gemini, OpenRouter, Kimi API, Ollama, LM Studio, rap Daqmey) | `memory_search` — EYAS 'egh jan Qap |
| Claude Code CLI | `mcp__eyas__memory_search` — `eyas` ponglu'bogh EYAS qoD MCP QIn'a'vo' janmey; stdio rarwI' lo'be', vaj rarwI' tagh chov'egh poQbe' |
| Grok CLI | EYAS janmey Grok jan tetlhDaj Daq tu'lu'be'. `search_tool` lo' pat jan tu'meH, ghIq `use_tool` ra': `tool_name` `eyas__memory_search`, mu'mey `tool_input`Daq. GrokDaq `memory_search` mach 'oH Grok qawHaq janDaj'e', EYAS qawHaq ghobe' — vaj Grok patvaD `memory_search` mach ra' 'e' ja'be' EYAS not. |
| Kimi Code CLI | `eyas` ponglu'bogh MCP QIn'a'Daq `memory_search`. Kimi pong mIw wej chovlu'be', vaj QIn'a' ponglu', naQ jan pong ghobe'. |
| OpenCode (`opencode_run` Qu'Daq) | `memory_search` — OpenCode qoDDaq EYAS qawHaq plugin jan, EYAS pong, Del, mu'mey je lo'. EYASDaq ra' ngeH plugin, 'ej Qu' ja'chuqvaD teH jan Qap EYAS. `memory_search` `memory_expand` je neH nob, ghItlhbogh Doch pagh. |

mIw Qapbogh nobwI' SovDI' EYAS, pat mu'tlheghDaq jan tetlh Dor wa' tlhegh chel: juHDaj tetlhlu'bogh janmey chay' ra' — Claude CodeDaq, EYAS MCP QIn'a'vo' EYAS janmey ghoS 'ej `mcp__eyas__<pong>` rur ra'lu'. qawHaq Qubmey *N more notes* tlhegh je rap mIw janmey pong. API nobwI' patmey pong mach legh. pagh SeHnISlu'. ja'chuq latlh jan pong mIw ghajbogh nobwI'Daq vIHDI', mu'tlhegh cache tagh wa'logh choH (wa'logh cache Hutlh).

## latlh

- [janmey](/docs/tlh/automation/tools/)
- [OpenCode](/docs/tlh/automation/opencode/)
- [nagh beQ](/docs/tlh/ai/media/)
- [ghoqwI' SeH](/docs/tlh/agents/configure/)
- [rarmey](/docs/tlh/admin/connections/)
- [nobwI'pu'](/docs/tlh/ai/providers/)
- [De' tlhap](/docs/tlh/admin/data-port/)
