# Browser DOM index + Browser Use sidecar + Video Use — Design

**Date:** 2026-08-29
**Status:** Approved in chat (`Mehet és a video-use is`)
**Modules:** existing `browser_*` tools; extra module `browser-use`; Studio engine submodule `studio.videouse`

Prior decision (Studio session): browser-use is **not** Studio and **not** Media. Separate category. Video-use **is** a Studio engine (local files → file).

---

## 1. Numbered DOM on existing `browser_*`

EYAS already has Playwright: navigate / click(css) / fill / screenshot / content / a11y snapshot. Agents guess CSS. browser-use's value is numbered interactive elements.

v1 (TypeScript, no Python):

- Snapshot stamps `data-eyas-index` on visible interactive nodes and returns `{ index, tag, role, name }[]`.
- `browser_click` / `browser_fill` accept `selector` **or** `index` (exactly one).
- Indices die on navigation — snapshot again.
- Same Playwright Chromium, same SSRF, same 5-minute session.

Out of scope: Python agent loop, Cloud API, CSS-selector learning.

## 2. Extra module `browser-use` (CLI sidecar)

Hyperframes pattern: wrap the MIT CLI, do not vendor the Python library, do not import OpenAI/Anthropic SDKs, never route LLM through ChatBrowserUse.

- Doctor: Python 3.11+, `browser-use` on PATH or `uvx`, Chrome/CDP.
- Tools: `browser_use_status`, `browser_use_exec` (Python piped on stdin — CLI 3.0). Red, approval required.
- Env always: telemetry off (`ANONYMIZED_TELEMETRY=false`, `DO_NOT_TRACK=1`). No `BROWSER_USE_API_KEY` unless settings allow cloud.
- LLM stays the EYAS model module. The CLI only drives a real Chrome via CDP.
- Fail-closed remedies. No `--no-sandbox`. Not Studio, not Media.
- UI `/browser-use` under AI (after Research).

Out of scope: workflow-use (AGPL), browsercode, bux, web-ui, macos-harness, Cloud SDK as core.

## 3. Studio engine `videouse`

video-use (MIT) is a skill + ffmpeg helpers, not a CLI. EYAS reimplements the **hard rules** in TypeScript on the existing Studio FFmpeg doctor. No librosa/matplotlib/Manim in the Bun process.

- Project layout: `sources/` + `edit/` (`project.md`, `takes_packed.md`, `edl.json`, `transcripts/`).
- Tools: `videouse_status`, `videouse_create`, `videouse_ingest`, `videouse_inventory`, `videouse_transcribe`, `videouse_pack`, `videouse_write`, `videouse_lint`, `videouse_render`, `videouse_list`.
- Transcribe: ElevenLabs Scribe `POST /v1/speech-to-text` (`scribe_v1`, word timestamps). Secret `videouse-elevenlabs-api-key` or `ELEVENLABS_API_KEY`. Missing key = warn, not crash; inventory/render still work.
- Render: per-segment extract + 30ms afade → lossless concat → overlays with PTS shift → subtitles LAST. Grade presets `none` / `warm_cinematic` / `neutral_punch`.
- Strategy confirmation stays in the skill (ask → confirm → execute). Tools do not auto-cut.
- Hyperframes remains the overlay author for animation slots (`hyperframes_*` inside `edit/animations/`).

Out of scope v1: Remotion/Manim slots, loudnorm two-pass, HDR tonemap, timeline_view PNG, vendoring upstream Python helpers.

## 4. Runtime

| | Browser tools | browser-use extra | videouse |
|---|---|---|---|
| Process | Bun + Playwright | optional Python CLI | Bun + FFmpeg |
| Chromium | EYAS Playwright | user's real Chrome CDP | none (FFmpeg only) |
| LLM | EYAS model module | none in the sidecar | EYAS (agent + skill) |

## 5. Agent vs other lanes

| Job | Tools |
|---|---|
| Headless page, CSS/index | `browser_*` |
| Logged-in real Chrome | `browser_use_*` (if CLI present) |
| Desktop OS | Hands |
| HTML → MP4 | `hyperframes_*` |
| Footage → cut MP4 | `videouse_*` |
| Prompt → pixels | `media_*` |
