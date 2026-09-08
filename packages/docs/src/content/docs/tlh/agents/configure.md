---
title: chu' 'ej SeH
description: ghoqwI' pong, pat, janmey, Huch, He rarmey yIcher.
---

**nuqmeH.** **Configuration** nav SQL qa' 'oH: pong, Qu', pat, effort, janmey, mevmey, jar token Huch. Qu' Daq navmey 'ej QIch latlh navmey. nuv DachenDI' Dochvam Dachu'; Qu' choHDI' Dochvam DachoH.

## ghorgh yIlo'

- ghoqwI' Dachen, pong, Segh, pat, jan tetlh poQ.
- ngogh ghoqwI' `read_file` / `edit_file` / `grep` CLI Hutlh ghajnIS.
- jar token ngaQ, pagh `0` = meQbe'.
- Telegram (pagh latlh He) ghoqwI'vamDaq 'elnIS.
- prompt coach system mu'tlhegh yIQey — QIchbe', Qu' yoSbe'.

## motlh mIw

1. **ghoqwI'pu'** → ghoqwI' yIchu' (pagh **Create Agent**) — He `/agents/:id`, **Configuration** nav.
2. **Name**, **Role**, **Tier**, **Agent Type**, **Model** (pagh **Auto (routing decides)**), **Tools**, **Constraints** yIchel.
3. ngaQ poQchugh **Monthly Token Budget**. **Channels**Daq He yIrar, 'el naDev poQchugh.
4. **Save Changes**. ghoqwI'vam noblu'bogh chu' ja'chuq pat, janmey, mu'tlheghvetlh lo'nIS.

## pat

**He:** `/agents/:id` → vay' **SeHmey**.

Qu' QaptaHchugh **tokens HoS** Del 'ej **vangtaH…** je 'anglu'.

## Segh

| De' | QIj |
|-----|-----|
| **patlh** | potlh / ghom / laHwI' ([Del](/docs/tlh/agents/overview/) yIbej) |
| **ghoqwI' Segh** | QaHwI', chenwI', pat chenwI', … |

## qa' moQ

| De' | QIj |
|-----|-----|
| **pong** | 'ang pong |
| **toy'** | toy' tlhegh puS |
| **Del** | Del tIq |
| **qa'** | qa' Del |
| **Qu'** | wuqmeH Qu' (*ghoqwI'vam wuqmeH Qu'*) |
| **qun** | He chenmoHmeH De' (*…mIn*) |
| **qab** | UIDaq 'anglu'bogh Emoji (pagh mIllogh) |
| **pat mu'tlhegh** | ghoqwI' ra'mey (patlh mu'tlheghmey tlhej) |
| **mu'tlhegh ghojwI'** | pat mu'tlheghvaD AI ghojwI' (neH Qap mIw — QIchbe', Qu' yoSbe') — [mu'tlheghmey](/docs/tlh/ai/prompts/#prompt-coach) |

## pat 'ej HoS

| De' | QIj |
|-----|-----|
| **pat** | pat ngoq, pagh **auto (He wuqwI')** |
| **auto yIchegh** | choH yIQaw' → He wuqwI' |
| **HoS** | auto / ram / jot / potlh / 'aqroS |
| HoS Del | law' = Qub HoS law', QIt, Huch law' |
| **mIw 'aqroS** | wa' Qu'Daq ghoqwI' mIw 'aqroS |

## janmey 'ej chaw'be'mey

| De' | QIj |
|-----|-----|
| **janmey (vuD lo')** | ghoqwI'vam tlhoblaH jan pongmey |
| **laHmey (vuD lo')** | laH Deghmey (chovnatlh: `research, coding`) |
| **chaw'be'mey (tlhegh wa')** | chaw'be' chutmey (chovnatlh: Qaw' Qu' pagh) |

### ghItlh ghoqwI'pu' (pat pImbe' qab)

ta' / lugh / chov Qu'vaD, potlh ghItlh janmey yInob vaj **Hoch** pat
(neH Claude Codebe') shell HutlhchoHlaH:

```
read_file, write_file, edit_file, grep, glob, git_status, git_diff, run_command, search_indexed, list_search_sources
```

| jan | lo' |
|-----|-----|
| `read_file` / `edit_file` / `write_file` | Qu' Daq / worktree bIngDaq laD 'ej nIH choH |
| `grep` / `glob` | pongmey 'ej navmey Sam |
| `git_status` / `git_diff` | chov QaH (neH laD) |
| `run_command` | chovmey / lint (Doq patlh — chaw' / nIteb vang) |

0.8.6 pa' chu'lu'bogh **ghoqwI'pu' tu'lu'bogh** janmey chu' **auto Suqbe'** — naDev
tIchel (pagh chu'qa' chovnatlhvo' yImo'qa'). naQ tetlh:
[janmey](/docs/tlh/automation/tools/).

## HoS

| De' | QIj |
|-----|-----|
| **jar tokens HoS** | jar 'aqroS; **`0` = 'aqroS Hutlh** |
| tokens lo' 'ang | tetlh / De'Daq lo' vs HoS |

## Qu'mey

| SeHwI' | QIj |
|--------|-----|
| **choHmey yItoD** | SeHmey yItoD |

## qawHaqmey vay' (neH laD tetlh)

| vay' | QIj |
|------|-----|
| **wanI'mey / Qu' qawHaq** | qawHaq patlh pongmey |
| **N qawHaqmey** | mI' |
| **potlh** | potlh chov |
| **lo'lu' N×** | lo' mI' |
| chIm Del | ghoqwI' vangtaHvIS teb'egh |

## Hemey vay' (Del)

He patmey yIrar vaj 'el QInmey ghoqwI'vam Hev. naQ De' tetlh: [Hemey Del](/docs/tlh/communication/channels/) 'ej ghoqwI' Hemey nav:

| SeHwI' | QIj |
|--------|-----|
| **He pat yIrar** | Telegram/… pat tu'lu'bogh yIwIv |
| **ghoqwI'vamvaD yIrar** | rar |
| **rarHa'** | rarHa' |
| Dotlh **rarlu' / Qagh / pegh mu' tu'lu' / SeHlu'be'** | pat yIn |
| mIw **nIteb vang** | He nIteb vang SeHlaH |

## latlh

- [qa' 'ej Qu' Daq](/docs/tlh/agents/identity-workspace/)
- [QIch Delmey](/docs/tlh/agents/voice/)
- [nobwI'pu'](/docs/tlh/ai/providers/)
