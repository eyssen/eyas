---
name: videouse
description: Cut raw footage into a finished MP4 through EYAS Studio (Video Use). Transcript-first. Not Media generation, not Hyperframes HTML compositions.
type: integration
trigger_patterns:
  - "video-use"
  - "videouse"
  - "edit footage"
  - "cut the video"
  - "talking head"
  - "subtitles on video"
  - "color grade clip"
capabilities:
  - video-edit
  - transcript-cut
version: "1.0.0"
---
# Video Use (Studio)

Use Studio, not Media. `media_generate` is hosted prompt→pixels. Hyperframes is authored HTML → MP4. Video Use is **raw footage → cut MP4** on this machine.

## Loop

1. `videouse_status` — missing FFmpeg is a stop. ElevenLabs warn means you can still inventory/render; you cannot transcribe.
2. `videouse_create` with a title.
3. `videouse_ingest` absolute paths into `sources/`.
4. `videouse_inventory`.
5. `videouse_transcribe` then `videouse_pack`. Read `edit/takes_packed.md`.
6. Propose a strategy in plain English. **Wait for confirmation.** Never write ranges before that.
7. `videouse_write` `edit/edl.json`. `videouse_lint`.
8. `videouse_render` — blocks. Output lands in Documents.

Animation overlays: author with `hyperframes_*` inside `edit/animations/slot_N/`, then reference the rendered file in `overlays`.

## Hard rules

- Never cut inside a word. Snap to transcript word boundaries. Pad 30–200ms.
- 30ms audio fades are applied by the renderer.
- Subtitles last. Overlays use PTS shift.
- Cache transcripts. Do not re-transcribe unchanged sources.
- All session outputs stay under the project (`edit/`). No `../`.

## Do not

- Call `media_generate` for this.
- Dump the upstream video-use SKILL.md into the prompt.
- Invent an EDL without reading `takes_packed.md`.
- Record the screen inside EYAS. Screen-capture polish is Recordly (Extensions, AGPL companion). Ingest its exported MP4 as footage, then cut here.
