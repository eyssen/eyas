---
title: A2A és külső agentek
description: Agent-to-agent protokoll — agent card, bejövő taszkok, opcionális peer federáció.
---

**Mire való.** Az A2A az, ahogy egy másik agent-runtime felfedezi ezt az EYAS-t és taszkot ad — nem ember Telegramon, és nem [Kéz](/docs/hu/admin/hands/) az asztalon. Az EYAS **Agent Card**ot publikál: `/.well-known/agent-card.json`. A bejövő `tasks/send` beszélgetést hoz létre és futtatja a kijelölt agentet. A peer federáció (EYAS↔EYAS) API-ként létezik; nincs hozzá Kommunikáció-fül.

## Mikor használd

- Másik A2A-kompatibilis kliens felfedezheti ezt a példányt és taszkot küldhet.
- Ingress mögött van az EYAS, és kell a well-known URL + auth séma.
- Két EYAS példány federál (`/api/v1/federation/peers`) — operátor, nem end-user chat.

## Tipikus folyamat

1. Döntsd el a trust boundaryt. Csak ott kapcsold be, ahol a hálózati kitettség szándékos; tedd auth/ingress mögé.
2. Agent card: `GET /.well-known/agent-card.json` (név, verzió, képességek, skillek, `authentication.schemes` alap `bearer`).
3. Peer `tasks/send`. Az EYAS beszélgetést hoz létre és `executeAgent`-et futtat — nem instant-fail, ha az agentek rendben vannak.
4. Opcionális: peer `POST /api/v1/federation/peers` (`name`, `baseUrl`). Az inbound tokent egyszer oszd meg; rotálás `POST …/rotate-inbound`. Cím: `peerId/agentId`.
5. Beszélgetések és az A2A task mailbox. Failed/unconfigured execution már nem instant-fail, ha az agentek be vannak állítva.

## Funkciók

| Fogalom | Jelentés |
|---------|----------|
| Agent card | Gép olvasható leírás a `/.well-known/agent-card.json`-on |
| Alap skillek a kártyán | `research` (Deep Research), `code-review` (Code Review) |
| Trust boundary | Csak szándékos kitettségnél |
| Discovery | A peer a well-known URL-t kéri |
| Task execution | `tasks/send` → beszélgetés + `executeAgent` |
| Mailbox | A2A task mailbox list/get |
| Peer registry | Opt-in EYAS↔EYAS; `peerId/agentId` |
| Tokenek | Inbound: amit a peer mutat; outbound: amit mi mutatunk |

**Nincs** Kommunikáció UI-fül A2A peerekhez. A csatornakatalógus szándékosan kihagyja az MCP / A2A chat-kártyákat.

## Kapcsolódó

- [Ingress](/docs/hu/admin/ingress/)
- [Csatornák](/docs/hu/communication/channels/)
- [Agentek](/docs/hu/agents/overview/)
- [Eszközök](/docs/hu/automation/tools/) (A2A delegate)
