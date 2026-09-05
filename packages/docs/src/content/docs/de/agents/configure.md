---
title: Erstellen & konfigurieren
description: Name, Modell, Tools, Budget und Kanalbindungen eines Agenten setzen.
---

**Wozu das da ist.** Der Tab **Configuration** ist die SQL-Identität: Name, Rolle, Modell, Effort, Tools, Constraints, monatliches Token-Budget. Workspace-Dateien und Stimme sind andere Tabs. Das füllst du beim Anlegen, und das änderst du, wenn der Job sich verschiebt.

## Wann du es brauchst

- Ein Agent entsteht: Name, Typ, Modell, Tool-Liste.
- Ein Coding-Agent soll `read_file` / `edit_file` / `grep` ohne CLI bekommen.
- Ein monatliches Token-Limit, oder `0` = unbegrenzt.
- Eingehendes Telegram (oder ein anderer Kanal) soll hier landen.
- Der Prompt-Coach soll den System-Prompt straffen — nicht Stimme, nicht Projektdomain.

## Typischer Ablauf

1. Öffne **Agenten** → klicke den Agenten (oder **Agent erstellen**) — Route `/agents/:id`, Tab **Configuration**.
2. Fülle **Name**, **Role**, **Tier**, **Agent Type**, **Model** (oder **Auto (routing decides)**), **Tools**, **Constraints**.
3. Setze **Monthly Token Budget**, falls ein Deckel soll. Binde auf **Channels** einen Kanal, wenn Inbound hier landen soll.
4. **Save Changes**. Ein neues Gespräch mit diesem Agenten sollte Modell, Tools und Prompt übernehmen.

## Funktionen

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
