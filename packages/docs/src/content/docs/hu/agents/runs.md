---
title: Futtatások és Mission Control
description: Agent runs lista, progress, Mission Control kártyák.
---

## Agent Runs

**Útvonal:** `/agent-runs`. Élő és múltbeli futtatások (státusz, token, költség, beszélgetés link).

## Mission Control

**Útvonal:** `/mission-control`. Élő ágens kártyák: Running, Waiting for approval, Paused, Idle, Error; stop/resume/open.

## Beszélgetésben

Agent progress, run tree, tool hívások — [Beszélgetések](/docs/hu/daily/conversations/).

## Kapcsolódó

- [Kezdőlap](/docs/hu/daily/home/)
- [Autonómia](/docs/hu/agents/autonomy/)

## Arculati megfelelés

Ha egy háttérfutás olyan projektben dolgozik, amelyhez arculat tartozik, és
olyasmit állít elő, amire az arculat vonatkozik — renderelt oldal, e-mail
piszkozat, dokumentum, design-vászon —, egy ellenőrzés összeveti az eredményt az
arculattal, és a konkrét eltéréseket egyszer visszaadja az ügynöknek. „A címsor
#ff0000-t használ; az arculat elsődleges színe #1f4ed8" — ilyen megjegyzést ad,
nem azt, hogy „legyen szebb".

Csak akkor fut, ha a teljességi ellenőrzés már átment. Aki nem fejezte be a
munkáját, annak nem a színeiről beszélünk.

Tudatosan puha. Sosem buktat el olyan futást, amit nem lehetett ellenőrizni —
nincs modell, nincs arculat, nincs arculat-jellegű kimenet —, mert a munka már
kész, és egy szín nem ér annyit, hogy visszavonjuk. Az arculat **keményen** a
kereten van kikényszerítve: az e-mail-héj, az értesítés-sablonok és a branded-HTML
tool determinisztikusan az arculatból épül, és ebből egy ügynök sem tudja
kibeszélni magát.

A teljességi ellenőrzéssel közösen egyetlen visszaadást használ futás-vonalanként,
tehát a kettő együtt sem tudja oda-vissza pattogtatni a futást. Kikapcsolás:
`agent.brandCriticEnabled: false`.
