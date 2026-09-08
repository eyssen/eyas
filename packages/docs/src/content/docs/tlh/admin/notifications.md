---
title: Qum chu'
description: "'Iv QIn He'e' 'ej 'ar wab — web, QIn, Telegram, webhook."
---

**Qu' 'oH.** Qum chu' SeHmeyDaq wanI'mey He'e' 'ej wab DaWuq. wIv Hoch wanI' chovnatlh × He tetlh 'oH. Huch ghuH, ghoqwI' wanI'mey, latlh je bel, QIn, Telegram pagh webhookDaq ngeHlu' — wab'a' wIQoybe'. **potlh Qagh** reH tam poH je ghom nargh.

## ghorgh yIlo'

- wanI'mey 'op belDaq, latlh **Telegram** pagh **QIn**Daq.
- **ghuH** 'ej yoS neH, **De'** Hoch ghobe'.
- tam poH DapoQ (ram je), **potlh Qagh** Hop.
- QIn pagh webhook ghom Del DapoQ, law' ngeHghach Hop.
- HMAC HTTPS webhook DapoQ (n8n, Zapier, Home Assistant, latlh).

## motlh mIw

1. tlhop **SeHmey** ghom **patHommey** → **Qum chu'** (`/notifications-settings`) yIpoSmoH.
2. **wIv yIchel** bIngDaq **wanI' chovnatlh** yIghItlh (chovnatlh `agent.*`, `budget.warning` pagh `*`).
3. **He**, **mach 'ugh**, **nob mIw** yIwIv.
4. chaw'chugh **tam vo'** / **tam 'e'**. ram Saw' (22:00–07:00) Qap.
5. **chel**. tetlh **taH wIvmey** bIngDaq nargh.
6. He **Webhook** 'oHchugh, **Webhook Daq** yIghItlh 'ej **webhook yItoD**.

tetlh chu' chovnatlh, He, ≥ 'ugh, **ghom Del** / tam Degh je tu'lu'nIS.

## laHmey

wanI' chovnatlh × He wa' tetlh. chovnatlh Segh glob 'oH: `*` Hoch; `agent.*` `agent` veb Segh; `budget.warning` wanI'vam neH.

**He:** **Web** (bel / WebSocket), **QIn**, **Telegram**, **Webhook**. QIn Telegram je nob neH, rar taHchugh (SMTP peghmey / Telegram bot rarlu'). naDev He wIv chenmoHbe' rarvam.

**tugh** DaH ngeH. **ghomlu'** Del tetlh (QIn webhook je; vagh tup motlh). **Web** **Telegram** je ghom nargh. **potlh Qagh** reH tugh ngeH 'ej tam poH tu'be'.

tam poH `HH:MM` lo' 'ej ram vegh.

webhook POST JSON 'oH (`event`, `severity`, `title`, `body`, `data`, `createdAt`, `notificationId`). laj pegh chaw'chugh `X-EYAS-Signature: sha256=…` (HMAC-SHA256). latlh HTTP aftermey DaqDaq toDlu'laH (API); Form URL, pegh, **Qap** ghaj. nav QIn: https URL neH; loopback De' juH je (`169.254.169.254`, `.internal`) nargh.

ngeH Qagh nIDqa' tetlh jaH (wej nID, 30 lup vo' backoff). ghIq **Qagh (Hegh QIn)**. **nIDqa' tetlh** nIDqa' Qapchugh cha'lu'.

woS bel QInmey tetlh 'ej laDlu'ta' 'ang. navvam wIvmey neH.

## mIwmey 'ej SeHwI'mey

<h2 id="preferences">taH wIvmey</h2>

| SeHwI' | Del |
|--------|-----|
| **taH wIvmey** | tetlhmey tu'lu'bogh. chIm: *wIv pagh. bIngDaq yIchel.* |
| wanI' chovnatlh Degh | glob tu'lu', `agent.*` rur |
| He Degh | **Web** / **QIn** / **Telegram** / **Webhook** |
| ≥ 'ugh | tetlhvam mach 'ugh |
| **ghom Del** | **nob mIw** **ghomlu'** 'oHchugh |
| tam `vo'`–`'e'` | tetlhvam tam poH |
| Qaw' jan | chovnatlh × He tetlh Qaw' |

<h2 id="add-preference">wIv yIchel</h2>

| SeHwI' | Del |
|--------|-----|
| **wanI' chovnatlh** | Daq: `agent.* pagh budget.warning pagh *` |
| **He** | **Web**, **QIn**, **Telegram**, **Webhook** |
| **mach 'ugh** | **De'**, **ghuH**, **Qagh**, **potlh Qagh** |
| **nob mIw** | **tugh** pagh **ghomlu'** |
| **tam vo'** / **tam 'e'** | poH mIw. cha' poQ tam toDmeH; chIm = tambe' |
| **chel** | tetlh yItoD (chovnatlh chImchugh QapHa') |

<h2 id="webhook">Webhook Daq</h2>

| SeHwI' | Del |
|--------|-----|
| **URL** | ghoS. Daq `https://hooks.example.com/eyas` |
| **laj pegh (poQbe' — HMAC-SHA256 qon chu')** | pegh mIw. pegh tu'lu'chugh: *(choHbe' — toDmeH chIm yIchaw')* |
| **Qap** | wIvHa'chugh webhook toDlu' 'ach lo'lu'be' |
| **webhook yItoD** | URL / pegh / Qap toD (URL chImchugh QapHa') |
| **teq** | webhook toDlu'bogh Qaw' (tu'lu'chugh neH) |

<h2 id="retry-queue">nIDqa' tetlh</h2>

| SeHwI' | Del |
|--------|-----|
| **loS** | nIDqa' poH taH |
| **Qagh (Hegh QIn)** | nID rIn |
| **chu'qa'** | wIvmey, webhook, nIDqa' mI'mey chu'qa' |

## latlh

- [SeHmey Del](/docs/tlh/admin/settings/)
- [chelmeH janmey](/docs/tlh/admin/extensions/)
- [hopbogh Daqmey](/docs/tlh/admin/nodes/)
- [ghopmey](/docs/tlh/admin/hands/)
- [Hemey](/docs/tlh/communication/channels/)
- [Telegram](/docs/tlh/communication/telegram/)
- [peghmey](/docs/tlh/admin/secrets/)
