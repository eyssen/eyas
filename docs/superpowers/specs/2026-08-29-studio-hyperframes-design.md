# Studio + Hyperframes — Design

**Date:** 2026-08-29
**Status:** Approved in chat (`Ok, csináld a Studio-t.`)
**Modules:** new `studio` core (`required: false`); first engine submodule `studio.hyperframes`
**Not Media.** Media stays SaaS prompt→pixel. Studio is local, agent-authored runtimes.

---

## 1. Problem

EYAS can generate clips through Magnific/Higgsfield/fal. It cannot author a
deterministic HTML composition and render it to MP4. Hyperframes (Apache 2.0)
does that locally: HTML + seekable animation → Chrome headless-shell + FFmpeg.

More engines of this kind will follow. They must not land under Media.

## 2. Scope (v1)

In scope:

1. `studio` parent: engine registry, doctor, project + job store, local-file ingest, conversation attach.
2. `studio.hyperframes` engine: scaffold, write, lint, render via CLI wrapper (not vendored monorepo).
3. Six agent tools: `hyperframes_status`, `hyperframes_create`, `hyperframes_write`, `hyperframes_lint`, `hyperframes_render`, `hyperframes_list`.
4. UI `/studio` in Content (after Design). Engine cards + projects + jobs.
5. Bundled skill `config/skills/integrations/hyperframes.md`.
6. Docs chapter `studio/` in six locales. Six-language UI i18n.

Out of scope:

- Hyperframes Studio SPA, AWS Lambda, HeyGen cloud render, 20 upstream skills.
- Website-to-video / TTS pipelines.
- Unified `studio_generate` (engines do not share media's generate/wait/catalog).
- Moving Design into Studio.
- browser-use (separate category, after this).

## 3. Runtime

- CLI: `EYAS_HYPERFRAMES_BIN` → `hyperframes` on PATH → otherwise render may `npx --yes hyperframes@<pin>` (pin `0.8.17`). Status does not hit the network.
- Browser: Hyperframes' `chrome-headless-shell`, never EYAS Playwright Chromium, never silent `--no-sandbox`.
- Node.js 22+, FFmpeg on PATH. Missing dep = fail-closed with a remedy.
- Writes confined to `data/hyperframes/<projectId>/`.

## 4. Agent vs Media

| | Media | Studio / Hyperframes |
|---|---|---|
| Job | Hosted generate | Author HTML, render MP4 |
| Tools | `media_*` | `hyperframes_*` |
| UI | Settings → Media | Content → Studio (`/studio`) |
