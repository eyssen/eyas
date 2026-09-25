---
title: poH SeHwI'
description: qaSqa' Qu'mey, ghoqwI' mIwmey, HovpoH Gantt je, 'ej vumlaHbe'bogh Qu'mey.
---

**nuq 'oH.** poH SeHwI' tlhaq 'oH: qaSqa' pat vumwI'mey (ghunmey pol, Qorwagh) 'ej ghoqwI' mIwmey (mu'tlhegh ghajbogh ghoqwI' cronDaq). Qu'mey Dachenmoh, ghorgh Qav vumpu' Dalegh, 'ej not chu'bogh Qu'mey Dajon. Board 'oHbe' — Qu' Dochmey tlha' Board; poH Qu'mey tlha' navvam.

**He:** `/scheduler`. pong: **poH SeHwI'**. bIng pong: *qaSqa' Qu'mey, ghoqwI' mIwmey, vum qun je.* retlh tetlh: **poH SeHwI'**.

## ghorgh yIlo'

- ja'chuq DapoSmoHbe'taHvIS, Hoch po mu'tlhegh vum ghoqwI' DaneH.
- cronDaq ghunmey pol pagh latlh pat vumwI' chu'nIS, 'ej Qav/veb Daleghnis.
- Qu' vumbe', 'ej **vumwI' tu'lu'be' / not chu' / poHbe'lu'** Degh DapoQ — tam QaghHom ghobe'.
- ghoqwI'Daj motlh rur, mIw Qub jeD (pagh Huch puS) DaneH — **vum**Daj yIcher.
- law' EYAS lIngDaq ghom DevwI', poH tlhoSbogh Qu'mey pagh Hegh QIn Dachov.

## motlh mIw

1. retlh tetlhDaq **poH SeHwI'** yIpoSmoH (`/scheduler`).
2. **tetlh**, **Gantt** pagh **HovpoH** yIwIv. poH tlheghDaq **jaj / Hogh / jar** Hach yIlo'.
3. **Qu' yIchu'** — **pat vumwI'** pagh **ghoqwI' mIw** yIwIv, **pong** **poH (cron)** je yIghItlh, ghIq **vumwI'**, pagh ghoqwI' mIwvaD **ghoqwI' ID**, **mu'tlhegh**, **vum** je (DuH) — ghIq **chu'**.
4. pIv tlhegh yIbej. **vumlaHbe'** Degh: SeHlu'bogh rur vumbe' Qu'. meq DaleghmeH Dung yIghoS.
5. **DaH yIvum** DaH chu' (wanI' Qu' vummeH mIw wa' neH). **yImev / yItaHqa'** Qu' taHbogh choH; **poH yIchoH** pagh **vum**Daj DachoHmeH Qu' yI'uy.

## laHmey

rap Qu'mey 'ang wej leghmey: tetlh, pIq/veb Gantt, HovpoH je. **yoS Qu'mey yI'ang** qoD yoS Qu'mey chel, 'ach vumlaHbe'bogh Qu' So' not — SeHwI' chu'Ha'lu'DI' je, ghorlu'bogh pat Qu' leghlaH.

**poH SeHmey.** cron mu'tlhegh, poH vegh pagh wanI' lo'taHvIS chu' Qu'. cron mu'tlhegh pagh ngaj mu' lajlu': `hourly`, `daily` (09:00), `weekdays` (DaSjaj–buqjaj 09:00), `weekly` (DaSjaj 09:00), `monthly` (jar wa'DIch jaj, 09:00). poH vegh pagh wanI' chu'wI' API pagh `schedule_create` jan lo'taHvIS cherlu'; milliseconds mI' naQ Daghelchugh, poH vegh Qu' moj Qu' **poH yIchoH** lo'DI'. chu'wI' Segh 'ang tlhegh Degh.

<h3 id="agent-routines-run-in-a-conversation">ja'chuqDaq Qap ghoqwI' mIwmey</h3>

ghoqwI' mIw (**ghoqwI' mIw** Segh, pagh `schedule_create` jan chenmoHbogh Qu') Hoch vumDaq ja'chuq chenmoHlu', 'ej pa' ghoqwI' wIvlu'bogh Qap, bejlu'bogh 'emDaq Qapbogh mIw rur — Board chaw'mey nIDqa'mey je lo'bogh QapwI' rap: ghoqwI' pat'egh, Qu' mu'tlheghvo' EYAS qawHaq qawqa' naQ, chellu'bogh nabmey, ghItlhmey, tIq qawHaq qon, naQ chovwI' je. Qob janmey ['e' Hurbe'ghach](/docs/tlh/agents/autonomy/) patlh chaw' poQ.

- Qu' chenmoHbogh lo'wI' ghaj ja'chuq; ghoqwI' pagh pat chenmoHchugh, pIn ghaj. pongDaj Qu' pong 'oH, pagh *Scheduled: &lt;mu'tlhegh&gt;*.
- Qu' De' 'ay'Daq **qen vummey** Hoch vumvaD **ja'chuq yIpoSmoH** rar 'ang, lujbogh vummeyvaD je.
- taghlaHbe'bogh vum, ngoq tagh meq lo'taHvIS lujmoH: `agent_unavailable` (ghoqwI' Hutlh pagh chu'Ha'lu'), `over_budget`, `invalid_config`, `conversation_busy`, `conversation_forbidden`, `runner_unavailable`, `owner_unavailable`. Qu' luj tlheghmey / Hegh QIn veH toghlu' lujmey.
- **vum.** ghoqwI' mIw **vum**'egh ghajlaH ([Qu' yIchu'](#create-job) yIlegh). Hoch vum Qu' vum vum ja'chuqDaq ghItlh, vaj jang vum Degh Qu' patlh 'ang, Hal *ja'chuq*. **auto** Qu' pagh ghItlh: ghoqwI' vum lo' vum (Hal *ghoqwI'*), pagh model motlh. vum 'elbogh modelvaD patlh machlu'.

**chu'moH De'.** ghoqwI' vummey poHlu'bogh Qapbe'pu'DI' chenmoHlu'bogh ghoqwI' mIwmey Hoch vumDaq luj. chu'moHDI', veb chu'DI' vum — 'ej tokens lo' — taghlu'. wa'DIch yIlegh pagh yImev.

**nIv (API neH).** `conversationPolicy: 'reuse'` `conversationId` je ghajbogh `handlerConfig` ja'chuqvetlhDaq Qu' vumqa', mu'tlhegh chu' ngoQ rur; rap lo'wI' ghaj ja'chuq, 'ej vumtaHbe'nIS. `reuse` lo'DI', Hoch vumDaq ja'chuqvetlh vum cher Qu'; auto lo'DI', ghopvo' pagh ngo' vumvo' ngaSbogh patlh teqlu'. `agentId` pagh `prompt` Hutlhbogh, JSON lughbe'bogh, pagh `effort` lughbe'bogh ngaSbogh `handlerConfig` ghajbogh ghoqwI' mIw chenmoHlu'chugh pagh choHlu'chugh, `400` lajQo'lu'. `effort`: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, pagh `auto`/null (ghoqwI' vum). Qu' chenmoHwI' reH 'ellu'ta'bogh lo'wI' 'oH; tlhob porghDaq `createdBy` buSHa'lu'.

lughbe'bogh cron mu'tlhegh pagh wa' lup puSbogh poH vegh lajQo'lu' — **chu'**, **poH yIchoH** API je lo'DI' — 'ej meq 'angbogh: *"poH Qu'vam lughbe'. not vum Qu'. cron mu'tlhegh ghap poH vegh yIlegh."* **wanI'** chu'wI' lajlu', 'ach wej chu''egh laHbe' Qu'vetlh — **not chu'** Degh Suq.

## Dochmey 'ej SeHwI'mey

<h2 id="views">leghmey</h2>

| legh | Del |
|------|-----|
| **tetlh** | Qu' tetlh |
| **Gantt** | poH tlhegh raQmey |
| **HovpoH** | HovpoH legh |
| Hach **jaj / Hogh / jar** | Gantt/HovpoH juv |

<h2 id="create-job">Qu' yIchu'</h2>

**Qu' yIchu'** **poH Qu' chu'** 'aghtaHghach poSmoH:

| Doch | Del |
|------|-----|
| **pat vumwI'** / **ghoqwI' mIw** | Qu' Segh |
| **pong** | 'anglu'bogh pong; ghoqwI' mIw vum ja'chuqmey pongvam lo' |
| **poH (cron)** | cron mu'tlhegh pagh ngaj mu' (`hourly`, `daily`, `weekdays`, `weekly`, `monthly`); motlh `0 9 * * *` |
| **vumwI'** | pat vumwI' neH: **vumwI' yIwIv…** lo'taHvIS tetlhbogh vumwI' yIwIv |
| **ghoqwI' ID** | ghoqwI' mIw neH: Qapbogh ghoqwI' |
| **mu'tlhegh** | ghoqwI' mIw neH: nuq ta'nIS ghoqwI' — vum ngoQ 'ej qawHaq qawqa' tlhob moj |
| **vum** | DuH, ghoqwI' mIw neH. ja'chuqmey rur **vum** wIvwI'; **ghoqwI' ID** taHbogh 'ej chu'lu'bogh ghoqwI' ID ngaSDI' 'ang, 'ej ghoqwI'vetlh model nobbogh patlhmey neH tetlh. **auto** (motlh) vum lo'bogh 'ang — ghoqwI' vum'egh, rur *auto · ram (ghoqwI')*, pagh model motlh, rur *auto · model motlh (motlh)*. patlh DawIvbogh Qu' Hoch vum lo', model nobbogh patlh Sumqu' machlu' |
| **chu'** / **qIl** | Qu' pol / 'aghtaHghach SoQmoH |

<h2 id="job-kinds">Qu' Seghmey</h2>

| Segh | Del |
|------|-----|
| **pat vumwI'** | chenlu'pu'bogh Qorwagh/nIteb vumwI' |
| **ghoqwI' mIw** | poHDaq mu'tlhegh ghajbogh ghoqwI' Qap |

<h2 id="row-actions">Qu' tlheghmey 'ej De' 'ay'</h2>

| SeHwI' | Del |
|--------|-----|
| **mevta' / vumtaH** | Qu' chu'ghach Dotlh |
| **vumlaHbe' Degh** | tlheghDaq **vumwI' tu'lu'be'**, **not chu'** pagh **poHbe'lu'** 'ang — vumwI' tetlhbe'lu' (patDaj chu'Ha'lu' net Qub), not chu''egh chu'wI' Segh (wanI'), pagh SuvmoHlaHbe'lu'bogh poH (lughbe'bogh cron, pagh wa' lup puSbogh poH vegh). meq DaleghmeH Dung yIghoS. |
| **Qav: … / veb: …** | Qav veb je chu' poH |
| **N vummey / N lujmey** | mI'mey |
| **ghoqwI':** &lt;pong&gt; | ghoqwI' mIw Qapbogh ghoqwI' |
| **DaH yIvum** | DaH chu'; tetlhbogh vumwI' ghajbe'chugh Qu' pagh chu'Ha'lu'chugh/Hegh QIn 'oHchugh neH chu'Ha'lu', meq tooltipDaq. **not chu'** pagh **poHbe'lu'** Degh ghajbogh Qu' je vumlaH — wanI' QuvaD vummeH mIw wa' neH 'oH |
| **yImev / yItaHqa'** | choH |
| **Qaw'** | Qu' qun je teq (*Qu'vam qunDaj je Daghaj Qaw''a'?* rInDI') |
| **poH yIchoH** + **yIlo'** (De' 'ay') | cron mu'tlhegh chu' pagh ngaj mu', pagh poH vegvaD milliseconds mI' naQ; lughbe'bogh poH lajQo'lu' 'ej Doch bIngDaq meq 'anglu' |
| **vum** (De' 'ay') | ghoqwI' mIw neH. choHghach DaH pollu'; toDlaHbe'chugh, *toDlaHbe'* 'anglu' 'ej pagh choHlu' |
| **nej…** | tetlh SeH |
| **Halmey Hoch** / **Dotlhmey Hoch** | tetlh wa' HalDaq pagh wa' DotlhDaq machmoH |
| **yoS Qu'mey yI'ang** | qoD yoS Qu'mey chel |
| **vumlaHbe'bogh Qu'mey neH yI'ang** | pIv tlhegh SeHwI'; **Hoch Qu'mey yI'angqa'** SeHwI'meylIj ngo' chegh |

<h2 id="recent-executions">qen vummey</h2>

Qu' De' 'ay'Daq **qen vummey** vummey pIq tetlh — tagh poH, poH, 'ej 'Iv chu' (*chu'wI':* poH SeHwI' chu'DI' `system`, ghoqwI', pagh lo'wI' ID), 'ej ghoqwI' mIwvaD vum ja'chuqvaD **ja'chuq yIpoSmoH** rar (lujbogh vummey je). chIm: *vum tu'lu'be' wej.*

<h2 id="health">pIv tlhegh</h2>

| mI' | Del |
|-----|-----|
| **DevwI' / tlha'wI'** | ghom DevwI' (law' EYAS) |
| **N taH** | Qapbogh Qu'mey |
| **N vumtaH** | DaH vumtaH |
| **N luj (24h)** | wa' jaj lujmey |
| **N Hegh QIn** | nIDqa'mey natlhlu' |
| **N poH tlhoS** | poH luj |
| **N vumlaHbe'** | SeHlu'bogh rur vumbe'bogh Qu'mey |

<h2 id="legend">per (poH tlhegh)</h2>

pIq · vumtaH · veb · tuch · vummey · poH SIch

## latlh

- [CLI / SeH](/docs/tlh/deploy/configuration/)
- [ghoqwI'pu'](/docs/tlh/agents/overview/)
- ['e' Hurbe'ghach](/docs/tlh/agents/autonomy/)
- [nobwI'pu' — meq vum](/docs/tlh/ai/providers/#reasoning-effort)
- [ghunmey pol](/docs/tlh/admin/backup/)
- [juH](/docs/tlh/daily/home/)
