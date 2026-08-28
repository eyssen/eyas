---
title: Observability és ops
description: Metrikák, ops, hands, nodes (SSH), ingress, extensionök.
---

| Terület | Útvonal | Jelentés |
|---------|---------|----------|
| Observability | `/observability` | Metrikák / tracing |
| Ops | `/ops` | Ops / remediation |
| Hands | `/hands` | Computer-use hub |
| Nodes | `/nodes` | Remote node-ok — **SSH invoke** destruktív-parancs guarddal |
| [Ingress](/docs/hu/admin/ingress/) | `/ingress` | Tunnel / remote access |
| Extensions | `/extensions` | Extension katalógus |
| Notifications | `/notifications-settings` | Értesítési csatornák |

### Nodes — SSH invoke

SSH-képes node-on guarded remote parancs. Destruktív minták force nélkül tiltva.

### God Mode fül

A `/observability` három fület mutat: **Usage** (meglévő trace-ek / statisztikák), **God Mode** és **Kontextus**. A God Mode fül listázza az ensemble futásokat (beszélgetés, győztes, modellszám, költség, időtartam, döntetlen-bontás), a modell szerinti győzelmi arányt, és az átlagos költség-szorzót egyetlen modellhez képest. Egy futásra kattintva a beszélgetés God füle nyílik (lépésnapló, ki kire szavazott, keresztértékelés).

Keret, döntési szabályok és a God fül olvasása: [Beszélgetések — God mód](/docs/hu/daily/conversations/#god-mód).

### Kontextus fül

A **Kontextus** fül olyan kérdésre válaszol, amire eddig semmi nem tudott: mit kapott *ténylegesen* a modell — nem amit küldeni szántunk. Mutatja az egyes promptrészek átlagos és maximális token-költségét (és hogy hány mintán alapul), a csonkítási gyakoriságot (milyen gyakran és melyik szekció vágódik le a keret betartásához), és a becsült vs. tényleges eltérést: a token-becslés és a szolgáltató által jelentett tényleges érték közti rést — eddig sosem lehetett mérni, mekkora ez a hiba.

A részletes, szekciónkénti rekordok megőrzési ideje rövid (alapból 7 nap); hosszú távon csak a napi összesítés marad meg. Ha régi részletet keresel és nem találod, az szándékos, nem adatvesztés.

## Kapcsolódó

- [Mission Control](/docs/hu/agents/runs/)
- [Biztonság](/docs/hu/admin/security-privacy/)
