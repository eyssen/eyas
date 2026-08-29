---
title: Hyperframes
description: Compositions HTML vers MP4 déterministe via Studio.
---

**À quoi ça sert.** Hyperframes transforme HTML, CSS et animation seekable en MP4. EYAS enveloppe la CLI Apache 2.0 — pas de monorepo vendorié, pas le Chromium Playwright.

Prérequis : Node.js 22+, FFmpeg, CLI ou npx `hyperframes@0.8.17`, `chrome-headless-shell`. Un manque s’affiche sur `/studio` avec le remède.

Outils : `hyperframes_status`, `hyperframes_create`, `hyperframes_write`, `hyperframes_lint`, `hyperframes_render`, `hyperframes_list`.

GSAP : `{ paused: true }` et `window.__timelines`. Jamais `--no-sandbox`. Jamais `EYAS_CHROMIUM_PATH`.

- [Studio](/docs/fr/studio/)
- [Media](/docs/fr/ai/media/)
