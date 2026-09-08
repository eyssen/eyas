---
title: Studio
description: Local engines that turn authored HTML or footage into video. Not Media.
---

**What this is for.** Studio is where EYAS runs **local production engines** — tools that take something the agent wrote (HTML, an EDL) and render a file on this machine. Engines: Hyperframes (HTML→MP4) and Video Use (footage→MP4). [Media](/docs/en/ai/media/) is the other lane: hosted prompt→pixels (Magnific, Higgsfield, fal). Do not mix them.

**Route:** `/studio`. Sidebar: **Content → Studio**.

## When to use it

- You want an agent to write a motion graphic, title card, or explainer as HTML and render a deterministic MP4.
- You do **not** want a generative video from a prompt — that is Media.
- You will add more local engines later; they belong here, not under Media.

## Typical workflow

1. Open **Studio** (`/studio`).
2. Read the **Hyperframes** card. Node.js 22+, FFmpeg, and the Hyperframes CLI must be OK (warnings are fine if npx can fill in).
3. Ask in a conversation. The agent should call `hyperframes_status`, then `hyperframes_create`, `hyperframes_write`, `hyperframes_lint`, `hyperframes_render`.
4. The MP4 lands in [Documents](/docs/en/knowledge/documents/) and on that chat turn.

## Engines

Each card is one engine. Ready means every blocking check passed. Missing pieces show a remedy — install those, do not expect a silent fallback. Chromium sandbox is never turned off automatically.

See [Hyperframes](/docs/en/studio/hyperframes/) and [Video Use](/docs/en/studio/videouse/) for contracts and tools.

## Related

- [Hyperframes](/docs/en/studio/hyperframes/)
- [Video Use](/docs/en/studio/videouse/)
- [Media](/docs/en/ai/media/)
- [Design canvases](/docs/en/knowledge/design/)
- [Extensions](/docs/en/admin/extensions/#recordly) — Recordly (AGPL screen recorder) is a third-party companion, not a Studio engine
