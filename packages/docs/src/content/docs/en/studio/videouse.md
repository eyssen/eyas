---
title: Video Use
description: Cut raw footage to MP4 through Studio. Transcript-first. Not Media.
---

**What this is for.** Video Use turns ingested clips plus an EDL into an MP4. EYAS reimplements the open-source video-use hard rules in TypeScript (MIT). It does not vendor librosa or Manim.

## Requirements

- FFmpeg and ffprobe on PATH
- Optional: ElevenLabs Scribe key as secret `videouse-elevenlabs-api-key` or `ELEVENLABS_API_KEY` (transcribe only)

Missing FFmpeg fail-closes. A missing key is a warning — inventory and render still work.

## Agent tools

| Tool | Job |
|------|-----|
| `videouse_status` | Doctor |
| `videouse_create` | `sources/` + `edit/` |
| `videouse_ingest` | Copy local files into `sources/` |
| `videouse_inventory` | ffprobe durations |
| `videouse_transcribe` | Scribe, cached |
| `videouse_pack` | `edit/takes_packed.md` |
| `videouse_write` | `edl.json`, `project.md`, SRT |
| `videouse_lint` | EDL schema |
| `videouse_render` | MP4; ingest to Documents |
| `videouse_list` | Projects and jobs |

Confirm a cut strategy with the user before writing ranges. Overlays can be Hyperframes renders.

## Related

- [Studio](/docs/en/studio/)
- [Hyperframes](/docs/en/studio/hyperframes/)
- [Media](/docs/en/ai/media/)
