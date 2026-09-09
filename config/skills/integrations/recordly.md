---
name: recordly
description: Polished screen-capture demos via the Recordly desktop app (AGPL companion). Not bundled, not a Studio engine, not Media.
type: integration
trigger_patterns:
  - "recordly"
  - "screen studio"
  - "polished demo"
  - "screen recording zoom"
  - "cursor overlay"
  - "walkthrough video"
  - "product walkthrough"
capabilities:
  - screen-recording
  - demo-video
version: "1.0.0"
---
# Recordly (Extensions companion)

Recordly is an **AGPL-3.0 desktop app**. EYAS does not ship, link, vendor, or auto-install it. There is **no** `recordly_*` tool and **no** CLI.

The operator installs Recordly from [Extensions](/extensions) → Third-Party (GitHub / Setup guide), or from https://github.com/webadderallorg/Recordly/releases. Then they record and export **inside Recordly**.

## Loop

1. If Recordly is not installed, point the user at **Settings → Modules → Extensions** (`/extensions`), Recordly card. Do not pretend EYAS can download it.
2. They record a display or window in Recordly, edit zooms / cursor / webcam / frame there, export **MP4** or **GIF**.
3. Attach the export to the conversation or add it to Documents.
4. Further cuts on this machine: Studio Video Use (`videouse_*`) on that file. HTML motion graphics: Hyperframes. Prompt→pixels: `media_*`.

## Do not

- Copy, vendor, or wrap Recordly source. That would AGPL EYAS.
- Invent `recordly_record` / `recordly_export` tools.
- Call `media_generate` or `hyperframes_*` for screen-capture polish.
- Use "Recordly" as an EYAS product name. Nominative reference to the upstream app is fine.
- Auto-install the pack. `POST /extensions/recordly/install` is refused on purpose.
