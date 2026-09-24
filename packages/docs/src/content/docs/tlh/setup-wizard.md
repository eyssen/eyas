---
title: lIng pIn'a'
description: wa'DIch tagh pIn'a' — Hoch mIw, De', SeHwI' je QIjlu'.
---

**nuqmeH.** wa'DIch tagh neH. pIn'a' potlh pegh mu', potlh SeHwI', cha' potlh ghoqwI'pu', wa'DIch pat 'em je chenmoH, vaj potlh Qu' poSlu'. ghIq **SeHmey**, **nobwI'pu'**, **ghoqwI'pu'** je bIngDaq DochmeyvetlhmoH — pIn'a' DaQapmoHqa' 'e' yIHonbe'.

## ghorgh yIlo'

- `/setup`Daq SoH ngeH qunI'wI', lIng rInbe'mo'
- DuHbogh mIw Datlhe'pu' 'ej De' tetlh DaneH
- pat chu' DacheghmoH

potlh Qu' poSDI', jaj Hoch choHvaD lo'be'lu'.

## motlh mIw

lIng rInbe'taHvIS **wa'logh** Qap pIn'a'. poQlu'bogh mIwmey rInpa' `/setup`Daq qunI'wI' ngeHlu'. DuHbogh mIwmey Datlhe'laH 'ej ghIq SeHmeyDaq DarInlaH.

Hoch mIwDaq SeHwI'mey:

| SeHwI' | QIj |
|--------|-----|
| **Hol** | UI Hol (`en` / `hu` / `de` / `es` / `fr` / `tlh`). qunI'wI' Hol SeHDaq pollu'. |
| **qal'aq** | qab chovnatlh (Halo, Nebula rur) + wov/Hurgh wIvwI'. |
| *mIw N / M* | loSbogh mIwmey vI'. |
| **yItaH / lIng yIrIn** | DaH mIw yInob 'ej yItaH. |

## mIw pong (motlh)

| mI' | mIw | poQlu' | pat |
|----:|-----|--------|-----|
| — | qal'aq / Hol (UI nach) | — | frontend |
| 1 | **potlh pegh mu'** | HIja' | secrets |
| 2 | **potlh SeHwI'** | HIja' | auth |
| 3 | potlh ghoqwI'pu' (*reH Qapbogh cha' AI juppu'lI'*) | HIja' | auth |
| 4 | **ghom ghoqwI'pu'** | ghobe' | auth |
| 5 | **AI nobwI'** | motlh | model |
| 6 | **AI patmey** | motlh | model |

mIwmey tetlhmoH 'ay'mey — taghDI' mIwmeychaj qon 'ay'mey. potlh Qu' poSpa' poQlu'bogh mIwmey rInnIS.

## potlh pegh mu'

**meq:** Hoch pollu'bogh pegh (API ngaQmey, tokens) peghmoH, lanlu'DI'.

| De' | poQlu' | QIj |
|-----|--------|-----|
| **potlh pegh mu'** | HIja' | pegh peghmoHmeH ngaQ Hap mu'tlhegh. HoS yIwIv; DachIlchugh, nobwI' ngaQmey Dachelqa'nIS. |
| **pegh mu' yI'aqqa'** | HIja' | potlh pegh mu' rap 'oHnIS. |

mIwvam ret, UIvo' ghItlhlu'bogh peghmey peghmoHlu'bogh Secrets polmeH Daq ghoS.

## potlh SeHwI'

**meq:** potlh ghot SeHwI' chenmoH (`role: owner`, `is_root_owner`).

| De' | poQlu' | QIj |
|-----|--------|-----|
| **lo'wI' pong** | HIja' | 'elmeH pong (Daq pong: `admin`). wa' neH 'oHnIS. |
| **pegh mu'** | HIja' | mab pegh mu' (hash; ngeDmey rur pollu' not). |
| **leghlu'bogh pong** | ghobe' | UIDaq pong QaQ (chImchugh, lo'wI' pong). |

owner pegh De' **qawHaqDaq** pol pIn'a' session ratlhbogh 'ay'vaD, vaj 'ellu'bogh owner poQbogh DuHbogh mIwmey Qap, 'elqa'be'lu'taHvIS. pIn'a' botlhDaq DalI'qa'chugh 'ej DuHbogh mIwmey neH ratlh, **'el** DaqDaq ngeHlu'laH, ghIq `/setup`Daq cheghlaH.

## potlh ghoqwI'pu'

**meq:** reH Qapbogh cha' **jup** bIjatlhbogh chenmoH (retlh nav **juppu'**, Hoch juH ja'chuq). HaSta'Daq: *reH Qapbogh cha' AI juppu'lI'*.

| De' | poQlu' | QIj |
|-----|--------|-----|
| **lo'wI' QaHwI' — jaj-jaj AI juplI'** | HIja' | jaj Hoch ghoqwI'lIj pong (chovnatlh: Jarvis). patlh: potlh, Segh: QaHwI'. **general** Qu' SeghDaq rarlu'. |
| **pat QapmoHwI' — EYAS QapmoH** | HIja' | EYAS'egh QaHbogh ghoqwI' pong (chovnatlh: R2D2). patlh: potlh, Segh: chenwI'. **eyas** Qu' SeghDaq rarlu'. |

Hoch wa'vaD chenlu':

- `agent_definitions` tlhegh (pat, janmey, Qu' Daq He, …)
- `data/agents/<id>/` bIngDaq Qu' Daq Sor (IDENTITY, AGENTS, TOOLS, MEMORY, SOUL, …)
- rarlu'bogh **ghoqwI' lo'wI'** qon (`is_agent = 1`) chaw'meyvaD ponglu'meH je

ghIq **ghoqwI'pu'** bIngDaq DaponglaH 'ej DaSeHqa'laH. pIn'a' ret, retlh nav **juppu'** tetlhvo' yIpoSmoH. QaHwI' SeH 'ej Hal ngoq choHbe'; pat 'ej ngoq ghaj chenwI'. [ghommey Segh je](/docs/tlh/agents/teams/) yIbej.

## ghom ghoqwI'pu' (DuH)

**meq:** latlh **juppu'** (ghom patlh) 'ej **laHwI'pu'** (Hoch jup taghlaHbogh tetlh rap) chu'moH. chu'lu'bogh laHwI' ra'meH chup chaw' poQbe' potlh ghoqwI'pu'.

| SeHwI' | QIj |
|--------|-----|
| **chuplu'** | motlh lIngvaD chuplu'bogh chovnatlhmey. |
| **tejwI'pu'** | DuHbogh ghoqwI' chovnatlh tetlh naQ. |
| **Hoch yIwIv / Hoch yIwIvHa'** | Hoch wIv. |
| *N wIvlu'* | wIvlu'bogh chovnatlh mI'. |
| **tlheD / yItaH** | laHwI'pu' Hutlh yIrIn, pagh wIv yIlo'. |

chovnatlh IDmey rur pollu' wIv, 'ej ghoqwI'pu' naQ moj (potlh ghoqwI'pu' Qu' Daq mIw rap). ghIq **SeHmey → ghoqwI'pu'** bIngDaq yIchoH.

## AI nobwI'

**meq:** wa' pat 'em tu'lu' 'e' yI'ol.

### juH CLImey (tu'lu'chugh)

| SeHwI' | QIj |
|--------|-----|
| Degh (*Claude Code tu'lu' 'ej SeHlu'* / *Grok CLI …* / *Kimi Code CLI …*) | naDev CLI tu'lu' 'ej lo'laH — **API ngaQ poQbe'**. ClaudevaD, *tu'lu' 'ej SeHlu'* QIj: Claude Code Qap tagh **'ej 'ellu'** (claude.ai 'el, `ANTHROPIC_API_KEY`, pagh Bedrock/Vertex SeH); PATHDaq `claude` tu'lu'mo' neH yap be'. [nobwI'pu' — Claude Code Qap](/docs/tlh/ai/providers/#claude-code-runtime) yIbej. |
| **EYASvaD yI'el** (Grok / Kimi) | Grok CLI pagh Kimi Code CLI tu'lu'DI' reH 'ang. juHDaj'egh Daq CLImeyvam Qap EYAS, 'ej De'wI'vam CLI 'el lo'be'; vaj naDev EYASvaD wa'logh yI'el: **jan ngoq lo'taHvIS yI'el** (cha') — Hoch janDaq rar yIpoSmoH 'ej ngoq yI'ol, QInwI'Daq leghwI' poQbe' — pagh **API ngoq yIlo' neH** (Grok, xAI API ngaQ). [nobwI'pu' — EYASvaD Grok Kimi je 'el](/docs/tlh/ai/providers/#sign-in-grok-and-kimi-for-eyas) yIbej. |
| **potlh CLI** | law' CLImey tu'lu'DI' 'ang: ghoqwI'pu' 'ej HevaD 'Iv motlh. lIng motlh nobwI' pat je moj, 'ej motlh patlh SeHlu'be'chugh pat ponglu'be'bogh qoD ra'mey jang je — [He 'ej Huch](/docs/tlh/ai/routing-budget/#default-binding) yIbej. |
| **latlh nobwI' yIlo'** | 'engDaq pagh naDev API SeHDaq ghoS. |
| **tu'lu'bogh CLIDaq yIchegh** | CLI leghDaq chegh. |

### lo'wI' SeH / API nobwI'pu'

| SeHwI' | QIj |
|--------|-----|
| nobwI' tetlh | Sovlu'bogh 'emmey (Anthropic, OpenAI, Gemini, xAI, Ollama, …). |
| **taH / taHbe'** | HevaD nobwI' chu'lu''a'. |
| **SeH / ngaq yIchoH** | API ngaQ chelmeH Daq poSmoH. |
| API ngaQ De' (*API ngaq yIghItlh…*) | pegh; peghmoHlu'bogh Secrets DaqDaq pollu'. |
| **toD** | ngaQ pol 'ej nobwI' lo'laH. |
| **chovqa'** | naDev Daq chovqa' (chovnatlh: Ollama URL). |
| **yItaH / lIng yIrIn** | wa' chu'lu'be'chugh je yItaH (ghIq SeHmey → nobwI'pu'Daq DarInlaH) — HaSta' QIj yIlaD. |

## AI patmey

**meq:** nobwI' ghuSDI', Hoch ghoqwI'vaD pat nob.

| SeHwI' | QIj |
|--------|-----|
| **ghoqwI'** tut | ngo' mIwmeyvo' ghoqwI' pong. |
| **pat** tut | chu'lu'bogh nobwI'pu' patmey wIvwI', Hoch *nobwI' / pat* rur 'anglu' (QaQqu'wI' wIvlu'pu'); **— pagh —** ghoqwI' pat choHbe'. |
| **lo'** | nobmey pol. Hoch DawIvbogh nobwI' + pat cha' rur ngeHlu' pollu' je, vaj cha' nobwI' tetlhbogh pat ID ngeb not; pat tetlhDaq tu'lu'be'bogh cha' tlhe'lu'. |
| **nobwI'pu'Daq yIghoS** | pagh SeHlu'chugh, nobwI'pu' nav naQDaq ghoS. |
| **lIng yIrIn** | pIn'a' rIn 'ej potlh Qu'Daq 'el. |

nobwI' tu'lu'be'chugh (*AI nobwI' tu'lu'be'*), pIn'a' ret nobwI'pu' navDaq wa' yISeH.

## pIn'a' ret

| ghoSmeH Daq | qatlh |
|-------------|-------|
| [wa'DIch rep](/docs/tlh/first-hour/) | QaptaHbogh UI yIleng: jIH Daq, wa' ja'chuq, Qu' nav, qawHaq |
| [jIH Daq](/docs/tlh/daily/home/) | ratlhbogh DuH Qu'vaD lIng chupmey |
| [nobwI'pu'](/docs/tlh/ai/providers/) | latlh 'emmey, ngaQmey, patmey chel |
| [ghoqwI'pu'](/docs/tlh/agents/overview/) | juppu' 'ej laHwI'pu' yInuD |
| [ghommey Segh je](/docs/tlh/agents/teams/) | chay' Qu' nob juppu' 'ej laHwI'pu' tagh |
| [lo'wI'pu'](/docs/tlh/admin/users/) | ghot lo'wI'pu' chel (law' lo'wI'pu'chugh) |

## Hub QIjmey

- **peghmey** Qan potlh pegh mu'; SQLite teywI' peghmoHbe''egh — juH De'wI' ngaSwI' 'ej qonmey yIQan.
- potlh SeHwI' pegh mu' potlh pegh mu' rarbe'.
- ghoqwI' «lo'wI'pu'» ghotvaD 'elmeH mabmey ghobe'; qa' 'ej chaw' SeHvaD tu'lu'.
