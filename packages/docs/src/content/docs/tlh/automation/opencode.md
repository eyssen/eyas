---
title: OpenCode
description: MIT mIw jan optional. ja'chuqDaq TUI yIn QonoS — EYAS ghajbogh pa'Daq nIteb.
---

**nuq 'oH.** OpenCode 'oH QonoS mIw jan'e' (MIT, [opencode.ai](https://opencode.ai)). EYAS private qab, AI SDK je laDbe'. mIw lugh: HTTP jan juH (`opencode serve` 127.0.0.1) 'ej POSIX PTY xterm.js. ja'chuq EYAS qawqa'bogh qawHaq Qu' tlhej ngeH, ghIq `opencode_run` Qap. ja'chuq QonoSDaq TUI leghlaH pagh yIlaH. EYAS taghbogh Hoch OpenCode Qap EYAS ghajbogh pa'Daq Qap, jaj OpenCode SeHlIjDaq ghobe'.

**He:** `/opencode`. **AI → OpenCode**. ja'chuqDaq, Dung QonoS mI'.

## ghorgh yIlo'

- EYAS `write_file` ra'mey law' ghobe' — OpenCode mIw'eghDaq mIw Qu' Qap.
- TUI **legh** pagh gher.
- Hoch latlh pat rur, `memory_search` / `memory_expand` rap lo'taHvIS EYAS qawHaqDaq nej OpenCode — laD neH, ja'chuq Qu'Daq ngaQ.
- nobbogh OpenCode Qu'mey pat Qub mI' je wIvlu'bogh lo'nIS (**pat 'ej Qub** 'emwI').

## motlh mIw

1. **OpenCode** (`/opencode`) yIpoS. **ghuHbe'** ja'chugh 'emwI', CLI yIchel (`curl -fsSL https://opencode.ai/install | bash` pagh `npm i -g opencode-ai`) pagh `EYAS_OPENCODE_BIN` yIDel.
2. OpenCode **EYASvaD** yI'el (pIn pagh loHwI'): ja'chuq yIpoSmoH, QonoS mI' yIchu', 'ej OpenCode QonoSDaq `/connect` yIlo' (['el](#sign-in)).
3. `opencode_status` / `opencode_run` yIchaw', nobmeH ghoqwI'vaD. Hoch nobwI'Daq Qap: EYAS rarwI' lo'taHvIS janmeyvam SIch CLI patmey (Claude Code, Grok, Kimi) je. **pat 'ej Qub** 'emwI'Daq pat Qub mI' je yIwIvlaH.
4. ja'chuqDaq `opencode_run` ra' 'e' yItlhob jupvaD. qawqa'bogh qawHaq tlhej Qu' ngeH EYAS; Hoch jan ra'pa' EYAS tlhob OpenCode; `opencode_run` jang rur cheghbogh jang diffmey je.

## laHmey

| Doch | nuq |
|------|-----|
| doctor | luj ngaQ: CLI pagh PTY Hutlhchugh tI'meH mIw nob, not Qagh |
| `opencode_status` | SuD. ghuH / ghuHbe' + chovmey |
| `opencode_run` | Doq, chaw'. ja'chuq qoDDaq neH Qap. sidecarDaq HTTP session; qoDDaq Hoch jan ra' EYAS Hub lojmIt tlhob |
| QonoS | `@xterm/xterm`, `/api/v1/opencode/terminal/:id` (JWT). pIn loHwI'pu' je neH (OpenCode loH chaw' — [QonoS poSmoHlaH 'Iv](#who-can-open-a-terminal) yIlegh). rarHa'DI' PTY Hegh |
| qawHaq plugin | OpenCode qoDDaq `memory_search` / `memory_expand` — latlh Hoch EYAS Qap rur pongmey, QIjmey, De'mey rap, laD neH. EYAS qawHaq ghItlhlaHbe' OpenCode Doch |
| nIteb | reH chu': EYAS ghajbogh pa', `<EYAS data dir>/cli-homes/opencode` — bIng yIlegh |

### nIteb {#isolation}

EYAS taghbogh Hoch OpenCode Qap — ja'chuq Qu'meyvaD 'em De'wI', ja'chuqDaq OpenCode QonoS je — `<EYAS data dir>/cli-homes/opencode`Daq Qap. chu'/chu'Ha' SeH tu'lu'be': ngo' *isolated config* SeH teqlu', 'ej ngo' qonlu'bogh ngaQ buSHa'lu'.

| Daq | nuq 'oH |
|-----|---------|
| **EYAS ghaj** | OpenCode SeH (`config/opencode/opencode.json`, EYAS ghItlhbogh, EYAS qawHaq plugin neH laDbogh, `config/opencode/eyas/eyas-memory.ts`), De' ('el `data/opencode/auth.json` 'ej OpenCode sessionmey je), Dotlh, cache (npm cache je). OpenCode `HOME` pa'vetlh rap 'oH. |
| **laDbe'lu'** | qach `~/.claude/CLAUDE.md`, `~/.claude` laHmey, OpenCode Claude Code rap latlh; `~/.agents` latlh Hur laHmey je; Qu' `opencode.json`'egh, `.opencode` pa', `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`; jaj `~/.config/opencode` 'ej `~/.local/share/opencode`; De'wI' envvo' nobwI' API ngoqmey (`OPENAI_API_KEY` rur). |
| **chu'Ha'** | nIteb chu'choH, session nobchuq je. |
| **shell** | OpenCode shell jan'egh EYAS pa' juH pa' rur legh, vaj `~/.gitconfig`lIj SSH ngoqmeylIj je leghbe'. |

'em De'wI' 127.0.0.1Daq 'Ij, 'ej Hoch taghDI' mu'ghom pegh chu' tlhej So'lu'.

**nuqDaq qawHaq plugin yIn.** `<EYAS data dir>/cli-homes/opencode/config/opencode/eyas/eyas-memory.ts`Daq EYAS qawHaq plugin ghItlhlu', plugin `@opencode-ai/plugin` poQbogh lIngmeH OpenCode lo'bogh `node_modules` pa' retlh, 'ej Daq 'oS EYAS pollu'bogh `opencode.json`. ngo' chovnatlhmey `…/cli-homes/opencode/plugins/eyas-memory.ts`Daq ghItlh, 'ej naDev ghoSbogh ghItlhvetlh tu'laHbe' OpenCode 1.18.29, vaj Qagh ja'be'taHvIS plugin buSHa' — ghIq `memory_search` / `memory_expand` ghajbe' OpenCode pat, 'ej plugin shell hook Qapbe' not. veb taghDI' ngo' cha'logh Qaw' EYAS. ngo' rur, wa'DIch taghDI' plugin poQbogh DochvaD npm tetlh SIchnIS OpenCode; Hutlhchugh, EYAS qawHaq janmey Hutlh Qap OpenCode.

### 'el {#sign-in}

pat nobwI'meyDaq 'el'egh OpenCode; OpenCodeDaq API ngoqmey ngeHbe' EYAS. DaH EYAS pa'Daq 'el yIn, vaj **OpenCode lo'wI'pu' tu'lu'bogh wa'logh mejmoHlu'**. ja'chuq OpenCode QonoS poSmoH 'ej `/connect` lo' pIn pagh loHwI' ([QonoS poSmoHlaH 'Iv](#who-can-open-a-terminal) yIlegh). EYAS HurDaq QonoSlIj'eghDaq `opencode auth login` yIlo'Qo': motlh envlIj lo', vaj jaj OpenCodelIj 'elmoH, EYAS OpenCode ghobe'.

### QonoS poSmoHlaH 'Iv {#who-can-open-a-terminal}

OpenCode QonoSDaq OpenCode jan ra'mey Dachaw''egh — EYAS taghbogh Qu'mey neH jang EYAS Hub lojmIt — 'ej kernel sandbox ghajbe' OpenCode, vaj jan Daq shell rur QonoS, jan pat lo'wI' rur Qap. vaj pIn loHwI'pu' je neH QonoS Hoch lo'laH, shell nap rur.

| OpenCode chaw' | motlh Qu'mey | nuq chaw' |
|----------------|--------------|-----------|
| read (laD) | owner, admin, user | OpenCode nav (Dotlh, patmey, choHmey polta'bogh); QonoSmeylIj tetlh 'ej SoQmoH |
| create (chenmoH) | owner, admin, agent | Hur lo': OpenCode plugin ra'bogh EYAS qawHaq API, 'ellu'ta'bogh ra'wI'vaD |
| manage (loH) | owner, admin | choHmey pol (**pat 'ej Qub**), QonoS poSmoH pagh rar — OpenCode QonoS shell nap je |

- loH chaw' Hutlhchugh, `POST /api/v1/opencode/sessions` `403` jang Segh cha'vaD, 'ej rarQo' QonoS socket (`/api/v1/opencode/terminal/:id`). QonoSmey chaw'bogh jan lo'wI'vaD neH QonoS mI' 'agh ja'chuq Dung ngogh; lajQo'taHchugh jan, ja' QonoS ngogh.
- Hoch rarDI' socket, lo'wI' Qu' Dotlh je DaHjaj lo'taHvIS chaw' nuDlu'; poSmoHtaHvIS nuDqa'lu' je: QonoS Hoch leQ 'uy, Hoch rolmoH, Hoch ping ngeHpa', Hoch 15 lup, 'ej pIn pagh admin Qu' choHDI', ghaH mevmoHDI' pagh ghaH polDI' SIbI'. chaw' chaghpu'bogh lo'wI' QonoS rIn — qatlh ja' ngogh, SoQlu', QonoS mIw mevmoHlu' je; rarqa'laHbe'.
- Hur Qu'mey choHbe': Hoch lo'wI' ja'chuqDaq Qap taH jaH `opencode_run`, EYAS Hub lojmIt tlhob Hoch jan ra'mo' ([Hur Qu'mey EYAS tlhob](#headless-tasks-ask-eyas)).
- `GET /api/v1/opencode/access` (laD chaw') `{terminal, settings}` jang: ra'wI' chaw''egh chaw'bogh. QonoS mI' 'agh'a' wIvmeH lo' web nav.

EYASDaq mI'lu' Qu' chenmoHlu'ta'bogh chaw'mey; user Qu'vaD OpenCode loH chaw' nobbogh choH tu'lu'be'. QonoS lo'meH vay', admin Qu' yInob (`PATCH /api/v1/users/<id>`, `{"role": "admin"}`, pIn pagh loHwI' ra') — latlh Hoch loHwI' chaw' nob je.

### Hur Qu'mey EYAS tlhob {#headless-tasks-ask-eyas}

Hoch jan ra'pa' EYAS tlhob `opencode_run` Qu'mey: teywI' laD choH je, tetlh nej je, shell ra'mey, Internet qem nej je, Qu' pa' Hur pa'mey SIch, ghoqwI'Hommey, LSP, laHmey.

- Hoch tlhob Hub lojmIt lo'taHvIS jang EYAS ([Hub lojmIt](/docs/tlh/admin/security-privacy/)), latlh QaHwI'pu'vaD lojmIt rap. chaw'lu'bogh ra'mey wa'logh Qap; lajQo'lu'bogh ra'mey lajQo'lu'.
- nuv wuq neH lojmItchugh, ra' lajQo'lu' 'ej [chaw' loS](/docs/tlh/agents/autonomy/)Daq chaw' chellu'.
- Hub lojmIt tu'lu'be'chugh, Hoch tlhob lajQo'lu'.
- taghbogh Qu'vaD neH jang EYAS, Qu'vetlh chenmoHbogh ghoqwI'Hommey je. OpenCode QonoSDaq jan ra'mey SoH'egh Dachaw'.
- Qu' rInDI', OpenCode session teq EYAS. `opencode_run` jang rur ja'chuqDaq ratlh jang diffmey je.

**Qu' pa'.** ja'chuq qoDDaq neH Qap `opencode_run`, 'ej latlh DaqDaq lajQo'. Daponglu'bogh pa' ja'chuq pa'mey qoDDaq tu'lu'nIS — pa'mey Hutlhchugh ja'chuq, vum pa''eghDaj qoDDaq tu'lu'nIS. pa' Hutlhchugh, ja'chuq wa'DIch pa' lo' EYAS, pagh ja'chuq vum pa''egh — EYAS lIng pa' not. ja'chuqlIj neH poSmoHlaH OpenCode QonoS: latlh lo'wI' ja'chuq *tu'lu'be'*, loHwI'vaD je. ja'chuq pa'mey pollu'bogh Daq vum; pa'meyvetlh laD EYAS'egh — latlh pa'mey ponglaHbe' tenwal — 'ej ja'chuq vum pa'Daq cheghqa' rap. latlh Qap pa'mey chov rap Suq QonoS pa'mey: Hublu'bogh Daq 'oHbogh, Hublu'bogh DaqDaq tu'lu'bogh pagh Hublu'bogh Daq ngaSbogh pa' (EYAS De''egh, latlh AI jan pol Daq, ghItlhHom vault, pagh juH pa'lIj) chIllu', chaw'lu'bogh veb pa'Daq pagh ja'chuq vum pa'Daq poSchoH QonoS, 'ej chIllu'bogh pa' ponglu' QonoS Dung tlhegh. rap chIllu' pa' pollu'bogh: latlh lo'wI' ja'chuq vummeH Daq 'oHbogh, qoDDaq tu'lu'bogh, pagh (rarwI' vegh) Daqvetlh ghoSbogh — pa'meyvam lajQo'pa' EYAS pollu'bogh, pagh jInmolvo' Suqlu'bogh; `opencode_run` chIl je, 'ej naDev ponglu'bogh Qu' pa' lajQo'. latlh ja'chuqlIjmey vummeH Daqmey lo'laH je.

**lo'wI''eghDajvaD sandbox ghobe'.** Dung pa'mey neH wIv nuqDaq QonoS tagh. QonoSDaq Qapbogh Hoch, EYAS jan pat lo'wI' rur Qap: OpenCode QonoSDaq Dachaw'bogh ra' (shell ra', pagh Qu' pa' HurDaq pa' 'el) lo'wI'vetlh ghoSlaHbogh Hoch ghoSlaH, jan latlh pa'mey je. vaj pIn loHwI'pu' je neH QonoS Hoch lo'laH — [QonoS poSmoHlaH 'Iv](#who-can-open-a-terminal) yIlegh. session API shell nap (`POST /api/v1/opencode/sessions`, `kind: "shell"`; OpenCode QonoS neH poSmoH tenwal) OpenCode QonoS env EYAS juH pa' je lo' taghDI', jan env'egh ghobe'; vaj EYAS pIn ngaQHa'moHwI' nobwI' API ngoqmey je ngaSbe'.

### Qu' tlhej ngeHlu'bogh qawHaq {#memory-sent-with-a-task}

EYAS qawqa' 'ay' — latlh Qap Hoch Suqbogh 'ay' rap — Qu' pat ghItlh rur ngeH `opencode_run`. latlh Hoch pat qawqa' rur tIn cherlu': 100k token Qorwagh tIn 'oH `memory.index.budgetChars` (motlh 2,400 ghItlh Hom), 'ej OpenCode Qapbogh pat Qorwagh tlhej tIn 'ay', 250k tokenvo' 2.5× 'aqroS (motlh 6,000 ghItlh Hom); tlhoS 29k token bIng mach, 'ej Qorwagh machqu' qawqa'lu'bogh qawHaq Suqbe'. OpenCode pat tetlh'eghvo' Qorwagh laD EYAS — tetlhDaj ghajchugh OpenCode, pat 'el 'aqroS; pagh De' 'aqroSDaj. Qorwagh Sovbe'lu'DI', `memory.index.budgetChars` net 'oH 'ay': **pat 'ej Qub** 'emwI'Daq pat wIvlu'be' (ghIq motlh patDaj'egh lo' OpenCode, 'ej jangvo' neH Sov EYAS); wIvlu'bogh pat OpenCode tetlhDaq tu'lu'be', pagh 'aqroS Hutlh tetlhlu' (OpenCode SeHDaq `limit` ghajbe'bogh nobwI' pat'egh rur); pagh tetlh laDlaHbe'lu' (ghuHmoHwI' ghItlhlu' 'ej Qap Qu' taH). Hoch Qu'vaD wa'logh 'aqroS tetlh laDlu', pat wIvlu'DI' neH, 'ej Qu'vo' pagh qeng tlhob. ngo', reH `memory.index.budgetChars` net Suq OpenCode Qu'mey, vaj Qorwagh tIn ghajbogh pat latlh nobwI' nobbogh qawHaq mach law' Suq. latlh Hoch Qap rur Qub rap ghaj 'ay': `memory_expand` lo'taHvIS tlhegh yIpoSmoH, `memory_search` lo'taHvIS latlh yInej. rarlu'bogh Hur De'wI'Daq Qu' neH Qub Suqbe' (EYAS qawHaq janmey ghajbe' De'wI'vetlh); Qapqu'bogh Samlu'bogh law' naQ Suq. [qawHaq — chay' qawqa' patDaq ghoS](/docs/tlh/knowledge/memory/#how-recall-reaches-the-model).

**EYAS mejpa' So'lu'.** OpenCode reH Hop Daq rur toghlu', Hoch pat QaplaHmo'. Qu' prompt 'ej Qu' pat ghItlh rur ngeHlu'bogh qawqa'lu'bogh qawHaq je pegh chut So', OpenCodeDaq vay' ghoSpa', 'ej So'lu'bogh promptvo' OpenCode session pong ghoS. OpenCode qoDDaq `memory_search` / `memory_expand` jangmey So'lu' je. pegh nej lujchugh, Qu' luj, *privacy scan failed — the task was not sent to OpenCode* tlhej, 'ej OpenCodeDaq pagh ghoS. pegh chut (pagh pegh 'ay') chu'Ha'taHvIS pagh So'lu'. [Hub 'ej pegh — nuqDaq So'lu'](/docs/tlh/admin/security-privacy/#where-masking-applies).

### OpenCode qoDDaq EYAS qawHaq {#eyas-memory-inside-opencode}

cha' jan neH nob EYAS qawHaq plugin OpenCode patvaD: `memory_search` `memory_expand` je. latlh Hoch EYAS Qap rur pongmey, QIjmey, De'mey rap ghaj, laD neH, 'ej Hoch mIwvaD qawHaq jan ra' 3 'aqroS rap nobchuq. qawHaq polbogh jan ghajbe' OpenCode: nuq qaw EYAS — EYAS wuq, OpenCode pat not.

nuq laDlaH janmey — 'Iv ra'bogh wuq:

- **`opencode_run` Qu'.** chenmoHbogh OpenCode session, Qu' taghbogh ja'chuq lo'wI' je rarmoH EYAS. ghIq ja'chuqvetlh Qu', Qu' SeghDaj, Hoch qawHaq je laD janmey, 'ej ra'bogh mIw 3 ra' 'aqroS nobchuq.
- **latlh Hoch DaqDaq** — navDaq vay' poSmoHbogh OpenCode QonoS, EYAS chenmoHbe'bogh Hoch session, pagh session lo'wI' 'oHbe'bogh 'ellu'ta'bogh ra'wI' — Hoch qawHaq neH laD janmey.
- **rarlu'bogh Hur De'wI'** (rar URL) EYAS qawHaq SIchlaHbe' not.

**OpenCode mej not ngoq, 'ej envDaq ratlh not.**

- EYAS taghbogh Hoch OpenCode Qap — 'em De'wI' 'ej Hoch OpenCode QonoS — ngoq'egh Suq teywI' ngu'wI' (file descriptor) 3Daq, Qapvetlh neH ghajbogh rar. env, ngoQ tetlh, teywI' je qoDDaq ngoq not. Qapvetlh mevDI' pagh taghqa'DI' Hegh ngoq.
- OpenCode laDDI' ngoq wa'logh laD EYAS plugin, qawHaqDaq pol, 'ej ngu'wI' 3 SoQmoH, vaj OpenCode tugh taghbogh vay' — model shell ra'mey je — ngoq Suqbe'. ngoq ngu'wI' 3Daq tu'lu' 'e' neH ja' Qap env (`EYAS_OPENCODE_KEY_FD=3`), 'ej model Qapbogh shell chIm Dochvetlh `OPENCODE_SERVER_PASSWORD` je legh. OpenCode Qap `ps eww` pagh `/proc/<pid>/environ` ngoq 'angbe'.
- ngoq ngeHbe' Hoch qawHaq ra'; OpenCode poH wa'vaD wa'logh tob ngeH: jan Qapbogh poH ID (OpenCode cherbogh, pat ghobe'), mI' Duj, poH je ghItlh qI'. wa'logh tob laj EYAS, 2 tupvaD, OpenCode Qapvetlh QaptaHvIS neH, 'ej tob ponglu'bogh poHvaD neH ra' nob. jan ngoQ rur pat ngeHbogh poH ID EYASDaq ngeHlu'be'. model Qapbogh ra' ngoq ghajbe', vaj Hoch poHvaD qawHaq ra'laHbe'.
- ngu'wI' 3Daq ngoq nobmoHlaHbe'lu'chugh, EYAS qawHaq janmey Hutlh Qap OpenCode, latlh mIw lo'taHvIS ngoq Suqbe'.

Hoch ra' latlh Hoch pat qawHaq ra' rur EYAS jan QapwI' wa' lo' (Hub lojmIt, chaw'mey, nej 'aqroS, qawHaq SIch log, pegh So').

**ratlhbogh veHmey.** env'eghvo' neH De'wI' mu'ghom laD OpenCode 1.18.29. chIm legh model Qapbogh shell, 'ach latlh Qap env laDlaHbogh OS lo'wI' rap Qap mu'ghomvetlh laDlaH 'ej OpenCode API'egh lo'taHvIS OpenCode De'wI'vetlh poHmey SeHlaH — QaptaHbogh latlh Qu' QInmey laDmeH rur — 'ej model Qapbogh ra' ngaS. QonoS De'wI''egh port mu'ghom je ghaj'egh; ghIQ De'wI' mu'ghom Suq not, vaj QonoSDaq ra' Qapbogh mu'ghomvetlh Suqbe'. Hoch Qu' De'wI''eghDaq Qapchugh, veHvam SoQmoHbe', OS lo'wI' rap Hoch Qap latlh Hoch env laDlaHmo'; latlh OS lo'wI' pagh OpenCode Dech teywI' Hung neH SoQmoHlaH. kernel teywI' Hung ghajbe' OpenCode. latlh Qap qawHaq laDlaHbogh Qap (OS chaw'bogh debugger, pagh root) ngoq SIchlaH taH.

**nuq qon EYAS.** `opencode_run` Qu' qoDDaq OpenCode jan ghItlh 'ej QonoS nav ghItlh je — `memory.l0.captureToolResults` chu'DI' neH qonlu' (motlh chu'Ha'), latlh jan ghItlh rur: ja'chuq Qu' bIngDaq, voq Segh *ingested*, 'ej mu' mu' qawqa'lu' not. tu'lu'bogh 'ej QonoS lo'wI' ghajbogh ja'chuqvaD neH QonoS ghItlh qonlu'. OpenCode Qav jang diffmey je pIm pollu'be': `opencode_run` jang chaH. [qawHaq](/docs/tlh/knowledge/memory/).

**API (rarwI'pu').** `POST /api/v1/opencode/memory/search` `POST /api/v1/opencode/memory/expand` je `memory_search` / `memory_expand` De'mey laj. wa'logh poH tob lo'taHvIS 'el plugin, `Authorization: Bearer eyas-ocs.<payload>.<signature>`, Hoch ra'vaD wa', 'ej tob ponglu'bogh poHvaD Qap ra': `sessionId`Daq latlh poH pongbogh porgh `403` Suq; ngeblu'bogh, cha'logh lo'lu'bogh, pagh Heghpu'bogh tob, mevpu'bogh Qapvo' tob, pagh Bearer rur lo'lu'bogh ngoq tlhol `401` Suq. OpenCodeDaq chenmoH chaw' ghajbogh 'ellu'ta'bogh ra'wI' (agent Qu', loH chaw' vegh pIn loHwI'pu' je; motlhDaq user Qu' ghobe') ra'laH taH 'ej porghDaq `sessionId` lo'taHvIS poH pong; poHvetlhvaD Qap ra', poHvetlh rarlu'bogh lo'wI' 'oHDI' lo'wI' neH, pagh Hoch qawHaq neH laD. chaw' lajQo'lu'chugh `403`. Hop patDaq ngeHlu'bogh Hoch qawHaq jan jang rur So'lu' jangmey. ngo' `/api/v1/opencode/memory/query` `/api/v1/opencode/memory/save` je teqlu' (`404`). session cookie lo'bogh choHmeH `/api/v1/opencode/*` ra'mey `X-Eyas-Request` nach poQ, latlh pIn APImey rur (ngeH web UI).

### pat 'ej Qub {#model-and-reasoning}

OpenCode navDaq **pat 'ej Qub** 'emwI' QaHwI' OpenCodeDaq nobbogh Qu'mey (`opencode_run`) pat Qub mI' je wIv.

- **pat** OpenCode patmey'egh tetlh: EYAS ghajbogh OpenCode sidecar 'elpu'bogh nobwI'pu' patmey je, QaptaHbogh OpenCode De'wI'vo' laDlu'. **OpenCode motlh** (chIm) pat ngeHbe', vaj motlhDaj'egh lo' OpenCode, ngo' rur.
- **Qub mI'** wIvlu'bogh patvaD OpenCode nobbogh mI'mey tetlh — Claude Opus 5.5vaD low/medium/high/xhigh/max rur, GPT-5.6vaD none…max, Gemini patmey 'opvaD minimal/high. mI'mey ghajbe'chugh pat So'lu'. **pat motlh** (chIm) mI' ngeHbe'. motlh pongmey (none, minimal, low, medium, high, xhigh, max) EYAS vum permey tlhej 'anglu'; nobwI'vaD pongmey OpenCode ponglu'bogh rur 'anglu'.
- latlh pat DawIvDI', mI' chu'moHlu', mI' rap nobbe'chugh pat chu'. **toD** wIv pol; OpenCodeDaq SeH chaw' poQ (motlh joH SeHwI' je).
- QaptaHnIS OpenCode De'wI' tetlhvaD. wa'DIch OpenCode QonoS session pagh nobbogh Qu' taghDI' tagh — navvam taghmoHbe'. ghoSpa' 'emwI' ja' 'ej pollu'bogh wIv neH 'ang; De'wI' QapDI' nav yI'uchqa'. tetlhDaj noblaHbe'chugh OpenCode, *OpenCodevo' patmey tetlh laDlaHbe'lu'.* ja' 'emwI'.
- Qap poHDaq, pat nobbe'choHbogh pollu'bogh mI', pagh tetlh laDlaHbe'lu'mo' chovlaHbe'lu'bogh mI', chIllu', De'wI' logDaq ghuHmoHwI' tlhej; wIvlu'bogh patDaq motlh Qub Qap Qu'. OpenCode ja'bogh rur, Qapbogh pat mI' je pong Qu' jang (`effective` Doch), pat wIvlu'be'DI' OpenCode wIvbogh pat je.
- OpenCode QonoS choHbe'lu': OpenCode qoDDaq patDaj DawIv taH.

lIngmey tu'lu'bogh OpenCode motlh pat mI' je tagh; vIHmoH pagh.

**API (rarwI'pu').** `GET /api/v1/opencode/models` (OpenCode laD) `{running, providers: [{id, name, models: [{id, name, variants: [{id, level}], contextWindow?}]}], defaults}` nob; OpenCode tetlhchugh, pat 'el 'aqroS (pagh De' 'aqroSDaj) 'oH `contextWindow`. nobwI' 'el De' nob not, 'ej De'wI' taghmoH not: De'wI' QapHa'taHvIS `running: false` nob; tetlh lujchugh `502`, ngoq `OPENCODE_MODELS_UNAVAILABLE` tlhej. `PUT /api/v1/opencode/settings` `model` (`{providerID, modelID}` pagh null) `variant` (ghItlh pagh null) je laj, 'ej lughbe'bogh porgh `400` lajQo', buSHa'be'.

### Hur De'wI'Daq rar {#attaching-to-an-external-server}

Hur OpenCode De'wI'vaD rar URL — **nIteb pagh**: De'wI'vetlh SeH'egh, 'el'egh, chaw' chutmey'egh pol, 'ej EYAS qawHaq janmey, qawHaq ngoq, qon je Suqbe'. OpenCode nav **jan** 'ej **ghoS'e'** *ghuHmoH* rur 'ang, ja'ghachvam tlhej.

### OpenCode nav {#the-opencode-page}

mughlu'bogh chov pongmey, **ghoS'e'** tlhegh, **jan** tlhegh, 'el Qub, **pat 'ej Qub** 'emwI' je 'ang nav.

### chu'choH {#upgrade}

- ngo' chovnatlhmey lIng pa' `data/opencode` bIngDaq OpenCode teywI'mey pol. DaH pa'vetlh lo'be'lu'. `data/opencode/workspaces`vo' (ngo' QonoS sessionmey) DapoQbogh yIvIHmoH, ghIq DaQaw'laH.
- OpenCode janmey `eyas_query_memory` `eyas_save_memory` je tam `memory_search` / `memory_expand`. QaptaHbogh OpenCode veb taghDI' (EYAS taghqa'DI') plugin chu' Suq.
- `EYAS_OPENCODE_PLUGIN_TOKEN` tu'lu'be'choH: laDbe' 'ej cherbe' EYAS. ngu'wI' 3Daq ngoq'egh Suq Hoch OpenCode Qap, 'ej Hoch poHvaD tob ngeH qawHaq ra'mey. rarlu'bogh De'wI' EYAS qawHaq SIchbe' DaH.
- EYAS ghajbogh OpenCode pa'Daq `config/opencode/eyas/eyas-memory.ts`Daq vIHlu' qawHaq plugin; veb taghDI' ngo' `plugins/eyas-memory.ts` Qaw'lu'. DaH `memory_search` / `memory_expand` ghaj net OpenCode pat (OpenCode 1.18.29Daq chovlu').
- `memory.l0.captureToolResults` chu'be'chugh, OpenCode jan QonoS je ghItlh pollu'be' DaH.
- ngo' chovnatlhmeyDaq OpenCode QonoS poSmoHlaH user Qu' je (OpenCode chenmoH chaw'). DaH loH chaw' poQ QonoS Hoch: pol pIn loHwI'pu' je, QonoS mI' chaw'be'lu' user 'ej `403` Suq. user ja'chuqmeyDaq jaHpu' `opencode_run` Qu'mey Qap taH. vIHmoHmeH pagh tu'lu' — pollu'be' Qu' chenmoHlu'ta'bogh chaw'mey — 'ej ngo' motlh chegh choH tu'lu'be'; QonoS poQbogh vay'vaD admin Qu' yInob ([QonoS poSmoHlaH 'Iv](#who-can-open-a-terminal) yIlegh).

## latlh

- [janmey](/docs/tlh/automation/tools/)
- [qawHaq](/docs/tlh/knowledge/memory/)
- [ja'chuq](/docs/tlh/daily/conversations/)
- [Hub 'ej pegh](/docs/tlh/admin/security-privacy/)
