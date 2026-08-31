---
title: qawHaq
description: EYAS qaw — auto vault ghItlhHommey, vagh 'ay', 'ej 'Iv pa' yIlo'.
---

**nuqmeH.** qawHaq EYAS nI' pa' 'oH. ja'chuqDaq nI' wanI' Daja'DI' vault ghItlhHom chenmoHlu', 'ej ghItlhHomvam latlh ja'chuqmey laDqa'. naDev taH loghmey, wanI' De', vault navmey, chov tetlh Dabej — wiki Dacherbe'.

## ghorgh yIlo'

- QaHwI' SoH, vum mIw, pagh Qu' mevmey qawnIS.
- ja'chuqDaq wanI' ja'lu', vaultDaq 'elpu''a' (pagh qatlh capture Skip) 'e' yIHon.
- chov, pong, De' nav, pagh ghom — pagh **Today's note**.
- qawHaq, Sov wiki, ghItlhmey, ghop vault navmey DIwIv (bIng yIbej).
- paqvam capture chu'Ha' (`memory.capture.enabled: false`).

## motlh mIw

1. **qawHaq** yIpoSmoH 'em tlheghDaq (**De'**) — He `/memory`. (**SeHmey → AI pat je** jeDaq tu'lu'.)
2. **Overview** yIbej, ghIq nI' ghItlhHommeyvaD **Vault Files**.
3. ~40 pongmey tlhoS ja'chuq nI' wanI' ja'. jang ret naDev chegh — chu' vault ghItlhHom (`user`, `feedback`, `domain`, `project`, pagh `reference`).
4. pagh narghchugh: puS, capture HuS, pagh God Mode mIw (vetlh capturebe'). poQtaHchugh vaultDaq ghop yIghItlh.

## 'Iv pa' yIlo'

| pa' | Qu' |
|-----|-----|
| **qawHaq** (navvam) | auto + ghoqwI' ghItlh wanI'mey. EYAS wa' tlhegh index latlh mu'tlheghmeyDaq chel. |
| **Sov** wiki | navmey **SoH** choH. capture naDev ghItlhbe'. |
| **ghItlhmey** | chellu'bogh teDwI'mey SuqmeH — qa' ghItlhHombe'. |
| **vault navmey** (ghop markdown) | capture vault rap (`data/vault/…`). `~/.claude` / `~/.grok` 'oHbe'. |
| **Qu' wiki** | wa' Qu' ticket 'ej wuq navmey, qo' qawHaqbe'. |

qach Claude / Grok qawHaq **'oHbe'** wanI' mo'. CLI Hop 'ej motlh chu'Ha' `loadClaudeMd` cha' qawHaq vault tlhoSbe'meH tu'lu'.

## pat

**He:** `/memory`. bIng mu': *qawHaq pat vagh 'ay' — taH, wanI', Sov/mIw vault, qon pa'.*

## ta'mey

| SeHwI' | QIj |
|--------|-----|
| **DaHjaj ghItlhHom** | DaHjaj ghItlhHomDaq yIjaH / yIchenmoH |
| **DaH yIwa'moH** | wa'moHwI' yIQeq (qawHaqmey tInmoH/machmoH) |
| **yIchu'qa'** | mI'mey yIchu'qa' |

## navmey

| nav | ngaSbogh |
|-----|----------|
| **Hoch Del** | mI' + potlh mIllogh + wanI' chu' |
| **taH qawHaq** | poH mach tetlhmey (24h) |
| **wanI' qawHaq** | De'/wanI'mey potlh ghaj |
| **vault ghItlhmey** | Markdown vault nejwI' |
| **qon pa'** | potlh mach qonlu'ta' Dochmey |
| **rarwI' nav** | qawHaq rarwI' nav |
| **pongHommey** | pongHom nejwI' |
| **bej** | qawHaq QaQmeH bej tetlh |

## Hoch Del mI'

| mI' | QIj |
|-----|-----|
| **taH tetlhmey** | taH tetlhmey Qap (24h TTL) |
| **wanI' De'** | wanI' mI' (+ lughbe'moHlu') |
| **vault ghItlhmey** | Sov+mIw Markdown ghItlhmey |
| **qonlu'ta'** | potlh mach qon pa' mI' |
| DilmeH ruch → vault | potlh wanI' wIvlu'bogh |
| bIngmojmeH ruch → qon pa' | potlh mach wIvlu'bogh |
| potlh mach/motlh/tIn | Sem |
| pongHom potlh / mung mo' | chev Del |

## taH qawHaq tetlh

Seghmey · N-logh naw'lu' · mev poH

## wanI' tetlh / Del

| mIw | QIj |
|-----|-----|
| **potlh** | potlh chovnatlh |
| **lughbe'moHlu'** | DaH voqlaHbe' / DaHbe' |
| **ID / mung / mung ID / ghoqwI'** | mung Del |
| **naw' mI' / ja'chuq mI'** | lo' |
| **lughtaHvIS / lughbe'moHlu' poH / chenmoHlu' / naw'lu' Qav** | yIn poH |
| **embedding hash** | jech tetlh tu'lu' |

## vault nejwI'

| SeHwI' | QIj |
|--------|-----|
| ghItlh tetlh | vault He |
| **Frontmatter** | YAML Del |
| **pongHommey / rarwI'mey** | wikilinkmey 'ej pongHommey |
| **ngaSbogh** | Markdown porgh |
| **rarqa'wI'mey** | naDev rar ghItlhHommey |

## qon pa'

qonlu' poH · wa'DIch chenmoHlu' · IDmey — potlh mach Dochmey naDev vIH wa'moHwI'.

## taHbogh ghItlhHommey

taHbogh ghItlhHom 'oH ratlhbogh vIt'e', qaSpu'bogh wanI' qon ghobe': 'Iv SoH,
chay' Qu' ta'nISlu', 'ej nuq poQ nab. Hoch ghItlhHom markdown teywI' 'oH
qawHaqDaq, 'ej Hoch mIwDaq **wa' Dov tetlh** Hev ghoqwI' — chuvmey neH. potlh
DaqDaq, `search_memory` lo'taHvIS naQ ghItlhHom laD.

cha' frontmatter Dochmey SeH: `kind` (`user`, `feedback`, `domain`,
`project`, `reference` — 'ej mIw tlhegh je) 'ej `summary` (tetlhDaq Dov). `user`
`feedback` je nIH. `domain` 'oH project Segh'e' (loSpu' nIv); `project` 'oH
wa' jabbI'ID'e'. `kind` Hutlhchugh: `procedural/` bIngDaq `feedback`,
latlhDaq `reference` — `user` net wIvbe' pagh. `summary` Hutlhchugh, wa'DIch
Dov teH lo'lu', vaj ghop ghItlhlu'bogh teywI' vum, EYAS frontmatter Hutlh je.

DaqmeyDaq: `data/vault/semantic|procedural|projects|project-types/`.

**ghItlh'egh ghItlhHommeyvam.** jangta'DI' EYAS, `model` mach lo'lu': ja'chuq
laD 'ej ghel — jar wa' ret ratlhtaH'a' vay', lI'taH'a' je? wa' mIwDaq cha'
ghItlhHommey chenmoHlaH; motlh pagh chenmoHlu', 'ej lugh. jangmeH He potlhDaq
qaSbe': qon lujchugh, ghItlhHom Hutlhlu' neH, jang Hutlhlu'be'.

ra'meH He: wa' juv neH. `minUserChars` (motlh 40 ngutlh) rIttaHbe'bogh QIn
`model` ra'be'. 'ej wa' ja'chuqDaq `maxPerConversation` (20) ra' neH chaw'lu'.
pagh HolDaq mu' tetlh tu'lu'. Hoch DamevmeH: `config/default.yaml`Daq
`memory.capture.enabled: false`. ghop ghItlhlu'bogh ghItlhHom `save_memory` je
rIttaH.

wa' vIt qaSqa'DI', ghItlhHom chu' chenmoHbe'lu': ghItlhHom tu'lu'bogh
chelqa'lu' — jaj ghajbogh Dov 'oH `## History` bIngDaq, 'ej ngo'wI' qa'moHbe'.
teywI'Daq ghItlhpa', `privacy` patHom Say'moH.

**nab qawHaq.** nab ja'chuqmeyDaq ghojlu'bogh vIt `projects/<nab-id>/`Daq
lanlu'; nabvamDaq vum'a'DI' lo'wI', motlh `reference` ghItlhHommey nIH; latlh
DaqDaq narghbe' — latlh nab ghItlhHommey `prompt` luSIchbe' not. Hoch ja'chuq
taghbogh **General** nab: nab 'oHbe'. pa' ghojlu'bogh vIt SoHvaD vIt 'oH, pagh
Qu' mIwvaD vIt 'oH, vaj Dat SoH lutlha'.

ghoqwI'pu' `search_memory` lo'. motlh **`scope` `current`**: Qu'vam, SeghDaj, 'ej Hoch user / feedback / reference ghItlhHommey. `scope: all` vault naQvaD. qawHaq jaj nej (`/memory`) pe'be'.

### capture motlh chu'

capture **Hoch** ja'chuqDaq Qap, qo'Daq, `memory.capture.enabled: false` `config/default.yaml`Daq Hutlhchugh. mach pat mI' jang noblu'pu'DI' chel — not potlh HeDaq. capture Qapbe' Hutlh ghItlhHom 'oH, ja'chuq Qapbe'be'.

| ngaQ | motlh | QIj |
|------|-------|-----|
| `memory.capture.enabled` | **chu'** | potlh chu' |
| `minUserChars` | 40 | Unicode pongmey |
| `maxPerConversation` | 20 | pat Huch 'aqroS |

mu' tetlh tu'lu'be'. `{"notes":[]}` motlh 'ej QaQ extractor jang (0–2 ghItlhHom).

### Hop CLI — neH EYAS qawHaq

extraction **Hop** pat loghDaq Qap: qach filesystem SeHmey Hutlh, CLI qawHaq Hutlh, bridged janmey Hutlh, wa' mIw. Claude Code CLI ja'chuqmey motlh **`loadClaudeMd` chu'Ha'**. Hop 'ej opt-out mI'mey `CLAUDE_CODE_DISABLE_AUTO_MEMORY` 'ej `strictMcpConfig` je cher.

Grok / Kimi (ACP) Hop chu' ghajbe'; nobwI' navmey ja'. ghoqwI'pu' neH `search_memory` / `save_memory` lo'nIS; ghItlh ngaQ `~/.claude`, `~/.grok`, `ai-memory` He mev.

Hop HutlhDI' extractor joH qach qawHaq laDpu', «qonlu'ta'» ja', EYAS vault chIm taH. qabvam SoQmoH.

### capture Qu' tetlh

ngaQ SIchbogh Hoch qaS `memory_capture_runs` tetlh qon. cha' pegh: capture HuS pagh qonbe'; bIng Qu' ghoqwI' mu' Hutlh ngaQ SIchbe'. **God Mode** mIwmey capturebe' — ghItlhHom pagh, tetlh pagh.

---

## qawHaq tetlh lIng (ghoqwI' janmey)

vagh 'ay' qach tlhej, ghoqwI'pu' **logh qawHaq tetlhmey** (Letta mIw) janmey lo'laH — poH law' 'ej ghoqwI' law' Qu'vaD qonlu'ta' ghItlhHommey lIng.

| logh | lIngwI'pu' |
|------|------------|
| **company** | Hoch pat |
| **agent** | wa' ghoqwI' |
| **team** | ghom SeH |
| **run** | wa' run |

| jan | QIj |
|-----|-----|
| `memory_block_read` | tetlh ngaSbogh yIlaD |
| `memory_block_write` | chel pagh qa'moH; potlhDI' mu'tlheghmeyDaq lIng |

naDev taH qawHaq tetlhmey pIm 'ach ja'chuq rarbogh DotlhvaD teb.

## rarwI'

- [Sov pa'](/docs/tlh/knowledge/knowledge-base/)
- [ghItlhmey](/docs/tlh/knowledge/documents/)
- [Qu' wiki](/docs/tlh/knowledge/client-wiki/)
- [nobwI'pu'](/docs/tlh/ai/providers/) (CLI Hop / `loadClaudeMd`)
- [De' chel](/docs/tlh/admin/data-port/)
- [janmey](/docs/tlh/automation/tools/)
