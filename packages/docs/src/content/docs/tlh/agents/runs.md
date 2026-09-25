---
title: Qu'mey 'ej Mission Control
description: ghoqwI' Qapmey yIbej — yIqIl, yItaHqa', yInIDqa' — 'ej Qu' SeH Daq yIbej.
---

**nuqmeH.** **ghoqwI' Qu'mey** Qapmey tetlh 'oH: QaptaHbogh rInpu'bogh je, Dotlh, chov, mIwmey, tokens, Qu'mey je tlhej. **Mission Control** (**Qu' SeH Daq**) ghoqwI' chaw'mey SeH Daq 'oH — 'Iv QaptaH, 'Iv SoH loS, 'Iv rIn. qunmeH cheghmoHmeH je tetlh yIlo'; DaH yIbejmeH Mission Control yIlo'.

## ghorgh yIlo'

- Qap mevlu', mIw 'aqroS naQ, pagh luj — **taHqa'** (chov Daq) pagh **nIDqa'** (ngoQvo') DaneH.
- vay' QaptaH 'ej ja'chuq DapoSmoHbe'taHvIS **qIl** DaneH.
- naQ qelwI' **Qu' ta'** / **Qu' ta'be'** ghItlh'a' DaneH.
- mI'mey DaneH: vangtaH, chaw' loS, DaHjaj rIn, DaHjaj Huch.
- QaptaHbogh chaw'vo' Qap Damev DaneH pagh ja'chuqDaj DapoSmoH DaneH.

## motlh mIw

1. retlh navDaq **ghoqwI' QapmeH Qu'** yIpoSmoH (**AI** 'ay') — He `/agent-runs`. pagh **bej** bIngDaq **Mission Control** — He `/mission-control`.
2. ghoqwI' Qu'meyDaq **Dotlh** 'ej **chov** yIbej. QaptaHbogh tlheghvaD **qIl**; luj, mevlu', qIllu', mIw 'aqroS tlheghvaD **taHqa'** pagh **nIDqa'**.
3. Mission ControlDaq mI' Degh yIlaD, ghIq chaw'Daq yIvang (**mev**, **ja'chuq yIpoSmoH**).
4. tlhegh pagh chaw' Dotlh choH SIbI' (WebSocket). ja'chuq DapoSmoHDI' Qap rap ghoS, Qap Sor, jan ra'mey je Dalegh.

## ghoqwI' Qu'mey

**He:** `/agent-runs`. bIng pong: *ghoqwI' Qu'mey SeHtaH — mevlu' Qu'mey tu'lu' 'ej qIllaH.* chIm: *ghoqwI' Qu' tu'lu'be' neH.*

| tut | QIj |
|-----|-----|
| **Dotlh** | bIng Dotlhmey yIbej |
| **chov** | naQ qelwI': **Qu' ta'** / **Qu' ta'be'** / **chovlu'be'** (pagh — chovlu'be'chugh not) |
| **ghoqwI'** | ghoqwI' ID |
| **Segh** | Qap Segh (pagh —) |
| **mIwmey** | lo'lu'bogh mIwmey |
| **tokens** | lo'lu'bogh tokens |
| **Qap qon Qav** | Qav yIn QIn poH |
| **Qu'mey** | **qIl** (vangtaH, mevlu', chu'qa') · **taHqa'** · **nIDqa'** (luj, mevlu', qIllu', mIw 'aqroS) |

### Dotlhmey

| Dotlh | QIj |
|-------|-----|
| **vangtaH** | QaptaH |
| **mevlu'** | ghoS pagh — qIllaH / nIDqa'laH |
| **chu'qa'** | tuj taHqa' QaptaH |
| **chaw' loS** | nIteb vang chaw' loS |
| **rIn** | rIn |
| **mIw 'aqroS** | mIw Huch naQ, rInbe' — yItaHqa' pagh yInIDqa' |
| **luj** | Qagh |
| **qIllu'** | mevlu' |

### chov

| Degh | QIj |
|------|-----|
| **Qu' ta'** | chovwI' pat jang 'ej ngoQ rap, ta'lu' 'e' tu' |
| **Qu' ta'be'** | ngoQ ta'lu'be'; wa'logh ghoqwI'vaD Hutlhmey ngeHlu' |
| **chovlu'be'** | chovlaHbe'lu' (chovwI' pat pagh, pagh pagh qonlu') |

**chovlu'be'** 'ang je, chov QaplaHbogh 'em pat tu'lu'be'chugh (chovnatlh: Grok neH ghajbogh lIng, mobDaj wej toblu'bogh), pat Huch mevlu'chugh, pagh Hoch nID lujchugh; Qap'egh rIn motlh.

**qelwI' laj ngoDmey.** Qap ngoQ Halmey poQchugh (Qul, nej, ghItlh ngeD, chen, lugh, choH…), bIH nej qelwI', 'ej Hoch pat rap noH:

- **Qap EYAS nobbogh qawHaq ngoD 'oH**, 'Iv nobwI' pagh pat Qap 'ach. chovwI' patvaD ja'lu' nuq qawHaq Doch noblu', 'ej jang bIH ghaj'a' noH.
- **jan ngoDmey EYAS jan Qap qonvo' ghoS**, nobwI' ja'bogh pongmey neH ghobe', vaj Claude Code pagh Grok/Kimi rarwI' lo'taHvIS ra'lu'bogh `memory_search` rap ghaj ra' 'oH.
- `memory_expand` Sam ngoD 'oH je.

noblu'bogh qawHaq, Sam jan ra', `[source:…]` ghItlh ngeD je Hutlhbogh Qap **Qu' ta'be'** ghItlhlu', ngoQDaj Halmey poQchugh. naQ qelwI', 'ej tIn 'em ngoQvaD ghItlhlu'bogh chovmeH nab je, EYAS 'em patDaq wa' mob ra' puS rur Qap — jan pagh, ja'chuq qun pagh ([He 'ej Huch — 'em pat](/docs/tlh/ai/routing-budget/#background-model) yIbej). pat Hutlhchugh, chovmeH nab ghItlhlu'be'.

### Hoch nobwI'Daq taHqa' 'ej nIDqa'

**taHqa'** Qav chov Daqvo' taH (nIDqa'be' Qan). **nIDqa'** ngoQvo' nab chu' chenmoH; ta'lu'pu'bogh Qaw' ra'mey Qanlu' taH. Claude Code, Grok CLI, Kimi CLI QapmeyvaD API nobwI'pu' rur rap Qap cha':

- CLI'egh Qappu'bogh janmey (shell ra'mey, teywI' ghItlhmey choHmey je, ra'pu'bogh EYAS janmey) Qap qunDaq 'ej jan Qap qonDaq qon EYAS, EYAS lo'bogh pongmey lo' (Bash `run_command` rur 'ang, latlh je).
- CLI janmey Qapbogh mIw ret, 'ej chaw' loSmeH Qap mevDI' Hoch, chov Daq pol EYAS: DaH ja'chuq 'ej pat jang je.
- taHqa' pagh nIDqa' chov Daqvetlhvo' taH, 'ej ta'lu'pu'bogh janmey Del Suq pat.
- Qap wa'DIch luj Hutlh ta'pu'bogh Qaw' ra' nIDqa' patchugh, CLI Qappa' lajQo' EYAS: *already executed on the original run — duplicate side effect prevented*. latlh mu'mey ghajbogh ra' rap, pagh wa'DIch lujbogh ra' chaw'lu'. CLI teywI' choHmey vIHmey je Qanlu'.
- jan rarwI' lo'taHvIS Grok Kimi je ra'bogh EYAS janmey Qan Qanbogh rap: Qap wa'DIch ta'pu'bogh EYAS jan ra' nIDqa'bogh taHqa'lu'bogh pagh nIDqa'lu'bogh Qap (QIn Daq pagh DIlmeH nav rap ngeH rur), Qappa' lajQo'lu', 'ej jan tlhegh **juSlu'** 'ang, meqvetlh tlhej. latlh ngoQmey ghajbogh jan rap Qap taH. lIngbogh Grok CLIDaq toblu'; ra'meyvam chay' ja' Kimi QapwI' net, wej qachDaq chovlu'be'.
- Grok pagh KimiDaq 'em QapDaq, **ghuH** pagh **chaw'** Seghbogh EYAS jan ra', pagh Hub lojmIt vIHmoHbogh ra' (**auto**Daq je), chaw' loS; CLI mIw rInDI' bejlu'bogh Qap **chaw' loS** rur mev, 'ej chaw'lu'DI' ra'vetlh neH wa'logh Qap. [nIteb vang](/docs/tlh/agents/autonomy/) yIbej.

### chay' Qap rIn

- mIw 'aqroSDaj naQbogh Qap motlh rIn, **mIw 'aqroS** Dotlh tlhej, 'ej jang 'ay' pollu'.
- jan ra' HuchDaj natlhbogh Qap motlh rIn je; Dotlh **rIn** taH.
- pat mIw 'aqroS, tIq, lajQo' mev'egh — Qagh ghobe', jang 'oH.
- Qapbe'bogh jan ra' Qapta' rur ja'lu'be'. meq wa' 'oH: mIw 'aqroSmo' tlheDlu', Qap jan Hucmo' tlheDlu', taHqa'DI' cha'logh rurmo' tlheDlu', Hub lojmIt lajQo', pagh chaw' loS. Hoch Dotlh'egh rur jan tlheghDaq 'ang ja'chuq, jang bIngDaq Degh mIw rIn 'ang, 'ej chaw' loSbogh ra' ja'chuqDaq chaw' chaw' 'ang, [chaw'mey](/docs/tlh/agents/autonomy/) tetlhDaq je — [ja'chuqmey — mIw rIn](/docs/tlh/daily/conversations/#turn-outcome) yIbej.
- jang ghajtaHvIS Qap rInDI', jangvetlhDaq qawHaq ngaQ capture Qap — 'em Qapmey, laHwI' Qapmey, Qu' noblu'bogh Qapmey, pipeline Qapmey, A2A Qapmey, ghom ghoqwI' Qapmey je, ja'chuq mIwmey rur, `memory.capture.*` SeHmey rap bIngDaq. pagh jangbogh Qap capture tlhegh ghItlhbe', 'ej nuqvo' tlhegh ghoS qon capture qon (`entry_path`). [qawHaq — motlh chu' capture](/docs/tlh/knowledge/memory/#capture-is-on-by-default) yIbej.

## Mission Control

**He:** `/mission-control`. bIng pong: *vangtaH Hoch ghoqwI'pu' bejtaH.* chIm: *vangtaH ghoqwI' tu'lu'be'.* socket Hutlhchugh **rarHa'lu' — rarqa'…** Degh.

### mI'mey

| mI' | QIj |
|-----|-----|
| **vangtaH** | DaH QaptaH |
| **chaw' loS** | SoH loS |
| **DaHjaj rIn** | DaHjaj Qapmey |
| **DaHjaj Huch** | DaHjaj Huch lo' |

chaw'mey ngaS: wa'DIch chaw' loS, ghIq vangtaH, loS, tam, luj, rIn, qIllu'; Dotlh rapDaq, Qav choHlu'bogh wa'DIch.

| chaw' Doch | QIj |
|------------|-----|
| Dotlh | **tam · vangtaH · chaw' loS · loS · rIn · luj · qIllu'** |
| **mIw / tokens / Huch** | lo' |
| ↳ *vav* | latlh Qap Qapvam tagh |
| *N chaw' loS* | sessionvam tetlh |
| **mev** | 'ol ret Qap mev (*ghoqwI'vam Damev'a'?*). QaptaHvIS neH, 'ej taghbogh lo'wI' pagh owner pagh admin neH |
| **ja'chuq yIpoSmoH** | ja'chuqDaq ghoS |

chaw'Daq loS pagh taHqa' SeHwI' tu'lu'be'. mevpu'bogh Qap DataHmoHmeH, ghoqwI' Qu'meyDaq **taHqa'** pagh **nIDqa'** yIlo'.

## ja'chuqDaq

Qap QaptaHvIS, Dalegh je:

- ghoqwI' ghoS (*mIw N / Max* nobwI' mIwmey ja'chugh, pagh *jan ja'meH: N*; Qap tokens boq; qIl)
- Qap Sor / Qu' mIw — Hoch nobwI'Daq, Dotlh 'ej Qap Huch je tlhej
- jan ra' poSmoHlaHbogh, mIw rIn Deghmey, chaw' chaw'mey je

[ja'chuqmey](/docs/tlh/daily/conversations/)Daq Del.

ja'chuqDaj vummeH pa'meyDaq Qap vum. pa'mey'egh ghajbe'bogh ja'chuq EYAS Qu' Daq'egh ghaj — chenlu'DI' Suq, pagh ngo' ja'chuqvaD veb QInDaq — pa' wIv'egh Qap not. [ja'chuqmey — pa'mey](/docs/tlh/daily/conversations/#working-folders) yIbej.

## latlh

- [ja'chuqmey](/docs/tlh/daily/conversations/)
- [jIH Daq — DaH QaptaH](/docs/tlh/daily/home/)
- [nIteb vang](/docs/tlh/agents/autonomy/)
