---
title: mu' tetlh
description: Qu' mu'mey.
---

| mu' | Del |
|-----|-----|
| ghoqwI' | SeHlu'bogh AI ta'wI' |
| jup | potlh pagh ghom ghoqwI' bIjatlh; jup HochvaD wa' home thread ('em tlhegh **juppu'**) |
| potlh | lIngvo' reH Qapbogh juppu' (jIH QaHwI' + pat QanwI') |
| laHwI' | nIH QapwI'; jup Hoch chenmoHlaH (`run_specialist`) |
| home thread | jup HochvaD wa' taH ja'chuq |
| laH | Markdown mIw tev |
| laH chup | rapbogh laH, ja'chuq tlheD loS — **yIlo'**, **DaH ghobe'**, pagh joH/SeHwI' **yIchu'Ha'** |
| jan | ra'laH laH |
| ghItlh Daq | pat-Hutlh tev janmey (`read_file`, `edit_file`, `grep`, …) EYAS ghaj, wa' nobwI' SDK ghajbe' |
| Worktree | nIteb git vum Sor, cha'logh ghItlh laHwI'pu'vaD (`.eyas-worktrees/`) |
| chov ra'mey | SeHlu'bogh lint/chov mIwmey — ghoqwI' Qappu'DI' LLM chovwI' pa' Qap |
| jan tlhegh | PreToolUse / PostToolUse ja'wI', Hoch jan QapDI' |
| jan mej | jan tetlhDaq jan ra' Dotlh rIn: *Qapla'*, *luj*, *lajQo'lu'*, *chaw' poQ* pagh *juSlu'* (mIw nom rInchugh *mej Sovbe'lu'*). jan jangqa'DI' neH SuD tlhegh; Hoch nobwI'Daq rap ([jan tetlh](/docs/tlh/daily/conversations/#tool-trace)) |
| jan Qap log | Hoch jan ra' qonlu'ghach: pong motlh, 'el, nIH pagh Qagh, poH, ja'chuq, ghoqwI', Qap je. mIwDaj'eghDaq CLI Qapbogh janmey ngaS je (Claude Code `Bash` `run_command` rur qonlu'). naQ chovwI' Self-learning je laD; vo' qawHaqDaq pagh ghoS ([janmey](/docs/tlh/automation/tools/#tool-execution-log)) |
| Qu' nav | vum tlha' Daq |
| ja'chuq | QIn He |
| mIw rIn | chay' ja'chuq mIw rIn, jang bIngDaq wa' Degh: rInchugh Degh pagh; pagh *mIw veH paQlu'pu'*, *mej veH paQlu'pu'*, *lajQo' model*, *jan Huch natlhlu'pu'*, *mevlu'pu'*, *luj* pagh *chaw' loS*. DaH ghItlhlu'bogh jang reH pollu' ([mIw rIn](/docs/tlh/daily/conversations/#turn-outcome)) |
| qawHaq patlh | working→episodic→vault→archive |
| tetlh tlhol (L0) | EYAS polbogh Hoch QIn cha'DIch qon — mu' mu' rap, machmoHlu'bogh — 'ej jan nIH pat meq je, chu'chugh chu'meyvetlh. qawqa' neH lo'taHvIS patmey ghoS; qonlu'bogh jan nIH meq je qawqa'lu' not. chu': `memory.l0.enabled` ([tetlh tlhol](/docs/tlh/knowledge/memory/#the-raw-record)) |
| voq patlh | 'Iv qawlu'bogh ghItlh ghItlh: *owner*, *derived*, *peer*, *ingested* pagh *quarantined*. vIt pagh naQ voqqu'lu' not; chenmoHbogh ghItlh 'ar voqlu'. qawqa'Daq ngI': 1 / 1 / 0.3 / 0.6 / not ([voq: 'Iv ghItlh](/docs/tlh/knowledge/memory/#trust-who-wrote-it)) |
| Qu' veH | ja'chuq leghlaHbogh qawHaq: Qu'Daj qawHaq, Qu' SeghDaj qawHaq, qo' qawHaq je — latlh Qu' qawHaq not. De'wI'Daq ngaQmoH EYAS, qawqa'vaD Hoch qawHaq janvaD je; pat ngeHbogh buSHa'lu' ([ja'chuq 'Iv qawHaq leghlaH](/docs/tlh/knowledge/memory/#which-memory-a-conversation-can-see)) |
| qawHaq ID | qawqa'lu'bogh tlhegh ID, `memory_expand` poSmoHbogh. ID tagh 'ay'Daj ngu': `vt:` vault ghItlhHom, `gs:` naQ, `ft:` vIt, `en:` Doch, `ep:` wanI' qawHaq, `rw:` tetlh tlhol (ngo' QIn). ngoqmeyvam lo'taHvIS nobta'lu'bogh qawHaq togh bejlaH |
| qawHaq 'ay' | teqlu': ngo' `memory_block_*` janmey lo'taHvIS ghoqwI'pu' laDbogh/ghItlhbogh boq QIn; chu'choHDI' EYAS qawHaqDaq wa'logh cha'loghlu' |
| vault | Markdown poH nI' Sov |
| Capture run | wa' tlheD 'em nI' qawHaq tev; Hoch rIn `memory_capture_runs` tetlh ghItlh. chu': `memory.capture.enabled` |
| nabmey | law' artboard `.dc.html` + `canvas.json`, Claude Design tej EYAS QapwI' |
| nobwI' | LLM 'em pat |
| nobwI' Segh | `cli` (Claude Code CLI, Grok CLI, Kimi Code CLI), `local` (Ollama, LM Studio, vLLM) pagh `api` (Hoch Hop API). Qu' pong retlhDaq nob `GET /api/v1/model/providers`, 'ej lo'taHvIS CLI nobwI' ghov **nobwI'pu'** nav lIng pIn'a' je ([nobwI'pu'](/docs/tlh/ai/providers/#built-in-providers)) |
| ngaQlu'bogh pat | ja'chuq Qapbogh 'ej polbogh pat. pongbe'bogh ja'chuq chu' wa'DIch QInDaq lIng motlh Suq; ghIq motlh DachoHDI' vIHbe'. pat wIvwI'Daq DawIvbogh pat So' tammoHlu' not: lo'laHbe'lu'choHchugh, QIn lajQo'lu' |
| pat wIvwI' | ja'chuq Dung naQDaq SeHwI': ngaQlu'bogh pat, autom He, pagh jup motlh wIv, 'ej veb QIn 'Iv pat jang 'ej qatlh ja' |
| autom He | ja'chuq wIv: autom cherlu'bogh ja'chuq neH QInmeyDaj Seghlu' 'ej He patlhmeyDaq Helu', **He nISbe' yIchaw'** (*Allow Auto-routing*) chu'taHvIS neH |
| jup motlh | jup ghajbogh ja'chuq (bIng ja'chuq je) jupvetlh pat tlha', pagh nobbogh ja'chuq pat, pagh motlh; jup pat lo'laHbe'lu'chugh, ghItlhHom tlhej cheghqa' mIw, tamtaHvIS not |
| 'em pat | EYAS 'em Qu' (pongmey, tlhaq, qawHaq capture, Hub noHwI', tej, …) Qapbogh pat — nIteb ra' QaplaHbogh nobwI' neH, He patlh mIw ngaQ tlhej nIDlu'. He patlhDaq **retlh pat ra'mey** 'emwI' Hoch ghom nuqDaq ghoS 'ang |
| kernel teywI' Hung | Claude Code shell ra'mey Grok CLI janmey'egh je Qapbogh OS teywI' Hung (macOS Seatbelt, Linux bubblewrap), EYAS Hur qawHaq EYAS De' pegh je botbogh; Kimi Code CLI ghajbe'. `security.cliSandbox: auto \| required` |
| botmoH (nobwI' qawHaq) | qawHaq → Hoch Del nav joH ta': wa' nobwI' ghItlhbogh Hoch patvo' So', 'ej ghIq tlhabmoHlaH; pagh teqlu' |
| CLI juH | vumwI' SeH'egh rarbe', Grok CLI Kimi Code CLI OpenCode je Qapbogh EYAS ghajbogh pa' (`<data dir>/cli-homes/<provider>`); EYASvaD 'elchaj ngaS. Claude Code juH juH pol, 'elDaj neH nobchuq |
| EYASvaD 'el | EYAS CLI juH'eghvaD Grok CLI / Kimi Code CLI 'el (De'wI' ngoq, pagh GrokvaD xAI API ngoq) — juH 'el lo'be'lu' |
| nIteb chov | CLI (Claude Code, Grok, Kimi) juHvo' pagh laD 'e' chov EYAS; lujbogh mIw mev 'ej latlh patDaq vIHlu' not |
| nob chov | `bun run test:live-cli`, nobpa': EYAS lo'taHvIS Qopbogh, mIQtaHghachmey ghajbogh juHDaq Qap teH Claude Code Grok CLI je (Kimi Code CLI je, chellu'DI'), juHvo' pagh laDlu' 'ej EYAS Hur qawHaq lajQo'lu'taH 'e' tobmoHmeH. Dil Hutlhbogh 'ay'Daj juH ngeb pat lo', token lo'be' ([chay' nIteb tobmoHlu'](/docs/tlh/admin/security-privacy/#how-isolation-is-proven)) |
| tobta'bogh CLI chovnatlh | nob chov Qapta'bogh CLI chovnatlh Qav: Claude Code 2.1.281, Grok CLI 1.0.41; Kimi Code CLI wej. chellu'bogh chovnatlh pImchugh ghuHmoH `eyas doctor`; taghDI' Hoch session chovlu'taH ([tobta'bogh CLI chovnatlhmey](/docs/tlh/ai/providers/#proven-cli-versions)) |
| mIw 'ay' | Hoch mIwDaq DaH QInlIj DungDaq EYAS chelbogh `<turn-context>` 'ay': DaH jaj poH je, ghIq qawqa' 'ay'. Hoch mIwDaq chu' chenmoHlu' 'ej patDaq neH ngeHlu' — QInlIj tlhej pollu' not —, vaj mIwvo' mIwDaq choHbe' pat mu'tlhegh ([chay' qawqa' patDaq ghoS](/docs/tlh/knowledge/memory/#how-recall-reaches-the-model)) |
| qawqa' 'ay' | mIw 'ay' qoDDaq per ghajbogh `<eyas-memory>` 'ay': taHbogh ghItlhHommey, QInvamvaD Suqlu'bogh ghItlhHommey, Qapqu'bogh Sammey naQ ghItlh je. Hoch nobwI'Daq rap; jangbogh pat De' 'aqroS DoS tlhej juvlu' |
| qawHaq nej | `memory_search` / `memory_expand` lo'taHvIS qawHaq poSmoH pat'egh: Hoch nobwI'Daq wa' jangvaD 3 ra', reH ja'chuq Qu' veH qoDDaq. Hoch juH mIw'egh lo'taHvIS janmey pong (Claude CodeDaq `mcp__eyas__memory_search`, Grok CLIDaq `use_tool` `eyas__memory_search` je); jan ra'laHbe'bogh pat qawHaq nejbe', 'ach naQ ghItlh ghajbogh ghItlhHommey law' Suq ([latlh nej: memory_search 'ej memory_expand](/docs/tlh/knowledge/memory/#looking-further-memory_search-and-memory_expand)) |
| nobta'ghach mIw | mIw jangbogh pat Sovbogh EYAS: De' 'aqroSDaj, jan ra''a', EYAS janmey chay' pong juHDaj, qawHaq nejlaH'a' je. pat mu'tlhegh qawqa' 'ay' je juvmeH lo'lu', 'ej jan ra'laHbe'bogh patvaD pagh jan ngeHlu'. Hoch mIwDaq **qawHaq nobta'lu'bogh** 'ay' 'ang ([De' chellu'ghach](/docs/tlh/daily/conversations/#context-composition)) |
| qawmoHwI' QuQ | Hoch pat qawqa'meH lo'bogh: juH vector chenmoHwI' (multilingual-e5-small, pagh hash cha'DIch), Qu' 'ay'Daq ngaSlu'bogh vectormey, wa' tlhob, wa' patlh mIw je. **qawHaq → Hoch Del** nav **qawmoHwI' QuQ** navDaq 'anglu', laD neH ([qawmoHwI' QuQ](/docs/tlh/knowledge/memory/#recall-engine)) |
| nobwI' qawHaq nobta'ghach | nobwI'pu' rarbogh **bejlaH → De'** nav: qawHaq ghajbogh mIwmey, 'ay'vaD Doch motlh, qawHaq tokenmey, mIwvaD qawHaq nejmeH je. mI'mey rapchugh, rap qawHaq Suq Hoch pat ([AI bej 'ej vum](/docs/tlh/admin/observability/#memory-delivery-by-provider)) |
| EYAS Hur qawHaq | latlh jan qawHaq, ghItlhHom vaultmey, EYAS De' pa''egh je — Hoch patvaD laD ghItlh je lajQo'lu' |
| MCP | Model Context Protocol |
| rar | ponglu'bogh Hur pat tetlh 'ay' (Odoo, GitHub, MCP, …) yIn + vault peghmey tlhej |
| He | Hur QIn rarwI' — rar 'oHbe', ghop 'oHbe' |
| ghop (Hand) | raplu'bogh juH lo'wI' OS/CLI/Daq janmey ([ghopmey](/docs/tlh/admin/hands/)) |
| nagh beQ | Hop prompt→pixel gateway (Magnific, Higgsfield, fal, HeyGen). vagh `media_*` jan; pagh motlh. ([nagh beQ](/docs/tlh/ai/media/)) |
| HeyGen | jatlhwI' / ja'wI' nagh tIH nIH optional, nagh beQ 'em (MCP OAuth, jan web Huch). mIw pa' 'oHbe'. ([nagh beQ](/docs/tlh/ai/media/)) |
| mIw pa' | juH chenmoH mIwmey (HTML pagh video → nay'). Media 'oHbe'. ([mIw pa'](/docs/tlh/studio/)) |
| Video Use | mIw pa' mIw: video pe'lu' EDL lo' ([Video Use](/docs/tlh/studio/videouse/)) |
| Browser Use | CLI sidecar optional. Chrome lI' CDP ([Browser Use](/docs/tlh/automation/browser-use/)) |
| OpenCode | MIT mIw jan sidecar optional (HTTP 127.0.0.1 + TUI). vendoredbe'. ([OpenCode](/docs/tlh/automation/opencode/)) |
| OpenCode qawHaq plugin | OpenCode patvaD EYAS `memory_search` / `memory_expand` nob, laD neH; qawHaq ghItlhbogh jan pagh. `opencode_run` Qu' ja'chuqDaj Qu' veH laD, latlh sessionmey qo' qawHaq neH laD, 'ej rarlu'bogh Hur De'wI' pagh laD. EYAS taghbogh Hoch OpenCode Qap ngoq'egh ghaj, Qap tlhej Hegh ngoq ([OpenCode qoDDaq EYAS qawHaq](/docs/tlh/automation/opencode/#eyas-memory-inside-opencode)) |
| Hur qach | latlh jan patvam tu'laH (SSH 'ej juppu') ([Nodes](/docs/tlh/admin/nodes/)) |
| cheltaHghach tev | wej nobwI' laH tev tetlhvo', MIT chaw' chov ([cheltaHghachmey](/docs/tlh/admin/extensions/)) |
| Recordly | AGPL jIH QumwI'; latlh tlhej cheltaHghachmey, qenglu'be', mIw pa' mIw 'oHbe' ([Recordly](/docs/tlh/admin/extensions/#recordly)) |
| 'oS | nej/'oS De' poQ, tetlh Halvo' teH Daja'pa' |
| boq nej | FTS + vector 'oS boq (RRF) |
| nej Hal | ponglu'bogh tetlh Sor (Hemey + chaw'lu'bogh pong/mI'/Segh/qorDu') nej Halmey bIngDaq |
| ghItlh Hal pin | ja'chuq pagh Qu' wIv — ghoqwI'pu' nej Halmey nuv nejlaH |
| vum paqmey | ponglu'bogh paq (pong + naQ He) ja'chuq laD/ghItlhlaH; wa'DIch primary cwd. Segh pagh Qu'; ja'chuq jeS. teDwI' janmey naDev ngaQ — pagh ghajbe'bogh ja'chuq EYAS vum pa'Daj Suq |
| EYAS vum pa' | vum paqmey Daj ghajbe'bogh ja'chuqvaD EYAS chenmoHbogh paq; git checkout qoDDaq not (`EYAS_WORKSPACES_DIR` vIHmeH) |
| nab wa'DIch | ghItlhwI' mIw: pat nab ghItlh 'ej **chaw'** / **nab yISkip** / **lajbe'** loS, jan pa' |
| Skill import roots | pat `skills.importRoots` / `agent.importRoots` `local.yaml`Daq — latlh markdown pa'mey, Hoch taghDI' laDlu'. motlh chIm. latlh jan pa'mey qoDDaq Sormey buSHa'lu' |
| Qu' wiki | Qu'vaD navmey (`/projects/:id/wiki`); chaw' auto-update SoQ ticketmey 'ej ghom wuqvo' |
| needsPin | jan ja' — law' odoo-qorDu' mI' SuH 'ach pagh pinlu' |
| Prompt Enhancer | ja'chuq mu'tlhegh chovnatlh ghojmoHwI' (pat qorDu' Sov) |
| Prompt Coach | nI' Qu' / ghoqwI' pat mu'tlhegh ghojmoHwI' |
| Forge | lajlu'bogh qa' choHmey |
| God Mode | rap Qu' SeHmey pat tetlh baH; chair mI' rapDI' wIv |
| Hub lojmIt | ta' pa' chut |
| CASL | chaw' paq |
| Qu' SeH | Solo/Auto/Deep laHwI' chut (God Mode je) |
| vum 'ab | qech 'ab SeH (auto, pagh, machqu', ram, motlh, jen, jenqu', 'aqroS). pat nobbogh patlhmey neH tetlh wIvwI'; auto Suq (jeD → 'aqroS, jup, nobbogh ja'chuq, He patlh) pagh pat motlh lo'; jangbogh pat lajbogh patlhDaq Hoch ra' rarmoHlu', 'ej Qapbogh vum 'ang Hoch jang |
| laDqa'lu'bogh patlh | Claude Code CLI, Grok CLI, Kimi Code CLI je Qappu'bogh vum patlh net ja', 'ej jang tlha' je 'ang patlhvetlh. latlh nobwI'Daq, patvaD rarmoHpu'DI' EYAS ngeHbogh patlh 'oH ([chay' Hoch nobwI' vum patlh lo'](/docs/tlh/ai/providers/#effort-by-provider)) |
| SLA Qagh | tlhop QIn — poH nargh pagh ngo' vum |
| A2A | ghoqwI'-ghoqwI' chut (nav + Qu' Qap) |
