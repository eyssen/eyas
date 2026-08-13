---
title: Erstellen & konfigurieren
description: Configuration-Tab — alle Felder.
---

**Route:** `/agents/:id` → **Configuration**.

## Classification

**Tier** · **Agent Type**.

## Persona

| Feld | Bedeutung |
|------|-----------|
| Name, Role, Description, Persona | Identitätstexte |
| **Goal** | Entscheidungsmotiv |
| **Backstory** | Kontext/Perspektive |
| **Avatar** | Emoji/Bild |
| **System Prompt** | Agenten-Instruktionen |
| **Prompt coach** | KI-Coach für den System-Prompt (Betriebsprotokoll) — [Prompt-System](/docs/de/ai/prompts/) |

## Modell & Effort

| Feld | Bedeutung |
|------|-----------|
| **Model** / Auto | Modell-ID oder Routing |
| **Effort** | Auto / Low / Medium / High / Max |
| **Max Turns** | Max. Schleifendurchläufe |

## Tools & Limits

**Tools** (kommagetrennt) · **Capabilities** · **Constraints** (eine pro Zeile) · **Monthly Token Budget** (`0` = unbegrenzt).

Für Coding: `read_file, write_file, edit_file, grep, glob, git_status, git_diff, run_command` freigeben (modellunabhängig). Bestehende Agenten vor 0.8.6 erben das **nicht** automatisch. Katalog: [Tools](/docs/de/automation/tools/).

**Save Changes** speichert.

## Memories / Channels

Memories: Tier, Salience, accessed. Channels: Bind/Unbind, Status Connected/Error/… — siehe [Kanäle](/docs/de/communication/channels/).
