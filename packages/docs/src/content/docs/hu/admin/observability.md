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

A `/observability` két fület mutat: **Usage** (meglévő trace-ek / statisztikák) és **God Mode**. A God Mode fül listázza az ensemble futásokat (beszélgetés, győztes, modellszám, költség, időtartam, döntetlen-bontás), a modell szerinti győzelmi arányt, és az átlagos költség-szorzót egyetlen modellhez képest. Egy futásra kattintva a beszélgetés God füle nyílik (lépésnapló, ki kire szavazott, keresztértékelés).

Keret, döntési szabályok és a God fül olvasása: [Beszélgetések — God mód](/docs/hu/daily/conversations/#god-mód).

## Kapcsolódó

- [Mission Control](/docs/hu/agents/runs/)
- [Biztonság](/docs/hu/admin/security-privacy/)
