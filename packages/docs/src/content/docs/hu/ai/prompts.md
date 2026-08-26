---
title: Prompt rendszer
description: Réteges prompok, Prompt Enhancer és scoped Prompt Coach.
---

**Útvonalak:** Beállítások → Prompts · beszélgetés **Prompt Enhancer** · **Prompt coach** Projektek / Ágensek.

## Rétegek

| Réteg | Scope |
|-------|-------|
| **Master** | Globális identity & core rules (részben zárolt) |
| **Project type** | Munkatípus defaultok |
| **Project** | Egy projekt felülírásai |
| **Conversation** | Szál-specifikus / egyszeri user prompt |
| **Agent System Prompt** | Ágens operációs protokoll |

Öröklés: az alsó réteg finomítja a felsőt.

---

## Prompt Enhancer (beszélgetés draft)

A composerből nyílik. **Egyszeri** user promptot optimalizál a szál **modellcsaládjához**, task-type chip-ekkel, quality score-ral, concise/thorough alternatívákkal.

Részletek: [Beszélgetések — Prompt Enhancer](/docs/hu/daily/conversations/).

---

## Prompt Coach (tartós rétegek)

| Scope | Hol | Mit optimalizál |
|-------|-----|-----------------|
| **Project type** | Projects → Types → Prompt | Újrahasználható típus-defaultok |
| **Project** | Projects → Project → Prompt | Projekt operating brief (domain, konvenciók, siker kritériumok) |
| **Agent system** | Agents → Configuration → System Prompt | Ágens operációs protokoll (nem hang, nem projekt domain) |

| Vezérlő | Jelentés |
|---------|----------|
| Scope badge | Project / Project-type / Agent systemPrompt |
| Draft / Send | Iteratív finomítás |
| **Quality N/10** | Checklist; **Gaps** = hiányok |
| **Propose two alternatives** | Concise + thorough |
| **Apply** | Beírás az űrlapmezőbe |

## Kapcsolódó

- [Projektek](/docs/hu/daily/projects/)
- [Ágens konfiguráció](/docs/hu/agents/configure/)
- [Beszélgetések](/docs/hu/daily/conversations/)
