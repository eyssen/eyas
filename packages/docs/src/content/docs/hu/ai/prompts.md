---
title: Prompt-rendszer
description: Rétegelt promptok — master → projekttípus → projekt → beszélgetés — plusz coachok.
---

**Mire való.** Minden forduló egymásra rakott prompt-rétegekből áll, nem egy blobból. **Master** a globális identitás (egyes szakaszok zárolva). **Projekttípus** és **Projekt** egy munkatípusra és egy projektre finomít. **Beszélgetés** szálspecifikus szöveget ad. Az agenteknek van **Rendszerpromptjuk** is. Ez a fejezet a tartós rétegek szerkesztője; a beszélgetés **Promptjavítója** csak egyszeri piszkozatra való.

**Útvonalak:** `/prompts` (menü **Promptok** — sablonok), `/prompt-settings` (master **Rendszerprompt** szakaszok). Emellett: beszélgetés **Promptjavító**, **Prompt coach** Projektek / Agentek.

## Mikor használd

- Házistílus (szerkeszthető **personality**) a zárolt platformszabályok érintése nélkül.
- Egy projekttípus hordozzon örökölhető briefet.
- Egy projekt domain-konvenciói ne szivárogjanak más projektekbe.
- A composer piszkozata gyenge — Promptjavító, nem tartós rétegcsere.

## Tipikus folyamat

1. **Promptok** (`/prompts`). Szint: **Master / Projekttípus / Projekt / Beszélgetés**.
2. Sablon. A zároltak **Csak olvasható**. Többi: tartalom, **Aktiválás / Deaktiválás**, törlés.
3. `/prompt-settings` (Promptok morzsából): master szakaszok. Csak a **personality** szerkeszthető; a többi zárolt.
4. Tartós projekt- vagy agent-brief: **Prompt coach** az űrlapon, majd **Alkalmaz**.
5. Egyszeri user prompt: **Promptjavító** a beszélgetés composeréből.

## Funkciók

| Réteg | Hatáskör |
|-------|----------|
| **Master** | Globális identitás és alapszabályok (egyes szakaszok zárolva) |
| **Projekttípus** | Egy munkatípus defaultjai |
| **Projekt** | Egy projekt felülírásai |
| **Beszélgetés** | Szálspecifikus / egyszeri |
| **Agent rendszerprompt** | Agent protokoll ([Konfiguráció](/docs/hu/agents/configure/)) |

| Fogalom | Jelentés |
|---------|----------|
| Zárolt szakasz | UI-ban nem szerkeszthető |
| Szerkeszthető szakasz | Hang/szabályok |
| Öröklés | Alsóbb réteg finomítja a felsőt |

A **Promptjavító** a composeről nyílik — egyszeri user prompt a szál **modellcsaládjára**. Teljes tábla: [Beszélgetések — Promptjavító](/docs/hu/daily/conversations/#prompt-enhancer-dialog).

A **Prompt coach** tartós szövegre való, nem keveredik a piszkozattal. Scope: projekttípus, projekt, agent rendszerprompt. **Minőség N/10**, **Két alternatíva**, **Alkalmaz**.

## Mezők és vezérlők

<h2 id="prompts-list">`/prompts` — Prompt sablonok</h2>

Alcím: *Rendszerprompt-sablonok a prompt-öröklési lánchoz.*

| Vezérlő | Jelentés |
|---------|----------|
| Szint fülek | **Master / Projekttípus / Projekt / Beszélgetés** |
| Lista | Név, aktív, zárolt |
| **Sablon megtekintése / szerkesztése** | Szerkesztő |
| **Aktiválás / Deaktiválás** | `isActive` |
| Tartalom | Törzs |

<h2 id="prompt-settings">`/prompt-settings` — Rendszerprompt</h2>

Alcím: *Ezek a szakaszok minden AI-beszélgetés alapját adják. A zárolt szakaszok nem módosíthatók.*

A zároltak csak olvashatók. A **personality** **Szerkeszthető** — mentés: `PATCH /prompts/master/personality`.

## Kapcsolódó

- [Projektek — prompt mezők](/docs/hu/daily/projects/)
- [Agentek — rendszerprompt](/docs/hu/agents/configure/)
- [Beszélgetések](/docs/hu/daily/conversations/)
- [Routing és költségkeret](/docs/hu/ai/routing-budget/)
