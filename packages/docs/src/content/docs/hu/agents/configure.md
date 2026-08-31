---
title: Létrehozás és beállítás
description: Agent neve, modellje, eszközei, büdzséje és csatornakötései.
---

**Mire való.** A **Configuration** fül az agent SQL-szintű identitása: név, szerep, modell, effort, eszközök, megkötések, havi tokenbüdzsé. A workspace-fájlok és a hangprofil külön fülek. Ezt töltöd ki, amikor valakit létrehozol, és ezt változtatod, ha a feladata eltolódik.

## Mikor használd

- Agentet hozol létre, és név, típus, modell és eszközlista kell.
- Kódoló agentnek `read_file` / `edit_file` / `grep` kell CLI nélkül.
- Havi tokensapka kell, vagy törölni akarod (`0` = korlátlan).
- Bejövő Telegram (vagy más csatorna) erre az agentre fusson.
- A prompt coach-csal akarod szorosabbra venni a rendszerpromptot — nem a hangot, nem a projekt domainjét.

## Tipikus munkafolyamat

1. Nyisd az **Agentek** listát → kattints az agentre (vagy **Agent létrehozása**) — útvonal `/agents/:id`, **Configuration** fül.
2. Töltsd ki: **Name**, **Role**, **Tier**, **Agent Type**, **Model** (vagy **Auto (routing decides)**), **Tools**, **Constraints**.
3. Állíts **Monthly Token Budget**et, ha kell sapka. A **Channels** fülön köss csatornát, ha a bejövő ide fusson.
4. **Save Changes**. Az erre az agentre kiosztott új beszélgetésnek ezt a modellt, eszközlistát és promptot kell használnia.

## Funkciók

## Besorolás

| Mező | Jelentés |
|------|----------|
| **Tier** | Primary / Team / Specialist |
| **Agent Type** | Assistant, Engineer, Developer, … |

## Persona

| Mező | Jelentés |
|------|----------|
| **Name / Role / Description / Persona** | Azonosító szövegek |
| **Goal** | Mi hajtja a döntéseket |
| **Backstory** | Megközelítést formáló kontextus |
| **Avatar** | Emoji/kép |
| **System Prompt** | Ágens-szintű utasítások |
| **Prompt coach** | AI coach a system prompt (operációs protokoll) megírásához — [Prompt rendszer](/docs/hu/ai/prompts/) |

## Modell és effort

| Mező | Jelentés |
|------|----------|
| **Model** | Konkrét modell vagy **Auto (routing)** |
| **Effort** | Auto / Low / Medium / High / Max |
| **Max Turns** | Max forduló / run |

## Toolok és korlátok

| Mező | Jelentés |
|------|----------|
| **Tools** | Vesszővel elválasztott tool nevek |
| **Capabilities** | Capability tagek |
| **Constraints** | Soronkénti kemény szabályok |
| **Monthly Token Budget** | Havi plafon; **0 = korlátlan** |

Coding / implement feladatokhoz (bármely model): add meg a
`read_file, write_file, edit_file, grep, glob, git_status, git_diff, run_command`
toolokat. A 0.8.6 előtti agentek **nem** kapják automatikusan — itt kell bővíteni.
Katalógus: [Toolok](/docs/hu/automation/tools/).

**Save Changes** menti a konfigurációt.

## Memories / Channels tab

Memóriák listája (tier, salience, accessed).  
Channels: példány **Bind / Unbind**, státuszok Connected/Error/… — lásd [Csatornák](/docs/hu/communication/channels/).

## Kapcsolódó

- [Identitás és workspace](/docs/hu/agents/identity-workspace/)
- [Hangprofilok](/docs/hu/agents/voice/)
