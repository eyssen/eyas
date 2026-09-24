---
title: AI bej 'ej vum
description: token mI'mey, tlha'mey, Huch, Qun mIw qetmey, mu'tlhegh De' Huch, nobwI'vaD qawHaq nobghach je.
---

**Qu' 'oH.** AI bej (`/observability`) Dochvam mI' nav 'oH: tlha'mey, Huch, poH, Qaghmey, ghom qetmey (Qun mIw), pat Hevbogh mu'tlhegh *teH*, 'ej EYAS qawHaq Hoch nobwI' Hevta'bogh rap'a'. **vum** (`/ops`) Qagh tI'. ghopmey, hopbogh Daqmey, chelmeH janmey, Qum chu' SeHmey je **navvamDaq tu'lu'be'** — paqchaj tu'lu'.

| Daq | He | Del |
|-----|-----|-----|
| AI bej | `/observability` | **AI bej** nav (retlh tetlh: **bejlaH**) — **lo'**, **Qun much**, **De'** qachmey |
| vum | `/ops` | Kubernetes vum ghoqwI' — bej → chov → chup → chaw' → lo'. motlh **chup neH**. cluster URL, kubeconfig, GitOps repo pat SeH 'oH, lIng motlh 'oHbe'. |

latlh (navvam ghobe'): [ghopmey](/docs/tlh/admin/hands/) (`/hands`), [hopbogh Daqmey](/docs/tlh/admin/nodes/) (`/nodes`) — Hub SSH invoke je, [Ingress](/docs/tlh/admin/ingress/) (`/ingress`), [chelmeH janmey](/docs/tlh/admin/extensions/) (`/extensions`), [Qum chu'](/docs/tlh/admin/notifications/) (`/notifications-settings`).

## ghorgh yIlo'

- AI ra'mey Huch jaj Hoch pat Hoch je DaSovchugh DaneH, 'ej EYAS Hop Qu' 'oHbogh ra'mey.
- QIt mIw, Huch law' mIw pagh jan lo'bogh mIw — tlha'Daj DaneH.
- jangmey DaDIlchugh DaneH, pagh Qun much qet wuqlu'pu'ghach Daleghchugh DaneH.
- mu'tlheghDaq nuq tu'lu' teH, 'ay' nuq pe'lu', token pIH nI'ghach je Daleghchugh DaneH.
- Hoch nobwI' — API patmey CLImey je — rap qawHaq Hev'a' Dachovchugh DaneH.

## motlh mIw

1. retlh tetlhDaq **bejlaH** yIpoSmoH (`/observability`).
2. **lo'** qachDaq tlha' tetlh yImach **pat**, **vo'**, **Daq**, **ngoQ** je lo'taHvIS; tlhegh QavDaq DeSqIv Dung / bIng lo'taHvIS tlha' yIDIl.
3. ghom qetmey Qap mI' je DaneHchugh **Qun much** yIpoSmoH.
4. **De'** yIpoSmoH; **nobwI' qawHaq nobta'ghach** yItagh, ghIq 'ay' motlh, pe'lu'ghach, ngeb / teH je.

## laHmey

<h3 id="usage-tab">lo' qach</h3>

**lo'** token mI' 'oH: **Hoch tlha'**, **Hoch Huch**, **poH motlh**, **pIm ghu'mey** 'emwI'mey, **jaj Huch**, **pat 'ay'mey**, **pIm ghu' taHbogh**, 'ej tlha' tetlh — **poH De'**, **pat**, **nobwI'**, **ngoQ**, **Tokens**, **Huch**, **poH nI'**, **janmey**, **QaQ** — Dung **pat**, **vo'**, **Daq**, **ngoQ** SeHwI'mey.

**pat 'ej "jang".** **pat** tlhegh DawIvbogh pat ID pol, vaj per 'ej Huch choHbe'. latlh pat naQ ja'chugh nobwI' — jaj ghajbogh pat chovnatlh, He wIvbogh pat (OpenRouter auto rur), Ollama pagh LM Studio 'elmoHbogh pat, Grok Qapbogh pat — cha'DIch tlhegh 'ang: *&lt;pat&gt; jang*. Hop qawHaq capture mIwmey je pat naQvetlhvaD ghoSlu'.

**vum.** Hoch AI ra' tlha' qel tlhoblu'bogh meq vum, pat rarmoHlu'DI' lo'lu'bogh vum, 'ej tlhobghach Hal (ja'chuq, jeD, ghoqwI', ja'chuq nobwI', He patlh, model motlh, …). [nobwI'pu' — meq vum](/docs/tlh/ai/providers/#reasoning-effort).

**ngoQ.** Hop pat ra' — 'egh ra'bogh EYAS, ja'chuq mIw 'oHbe'bogh — **ngoQ** tlheghDaq ngoQ ghomDaj 'ang:

| per | Hop ra'mey |
|-----|------------|
| **qawHaq** | qawHaq capture, ram qawHaq boq, qelqa' ja', Data Port tlhap chelmoH |
| **ghoj** | tIq Qum, Self-learning, Forge, laH ghItlh |
| **pongmey** | pong nIteb |
| **Hung chov** | Hub noHwI', naQ chovwI', rubric nabwI' |
| **nab** | ghom chupmey, 'ay'mey jojDaq nabqa'wI' |
| **tej** | tej Qapmey |
| **wIv** | He nISbe' SeHwI' |

ja'chuq mIw (motlh ja'chuq pagh ghoqwI' mIw) *—* 'ang, 'ej ngoQ qonbe'bogh ngo' chovnatlhmey tlha'mey je. **ngoQ** SeHwI' **Hoch ngoQmey** (motlh) pagh wa' ghom nob; ghom Hop ra'meyDaj neH tetlh (ja'chuq mIwmey rapbe' not), 'ej SeHwI' DachoHDI' wa'DIch navDaq cheghlu'. Hoch Hop ra' ja'chuq mIw rur tlha'lu' — nobwI', pat, tokens, Huch, poH, tlhoblu'bogh lo'lu'bogh vum je (Hal *He patlh*) — 'ej Huchvetlh Huch jaj, Hogh, jar 'aqroSmeyDaq toghlu', ja'chuq mIwmey rur. pat lo'laHbe'lu'mo' QaplaHbe'bogh Hop ra' pat ra' pagh, tlha' pagh, Huch pagh. pong nIteb ra'mey ja'chuqchajvaD ghoSlu'. ghom ra'mey nuqDaq ghoS: [He 'ej Huch — retlh pat ra'mey](/docs/tlh/ai/routing-budget/#background-model-calls-card).

**janmey.** **janmey** tlhegh Hoch nobwI'Daq rap tlha' jan ra'mey toghlu': EYASvaD pat nobqa'bogh ra', 'ej CLI — Claude Code, Grok CLI, Kimi Code CLI je — mIwDaj'eghDaq Qapbogh ra', CLI jan chenlu'pu'bogh (shell, teywI' laD, …) pagh EYAS QIn'a'Daq ra'bogh EYAS jan. Hoch ra' wa'logh toghlu'. ngo' chovnatlhmey Hoch CLI mIwvaD 0 'ang.

**QaQ.** **QaQ** tlhegh DIlghach'e'lIj 'oH: tlhegh QavDaq DeSqIv Dung / bIng tlha' *QaQ* pagh *qab* per. tlha'mey DIlbe' EYAS nIteb; tlheghvamDaq mI' tu'lu'chugh, ngo' chovnatlh qonpu'bogh tlha' 'oH.

**Hoch nobwI'Daq rap token mI'.** *Input* tokens: nobwI' qawHaqvo' **ngeHlu'be'bogh** mu'tlhegh tokens; qawHaq laDmey (Anthropic qawHaq ghItlhmey je) pIm toghlu'. ngo' chovnatlhmey OpenAI qorDu' Gemini je input tokensDaq qawHaq 'ay' ngaS, vaj DaH qawHaq law'bogh ja'chuqDaq input mI'chaj mach, 'ej qawHaq 'ay' qawHaq laD rur 'anglu'. meq pagh Qub tokens *output* tokens 'ay' 'oH; ngo' Gemini Qub tokens Hutlh, vaj DaH Qubbogh Gemini patmeyvaD output mI' Dun. OpenAI meq tokens Gemini Qub tokens je pIm pollu' meq tokens rur, De'vaD neH — cha'logh DIlbe'lu'. Grok CLI Kimi Code CLI je mI' rap. lo' ja'be'chugh nobwI' (rap De'wI' 'op, mI' Hutlhbogh Ollama, pagh Qapmeyvaj pagh ja'bogh CLI), mIw *ja'be'lu'* per ghaj, pagh teH rur pollu'be'; $0 rarbe' *lo' ja'be'lu'* 'ang ja'chuq 'ej *—* 'ang Qap Sor. Anthropic APIDaq mu'tlhegh qawHaq nIteb Qap, vaj ra'meyvamvaD qawHaq laD qawHaq ghItlh je tokens 'anglu' ([nobwI'pu' — mu'tlhegh qawHaq](/docs/tlh/ai/providers/#prompt-caching-anthropic-api)).

**Huch.** Huch'egh ja'chugh nobwI', Huchvetlh lo' tlha'. ja'be'chugh, token mI'vo' Huch pIH EYAS, 'ej wa'logh neH Hoch mu'tlhegh token DIl: qawHaq Hutlh input — input DIl; qawHaq laDmey — pat qawHaq laD DIl; qawHaq ghItlhmey — qawHaq ghItlh DIl. Huch tetlh (pagh SeH `model.pricing` choH) pat qawHaq DIl ghajbe'chugh, qawHaq tokens motlh input DIl lo'lu'. *ja'be'lu'* lo' ghajbogh ra' not token mI'vo' DIllu': Huchvetlh nobwI' Huch ja'bogh 'oH, pagh $0. ngo' chovnatlhmey rur:

- Kimi API Kimi K3, 'ej `model.pricing` choHDaq qawHaq laD DIl ghajbogh Hoch pat: pIHmey mach, qawHaq 'ay' cha'logh toghlu'be'mo'.
- ngaSlu'bogh tetlh lo'bogh OpenAI Gemini je: input Huch rap taH.
- Qubbogh Gemini patmey: pIHmey Dun, Qub tokens output rur DIllu'mo'.
- tetlhDaq Hutlhbogh Anthropic rap Daqmey: qawHaq tokens Qob Hutlhbogh input DIl lo', Huch pagh ghobe'.
- Huch ja'be'bogh 'ach token mI' ja'bogh CLI Claude Code mIwmey: qawHaq tokens Anthropic qawHaq DIl lo', Huch pagh ghobe'.

SeH pagh, vIHmoH pagh: tlha' tlhegh chu' nIteb chellu'.

**API (pIn 'ej rarwI'pu').** `GET /api/v1/observability/traces` (`/traces/:id` je) audit log laD chaw' poQ (read `AuditEntry`). tlhegh Dungvo' latlh, Hoch tlha' ngaS:

- `purpose` (ngoQ naQ, `capture`, `title`, `security_judge`, `triage` rur), `auxRoute` (chay' pat wIvlu': `tier` = ngoQ He patlh, `default` = lIng motlh, `api` = API nobwI', `isolated-cli` = mob QaplaHbogh CLI) `purposeGroup` je — ja'chuq mIwmeyvaD wej Hoch null 'oH;
- `toolCalls` — ra'mey JSON tetlh, Hoch `{name, id}`, 'ej CLI mIwDaj'eghDaq rInmoHbogh ra'vaD `executedBy` (`provider` pagh `eyas`);
- `memoryTiersUsed` — mIwvamDaq qawqa'lu'bogh qawHaq JSON mI'mey, Hoch 'ay'vaD: `vt` vault ghItlh, `gs` nob naQ, `ft` teH, `en` Dol, `ep` qaSpu'bogh wanI', `rw` De' tlhol, rur `{"vt":75,"gs":5,"ft":3}`. qawHaq ngaSbe'chugh mIw null 'oH, 'ej De' chellu'ghach ghajbe'bogh ra'meyvaD (Hop ra'mey).

tetlh `purposeGroup=memory|learning|title|safety|planning|research|triage` lajlu'. tlhob chovlu': Sovbe'lu'bogh `purposeGroup`, mI' 'oHbe'bogh pagh veH Hurbogh `limit` (1–500), teH bIngbogh `offset`, pagh mI' 'oHbe'bogh/teH bIngbogh `minCost` — `400` nob, buSHa'be'. chImbogh Dochmey tu'lu'be' rur toghlu'.

<h3 id="god-mode-tab">Qun much qach</h3>

**Qun much** qach ghom qetmey tetlh (ja'chuq, QapwI', pat mI', Huch, poH, ram ghob 'e' wuqlu''a'), Hoch pat Qap mI', 'ej wa' pat rur Huch vagh motlh. qet yIwIv 'ej ja'chuq Qun qach poSmoHlu' (mIw qon, 'Iv 'Iv wIv, Hoch pat latlhvaD jatlhghach je).

qet chay' chenmoHlu', QapwI' chay' wIvlu', ja'chuq Qun qach chay' DalaD: [ja'chuqmey — Qun mIw](/docs/tlh/daily/conversations/#qun-miw).

<h3 id="context-tab">De' qach</h3>

**De'** qach pat Hevbogh *teH* 'ang — ngeHmeH nabbogh ghobe'. **nobwI' qawHaq nobta'ghach** (bIng) tagh, ghIq:

- **ngeb / teH** — EYAS token pIH, nobwI' ja'bogh mI' je joj, Qagh motlh je;
- **'ay' tokens motlh** — Hoch mu'tlhegh 'ay' tokens Huch motlh 'aqroS je, 'ej chovnatlh mI';
- **pe'lu'ghach mI'** — chay' pIj 'ej 'ay' nuq Huch veHmeH pe'lu'.

'ay'Hom De' tIq ngaDbe' (motlh jaj Soch, `observability.contextRetentionDays`); jaj Hoch mI' neH taH. ngo' De' DanejDI' Dotu'be'chugh, motlh 'oH — De' Qaw'lu' ghobe'.

<h4 id="memory-delivery-by-provider">nobwI' qawHaq nobta'ghach</h4>

Hoch nobwI'vaD, mIwmeyDaj rap EYAS qawHaq Hev'a' 'ang 'emwI'vam — API pat CLI je rap qawHaq Hev'a' DachovmeH. nIHDaq poH yIwIv: **7 jaj Qav**, **30 jaj Qav** pagh **90 jaj Qav**. poHvamDaq mIwmey janglu'bogh Hoch nobwI'vaD wa' tlhegh; lIb ghu'DI', teH jangbogh nobwI'vaD mIw toghlu'.

| tlhegh | Del |
|--------|-----|
| **nobwI'** | nobwI' ID. mIwmey QavDaj DaleghmeH yI'uy |
| **qawHaq ghajbogh Qu'mey** | *N / M*: qawqa'lu'bogh qawHaq ngaSbogh QIn ghajbogh mIwmey, Hoch mIwmeyDajvo' |
| **'ay' Doch (motlh)** | qawHaq ngaSbogh mIwmeyDaq Hoch 'ay'vaD qawHaq Doch mI' motlh, 'ay' ngoq Deghmey rur (`vt`, `gs`, `ft`, `en`, `ep`, `rw`); 'ay' pong DaleghmeH Degh Dung yIghoS |
| **qawHaq tokens (motlh)** | qawHaq ngaSbogh mIwmeyDaq Doch token pIH motlh |
| **Qu'vaD qawHaq nejmeH** | *X ghogh · Y Doch*, Hoch mIwmeyDaq motlh: pat'egh ra'bogh 'ej vay' laDbogh `memory_search` / `memory_expand` ra'mey, 'ej ra'meyvetlh laDbogh qawHaq Dochmey |

nobwI' Da'uyDI', mIwmey Qav 10 tetlhlu': poH (ja'chuq poSmoHbogh rar), pat, Hoch 'ay'vaD Dochmey pagh *qawHaq tu'lu'be'*, qawHaq tokens, qawHaq nejmeH je (*ghogh · Doch*, pagh ra' mI' qonlu'pa' qonlu'bogh mIwmeyvaD *Doch* neH).

**nobwI'pu' chay' DarapmoH.** **qawHaq ghajbogh Qu'mey** **'ay' Doch (motlh)** je rapchugh, rap qawHaq Hev Hoch pat. **Qu'vaD qawHaq nejmeH** 'ang: qawHaq poSmoH'egh pat'a'. API patmey rur nejmeH puS law'bogh CLI EYAS qawHaq janmey paw'be' pagh lo'be'.

De' chellu'ghach 'ay'Hommey chenmoH 'emwI', vaj `observability.contextRetentionDays` (motlh jaj Soch) neH qa'. **30 jaj Qav** **90 jaj Qav** je latlh 'ang ngaDvetlh Dachennis neH. Doch Hoch qonbe'lu'bogh qawqa' ghajbogh mIw mIw rur toghlu', 'ach Doch pagh.

**API.** `GET /api/v1/observability/memory-parity?days=N` — `N` 1–90 mI' naQ 'oH (motlh 7); latlh bejlaH He rur read `AuditEntry` chaw' poQ, 'ej lughbe'bogh `days` `400` nob. jang: `{days, since, providers: [{provider, turns, memoryTurns, avgItemsByLayer, avgItems, avgMemoryTokens, drillDownTurns, avgDrillDownCalls, avgDrillDownReads, recentTurns: [{compositionId, createdAt, conversationId, model, hasMemory, itemsByLayer, items, memoryTokens, drillDownCalls, drillDownReads}]}]}`.

<h4 id="single-turn-composition">wa' mIw De' chellu'ghach</h4>

ja'chuq De' HevbIngvo' wa' mIw De' chellu'ghach poSlu' — [ja'chuqmey — De' chellu'ghach](/docs/tlh/daily/conversations/#context-composition): logh teblu'ghach juvlu'bogh pagh pIHlu'bogh, Hoch 'ay'vaD pegh Deghmey, **qawHaq nobta'lu'bogh** 'emwI' je. `GET /api/v1/observability/compositions/:id` rap nob: `composition.egress` 'ej Hoch 'ay'vaD `egress` (`{masked, spans, skipped}`) — pegh 'ay' nuq ta'; `composition.delivery` (turnId, profile, budgetTotalTokens, recall — ids, hits, retrieved, expanded, chars, budgetChars, tokens, budgetTokens, withheld — systemPromptChannel je); 'ej `composition.drillDown` (`{calls, reads, limit}`). pagh qonlu'DI' Hoch null 'oH; qawHaq SIch log laDlaHbe'lu'DI' null `drillDown` je. tetlh He choHbe'lu'. qawHaq SIch logDaq, mIw qawqa' tlheghmey 'ej qawHaq nejmeH tlheghmey wa' mIw ID (chellu'ghach ID) lo'chuq, 'ej mIw qoDDaq ra' mI' qon qawHaq nejmeH tlheghmey.

## latlh

- [Mission Control](/docs/tlh/agents/runs/)
- [He 'ej Huch](/docs/tlh/ai/routing-budget/)
- [qawHaq](/docs/tlh/knowledge/memory/)
- [law' EYAS](/docs/tlh/deploy/multi-instance/)
- [Hub](/docs/tlh/admin/security-privacy/)
- [SeHmey Del](/docs/tlh/admin/settings/)
- [ghopmey](/docs/tlh/admin/hands/)
- [hopbogh Daqmey](/docs/tlh/admin/nodes/)
- [chelmeH janmey](/docs/tlh/admin/extensions/)
- [Qum chu'](/docs/tlh/admin/notifications/)
