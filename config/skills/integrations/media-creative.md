---
name: media-creative
description: Generate and upscale images, video, and audio through EYAS media providers (Magnific, Higgsfield, fal)
type: integration
trigger_patterns:
  - "generate an image"
  - "upscale"
  - "image to video"
  - "text to image"
  - "magnific"
  - "higgsfield"
  - "fal.ai"
capabilities:
  - media-generation
version: "1.0.0"
---
# Media generation

Use `media_catalog` before inventing model ids. Use `media_generate` then `media_wait`. Do not call raw vendor MCP tools unless the owner enabled expert mode.

Upscale: Magnific `precision` for logos, UI, and text; `creative` for art. Send original bytes or documentId for references — never JPEG recompress. Credits cost money; do not set `providers` unless the user asked for more than one backend. Vendor URLs expire; rely on returned `documentIds`.

Screen-capture polish (zooms, cursor overlay, demo walkthrough from a live recording) is not Media. That is Recordly, an AGPL companion under Extensions — the user exports MP4 there, then attaches it.
