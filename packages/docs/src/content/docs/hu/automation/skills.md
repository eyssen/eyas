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

## Skill leltár és "halott skill" detektor

A **Leltár** fül (Böngészés mellett) soronként mutatja: melyik másolat nyert, mit fed el, honnan jött, mennyit használták, engedélyezve van-e. Azonos skill-id esetén fix sorrend dönt — sosem a fájlrendszer sorrendje: **User > Generated > Bundled (extension) > Bundled (EYAS)**; egyenlőségnél ABC sorrendben előbb a forrás-gyökér, aztán az elérési út. A vesztesek nem tűnnek el — elfedettként (shadowed) jelennek meg.

A detektor **csak javasol, sosem cselekszik**: háttérben átnézi az engedélyezett skilleket, és amit gyanúsnak talál — árva (a forrásfájl megszűnt), elfedett, sosem használt (0 használat, 90 napnál régebbi) vagy alvó (180+ napja használatlan) — arra javaslatot tesz az [autonómia approval sorba](/docs/hu/agents/autonomy/). **Letilt, sosem töröl** — és a letiltás is csak jóváhagyás után történik. Az árva/elfedett tényszerű, ezért azonnal javasolt; a sosem-használt/alvó becslés, ezért 30 napos türelmi idő védi, és a saját (user) skilljeid ki vannak véve mindkét időalapú szabály alól.

Ez ugyanannak az életciklusnak a másik vége, mint a fenti Auto-adoption gate — az a bekerülést, ez a kikerülést szabályozza.

## Kapcsolódó

- [Toolok](/docs/hu/automation/tools/)
- [Self-learning](/docs/hu/automation/self-learning/)
- [Autonómia](/docs/hu/agents/autonomy/)
