---
title: qawHaq
description: EYAS qaw — auto vault ghItlhHommey, vagh 'ay', Hoch QIn tetlh tlhol, 'ej 'Iv pa' yIlo'.
---

**nuqmeH.** qawHaq EYAS nI' pa' 'oH. ja'chuqDaq nI' wanI' Daja'DI' vault ghItlhHom chenmoHlu', 'ej ghItlhHomvam latlh ja'chuqmey laDqa'. naDev taH loghmey, wanI' De', vault navmey, chov tetlh Dabej — wiki Dacherbe'. chay' qawlu'bogh ghItlh patDaq ghoS: [chay' qawqa' Qap](#how-recall-works) yIbej. 0.8.23 tagh, Hoch QIn qonbogh EYAS tetlh tlholDaq cha'logh qonlu' je; bIng [tetlh tlhol](#the-raw-record) 'ay' 'oH SovnISbogh Hoch'e'.

## ghorgh yIlo' {#when-to-use-it}

- QaHwI' SoH, vum mIw, pagh Qu' mevmey qawnIS.
- ja'chuqDaq wanI' ja'lu', vaultDaq 'elpu''a' (pagh qatlh capture Skip) 'e' yIHon.
- chov, pong, De' nav, pagh ghom — pagh **DaHjaj ghItlhHom**.
- qawHaq, Sov wiki, ghItlhmey, ghop vault navmey DIwIv (bIng yIbej).
- paqvam capture chu'Ha' (`memory.capture.enabled: false`) — pagh tetlh tlhol je (`memory.l0.enabled: false`).
- EYAS nIteb Hutlh Qappu' pat 'ej ghItlhbogh Hoch patvo' So'nIS (**qawHaq lo'wI' yIbotmoH**, joH neH).
- naDev qawqa' QapmoHbogh Dochmey Dalegh DaneH — juH vector chenmoHwI', 'ar qawHaq vector ghaj, 'ej qon SeHwI'mey chu'bogh (**qawmoHwI' QuQ** 'emwI').

## motlh mIw {#typical-workflow}

1. **qawHaq** yIpoSmoH 'em tlheghDaq (**De'** 'ay') — He `/memory`. (**SeHmey → AI pat je** bIngDaq tu'lu' je.)
2. **Hoch Del** yIbej (mI'mey, potlh, wanI' qawHaq chu', **qawmoHwI' QuQ** 'emwI' je), ghIq nI' ghItlhHommeyvaD **vault ghItlhmey**.
3. ~40 ngutlh tlhoS ja'chuq nI' wanI' ja'bogh yIQap. jang ret naDev yIchegh — chu' vault ghItlhHom Dalegh (`user`, `feedback`, `domain`, `project`, pagh `reference` Segh).
4. pagh narghchugh: puS, capture chu'Ha', capture Qapmoh 'em pat tu'lu'be' ([capture 'em patDaq Qap](#capture-runs-on-the-background-model)), pagh God Mode mIw (Qun mIw'egh vault ghItlhHom qonbe'; Hoch vumwI' Qap'egh capture Qap). poQtaHchugh vaultDaq ghop yIghItlh. God Mode mIwDaq jang Qapbogh tetlh tlholDaq ratlhtaH — [tetlh tlhol](#the-raw-record) yIbej.

## 'Iv pa' yIlo' {#which-store-to-use}

| pa' | Qu' |
|-----|-----|
| **qawHaq** (navvam) | nIteb qonbogh EYAS wanI'mey — qawHaq ghItlh'eghbe' ghoqwI'pu' not. EYAS wa' tlhegh index, QInvaD qawqa'bogh je, Hoch veb mIwDaq chel. |
| **Sov** wiki | navmey **SoH** choH. capture naDev ghItlhbe'. |
| **ghItlhmey** | chellu'bogh teDwI'mey SuqmeH — qa' ghItlhHombe'. |
| **vault navmey** (ghop markdown) | capture vault rap (`<data dir>/vault/…`, motlh `data/vault/…`). `~/.claude` / `~/.grok` 'oHbe'. |
| **Qu' wiki** | wa' Qu' ticket 'ej wuq navmey, qo' qawHaqbe'. |
| **tetlh tlhol** | Hoch QIn qonbogh EYAS, mu' mu' cha'DIch pollu' 'ej machmoHlu'. 0.8.23 tagh nIteb ghItlhlu'; nav 'angbe', 'ej qawqa' lo'taHvIS neH SIch QaHwI'. |

qach Claude / Grok qawHaq **'oHbe'** wanI' mo', 'ej SIchlaHbe' patmey. reH nIteb Qap Claude Code 'ej qach SeH pagh auto-qawHaq laDbe'; EYAS juHchajDaq Qap Grok Kimi je; latlh jan qawHaq laD ghItlh je lajQo' Hub lojmIt; 'ej EYAS Hur qawHaq polbogh MCP De'wI'mey botlu'. rap ja' Hoch ghoqwI'vaD master mu'tlhegh ([mu'tlhegh pat — qawHaq mab](/docs/tlh/ai/prompts/#the-memory-contract-in-the-master-prompt)). [EYAS Hur qawHaq lajQo'lu'](#memory-outside-eyas-is-refused).

## pat {#features}

ghun bIng mu': *qawHaq pat vagh 'ay' — taH, wanI', Sov/mIw vault, qon pa'*.

### ta'mey {#actions}

| SeHwI' | QIj |
|--------|-----|
| **DaHjaj ghItlhHom** | DaHjaj ghItlhHomDaq yIjaH / yIchenmoH |
| **DaH yIwa'moH** | wa'moHwI' yIQeq (qawHaqmey DunmoH/bIngmoH) |
| **yIchu'qa'** | mI'mey yIchu'qa' |

navmey Dung, **po ja'** 'emwI' ram qel naQ Qav 'ang, tu'lu'chugh (motlh chu'Ha' qel Qu': `memory.reflection.enabled`).

### navmey {#tabs}

| nav | ngaSbogh |
|-----|----------|
| **Hoch Del** | mI'mey, potlh mIllogh, wanI' qawHaq chu', ghIq **qawmoHwI' QuQ** 'ej **qawHaq lo'wI' yIbotmoH** 'emwI'mey (joH neH) |
| **taH qawHaq** | poH mach tetlhmey (24h) |
| **wanI' qawHaq** | De'/wanI'mey potlh ghaj |
| **vault ghItlhmey** | Markdown vault nejwI' |
| **qon pa'** | potlh mach qonlu'ta' Dochmey |
| **rarwI' nav** | qawHaq rarwI' nav |
| **pongHommey** | pongHom nejwI' |
| **bej** | qawHaq QaQmeH bej tetlh |

### Hoch Del {#overview}

| mI' | QIj |
|-----|-----|
| **taH tetlhmey** | taH tetlhmey Qap (24h TTL) |
| **wanI' De'** | wanI' mI' (+ lughbe'moHlu') |
| **vault ghItlhmey** | Sov + mIw Markdown ghItlhmey |
| **qonlu'ta'** | potlh mach qon pa' mI' |
| **DilmeH ruch** → vault | potlh wanI' wIvlu'bogh |
| **bIngmojmeH ruch** → qon pa' | potlh mach wIvlu'bogh |
| potlh mach / motlh / tIn | Sem |
| **pongHom potlh** / **wanI' — mung** | chev Del |

mI'mey bIngDaq [qawmoHwI' QuQ](#recall-engine) 'ej [qawHaq lo'wI' yIbotmoH](#quarantine-a-providers-memory) 'emwI'mey tu'lu'.

### navmey De' {#tab-details}

**taH qawHaq** Hoch tlhegh 'ang: *N Segh · N-logh naw'lu' · mev (poH)*.

**wanI' qawHaq**Daq tlhegh yIwIv, De'Daj poSmoHlu':

| mIw | QIj |
|-----|-----|
| **potlh** | potlh chovnatlh |
| **lughbe'moHlu'** | DaH voqlaHbe' / DaHbe' |
| **ID / mung / mung ID / ghoqwI'** | mung Del |
| **naw' mI' / ja'chuq mI'** | lo' |
| **lughtaHvIS / lughbe'moHlu' poH / chenmoHlu' / naw'lu' Qav** | yIn poH |
| **embedding hash** | Doch vector ghaj'a' |
| **pongHommey** | Doch pongHommey |

**vault ghItlhmey**:

| SeHwI' | QIj |
|--------|-----|
| **ghItlhmey** | vault Hemey |
| **Frontmatter** | YAML Del |
| **pongHommey:** / **rarwI'mey:** | pongHommey 'ej wikilinkmey |
| **ngaSbogh** | Markdown porgh |
| **rarqa'wI'mey** | naDev rarbogh ghItlhHommey |

**qon pa'** Hoch tlhegh 'ang: *qonlu' (jaj) · wa'DIch (jaj)* 'ej *id · wa'DIch id*. potlh mach Dochmey naDev vIH wa'moHwI'.

### qawmoHwI' QuQ {#recall-engine}

**Hoch Del**Daq **qawmoHwI' QuQ** 'emwI' laD neH 'ang: Hoch pat qawmeH lo'bogh QuQ. 'Iv ja'chuq nobwI' jang 'ach rap 'oH, 'ej 'emwI'Daq pagh choHlaHlu'.

| tlhegh | nuq 'ang |
|--------|----------|
| **vector chenmoHwI'** | qawHaq nejmeH mu'tlheghmey je vectormeyDaq mojmoHbogh juH pat: *e5 Hol law' (naDev)* multilingual-e5-small ngI' Suqlu'DI', pagh *hash chenmoHwI' (naDev, cha'DIch)*; bIngDaq pat ID. *chu'Ha'* taghvamDaq vector chenmoHwI' chenmoHlaHbe'lu'chugh neH; vaj vector qawqa' chu'Ha' ([reH juHDaq vector nej Qap](#vector-search-always-runs-locally)). |
| **naQmey vector ghajbogh** / **De' vector ghajbogh** | *Yvo' X*. Y: qawqa' noblaHbogh naQmey De' je — DaH, qa'lu'be', botlu'be'; `contains-secrets` pongHom ghajbogh ratlhbe', `memory.recall.includeSecrets` chu'be'chugh. X: DaH vector chenmoHwI'vo' vector ghajbogh mI'. veb qawHaq ghItlh ret lup puS, bIng choHlu'. ngo' vector chenmoHwI' vectormey toghlu'be'; veb taghDI' qa'lu'. |
| **vectormey Qav chu'moHlu'** | De'wI' Qapvam qoDDaq 'em vector vumwI' Qav Qap poH. taghqa'DI' *taghDI' pagh* 'ang, wa'DIch Qapmeyvetlh ret — tagh ret cha' lup. |
| **jInmol 'ay'mey** | 'ay'chajDaq vectormey ghajbogh jInmolmey jInmol Seghmey je mI' — wa' jInmol qawHaq latlh jInmol qawqa'vo' Hubbogh. DaH vector ghajbogh 'ay'mey neH toghlu'; qo' qawHaq reH 'ay'Daj ghaj. |
| **tetlh tlhol** | [tetlh tlhol](#the-raw-record) qon'a': `memory.l0.enabled` chu' 'ej taghDI' qon Qap. |
| **jan ghum qonwI'** | `memory.l0.captureToolResults`. tetlh tlhol chu'Ha'DI' *chu'Ha'* — vaj pagh qonlu'. |
| **Qub qonwI'** | `memory.l0.captureThinking`. tetlh tlhol chu'Ha'DI' *chu'Ha'* je. |
| **pegh ghItlhHommey yIqawmoH** | `memory.recall.includeSecrets` |
| **qawmoH Huch (100k tokens Qorwagh)** | `memory.index.budgetChars` (motlh 2,400 ngutlh): 100k tokens Qorwagh ghajbogh patvaD qawqa' 'ay' tIn; jangbogh pat QorwaghDaj tlhej 'ay' tIn choH ([taHbogh qawHaq tlheghmey](#standing-memory-lines)). |

EYAS QaptaHbogh SeH 'ang 'emwI', 'ej Hoch nav laDqa'DI' laD; `local.yaml` choH taghqa' ret 'ang. `GET /api/v1/memory/engine` lo' — qawHaq laD chaw' poQ (owner, admin, user, agent Qu'mey; lo'wI' Hutlh `403` Suq). mI'mey, SeHwI'mey, vector chenmoHwI' ID je neH nob — qawHaq ngaSbogh not.

## taHbogh ghItlhHommey {#durable-notes}

taHbogh ghItlhHom 'oH ratlhbogh vIt'e', qaSpu'bogh wanI' qon ghobe': 'Iv SoH,
chay' Qu' ta'nISlu', 'ej nuq poQ nab. Hoch ghItlhHom markdown teywI' 'oH
qawHaqDaq, 'ej Hoch mIwDaq **wa' Dov tetlh** Hev pat — chuvmey neH, Hoch tlhegh ID ghaj —
QInlIjDaq chellu'bogh qawqa' 'ay' qoDDaq ([chay' qawqa' patDaq ghoS](#how-recall-reaches-the-model)). potlh
DaqDaq, `memory_expand` lo'taHvIS naQ ghItlhHom poSmoH, 'ej `memory_search` lo'
latlh nejmeH ([latlh nej](#looking-further-memory_search-and-memory_expand)).

'ay' rap **DaH QInvaD Suqbogh EYAS** ngaS je — ja'chuq Dovmey, vItmey, vault
ghItlhHommey, wanI' qawHaq, ngo' QInmey — Qapqu'bogh Sammey naQ ghItlh je. pat
`memory_search` ra'nISbe' 'e' narghmeH. latlh QInmey nejlaHlu' qonlu'ta'mo' —
qawqa' cha'logh qonqa'be'. (bIng tetlh tlhol 'oH cha'DIch qon wIvta'bogh'e'.)
ngo' pat mu'tlheghDaq chellu'bogh *Related prior work* 'ay' pIm teqlu': DaH
qawqa' 'ay' qoDDaq ghoS ngo' vum.

cha' frontmatter Dochmey SeH: `kind` (`user`, `feedback`, `domain`,
`project`, `reference` — 'ej mIw tlhegh je) 'ej `summary` (tetlhDaq Dov). `user`
`feedback` je nIH. `domain` 'oH project Segh'e' (loSpu' nIv); `project` 'oH
wa' jabbI'ID'e'. `kind` Hutlhchugh: `procedural/` bIngDaq `feedback`,
latlhDaq `reference` — `user` net wIvbe' pagh. `summary` Hutlhchugh, wa'DIch
Dov teH lo'lu', vaj ghop ghItlhlu'bogh teywI' vum, EYAS frontmatter Hutlh je.

DaqmeyDaq: `<data dir>/vault/semantic|procedural|projects|project-types/` — motlh
`data/vault/` bIngDaq. reH De' paqDaq yIn vault 'ej `EYAS_DATA_DIR` tlha'; He SeH
Daj ghajbe' ([SeH — De' paq 'ej vault](/docs/tlh/deploy/configuration/#data-directory-and-vault)).

**ghItlh'egh ghItlhHommeyvam.** jangta'DI' EYAS — ja'chuqDaq, 'em Qu' nav
QapDaq, laHwI' pagh Qu' noblu'bogh QapDaq, ghom ghoqwI' QapDaq, A2A Qu'Daq pagh
He jangDaq — EYAS 'em patDaq ra' mach lo'lu' ([capture 'em patDaq Qap](#capture-runs-on-the-background-model)): ja'chuq
laD 'ej ghel — jar wa' ret ratlhtaH'a' vay', lI'taH'a' je? wa' mIwDaq cha'
ghItlhHommey chenmoHlaH; motlh pagh chenmoHlu', 'ej lugh. jangmeH He potlhDaq
qaSbe': qon lujchugh, ghItlhHom Hutlhlu' neH, jang Hutlhlu'be'.

ra'vetlh Dung juv wa' 'ej ja'chuqvaD 'aqroS wa' neH tu'lu', 'ej chu'Ha'laH — [capture motlh chu'](#capture-is-on-by-default) yIbej. ghop ghItlhlu'bogh ghItlhHom reH Qap. qawHaq ghItlhlaHbe' ghoqwI'pu': nIteb qon EYAS, 'ej `save_memory` teqlu' — pagh ghItlh, 'ej `memory_search` lo'nIS ghoqwI' ja'. OpenCode pat ghItlhlaHbe' je: OpenCode qoDDaq EYAS qawHaq plugin `memory_search` `memory_expand` je neH nob.

ghItlhpa', vItmey Dovmey je rur ra' SeHwI' rap lu'el ghItlhHom chup ([qatlh lajlu'be'
'op mu'tlhegh](#why-some-sentences-are-refused)), 'ej pat ghItlhbogh Hoch
ghItlhHom frontmatterDaq `origin` ghaj — `by: capture`, 'ej Sovlu'DI' nobwI', pat,
ja'chuq je — vaj pat ghItlhbogh rur qawlu', mu'meylIj rur not.

wa' vIt qaSqa'DI', ghItlhHom chu' chenmoHbe'lu': ghItlhHom tu'lu'bogh
chelqa'lu' — jaj ghajbogh Dov 'oH `## History` bIngDaq, 'ej ngo'wI' qa'moHbe'.
teywI'Daq ghItlhpa' `privacy` patHom So' — laDqa'DI' ghobe' — Hur pat ngeHmeH rap
mIw 'ej chutmey lo': jajmey ratlh, 'ej mask- block-Segh De' qa'lu' — ghItlhHomDaq
IBAN `[IBAN]` moj. vault ghItlhHommey neH: bIng tetlh tlhol, ja'chuq Dovmey, vItmey
je EYAS qoDDaq mu' mu' pollu', 'ej EYAS mejDI' neH So'lu' ([qawHaq 'ej
pegh](#memory-and-privacy)).

**nab qawHaq.** nab ja'chuqmeyDaq ghojlu'bogh vIt `projects/<nab-id>/`Daq
lanlu'; nabvamDaq vum'a'DI' lo'wI', motlh `reference` ghItlhHommey nIH; latlh
DaqDaq narghbe' — latlh nab ghItlhHommey `prompt` luSIchbe' not. Hoch ja'chuq
taghbogh **General** nab: nab 'oHbe'. pa' ghojlu'bogh vIt SoHvaD vIt 'oH, pagh
Qu' mIwvaD vIt 'oH, vaj Dat SoH lutlha'.

### capture motlh chu' {#capture-is-on-by-default}

capture **Hoch** ja'chuqDaq Qap, qo'Daq, `memory.capture.enabled: false` Dacherbe'chugh (`local.yaml`Daq, ghIq taghqa'). EYAS pat QapmoHmeH Hoch mIwDaq Qap: ja'chuq mIwmeylIj'egh, 'em Qu' nav Qapmey, laHwI' Qu' noblu'bogh Qapmey je (`run_specialist` / `delegate_to_agent`, ticket-ngogh pipeline mIwmey je), ghomwI' ghoqwI'vo' A2A Qu'mey, Hoch ghom ghoqwI' Qap, 'ej Hoch He jang (Telegram, QIn Daq, Slack, …). lojmIt rap SeHmey rap je lo' Hoch, 'ej Hoch mIw chu'Ha'moH `memory.capture.enabled: false`. pagh jangbogh Qap tlhegh ghItlhbe'. `minUserChars` rIttaHbe'bogh QIn `model` ra'be' not, 'ej wa' ja'chuq `maxPerConversation` ra' neH Suq. ja'chuq Hom'eghDaq Qap laHwI' pagh ghom ghoqwI', vaj 'aqroS'egh ghaj; He ja'chuq Hoch QInmeyDaj wa' 'aqroS nobchuq. vaj `minUserChars` 'ej law' ra'Daj tIqghach ghajbogh Hoch laHwI', ghom ghoqwI', He jang je wa' latlh 'em pat ra' DIllaH. lo'laHbogh 'em pat tu'lu'be'chugh, pagh Huch *stop* 'oHchugh, ra'lu'be' 'ej chIl rur qonlu' Qap ([capture Qu' tetlh](#capture-run-ledger)).

**'Iv QIn ghItlh, vaj chay' laDlu' wuqlu'.**

- ja'chuq QInmeylIj'egh SoH ghItlhbogh rur laDlu'.
- Qu' noblu'bogh, ghom ra', handoff ra', pagh Qu' nav ngoQ SoHvaD ghoqwI' ghItlhlaHbogh Qu' ra' rur laDlu'. SoH, Qu', qo' je ja'bogh De' neH pollu', Qu' mIwmey'egh not.
- He QIn pagh A2A Qu' latlh ghot mu'mey 'oH. SoH 'Iv ja'bogh ghItlhHom (`user`) pagh chay' vum ja'bogh chut (`feedback`) chenmoHlaH not — ghInDaq EYASvaD chaH yIja'. `reference`, `project` pagh `domain` ghItlhHommey neH chenmoHlaH; frontmatterDaq `trust: peer` ghaj chaH 'ej ghomwI' voq patlhDaq pollu', pat ghItlhbogh rur ghobe'. ghItlhHommeylIj tu'lu'bogh chel not ghItlhHomvetlh: cha'logh ja'lu'bogh De' teywI''egh Suq. ngeHwI' mu''egh neH togh tIqghach lojmIt, vaj Hevo' "ok" puS pat ra' DIlbe'.

| ngaQ | motlh | QIj |
|------|-------|-----|
| `memory.capture.enabled` | **chu'** | potlh chu' |
| `minUserChars` | 40 | Unicode pongmey |
| `maxPerConversation` | 20 | pat Huch 'aqroS (Qap, laDlaHbe'bogh, Dub lughbe'bogh, ra' SeHwI' (`poison_gate`), Qagh Qapmey je toghlu'; puS, pat Hutlh, Huch mev chIlmey toghlu'be' — pat ra'lu'be'mo') |
| `maxInputChars` | 4000 | capture pat leghpa', QInlIj jang je Hoch ngutlhmeyvam mI' Dung pe'lu' |

mu' tetlh tu'lu'be'. `{"notes":[]}` motlh 'ej QaQ extractor jang (0–2 ghItlhHom).

### capture 'em patDaq Qap {#capture-runs-on-the-background-model}

qawHaq capture, ram wa'moH, qel briefing je EYAS **'em pat** lo': API nobwI',
pagh nIteb ra' QaplaHbogh CLI (DaH Claude Code; De'wI'vamDaq nIteb chovta'DI'
EYAS Grok CLI Kimi Code CLI je). mIw: Heartbeat He patlh, ghIq lIng motlh, ghIq API
nobwI'pu', ghIq nIteb QaplaHbogh CLImey. He wIv'eghbogh nobwI'Daq chegh not, 'ej
nIteb QaplaHbe'bogh CLIDaq chegh not.

Hoch capture, wa'moH, qel ra' **nIteb**: wa' mIw, jan pagh, CLI qawHaq SeH je
pagh, 'ej ra' pat mu'tlhegh rur ngeHlu'. capture pat Hur 'oHchugh, ja'chuqDaq
block-Segh De' So'lu' (`[IBAN]`) 'ej jajmey ratlh, vaj IBAN ja'bogh mIw
ghItlhHomDaj chenmoH taH.

API nobwI' pagh Claude Code chu'lu'chugh, pagh Daleghbogh choH. lo'laHbogh 'em
pat ghajbe'bogh lIngDaq — nIteb wej chovlu'bogh Grok neH pagh Kimi neH rur:

- **pat ra'be' capture.** Hoch mIw lughbogh capture tetlh tlhegh ghItlh, chIl
  meq `no_eligible_model` tlhej, nobwI' Hutlh. qonlu'bogh chIl 'oH, Qagh 'oHbe'.
- **ram wa'moH** qaStaHvIS wanI' qawHaq vumqa' vault ghItlhHomDaq mojmoHbe'.
  ghommeyvetlh choHbe'lu' (Dovlu'be', lughbe'moHlu'be') 'ej lo'laHbogh pat tu'lu'DI'
  veb ramDaq DunmoHlu'.
- **qel / po briefing** nIteb 'ay'Daj neH pol (rInbe'bogh Qu'mey rur), pat
  ghItlhbogh Qapmey, ghojmey, chupmey je pagh.

pat Huch *stop* 'oHDI', chIl meq `budget_stop` qon capture 'ej ra'be'.

Hop HutlhDI' extractor joH qach qawHaq laDpu', «qonlu'ta'» ja', EYAS vault chIm taH. qabvam SoQmoH.

### capture Qu' tetlh {#capture-run-ledger}

ngaQ SIchbogh Hoch qaS `memory_capture_runs` tetlh qon: chIlmey meqchaj tlhej (`too-short`, `cap-reached`, `unparsable`, `rejected-shape`, `poison_gate`, `no_eligible_model`, `budget_stop`, `error`), capturemey ghItlhbogh Seghmey tlhej (`poison_gate` Qap jang rapvo' pollu'bogh ghItlhHommey togh taH), 'ej `provider` tlhegh: `provider/model`, patDaj pongbe'taHvIS CLI jangDI' `provider/route` (`claude-code/isolated-cli` rur), pagh pat ra'lu'be'DI' null. luj pagh chIm capture ra' nIDlu'bogh nobwI' pongbogh `error` tlhegh ghItlh. nuqvo' tlhegh ghoS qon `entry_path` tut: `interactive`, `background`, `delegation`, `pipeline`, `a2a`, `team` pagh `channel` (chu'choHvam qaSpa' ghItlhlu'bogh tlheghmeyDaq chIm). cha' pegh: capture HuS pagh qonbe'; ghoqwI' mu' Hutlhbogh Qap ngaQ SIchbe'. post-turn 'ay' qaSpa' stream'egh nob **God Mode** Qun, vaj Qun mIw'egh vault ghItlhHom qonbe' 'ej naDev tetlh qon ghajbe'; Hoch vumwI' 'em Qap'egh rur Qap 'ej naDev capture Qap, Qu' ghoqwI' ghItlhbogh ra' rur laDtaHvIS. bIng tetlh tlhol pIm 'oH, 'ej God Mode mIwmey SIch.

## chay' qawqa' Qap {#how-recall-works}

Hoch mIwDaq, 'Iv pat jang 'ach, QInlIjDaq wa' 'ay'Daq qawbogh chel EYAS:

- **taHbogh ghItlhHommey** — nI' ghItlhHommey naQmey je wa' tlhegh Dov tetlh, Hoch tlhegh poSmoHlaHbogh pat ID ghaj;
- **Suqlu'bogh Sammey** — QInvam rurbogh naQmey, De', ghItlhHommey, wanI' qawHaq, ngo' QInmey je, potlh, qan, ghItlhwI' je DoS wuqlu';
- **Qapqu'bogh Sammey naQ ghItlh** — wa'DIch cha' (jan ra'laHbe'bogh patvaD loS).

ja'chuq leghlaHbogh qawHaq neH (Qu'Daj, Qu' SeghDaj, qo' qawHaq je) lo'lu', ghItlhbogh HollIj lo' nej, 'ej voq DoS toghlu'. `memory_search` 'ej `memory_expand` lo'taHvIS latlh nejlaH pat, wa' jangvaD wej ra'. bIng 'ay'mey wa' wa' Del.

### ja'chuq 'Iv qawHaq leghlaH {#which-memory-a-conversation-can-see}

wej qawHaq Segh legh ja'chuq: Qu'Daj qawHaq, Qu' SeghDaj qawHaq, qo' qawHaq je.
latlh Qu' qawHaq legh not. Qu' Hutlhbogh ja'chuq — motlh **General** Qu'Daq
ja'chuq je — qo' qawHaq neH legh.

pat Suqbogh Hoch wa' chut SeH: Hoch mIw chellu'bogh qawHaq, taHbogh tetlh
tlheghmey, vector qawqa', 'ej `memory_search`, `memory_expand`, `search_memory`
janmey.

vault ghItlhHom nuqDaq ghaj — frontmatterDaj wuq:

| ghItlhHom ja' | nuqDaq leghlu' |
|---------------|----------------|
| `project:` | Qu'vetlh neH, ghItlhHom Segh buSHa'lu'. (ngo', `user` / `feedback` / `reference` ghItlhHommey Qu' pongDI' je Hoch DaqDaq 'anglu'.) |
| `projectType:` neH | SeghvetlhDaq Qu'mey |
| pagh | Hoch DaqDaq (qo') |

tu'lu'bogh Qu' `projects/<id>/`Daq ghItlhHom DavIHchugh, pagh frontmatterDaq
`project:` Dachelchugh, Qu'vetlhvaD ngaQlu' — vo' EYAS chenmoHbogh vItmey Dov
je: Qu'vetlh qoDDaq neH qawqa'lu', Hoch ja'chuqDaq ghobe'. qawHaq jaj nej
(`/memory`) pe'be' taH.

### chay' qawqa' patDaq ghoS {#how-recall-reaches-the-model}

QInvaD EYAS qawbogh **QInvetlhDaq** chellu', pat mu'tlheghDaq ghobe'. per ghajbogh
wa' 'ay' rur ghoS, `<eyas-memory>`, DaH QInlIj Dung EYAS chelbogh `<turn-context>`
'ay' qoDDaq, DaH jaj poH je tlhej (`i18n.timezone`Daq, pagh De'wI' poH yoS).
'ay' ngaS, mIwvam:

1. taHbogh ghItlhHommey — wa' tlhegh Dov tetlh, Hoch tlhegh ID ghaj;
2. QInvamvaD Suqlu'bogh ghItlhHommey;
3. Qapqu'bogh Sammey naQ ghItlh.

Hoch nobwI'Daq rap mIw — API patmey, Claude Code, Grok CLI, Kimi Code CLI, juH
patmey — 'ej Hoch Qap SeghDaq: ja'chuq; 'em Qapmey (Qu' nav bot chovnatlhmey,
nIDqa'mey taHqa'mey je, Qun mIw vumwI'pu'); laHwI'pu' Qu' noblu'bogh ghoqwI'pu'
je (`run_specialist` / `delegate_to_agent`) 'ej ticket-ngogh mIwmey; ghom
ghoqwI'pu'; joH ('emDaq) ghoghDaq jatlhbogh He jangmey; 'ej
[OpenCode](/docs/tlh/automation/opencode/) Qu'mey. jup Hutlhbogh, Qu' motlh
ghoqwI' Hutlhbogh Qu'Daq ja'chuq — chenmoHlu'bogh pat mu'tlhegh Suqbe', 'ach jaj,
poH, qawqa'lu'bogh qawHaq je Suq taH. QIn tlhobDaq `system` choH pat mu'tlhegh
neH qa'; qawqa' ghoS taH. taHqa'lu'bogh Qap (chu'qa', chaw' taHqa', chovwI' jang)
jaj, poH, qawqa' je chu' Suq, Qap taghDI' pollu'bogh ghobe'.

- **De' 'oH, ra' ghobe'.** De' 'oH 'ay', ra' ghobe' — ja' pat, 'ej lo'bogh
  Doch `[source:<id>]` rur ja'meH tlhob. qoDDaq ghItlh 'ay' SoQmoHlaHbe' 'ej pat
  pagh lo'wI' QIn rur ngu'laHbe': Deghmeyvetlh Qapbe'moHlu' 'ach laDlaH taH.
- **pollu' not.** QInlIj pollu'bogh choHlu' not; patDaq ngeHlu'bogh cha'DIch
  qonDaq neH chellu' 'ay', vaj qawqa''egh qawHaq rur capture not EYAS.
- **pat mu'tlhegh rap taH.** tlhaq 'ay'vamDaq vIHlu'mo' je, mIw mIw rap taH pat
  mu'tlhegh, 'ej cachelaH taH.
- **rapvaD jan pongmey.** pat rap tetlhbogh rur jan pong Qubmey: motlh
  nobwI'pu'Daq `memory_search` / `memory_expand`, Claude CodeDaq
  `mcp__eyas__memory_search`, Grok CLIDaq `use_tool` `eyas__memory_search`
  tlhej, 'ej KimivaD `eyas` MCP De'wI'Daq `memory_search`. jan ra'laHbe'bogh pat
  nej Qub Suqbe' 'ej cha' naQ ghItlhHom rurbe' loS 'aqroS Suq, 'ej `memory_search` / `memory_expand` 'oSbe' mu'tlheghDaj; 'ay'vam Suqbogh qawHaq Hoch 'oH 'ej latlh nejlaHbe' ja'
  ([mu'tlheghmey — pIn mu'tlheghDaq qawHaq mab](/docs/tlh/ai/prompts/#the-memory-contract-in-the-master-prompt)).
- **Hur laDwI'pu'vaD joH qawHaq pagh.** A2A ghomwI' Qu'mey, 'ej ghogh logh Hur
  ghajbogh He jangmey (ja'chuqDaq **Force External**, pagh poH choH) jaj poH je
  neH Suq. He jang ghogh logh wuqlaHbe'chugh EYAS, qawqa'lu'bogh qawHaq Hutlh mej
  jang je. qawHaq janmey'egh choHbe'lu' 'ej Hub lojmIt SeH taH.

'ay' naQ, per je, `memory.index.budgetChars` cherbogh tIn ghaj ([taHbogh qawHaq
tlheghmey](#standing-memory-lines)), jangbogh pat Qorwagh tlhej tInchoH — OpenCode
Qu'vaD, wIvlu'bogh patvaD OpenCode tetlhbogh Qorwagh ([OpenCode — Qu' tlhej ngeHlu'bogh qawHaq](/docs/tlh/automation/opencode/#memory-sent-with-a-task)). [De' chellu'ghach](/docs/tlh/daily/conversations/#context-composition)
qachDaq, **turn** Daq **memory-recall** 'ay' 'oH qawqa', **turn-time** (tlhaq)
retlh; *memory-index* *related-work* je 'ay'mey 'angbe' DaH. Hoch nobwI'vaD, nav
**qawHaq nobta'lu'bogh** 'emwI' 'ang: 'ay' 'Iv pat logh je vaD cherlu', 'ar Doch
qawqa'lu' 'ej 'ar naQ ghoS 'ay' 'aqroS DoS, qatlh qawqa' pollu' (pollu'chugh), 'ej
mIw latlh nej ra'mey 3 'aqroS DoS.

poH 'ay'Daq nobwI'pu' DapuSmeH, **bejlaH → De'** Daq **nobwI' qawHaq nobta'ghach** 'emwI' tu'lu': Hoch nobwI'vaD, qawHaq qengbogh mIwmey mI', mIwmeyvetlhDaq Hoch 'ay'vaD Doch motlh qawHaq tokens je, 'ej qawHaq poSmoH'egh pat 'ar. mI'mey rapchugh, rap qawHaq Suq Hoch pat. [bejlaH](/docs/tlh/admin/observability/).

### qawqa' nuq lo' nej {#what-recall-searches-with}

Hoch mIw rap nejmeH mu'tlhegh lo' qawHaq nej, ja'chuq pagh ja'chuq 'em pagh
poH Qap 'oH'a' buSHa'lu'. pat ra' Hutlh chenmoHlu' nejmeH mu'tlhegh, vo':

- DaH QInlIj (chImchugh, ja'chuqvamDaq Qav QInlIj);
- ngo' QInlIj pIm (wa'DIch 400 ngutlh);
- ja'chuq pong (wa'DIch 120 ngutlh; *Untitled* Daq pong buSHa'lu');
- ja'chuq Qu' Del pagh ngoQ (wa'DIch 400 ngutlh).

1,200 ngutlh 'aqroS, QInlIj wa'DIch, 'ej ngo' 'ay'Daq ngaSlu'pu'bogh 'ay' (wa'DIch
QInlIjvo' chenmoHlu'bogh pong rur) cha'logh ngeHlu'be'. ja'chuqvam QInmey'egh neH
lo'lu', latlh ja'chuq QIn not. vaj *HIja', yIta'* rurbogh jang mach ja'lu'bogh Qu'
qawqa', 'ej Del ghajbe'bogh ja'chuq 'em Qap pongDaj lo'taHvIS nej taH. (ngo'
DaH QIn neH lo' ja'chuq nej, 'ej Qu' Del neH lo' 'em Qap nej.)

**HollIj laD nej.** nejmeH mu'tlheghvo' Hol Suqlu'. Hol lughbe'bogh QIn machvaD,
ja'chuq lo'bogh Hol lo' EYAS; wej Sovlu'chugh je, Hoch lajlu'bogh Hol motlh
mu'Hommey buSHa'lu'. vaj DaH Magyar, Deutsch, Español, Français motlh mu'Hommey
(*hogy*, *csak*, *aber*, *para*, *avec* …) nej mu' rur toghlu'be' 'ej rarbe'bogh
ghItlhHommey 'elmoHbe', 'ej tlhIngan Hol nejmeH mu'tlheghmey mu' HoS law' Suq. pat `memory_search` nejmeH mu'tlheghmey'egh — OpenCode mu'tlheghmey je — HolDaj rap mIw Suq.

### chay' qawqa' mIw wuq {#how-recall-ranks}

Hoch pat, Hoch 'el He, `memory_search` / `memory_expand` janmey je mIw rap lo'. pagh
SeHnISlu', pagh vIHmoHnISlu'.

- **wa'DIch potlh**: QInlIj 'ar rap ghItlhHom pagh ngo' QIn. ghIq 'ar chu' 'ej 'ar
  potlh, 'ej Qu' (ja'chuq) rap pagh Qu' rap qawHaqvaD mach nob.
- **qawHaq SeghvaD nI'ghach pIm.** vItmey Do' ngo'choH (tlhoS wa' jar), ngo' QInmey
  tlhoS wej jarDaq, Dovmey vault ghItlhHommey je QIt (tlhoS wa' DIS), 'ej pinlu'bogh
  Dovmey ngo'choH not. vault ghItlhHomvaD, nI'ghach 'oH ghorgh Qav nejtetlhDaq
  lanlu' — ghorgh Qav choHlu'; ngo' QInvaD, ghorgh ghItlhlu'. (ngo' Hoch ghItlhHom
  ngo' QIn je chu'qu' rur toghlu'.)
- **'Iv ghItlh 'ugh.** QInmeylIj'egh 'ej EYAS ghoqwI'pu' pagh patmey ghItlhbogh
  ghItlh naQ toghlu'; jan jang 'ej latlh ghot tlhaplu'bogh ghItlh 0.6× 'ugh; He
  ngeHwI'pu' ghItlh 0.3× 'ugh. pollu'DI' EYAS qonbogh voq lo' ([voq: 'Iv
  ghItlh](#trust-who-wrote-it)).
- **qawqa'lu' not:** mu'tlhegh HIvmeH rur perlu'bogh ghItlh (quarantined), vo'
  ghoSbogh ja'chuq Dov lo'taHvIS je, pat meq'egh, 'ej qonlu'bogh jan ra'mey
  ([jan jangmey qonbe'lu'](#tool-results-are-not-recorded--and-why-to-leave-it-that-way) yIlaD).
- **ngo' QIn mu'meyDaj'egh 'oH.** ngo' ja'chuqvo' qawqa'lu'bogh tlhegh QInvetlh
  ghItlh'egh 'ang — nejmeH mu'meylIj Dech 'ay', 280 ngutlh 'aqroS — ja'chuq Dov pagh
  IDDaj neH ghobe'. vault ghItlhHommey ngo' QInmey je rap Suv (ngo', ngo' QInvo'
  mu' rapmey reH rapbogh ghItlhHommey nIv), 'ej tetlh tlholDaq tlhaplu'bogh
  ghItlhHom wa'logh cheghlu', ghItlhHom rur.
- qawHaq nav nej (`GET /api/v1/memory/search`) 'ej `memory_search` Qav mIw ngo'
  QInmey ghItlh'egh 'ang je, perlu'bogh ghItlh, pat meq, qonlu'bogh jan ra' je
  not.

### reH juHDaq vector nej Qap {#vector-search-always-runs-locally}

'Iv ja'chuq nobwI' jang 'ach — Claude Code, Grok, Kimi, pagh API nobwI' — De'wI'
'egh qawHaq vectormey moj EYAS: ngI' tu'lu'DI' multilingual-e5-small pat lo',
pagh ngaSlu'bogh hash lanwI' nap (QaQ puS, qem poQbe'). qawqa'meH nobwI' lanmeH
APIDaq qawHaq ghItlh ngeHlu' not.

- DaH **Embedding** He patlh ngo' vault wanI' nej tetlh neH tlhab; qawqa' lo'be'
  not. (ngo' patlhvetlh DacherDI', Dovmey vItmey je vector qawqa' chu'Ha'moH
  tamtaHvIS, 'ej Hoch taghDI' APIvetlhDaq ngeH.) ngo' tetlhvetlh lanwI' choHDI',
  tetlh wa'logh chImmoHlu' 'ej nIteb chenqa'lu'.
- **qawHaq chu' lup puS ret nejlaHlu'.** ja'chuq buffer QInmey qawHaqDaq ghItlh
  EYAS — Qu' SoQDI', 30 tup QongDI', pagh buffer tebDI' — tu'bogh Dovmey vItmey je
  tlhoS bID lup ret vectorchaj Suq, taghqa' ret neH ghobe'.
- qa'lu'bogh Dovmey, qa'lu'bogh pagh teqlu'bogh vItmey, woDlu'bogh Dochmey, 'ej
  pegh ngaSbogh per ghajbogh Dochmey (`memory.recall.includeSecrets` chu'be'chugh)
  vector tetlhvo' teqlu', vaj qawqa' Daq Suqbe'.
- Hoch lIngDaq taghDI' juH e5 pat laDlu', Embedding patlh cherlu'bogh DaqDaq je
  (tlhoS 100 MB RAM). laDlaHbe'chugh, Qav lanwI' lo' EYAS 'ej vum taH. **Memory
  embedder** tlheghDaq 'Iv lo'lu' 'ang `eyas doctor` — [CLI](/docs/tlh/deploy/cli/#what-doctor-checks).

SeH poQbe'lu', vIHmoH poQbe'lu': ngo' lanwI' chenmoHbogh vectormey veb taghDI'
nIteb qa'lu'.

### latlh nej: memory_search 'ej memory_expand {#looking-further-memory_search-and-memory_expand}

qawqa' 'ay' yapbe'DI', `memory_search` ra' pat,
ghIq `memory_expand` Sam poSmoHmeH. `search_memory` `memory_search` pong latlh
'oH.

- **Hoch nobwI'Daq, wa' jangvaD 3 ra'.** wej janmey wa' jangvaD 3 ra' neH
  chaw' — API patmey, Claude Code, Grok, Kimi je. chu' QIn DangeHDI' mI'
  taghqa', 'ej jang qoDDaq natlhbe' — pat jan mIw Daj tIq'a' buSHa'lu'.
- **ja'chuq Qu'Daq ngaQmoH EYAS, De'wI'Daq.** pat, CLI, pagh rap ngeHbogh
  buSHa'lu': ja'chuq Qu'Daj, SeghDaj, qo' qawHaq je laD janmey. `scope` pagh
  Qu' mu' buSHa'lu': latlh Qu' Dalegh UIDaq, jan mu' ghobe' not. EYAS
  Sovbe'bogh ja'chuq ponglu'chugh, *memory scope unresolved* Qagh 'ej Sam pagh.
- EYAS MCP jan Hur rarwI'pu' EYAS ja'chuq ghajbe': qawHaq jan ra'chaj qo'
  qawHaq neH laD, 90 lupDaq 3 ra'. Qu' rarbe'bogh OpenCode ra'mey 'aqroSvam Suq je.
- **OpenCode** patvaD cha' janmeyvam nob, pongmey Dochmey je rap, laD neH. `opencode_run` lo'taHvIS EYAS nobbogh Qu'vaD, ja'chuqvetlh Qu'Daq ngaQmoHlu' 'ej ra'bogh mIw 3 ra' nobchuq. latlh Daq Hoch — 'emwI'Daq taghlu'bogh OpenCode QonoS session, EYAS chenmoHbe'bogh session, pagh session lo'wI' 'oHbe'bogh 'ellu'bogh ra'wI' — qo' qawHaq neH laD. Hurvo' rarlu'bogh OpenCode De'wI' EYAS qawHaq SIchlaHbe' not. [OpenCode](/docs/tlh/automation/opencode/).
- **ngo' QIn poSmoH.** `rw:` IDDaq `memory_expand` QIn ghItlh wa'DIch nob, 8,000
  ngutlh 'aqroS, Hal SeghDaj voqDaj je tlhej. qawqa'laHchugh Dovvetlh'egh neH
  (perlu'be', pegh vo' ghoSbe' — `memory.recall.includeSecrets` chu'be'chugh),
  ja'chuq Dov chel.

Hoch rap janmeyvam latlh pong lo' — API nobwI'Daq `memory_search`, Claude
CodeDaq `mcp__eyas__memory_search`, GrokDaq `use_tool` `eyas__memory_search`
tlhej. [MCP — Hoch rapvaD jan pongmey](/docs/tlh/ai/mcp/#tool-names-per-host).

### taHbogh qawHaq tlheghmey {#standing-memory-lines}

Hoch mIwDaq taHbogh qawHaq tetlh Hoch tlhegh `memory_expand` poSmoHbogh ID
'ang: vault ghItlhHomvaD `(vt:<path>)`, ja'chuq DovvaD `(gs:<id>)`. Doch IDmey
(`en:<id>`) poSmoH je `memory_expand`: Doch pong, Segh, pong latlh, 'ej ja'chuq
leghlaHbogh qawHaqvo' DaH vItmey 10 'aqroS nob.

tetlhDaq Dov tlheghmey: pinlu'bogh Dovmey, Qu' DovDaj, 'ej rap Qu' Qu' Dovmey
chu'qu' 5 'aqroS (pagh, Qu' Hutlhbogh, latlh Qu' Hutlhbogh ja'chuqmey Dovmey) —
latlh Qu' Dov not, DaH ja'chuq Dov not, woDlu'bogh (quarantine) Dov not.
(ngo': Hoch Qu'vo' 20 Dov potlhqu'.)

`memory.index.budgetChars` (motlh 2400 ngutlh, tlhoS 600 token) **qawqa' 'ay'
naQ** tIn 'oH, per je: taHbogh ghItlhHommey, Suqlu'bogh ghItlhHommey, naQ
ghItlh Sammey je. 100k token context logh ghajbogh patvaD motlhvetlh; jangbogh
pat logh rur tInchoH 'ay' (250k tokenvo' 2.5× 'aqroS, 29k token bIng mach, 'ej logh
machqu'vaD pagh). OpenCode Qu' rap tIn cherlu', OpenCode pat tetlhbogh loghvaD,
pagh logh Sovbe'lu'DI' `memory.index.budgetChars` net (ngo', reH mI'vetlh
net Suq OpenCode). taHbogh
ghItlhHommey wa'DIch ghoS, 'ach DaH QInvaD Suqlu'bogh vaD reH logh lon — 'ay' bID
'aqroS. ngaSlaHbe'bogh ghItlhHommey Qav tlheghDaq toghlu', *… N more notes not
shown*, rap tetlhbogh rur nej jan pongbogh; `memory_search`vo' SIchlaH taH.
`user` `feedback` tlheghmeylIj ngaSlaHbe'chugh, `config/local.yaml`Daq 'aqroS
yInIvmoH (yItaghqa').
ngo' chovnatlhmey `config/default.yaml`Daq 8000 ngeH — [chu'choH
ghItlh](/docs/tlh/deploy/configuration/#memory-index-and-recall).

chu'choH wa'DIch taghDI', qawHaq vector tu'lu'bogh Hoch Qu'DajDaq lan EYAS,
wa'logh 'ej ghommey (log: *L3 repartition: vectors filed under their project*).
rInlaHbe'chugh, ghuHmoH 'ej veb taghDI' nIDqa'. pagh ta'nISlu'.

### nab Hutlhbogh nab ghItlhHommey {#project-notes-without-a-project}

`kind` `project` pagh `domain` ghajbogh ghItlhHom, 'ach `project:` /
`projectType:` Hutlhbogh — **qo' Hoch** 'oH: Hoch ja'chuqDaq taHbogh tetlhDaq,
`memory_search` Sammey je, 'ej qawqa'Daq nargh, nab ghItlhHom rur.
`projects/<id>/` bIngDaq DavIHmoHchugh — pagh frontmatterDaq `project:`
DaghItlhchugh — nabvetlhvaD neH lo'lu'. qemlu'ta'bogh ghItlhHommey rurtaH,
rarbogh nabmey DachenmoHpa'.

### tlhaplu'bogh peghmey qawqa' vo' ratlh {#imported-secrets-stay-out-of-recall}

pegh ngaSmo' teywI', not woD tlhapwI'. ngIq mu' mu' pollu', 'ej Doch
`contains-secrets` per Suq — ghItlhHom per, laH laH, pagh wanI' per, nuq moj.

motlh, Dochvam nIteb SIchbogh mIw Hoch vo' So'lu': taHbogh tetlh, qawqa',
`memory_search`, qelwI' Qu', ram Sepmey boqmoHwI', laH lanwI' je. not lanlu',
'ej chaw'lu'bogh mIw DubwI'vaD not nob. 'ach qawHaq HaqDaq naQ Dalegh taH.

**vo' chenmoHlu'bogh Hoch vo' ratlh je.** ghItlhHom pagh wanI'vo' per
Suq tetlh tlhol cha'DIch qonDaj, vo' EYAS tu'bogh Hoch vIt, vo' chenmoHlu'bogh
Hoch Dov je; ngo' Sovlu'bogh vIt pegh moj je, perlu'bogh ghItlhHom 'olmoHDI'
ret. tlhol tlheghvetlh, vItvetlh, pagh Dovvetlh — lanlu'be', taHbogh tlheghmeyDaq
tetlhlu'be', `memory_search` pagh `GET /api/v1/memory/search` nobbe', 'ej
`memory_expand` lo'taHvIS poSmoHlaHbe'lu'. Doch poSmoHlu'DI', pegh vItmeyDaj
chIllu', 'ej ja'chuq Dov pegh 'oHchugh, ngo' QIn Dovvetlh Hutlh 'anglu'.
(ngo' vo' chenmoHlu'bogh vItmey Dovmey je patDaq ghoSlaH taH.) frontmatterDaq
`contains-secrets` ghajbogh ghItlhHom, teywI' pa'Daq naQ ghItlhlu'bogh, pegh
rur buSlu' vault nejwI' leghpa' je.

`config/local.yaml`Daq `memory.recall.includeSecrets: true` yIcher 'ej
yItaghqa'; vaj Hoch mIwvaD poSlu', ngo' rur.

**chu'choH.** chu'choH wa'DIch taghDI', perlu'bogh ghItlhHommey wanI'meyvo'
ghoSbogh tlhol tlheghmey, vItmey, Dovmey je tu'lu'bogh per EYAS — wa'logh,
vectormey chenmoHpa' — 'ej tlhegh log. ghIq latlh ghItlhHom pagh wanI' per
Suqchugh, veb taghDI' chenmoHlu'bogh tlheghmeyDaj per je. permey chellu' neH:
ghItlhHomvo' `contains-secrets` ghop Dateqchugh, vo' chenmoHlu'pu'bogh Dovmey
vItmey je qawqa'laH not.

lojmItvam nIteb chelmoH bot; teywI' pat qoD 'oHbe'. teywI' laD janmey ghajbogh
ghoqwI' DaqDaq teywI' Hal laDlaH taH. tlhaplu'bogh ghoqwI' qa' 'ej chaw'lu'bogh
workspace chut teywI' So'be'lu' — pa'Daq De' ra'mey *'oH* — vaj tlheghmeyvam
chaw'pa' yIlegh.

`legacy` (ngugh qawHaq pa') `third-party` (latlh Doch ghItlh) permey je:
motlh ghItlhHommey, naQ qawlaHbogh; nuqvo' ghItlhHom ghoS neH ja'. Hoch
tlhaplu'bogh Doch `source:<lanwI'>` per je qeng, laDbogh lanwI' pong. SoH
ghItlhbogh ghItlhHom frontmatterDajDaq `contains-secrets` DellaH je, 'ej mIw rap
Suq. [De' tlhap 'ej ngeH](/docs/tlh/admin/data-port/) yIlegh.

### qawHaq 'ej pegh {#memory-and-privacy}

qawHaq tlhol pol EYAS 'ej mejDI' So'. Hur patDaq qawHaq ngeHlu'DI' — mu'tlheghDaq chellu', pagh `memory_search`, `memory_expand`, latlh qawHaq janmey jang — ghoSvetlhvaD So' pegh chut, 'ej qawHaq Doch rap rap So'lu' cha' mIwDaq. juH pat (loopback, pagh pegh chutDaq local host) So'be'lu'bogh Suq. vault ghItlhHommey ghItlhlu'DI' ratlhtaHvIS So'lu' je (jajmey ratlh).

EYAS qawHaq laDmeH pat lo'laHbogh **Hoch** HeDaq rap So'lu' qawHaq jan jangmey: API juH nobwI'pu' je, Claude Code in-process EYAS janmey, EYAS MCP rarwI' lo'taHvIS Grok Kimi je, EYAS MCP De'wI''egh Hur MCP rarwI'pu', OpenCode sidecar je (Qu' promptDaj, Qu' tlhej ngeHlu'bogh qawqa'lu'bogh qawHaq, `memory_search` / `memory_expand` janmeyDaj jangmey je). CLI, Hur MCP rarwI', OpenCode je reH Hop rur toghlu'. pegh nej lujchugh, jang pollu', So'be'lu'bogh ngeHlu' not. [Hub 'ej pegh — nuqDaq So'lu'](/docs/tlh/admin/security-privacy/#where-masking-applies).

### EYAS Hur qawHaq lajQo'lu' {#memory-outside-eyas-is-refused}

ghoqwI'pu' ja'lu': EYAS qawHaq 'oH qawHaqchaj wa' neH'e', EYAS qon, 'ej
`memory_search` / `memory_expand` lo' SIch. ngaQmoHlu' je:

- **laD ghItlh je lajQo' Hub lojmIt** — latlh jan qawHaq (`~/.claude`,
  `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, OpenCode pa'mey,
  `ai-memory` pa'mey, tetlh latlh je), Obsidian vaultmey, `security.foreignMemoryPaths`
  Hoch He, EYAS De' pa''egh (vault, De' pa', ngoqmey, CLI 'el juHmey), latlh
  ja'chuq vum pa' je — Hoch patvaD, lojmIt chovbogh Hoch jan ra'vaD. ja'lu' pat, chovnatlh: *Memory outside EYAS (Claude Code) — use memory_search / memory_expand from EYAS* — Grok CLI ghobe': lajQo'lu'bogh ra'Daq jangDaj rInmoH, 'ej meq legh patDaj not ([nobwI'pu' — Grok CLI Kimi Code CLI je](/docs/tlh/ai/providers/#grok-cli-and-kimi-code-cli)). ngo' `~/.claude`, `~/.grok`, `ai-memory`Daq ghItlh
  shell 'el je neH botlu', 'ej laDmey chaw'lu'.
- **Claude Code janmey'egh** Qappa' chov rap Suq, vum pa'Daj qoDDaq Claude Code
  chaw''eghbogh laDmey je.
- **nej, nuq SIchlaH, vaj noHlu'.** pa'Daj latlh jan qawHaq, vault pagh EYAS
  De' ngaSchugh CLI nej'egh (Grep, Glob, qoDDaq nejbogh shell ra'), *Search too
  broad* rur lajQo'lu', Daqvetlh buSHa'laHbe'mo' CLI; 'ej Daqvetlh ngaSbogh
  **pa'** qonlaHbe'choHlu'. [Hub 'ej pegh — EYAS Hur qawHaq](/docs/tlh/admin/security-privacy/#memory-outside-eyas)
  yIlegh.
- **kernel teywI' Hung.** tu'lu'DI', OS teywI' HungDaq Qap Claude Code shell
  ra'mey Grok CLI janmey'egh je, vaj EYAS laDlaHbe'bogh mIw lo'taHvIS shell ra'
  DaqmeyvetlhDaq SIchDI' je botlu' ([nobwI'pu' — kernel teywI'
  Hung](/docs/tlh/ai/providers/#kernel-file-sandbox)). De'wI'vamDaq nuq Hublu' tetlh
  **Hub wanI'mey** **EYAS Hur qawHaq** 'emwI'.
- **nIteb Qap CLImey.** qach `CLAUDE.md`, SeHmey, laHmey, MCP De'wI'mey,
  auto-qawHaq je laDbe' Claude Code; EYAS juHchajDaq Qap Grok CLI Kimi Code CLI
  je 'ej `~/.grok`, `~/.kimi`, `~/.claude` leghbe' not.
  [nobwI'pu'](/docs/tlh/ai/providers/#claude-code-isolation).
- **cha'DIch qawHaq polbogh MCP De'wI'mey** (Memory Sov qum De'wI', Qdrant,
  Obsidian, MCPVault, …) pagh Hublu'bogh pa' 'oSbogh — Hoch patvaD botlu'.
  [MCP](/docs/tlh/ai/mcp/#memory-store-servers-are-blocked).

**vIHmoH.** ngo' `~/.claude/CLAUDE.md`, `~/.grok` qawHaq, vault ghItlhHommey,
pagh `data/` bIng teywI'mey laDbogh ghoqwI'pu' DaH lajQo'lu' (Hoch lajQo' Hub
wanI'meyDaq 'ang). [De' tlhap](/docs/tlh/admin/data-port/) lo'taHvIS wa'logh
Sovvetlh EYASDaq yIqem. De' 'ej wej ngaQbogh:
[Hub 'ej pegh — EYAS Hur qawHaq](/docs/tlh/admin/security-privacy/#memory-outside-eyas).

---

## tetlh tlhol {#the-raw-record}

**pagh mu' chIllu'.** Hoch QIn qonbogh EYAS — QInlIj, ghoqwI' jang, 'ej 'em
Qu'mey mu'mey je — DaH cha'logh qonlu': mu' mu' rap, ja'chuq retlhDaq tetlh
tlhol. 'elDI' machmoHlu' (motlh mu'meyDaq tlhoS 2.7-logh mach) 'ej byteDaj
hashDaq lanlu' — vaj wa' ja'chuqDaq mu'tlhegh rap qaSqa'DI', wa'logh pollu'
'ach cha'logh toghlu'.

**'Iv laD.** tetlh tlhol SoHvaD 'angbogh nav pagh ra' tu'lu'be'. qawHaq
qawqa'Daq neH SIch QaHwI', rap Qu' ngaQ qoDDaq: tetlhvo' tu'bogh EYAS Dovmey
vItmey je (bIng) taHbogh qawHaq tlheghmey 'ej nej Sammey rur 'ang, 'ej chaHmey
tlhol tlheghmey je poSmoHlaH `memory_search` / `memory_expand` — [ja'chuq 'Iv
qawHaq leghlaH](#which-memory-a-conversation-can-see).

DaHjaj choHta'bogh Doch: mu'meylIj Daq. ja'chuq wa' qon 'oHbe' latlh — ja'chuq
SoQmoHlu', qon pa'Daq lanlu', pagh Qaw'lu'chugh, tetlh tlhol ratlhtaH, 'ej
Qaw'meH SeHwI' pagh tu'lu'. DaneHbe'chugh, chIlnISbogh vay'vaD EYAS Dalo'pa'
tetlh tlhol yIchu'Ha' (bIng yIbej).

tugh qonbe'lu'. ja'chuq buffer QInmey pol, 'ej loS mIwDaq qonlu': ja'chuq
SoQmoHlu'DI' (pagh SoQbogh 'ay'Daq vIHlu'DI'), tlhoS 8000 token boSlu'DI', 30
tup ja'chuq QongDI', pagh EYAS mevDI'. vaj taghqa'DI', ja'ta'bogh vay' chIlbe'.

Hoch QInDaq mungDaj degh je qonlu', 'ej degh not nobchuqlu'. vo' chenmoHlu'bogh
mu'mey law' voqqu'lu' Dov pagh vIt net chaw'be' not — [voq: 'Iv ghItlh](#trust-who-wrote-it).

### voq: 'Iv ghItlh {#trust-who-wrote-it}

qawlu'bogh ghItlh 'ar voq EYAS — **'Iv ghItlh** wuq, ja'chuq 'Iv retlhDaq
'anglu' ghobe'.

| voq | nuq ngaS |
|-----|----------|
| **owner** | ja'chuqDaq SoH ghItlhbogh, Qun mIw mIw je |
| **derived** | ghoqwI' pagh EYAS'egh ghItlhbogh: pat jangmey, latlh ghoqwI'vaD ghoqwI' nobbogh Qu', handoff ra', ghItlhlIj Dech Prompt coach / Prompt enhancer chenmoHbogh mu'tlhegh, 'emDaq QapDI' Qu' nav chovnatlh ngoQ, 'ej ghom ghoqwI' Suqbogh ra' |
| **peer** | He ngeHwI'pu' QInmey (Telegram, QIn Daq, latlh Hemey je) 'ej A2A lo'taHvIS latlh pat ngeHbogh Qu'mey, 'ej chaHvo' qawHaq capture chenmoHbogh vault ghItlhHommey (`trust: peer`) |
| **ingested** | jan mej |
| **quarantined** | perlu'bogh ghItlh — pollu', 'ach qawqa'lu' not |

vo' ghoSbogh ghItlh law' voqqu'lu' vItmey Dovmey je not, vaj coach
mu'tlheghDaq *Target model: X* rurbogh tlhegh, pagh noblu'bogh Qu'Daq *Deadline:
Friday*, owner patlh vIt mojlaHbe' DaH. patlhmeyvam 'ugh qawqa' je ([chay' qawqa' mIw
wuq](#how-recall-ranks)): jan jang 'ej latlh ghot tlhaplu'bogh ghItlh 0.6×, He
ngeHwI'pu' 0.3×, quarantined ghItlh not.

**'em ghom ra'mey qawlu' je:** 'em Qap taghDI' chovnatlh ngoQ, 'ej Hoch ghom
ghoqwI' ra'. Hoch ra' pIm wa'logh qawlu', Qap nIDqa'lu''a' taHqa'lu''a' je
buSHa'lu'. ja'chuq'eghDaq chu' pagh 'ang.

**vault ghItlhHommey voq patlh ghaj je.** pat ghItlhbogh ghItlhHom *derived*
'oH, SoHvaD ghobe' — Hoch mIw nIteb ghItlhHommey, ram wa'moH, ghom Dovmey je.
frontmatterDaq `origin` Doch (`by: capture`, `consolidation` pagh `team`, 'ej
Sovlu'DI' nobwI', pat, ja'chuq je), `auto-consolidated` per, pagh capture
ja'chuqDaq rar lo'taHvIS Dahonlu'. ghItlhHom `origin` ghop Dateqchugh, capture
ghItlhHom owner voq Suqqa' not, capture rar per taHmo'. He QInvo' pagh A2A Qu'vo'
capture chenmoHbogh ghItlhHom `trust: peer` ghaj 'ej ghomwI' voq patlhDaq pollu';
nIvbogh voq ghajbogh ghItlhHom HoSmoH not, vaj cha'logh ja'lu'bogh De' teywI''egh Suq. ghop DaghItlhbogh pagh SoH'egh Datlhapbogh ghItlhHommey
*owner* taH. ghItlhHom frontmatterDaq `trust:` DachellaH, 'ach patlh
**machmoH** neH, not Dun: `trust: quarantined` taHbogh qawHaq tlheghmeyvo'
ghItlhHom Haw'moH, 'ej `memory_expand` lo'taHvIS poSmoHlaHbe' QaHwI' (vault
Vault nejwI' je Daq teywI' taH).

**chu'choH.** chu'choH wa'DIch taghDI', Hoch vault ghItlhHom wa'logh laD EYAS
voq patlhDaj qonmeH, vaj taghvetlh natlh puS law'. lup puS ret, wa'logh 'em Qap
tu'lu'bogh vault ghItlhHommey qawHaq lughmoH — pat ghItlhbogh ghItlhHommey owner
patlh chIl, Qu' ghItlhHommey Qu'chajDaq vIH — 'ej vItmeychaj Dovchaj je
chenqa'. pagh ta'nISlu', 'ej Qapvam nIDqa'be'.

<h3 id="what-eyas-works-out-from-it--with-no-model-call">nuq tu' EYAS — model ra'be'taHvIS</h3>

Hoch qon ret, ghItlhta'bogh EYAS laDqa' 'ej nIteb tu':

- **vItmey**: mu'meyDaq `key: value` tlheghmey, 'ej ja'chuq Qu' nav chaw' je
  (pong, nab, nab Segh, ghoqwI');
- **Dov mach**: 280 ngutlh 'aqroS — wa'DIch QIn, Qav QIn, 'ej joj mu'tlheghmey
  potlh puS;
- **Dochmey**: jajmey, `@mentions`, `#tickets`, code pongmey, backtick mu'mey,
  tIn ngutlhDaq taghbogh pongmey;
- **topicmey**, 'ej **potlh chovnatlh**: ja'chuq nI'mo', SoH 'ay'mo', wuqmeH
  mu'mo' (vagh HolDaq), SoQ'a', 'ej **pin** ghaj'a'.

pagh `model` ra'lu'. nobwI' Sovbe'lu', API pegh lo'be'lu', Huch natlhbe'lu',
'ej SeHmeH pagh tu'lu'. 'ach Dil: val ghobe', yep — ja'lu'chu'bogh vay' Sam,
'oSlu' neH bogh vay' chIl.

vItmey boSbe'. Doch rap Daja'qa'chugh, tu'lu'bogh vItDaq rarlu'. Doch rap 'ach
chu' Daja'chugh — poH ngaHmeH jaj Sochjajvo' vaghjajDaq vIHchugh — vIt ngo'
lughbe'moHlu' 'ej lughbe'moHlu' poH ghaj, qa'moHlu'be'; vaj wa' jang DaH tu'lu'
'ej mung naQ ratlh. pagh Daq qa'moHlu', pagh chIllu'. mungmey Hoch ghajbe'bogh
nab pongHom pagh ja'chuq pongHom not Suq vIt.

Dovmey vItmey je laD taHbogh qawHaq tlheghmey (`gs:` IDmey), qawqa', `memory_search`, `memory_expand` je. boq ghItlhlu'DI' tlhoS bID lup ret vectormeychaj Suq ([reH juHDaq vector nej Qap](#vector-search-always-runs-locally)).

### nuq Dil, 'ej chay' chu'Ha'lu' {#what-it-costs-you-and-how-to-switch-it-off}

tetlh tlhol tInchoHtaH, 'ej **DaH pagh pe'** — chu'choHvamDaq poH 'aqroS SeHwI'
pagh, Say'moHwI' Qu' pagh. juvlu': wa' QIn qonlu'ta'bogh tlhoS 5 KB Daq natlh,
indexmeyDaj toghlu'DI'; vaj De' pa' tInchoH nom law' ret nom puS.

`config/default.yaml`Daq wej ngaQ, Hoch `memory` bIngDaq:

| ngaQ | motlh | QIj |
|------|-------|-----|
| `memory.l0.enabled` | **chu'** | potlh SeHwI'. `false` — pagh qonlu'; taghqa'DI' Qap |
| `memory.l0.extractInLegacy` | **chu'** | `false` — mu'mey pol 'ach pagh tu': vIt pagh, Dov pagh, topic pagh |
| `memory.engine` | `legacy` | nIteb vIt tu' Qap'a' neH wuq: `v2` reH tu'; `memory.l0.extractInLegacy` chu'taHvIS (motlh) tu' `legacy`. 'Iv mI' cherlu' 'ach reH navvamDaq ja'lu'bogh patlh qawqa' 'oH qawqa' |

`memory.capture.enabled: false` tetlh tlhol chu'Ha'**be'**. ngaQvetlh vault
ghItlhHommey 'ej 'emDaj `model` ra' mach SeH neH; cha' SeHwI' pIm, 'ej wa'
chu'Ha'DI' latlh QaptaH.

`eyas doctor` machmoHwI' tu'lu''a' 'ej 'Iv lo'lu' ja'. pagh tu'lu'chugh, logDaq
ja' EYAS 'ej pagh qon — ghItlhlaHbe'bogh buffer tebbe'.

<h3 id="tool-results-are-not-recorded--and-why-to-leave-it-that-way">jan jangmey qonbe'lu' — 'ej qatlh vaj yIratlhmoH</h3>

`memory.l0.captureToolResults` **motlh chu'Ha'**. Dachu'pa' naDev yIlaD.

wa' SeHwI' ghoqwI' Qap ra'bogh Hoch jan ngaS, 'Iv pat jang 'ach: EYAS janmey'egh; EYAS rarwI' lo'taHvIS Claude Code, Grok, Kimi je ra'bogh EYAS janmey; 'ej Claude Code, Grok, Kimi je janmey'egh — ra'mey Qap, teywI'mey laD, ghItlh, nej je. OpenCode ngaS je: `opencode_run` Qu' qoDDaq OpenCode Qapbogh janmey, 'ej ja'chuq OpenCode QonoS ghum (ja'chuq Dung tlheghDaq QonoS Degh) — ja'chuq tu'lu'bogh 'ej QonoS lo'wI' ghajbogh vaD neH qonlu'. OpenCode Qav jang diffmey je `opencode_run` jang 'oH, 'ej latlh jan jang rur qonlu'. (ngo', SeHwI'vam buSbe'taHvIS QonoS ghum wanI'mey je pol OpenCode.)

- Qapbogh ra'mey neH qonlu'. lujbogh ra' qonlu' 'ej Qagh rur perlu'. lajQo'lu'bogh (denied), Skiplu'bogh, chaw' loSbogh ra'mey qonlu'be', 'ej jang chImmey pagh ra' rap cha'logh je qonlu'be'.
- Hoch qonlu'bogh ra' ra' nobbogh pol: jan pong, jang, luj'a', rIn, 'ej 'Iv Qap (EYAS pagh pat CLI'egh). ra' Dochmey wa'DIch 2,048 ngutlh retlh pollu' — mung neH: naQ ghItlh nejmeH tetlhDaq ghoSbe', 'ej EYAS tlhapbogh qechmey, pongmey, De' je choHmoH not.
- ja'chuq ghajbogh ghoqwI' Qap qoDDaq ra'lu'bogh ra'mey neH qonlu'. ghoqwI' Qap Hurvo' ra'lu'bogh jan (Hur MCP rarwI' ra'bogh rur) qonlu'be'. QonoS ghum qonlu' ja'chuq tu'lu'bogh 'ej QonoS lo'wI' ghajbogh vaD neH.
- qonlu'bogh ra'mey ja'chuq Qu'Daq pollu', voq *ingested* tlhej ([voq: 'Iv ghItlh](#trust-who-wrote-it)).

chu'DI', jan jang **naQ, mu' mu', choHbe'lu'bogh** pol tetlh tlhol, ra' Dochmey wa'DIch 2,048 ngutlh je. vaj: ra' jang naQ, ghoqwI' laDbogh Hoch teywI' ngaSbogh, 'ej wa'logh mI' pagh token jan nobbogh — Hoch De' pa'Daq motlh mu'mey rur. pagh So', pagh nej, 'ej machmoHghach peghbe'. ghItlhpa' vault ghItlhHommey `privacy` patHom Say'moH; qonlu'bogh jan jangmey Say'moHbe'.

**prompt'e' chegh nuq.** qonlu'bogh jan ra' qawqa'lu' not, 'ej mu'meyDaj ja'qa'lu' not: mIwDaq EYAS chelbogh qawHaqDaq ghobe', `memory_search` pagh `memory_expand` lo'taHvIS ghobe', qawHaq nav nejDaq ghobe', ja'chuqDaj DovDaq ghobe'. ja'chuqvo' EYAS tlhapbogh qechmey pongmey je (teywI' pong pagh mIw pong rur) choH jang neH; Dochmey pagh choH. vaj jan ghItlhbogh ngoq, nejmeH mu', pagh pat nobbogh He — qech, pong, De' moj not; 'ej ra' 'angbogh token pagh jan Suqbogh De' nav — latlh ja'chuq promptDaq chegh not, Hop patvaD promptvetlh ngeHlu'DI' je.

`memory.l0.toolResultMaxBytes` (8 KB) ra' nobbogh qon 'aqroS — jan pong, jang, Qagh flag, rIn, 'Iv Qap je — 'ej ngutlh veHDaq pe'lu', pe'ta' degh leghlu'bogh tlhej. Dochmey toghlu'be'; wa'DIch 2,048 ngutlhchaj pIm pe'lu'. SeHwI' chu'DI', Hoch taghDI' ghuHmoHwI' ghItlh EYAS: jan jangmey mu' mu' pollu', So'be'lu', 'ej pagh nej pagh pegh.

### pat meq (chov neH) {#model-reasoning-audit-only}

`memory.l0.captureThinking` (motlh **chu'Ha'**) ja'bogh Hoch pat meq ("thinking")
pol tetlh tlholDaq, Hoch pat ra'vaD wa' Doch. chov neH: vItmey moj not, mu'tlheghDaq
qawqa'lu' not. jan jangmey rur mu' mu', So'be'lu' pollu', 'ej chu'taHvIS taghDI'
ghuHmoHwI' ghItlh EYAS.

Hoch Qap taghDI' QaptaHbogh SeHvo' cha' SeHwI' laDlu'; `local.yaml`Daq choH EYAS
taghqa'DI' Qap.

**Hal.** qonlu'bogh jan jangmey meq je, 'em ghom nobbogh Qapmey jangmey je, DaH
jangbogh nobwI' pat je qon (tlhoblu'bogh reH ghobe', Fallback ret rur), 'ej chay'
Qap tagh: ja'chuq, 'em, ghom, nob, A2A, He, pagh pipeline. ngo' tlheghmey Dochmeyvam
ghajbe' neH.

### qatlh lajlu'be' 'op mu'tlhegh {#why-some-sentences-are-refused}

ghoqwI'vaD ra' rurbogh mu'mey vIt voqlu'bogh moj net chaw'be'. "Hoch ra'mey
wa'DIch yIbuSHa'", "DaHjaj mo' chu' Daghaj…" mIw choH, pagh pat QIn
rurmoHlu'bogh vay' — Hoch lajlu'be'chu'. ghoqwI'vaD ra' motlh, jan lo'meH ra',
'ej "Hoch yIlIj" mu'mey pollu' 'ach voqlaHbe' pongHom Suq, vaj qawqa'DI'
lonlaHlu'. vagh Hol bej: en, hu, de, es, fr.

Dov lajlu'be'DI', mevbe' EYAS — bIngDaq ghoS: wa'DIch Dov ngeDqu', ghIq
mu'tlheghmey Say' neH, 'ej Qav ja'chuq pong neH ngaSbogh Dov chIm. ja'chuq not
chIl; DovDaj neH chIl.

pat nej neH 'oH, teHmoHwI' 'oHbe', 'ej yepqu' — vaj motlh vum mu'mey, `Run the
following command in the pod: …` rurbogh, voqlaHbe' pongHom Suq 'op. mu'tlhegh HIvmeH rur perlu'bogh
ghItlh (quarantined) qawqa'lu' not 'ej `memory_expand` lo'taHvIS poSmoHlu' not,
vo' ghoSbogh ja'chuq Dov lo'taHvIS je.

**pat ghItlhbogh ghItlhHommey SeHwI' rap lu'el.** Hoch mIw qawHaq capture, ram boq
Dovmey, ghom qep Dovmey je vaultDaq vay' ghItlhpa' chovlu', 'ej Hoch rap ghItlh
lajQo':

- **capture:** lajQo'lu'bogh ghItlhHom chIllu'. capture Qap `poison_gate` meq tlhej
  qonlu', 'ej `maxPerConversation`Daq toghlu', pat ra'lu'pu'mo'.
- **ram boq:** pagh ghItlhlu' 'ej wanI' qawHaqmey ratlh; veb ram Qap nIDqa'.
- **ghom qep:** Qaghbogh tu' pagh wuq neH chIllu'.

De'wI' logDaq lajQo'mey 'ang, SeHwI' pong tlhej, lajQo'lu'bogh ghItlh ghobe' not,
vaj lughbe'bogh lajQo' leghlaH, So'lu' not.

---

## qawHaq lo'wI' yIbotmoH {#quarantine-a-providers-memory}

EYAS nIteb Hutlh Qappu'chugh pat — motlh Grok CLI, Kimi Code CLI pagh Claude Code rurbogh
CLI — 'ej EYAS Hur qawHaqvo' janglaHpu'chugh (latlh jan qawHaq pa' pagh Obsidian
vault rur), yIlo'. latlh mIw rur EYAS qawHaqDaq jangmeyDaj pollu', 'ej ghIq Hoch
patDaq cheghlaH.

**nuqDaq:** **qawHaq → Hoch Del**, **qawHaq lo'wI' yIbotmoH** 'emwI'. joH neH
lo'laH; SeHwI'pu' lo'wI'pu' je *qawHaq botmoHlaH pagh tlhabmoHlaH ghaHvaD neH.*
legh.

1. wa' pagh law' **lo'wI'mey** yIwIv. qawHaq ghItlhpu'bogh Hoch nobwI' 'ang tetlh,
   qawqa'laHbogh tlheghmeyDaj mI' tlhej.
2. chaw'lu'chugh **vo'** / **Daq** jajmey yIcher. juH jaj naQ 'oH 'ej ngaS; chIm —
   'aqroS pagh.
3. **wa'DIch yIlegh** yIwIv. 'ar tlhol tlhegh, vIt, Dov, capture ghItlhHom je
   So'lu'ta'jaj, 'ej 'ar ja'chuqvo', 'ang. wej pagh choH.
4. **yIbotmoH** yIwIv, ghIq naDev yI'olmoH. qIl pagh choH.

**Hoch patvo' nuq So'lu'**, Hoch HeDaq (Hoch mIw qawHaq 'ay', `memory_search` /
`memory_expand`, taHbogh qawHaq tetlh, vector nej je):

- nobwI' jangmey 'ej Qapmeyvo' jan jangmey — Hoch tlheghDaq qonlu'bogh nobwI'
  wuq; ghajbe'bogh ngo' tlheghmey ja'chuq ngaQlu'bogh nobwI' lo';
- chaHvo' tu'lu'bogh Hoch vIt Dov je, QInmeylIj je ngaSbogh ja'chuq Dov je, 'ej
  wa' Hal rurvetlh ghajbogh Hoch vIt;
- Qapbogh ja'chuqmey capture ghItlhHommey. vault pa' `.quarantine/<id>/…`Daq
  vIHlu', vaj vault nejwI', ghItlhHom tetlh, nej je chaHvo' chIllu'.

**nuq choHbe'lu':** QInmeylIj'egh botlu' not; ja'chuq qun choHbe'lu'; pagh teqlu'.
nobwI' veb mIwmey motlh pollu' taH — Say'moH 'oH botmoH, bot 'oHbe', vaj latlh
patDaq ja'chuq yIvIHmoH pagh nIteb Qap CLI 'e' yI'olmoH. law' ja'chuqvo' ram boq
ghItlhbogh semantic ghItlhHommey ja'chuq rar ghajbe' 'ej ghochlu'be'; vault
nejwI'Daq yIlegh.

**qun tlhabmoH je.** Hoch botmoH nobwI'meyDaj, poHDaj, mI'meyDaj je tlhej tetlh
qun, 'ej **yItlhabmoH** Degh (pagh *tlhablu'ta' &lt;jaj&gt;*). ngo' tlheghmey voq
patlh naQ cheghmoH tlhabmoH, 'ej ghItlhHommey cheghmoH. cheghbogh ghItlhHom
HeDaq ghItlhHom chu' tu'lu'chugh, `<name>-restored.md` rur chegh ngo', pat
ghItlhbogh per ghaj taH. `.quarantine` pa'vo' ghop teqlu'bogh ghItlhHom Hutlh rur
ja'lu'; latlh Hoch cheghmoHlu' taH. nIteb poison chov botmoHpu'bogh Hoch botlu' taH,
'ej botmoH ret botlu'bogh tlheghmeyvo' chenmoHlu'bogh vItmey Dovmey je. wIv rap
DabotmoHqa'chugh pagh qaS; rapbogh botmoHmey pIm tlhabmoHlaHlu'.

**chov.** Hoch botmoH tlhabmoH je chov logDaq (ta'mey `memory.quarantine.apply` /
`memory.quarantine.release`, 'ay' `memory`) 'ej De'wI' logDaq ghItlhlu'; qon naQ (ngo'
voq patlh rur tlhegh IDmey, vIHlu'bogh ghItlhHommey) qawHaq teq logDaq pollu'.

**API (joH neH; MemoryEntryDaq `delete`).** porgh `{providers: string[], from?:
epochMs, to?: epochMs, conversationIds?: string[]}` 'oH; lughbe'bogh porgh `400`
Suq. `GET /api/v1/memory/quarantine` `{entries, providers}` nob; `POST
/api/v1/memory/quarantine/preview` `{counts}` nob; `POST /api/v1/memory/quarantine`
`201 {id, counts}` nob, pagh botmoHnISbogh pagh taHDI' `200 {id: null}`; `POST
/api/v1/memory/quarantine/:id/release` Sovbe'lu'bogh IDvaD `404`, tlhablu'ta'DI'
`409` nob.

## qawHaq tetlh lIng (teqlu') {#shared-memory-blocks-retired}

ghoqwI' janmey `memory_block_read` `memory_block_write` je tu'lu'be' DaH. tetlhmeyDaq
ghoqwI'pu' polpu'bogh chIllu'be': chu'choH ret wa'DIch taghDI', Hoch tetlh EYAS
qawHaqDaq wa'logh cha'loghlu', pat ghItlhbogh ghItlhHom rur, 'ej ghIq latlh qawHaq
rur tu'lu' — taHbogh qawqa'Daq, `memory_search` `memory_expand` je lo'taHvIS (`rw:`
Sam rur). qo' qawHaq moj tetlhmey, reH rurmo' (Hoch ghoqwI' Hoch tetlh laDlaH). QaHwI'vaD
ra' rurbogh ghItlh ghajbogh tetlh chovvaD pollu' 'ach qawqa'lu' not. tetlhDaj
`memory_block_*` pongbogh ghoqwI' janmeyvetlh Suqbe' neH; pagh luj.

## rarwI' {#related}

- [Sov pa'](/docs/tlh/knowledge/knowledge-base/)
- [ghItlhmey](/docs/tlh/knowledge/documents/)
- [Qu' wiki](/docs/tlh/knowledge/client-wiki/)
- [nobwI'pu'](/docs/tlh/ai/providers/) (CLI nIteb)
- [Hub 'ej pegh](/docs/tlh/admin/security-privacy/) (EYAS Hur qawHaq)
- [De' chel](/docs/tlh/admin/data-port/)
- [SeH](/docs/tlh/deploy/configuration/) (`memory.l0.*` ngaQmey)
- [janmey](/docs/tlh/automation/tools/)
- [OpenCode](/docs/tlh/automation/opencode/) (OpenCode qoDDaq qawHaq janmey)
- [bejlaH](/docs/tlh/admin/observability/) (nobwI' qawHaq nobta'ghach)
