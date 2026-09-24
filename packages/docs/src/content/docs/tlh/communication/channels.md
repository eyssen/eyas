---
title: Hemey — Del
description: Hur QIn patmey — Segh, mIw, 'el tetlh, tay'. rarmey 'oHbe', ghopmey 'oHbe'.
---

**nuq 'oH.** Hemey chay' De'wI'vam Hur nuvpu' EYAS ghoqwI'vaD QIn ngeH: Telegram, Slack, QIn Daq 'ej tetlh latlh. Hoch pat peghmeyDaj ghaj 'ej ghoqwI' rar. **'oHbe'** [rarmey](/docs/tlh/admin/connections/) (Odoo, GitHub, MCP tetlh) 'ej **'oHbe'** [ghopmey](/docs/tlh/admin/hands/) (OS/CLI janmey nobbogh juH jan). MCP A2A je latlh rar mIw 'oH, navchajDaq yIn.

**He:** `/communication` → **Hemey · 'el tetlh · tay'**. tlhegh mach: *QIn Hemey yIra'chuq 'ej ghoqwI' wa'DIchDaq yIra'.*

## ghorgh yIlo'

- web UI poSmoHbe'taHvIS Telegramvo' (pagh latlh tetlh Seghvo') ghoqwI' wa'DIch Daja'nIS.
- rap Seghvo' cha' bot DaQap (Qu' + nIH) 'ej cha'DIch pat DapoQ.
- 'el QInmey taH, 'ej ratlhbogh tetlh DapoQ (**Hegh** tlhegh yInIDqa').
- Telegram DM tay' ngoq loS.

## motlh mIw

1. **Qum** (`/communication`) yIpoSmoH, **Hemey** 'ay'Daq.
2. tetlh nav yIpoSmoH, pagh rap Seghvo' latlh chelwI'vaD **pat yIchel**.
3. peghmey yIchel, **'el QInmey ghoqwI'** yIwIv, **yItoD 'ej yIra'chuq** yIchu'.
4. **ra'be'** (bejbe'lu', SeH'egh patlh SeH taH) pagh **SeHlu'** (Hoch jan ra' Hub lojmIt SeH) yIwIv.
5. Telegram DMvaD: botvaD yIghItlh, ghIq **tay'**Daq ngoq yIlaj. ngeH lujchugh **'el tetlh** yIbej.

## laHmey

**rap Seghvo' law' chelwI'mey** DaQaplaH (cha' Telegram bot rur), Hoch pegh mu'Daj ghoqwI'Daj je ghaj. **pat yIchel** yIlo', pagh navDaq **… pat yIchel**.

### He Seghmey (tetlh) {#channel-types}

EYAS nobbogh QIn Seghmey 'oH. MCP / A2A ja'chuq He **'oHbe'**.

| Segh | nuq Dara' | tay' | latlh |
|------|-----------|------|-------|
| **Telegram** | BotFather HTTP API pegh mu' | HIja' — Sovbe'lu'bogh DM | wa'DIch patlh; [Telegram](/docs/tlh/communication/telegram/) |
| **Discord** | ghun bot pegh mu' | ghobe' | Qap poHDaq `discord.js` poQ |
| **Slack** | bot pegh mu' (`xoxb-`) + ghun patlh pegh mu' (`xapp-`) | ghobe' | Socket Mode — Hoch webhook Hutlh |
| **Email (SMTP/IMAP)** | SMTP (poQlu') + IMAP (DawIvlaH) | ghobe' | Hoch QIn pa' |
| **Gmail (API)** | OAuth client ID/pegh, refresh token, QIn pa' | ghobe' | Gmail API |
| **Microsoft 365 (Graph)** | tenant, client ID/pegh, QIn pa' UPN | ghobe' | Graph ghun 'el De' |
| **WhatsApp Business** | ghogh mI' ID, SIch pegh mu', chov pegh mu', ghun pegh | ghobe' | webhook `/api/v1/webhooks/whatsapp` |
| **Signal** | bot E.164 mI' + signal-cli HTTP tlham URL | ghobe' | Signal ngaSbe' EYAS |
| **Google Chat** | Qu'/ghun ID, ngeH pegh mu' motlh Daq je (DawIvlaH) | ghobe' | webhook `/api/v1/channels/googlechat/webhook` |
| **Microsoft Teams** | ghun ID, ghun mu'ghom pegh, tenant (DawIvlaH) | ghobe' | webhook `/api/v1/channels/teams/webhook` |

pegh mu' mIwpa', mI'lu'bogh mIwmey tlhej **chay' yISeH** poSmoH Hoch nav. webhook Seghmey **Webhook Hemey 'angmeH** 'ang je.

## mIwmey 'ej SeHwI'mey

### pat yIchenmoH {#create-instance}

| Doch | QIj |
|------|-----|
| **He Segh** | tetlhvo' chenmoH qech |
| **legh pong** | chovnatlh: Qu' Signal, nIH Telegram |
| **yIchu' 'ej yIra'chuq** | pat chenmoH 'ej ra'chuq tagh |
| **pat yIQaw'** | pat pegh mu'Daj je teq (chaw' tlhej) |

### pat Dotlh {#status}

| Dotlh | QIj |
|-------|-----|
| **ra'chuqta'** | yInbogh ra'chuq |
| **ra'chuqHa'** | ra'chuqbe' |
| **pegh mu' tu'lu'** | peghmey pollu'; ra'chuq poQlaH |
| **SeHbe'** | peghmey Hutlh |
| **Qagh** | Qav Qagh |
| Dotlh **Suv / ngov Qagh / puj** | Qap Dotlh |

### mIw {#mode}

| mIw | QIj |
|-----|-----|
| **ra'be'** | bejbe'lu' Qap; Hoch ta' SeH SeH'egh patlh taH |
| **SeHlu'** | Hoch jan ra' SeH Hub lojmIt |

yIwIvDI' mIw choH (Qubmey Hoch QIj).

### He jangmeyDaq qawHaq {#memory-in-replies}

joH **'emDaq** ghoghDaq jatlhbogh jang ja'chuq mIw rap qawqa' 'ay' Suq, DaH jaj poH je tlhej ([qawHaq — chay' qawqa' patDaq ghoS](/docs/tlh/knowledge/memory/#how-recall-reaches-the-model)). ghogh logh **Hur** ghajbogh jang — ja'chuqDaq **Force External** cherlu', pagh poH choH — jaj poH je neH Suq: Hur laDwI'vaD qawqa'lu'bogh joH qawHaq ngeHlu'be'. jang ghogh logh wuqlaHbe'chugh EYAS, qawqa'lu'bogh qawHaq Hutlh mej jang je. qawHaq janmey choHbe'lu' 'ej Hub lojmIt SeH taH.

He jangmeyDaq rarlu'bogh ghoqwI' **janmey** tetlh Qap, latlh He Hoch rur, `memory_search` `memory_expand` je tlhej ([SeH — janmey](/docs/tlh/agents/configure/#tools--constraints)). He ngeHwI'pu' ghItlhbogh *peer* ghItlh rur qawlu', SoH ghItlhbogh ghobe'.

**He jangmeyDaq qawHaq capture.** DaH EYAS qawHaq ngaQ capture Qap Hoch He jang je, ja'chuq mIw rap `memory.capture.*` SeHmey bIngDaq. ngeHwI' QIn latlh ghot mu'mey rur laDlu': SoH 'Iv ja'bogh ghItlhHom pagh EYAS chay' vum ja'bogh chut chenmoHlaH not, `reference`, `project` pagh `domain` ghItlhHommey neH chenmoHlaH — `trust: peer` ghajbogh 'ej ghomwI' voq patlhDaq pollu'bogh — 'ej ghItlhHomvetlh ghItlhHommeylIj'eghDaq chel not. tIqghach lojmIt ngeHwI' mu''egh neH togh, vaj pat ra' DIlbe' "ok" puS, 'ej He ja'chuq Hoch QInmeyDaj wa' `maxPerConversation` 'aqroS nobchuq. [qawHaq — motlh chu' capture](/docs/tlh/knowledge/memory/#capture-is-on-by-default).

**pat 'ej vum.** rarlu'bogh ghoqwI' pat tlha' He ja'chuq; pat ghajbe'chugh ghoqwI', wa'DIch jangDI' ja'chuqDaq lIng motlh ngaQlu'. ghoqwI' meq vum'egh Qap je. Hoch He jang jangbogh nobwI' pat je, 'ej Qapbogh vum, qon.

### lajQo'lu'bogh QInmey (pegh) {#refused-messages}

He reH Hop Daq rur toghlu'. pegh chut **bot** cherbogh De' ngaSbogh 'el QIn — motlh IBAN, Huch pa' mI', tax mI', ghot ID 'echlet mI', Huch 'echlet mI', pagh US SSN, 'ej **bot** cherlu'bogh Hoch mIw DIchenmoHbogh — vay' pollu'pa' lajQo'lu':

- ghItlhmeH lo'bogh Holvetlh (DIvI' Hol, Hungarian, German, Spanish, French, pagh tlhIngan Hol; SovlaHbe'lu'chugh DIvI' Hol) lo'taHvIS nIteb jang Suq ngeHwI'. Seghmey pong, De' ghobe' not, 'ej De'vetlh Hutlh ngeHqa' 'e' tlhob.
- ja'chuq, QIn, ghoqwI' Qap je chenmoHlu'be'. **'el tetlh**Daq wanI' Dotlh **Haw'** ghaj, Qagh `privacy_blocked` tlhej, 'ej So'lu'bogh ghItlhDaj neH pollu'. QIj ngeH lujchugh, Hoch ngeH rur wanI' nIDqa'lu'.
- chut choHpa' pollu'pu'bogh QInmey ghIq lajQo'lu' not. QIn Daqmey ghogh mI'mey je (**So'** Segh) 'ej **ghuH** Segh De' lajQo'lu' not.

Hoch lajQo' `privacy.inbound_refused` rur chovlu' (Seghmey 'ej 'el wanI' ID, De' not). [Hub 'ej pegh — lajQo'lu'bogh QInmey](/docs/tlh/admin/security-privacy/#refused-messages).

### pegh mu'mey 'ej ghoqwI' rar {#credentials}

| Doch | QIj |
|------|-----|
| pegh Dochmey | Hoch HevaD pIm (nav pagh Telegram bom yIlegh) |
| *chIm yIchaw' yIn DaH wuv yIpolmeH* | choHtaHvIS Daq ghItlh |
| **tu'lu'** per | pegh pollu'ta' |
| **'el QInmey ghoqwI'** | 'Iv ghoqwI' jang; motlh QaHwI' wa'DIch |
| **— pagh (QInmey pol, jang'eghbe') —** | pol neH |
| **ra'ta' ghoqwI'** | DaH rarlu'bogh ghoqwI' |
| **yItoD 'ej yIra'chuq** | peghmey pol 'ej ra'chuq |
| **yInID / yIra'chuq / yIra'chuqHa' / yIra'chuqqa' / yISeH** | yIn mIw ta'mey |

### 'el tetlh 'ay' {#inbound}

He 'el QInmey tetlh ratlhbogh, wa'logh 'aqroS ngeHbogh. ngeH lujchugh poH nI' 'ej nIDqa'lu', ghIq Hegh QIn moj; **Hegh** tlheghmey tetlhqa'laH.

| tlhegh | QIj |
|--------|-----|
| **Hal** | He pat |
| **ngeHwI'** | ngeHwI' ID / pong |
| **QIn** | porgh |
| **nIDmey** | ngeH nIDmey |
| **Hev** | qan (*{{n}} lup ret / {{n}} tup ret / {{n}} rep ret*) |

**Dotlh** tlhegh 'ang **loS**, **ngeHta'**, **Hegh**, pagh **Haw'**; lujbogh pagh Haw'bogh tlhegh meq QIn bIngDaq 'anglu' (`privacy_blocked` rur, [Dung](#refused-messages) yIlegh). **Hegh** tlheghDaq **nIDqa'** — tetlhqa'; **chu'qa'** — tetlh laDqa'.

### tay' 'ay' {#pairing}

Sovbe'lu'bogh ngeHwI'pu' tay' ngoq Suq 'ej naDev loS. lajDI', ghoqwI' rarlu'bogh SIchlaH He; tay'mey taghqa' yIn. **supportsPairing** ghajbogh tetlh Segh 'oH Telegram'e'.

| SeHwI' | QIj |
|--------|-----|
| **tay'** per | tay' poQlu'DI' He navDaq |
| **yIlaj / yIlajHa'** | loSbogh tlhob wuq |
| tlheghmey | Hal, ngeHwI', ngoq, tlhobta' |

chImDI': *loS tay' tlhob tu'lu'be'.*

## latlh

- [Telegram](/docs/tlh/communication/telegram/)
- [A2A](/docs/tlh/communication/a2a/)
- [ghoqwI'pu' — Hemey](/docs/tlh/agents/configure/)
- [rarmey](/docs/tlh/admin/connections/)
- [ghopmey](/docs/tlh/admin/hands/)
- [Ingress](/docs/tlh/admin/ingress/)
