# F3 — Branded Output Surfaces Implementation Plan

**Goal:** Make the surfaces that leave EYAS — email, notifications, produced HTML — carry the project's brand, with the chrome owned by a deterministic renderer rather than trusted to the model.

**Architecture:** One renderer (`brand-html.ts`) owns every byte of the wrapper. It accepts **Markdown, never raw HTML**, and renders it with the existing escape-by-construction `renderMarkdown`, so there is no sanitization question to get wrong. Email gets inline styles and a data-URI logo because linked assets do not load in mail clients. The `render_branded_html` tool and the notification templates both go through it.

**Spec:** `docs/superpowers/specs/2026-08-26-design-and-brand-system-design.md` §5.5, §6 F3
**Predecessors:** F0, F1, F2 — all complete.

## Global Constraints

As F1/F2, plus:
- **The renderer accepts Markdown or plain text, never HTML.** That is the security property: nothing untrusted is ever passed through into the output.
- Email HTML uses **inline styles only** — mail clients strip `<style>` blocks unreliably — and a `data:` URI logo, because an EYAS-hosted URL cannot load in a mail client without the F0 public route and often not even then.
- Every branded email carries a `text/plain` alternative.
- Baseline: `bun run test` → 58 failed / 9 files; `bun run lint` → 51. Neither may grow. No version bump, no commits.

## Decisions locked before coding

**Why Markdown in, not HTML in.** "Hard on the shell, soft on the content" was the F1 policy. Taken to its end, the shell should own 100% of the markup it emits. Accepting HTML would need a sanitizer (jsdom + DOMPurify is possible — jsdom is already a production dependency — but it is a large surface to get right for a payoff nobody asked for). Accepting Markdown removes the question entirely and gives the model a contract it handles better anyway.

**Notifications are instance-scoped.** `notifications` rows carry no `projectId`, so a notification cannot resolve a per-project brand. It uses the instance default brand when one is configured, and the current hardcoded palette otherwise. That is a real limitation, not an oversight — say so in the docs.

**The email-draft gate.** `email_send_draft` is the one place an artifact exists server-side, persisted, before it leaves. That is where the branded body is composed — not at draft time — so a brand edited between drafting and sending still applies.

## Task list

| # | Task | Files | Acceptance |
|---|---|---|---|
| 1 | **The renderer** | `brand/brand-html.ts` | Markdown in, branded HTML + plain-text alternative out; every colour and font from the brand; inline styles only; a logo appears as a data URI or not at all; script/`javascript:` in the input cannot survive |
| 2 | **`render_branded_html` tool** | `brand/brand-tools.ts` | `category:'custom'`; resolves the brand from the tool context; returns page or email flavour; refuses HTML input with a message that says to send Markdown |
| 3 | **Notification templates** | `notifications/templates.ts` | Brand tokens replace the hardcoded hex map; the digest and single templates both use the renderer; no behaviour change when no brand resolves |
| 4 | **Notification email channel** | `notifications/channels/email.ts` | Routes through the template engine instead of its own inline unescaped HTML; the escaping bug goes with it; text alternative always set |
| 5 | **Channel replies carry HTML** | `communication/index.ts`, `channel-run-agent.ts` | `ChannelContent.html` populated for email-type channels from the branded renderer; plain text unchanged for Telegram and friends |
| 6 | **Email drafts** | `tools/builtin/email-tools.ts` | `body_html` column; composed at SEND time from the current brand; `text` alternative kept; dry-run path unchanged |
| 7 | **Wiki class hooks** | `client-wiki/markdown-render.ts` | Block elements carry a stable class prefix so a brand stylesheet can reach them; existing escaping untouched |
| 8 | **Docs** | architecture, CHANGELOG, hand-edited doc pages | No `full-docs` run |

## Exit criteria

1. Test and lint at baseline.
2. A branded email renders with the brand's palette inline, a data-URI logo when one exists, and a text alternative.
3. `<script>` and `javascript:` in renderer input cannot appear in the output — asserted by a test.
4. A notification with no brand configured renders exactly as it does today.
5. Six locales for any new user-facing string. No version change.
