---
title: Hyperframes
description: Write HTML compositions and render deterministic MP4s through Studio.
---

**What this is for.** Hyperframes turns HTML, CSS, media, and seekable animation into an MP4. EYAS wraps the open-source CLI (Apache 2.0). It does not vendor the Hyperframes monorepo and it does not use the EYAS Playwright Chromium binary.

## Requirements

- Node.js 22 or newer (the CLI is not Bun-first)
- FFmpeg on PATH
- `hyperframes` on PATH, `EYAS_HYPERFRAMES_BIN`, or npx (`hyperframes@0.8.17`)
- `chrome-headless-shell` (Hyperframes downloads it; system Chrome is the wrong binary)

If something is missing, `/studio` and `hyperframes_status` say so with a remedy. Nothing crashes.

## Agent tools

| Tool | Job |
|------|-----|
| `hyperframes_status` | Doctor |
| `hyperframes_create` | Scaffold `index.html` |
| `hyperframes_write` | Replace files inside the project (no `../`) |
| `hyperframes_lint` | Structural check, plus CLI lint when installed |
| `hyperframes_render` | MP4; ingest to Documents |
| `hyperframes_list` | Projects and jobs |

## Composition rules

Stage needs `data-composition-id`, `data-start`, `data-duration`, size. Visible clips need `class="clip"`. GSAP timelines must be `{ paused: true }` and registered on `window.__timelines`.

Never pass `--no-sandbox`. Never point Hyperframes at `EYAS_CHROMIUM_PATH`.

## Related

- [Studio](/docs/en/studio/)
- [Media](/docs/en/ai/media/)
