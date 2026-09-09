---
title: Hyperframes
description: HTML-kompozíciók determinisztikus MP4-re a Stúdión keresztül.
---

**Mire való.** A Hyperframes HTML-ből, CSS-ből és seekelhető animációból MP4-et csinál. Az EYAS a nyílt CLI-t (Apache 2.0) burkolja. Nem vendoreli a monorepót, és nem az EYAS Playwright Chromiumját használja.

## Feltételek

- Node.js 22+
- FFmpeg a PATH-on
- `hyperframes` a PATH-on, `EYAS_HYPERFRAMES_BIN`, vagy npx (`hyperframes@0.8.17`)
- `chrome-headless-shell` (a Hyperframes tölti; a system Chrome rossz bináris)

Ha hiányzik, a `/studio` és a `hyperframes_status` orvosságot ad. Nincs crash.

## Ügynök-toolok

| Tool | Feladat |
|------|---------|
| `hyperframes_status` | Doctor |
| `hyperframes_create` | `index.html` scaffold |
| `hyperframes_write` | Fájl a projektben (nincs `../`) |
| `hyperframes_lint` | Szerkezeti check, plusz CLI lint |
| `hyperframes_render` | MP4; Documents |
| `hyperframes_list` | Projektek és jobok |

GSAP timeline: `{ paused: true }` és `window.__timelines`. Soha `--no-sandbox`. Soha `EYAS_CHROMIUM_PATH`.

## Kapcsolódó

- [Stúdió](/docs/hu/studio/)
- [Média](/docs/hu/ai/media/)
