---
title: Skillek
description: Skill katalógus — források, szűrők, létrehozó űrlap, auto-adoption gate.
---

**Útvonal:** `/skills`.

## Lista

Create Skill, keresés név/trigger szerint, szűrő All / Own / Bundled.

## Források

**Bundled** (szállított), **User** (te hoztad létre), **Generated** (generált), **Own** (import / own kategória).

## Űrlap

| Mező | Jelentés |
|------|----------|
| **Skill name** | Név |
| **Trigger patterns** | Vesszővel elválasztott trigger minták |
| **Skill content** | Markdown tartalom |

Show/Hide content a sorban.

---

## Bundled coding skill (példa)

`coding/odoo/odoo-dev-chain` — Odoo implement/review: előbb `odoo_search_*` + file toolok, utána kód. A toolokat az agent tool listája adja ([Konfiguráció](/docs/hu/agents/configure/)).

## Auto-adoption gate (skill curator)

A generált / evolvált skillek **nem kerülnek automatikusan** élőbe, hacsak egy friss privát benchmark snapshot el nem éri a min. **pass ratio** és **átlag score** küszöböket. A manuális create/enable a UI-ban ettől független.

## Kapcsolódó

- [Toolok](/docs/hu/automation/tools/)
- [Self-learning](/docs/hu/automation/self-learning/)
