---
title: Biztonság és adatvédelem
description: Security gate, audit, privacy, SSRF, remote SSH.
---

Security gate, `/security` események, `/audit` napló, `/privacy` kontrollok. Lásd Autonómia + Secrets.

### Böngésző SSRF

A browser toolok **privát / metadata** hostokat blokkolnak (SSRF kockázat csökkentése). Struktúrához preferáld a `browser_snapshot`-ot.

### Remote node SSH

A Nodes **SSH invoke** guarded parancsokat futtat; destruktív minták explicit force nélkül blokkolva. Nem-SSH típusoknál az invoke lehet nem implementált.

## Kapcsolódó

- [Autonómia](/docs/hu/agents/autonomy/)
- [Toolok](/docs/hu/automation/tools/)
- [Observability](/docs/hu/admin/observability/)
