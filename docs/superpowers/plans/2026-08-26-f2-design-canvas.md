# F2 — Design Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The "Design" menu item — a store of multi-artboard design canvases in the Claude Design format, rendered by EYAS's own MIT `.dc.html` runtime, editable by hand and by AI, versioned, importable and exportable, and referenceable from any conversation.

**Architecture:** A `design` module mirroring `brand`: a `designs` table indexing a file tree under `<dataDir>/designs/<id>/`, holding `.dc.html` artboards, `canvas.json` and images. Artboards render inside a nested `srcdoc` iframe with `sandbox="allow-scripts"` and no `allow-same-origin`, into which a self-contained runtime is injected. The runtime executes the artboard's `DCLogic` class — **decided 2026-08-26: full execution, in F2, not deferred.** A provider-independent validator gate stands between every AI edit and a stored version.

**Tech Stack:** TypeScript 5.9 strict ESM, Bun, Hono, Drizzle + SQLite, Zod, Vitest, React 19, CodeMirror 6 (MIT).

**Spec:** `docs/superpowers/specs/2026-08-26-design-and-brand-system-design.md` (§4, §5.3, §5.6, §6 F2)
**Predecessors:** F0 (`…-f0-foundation-repair.md`), F1 (`…-f1-brand-entity-and-inheritance.md`) — both complete.

## Global Constraints

Same as F1, plus:

- **The runtime executes AI-authored JavaScript.** Every rendering surface must therefore satisfy, without exception: a `srcdoc` iframe; `sandbox="allow-scripts"` and **never** `allow-same-origin`; a `<meta http-equiv="Content-Security-Policy">` inside the srcdoc with `connect-src 'none'`, `img-src 'self' data: blob:`, `frame-src 'none'`, `form-action 'none'`, and a `font-src`/`style-src` carve-out for `https://fonts.googleapis.com` + `https://fonts.gstatic.com` only. No other origin.
- Artboard source is **untrusted cross-user input**. It is never injected into the host page, never `dangerouslySetInnerHTML`'d, and never concatenated into a prompt without fencing.
- Baseline: `bun run test` → 58 failed / 9 files; `bun run lint` → 51. Neither may grow.
- **Do not run `bun run full-docs`** — it destroys hand-written documentation (see F1's finding). Hand-edit doc pages.
- No version bumps. No commits, no pushes.

---

## Decisions locked before coding

**Where the template engine runs.** Parsing a `.dc.html` file into its parts is pure and lives in the app (`dc-template.ts`, unit-testable). Expanding the template into DOM must live *inside* the iframe, because `setState` re-renders — so the renderer ships as a self-contained script string (`dc-runtime-source.ts`) that is injected into the srcdoc. Its behaviour is tested by evaluating it under jsdom, not by trusting it.

**The `store: 'db'` marker and `comments`.** Claude Design pages published against its live store carry `store: 'db'` and a `comments` array. EYAS neither writes nor round-trips those: an import strips them and says so, matching the helper's own refusal.

**Images.** Stored decoded on disk, exactly like brand assets, and encoded to bare base64 only at export time. The runtime resolves `<img src="logo.png">` by literal substitution into a `data:` URI — the same silent-failure surface the format has, so the validator checks every referenced filename exists.

**Design ↔ conversation.** Three mechanisms, all already precedented: `design_links` for binding (mirroring `document_links`), a `design-context` prompt section (**never the key `'skill'`** — `ContextRecorder` derives `skills.use_count` from it), and `design_*` registry tools so agents can create and edit.

---

## Task list

| # | Task | Files | Acceptance |
|---|---|---|---|
| 1 | **Canvas schema + validator gate** | `canvas-schema.ts`, `dc-validate.ts` | `canvas.json` matches §4.1 exactly — stray top-level keys, unlisted `page`, unknown `launch` view, duplicate note id, artboard naming, the 200/2 MiB/200/40 caps, a missing image reference and the `}} ?` style-attribute ternary are each rejected with a useful message |
| 2 | **`.dc.html` parser** | `dc-template.ts` | Splits `<helmet>`, the `<x-dc>` body, `data-props` (HTML-entity-decoded then JSON-parsed) and the logic source; rejects an empty `data-dc-script`; a static artboard with no script parses |
| 3 | **Tables, store, service** | `schema.ts`, `design-store.ts`, `design-service.ts` | Mirrors brand: append-only versions, restore copies forward, traversal-guarded paths, ISO timestamps |
| 4 | **The runtime** | `dc-runtime-source.ts` | Under jsdom: dotted holes resolve; a non-path hole renders empty; `sc-for` repeats with `$index`; `sc-if` branches; `dc-import` mounts a sibling; `onClick` bound from `renderVals()` fires; `setState` re-renders; an operator outside `{{ }}` stays literal text |
| 5 | **Sandbox composition** | `dc-render.ts` | The srcdoc carries the CSP meta, the `sandbox` attribute has `allow-scripts` and **not** `allow-same-origin`, images resolve to data URIs, and a missing image is reported rather than silently broken |
| 6 | **Module, routes, CASL, bootstrap** | `index.ts`, `routes.ts` + core wiring | `Design` subject; auth+CSRF pair for `/api/v1/designs/*`; routes created in `onStart`; contract tests pass with no new debt |
| 7 | **Import / export** | `canvas-io.ts` | Parses `appifact-doc` from a published page; refuses a `store: 'db'` page; exports a file tree, a zip, and a self-contained page using the EYAS runtime |
| 8 | **AI editing engine** | `design-prompt.ts`, `design-ai.ts` | One prompt, tier chosen by provider capability, every result through the validator gate, one retry with the validator output as feedback, previous version kept on failure |
| 9 | **Tools + conversation integration** | `design-tools.ts`, assembler section | `design_list/read/write/canvas`, `category:'custom'`; a `design-context` section keyed `design-context`, recorded with `sourceRef = designId` |
| 10 | **Frontend** | `routes/design.tsx`, `pages/design/**` | Sidebar entry, list page, canvas page with pan/zoom and pages, source editor, AI panel; six locales; `bun run build:web` clean |
| 11 | **Docs** | architecture §58, CLAUDE.md, CHANGELOG, hand-edited doc pages | No generator run |

## F2 exit criteria

1. Test and lint at or below baseline.
2. A canvas exported from EYAS re-seeds in Claude Code's `/design` helper with no validator error.
3. A canvas imported from a published Claude Design page renders, including a `DCLogic`-driven interactive control.
4. The artboard iframe has `allow-scripts` and not `allow-same-origin`, asserted by a test.
5. An AI edit that produces invalid `canvas.json` leaves the stored version untouched.
6. A design referenced in a conversation appears as a `design-context` section in `context_compositions`.
7. Six locales, identical key sets. No version change.
