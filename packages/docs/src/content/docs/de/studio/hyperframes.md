---
title: Hyperframes
description: HTML-Kompositionen als deterministisches MP4 über Studio.
---

**Wozu.** Hyperframes macht aus HTML, CSS und seekbarer Animation ein MP4. EYAS wrapped die Apache-2.0-CLI — kein vendortes Monorepo, kein Playwright-Chromium.

Voraussetzungen: Node.js 22+, FFmpeg, CLI oder npx `hyperframes@0.8.17`, `chrome-headless-shell`. Fehlendes zeigt `/studio` mit Remedy.

Tools: `hyperframes_status`, `hyperframes_create`, `hyperframes_write`, `hyperframes_lint`, `hyperframes_render`, `hyperframes_list`.

GSAP: `{ paused: true }` und `window.__timelines`. Nie `--no-sandbox`. Nie `EYAS_CHROMIUM_PATH`.

- [Studio](/docs/de/studio/)
- [Media](/docs/de/ai/media/)
