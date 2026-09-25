---
title: He 'ej Huch
description: auto He patlhmey, lIbmey, retlh pat ra'mey, Huch mevmey, ghoqwI'vaD pat nob je.
---

**nuq 'oH.** He wIv *'Iv* pat jang — ja'chuq chu' ngaQbogh pat, auto cherlu'bogh ja'chuq Helu'bogh patlhmey, 'ej EYAS 'em Qu' Qapbogh pat. Huch wIv *chay' law'* DaHuchpa' ghuH, QavmoH pagh mevchu' EYAS. pat nobmey chenlu'pu'bogh Hoch ghoqwI'vaD motlh pat rar, tagh rInDI'. ghom — nobwI' law' ghajbogh EYAS reH pat Huch law' lo'be', 'ej tam Huch natlhbe'.

**He:** `/providers` (retlh tetlh **nobwI'pu'**) → **He mI'** **Huch** je qachmey. pat nobmey: SeHmey (`/settings`) → **pat nobmey** 'emwI'.

## ghorgh yIlo'

- auto cherlu'bogh ja'chuqmeyvaD: nom QIjmeyvaD pat Huch puS, ngoqvaD pat HoS.
- 'em Qu' — pongmey, tIq, Hub noHwI', qawHaq qon — DawIvbogh patDaq Qap net neH (**tIq** patlh).
- wa'DIch nobwI' Qagh — **lIb** DaneH (pagh chu'laHbogh auto lIb).
- jaj/Hogh/jar mevmey, ghuH, QavmoH, mevchu' je DaneH.
- tagh rInDI' pat ghajbe' ghoqwI'pu' chenlu'pu'bogh — SeHmeyDaq yInob.

## motlh mIw

1. **nobwI'pu'** (`/providers`) → **He mI'** yIpoSmoH.
2. Dung **retlh pat ra'mey** 'emwI' yIlegh: Hoch 'em Qu' ghomvaD pat 'angnIS, *pat pagh — lIb ngeD* ghobe'.
3. QIn chov lo'taHvIS auto cherlu'bogh ja'chuqmey Helu' 'e' DaneHchugh **He nISbe' yIchaw'** yIchu' (Qub: *chu'lu'DI', QIn Hoch model wIv He nISbe' ja'chuq. model wIvlu'pu'bogh pagh ghoqwI' motlh lo'bogh ja'chuq He choHlu'be'.*).
4. Hoch patlhvaD **wa'DIch** nobwI' pat je, DuH **lIb**, patlh motlh **vum** je yIcher.
5. **Huch** yIpoSmoH: **Huch mevmey** bIngDaq **jaj / Hogh / jar** yIghItlh, ghIq **Dopmey** bIngDaq **ghuH / QavmoH / mevchu'**.
6. **SeHmey** → **pat nobmey** yIpoSmoH, Hoch ghoqwI' chenlu'pu'bogh nobwI' pat je yIrar, ghIq **nobmey tItoD**.

## laHmey

<h3 id="auto-failover">nobwI'pu' joj auto lIb (DuH)</h3>

**auto lIb** chu'lu'DI' (`EYAS_AUTO_FAILOVER=1`, pagh SeHDaq `model.autoFailover: true`), taghDI' patlhmey chIm **lIb** Daqmey teb cha'DIch yIn nobwI'. **DacherDI'bogh lIbmey ghItlhqa'lu' not.**

wa'DIch nobwI' Qagh reHDI' QaH; Huch QaQ je DaSeHmeH, lIb DawIvbogh'egh yIlo'.

ghoqwI' jar token Huch pIm 'oH (ghoqwI' **SeHmey** Dech).

<h3 id="default-binding">pat ponglu'be'DI' 'Iv pat jang</h3>

EYAS ra'mey 'op nobwI' pagh pat pongbe': ja'chuq chu' wa'DIch QIn (ghIq patvetlh pol ja'chuq — [ja'chuqmey — 'Iv pat jang](/docs/tlh/daily/conversations/#which-model-answers)), Degh AI choHmey, 'ej pat ghajbe'bogh ghoqwI' Qapmey. **lIng motlh**Daq ghoS, mIwvam chovlu':

1. **motlh** He patlh, nobwI'Daj chu'lu'chugh;
2. pagh lIng motlh nobwI' 'ej pat — [lIng pIn'a'](/docs/tlh/setup-wizard/)Daq **potlh CLI** DawIvDI' cherlu', pagh `PUT /api/v1/model/defaults` lo';
3. pagh chu'lu'bogh nobwI' ngutlh mIwDaq wa'DIch, wa' chu'lu'bogh pat ghajbogh.

pong mo' nobwI' nIvbe' not, 'ej nobwI'pu' tagh mIw potlhbe'. pagh tu'lu'chugh, ra' luj: *No default model binding: configure the Standard tier or a default provider* — Qubbe'. ngo' chovnatlhmey ra'meyvam Anthropicvo' ngeH, cherlu'chugh; pagh wa'DIch qonlu'bogh nobwI'Daq ngeH — vaj motlh patlh Hutlhbogh nobwI' law' lIngDaq ra'meyvam DaH latlh nobwI'Daq ghoSlaH. motlh patlh (pagh motlh nobwI') DacherDI' DaSeH.

<h3 id="background-model">'em pat</h3>

He wIv'eghbogh nobwI'Daq Qap EYAS 'em Qu' not. wa' wIvwI' lo': ngaQlu'bogh wIvmey mIwDaq nID, 'ej **mob** ra' QaplaHbogh pat neH lo' — jan pagh, wa' mIw, CLI qawHaq SeH je pagh. lo'laHbogh: Hoch API nobwI', Claude Code, 'ej De'wI'vamDaq mob chovta'DI' EYAS Grok CLI / Kimi Code CLI je. mob QaplaHbe'bogh CLI lo'lu' not — wIv rur pagh patlh **lIb** rur je.

| 'em Qu' | wIvmey, mIw |
|---------|-------------|
| ja'chuq pongmey | **tIq** patlh neH — ja'chuq pat'egh pagh latlh nobwI' not |
| qawHaq qon, ram qawHaq boq, qel briefing, tIq briefing, ghojmoH'egh chupmey, Forge chupmey, laH ghItlh, De' tlhap chelmoH | **tIq** patlh (wa'DIch, ghIq lIb) → lIng motlh → API nobwI'pu' ngutlh mIw → mob QaplaHbogh CLImey |
| Hub noHwI', naQ chovwI', Qu' tIn 'emvaD chov nab | **tIq** → **nom** → lIng motlh → latlh lo'laHbogh nobwI'pu' |
| ghom chup 'ej 'ay'mey joj nabqa'wI' | **nom** → **motlh** → lIng motlh → latlh lo'laHbogh nobwI'pu' |
| tej (tlhob chu', Hal chov, ghItlh, latlh chov) | **motlh** → lIng motlh → API nobwI'pu' → mob QaplaHbogh CLImey |
| auto He SeHwI' | **wIv** patlh neH (wa'DIch, ghIq lIb) — [auto He](#auto-routing) |

ghom, poH natlh, ngeb, pagh Do 'aqroS Qagh ret neH cha'DIch wIv nIDlu', wa'DIch jangpu'DI' not (Hung ghom neH nID). Huch **mev** — ra' pagh.

<h4 id="background-effort">'em ra'mey vum</h4>

Hoch 'em ra' ngoQDaj wa'DIch He patlh vum tlhob: **tIq** — qawHaq Qu', ghoj Qu', pongmey, Hung chovmey je; **nom** — nabqa' ghom chupmey je; **motlh** — tej; **wIv** — auto He SeHwI'. 'Iv pat jang 'ach patlh vum rap Qap — patlh pat'egh, lIng motlh, API nobwI', pagh mob QaplaHbogh CLI — 'ej patvetlhvaD machlu': lajbe'lu'bogh patlh lajbogh patlh Sumqu'Daq vIHlu'. motlh *ram* wIv, nom, tIq je, vaj motlh ram tlhob 'em ra'mey law'; motlh tlha' tej, motlh auto 'oHbogh. autobogh patlh vum Doch ngeHbe'. vum SeH ghajbe'chugh pat, pagh 'Iv pat jang 'e' SovlaHbe'chugh EYAS (pat ponglu'be'taHvIS CLI ra'lu' — CLI neH lIngDaq motlh), pagh ngeHlu' 'ej pat motlh'egh Qap.

<h4 id="background-traced">tlha'lu' 'ej toghlu'</h4>

Hoch 'em ra' ja'chuq mIw rur tlha'lu' — nobwI', pat, tokens, Huch, poH, ngoQ, tlhoblu'bogh lo'lu'bogh vum je — 'ej Huchvetlh Huch jaj, Hogh, jar mevmeyDaq toghlu', ja'chuq mIwmey rur. pat lo'laHbe'lu'mo' QaplaHbe'bogh 'em ra' pat ra'be': tlha' pagh, Huch pagh. [AI bej — lo'](/docs/tlh/admin/observability/#usage-tab) yIlegh.

Hoch 'em ra' ra'Daj system prompt naQ rur ngeH, 'ej lo'wI' QIn wa' neH, Hoch nobwI'Daq — lo'wI' pagh jangwI' tlhegh rur not.

<h4 id="background-no-model">pat lo'laHbe'lu'DI'</h4>

mob wej chovlu'bogh Grok neH pagh Kimi neH lIng rur, pat ra'be' EYAS 'ej Hoch laH jangDaj ngeD pol: wa'DIch QIn Doch pong rur taH; tIq *Heartbeat: items may need your attention* ngeH, meqmey tetlh tlhej; motlh chupmey 'ang ghojmoH'egh; boq chup pol Forge; chovnatlh `SKILL.md` ghItlh Skill Evolution; qawHaq qon chIl qon; ram qawHaq boq veb ramvaD ghommey lon; briefing ngeD 'ay'Daj pol; chaw'lIjDaq vIH Hub noHwI'; Qap *Unverified* per naQ chovwI'; wa' ghoqwI' neH ghom chup; Dung Halmeyvo' ngoD chenmoH tej. Claude Code neH pat 'oHbogh lIngDaq, Hoch ra'vetlh wa' Claude Code Qap mach mob tagh.

<h3 id="background-model-calls-card">retlh pat ra'mey 'emwI'</h3>

**He mI'** qach **retlh pat ra'mey** 'emwI' tlhej poS. DaH nuqDaq ghoS EYAS 'em Qu' 'ang, pat ra' Hutlh. Hoch ghomvaD wa' tlhegh:

| ghom | nuq ngaS |
|------|----------|
| **qawHaq: qon, boq, qel, Suq chu'** | qon, ram qawHaq boq, qel briefing, Data Port tlhap chelmoH |
| **ghoj: tIq, ghojmoH'egh, Forge, laH ghItlh** | tIq, Self-learning, Forge, laH ghItlh |
| **ja'chuq pongmey** | pong nIteb |
| **Hung: Hung noHwI', naQ qelwI', ngoQ ghItlh** | Hub noHwI', naQ chovwI', ngoQ rubric |
| **nab: ghom chup, nab chu'** | ghom chup, 'ay'mey jojDaq nabqa'wI' |
| **Qul** | tej Qapmey |
| **He chu' wIv** | auto He SeHwI' |

Hoch tlhegh wa' 'ang: ghom veb ra' lo'bogh nobwI' pat je, *nobwI' · pat* rur, nuqvo' ghoS ja'bogh Degh tlhej — **mI'** (ghom He patlh, wa'DIch ghIq lIb), **motlh** (lIng motlh), **API nobwI'**, pagh **CLI mob** (mob ra' QaplaHbogh CLI; nobwI' pongDaj neH 'ang, motlh patDaj Qapmo') — pagh **pat pagh — lIb ngeD**, meq tlhej:

- *nobwI' mob tu'lu'be'* — lo'laHbogh pagh chu'lu', mob chovpa' EYAS Grok neH pagh Kimi neH lIng rur, pagh CLIvetlh pongbogh patlh;
- *mI' SeHlu'be'* — pongmey wIv je neH, patlhchaj neH lo'mo';
- *Huch mev naQ* — Huch mev Hoch 'em ra' bot.

wa'DIch wIv 'ang 'emwI'. lo'laHbogh nobwI' ghajbe'DI' ghom, 'em Qu' 'op pat lo'laHbe' ja'bogh Doq banner 'ang — vaj lIb ngeDDaj Qap 'ej pat ra'be' — 'ej API nobwI' pagh EYAS mob chovta'bogh CLI Dachu' 'e' tlhob. patlh Hutlh pagh Huch mev tlheghDaq meqDaj 'ang 'ach banner pagh. He mI' qach DapoSmoHDI' 'ej qachvetlhDaq Hoch patlh choH ret chu'qa' 'emwI'.

**API (rarwI'pu').** `GET /api/v1/routing/auxiliary` (Settings laD; 'ellu'be'DI' `401`, chaw' Hutlh `403`) `{ groups: [ { group, purposes, target: { provider, model | null, route } | null, reason | null } ] }` nob — `group`: `memory`, `learning`, `title`, `safety`, `planning`, `research`, `triage`; `route`: `tier`, `default`, `api`, `isolated-cli`; `reason`: `no_eligible_provider`, `tier_not_configured`, `budget_stop`. 'em pat Qu' lo'laHbe'lu'DI' neH `503` jang. [AI bej](/docs/tlh/admin/observability/) tlha'meyDaq ngoQchaj per ghaj 'em ra'mey.

## Dochmey 'ej SeHwI'mey

<h2 id="auto-routing">auto He</h2>

| SeHwI' | Del |
|--------|-----|
| **He nISbe' yIchaw'** chu'/chu'Ha' | auto cherlu'bogh ja'chuqmeyvaD auto He chaw'. latlh ja'chuqmey Hebe' |
| Qub | *chu'lu'DI', QIn Hoch model wIv He nISbe' ja'chuq. model wIvlu'pu'bogh pagh ghoqwI' motlh lo'bogh ja'chuq He choHlu'be'.* |

**auto cherlu'bogh ja'chuqmey neH Helu'.** Qapbogh patDaj pol ja'chuq: ngaQlu'bogh pat, pagh ghoqwI' pat — wIvlu' not. auto cherlu'bogh ja'chuq QInDaj Seghlu' 'ej **nom**, **motlh**, **Qatlh**, pagh **ngoq ta'** patlhDaq Helu'. SeHwI' chu'Ha'taHvIS, pollu'bogh patDaj lo' auto ja'chuq 'ej ja'. Hoch patlh pat rap 'oSchugh (wa' CLI lIng rur), pagh Seghlu'. ja'chuq DungDaq pat wIvwI'Daq Hoch ja'chuqvaD auto He DawIv; **He nISbe' yIchaw'** chu'Ha'taHvIS SeHwI'vetlh HurghmoHlu'. [ja'chuqmey — 'Iv pat jang](/docs/tlh/daily/conversations/#which-model-answers) yIlegh.

**SeHwI'.** wa'DIch QIn chut mu'mey — Huch pagh: Daqlu'bogh QIn (mugh, ngoq chov, Qagh nej rur) pat ra'be'. Daqlu'be'bogh QIn neH **wIv** patlh patDaq ngeHlu' — wa'DIchDaj, pagh wa'DIch lo'laHbe'DI' lIb, mob ra' QaplaHchugh nobwI'vetlh neH. motlh patlh, lIng motlh, pagh latlh nobwI'Daq chegh not. ra' mob (jan pagh, nobwI' qawHaq SeH je pagh, session pollu'be'), QIn wa'DIch 500 ngutlh neH ngeH, latlh pat ra' Hoch rur pegh So' tlha' je Suq, 'ej Huch mevmeyDaq togh. pat tu'lu'be'chugh, Huch mevchu' chIlpu'chugh, pagh Segh lugh ghobe'bogh jang, QIn chut mu' Seghghach wuq 'ej mIw QIt not. Claude Code neH lIngDaq, auto ja'chuqDaq Daqlu'be'bogh QIn jang taghpa' wa' Claude Code ra' mach mob loS taH.

<h2 id="tiers">He patlhmey</h2>

Hoch patlh **wa'DIch** nobwI' pat je ghaj, DuH **lIb** je:

| patlh | motlh lo' |
|-------|-----------|
| **wIv** | QIn chut mu'mey Daqlu'be'bogh QInmeyvaD auto He SeHwI' (wa'DIch lIb je neH) |
| **nom** | nom jangmey, Huch puS |
| **motlh** | motlh QaQ — pat ponglu'be'bogh ra'meyvaD lIng motlh je ([Dung](#default-binding)) |
| **Qatlh** | Qu' Qatlh |
| **ngoq ta'** | ngoq law' Qu' |
| **tIq** | EYAS 'em QuvaD wa'DIch wIv — pongmey (wa' neH), tIq, qawHaq qon, Hub noHwI', latlh je ([Dung](#background-model)) |
| **jech** | ngo' vault wanI' nej tetlh neH tlhab. qawHaq qawqa' lo'be' not: reH juHDaq lan qawqa' ([qawHaq — reH juHDaq vector nej Qap](/docs/tlh/knowledge/memory/#vector-search-always-runs-locally)). lanlaHbe'bogh nobwI' pongchugh patlh, juH lanwI' lo' tetlhvetlh je; lanwI'Daj choHDI', wa'logh chImmoHlu' 'ej nIteb chenqa'lu' |
| **mu'tlhegh QaD** | ja'chuq ghItlhwI'Daq mu'tlhegh DevwI', Qu'mey ghoqwI'pu' je mu'tlhegh ghojmoHwI' ([mu'tlheghmey](/docs/tlh/ai/prompts/)) |

| Doch | Del |
|------|-----|
| **nobwI' yIwIv…** | patlh wa'DIch nobwI' |
| **pat yIwIv…** | wa'DIch pat |
| **lIb** (**lIb yIwIv…** / **pagh**) | wa'DIch lujDI' lIb |
| **vum** | patlh motlh meq vum (**jech** ghobe'bogh Hoch patlh) — [bIng](#tier-effort) yIlegh |

Kimi Code CLI lIngDaq, teqlu'bogh tlheghmey *Kimi Code CLI (K3)*, *(K2.7 Code)* pagh *(K2.6)* 'oSbogh patlhmey — EYAS'egh cherpu'bogh — taghDI' **Kimi Code CLI** (motlh tlhegh)Daq vIHlu', reH Qappu'bogh'e'; Kimi neH lIng chu' Hoch patlh DaqDaq tagh, lIb Hutlh. [nobwI'pu' — Kimi patmey Qub je](/docs/tlh/ai/providers/#kimi-models-and-thinking) yIlegh.

<h3 id="tier-effort">patlh motlh vum</h3>

**jech** ghobe'bogh Hoch He patlh **vum** wIvwI' ghaj: patlhvetlhDaq Helu'bogh ra'meyvaD motlh meq vum. **wIv**, **nom**, **tIq** — motlh *ram*; latlh patlh Hoch — *auto* (model motlh'egh). patlh pat lajbogh patlhmey neH tetlh wIvwI'; qonlu'bogh patlh lajbe'bogh pat DawIvDI', qonpa' choHlu' 'ej ja'lu' (*vum choHlu': … → …*), 'ej pat lajbe'bogh patlh lajQo'lu', *vum patlhvam nobbe' model. pagh polta'lu'.* tlhej.

cha' DaqDaq Qap patlh motlh:

- **patlhvetlhDaq Helu'bogh QIn**, mIwDaq Dung Doch patlh cherbe'DI': ja'chuq patlh'egh > jeD ('aqroS) > ghoqwI' > ja'chuq nobwI' > He patlh > model motlh.
- **EYAS 'em ra'mey** wa'DIch patlhchaj 'oHbogh — tIq: qawHaq, ghoj, pongmey, Hung chovmey; nom: nabqa' ghom chupmey je; motlh: tej; wIv: SeHwI' ([Dung](#background-effort)).

vaj patlh vum DachoHDI', patlhvetlh Helu'bogh QInmey 'ej lo'bogh 'em ra'mey je choH. lIngmey tu'lu'bogh *ram* motlh wa'logh Suqpu', chu'moH ret wa'DIch taghDI'; ghIq auto DacheghmoHbogh patlh auto taH. `PUT /api/v1/routing/tiers/:tier` porghDaj chov: Sovbe'lu'bogh patlh `404` nob, 'ej patlh pat lajbe'bogh vum `400` nob, ngoq `EFFORT_UNSUPPORTED` 'ej lajlu'bogh patlhmey tlhej. [nobwI'pu' — meq vum](/docs/tlh/ai/providers/#reasoning-effort) yIlegh.

<h2 id="budget">Huch / Huch mevmey</h2>

| Doch | Del |
|------|-----|
| **jaj / Hogh / jar** (**Huch mevmey**) | poHvaD Dol Huch mev; chImchugh *mevbe'* |
| **ghuH** (**Dopmey**) | ghuH Dop, mev 'ay' rur (vatlhvI' rur 'anglu'; motlh 0.8 = 80%) |
| **QavmoH** | Huch puSbogh patmeyDaq vIH (motlh 1.0 = 100%) |
| **mevchu'** | latlh Huch bot, 'em ra'mey je (motlh 1.2 = 120%) |

<h2 id="model-assignments">pat nobmey (SeHmey)</h2>

tagh pIn'a' AI pat mIw DuH 'ellu'ta'bogh lIb 'oH (tagh rInDI' mIwvetlh botlu').

| SeHwI' | Del |
|--------|-----|
| ghoqwI' pong | chenlu'pu'bogh / tagh ghoqwI' |
| pat wIvwI' | **— pagh —** pagh chu'lu'bogh nobwI' pat, *nobwI' / pat* rur |
| **nobmey tItoD** | PUT `/api/v1/model/agent-assignments` (`manage Model`) |

qonDI' nobwI' pat je rap pollu', vaj cha' nobwI' tetlhbogh pat ID reH lugh. API `{assignments: {agentId: {providerId, modelId}}}` pagh ngo' `{agentId: modelId}` laj; law' nobwI' tetlhbogh pat ID nobwI' Hutlh pollu'. tetlhDaq Hutlhbogh pat tu'lu'chugh, `400` nob, `code: unknown_model` 'ej `agents` tlhej, 'ej pagh ghItlhlu'.

tagh ghoqwI'pu' pagh patmey tu'lu'be'DI' So''egh 'emwI'.

## latlh

- [nobwI'pu'](/docs/tlh/ai/providers/)
- [AI bej](/docs/tlh/admin/observability/)
- [ghoqwI'pu' — token Huch](/docs/tlh/agents/configure/)
- [mu'tlheghmey](/docs/tlh/ai/prompts/)
- [tlha'bogh](/docs/tlh/automation/proactive/)
