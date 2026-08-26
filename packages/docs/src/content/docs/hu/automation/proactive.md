---
title: Proaktív asszisztens
description: Heartbeat-alapú javaslatok, riasztások és SLA jelek.
---

**Útvonal:** `/proactive`. Autonómia bekapcsolása után periodikus értékelés; riasztások a Dashboardon. Alapból ki.

---

## Heartbeat és SLA

A proactive heartbeat **SLA breach** jeleket (`slaBreaches`) is emíthet:

| Jel | Tipikus jelentés |
|-----|------------------|
| **Overdue** | Beszélgetés / aktivitás a due date után |
| **Stale** | Nyitott / working beszélgetés túl régóta idle |

Kezeld operator figyelemfelületként — Board prioritás + Dashboard setup ajánlások mellett.

## Kapcsolódó

- [Autonómia](/docs/hu/agents/autonomy/)
- [Kezdőlap](/docs/hu/daily/home/)
