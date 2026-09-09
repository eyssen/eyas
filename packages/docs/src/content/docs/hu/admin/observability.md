---
title: Observability és ops
description: Token-telemetria, trace-ek, költség, God mód futások, prompt-kontextus költség.
---

**Mire való.** Az Observability (`/observability`) ennek a példánynak a telemetria-felülete: trace-ek, költség, késleltetés, anomáliák, ensemble (God mód) futások, és amit a modell *ténylegesen* kapott. Az **Ops** (`/ops`) a javítás. A kezek, távoli csomópontok, bővítmények és értesítési beállítások **nem** ezen a lapon vannak — saját fejezeteik vannak.

| Terület | Útvonal | Jelentés |
|---------|---------|----------|
| Observability | `/observability` | Metrikák / tracing — **Usage**, **God Mode**, **Kontextus** fülek |
| Ops | `/ops` | Kubernetes ops agent — megfigyel → diagnosztizál → javasol → jóváhagy → alkalmaz. Alap **csak javaslat**. Cluster URL, kubeconfig és GitOps repo példány-config, nem termék-default. |

Máshol (nem ez a lap): [Kezek](/docs/hu/admin/hands/) (`/hands`), [Távoli csomópontok](/docs/hu/admin/nodes/) (`/nodes`) — őrzött SSH invoke-kal, [Ingress](/docs/hu/admin/ingress/) (`/ingress`), [Bővítmények](/docs/hu/admin/extensions/) (`/extensions`), [Értesítések](/docs/hu/admin/notifications/) (`/notifications-settings`).

### Usage fül

A **Usage** a token-telemetria: **Total Traces**, **Total Cost**, **Avg Latency**, **Anomalies**, napi költség, modell-eloszlás, és a trace tábla (időbélyeg, modell, provider, tokenek, költség, késleltetés, eszközök, minőség).

### God Mode fül

A `/observability` három fület mutat: **Usage** (meglévő trace-ek / statisztikák), **God Mode** és **Kontextus**. A God Mode fül listázza az ensemble futásokat (beszélgetés, győztes, modellszám, költség, időtartam, döntetlen-bontás), a modell szerinti győzelmi arányt, és az átlagos költség-szorzót egyetlen modellhez képest. Egy futásra kattintva a beszélgetés God füle nyílik (lépésnapló, ki kire szavazott, keresztértékelés).

Keret, döntési szabályok és a God fül olvasása: [Beszélgetések — God mód](/docs/hu/daily/conversations/#god-mód).

### Kontextus fül

A **Kontextus** fül olyan kérdésre válaszol, amire eddig semmi nem tudott: mit kapott *ténylegesen* a modell — nem amit küldeni szántunk. Mutatja az egyes promptrészek átlagos és maximális token-költségét (és hogy hány mintán alapul), a csonkítási gyakoriságot (milyen gyakran és melyik szekció vágódik le a keret betartásához), és a becsült vs. tényleges eltérést: a token-becslés és a szolgáltató által jelentett tényleges érték közti rést — eddig sosem lehetett mérni, mekkora ez a hiba.

A részletes, szekciónkénti rekordok megőrzési ideje rövid (alapból 7 nap); hosszú távon csak a napi összesítés marad meg. Ha régi részletet keresel és nem találod, az szándékos, nem adatvesztés.

## Kapcsolódó

- [Mission Control](/docs/hu/agents/runs/)
- [Biztonság](/docs/hu/admin/security-privacy/)
- [Beállítások áttekintés](/docs/hu/admin/settings/)
- [Kezek](/docs/hu/admin/hands/)
- [Távoli csomópontok](/docs/hu/admin/nodes/)
- [Bővítmények](/docs/hu/admin/extensions/)
- [Értesítések](/docs/hu/admin/notifications/)
