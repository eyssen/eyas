---
title: A2A 'ej Hur ghoqwI'pu'
description: ghoqwI'-ghoqwI' chut — agent card, 'el Qu', latlh ghom chaw'.
---

**nuq 'oH.** A2A chay' latlh ghoqwI' pat EYASvam tu' 'ej Qu' nob — nuv TelegramDaq 'oHbe', [ghop](/docs/tlh/admin/hands/) 'oHbe'. Agent Card: `/.well-known/agent-card.json`. `tasks/send` ja'chuq chenmoH 'ej `executeAgent` Qap. ghom API tu'lu'; Qum Dech **tu'lu'be'**.

## ghorgh yIlo'

- A2A lo'wI' patvam tu' 'ej Qu' ngeH.
- EYAS [Ingress](/docs/tlh/admin/ingress/) 'emDaq — well-known URL + auth.
- cha' EYAS pat ghom (`/api/v1/federation/peers`).

## motlh mIw

1. Hon He yIwIv. ngeH He neH, auth/ingress 'emDaq.
2. `GET /.well-known/agent-card.json` (`authentication.schemes` motlh `bearer`).
3. ghomwI' `tasks/send` ngeH — ja'chuq + `executeAgent`.
4. chaw': `POST /api/v1/federation/peers`. inbound ngoq wa'logh yInob; choH `POST …/rotate-inbound`. pong `peerId/agentId`.

motlh laHmey navDaq: `research`, `code-review`. He tetlh MCP/A2A ja'chuq navmey vo' tlhe'.

**ghomwI'pu'vaD joH qawHaq pagh.** A2A lo'taHvIS latlh ghoqwI' ngeHbogh Qu' DaH jaj poH je Suq, 'ach qawqa'lu'bogh joH qawHaq Suqbe' — Hoch qoD Qap Suqbogh qawqa' 'ay' So'lu'. qawHaq janmey (`memory_search` / `memory_expand`) choHbe'lu' 'ej Hub lojmIt SeH taH. ghomwI' ngeHbogh *peer* ghItlh rur qawlu', SoH ghItlhbogh ghobe'. [qawHaq — chay' qawqa' patDaq ghoS](/docs/tlh/knowledge/memory/#how-recall-reaches-the-model).

**A2A Qu'meyDaq qawHaq capture.** DaH EYAS qawHaq ngaQ capture Qap A2A Qu' je, ja'chuq mIw rap `memory.capture.*` SeHmey bIngDaq. ghomwI' Qu' latlh ghot mu'mey rur laDlu': SoH 'Iv ja'bogh ghItlhHom pagh EYAS chay' vum ja'bogh chut chenmoH not, `reference`, `project` pagh `domain` ghItlhHommey neH, ghomwI' voq patlhDaq pollu'bogh (`trust: peer`), 'ej ghItlhHommeylIj'eghDaq chel not. `minUserChars`Daq ghomwI' mu''egh neH toghlu'. [qawHaq — motlh chu' capture](/docs/tlh/knowledge/memory/#capture-is-on-by-default).

**pat 'ej vum.** rarlu'bogh ghoqwI' ja'chuq rur Qap A2A Qu': ghoqwI'vetlh pat vum je tlha'; pat ghajbe'chugh ghoqwI', wa'DIch jangDI' ja'chuqDaq lIng motlh ngaQlu'.

**ghomwI' ghItlh Qoplu'.** Qu' QIch patDaq ghoS voqbe'lu'bogh 'el ngaSwI'Daq (Hal `a2a`), ngaDHa' QInmey rur, SeH per ghorlu' — vaj EYAS poH pagh qawqa' ngaSwI' rurbogh ghItlh lo'taHvIS Qu'Daj taghlaHbe' ghomwI'.

## latlh

- [Ingress](/docs/tlh/admin/ingress/)
- [Hemey](/docs/tlh/communication/channels/)
- [ghoqwI'pu'](/docs/tlh/agents/overview/)
- [janmey](/docs/tlh/automation/tools/)
