---
title: Studio
description: Lokale Engines, die geschriebenes HTML zu Video machen. Nicht Media.
---

**Wozu.** Studio betreibt **lokale Production-Engines** — der Agent schreibt HTML, diese Maschine rendert eine Datei. Erste Engine: Hyperframes. [Media](/docs/de/ai/media/) ist die andere Spur: Prompt→Pixel. Nicht mischen.

**Route:** `/studio`. Sidebar: **Inhalt → Studio**.

## Wann

- Motion Graphic / Titel / Explainer als HTML, deterministisches MP4.
- Kein generatives Video aus einem Prompt — das ist Media.

## Ablauf

1. **Studio** öffnen (`/studio`).
2. Hyperframes-Karte: Node.js 22+, FFmpeg, CLI.
3. Im Chat: `hyperframes_status` → create → write → lint → render.
4. MP4 landet in Dokumenten und an diesem Turn.

Siehe [Hyperframes](/docs/de/studio/hyperframes/) und [Video Use](/docs/de/studio/videouse/).

## Verwandt

- [Hyperframes](/docs/de/studio/hyperframes/)
- [Video Use](/docs/de/studio/videouse/)
- [Media](/docs/de/ai/media/)
- [Erweiterungen](/docs/de/admin/extensions/#recordly) — Recordly (AGPL-Screenrecorder) ist ein Drittanbieter-Begleiter, keine Studio-Engine
