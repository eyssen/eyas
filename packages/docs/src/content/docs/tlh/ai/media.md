---
title: nagh beQ
description: Magnific, Higgsfield, fal ghap yIrar. ghoqwI'pu' vagh jan lo'. nIH HolDaq bIwuq — wa' pagh law'.
---

**nuq 'oH.** nagh beQ 'oH EYAS 'e' chenmoH, tInmoH, loS je naghmey, nagh tIH, QoQ, choH, 3D je. nIH HolDaq bIwuq; ghoqwI' **wa' jan tetlh** neH lo'. cha'vatlh nobwI' motlhbe'. pagh rar = chIm, Qaghqangbe' — nagh ngeb 'oHbe'.

**He:** `/media`. ram: **nagh beQ** (nobwI'pu' 'em). pong: **nagh beQ**.

## ghorgh lo'

- ghoqwI' nagh chenmoH, tInmoH, nagh tIH chen, pagh Qu' tIq loS.
- Magnific, Higgsfield, fal mID Daghaj 'ej **vaghmaH** jan nIH HolDaq DachevQo'.
- Huch motlh — jaj / jar moj pagh Segh motlh.
- ngogh ghun [De' ngogh](/docs/tlh/knowledge/documents/) je ja'chuq mIwDaq nargh.

## mIw

1. **nagh beQ** (`/media`) yIpoSmoH.
2. **'ar nIH** yIlaD, vaj **rar**. Magnific Higgsfield je: OAuth webbogh De'wI'; fal: API ngaq.
3. Dotlh **rarchu'**. **He** yIHuj, **Huch Hutlh** optional.
4. ja'chuqDaq yIqel. ghoqwI' `media_catalog`, `media_generate`, `media_wait` ja'.
5. Qu' rInDI', EYAS ngogh De' ngoghDaq qeng. CDN URL SIQbe' — ngogh pol.

## 'ar nIH? {#compare}

Suy tetlh «lo'wI'» «web / API» ja'. EYAS: **nuq QaQ, chay' 'el, chay' Huch, chay' ngogh.**

| qel | Magnific | Higgsfield | fal |
|-----|----------|------------|-----|
| **QaQ** | nagh beQ photoreal, **Creative** tInmoH, **Precision** tInmoH | nagh tIH cinema, ghot rorgh (Soul) | tetlh tIn, Huch qel pa' vIH |
| **Seghmey** | tInmoH, nagh, choH (nagh tIH / QoQ / 3D je) | nagh tIH, nagh (QoQ je) | nagh, nagh tIH, QoQ, 3D, tInmoH |
| **'el** | OAuth (Magnific mID) | OAuth (Higgsfield mID) | Bearer API ngaq (`fal-api-key`) |
| **Huch** | Magnific jan rorgh. jan **Unlimited** MCP/API lo'be' | MCP **reH** Huch ngeH, jan Unlimited je | MCP lo'be'; qeq vIH DIl |
| **ngogh** | CDN URL — EYAS qeng | URL **Sochnat jaj** SIQ — ingest 'ut | CDN URL — qeng je |
| **wa'DIch rar** | tInmoH, choH, nagh beQ | nagh tIH, ghot rorgh | tetlh tIn pagh Huch qel |

**qeS**

1. **wa' nIH rar** Qu' Daghaj. nagh / tInmoH → Magnific. nagh tIH / ghot → Higgsfield. tetlh / Huch → fal.
2. **cha' nIH** Segh choHDI' neH. **motlh / lIng** QaghwI' Qan; **vIH je** *nagh mu'tlhegh* cha' SuyDaq ngeH 'ej **cha' Huch**. chIm yIchaw' — nargh qel 'e' DapoQbe'chugh.
3. **jan MCP Qutlh yIchu'Ha'** — Debug neH. ghoqwI' jan tetlh chen 'ej ingest qIl.

nagh mu'tlhegh je **De'wI'vo' nargh** SuyDaq. SaaS rur.

## vagh jan

| jan | Qu' | QIH |
|-----|-----|-----|
| `media_generate` | Qu' tagh (`image`, `video`, `audio`, `upscale`, `edit`, `3d`) | Hurgh |
| `media_wait` | rIn loS (180 lup, 600 lup) | Hurgh |
| `media_catalog` | Segh qeq tetlh | SuD |
| `media_balance` | Huch chu' | SuD |
| `media_history` | Qu' chu' naDev | SuD |

pagh nobwI' pagh pin rarbe': Qagh `/media` ja'.

## `/media` Huj

**He.** Segh wa' tlhegh. **motlh** ghoqwI' nobwI' pongbe'chugh. **lIng** motlh rarbe'chugh. **vIH je** fan-out neH.

qeS motlh (nobwI' rar 'ej pinbe'): tInmoH / nagh / choH → Magnific; nagh tIH → Higgsfield; QoQ / 3D → fal.

**Huch Hutlh.** jaj / jar moj **nobwI'**. moj 'elDI' Suy pa' Qagh. Huch Sovbe' botbe'.

**jan MCP Qutlh.** motlh chu'Ha'. chu'Ha' yIchaw'.

## Huch ingest je

Qu' rIn URL (200 MB, **JPEG qIl**) De' ngoghDaq, ja'chuq AI, mIw ngoq. `documentIds` lo' — Suy URL lo'Qo'.

tInmoH: **wa'DIch ngogh** (`documentId` pagh URL). canvas JPEG lo'Qo'.

## Qagh Qaw'

| Qagh | nID |
|------|-----|
| OAuth 'em **rarbe'** | webbogh 'el rIn, `/media` chegh. **nID**. |
| Segh nobwI' Hutlh | Segh ja' nIH rar, pagh motlh Huj. |
| Qu' rIn 'ach nagh Hutlh | **Qu' chu'** je [De' ngogh](/docs/tlh/knowledge/documents/). URL SIQlaH. |
| Huch ngeD | **vIH je** chu' pagh cha' pin. Huch Hutlh. |
| MCP ServerDaq He | `/media` poSmoH 'ej **nID**. nagh beQvo' rar, MCP tetlh neH lo'Qo'. |

## latlh

- [MCP Servers](/docs/tlh/ai/mcp/)
- [janmey](/docs/tlh/automation/tools/)
- [De' ngogh](/docs/tlh/knowledge/documents/)
- [rarmey](/docs/tlh/admin/connections/)
- [nobwI'pu'](/docs/tlh/ai/providers/)
