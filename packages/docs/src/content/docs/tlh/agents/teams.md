---
title: ghommey Segh je
description: juppu' bIjatlhbogh, laHwI'pu' luchenmoHbogh, 'ej ghorgh ghom chup 'ang wej.
---

**nuqmeH.** **juppu'** (potlh 'ej ghom ghoqwI'pu') Dajatlh. toy'mey chu' lughaj. latlh jupvaD Qu' lunob, pagh tetlh rapvo' **laHwI'pu'** luchenmoH — nIteb, pIj parallel. ghom chup chaw' 'ang neH laHwI' Hutlhchugh, ghom DatlhobchoHchugh, pagh Qu' tInqu'chugh.

jup vum 'oH, Qun mIw ghobe' (Qu' rapDaq Qom law' patmey).

## ghorgh yIlo'

- jIH QaHwI' pagh pat QapmoHwI' nuvpu' rur Dajatlh DaneH, So'bogh wIvwI' rur ghobe'.
- Qu' wa'logh law' laHwI'pu' poQ (wa' mIwDaq `run_specialist`).
- Git worktreemey — parallel choHwI'pu' Qaghbe' (implicit sessionDaq cha' pagh law' ghItlhwI' laHwI'pu', 'ej tIn ghom chupmey).
- laHwI' tu'lu'be'chugh, nab leghlu'bogh **yIchaw'** DaneH wej.

## motlh mIw

1. **jup** yIpoSmoH retlh navvo' (**juppu'**), pagh ja'chuq chu'Daq wa' yIwIv.
2. Qu' yItlhob. latlh toy' Qu' ta'be'nIS; `handoff_to_colleague` pagh `run_specialist` lo'nIS.
3. laHwI' Qapmey bIng ja'chuq rur 'anglu'. ghom qawHaq Qap chup chaw' Hutlhchugh je (implicit session).
4. law' laHwI'pu' vumtaHvIS **ghom jIH Daq yIpoS** yIwIv.
5. `/team`, «ghom yIlo'», pagh tIn Qu'vaD **ghom chup** chaw' 'ang wej — **yIchaw'** pagh **yItlheD**.

## mu'mey

| mu' | QIj |
|-----|-----|
| **jup** | potlh pagh ghom ghoqwI' DaQInbogh. juH ja'chuq 'ej QIch (SOUL) ghaj. |
| **laHwI'** | Qu' mach vumwI'. tetlh rap — Hoch jup chu'lu'bogh Hoch laHwI' taghlaH. |
| **`run_specialist`** | mIwDaq tagh; Del loS. SuD (yuvbe'). Alias: `delegate_to_agent`. |
| **`handoff_to_colleague`** | latlh jup juH ja'chuq poSmoH 'ej SIbI' Qap tagh, ra' ngoQ rur. ja'chuqvetlh vumtaHvIS lajQo'lu', *busy* QIn tlhej. SuD. [ja'chuqmey — handoff](/docs/tlh/daily/conversations/#handoff) yIbej. |
| **`assign_task`** | poH Hutlh Qu' nav chaw'. chu'lu'chugh ngoQ, SuD. |
| **`propose_team`** | toy' Hutlh / tIn Qu' / ghom tlhob chaw'. SuDqu'. |
| **juH ja'chuq** | Hoch jupvaD wa' ja'chuq taH. |
| **implicit Qu' session** | wa'DIch laHwI' taghDI' chenlu', vaj chaw' Hutlh ghom qawHaq Qap. |

## patlhmey

| patlh | Dajatlh'a'? | motlh Qu' |
|-------|-------------|-----------|
| **potlh** | HIja' | lIngDaq chenlu'bogh juppu' (QaHwI', chenwI') |
| **ghom** | HIja' | reH juppu' (chovwI', pIchwI', …) |
| **laHwI'** | ghobe' (puq / Qu' neH) | wa' yoS Qu' ta' |

## Hoch nobwI'Daq laHwI'pu' Qapmoh wa' mIw

reH EYAS lo'taHvIS Qap laHwI'pu'. jup Qu' pImmoHDI' — **Auto** 'ej **jeD** Qu' SeHDaq rap — `run_specialist` lo'taHvIS laHwI'pu' tagh, 'Iv nobwI'Daq Qap 'ach: Claude Code, Grok CLI, Kimi CLI, pagh API nobwI'. So'bogh ghoqwI'Hommey'egh chenmoHbe' Claude Code: Task/Agent janDaj noblu'be'.

Hoch laHwI' EYAS ghoqwI' SeHDaj lo' — qa' mu'tlhegh, EYAS qawHaq, cherlu'bogh janmey — 'ej DapoSmoHlaHbogh bIng ja'chuq rur 'anglu', bejlu'bogh QapDaj ja'chuq qonDaj je tlhej. Claude CodeDaq **jeD** mIw QIt law', Hoch laHwI' EYAS Qap naQ'egh 'oHmo'.

**jeD Hoch patvaD ra' rap nob:** Qu' tIn yIpImmoH 'ej Hoch 'ay' pImvaD wa' laHwI' yIQapmoH, parallel, Hoch ra' lugh naQ je; latlh jup Qu' ghajchugh, `handoff_to_colleague` yIlo'; poQlu'bogh laHwI' tu'lu'be'chugh neH ghom yIchup; rInpa' potlh jangmey yIchov; 'ej Qav boq SoH'egh yIpol.

**Hub.** Claude Code ghoqwI'Hom jan pong chaw'be' Hub lojmIt. Claude CodeDaq janvetlh noblu' not, 'ej ra'lu'chugh Seghbe'lu'bogh rur buSlu' 'ej chaw'vaD vIHlu', chaw'lu'be'.

<h2 id="which-model-and-effort-a-specialist-or-member-uses">laHwI' pagh ghom ghoqwI' 'Iv pat vum je lo'</h2>

**pat.** ghoqwI' pat nobwI' + pat cha' 'oH ([chu' 'ej SeH — pat 'ej HoS](/docs/tlh/agents/configure/#model--effort)). chImDI', ja'chuq model ghaH lo' ghoqwI':

- `run_specialist` / `delegate_to_agent` taghbogh **laHwI'**, `assign_task` noblu'bogh Qu' nav, `create_sub_conversation` chenmoHbogh bIng ja'chuq je **nobbogh mIw Qappu'bogh pat**Daq Qap. cha'vetlh bIng ja'chuq chu'Daq pollu'; nIH ja'chuq polta'lu'bogh SeHvo' lIHlu'be'. Claude Code, Grok, KimiDaq rarwI' lo'taHvIS ra'lu'bogh EYAS janmeyDaq ghoS nobbogh mIw pat je.
- **ghom ghoqwI'** patDaj'egh Daq Qap, pagh DevwI' DaH patDaq (nIH ja'chuq DaH Qapbogh pat; He nISbe' ja'chuqvaD motlh patlhDaj), pagh lIng motlhDaq.
- pagh tu'lu'chugh, lIng motlh lo'lu' (motlh patlh → motlh nobwI' → chu'lu'bogh pat ghajbogh wa'DIch QaptaHbogh nobwI', CLI nobwI'pu' je), 'ej wa'DIch QapDI' ja'chuqvetlhDaq ngaQlu'.
- ghoqwI' pat'egh lo'laHbe'lu'chugh (nobwI'Daj chu'Ha'lu' pagh pat chu'Ha'lu'), ja'chuq pollu'bogh pat (nobbogh mIw pat), pagh motlh lo' Qap, 'ej `agent-binding-unavailable` QIj qon jang. pong mo' latlh nobwI' wIv EYAS not. pat SeHlu'be'chugh, luj Qap, *model lanlu'be'…* tlhej, 'ej nIDqa'lu'be'.

Anthropic neH ghom pat HewI' tu'lu'be': Anthropic ngoq SeHlu'mo' neH Anthropic APIDaq Qap pat Hutlhbogh ghom ghoqwI' not, 'ej ghom SeHmey `modelRouting` ghajbe'.

**HoS.** vumDaj'egh ghajbogh ghoqwI' pagh laHwI' pol. ghajbe'bogh Qu' nobbogh ja'chuq patlh Suq, vaj **jeD** ja'chuq laHwI'pu'Daj *'aqroS*Daq ngeH — Huch law'. ghIq jangbogh patvaD Hoch patlh mach, 'ej Hoch jang nuq tlhoblu' nuq Qap je qon. [nobwI'pu' — Qub vum](/docs/tlh/ai/providers/#reasoning-effort) yIbej.

## ghom QapmeyDaq qawHaq janmey je

- laHwI'pu', Qu' noblu'bogh ghoqwI'pu', ghom ghoqwI'pu' je ja'chuq mIw rap qawqa' 'ay' Suq, Qu'chaj pagh ra'chajDaq chellu'bogh ([qawHaq — chay' qawqa' patDaq ghoS](/docs/tlh/knowledge/memory/#how-recall-reaches-the-model)).
- ghom ghoqwI' Hoch ra' qawlu' je, ghoqwI' ghItlhbogh ghItlh rur, SoH ghItlhbogh ghobe'.
- Hoch laHwI', Qu' noblu'bogh ghoqwI', ghom ghoqwI' je qawHaq ngaQ capture Qap je, ja'chuq mIw rap `memory.capture.*` SeHmey bIngDaq. Qu' pagh ra' ghoqwI' ghItlhlaHbogh ra' rur laDlu': SoH, Qu', qo' je ja'bogh De' neH pollu', Qu' mIwmey'egh not. Hoch 'oH ja'chuq Hom'eghDaq Qap, vaj `maxPerConversation` 'aqroS'egh ghaj, 'ej `minUserChars` 'ej law' ra'Daj tIqghach ghajbogh Hoch Qap wa' latlh 'em pat ra' DIllaH. [qawHaq — motlh chu' capture](/docs/tlh/knowledge/memory/#capture-is-on-by-default) yIbej.
- Hoch ghoqwI'vaD ghoqwI'Daj **janmey** tetlh qawHaq janmey je noblu' ([chu' 'ej SeH — janmey](/docs/tlh/agents/configure/#tools--constraints)), Hoch nobwI'Daq.
- ghom QapDaq Hoch ghoqwI' DaH janDaj 'ang, 'Iv nobwI' 'ach.

## ghom chup nab chu' je

EYAS 'em pat ghom chup ghItlh, jan Hutlhbogh wa' mob ra'Daq, nab patlhmeyDaq: **nom**, ghIq **motlh**, ghIq lIng motlh pagh mob ra' QaplaHbogh latlh nobwI'. lo'laHbogh 'em pat Hutlhchugh — chovnatlh: EYAS mob ra' QaplaH 'e' wej tobbogh Grok CLI pagh Kimi CLI neH ghajbogh lIng, pagh pat Huch natlhlu'chugh — wa' ghoqwI' neH chup chaw' (wa'DIch chu'lu'bogh ghoqwI'). mIwmey joj, nab chu'wI' rap Qap: lo'laHbogh 'em pat Hutlhchugh nabDaj pol ghom. [He 'ej Huch — 'em pat](/docs/tlh/ai/routing-budget/#background-model) yIbej.

## worktreemey 'ej chov

| mIw | ghorgh |
|-----|--------|
| **Git worktreemey** | implicit sessionDaq cha' pagh law' ghItlhwI' laHwI'pu', 'ej **complex** / **epic** ngoQvaD ghom chupmey — `.eyas-worktrees/` bIngDaq |
| **chov ra'mey** | YAMLDaq `agent.verifyCommands` DuH — [SeH](/docs/tlh/deploy/configuration/) yIbej |

## ja'chuqmeyDaq

[ja'chuqmey](/docs/tlh/daily/conversations/) yIbej:

- bIng ja'chuq Sor
- ghom jIH Daq (tu'mey, wuqmey, bIHmey)
- ghom chup chaw': **yIchaw'** / **yItlheD**, 'ej Hutlhbogh laHwI'pu'vaD **DaH yIchu'**
- jup Qu' Suqqa'DI' jan tlheghDaq **&lt;pong&gt; poSmoH**

## lIng mIw

cha' potlh juppu' chenmoH lIng pIn'a'. DuHbogh **ghom ghoqwI'pu'** mIw latlh juppu' laHwI'pu' je chel. chovnatlhmeyvo' pagh **ghoqwI' yIchu'** lo'taHvIS laHwI'pu' chenlu' je. ghIq **ghoqwI'pu'** bIngDaq yIchoH.

## latlh

- [ja'chuqmey](/docs/tlh/daily/conversations/)
- [Qu'mey 'ej Mission Control](/docs/tlh/agents/runs/)
- [ghoqwI'pu' Del](/docs/tlh/agents/overview/)
