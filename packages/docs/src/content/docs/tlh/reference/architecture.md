---
title: pat chenmoH (He)
description: teH pat Del nuqDaq tu'lu', 'ej QonoSvam latlh 'ay'mey lo'bogh Hoch chutmey.
---

lo'wI' QonoS naDev Dor. chenmoHwI'pu'vaD:

| He | De' |
|----|-----|
| `docs/eyas-architecture.md` | naQ patHom chenmoH |
| `docs/superpowers/specs/` | chen Del |
| `docs/superpowers/plans/` | chenmoH nabmey |
| `CHANGELOG.md` | ngeHmey |

tev meyvam lo'wI' paq rur yIlo'Qo'. bIng 'ay'mey Hoch nobwI'Daq Qapbogh chutmey Del — API patmey, Claude Code CLI, Grok CLI, Kimi Code CLI, juH QapwI'mey, OpenCode je — 'ej QIjbogh navmey rar.

## qawHaq voDleH 'ay' {#memory-sovereignty-layer}

pat ghajbogh wa' qawHaq neH 'oH EYAS. QInDaj chellu'bogh qawqa' 'ay' 'ej `memory_search` / `memory_expand` janmey neH lo'taHvIS laD pat. qawHaq ghItlh not — EYAS qon — 'ej pagh HeDaq EYAS Hur qawHaq ghoSlaHbe':

```text
pat jan ra' ghoS Hemeyvam wa'Daq:
  1. EYAS mIw'eghDaq EYAS janmey (API nobwI'pu')
  2. jan rarwI' lo'taHvIS Grok CLI Kimi Code CLI je ra'bogh EYAS janmey
  3. Claude Code janmey'egh (Qappa' wa' chov)
     'ej Claude Code chaw' tlhobmey
  4. Grok / Kimi chaw' tlhobmey, 'ej EYAS lo'taHvIS laDbogh
     ghItlhbogh je teywI'mey
                         |
                         v
        WA' He chut. Qan:
          - latlh AI jan qawHaq
          - Obsidian vaultmey
          - security.foreignMemoryPaths Hemey
          - EYAS De' pa''egh (vault, De' pol, ngoqmey, CLI 'elmey)
          - latlh ja'chuq vum pa'mey
                         |
             +-----------+-----------+
             v                       v
       ral lajQo'                 chaw'
   (AI noHwI' pagh, chaw' pagh,
    ngaQ toghbe',
    Hub wanI'meyDaq wa' tlhegh)

CLI shell'egh bIngDaq, Daq rap bot OS teywI' Hung
(Claude Code Grok CLI je; Kimi Code CLI ghajbe').

qawHaq 'el:  <eyas-memory> 'ay' + memory_search / memory_expand
qawHaq mej:  EYAS neH ghItlh
```

rap chov juS OpenCode Qu'mey (QonoS Hutlh), 'ej cha' janvetlh neH lo'taHvIS qawHaq laD OpenCode pat.

- nuqDaq chut Qap, 'ej patvaD nuq ja'lu': [Hub 'ej pegh — EYAS Hur qawHaq](/docs/tlh/admin/security-privacy/#memory-outside-eyas).
- Hoch nobpa' teH CLImeyDaq chay' tobmoHlu': [Hub 'ej pegh — chay' nIteb tobmoHlu'](/docs/tlh/admin/security-privacy/#how-isolation-is-proven).
- Daq Suqbogh pat: [qawHaq — chay' qawqa' Qap](/docs/tlh/knowledge/memory/#how-recall-works) 'ej [EYAS Hur qawHaq lajQo'lu'](/docs/tlh/knowledge/memory/#memory-outside-eyas-is-refused).

## qawHaq nobta'ghach {#memory-delivery}

Hoch patDaq rap mIw lo'taHvIS ghoS qawqa'lu'bogh qawHaq, Hoch 'el HeDaq.

- **wa' chenmoHwI'.** qawqa' chenmoH pat mu'tlhegh boqwI' neH, wa' qawqa' QaHwI' lo'taHvIS. ja'chuq, 'em Qapmey nablu'bogh Qapmey je, Qu' nav bot Qapmey, Qun much vumwI'pu', laHwI'pu' noblu'bogh ghoqwI'pu' je, ghom ghoqwI'pu', He jangmey, jup nobmey, OpenCode Qu'mey je — Hoch juS. qawqa' tlhob chenmoH QaHwI''egh, ja'chuq lo'taHvIS, vaj Hoch He rap nej.
- **wa' Daq.** tlhob ngeHDI', DaH lo'wI' QInDaq mIw 'ay' chel ghoqwI' QapwI' — DaH jaj poH je, ghIq qawqa' 'ay'. pollu'bogh QIn choHbe' not, 'ej taghqa'lu'bogh Qap ngo' 'ay' Suqbe', chu' 'ay' Suq. pat mu'tlheghDaq mIwvo' mIwDaq choHbogh pagh tu'lu', vaj choHbe' pat mu'tlhegh 'ej polmoHlaHlu' (Anthropic APIDaq nIteb Qap).
- **patvaD juvlu'.** Hoch mIw nobta'ghach mIw wa' De' 'aqroS SovmoHwI'vo' ghoS: pat tetlh De' 'aqroS, pagh CLI nobwI' Sovlu'bogh De' 'aqroS, pagh 200k token. 100k token De' 'aqroSvaD Huchmey cherlu' — pa' qawqa' 'ay' 'ay' 'oH `memory.index.budgetChars`, motlh 2400 ngutlh — 'ej De' 'aqroS tlhej tIq: 250k tokenvo' 2.5-logh 'aqroS, 'ach 100kvo' machchugh, De' 'aqroS 35% law' lo'be' pat mu'tlhegh Huch. pIn pong chutmey je pe'lu' not.
- **juHvaD pongmey.** jan pongmey motlh 'oH, 'ej pat juH tetlh rur Hoch ghItlhHom pong: API nobwI'pu'Daq `memory_search`, Claude CodeDaq `mcp__eyas__memory_search`, Grok CLIDaq `use_tool` `eyas__memory_search` je, Kimi Code CLIDaq `eyas` MCP De'wI'Daq `memory_search`. jan ra'laHbe'bogh patvaD jan ngeHlu'be', qawHaq nej ghItlhHom je ngeHlu'be'; cha' ghItlhHom rIn Qatlh, loS ghItlhHom naQ ghItlh Suq.
- **qawHaq nej.** Hoch nobwI'Daq, wa' mIwvaD 3 ra' chaw' `memory_search` `memory_expand` je. Qu' veHchaj SovmoH EYAS De'wI'Daq, ja'chuq lo'taHvIS — jan De'vo' not.
- **'Iv Qoy.** Hur laDwI'pu'Daq joH qawHaq yu'lu'be'. A2A jupvo' Qu'mey, He jangmey Hur ghogh ghajbogh — pagh ghoghchaj Sovlu'be'bogh — jaj poH je neH Suq, 'ej qawqa' polHa'lu' 'e' qon mIw. qawHaq janmey'egh Hub lojmIt bIngDaq ratlh.
- **leghlu'.** Suqbogh qon Hoch mIw: De' chellu'ghach **qawHaq nobta'lu'bogh** 'ay'Daq, tlha'Daj `memoryTiersUsed`Daq je. **bejlaH → De'** **nobwI' qawHaq nobta'ghach** nav nobwI'pu' rar. yIlegh [ja'chuqmey — De' chellu'ghach](/docs/tlh/daily/conversations/#context-composition), [AI bej 'ej vum](/docs/tlh/admin/observability/#memory-delivery-by-provider) je.

## wa' rar, wa' jan veH, wa' laHwI' mIw {#binding-tools-specialists}

- **mIwvaD wa' pat rar.** ja'chuq rarbogh patDaq Qap Hoch mIw — ngaQlu'bogh pat, jup motlh, pagh autom He. pat mu'tlhegh boqlu'pa' rar Sovlu', vaj patvetlhvaD juvlu' mu'tlhegh 'ej patvetlhvaD ghItlhlu' jan pongmey. DawIvbogh pat So' tammoHlu' not; EYAS ngaQmoH'eghbogh pat ghItlhHom tlhej cheghqa'. yIlegh [ja'chuqmey — 'Iv pat jang](/docs/tlh/daily/conversations/#which-model-answers).
- **wa' laHwI' mIw.** Hoch nobwI'Daq, `run_specialist` lo'taHvIS reH EYAS juS laHwI'pu', bIng ja'chuq rur, bejlu'bogh Qap'egh tlhej. Claude Code subagent jan'egh nobbe'lu'. yIlegh [ghommey Segh je](/docs/tlh/agents/teams/).
- **wa' jan veH.** ghoqwI'vaD jan tetlhDaj nob, `memory_search` `memory_expand` je (chIm tetlh: Hoch jan), 'ej nob janmey teq Solo. Hoch Qap HeDaq Hoch nobwI'Daq je rap veH, rarwI' lo'taHvIS CLI ghoSbogh EYAS janmey je; veH Hur ra' lajQo'lu'. yIlegh [chu' 'ej SeH — janmey 'ej chaw'be'mey](/docs/tlh/agents/configure/#tools--constraints).

## vum 'ab tobta'bogh CLI chovnatlhmey je {#effort-and-cli-versions}

- **vum 'ab.** patvaD patlh wuqlu', jangDI' pat — He, nIDqa', pagh cheghqa' pIHDI' wuqqa'lu' —, 'ej patvetlh lajbogh rarmoHlu'. mojmoH neH Hoch nobwI' De'Daj'eghDaq, 'ej teH De' Sovbe'bogh EYAS pat pagh Suq. Qappu'bogh patlh net ja' Claude Code CLI, Grok CLI, Kimi Code CLI je. yIlegh [nobwI'pu' — chay' Hoch nobwI' vum patlh lo'](/docs/tlh/ai/providers/#effort-by-provider).
- **tobta'bogh CLI chovnatlhmey.** Hoch session taghDI' CLI nIteb chovlu', 'ej nobpa' Hoch CLI chovnatlh tobmoH nob chov (`bun run test:live-cli`). chellu'bogh De'wI' mIw tobta'bogh chovnatlh Qav rar `eyas doctor`. yIlegh [nobwI'pu' — tobta'bogh CLI chovnatlhmey](/docs/tlh/ai/providers/#proven-cli-versions).

## Hoch nobwI'Daq bejlaH {#observability-on-every-provider}

- **jan ra'mey, wa'logh toghlu'.** EYASvaD Qapmeh pat nobbogh ra'mey toghlu' tlha', 'ej mIw'eghDaq CLI rInmoHbogh ra'mey — janmey'egh, rarwI' lo'taHvIS EYAS janmey je — Hoch wa'logh, Hoch nobwI'Daq rap.
- **CLI Qapbogh janmey qonlu', Qapqa'lu'be'.** CLI Qap'eghbogh jan jan Qap logDaq tlhegh Suq, pong motlh, QapDaj tlhej. cha'logh Qapbe' chaw'be' je EYAS, 'ej vo' logvo' qawHaqDaq pagh ghoS: qawHaqDaq jan nIH qonlu''a' — `memory.l0.captureToolResults` neH wuq. yIlegh [janmey — jan Qap log](/docs/tlh/automation/tools/#tool-execution-log).
- **mIwvaD qawHaq.** tlha'mey ghaj `memoryTiersUsed` — qawqa'lu'bogh Dochmey, qawHaq ID tagh 'ay'vaD toghlu' — 'ej jangbogh nobwI'vaD qawqa' qawHaq nejmey je boq `GET /api/v1/observability/memory-parity`. yIlegh [AI bej 'ej vum](/docs/tlh/admin/observability/#usage-tab).
- **EYAS pat ra'mey'egh.** 'em vum — pongmey, qawHaq capture, Hub noHwI', … — 'em patDaq Qap, 'ej ja'chuq mIw rur tlha'lu' Huch toghlu' je. yIlegh [He 'ej Huch — 'em pat](/docs/tlh/ai/routing-budget/#background-model).

## QaHwI'pu'vaD {#for-contributors}

- **pat ra'mey.** pat lojmIt ra' ghIH ngeD tetlh neH ghoSbogh backend ngoq: ghoqwI' QapwI', ja'chuq stream He, pat API Hemey, tlha', lojmIt'egh, 'ej nIteb wa'logh ra'mey puS (nab wa'DIch, Qun much noHwI', Design). 'em vum 'em pat QaHwI' juS. latlh ghIH ra' tu'lu'chugh luj `tests/modules/model/no-direct-model-calls.test.ts`.
- **paqvam.** Hal 'oH DIvI' Hol, 'ej rap mIwDaq rap Dungmey pol vagh mughmey. mughlu'bogh Dung, `## Dung {#english-id}` lo'taHvIS DIvI' Hol 'uQ pol, vaj Hoch HolDaq Qap `/docs/<lang>/<page>/#<id>` rarmey QaH hashmey je, 'ej nav tetlhDaq ratlh Dung. wa'DIch Qap ngutlh mojmoHwI', 'ej `--` ghajbogh ID yInbe'; vaj `<h3 id="…">` tlhol lo' Dungvetlh. wa' chov neH, `tests/contracts/handbook-locale-parity.test.ts`: Holmey pIm tetlhlu'bogh nav (Dungmey, 'uQmey, Dung mIw, tetlh tlheghmey), pagh paqvam rar 'uQ navDaj ghajbe'bogh ghoSmoHDI', luj. nav mIw ghogh je: `packages/docs/PAGE_TEMPLATE.md`.
