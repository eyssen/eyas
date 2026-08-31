---
title: Media
description: Connect Magnific, Higgsfield, or fal. Agents generate and upscale through five shared tools. Compare backends and pick one — or several.
---

**What this is for.** Media is how EYAS generates, upscales, and waits on images, video, audio, edits, and 3D. You pick the backends; the agent uses **one set of tools**. None of the three vendors is default. Zero connected providers is an empty, fail-closed state — never mock pixels.

**Route:** `/media`. Sidebar: **Media** (after Providers). Title: **Media**.

## When to use it

- You want the agent to generate or upscale an image, make a video, or wait on a long job.
- You have a Magnific, Higgsfield, or fal account and do **not** want fifty vendor tools dumped onto the model.
- Credits cost money and you need daily/monthly caps or a per-kind default.
- Completed files should land in [Documents](/docs/en/knowledge/documents/) and on the chat turn that produced them.

## Typical workflow

1. Open **Media** (`/media`).
2. Read **Which backend?** on that page, then **Connect** one (or several). Magnific and Higgsfield open a browser OAuth window; fal uses an API key.
3. Status should read **Connected**. Set **Routing** (default / fallback / also run on) per kind and optional **Budget** caps.
4. Ask in a conversation. The agent should call `media_catalog`, then `media_generate`, then `media_wait`.
5. When the job completes, EYAS copies the file into Documents and attaches it to that turn. Vendor CDN URLs expire — rely on the stored document, not the URL.

## Which backend? {#compare}

The attached marketing tables for these products talk about “target audience” and “web vs API”. For EYAS the useful questions are different: **what is it best at, how do you sign in, how do credits work, and what happens to the file.**

| Criterion | Magnific | Higgsfield | fal |
|-----------|----------|------------|-----|
| **Best at** | Photoreal stills, prompt-guided **Creative** upscale, faithful **Precision** upscale | Cinematic video, character consistency (Soul) | Huge model catalog, price check before a run |
| **Kinds in EYAS** | Upscale, image, edit (also video / audio / 3D) | Video, image (also audio) | Image, video, audio, 3D, upscale |
| **Sign-in** | OAuth (Magnific account) | OAuth (Higgsfield account) | Bearer API key (`fal-api-key`) |
| **Credits** | Same balance as the Magnific site. Web **Unlimited does not apply** to MCP/API | MCP **always** spends credits, even if the website plan is unlimited | MCP itself is free; you pay per model run |
| **Result files** | CDN URL — EYAS copies bytes locally | URLs expire in about **seven days** — ingest is required | CDN URL — still copied locally |
| **Connect first if…** | You upscale, retouch, or need stills | You need clips or a locked character | You want many models or a cost check first |

**Recommendations**

1. **Connect one backend for the job you actually have.** Stills and upscale → Magnific. Video / character lock → Higgsfield. Broad catalog or “what does this cost?” → fal.
2. **Add a second backend when the kind changes**, not “just in case”. Routing **default / fallback** covers an outage; **Also run on** sends the *same* prompt to extra vendors and **doubles credits**. Leave it empty unless you asked for a side-by-side.
3. **Do not turn on raw vendor MCP tools** unless you are debugging. That dumps Magnific/Higgsfield/fal tool lists onto the agent and skips ingest.

Images and prompts **leave this machine** for the vendor you connected. Treat that like any other SaaS.

## Five tools

| Tool | Purpose | Risk |
|------|---------|------|
| `media_generate` | Start a job (`image`, `video`, `audio`, `upscale`, `edit`, `3d`) | yellow |
| `media_wait` | Poll until the job is terminal (default 180s, max 600s) | yellow |
| `media_catalog` | List models for a kind — use this before inventing ids | green |
| `media_balance` | Credits remaining on a connected provider | green |
| `media_history` | Recent local jobs | green |

Zero configured providers, or a pin to an unconfigured one, returns a structured error pointing at `/media`.

## Settings on `/media`

**Routing.** One row per kind. **Default** is who runs the job when the agent does not name a provider. **Fallback** is used when the default is not connected. **Also run on** is an extra list — only when you want a fan-out.

Suggested defaults (applied only if that provider is connected, and you have not pinned the row): upscale / image / edit → Magnific; video → Higgsfield; audio / 3D → fal.

**Budget.** Optional daily and monthly credit caps **per provider**. A cap that would be exceeded fails **before** the vendor is called. Unknown credit amounts do not block.

**Expose raw vendor MCP tools.** Off by default. On = the agent also sees `mcp_magnific_*` / `mcp_higgsfield_*` / `mcp_fal_*`. Leave it off.

## Credits and ingest

Completed jobs with result URLs are fetched (up to 200 MB, **no JPEG recompress**) into Documents, linked to the conversation as AI, and merged onto the producing turn’s attachments. Prefer returned `documentIds` over vendor URLs.

For upscale, send the **original** file (`documentId` or URL). Do not JPEG a canvas screenshot and send that.

## Troubleshooting

| Symptom | What to try |
|---------|-------------|
| Status stays **Not connected** after OAuth | Finish sign-in in the browser, then return to `/media`. Use **Test**. |
| Agent says no provider for this kind | Connect a backend that lists that kind, or set Routing default. |
| Job completed but no image in chat | Check **Recent jobs** and [Documents](/docs/en/knowledge/documents/). The vendor URL may have expired. |
| Credits draining faster than expected | **Also run on** is on, or two providers are pinned. Check Budget. |
| Redirect lands on MCP Servers | Open `/media` and **Test** the card. Connect from Media, not only from the MCP catalog. |

## Related

- [MCP servers](/docs/en/ai/mcp/) — media-owned rows show *Managed by Settings → Media*
- [Tools](/docs/en/automation/tools/)
- [Documents](/docs/en/knowledge/documents/)
- [Connections](/docs/en/admin/connections/)
- [Providers](/docs/en/ai/providers/) — language models, not image backends
