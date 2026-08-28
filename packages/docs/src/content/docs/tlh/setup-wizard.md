---
title: lIng pIn'a'
description: wa'DIch tagh pIn'a' — Hoch mIw, De', SeHwI' je QIjlu'.
---

lIng rInbe'taHvIS **wa'logh** Qap pIn'a'. poQlu'bogh mIwmey rInpa' `/setup`Daq qunI'wI' ngeHlu'. poQbe'bogh mIwmey narghlaH 'ej ghIq SeHmeyDaq rInlaH.

Hoch mIwDaq nach:

| SeHwI' | QIj |
|--------|-----|
| **Hol** | Qu' UI Hol (`en` / `hu` / `de` / `es` / `fr` / `tlh`). lo'wI' Hol pa'Daq pol. |
| **Dal** | qal chovnatlh (Halo, Nebula) + wov/Hurgh wIv. |
| **mIw N / M** | loSbogh mIwmey vI'. |
| **taH / lIng yIrIn** | DaH mIw yInob 'ej veb yIghoS. |

---

## mIw pong (motlh)

| pong | mIw ID | poQlu' | pat |
|-----:|--------|--------|-----|
| — | Dal / Hol (UI nach) | — | frontend |
| 1 | **potlh pegh mu'** | HIja' | secrets |
| 2 | **potlh pIn** | HIja' | auth |
| 3 | **potlh ghoqwI'pu'** | HIja' | auth |
| 4 | **ghom ghoqwI'pu'** | ghobe' | auth |
| 5 | **AI nobwI'** | motlh | model |
| 6 | **AI patmey** | motlh | model |

lIng naQ pat'e' — taghDI' mIwmey lucher patmey. potlh Qu' poSmoHpa' poQlu'bogh mIwmey rInnIS.

---

## potlh pegh mu'

**meq:** polbogh Hoch peghmey (API peghmey, chaw'mey) So'lu'.

| De' | poQlu' | Del |
|-----|--------|-----|
| **potlh pegh mu'** | HIja' | peghmey So' qawHaqvaD mu'tlhegh. HoS yIwIv; 'oH Hutlhchugh nobwI' peghmey nIHqa'nIS. |
| **pegh mu' yIQap** | HIja' | potlh pegh mu' rapnIS. |

mIwvam rInDI', UI vo' peghmey So'taHbogh pegh pa' ghoSlu'.

---

## potlh pIn

**meq:** potlh Human pIn chenmoH (`role: owner`, `is_root_owner`).

| De' | poQlu' | Del |
|-----|--------|-----|
| **lo'wI' pong** | HIja' | yI'el pong (chu' chovnatlh: `admin`). wa' neH. |
| **pegh mu'** | HIja' | lo'wI' pegh mu' (mI'lu'; pIj De'Daq polbe'lu'). |
| **cha' pong** | ghobe' | UIDaq bang pong (chImchugh lo'wI' pong motlh). |

pIn'a' potlh pIn peghmey **qawDaq** pol taHmeH poQbe' mIwmey yI'eltaHbogh pIn poQbogh QaplaH yI'elqa'be'. pIn'a' botlhDaq poQbe' mIwmey neH ratlhDI' qa'chugh, **yI'el**Daq ngeHlu' 'ej `/setup`Daq cheghlaH.

---

## potlh ghoqwI'pu'

**meq:** cha' reH Qapbogh ghom lo'wI'pu' chenmoH.

| De' | poQlu' | Del |
|-----|--------|-----|
| **jIH QaHwI'** | HIja' | jajvam ghoqwI'lIj cha' pong (Jarvis). patlh: potlh, Segh: assistant. **general** Qu' SeghDaq rar. |
| **pat QanwI'** | HIja' | EYAS chenqa'bogh ghoqwI' cha' pong (R2D2). patlh: potlh, Segh: engineer. **eyas** Qu' SeghDaq rar. |

HochvaD chenmoHlu'bogh:

- `agent_definitions` tlhegh (pat, janmey, vum Daq He, …)
- vum Daq Sor `data/agents/<id>/` bIngDaq (IDENTITY, AGENTS, TOOLS, MEMORY, SOUL, …)
- rarlu'bogh **ghoqwI' lo'wI'** qaw (`is_agent = 1`) chaw'mey / pongvaD

ghIq **ghoqwI'pu'** bIngDaq pongchoHlaH 'ej SeHchoHlaH.

---

## ghom ghoqwI'pu' (poQbe')

**meq:** potlh ghoqwI'pu' nobHa'laHbogh laH chovnatlhmey chu'.

| SeHwI' | Del |
|--------|-----|
| **chuplu'** | motlh lIngvaD wovmoHlu'bogh chovnatlh tetlh. |
| **laHwI'pu'** | poQbe' ghoqwI' chovnatlhmey naQ tetlh. |
| **Hoch yIwIv / Hoch yIwIvHa'** | wa'logh wIv. |
| **N wIvlu'** | wIvlu'bogh chovnatlhmey mI'. |
| **nargh / taH** | laHwI'Hutlh rIn, pagh wIv yIlo'. |

wIv chovnatlh IDmey rur 'ej taH ghoqwI'pu'Daq chenmoHlu' (potlh rur vum Daq mIw). ghIq SeHmey / ghoqwI'pu' bIngDaq choH.

---

## AI nobwI'

**meq:** wa' pat 'emDaq tu'lu' 'e' yIHonbe'.

### juH CLI (tu'lu'chugh)

| SeHwI' | Del |
|--------|-----|
| Degh (Claude / Grok / Kimi) | juH CLI tu'lu' 'ej lo'laH — **API pegh pagh**. |
| **potlh CLI** | ghoqwI'pu' He jevaD motlh tu'lu'bogh CLI 'Iv. |
| **latlh nobwI' yIlo'** | chal/juH API SeHDaq jaH. |
| **tu'lu'bogh CLIDaq chegh** | CLI jIHDaq chegh. |

### nIH / API nobwI'pu'

| SeHwI' | Del |
|--------|-----|
| nobwI' tetlh | Sovlu'bogh 'emDaqmey (Anthropic, OpenAI, Gemini, xAI, Ollama, …). |
| **Qap / Qapbe'** | HevaD nobwI' chu'lu''a'. |
| **SeH / pegh yIchoH** | API pegh ghItlh poSmoH. |
| **API pegh** De' | pegh; So'taHbogh pegh pa'Daq toDlu'. |
| **toD** | pegh yIpol 'ej nobwI' lo'laH yIper. |
| **chovqa'** | juH He (Ollama URL) yIngu'qa'. |
| **taH / lIng yIrIn** | pagh QaptaHchugh je ghoS (ghIq SeHmey → nobwI'pu'Daq rInlaH) — qachDaq ghuH yIlegh. |

---

## AI patmey

**meq:** nobwI' ghuHDI' Hoch ghoqwI'vaD taH pat yInob.

| SeHwI' | Del |
|--------|-----|
| **ghoqwI'** tetlh | ret mIwmeyvo' ghoqwI' pong. |
| **pat** tetlh | potlh/QaptaHbogh nobwI' patmey tetlh (QaQ wIvlu'ta'). |
| **lo'** | nobmey yItoD. |
| **nobwI'pu'Daq yIghoS** | pagh SeHlu'chugh naQ nobwI'pu' UIDaq jaH. |
| **lIng yIrIn** | pIn'a' yImev 'ej potlh Qu'Daq 'el. |

nobwI' tu'lu'be'chugh: pIn'a' rInDI' nobwI'pu' yIlIng 'e' chup ghuH yItlha'.

---

## pIn'a' rInDI'

| ghoS | meq |
|------|-----|
| [jIH Daq](/docs/tlh/daily/home/) | ratlhbogh poQbe' Qu'vaD lIng chupmey |
| [nobwI'pu'](/docs/tlh/ai/providers/) | latlh 'emDaqmey, peghmey, patmey tIchel |
| [ghoqwI'pu'](/docs/tlh/agents/overview/) | potlh 'ej laHwI'pu' tIchov |
| [lo'wI'pu'](/docs/tlh/admin/users/) | Human lo'wI'pu' tIchel (lo'wI' law'chugh) |

## Hub Del

- potlh pegh mu' **peghmey** Hub, SQLite teDwI' So' neHbe' — juH ngaSwI' qonmey je tIHub.
- potlh pIn pegh mu' potlh pegh mu' rurbe'.
- ghoqwI' «lo'wI'pu'» Human yI'el mey 'oHbe'; pong 'ej ACL rarvaD tu'lu'.
