---
title: chu' 'ej SeH
description: ghoqwI' pong, pat, janmey, Huch, He rarmey je yIcher.
---

**nuqmeH.** **SeHmey** nav ghoqwI' qa' polta'lu'bogh 'oH: pong, toy', pat, HoS, janmey, chaw'be'mey, jar tokens HoS je. Qu' Daq teywI'mey 'ej QIch Delmey latlh navmey. nuv DachenmoHDI' Dochvam Dachel; Qu'Daj choHDI' Dochvam DachoH.

## ghorgh yIlo'

- ghoqwI' DachenmoHtaH, pong, Segh, pat, jan tetlh je DaneH.
- API patDaq ngogh ghoqwI' `read_file` / `edit_file` / `grep` ghajnIS, CLI Hutlh.
- jar tokens 'aqroS Huch mevmoHnIS, pagh DateqneH (`0` = 'aqroS Hutlh).
- Telegram (pagh latlh He) 'el QInmey ghoqwI'vamDaq ghoSnIS.
- pat mu'tlhegh QaDmoH **mu'tlhegh ghojmoHwI'** DaneH — QIch ghobe', Qu' yoS ghobe'.

## motlh mIw

1. **ghoqwI'pu'** yIpoSmoH → ghoqwI' yIwIv (pagh **ghoqwI' yIchu'**) — He `/agents/:id`, **SeHmey** nav. **ghoqwI' yIchu'** ghojmoHwI' ja'chuq pat ponglu'be': lIng motlh patDaq Qap, wa'DIch QInDaj ngaQlu'.
2. yIchel: **pong**, **toy'**, **patlh**, **ghoqwI' Segh**, **pat** (nobwI' + pat, pagh **ja'chuq model ghaH**), **HoS**, **janmey (vuD lo')**, **chaw'be'mey (tlhegh wa')**.
3. 'aqroS DaneHchugh **jar tokens HoS** yIcher. 'el QInmey naDev ghoSnIS, **Hemey** navDaq He yIrar.
4. **choHmey yItoD**. ghoqwI'vam tlhejbogh ja'chuq chu' pat, jan tetlh, mu'tlhegh je lo'.

## pat

nav nachDaq **tokens HoS** Del 'ang, 'ej Qu' QaptaHvIS **vangtaH…**. navmey: **SeHmey**, **qawHaqmey**, **QIch**, **Qu' Daq**, **Hemey**.

## Segh

| De' | QIj |
|-----|-----|
| **patlh** | **potlh** / **ghom** = juppu' bIjatlhbogh; **laHwI'** = tetlh rap, poQlu'DI' taghlu' ([Del](/docs/tlh/agents/overview/) yIbej) |
| **ghoqwI' Segh** | **QaHwI'**, **chenwI'**, **pat chenwI'**, **chovwI'**, **pIchwI'**, **tej**, **nabwI'**, **SeHwI'**, **bejwI'** |

## qa' moQ

| De' | QIj |
|-----|-----|
| **pong** | 'anglu'bogh pong |
| **toy'** | toy' tlhegh puS |
| **Del** | Del tIq |
| **Qu'** | wuqmeH Qu' (*ghoqwI'vam wuqmeH Qu'*) |
| **qun** | He chenmoHbogh De' (*ghoqwI' He je mIn chenmoHmeH De'*) |
| **qab** | UIDaq 'anglu'bogh Emoji |
| **pat mu'tlhegh** | ghoqwI' ra'mey (patlh mu'tlheghmey tlhej) |
| **mu'tlhegh ghojmoHwI'** | pat mu'tlheghvaD AI ghojmoHwI' (Qap mIw neH — QIch ghobe', Qu' yoS ghobe') — [mu'tlheghmey](/docs/tlh/ai/prompts/#prompt-coach) |

<h2 id="model--effort">pat 'ej HoS</h2>

| De' | QIj |
|-----|-----|
| **pat** | nobwI' 'ej pat, nobwI' ghommey ngaSbogh tetlhvo' wIvlu' — pagh **ja'chuq model ghaH** (chIm): ghIq ja'chuq patDaq Qap jup — nobbogh mIw pat, pagh wa'DIch lo'DI' ngaQlu'bogh lIng motlh ([ghommey Segh je](/docs/tlh/agents/teams/#which-model-and-effort-a-specialist-or-member-uses)) |
| teq Degh | *ja'chuq model ghaH yIlo'* — pat teq; qonDI' teqlu' net |
| Doq QIj | *&lt;nobwI'&gt; / &lt;pat&gt; nobwI' chu'bogh model chu'lu'bogh ghaH'be'. chegh net, ja'chuq model ghaH lo' ghoqwI'vam.* |
| **HoS** | ja'chuqmeyDaq vum wIvwI' rap: ghoqwI' pat nobbogh patlhmey neH (**pagh**, **machqu'**, **ram**, **motlh**, **jen**, **jenqu'**, **'aqroS**vo'; chu'/chu'Ha' patvaD **Qap** / **QapHa'**), wa'DIch **auto**, pat motlh 'angbogh (*auto · model motlh (motlh)*). qonlu'bogh patlh nobbe'bogh pat DawIvDI', qonpa' choHlu' 'ej ja'lu' (*vum choHlu': jenqu' → jen. jenqu' nobbe' model wIvlu'bogh.*); vum SeH ghajbe'bogh pat autovaD choH. pat lajbe'bogh patlh qonlu'be', 'ej pat lajbogh patlhmey tetlh QIn — mIwDaq ratlh latlh choHmeylIj. ngaQlu'bogh pat Hutlhchugh, He nISbe' patlh pat lajbogh Hoch patlh nob wIvwI'. jup vum Qapbogh Hoch DaqDaq Qap — ja'chuqDaj, juH ja'chuqDaj, He jangmey, 'ej nobbogh laHwI'pu'vaD ghoSbogh patlh rur. [nobwI'pu' — Qub vum](/docs/tlh/ai/providers/#reasoning-effort) yIbej. |
| HoS QIj | *ghoqwI'vam Qub vum — patlhmey nobbogh model neH cha'lu'; model choHlu'DI' patlh nobbe'bogh model chu' mach. auto = model motlh.* |
| **mIw 'aqroS** | wa' QapDaq pat mIw 'aqroS — jup ja'chuq mIwmeyvaD, 'ej 'em, laHwI', ghom, He Qapmeyvaj je. Claude Code, Grok, KimiDaq CLI mIw 'aqroS'e' 'oH je. polta'lu'bogh mI' ghajbe'bogh ghoqwI'vaD 10 'ang De', 'ej qonDI' 'anglu'bogh mI' pollu'. polta'lu'bogh mI' Hutlhchugh: ja'chuq mIwvaD 25, 'em / ghom / He QapvaD 20, laHwI' QapvaD 10. |

latlh Dochmey (pong, mu'tlhegh…) DaqonDI' pat ngeHqa'lu'be', vaj pat chu'Ha'lu'pu'mo' choH luj not.

**chu'choH.** chu'choH ret wa'DIch taghDI', pat tetlhDaq wa' nobwI' neH bIngDaq pat IDDaj tu'lu'bogh Hoch ghoqwI' nobwI'vetlh nIteb Suq. law' nobwI' bIngDaq tetlhlu'bogh pat IDmey, Sovbe'lu'bogh IDmey, patlh pongmey je (`sonnet` rur) nobwI' Hutlh taH; Qap poHDaq ghajwI'chajvaD rarlu', 'ej rarlaHbe'lu'chugh ja'chuq model ghaH lo'lu'.

<h2 id="tools--constraints">janmey 'ej chaw'be'mey</h2>

| De' | QIj |
|-----|-----|
| **janmey (vuD lo')** | ghoqwI'vam ra'laHbogh jan pongmey. Daq pong: *chIm = Hoch janmey · read_file, grep, research*. QIj: *chIm = Hoch janmey. ja'chuqDaq 'ej Hoch nobwI'Daq lo'lu' — CLI model Daj ghItlhmeH, shell, web janmey je. qawHaq nejmeH jan reH lo'laH; CLI modelDaq ja'chuq pa'meyDaq teywI'mey laDmeH jan je lo'laH.* |
| **laHmey (vuD lo')** | laH Deghmey (chovnatlh: `research, coding`) |
| **chaw'be'mey (tlhegh wa')** | chaw'be' chutmey (chovnatlh: Qaw' Qu' yImev) |

### janmey tetlh nuq 'oH

ghoqwI' QapmeH Hoch HeDaq rap lo'lu' tetlh: ja'chuq, ja'chuq poH Qu'mey nav Qu'mey je, `run_specialist` / `delegate_to_agent` taghbogh laHwI'pu', ghom ghoqwI'pu', He jangmey (Telegram, Slack, QIn Daq, latlh Hemey je) — 'ej Hoch nobwI'Daq: API patmey 'ej CLI patmey Claude Code, Grok, Kimi je.

- **tetlh chIm — Hoch jan.**
- pagh ghoqwI'vaD **tetlhDaq janmey neH, `memory_search` `memory_expand` je** noblu'. reH cha' EYAS qawHaq janmeyvam Suq Hoch ghoqwI', tetlhDaq Hutlhchugh je.
- **wa'** (Qu' SeH) ja'chuqDaq `run_specialist`, `delegate_to_agent`, `handoff_to_colleague`, `propose_team` teqlu' je; `memory_search`, `memory_expand`, `assign_task` (nav Qu') taH.
- ghoqwI' pat mu'tlheghDaq jan tetlh Qu'vaD noblu'bogh janmey neH ponglu'.
- **noblu'bogh jan neH lo'laH pat.** tetlh Hurbogh jan, pagh tu'lu'be'bogh jan pongchugh pat, ra' lajQo' EYAS, *'&lt;tool&gt;' is not in this agent's toolset* tlhej, 'ej Qapbe'. chaw' tlhob pagh; SIbI' lajQo'lu', Hoch nobwI'Daq.
- **Sovbe'lu'bogh pongmey teqlu'.** lIngbe'lu'bogh jan pong (ngeD Qagh, chu'Ha'lu'bogh 'ay', rarbe'bogh MCP De'wI') noblu'be', 'ej Hoch ghoqwI' jan pong jevaD wa' ghuHmoHwI' 'ang De'wI' log.
- **CLI patmeyDaq (Claude Code, Grok, Kimi) CLI janmey'egh ngaQmoH tetlh je**, Hoch CLIDaq rap:
  - **teywI' ghItlh** (Claude Code Write, Edit, NotebookEdit; Grok Kimi je choHmeH vIHmeH janmey, 'ej CLIvaD EYAS nobbogh teywI' ghItlhmey): tetlhDaq `write_file` pagh `edit_file` tu'lu'DI' neH.
  - **shell ra'mey** (Claude Code Bash; Grok Kimi je QapmeH janmey; Qaw' shell ra' rur toghlu', Hub lojmIt Segh wIvbogh rur): tetlhDaq `run_command` tu'lu'DI' neH. shell nobbe' `git_status` `git_diff` je; `run_command` Hutlhbogh tetlhDaq, rarwI' lo'taHvIS EYAS janmey rur CLIvaD noblu'.
  - **web qem web nej je** (Claude Code WebFetch, WebSearch; Grok Kimi je qemmeH janmey, Grok web_fetch web_search je): tetlhDaq web jan — `research`, `browser_navigate`, `agent_browser_run` pagh `browser_use_exec` — tu'lu'DI' neH.
  - **teywI' laD** (Claude Code Read, Glob, Grep; Grok Kimi je laDmeH, nejmeH, tetlhmeH janmey) reH chaw'lu', tetlh nuq ja' 'ach. ja'chuq pa'mey qoD taH, qawHaq chut kernel teywI' Hung je bIngDaq. qawHaq nej lo'laH taH je.
  - tetlh chIm — Hoch jan taH, CLI janmey'egh je.

  Claude CodeDaq, noblu'be'bogh janmey patvaD noblu' not. Grok KimiDaq, CLI lo' 'e' nIDbogh noblu'be'bogh jan lajQo' EYAS, Hub lojmIt tlhoblu'pa': chaw' tlhob pagh, 'ej jan tlhegh **lajQo'lu'** 'ang. Kimi chaw' tlhobmey nuq jan Segh tlhob ja'be' (Kimi 1.52.0 Halvo'; wej qachDaq chovlu'be'), vaj teywI' ghItlhmeH janmey pagh `run_command` Hutlhbogh tetlh ghajbogh ghoqwI' Kimi tlhobbogh janmey Hoch lo'laHbe' (teywI' ghItlh pagh tam, shell, 'em Qu'mey). Kimi web nej qem je EYAS tlhob not, vaj Hoch ghoqwI'vaD chaw'laHbe'lu'; lo'bogh mIw mevmoH EYAS nIteb chov taH. [nobwI'pu' — Claude Code nIteb](/docs/tlh/ai/providers/#claude-code-isolation) yIbej.
- EYAS rarwI'Daq — Claude Code qoD De'wI' 'ej Grok/Kimi MCP rarwI' rap — CLI SIchbogh EYAS janmey SeH tetlh. CLI ghajbogh 'ej chaw'lu'bogh rap janDaj'egh ghajbogh EYAS janmey (`read_file`, `grep`, `glob` reH; ghItlhlaHtaHvIS `write_file`, `edit_file`; shell lo'laHtaHvIS `run_command`, `git_status`, `git_diff`) rarlu' not: Hub lojmIt, qawHaq chut, kernel teywI' Hung je bIngDaq janmeyDaj'egh lo' CLI. CLI patmeyDaq ghoS EYAS browser, agent-browser, browser-use, OpenCode janmey je. [MCP — CLI jan rap](/docs/tlh/ai/mcp/#cli-mcp-tool-parity-grok--kimi) yIbej.

**ghoqwI'pu' tu'lu'bogh choH:** Hoch DaqDaq tetlh mach lo'lu'. chovnatlh: **jIH QaHwI'** `run_command` / `write_file` Suqbe' ja'chuqDaq, 'em Qu'Daq, laHwI' Qu'Daq, ghom Qu'Daq je — chovnatlhDaj rur — 'ej Claude Code, Grok, KimiDaq CLI Write, Edit, Bash je'egh lo'taHvIS teywI'mey ghItlhlaHbe'choH 'ej ra'mey QaplaHbe'choH je. jan DanobmeH, tetlhDaq yIchel (ghItlhmeH `write_file` / `edit_file`, shellvaD `run_command`), pagh Hoch jan chaw'meH tetlh yIteq. tu'lu'be'bogh janmey pongbogh tetlh pongmeyvetlh chIl (logDaq ghuHmoHwI' tlhej), 'ej noblu'bogh tetlh Hurbogh jan ra'bogh pat lajQo'lu'.

### ghItlh ghoqwI'pu' (pat pImbe' qab)

API patDaq ta' / lugh / chov Qu'vaD, potlh ghItlh janmey yInob vaj shell Hutlh choHlaH pat:

```
read_file, write_file, edit_file, grep, glob, git_status, git_diff, run_command, search_indexed, list_search_sources
```

| jan | lo' |
|-----|-----|
| `read_file` / `edit_file` / `write_file` | Qu' pa'mey pagh worktree bIngDaq laD 'ej nIH choH |
| `grep` / `glob` | pongmey 'ej teywI'mey Sam |
| `git_status` / `git_diff` | chov QaH (laD neH) |
| `run_command` | chovmey / lint (Doq patlh — chaw' / nIteb vang) |

CLI patmey (Claude Code, Grok, Kimi) teywI' 'ej shell janmey'chaj lo', 'ej tetlhDaq pongmeyvam chaH chaw': CLI teywI' ghItlhmey'egh poSmoH `write_file` / `edit_file`, shellDaj poSmoH `run_command`. `run_command` Hutlhchugh, rarwI' lo'taHvIS EYAS janmey rur CLIDaq ghoS `git_status` `git_diff` je.

**jIH QaHwI'** (potlh, QaHwI' Segh) SeH — `write_file` / `edit_file` / `run_command` yInobQo'. **pat QapmoHwI'** 'ej ghItlh laHwI'pu' janmeyvetlh ghaj. [ghommey Segh je](/docs/tlh/agents/teams/) yIbej.

0.8.6 pa' chenmoHlu'bogh **ghoqwI'pu' tu'lu'bogh** janmey chu' nIteb Suq**be'** — naDev tIchel (pagh chovnatlh chu'vo' yIchenmoHqa'). naQ tetlh: [janmey](/docs/tlh/automation/tools/).

<h2 id="imported-personas">tlhaplu'bogh qa'mey</h2>

`local.yaml`Daq `agent.importRoots` bIngDaq tetlhlu'bogh pa'meyDaq qa' teywI'mey ghoqwI'pu' chenmoHlaH ([SeH — latlh laH qa' Sormey je](/docs/tlh/deploy/configuration/#extra-skill-and-persona-roots)). EYASDaq DachoHbogh ghoqwI' teywI'Daj **qa'moHbe' not**:

- wa'DIch taghDI', ghoqwI'Daj chenmoH teywI'.
- veb teywI' choHmey ghoqwI' choH, **pong, toy', Del, pat mu'tlhegh, janmey je** Qav tlhapDI' rur taHchugh neH. naDev vagh Dochvetlh wa' DachoHDI', ghoqwI' choHbe' teywI'.
- patDaj, HoSDaj, chu'/chu'Ha' SeHwI'Daj, qabDaj, permeyDaj, HuchDaj neH DachoHchugh, choHmey mevbe' — tlhap ghItlhbe' chaH not.
- Dateqbogh tlhaplu'bogh ghoqwI' chenmoHqa'be'lu'. DacheghmoHmeH, [De' tlhap](/docs/tlh/admin/data-port/) lo'taHvIS teywI' yItlhap.
- tlhap chenmoHbe'bogh ghoqwI' tu'lu'bogh ID rap ghajbogh — ngaSlu'bogh chovnatlh, UIDaq chenmoHlu'bogh, pagh De' tlhapvo' — qa'moHlu' not. teywI' rur naQ DaHchugh, Suqlu' 'ej veb teywI' choHmey tlha'.
- cha' tlhap pa' qa' ID rap ghajchugh, wa'DIch tetlhlu'bogh pa' Qap; teywI'vetlh teqlu'chugh, veb pa' teywI' Suq.

**chu'choH.** ngo' chovnatlhmey tlhaplu'bogh, 'ej ghIq choHbe'lu'bogh ghoqwI'pu' nIteb Suqlu'. DachoHpu'bogh ghoqwI'pu' rap taH.

## API (rarwI'pu'vaD)

- `PATCH /api/v1/agents/:id` porghDaj chenmoH rur chov: Sovbe'lu'bogh Dochmey (`source` pagh `id` rur) buSHa'lu', lughbe'bogh ngaQmey `400` 'ej De' nob (lajbe'lu'bogh HoS `EFFORT_UNSUPPORTED` ngoq 'ej pat lajbogh `levels` nob), 'ej Sovbe'lu'bogh ghoqwI' `404` nob.
- `POST` / `PATCH /api/v1/agents` `provider` `model` je laj. chu'lu'bogh nobwI' pat chu'lu'bogh 'oHnIS cha'vetlh; pagh `400` jang, `code: model_binding_unavailable`, `providerId`, `modelId` je tlhej, 'ej pagh pollu'. `model` Hutlh `provider` → `400`.
- `model` neH (ngo' mIw) lajlu' taH; wa' nobwI' neH pat ID tetlhchugh nobwI'Daj chellu'.
- `provider: null, model: null` (pagh pat chIm) cha' teq. `GET` jangmey `provider` ngaS.

## HoS

| De' | QIj |
|-----|-----|
| **jar tokens HoS** | jar 'aqroS; **`0` = 'aqroS Hutlh** |
| tokens lo' 'ang | tetlhDaq nachDaq je lo' vs HoS |

## Qu'mey

| SeHwI' | QIj |
|--------|-----|
| **choHmey yItoD** | SeHmey yIpol |

## qawHaqmey nav (laD neH tetlh)

| vay' | QIj |
|------|-----|
| **wanI'mey / Qu' qawHaq** | qawHaq patlh wIvwI' |
| *N qawHaqmey* | mI' |
| *potlh: N* | potlh mI' |
| *lo'lu' N×* | lo' mI' |
| *M ngutlhvo' wa'DIch N — qawHaq naQ pollu'* | tetlhDaq neH qawHaq tIq puSmoHlu' |
| chIm QIj | *ghoqwI' ja'chuqtaHvIS ghojtaHvIS je naDev qawHaqmey nargh.* |

## Hemey nav (Del)

He patmey yIrar vaj 'el QInmey ghoqwI'vam ghoS. naQ De' tetlh: [Hemey Del](/docs/tlh/communication/channels/).

| SeHwI' | QIj |
|--------|-----|
| **He pat yIrar** | Telegram/… pat tu'lu'bogh yIwIv |
| **ghoqwI'vamvaD yIrar** | rar |
| **rarHa'** | rarHa' |
| Dotlh **rarlu' / Qagh / pegh mu' tu'lu' / SeHlu'be'** | pat yIn |
| mIw **nIteb vang** | He nIteb vang SeHlaH |

## latlh

- [qa' 'ej Qu' Daq](/docs/tlh/agents/identity-workspace/)
- [ghommey Segh je](/docs/tlh/agents/teams/)
- [QIch Delmey](/docs/tlh/agents/voice/)
- [nobwI'pu'](/docs/tlh/ai/providers/)
