---
title: Forge
description: Ember által jóváhagyott javaslatok az agent souljához, skilljeihez vagy eszközeihez.
---

**Mire való.** A Forge az ember-a-ciklusban út arra, hogyan dolgozzanak az agentek. A rendszer **javasol** (soul, skill vagy tool); te **Jóváhagyás és alkalmazás** vagy **Elutasítás**. Az identitás nem írja felül magát, hacsak az autonómia kifejezetten nem engedi az önmódosítást — az alapértelmezett biztonságos út egy javaslat ezen az oldalon.

## Mikor használd

- Az agent IDENTITY / soul-t akar változtatni, és nem szerkesztheti a fájlt maga.
- Skill- vagy eszköz-visszajelzés gyűlt, és **Elemzés most** kell javaslatokká alakítani.
- Látni akarod a jelenlegi vs javasolt értéket, az indoklást és a magabiztosságot alkalmazás előtt.
- A gyűjtött visszajelzések naplója kell (useful / friction), alkalmazás nélkül.

## Tipikus munkafolyamat

1. Nyisd a **Forge**-ot az oldalsávon (**AI** szakasz) — útvonal `/forge`.
2. Maradj a **Javaslatok** fülön (vagy válts **Visszajelzések**re). Szűrj **Mind / Függőben / Tesztelés / Jóváhagyva / Elutasítva / Alkalmazva**.
3. Nyiss ki egy kártyát — különösen a **Soul proposals** alatt. Olvasd a jelenlegi vs javasolt szöveget, majd **Jóváhagyás és alkalmazás** vagy **Elutasítás**.
4. A státusznak **Alkalmazva** (vagy **Elutasítva**) kell lennie. Nyisd az agent **Workspace** fülét: az IDENTITY-nek egyeznie kell az alkalmazott szöveggel.

## Funkciók

Alcím: *Visszajelzésekre épülő fejlesztési javaslatok eszközökhöz és készségekhez.* **Elemzés most** a visszajelzésből javaslatot készít. Fülek: **Javaslatok** és **Visszajelzések**. Célok: **Soul · Skill · Tool**. Soul-kártya: **Current value / Proposed value / Reasoning**, **Approve & apply / Reject**.

A Forge az **ember a loopban** út. Ha az autonómia tiltja a közvetlen IDENTITY önmódosítást, az agent Forge-javaslatot tesz fájl átírás helyett.

## Kapcsolódó

- [Identitás és workspace](/docs/hu/agents/identity-workspace/)
- [Autonómia](/docs/hu/agents/autonomy/)
