---
title: Hyperframes
description: Composiciones HTML a MP4 determinista a través de Estudio.
---

**Para qué.** Hyperframes convierte HTML, CSS y animación seekable en MP4. EYAS envuelve la CLI Apache 2.0: no vende el monorepo ni usa el Chromium de Playwright.

Requisitos: Node.js 22+, FFmpeg, CLI o npx `hyperframes@0.8.17`, `chrome-headless-shell`. Si falta, `/studio` da el remedio.

Herramientas: `hyperframes_status`, `hyperframes_create`, `hyperframes_write`, `hyperframes_lint`, `hyperframes_render`, `hyperframes_list`.

GSAP: `{ paused: true }` y `window.__timelines`. Nunca `--no-sandbox`. Nunca `EYAS_CHROMIUM_PATH`.

- [Estudio](/docs/es/studio/)
- [Media](/docs/es/ai/media/)
