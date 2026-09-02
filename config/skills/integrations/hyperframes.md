---
name: hyperframes
description: Author HTML video compositions and render deterministic MP4s through EYAS Studio (Hyperframes). Not Media generation.
type: integration
trigger_patterns:
  - "hyperframes"
  - "product video"
  - "motion graphic"
  - "HTML video"
  - "render mp4"
  - "kinetic type"
  - "chart race"
  - "explainer video"
capabilities:
  - html-video
  - composition
version: "1.0.0"
---
# Hyperframes (Studio)

Use Studio, not Media. `media_generate` is hosted prompt→pixels. Hyperframes is authored HTML → deterministic MP4 on this machine.

## Loop

1. `hyperframes_status` — if a check is `missing`, tell the user the remedy. Do not invent a render.
2. `hyperframes_create` with a title.
3. `hyperframes_write` `index.html` with a valid composition.
4. `hyperframes_lint` — fix errors before render.
5. `hyperframes_render` — blocks until MP4. Rely on returned `documentIds`, not a vendor URL.

## Composition contract

- Stage: `data-composition-id`, `data-start`, `data-duration`, `data-width`, `data-height`.
- Visible clips: `class="clip"` plus `data-start` / `data-duration` / `data-track-index`.
- GSAP timelines **must** be `{ paused: true }` and registered on `window.__timelines[<composition-id>]`.
- Keep it seekable. No `setTimeout`, no wall-clock `requestAnimationFrame` loops.

## Do not

- Call `media_generate` for this.
- Pass `--no-sandbox`.
- Write files outside the project (`../` is rejected).
- Dump twenty Hyperframes upstream skills into the prompt — this skill is the map.
- Use Hyperframes for screen-capture polish (zooms on a live recording, cursor overlay). That is Recordly, an AGPL companion under Extensions — export MP4 there, then attach.
