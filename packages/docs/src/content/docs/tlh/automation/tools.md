---
title: janmey
description: ra'laH laH tetlh — Qob, chaw', ghoqwI'pu'vaD nob je.
---

**nuq 'oH.** ghoqwI' ta'laHbogh ta'mey janmey 'oH: teywI' laD, ghItlh tetlh nej, Internet jan poSmoH, QIn qonwI' ngeH. EYASvamDaq tetlhlu'bogh Hoch jan yIn tetlh 'oH navvam. ghoqwI' **SeHmey** DechDaq nob Qam; naDev pong, Segh, Qob, ra' chaw' loS'a' je Dabej.

**He:** `/tools`. retlh tetlh: **janmey**. bIng pong: *ghoqwI' ta'vaD tetlh janmey.*

## ghorgh yIlo'

- ghoqwI'Daq jan IDmey Daghel pa', janmey tu'lu'bogh DaSovchugh DaneH.
- ra' botlu', 'ej Qob patlh, **chaw' nIS**'a' je DaSovnIS.
- MCP pagh rar DarararmoH, 'ej chenlu'pu'bogh janmey retlh tu'lu'bogh janmey Daleghchugh DaneH.
- ghoqwI' jan ra' Qagh reH — jan 'el pat DaSovnIS.

## motlh mIw

1. retlh tetlhDaq **janmey** yIpoSmoH (`/tools`).
2. pong pagh Del lo'taHvIS yInej, pagh Segh Qob patlh je yIwIv.
3. JSON 'el pat DaneHDI', chaw'Daq **pat yI'ang** yIpoSmoH.
4. ghoqwI' **SeHmey** DechDaq **janmey (vuD lo')** DochDaq jan ID yIghItlh. [SeH](/docs/tlh/agents/configure/) yIlegh.
5. Qapchu'DI' Qob ra'mey [Hub lojmIt](/docs/tlh/admin/security-privacy/) ghoS reH — chaw' nob tetlh tlhegh ghobe'.

## laHmey

**janmey** 'ej **chaw' nIS**bogh janmey mI' 'ang nIv. Hoch chaw' 'ang: ID, Del Hom, Segh Degh, Qob Degh (`green Qob`, `yellow Qob` pagh `red Qob`), 'ej chaw' poQlu'DI' SuD yan.

| Doch | Del |
|------|-----|
| jan pong | ghoqwI' SeHDaq logDaq je lo'lu'bogh ID choHbe' |
| Del | jan nuq ta' (tetlhDaq 'anglu') |
| Segh | tetlh ghom: `memory`, `knowledge`, `search`, `documents`, `board`, `shell`, `browser`, `conversation`, `communication`, `research`, `agent`, `custom` (MCP rar janmey Seghchaj'egh qem) |
| Qob patlh | **green / yellow / red** — Hub lojmIt low / medium / high |
| **chaw' nIS** | ghot chaw'pa' ra' Qapbe' QapwI' |
| 'el pat | mu'mey JSON Schema; **pat yI'ang** / **pat yISo'** |
| chaw'mey | API CASL, Hoch ra'Daq Hub lojmIt je. ghoqwI'Daj noblu'bogh jan neH QaplaH pat: latlh pong lajQo'lu' (*'&lt;tool&gt;' is not in this agent's toolset*), chaw' tlhob Hutlh, Hoch nobwI'Daq — [SeH — janmey](/docs/tlh/agents/configure/#tools--constraints) |
| Hung | janmey 'op machbogh Daq Qap |

chIm: *jan pagh tetlh.* tagh (*janmey tagh…*) tagh luj je (*janmey luj: …*) nav ghItlh rur 'anglu', chIm jIH ghobe'.

MCP janmey [MCP Servers](/docs/tlh/ai/mcp/) bIngDaq DaSeH, Hur pat pegh [rarmey](/docs/tlh/admin/connections/) bIngDaq.

<h3 id="tool-execution-log">jan Qap log</h3>

jan Qap logDaq Hoch jan ra' qonlu': jan pong motlh, 'elDaj, nIHDaj pagh Qagh ghItlhDaj, poH, 'ej ghajbogh ja'chuq, ghoqwI', bejlu'bogh Qap je.

- EYAS QapwI' Qapbogh ra'mey — API nobwI'pu'Daq, 'ej EYAS rarwI' lo'taHvIS CLI ra'bogh EYAS janmey — QapwI' qon, Hoch wa'logh.
- mIwDaj'eghDaq CLI Qapbogh janmey — Claude Code, Grok CLI, Kimi Code CLI je, shellchaj pagh teywI' laDmeychaj rur — tlhegh Suq je, pong motlh lo'taHvIS (Claude Code `Bash` `run_command` rur qonlu'). EYAS Qapbe'pu', vaj qon neH: CLIvetlhvaD EYAS chaw' chov bIngDaq Qappu'.
- tlheghmeyvam jan tobmey 'oH: Qap chovmeH naQ chovwI' lo', 'ej Self-learning ngoDmey laH ngoDmey je chaH lo' — Hoch nobwI'Daq rap.
- qawHaq 'oHbe' log: vo' EYAS qawHaqDaq pagh ghoS. qawHaqDaq jan nIH qonlu''a' — `memory.l0.captureToolResults` neH wuq — [qawHaq](/docs/tlh/knowledge/memory/) yIlegh.

[AI bej — lo'](/docs/tlh/admin/observability/#usage-tab) **janmey** tlhegh Hoch tlha'vaD rap ra'mey togh.

## Dochmey 'ej SeHwI'mey

<h2 id="catalogue">tetlh SeHwI'mey</h2>

| SeHwI' | Del |
|--------|-----|
| nej | *janmey yInej…* — pong pagh Del rap |
| **Hoch Seghmey** | wa' tetlh SeghDaq machmoH |
| **Hoch Qob mI'** | wa' Qob patlhDaq machmoH |

<h2 id="built-in-tool-groups">chenlu'pu'bogh jan ghommey (Hom)</h2>

<h3 id="coding-surface">ngoq ghItlh Daq (Hoch patvaD)</h3>

wa'DIch teywI' janmey, vaj Claude Code SDK janmey lo'be'taHvIS ngoq choHlaH **Hoch** pat (Grok, Claude API, Kimi, juH, …):

| jan | meq | Qob |
|-----|-----|-----|
| `read_file` | ghItlh teywI' laD (tlhegh offset/limit) | green |
| `write_file` | teywI' chenmoH/ghItlhqa' | yellow |
| `edit_file` | mu'tlhegh naQ tam (choH machqu') | yellow |
| `grep` | workspaceDaq De' nej | green |
| `glob` | mIw lo'taHvIS teywI'mey tu' | green |
| `git_status` / `git_diff` | laD neH legh QaHwI'mey | green |
| `run_command` | shell Hutlh Qap (chaw') | red |

ja'chuq **vum pa'mey**Daq (pagh ghoqwI' **worktree**Daq) ngaQ He'mey — pa'mey Daj ghajbe'bogh ja'chuq EYAS vum pa'Daj lo'. EYAS Qap pa' lo'be'. pegh He'mey (`.env`, `master.key`, `.ssh`, …) lajQo'lu', 'ej EYAS Hur qawHaq je — latlh jan qawHaq, Obsidian vaultmey, EYAS De' pa''egh, latlh ja'chuq vum pa' —, laDmeH ghItlhmeH je ([Hub 'ej pegh — EYAS Hur qawHaq](/docs/tlh/admin/security-privacy/#memory-outside-eyas)). qawHaq pagh pegh 'aghbogh pa' vum pa' rur qonlaHbe'lu' ([ja'chuqmey — pa'mey](/docs/tlh/daily/conversations/#working-folders)). Daqvetlh ngaSbogh neH pa'Daq — EYAS `data/` ghajbogh qach, vault ghajbogh `~/Documents` — 'avlu'bogh pa'Hommey (EYAS De' pa', Obsidian vault, latlh jan qawHaq, CLI juH, latlh ja'chuq vum pa') 'el not `grep` `glob` je, vaj vo' Sam nobbe' nej. vum pa' qoDDaq Hurvo' 'oSbogh symlink lajQo'lu', ghoSDaj tu'lu'be'chugh je (`read_file`, `write_file`, `edit_file`, `browser_upload` He'mey). teywI' naQ ghItlhqa'meH `edit_file` yIlo'.

**laD neH git, 'uy Hutlh.** `git status` pagh `git diff` 'oHbogh mu' tetlh lo'taHvIS `run_command` (pagh CLI `Bash`) ra'chugh ghoqwI' — shell metachar Hutlh, `-C` / `--git-dir` / `--no-index` Hutlh, naQ He Hutlh — `git_status` / `git_diff`Daq choH Hub lojmIt 'ej **chaw'**. chaw' tlhob Dalegh be'. `git commit`, `git add`, `ls`, metachar ghajbogh Hoch ra' je red taH pagh lajQo'lu'. `git_status` / `git_diff` janmey'egh green.

**Verify before done:** YAMLDaq `agent.verifyCommands` yISeH (rur `bun test`) Qap pIq chovmeH; luj DaH, Qagh Del tlhej ghoqwI' poSmoHqa'lu'.

**Hooks:** ToolExecutor PreToolUse / PostToolUse ghoS Hoch jan ra' (Hoch nobwI', Claude neH ghobe'). Claude Code janmey'egh Qappa' EYAS qawHaq chut chov ghoS je.

**CLI patmey teywI' janmeyDaj'egh lo'.** EYAS rarwI' lo'taHvIS ngoq ghItlh Daqvam (`run_command`, `read_file`, `write_file`, `edit_file`, `grep`, `glob`, `git_status`, `git_diff`) noblu'be' Claude Code, Grok, Kimi je, janmeyDaj'egh ghajmo': mIw pa'meyDaq Qap, Hub lojmIt, qawHaq He chut, 'ej — Claude Code shell Grok janmey jevaD — [kernel teywI' Hung](/docs/tlh/ai/providers/#kernel-file-sandbox) bIngDaq. latlh EYAS jan Hoch ghoS.

<h3 id="search-grounding">nej 'ej tob</h3>

| jan | meq |
|-----|-----|
| `list_search_sources` | teH DachenmoHpa' Halmey tetlh (per, chovnatlh, edition, qorDu', He'mey, Dotlh) |
| `get_search_context` | ja'chuqvamvaD Halmey rarlu'bogh 'ang |
| `set_search_context` | Halmey rar pagh teq (`sourceIds`, `labels`, `version`, `edition`, pagh `clear: true`) |
| `search_indexed` | FTS + vector nej **Hal ja'** tlhej; ja'chuq/Qu' rar pat; `sourceIds` / `labels` / `version` / `edition` DuH |

**odoo-family** Halmey law' SumDI' 'ej pagh rarlu'DI', chovnatlhmey DuD rarbe' janmey 'ej **`needsPin`** nob. [nej — chovnatlh law' rar](/docs/tlh/daily/search/#multi-version-pin-which-tree-may-the-agent-use) yIlegh.

<h3 id="memory">qawHaq</h3>

| jan | meq |
|-----|-----|
| `memory_search` | EYAS qawHaq yInej — Dovmey, vItmey, vault ghItlhHommey, tlhaplu'bogh ja'chuqmey — juH CLI qawHaq not. laD neH; ja'chuq Qu', SeghDaj, qo' qawHaq je ngaQmoH EYAS; `scope` pagh Qu' mu' buSHa'lu'. `memory_expand`vaD IDmey nob. |
| `memory_expand` | wa' Sam ID lo' yIpoSmoH (`vt:`, `gs:`, `en:`, … — `memory_search`vo' pagh taHbogh qawHaq tlheghvo'), rap Qu' ngaQ qoDDaq |
| `search_memory` | `memory_search` pong latlh, rap Qu' ngaQ tlhej |
| `save_memory` | teqlu' — pagh ghItlh. nIteb qawHaq qon EYAS; qawHaq ghItlh'eghbe' ghoqwI'pu' not |

ghoqwI' **janmey** tetlh nuq ja' 'ach reH lo'laH `memory_search` `memory_expand` je, 'ej Hoch juHDaq pat Suqbogh qawHaq janmey wa' neH chaH — API nobwI'pu', Claude Code, Grok, Kimi, 'ej `opencode_run` Qu' qoDDaq OpenCode. Hoch nobwI'Daq wa' Huch lo' wej nej/poSmoH janmey: **wa' jangvaD 3 ra'**. EYAS ja'chuq Hurbogh ra'wI' — Hur MCP rarwI', pagh Qu'vaD EYAS taghbe'bogh OpenCode ja'chuq — qo' qawHaq neH laD, 90 lupDaq 3 ra'. `memory_block_read` `memory_block_write` je teqlu': tetlhmeyDaq pollu'pu'bogh EYAS qawHaqDaq wa'logh cha'loghlu' 'ej `memory_search` lo'taHvIS tu'lu'; tetlhDaj pongbogh ghoqwI' chaH Suqbe' neH. Hoch ngeHDaq (API nobwI'pu', CLI rarwI'mey, Hur MCP rarwI'pu', OpenCode) pegh chut So' qawHaq jan jangmey. [qawHaq](/docs/tlh/knowledge/memory/) yIlegh.

<h3 id="browser">Internet jan</h3>

Playwright jan chIm (`browser_*`) nab print mIw rap Chromium lo'. CSS rarbe' `browser_snapshot` mI'mey yIlo'. jaHDI' pagh chegh DI' Hegh mI'mey `snapshotId` je — snapshot chu' yIchenmoH. **EYAS ghajbogh** profileDaq taH cookies (`data/browser/profile`, pagh `EYAS_BROWSER_USER_DATA_DIR`) — jaj Chrome profile not (Default profile CDP bot Chrome 136+). [ghItlhmey](/docs/tlh/knowledge/documents/)Daq ghoS qemlu'bogh teywI'mey.

| jan | meq |
|-----|-----|
| `browser_navigate` | URL poSmoH; pegh/metadata juHmey bot **SSRF** Hung |
| `browser_snapshot` | 'el Sor + mI' ghajbogh tetlh + `snapshotId` |
| `browser_click` / `browser_fill` / `browser_hover` / `browser_select` | mI' pagh CSS lo'taHvIS ta' |
| `browser_tabs` | `list` / `open` / `switch` / `close` (Qav Dech SoQmoHlaHbe'lu') |
| `browser_back` / `browser_wait` | qun chegh; selector, URL, tagh pagh poH loS |
| `browser_dialog` | veb `alert`/`confirm`/`prompt`vaD laj/lajQo' SuvmoH |
| `browser_upload` | teywI' Doch — workspace He'mey pagh ghItlhmey IDmey |
| `browser_evaluate` | JavaScript **navDaq** (Node ghobe'); JSON jang mach |
| `browser_download` | veb qem → ghItlhmey, ja'chuqvaD rar |
| `browser_storage` | Playwright `storageState` pol/tagh (cookies + Halmey) |
| `browser_replay` / `browser_action_cache` | pollu'bogh locator Qapqa' (LLM Hutlh). Qu' pagh vaultDaq JSON. tebmey not |
| `browser_totp` | peghmey / macOS Keychainvo' TOTP → `browser_fill`. yellow. not nob ngoq |
| `browser_screenshot` / `browser_get_content` / `browser_close` | mIllogh, ghItlh, Qap mev (taH profile) |
| `agent_browser_status` / `agent_browser_run` | agent-browser sidecar chuplu'bogh (`@e1` rar, Apache-2.0) — [Browser Use](/docs/tlh/automation/browser-use/) |
| `browser_use_status` / `browser_use_exec` | ngo' Python CLI sidecar ([Browser Use](/docs/tlh/automation/browser-use/)) |
| `opencode_status` / `opencode_run` | DuH OpenCode ngoq sidecar ([OpenCode](/docs/tlh/automation/opencode/)). status green; run red + chaw'. ja'chuq qoDDaq neH Qap `opencode_run`. Qu' qoDDaq, laD neH rap `memory_search` / `memory_expand` lo'taHvIS EYAS qawHaq laDlaH OpenCode, ja'chuq QuDaq ngaQ, 'ej ra'bogh mIw 3 ra' Huch lo'chuq; EYAS qawHaq ghItlhlaHbe'. |

EYAS Internet janmey, `agent_browser_*`, `browser_use_*`, `opencode_*` je EYAS rarwI' lo'taHvIS CLI patmeyDaq (Claude Code, Grok, Kimi) ghoS, API patmey rur lojmIt, chaw'mey, jan He je bIngDaq.

<h3 id="studio">mIw pa' (DuH pat)</h3>

juH QapwI'mey, nagh beQ ghobe'. [mIw pa'](/docs/tlh/studio/) yIlegh.

| jan | meq |
|-----|-----|
| `hyperframes_*` | HTML chenmoH → choHbe'bogh MP4 ([Hyperframes](/docs/tlh/studio/hyperframes/)) |
| `videouse_*` | mIllogh + EDL → MP4 ([Video Use](/docs/tlh/studio/videouse/)) |

jIH Qum chIch mIw pa' jan 'oHbe'. Recordly AGPL tlhej [cheltaHghachmey](/docs/tlh/admin/extensions/#recordly) bIngDaq — `recordly_*` janmey tu'lu'be'.

<h3 id="email">QIn (qonwI' → chaw' → ngeH)</h3>

| jan | meq |
|-----|-----|
| `email_create_draft` | juH qonwI' chenmoH |
| `email_approve_draft` | qonwI' chaw'lu' per |
| `email_send_draft` | chaw'lu'chugh **neH** ngeH |

<h3 id="odoo">Odoo (DuH pat)</h3>

**yIn EYAS** (JSON-RPC):

| jan | meq |
|-----|-----|
| `odoo_search_tasks` | Qu'mey nej (laD law') |
| `odoo_get_task` | wa' Qu' qem |
| `odoo_message_post` | chatter QIn ngeH |
| `odoo_write_task` | bejlu'bogh ghItlh |

**juH Hal tetlh** (ngoq tlhegh):

| jan | meq |
|-----|-----|
| `odoo_search_model` | juH PythonDaq `_name` / `_inherit` tu' |
| `odoo_search_field` | `fields.*` nobmey tu' |
| `odoo_search_xml_id` | XML qon IDmey tu' |

Sormey vo': ja'chuq/Qu' **rar** → nej Halmey (`family: odoo`) → `EYAS_ODOO_SOURCES_JSON` / `EYAS_ODOO_SOURCE_PATHS`. DuH jan SeHwI'mey: `label`, `labels`, `sourceIds`, `version`, `edition`. Hal ja': `[source:odoo-src:label:file:line]`.

laH: `coding/odoo/odoo-dev-chain`. yIn pegh [rarmey](/docs/tlh/admin/connections/) lo'taHvIS (Odoo Segh). chovnatlh law' UI: [nej](/docs/tlh/daily/search/) · [Qu'mey](/docs/tlh/daily/projects/) · ja'chuq **Halmey** Dech.

<h3 id="connections-inventory">rar tetlh</h3>

| jan | meq |
|-----|-----|
| `connections_list` / `connections_catalog` | tetlh + tetlh Dun |
| `connections_test` | pIv chov |
| `connections_propose` | ghot chaw'meH rar chup |

<h3 id="media">nagh beQ (DuH pat)</h3>

Magnific, Higgsfield, fal pagh HeyGen [nagh beQ](/docs/tlh/ai/media/) bIngDaq yIrar. vagh jan wa' Suq ghoqwI'pu', nobwI' pat Hoch wa' ghobe'. ghogh nach / QumwI' mIllogh: `provider: heygen` yIrar.

| jan | meq | Qob |
|-----|-----|-----|
| `media_generate` | mIllogh / mIllogh vIH / ghogh / Dun / choH / 3D tagh | yellow |
| `media_wait` | Qu' rInpa' tlhob | yellow |
| `media_catalog` | Seghvam patmey tetlh | green |
| `media_balance` | Huch ratlhbogh | green |
| `media_history` | Qu'mey qen | green |

rInbogh teywI'mey [ghItlhmey](/docs/tlh/knowledge/documents/)Daq 'el 'ej chenmoHbogh mIwvaD rar.

<h3 id="other-groups">latlh ghommey tetlhlu'bogh</h3>

patchaj chu'lu'DI' tetlhDaq 'anglu': **board** janmey, **conversation** janmey, **document** janmey, **knowledge** janmey, **research** janmey, **schedule** janmey, **channel** ngeH/tetlh, **A2A delegate**, 'ej DuH **Google Docs**.

ghoqwI' He (ghoqwI' pat tetlh; tetlhvamDaq cha'logh ghobe'):

| jan | meq | Qob |
|-----|-----|-----|
| `run_specialist` | chu'bogh laHwI' chenmoH 'ej Del loS. latlh pong: `delegate_to_agent`. Hoch nobwI'Daq laHwI'pu' QapmoHmeH mIw wa' 'oH — Claude Code ghoqwI'Hom jan'egh noblu'be'. | green |
| `handoff_to_colleague` | latlh ghoqwI' juH thread poSmoH 'ej SIbI' Qap tagh, ra' ngoQ rur; thread vumtaHvIS lajQo'lu'. | green |
| `assign_task` | chu'bogh ghoqwI'vaD poH Hutlh Board chaw'. | green |
| `propose_team` | Hutlhbogh Seghmey, Qu' tIn pagh ghom tlhob chaw'. | yellow |
| `propose_agent_creation` | chu' laHwI' chovnatlh chup. | yellow |

[ghommey Segh je](/docs/tlh/agents/teams/) yIlegh.

<h3 id="cli-mcp-parity">CLI MCP rap</h3>

**Grok CLI** pagh **Kimi Code CLI**Daq Qap ghoqwI'pu'DI', stdio MCP rarwI' chel EYAS, vaj in-process / Claude Code ja'chuqmey rur ToolExecutor janmey rap Suq juHmeyvam — qawHaq janmey je. Hoch mIw peghDaj ghaj, De'wI'Daq ja'chuq, ghoqwI', Qu', pa'mey, jan He je rarlu'; rarwI' ra'mey Hub lojmIt ghoS taH. cha' rarwI'Daq — Claude Code in-process EYAS MCP De'wI' 'ej Grok/Kimi rarwI' — ghoqwI' **janmey** tetlh `memory_search` / `memory_expand` je neH Suq CLI (tetlh chImDI' Hoch jan), nIH ja'chuqDaq ghoS janmey pagh, 'ej CLI rapDaj'egh chaw'lu'bogh janmey not (`read_file`, `grep`, `glob` reH; tetlh ghItlh chaw'taHvIS `write_file`, `edit_file`; tetlh shell chaw'taHvIS `run_command`, `git_status`, `git_diff`). CLI ghItlh, shell, web janmey'egh ngaQmoH tetlhvetlh je ([ghoqwI'pu' — janmey](/docs/tlh/agents/configure/#tools--constraints) yIlegh). latlh jan ra' lajQo'lu' 'ej **lajQo'lu'** rur 'anglu'. Hoch taghDI' rarwI' chov EYAS 'ej Grok/Kimi EYAS janmey SIchlaHbe'chugh ghuHmoH. Hoch juH latlh jan pong mIw lo' (Grok: `use_tool` `eyas__<name>` tlhej). [MCP](/docs/tlh/ai/mcp/#cli-mcp-tool-parity-grok--kimi) yIlegh.

## latlh

- [ghoqwI'pu' — janmey SeH](/docs/tlh/agents/configure/)
- [ghommey Segh je](/docs/tlh/agents/teams/)
- [Hub lojmIt](/docs/tlh/admin/security-privacy/)
- [rarmey](/docs/tlh/admin/connections/)
- [laHmey](/docs/tlh/automation/skills/)
- [MCP Servers](/docs/tlh/ai/mcp/)
- [OpenCode](/docs/tlh/automation/opencode/)
- [nagh beQ](/docs/tlh/ai/media/)
- [mIw pa'](/docs/tlh/studio/)
- [Browser Use](/docs/tlh/automation/browser-use/)
- [cheltaHghachmey](/docs/tlh/admin/extensions/#recordly)
