---
title: Létrehozás és beállítás
description: Ágens részletek Configuration tab — minden mező.
---

**Útvonal:** `/agents/:id` → **Configuration**.

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
