---
title: Stimmprofile
description: Wie ein Agent intern vs. extern spricht — sechs Dimensionen, Presets, AUTO.
---

**Wozu das da ist.** Stimme ist, *wie* der Agent spricht, nicht *was* er weiß. Jeder Agent hat zwei Profile: **Internal communication** (du und das Team) und **External communication** (Kunden, Fremde, öffentliche Kanäle). Die Runtime wählt **AUTO**, außer du überschreibst den Scope im Gespräch.

## Wann du es brauchst

- Mit dem Team anderer Ton als mit einem Kunden.
- Start von einem Preset (Jarvis, Diplomat, Coach, …), dann eine Dimension feinjustieren.
- Blockierte Phrasen (leere Entschuldigungen) oder eine **Signature**.
- Ein Gespräch soll Internal oder External erzwingen, unabhängig vom Default.

## Typischer Ablauf

1. Öffne **Agenten** → den Agenten → Tab **Voice** — Route `/agents/:id`.
2. Wähle **Internal preset** und **External preset**, oder lass **Custom** nach Feld-Edit.
3. Die sechs Dimensionen je Block, plus **Blocked phrases** und **Signature**. **Save voice profile**.
4. Im Gespräch sollte **Voice · INTERNAL / EXTERNAL / AUTO** passen; dort überschreiben, wenn dieser Thread die Ausnahme ist.

## Funktionen

**Route:** Voice-Tab.

| Profil | Wann |
|--------|------|
| **Internal** | Mit dir und dem Team |
| **External** | Kunden, Fremde, öffentliche Kanäle |

## Presets

Internal/External preset · Custom bei manueller Editierung.

Jarvis · Best buddy · Senior CEO · Buddy Dev · Standup · Diplomat · Coach · Tutor.

## Dimensionen (je 2×)

Address · Tone · Verbosity · Directness · Humor · Emoji — Werte wie in der UI (Informal/Formal, Serious…Playful, Never…Often, …).

## Extra

Blocked phrases · Signature · **Save voice profile**.

Override im Gespräch: Voice scope AUTO/INTERNAL/EXTERNAL.
