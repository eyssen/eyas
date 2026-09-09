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

## latlh

- [Ingress](/docs/tlh/admin/ingress/)
- [Hemey](/docs/tlh/communication/channels/)
- [ghoqwI'pu'](/docs/tlh/agents/overview/)
- [janmey](/docs/tlh/automation/tools/)
