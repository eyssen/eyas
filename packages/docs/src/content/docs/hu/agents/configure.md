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

**Save Changes** menti a konfigurációt.

## Memories / Channels tab

Memóriák listája (tier, salience, accessed).  
Channels: példány **Bind / Unbind**, státuszok Connected/Error/… — lásd [Csatornák](/docs/hu/communication/channels/).

## Kapcsolódó

- [Identitás és workspace](/docs/hu/agents/identity-workspace/)
- [Hangprofilok](/docs/hu/agents/voice/)
