---
name: media-creative
description: Generate and upscale images, video, and audio through EYAS media providers (Magnific, Higgsfield, fal, HeyGen)
type: integration
trigger_patterns:
  - "generate an image"
  - "upscale"
  - "image to video"
  - "text to image"
  - "talking head"
  - "avatar video"
  - "presenter video"
  - "magnific"
  - "higgsfield"
  - "fal.ai"
  - "heygen"
capabilities:
  - media-generation
version: "1.0.0"
---
# Media generation

Use `media_catalog` before inventing model ids. Use `media_generate` then `media_wait`. Do not call raw vendor MCP tools unless the owner enabled expert mode.

Talking-head / presenter / digital-twin video: pin `provider: heygen`. Prompt-only → Video Agent. Script + avatar look from catalog → pass `options.avatar_id` (or `model`) and optional `options.voice_id`. Speech-only: `kind: audio`. HeyGen MCP spends the **web plan** credits, not a REST API key.

Cinematic clip / character lock: Higgsfield. Stills and upscale: Magnific. Broad catalog or price check: fal.

HTML composition → MP4 is Studio (`hyperframes_*`), not Media. Raw footage → cut is Video Use.

Upscale: Magnific `precision` for logos, UI, and text; `creative` for art. Send original bytes or documentId for references — never JPEG recompress. Credits cost money; do not set `providers` unless the user asked for more than one backend. Vendor URLs expire; rely on returned `documentIds`.

Screen-capture polish (zooms, cursor overlay, demo walkthrough from a live recording) is not Media. That is Recordly, an AGPL companion under Extensions — the user exports MP4 there, then attaches it.
