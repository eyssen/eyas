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

**Nincs tulajdonosi memória a peereknek.** Egy másik agent által A2A-n küldött task megkapja az aktuális dátumot és időt, de felidézett tulajdonosi memória nem kerül bele — a felidézett memóriablokk, amelyet minden belső futás kap, itt elmarad. A memóriatoolok (`memory_search` / `memory_expand`) változatlanok, és továbbra is a biztonsági kapu felügyeli őket. Amit egy peer küld, azt az EYAS *peer* szövegként jegyzi meg, nem a tiédként. Lásd [Memória — Hogyan jut el a felidézés a modellhez](/docs/hu/knowledge/memory/#how-recall-reaches-the-model).

**Memóriarögzítés A2A taskokon.** Egy A2A task mostantól az EYAS tartós memóriarögzítését (capture) is lefuttatja, ugyanazokkal a `memory.capture.*` beállításokkal, mint egy chatkör. A peer taskját az EYAS harmadik fél szavaiként olvassa: soha nem hoz létre jegyzetet arról, hogy ki vagy, sem szabályt arról, hogyan dolgozzon az EYAS, csak `reference`, `project` vagy `domain` jegyzetet, peer bizalmi szinten tárolva (`trust: peer`), és soha nem egészíti ki a saját jegyzeteid egyikét. A `minUserChars` küszöbbe csak a peer saját szavai számítanak. Lásd [Memória — A capture alapból be van kapcsolva](/docs/hu/knowledge/memory/#capture-is-on-by-default).

**Modell és effort.** Egy A2A task a kötött agent beszélgetéseként fut: az agent modelljét és effortját követi; ha az agentnek nincs modellje, az első válasszal a telepítés alapértelmezése rögzül a beszélgetésen.

**A peer szövege keretbe kerül.** A feladatleírás a csatornaüzenetekhez hasonlóan egy nem megbízható bemenet blokkban (forrás: `a2a`) jut el a modellhez, a benne lévő vezérlőcímkéket az EYAS hatástalanítja — így egy peer nem kezdheti a feladatát olyan szöveggel, amely az EYAS saját dátum-idő vagy felidézett memória blokkjának látszik.

**Nincs** Kommunikáció UI-fül A2A peerekhez. A csatornakatalógus szándékosan kihagyja az MCP / A2A chat-kártyákat.

## Kapcsolódó

- [Ingress](/docs/hu/admin/ingress/)
- [Csatornák](/docs/hu/communication/channels/)
- [Agentek](/docs/hu/agents/overview/)
- [Eszközök](/docs/hu/automation/tools/) (A2A delegate)
