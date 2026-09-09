# F5 — Print, PDF, PNG, and URL extraction — Implementation Plan

> **For agentic workers:** this plan is executed inline in the main session, not
> by dispatched subagents (project rule: EYAS implementation is never delegated
> to a CLI subagent).

**Goal:** Turn a stored design canvas into printable output — PNG per artboard,
PDF per artboard and for the whole canvas — and let a brand be extracted from a
live URL, both on a headless browser that may legitimately be absent.

**Architecture:** One shared, lazily-launched headless browser in `src/shared/`,
used by two consumers (design print, brand probe). Every artboard is rendered
the same way — as its own top-level document via `page.setContent()` — and a
multi-artboard PDF is the concatenation of those single-artboard PDFs. Nothing
about the `.dc.html` runtime changes.

**Tech Stack:** `playwright-core` (Apache-2.0), `pdf-lib` (MIT), Hono, Zod,
Vitest.

**Spec:** `docs/superpowers/specs/2026-08-26-design-and-brand-system-design.md` §6 F5

---

## Global Constraints

- Never commit, never push, never branch. Work on `main`, leave it dirty.
- The version is frozen: `package.json` `version`, `version.json`, and every
  HTML version string stay at `0.8.14-beta`.
- Every user-facing string exists in all six locales: `en, hu, de, es, fr, tlh`.
  `tests/contracts/web-i18n-parity.contract.test.ts` enforces it.
- Dependencies must be MIT-compatible. `playwright-core` is Apache-2.0,
  `pdf-lib` is MIT (transitively: `@pdf-lib/standard-fonts` MIT,
  `@pdf-lib/upng` MIT, `pako` MIT, `tslib` 0BSD).
- Measurement baseline that must not grow: `bun run test` → 58 failing tests in
  9 files; `bun run lint` → 51 errors.
- Never run `bun run full-docs`; it destroys hand-written documentation.
  `bun run skeleton` is safe.
- Code and comments in English. Conversation with the user in Hungarian.

---

## Decisions, and why

### D1 — `playwright-core`, not `playwright`

The spec says "promote Playwright to a real dependency … and graceful
degradation when absent". Those are only compatible if what becomes real is the
**package** and what stays optional is the **browser binary**.

`playwright` runs a postinstall that downloads Chromium, Firefox and WebKit
(~500 MB). Bun does not run postinstall scripts for untrusted dependencies, so
adding `playwright` would install the package, skip the download, and fail at
launch with a confusing error — the worst of both. `playwright-core` is the same
Apache-2.0 code with no postinstall and no runtime dependencies, and it carries
the real TypeScript types we need to get `page.pdf()` right.

The browser binary is then resolved at runtime, in order:
`EYAS_CHROMIUM_PATH` → a known system path → Playwright's own browser registry.
When none resolves, every print path answers 503 with the remediation, and the
UI disables the buttons rather than offering something that fails.

### D2 — One artboard per document, always

Chromium **cannot paginate content inside an iframe** — it renders the iframe as
a fixed box and clips the overflow. `print: 'flow'` therefore cannot use the
iframe isolation the canvas preview uses; the artboard must be the top-level
document.

Rendering several artboards into one document is the alternative, and it is
worse: each artboard's `<helmet>` moves into the shared `<head>`, so two
artboards' global CSS collide silently.

So: exactly one artboard per browser document, top-level, every time. Fixed and
flow, PNG and PDF, single export and canvas export all take the same path. This
also means **`dc-runtime-source.ts` is not touched by F5 at all**.

### D3 — `pdf-lib` for the canvas PDF

Once D2 holds, a canvas PDF is N single-artboard PDFs concatenated. `page.pdf()`
produces one page size per call, so concatenation is the only way to keep a
brochure's natural page sizes *and* let a flow artboard paginate inside the same
document. PDF itself has no problem with mixed page sizes — each page carries
its own MediaBox.

`pdf-lib` is not in the spec's dependency list; this is a deliberate addition,
flagged rather than slipped in. It is MIT, and we use exactly two of its calls
(`PDFDocument.load`, `copyPages`). The alternative — one uniform paper for the
whole canvas — would silently rescale a poster series, which is precisely the
kind of quiet compromise this project has been avoiding.

### D4 — The print document is not the preview iframe, and says so

The preview's security rests on `sandbox="allow-scripts"` without
`allow-same-origin`. The print document has no sandbox attribute — it *is* the
document. Its isolation comes from somewhere else, and all three layers are
required:

1. The page is created from `setContent()` in a **throwaway browser context**:
   no cookies, no storage, an opaque origin, discarded after the export.
2. `context.route('**', …)` **aborts every request** except the two Google Fonts
   origins the format admits. This is the real fence — it is enforced by the
   browser process, not by the page.
3. The same `ARTBOARD_CSP` meta tag as the preview, so the two cannot drift.

### D5 — Export options live on the request, not in `canvas.json`

Paper size, margins and PNG scale are export-time choices. Putting them in
`canvas.json` would add keys to a manifest whose schema is strict on both sides
of the Claude Design interop, for no gain. They are query parameters.

### D6 — No agent tool for export

`design_*` tools return text. An export returns bytes, and there is no channel
in the tool-result path that carries bytes. Wiring export into the documents
module would be a genuine feature, but it is not in F5's scope and would be a
surface with no caller today. Left out, deliberately.

---

## File Structure

**Create**
- `src/shared/playwright-loader.ts` — resolve the module and the browser binary;
  `BrowserUnavailableError`. Pure except for the injected `import`/`exists`.
- `src/shared/headless-browser.ts` — the lazily-launched, idle-closing browser
  holder shared by design and brand.
- `src/modules/design/print-page.ts` — build the print document for ONE
  artboard. Pure string function.
- `src/modules/design/print-options.ts` — paper sizes, `pdfOptionsFor`,
  `pngOptionsFor`, `paperFor`. Pure.
- `src/modules/design/print-service.ts` — drive the browser, merge with pdf-lib.
- `src/modules/brand/brand-probe.ts` — read a live page's tokens through the
  browser; the browser-free half is `extractFromUrl` in `brand-origins.ts`.
- `tests/modules/design/print-page.test.ts`
- `tests/modules/design/print-options.test.ts`
- `tests/modules/design/print-routes.test.ts`
- `tests/modules/design/print-smoke.test.ts` — opt-in, real browser.
- `tests/shared/playwright-loader.test.ts`
- `tests/modules/brand/extract-url.test.ts`

**Modify**
- `package.json` — `playwright-core`, `pdf-lib`.
- `src/optional-modules.d.ts` — drop the now-real `playwright` shim only if
  nothing still imports the full package; otherwise keep it and say why.
- `src/modules/tools/builtin/browser-session.ts` — use the shared loader so
  there is one place that knows how to find a browser.
- `src/modules/design/dc-render.ts` — extract `buildArtboardSpec` so the preview
  and the print document share one spec builder. No behaviour change.
- `src/modules/design/routes.ts` — `GET /designs/print-status`,
  `GET /designs/:id/export/png`, `GET /designs/:id/export/pdf`.
- `src/modules/design/index.ts` — wire the print service, close the browser in
  `onStop`.
- `src/modules/brand/brand-origins.ts` — `extractFromUrl(probe, url, name)`.
- `src/modules/brand/routes.ts` — `POST /brands/extract-url`.
- `src/modules/brand/index.ts` — wire the probe.
- `Dockerfile` — chromium and its system libraries in the runtime stage.
- `src/web/src/pages/design/design-detail-page.tsx` + `locales/*.json` × 6.
- `src/web/src/pages/settings/brand-card.tsx` + `locales/*.json` × 6.
- `docs/eyas-architecture.md`, `CHANGELOG.md`, `CLAUDE.md`,
  `packages/docs/src/content/docs/{en,hu,de,es,fr,tlh}/…`.

---

## Task 1 — Dependencies and the shared Playwright loader

**Interfaces produced:**
```ts
export class BrowserUnavailableError extends Error { readonly remediation: string }
export interface PlaywrightLike { chromium: { launch(opts?: any): Promise<any> } }
export function knownChromiumPaths(platform: NodeJS.Platform): string[]
export function resolveChromiumExecutable(deps?: {
  env?: NodeJS.ProcessEnv; exists?: (p: string) => boolean; platform?: NodeJS.Platform
}): string | undefined
export async function loadPlaywright(load?: () => Promise<any>): Promise<PlaywrightLike>
```

- [ ] **Step 1: add the dependencies**

```bash
bun add playwright-core pdf-lib
```

Then confirm the version line landed in `package.json` `dependencies` and that
`version` is untouched.

- [ ] **Step 2: write the failing test** — `tests/shared/playwright-loader.test.ts`

Cover: `EYAS_CHROMIUM_PATH` wins; a non-existent env path is refused loudly
rather than silently ignored; the first existing known path wins; `undefined`
when nothing exists; `loadPlaywright` throws `BrowserUnavailableError` when the
import fails and returns the module when it succeeds.

- [ ] **Step 3: run it, see it fail** — `bun vitest run tests/shared/playwright-loader.test.ts`

- [ ] **Step 4: implement `src/shared/playwright-loader.ts`**

- [ ] **Step 5: point `browser-session.ts` at it**

Replace its private `ensurePlaywright` with `loadPlaywright()` and pass
`executablePath` into `chromium.launch`. Run
`bun vitest run tests/modules/tools/browser-ssrf.test.ts` to confirm nothing
regressed.

- [ ] **Step 6: full run, diff against baseline**

## Task 2 — The shared headless browser

**Interfaces produced:**
```ts
export interface HeadlessBrowser {
  withPage<T>(opts: PageOptions, fn: (page: any) => Promise<T>): Promise<T>
  status(): Promise<{ available: boolean; reason?: string; remediation?: string }>
  close(): Promise<void>
}
export interface PageOptions {
  viewport?: { width: number; height: number }
  deviceScaleFactor?: number
  /** Origins that may load. Everything else is aborted in the browser process. */
  allowOrigins?: string[]
}
export function createHeadlessBrowser(opts?: {…}): HeadlessBrowser
export function sharedHeadlessBrowser(): HeadlessBrowser
export async function closeSharedHeadlessBrowser(): Promise<void>
```

- [ ] **Step 1: test the parts that do not need a browser**

`status()` reports unavailable with a remediation when the loader throws;
`withPage` propagates that same error; the idle timer is `unref`'d so it cannot
hold the process open. Inject a fake playwright module.

- [ ] **Step 2: run, fail, implement, run**

Key implementation notes to carry into the file:
- one `Browser`, many short-lived `BrowserContext`s — `deviceScaleFactor` is a
  context option, not a screenshot option, so @2x needs its own context;
- `context.route('**', route => allowed(route.request().url()) ? route.continue() : route.abort())`;
- the idle timer must be `unref()`'d, or `bun vitest` never exits.

## Task 3 — `buildArtboardSpec` extraction

- [ ] **Step 1:** in `dc-render.ts`, lift the spec construction out of
  `renderArtboard` into an exported `buildArtboardSpec(input): ArtboardSpec`,
  and have `renderArtboard` call it. Nothing else changes.
- [ ] **Step 2:** run `bun vitest run tests/modules/design/` — the existing
  render tests are the regression gate; they must all still pass.

## Task 4 — The print document (pure)

**Interfaces produced:**
```ts
export interface PrintPageInput {
  spec: ArtboardSpec            // from buildArtboardSpec
  mode: 'fixed' | 'flow'
  width: number                 // css px
  height: number                // css px, fixed only
  contentWidth?: number         // flow: the column width
}
export function buildPrintDocument(input: PrintPageInput): string
```

- [ ] **Step 1: write the failing test** — `tests/modules/design/print-page.test.ts`

Assert: the document carries `ARTBOARD_CSP` verbatim (imported, not re-typed);
a fixed document pins `html,body` and the page box to exactly `width`×`height`
with `overflow:hidden`, so a sub-pixel overflow cannot spill onto a second page;
a flow document sets the column width and does **not** clip; the JSON spec is
escaped so an artboard containing `</script>` cannot truncate the document (the
same failure `claude-design-interop` caught once already); the runtime source is
present exactly once.

- [ ] **Step 2–4:** run, implement, run.

## Task 5 — Print options (pure)

**Interfaces produced:**
```ts
export const PAPERS: Record<'a4'|'letter'|'a3'|'a5', { widthPx: number; heightPx: number }>
export type PaperChoice = 'auto' | keyof typeof PAPERS
export function printModeOf(entry: ArtboardEntry | undefined): 'fixed' | 'flow'
export function frameOf(entry, preview, fallback): { width: number; height: number }
export function pdfOptionsFor(args): { width?: string; height?: string; format?: string;
  printBackground: true; margin: {…}; scale?: number; pageRanges?: string }
export function pngOptionsFor(args): { viewport; deviceScaleFactor; fullPage: boolean }
```

- [ ] **Step 1: write the failing test** — `tests/modules/design/print-options.test.ts`

Assert: 96 css px per inch — a 794×1123 fixed artboard yields `8.27in`×`11.7in`
(or the equivalent `px`, whichever the implementation emits — the test asserts
the resolved inches either way); fixed always sets `pageRanges: '1'`; flow uses
the chosen paper and a `scale` that is `min(1, printable/contentWidth)`, clamped
into Playwright's 0.1–2 range; `paper: 'auto'` picks the paper closest in width
to the artboard, defaulting to A4; a missing `canvas.json` entry falls back to
the artboard's `$preview` and then to 800×600; PNG `fullPage` is true only for
flow.

- [ ] **Step 2–4:** run, implement, run.

## Task 6 — The print service

**Interfaces produced:**
```ts
export interface PrintService {
  status(): Promise<{ available: boolean; reason?: string; remediation?: string }>
  png(design: Design, file: string, opts?: { scale?: number }): Promise<Uint8Array>
  pdf(design: Design, opts: { file?: string; paper?: PaperChoice; marginMm?: number }): Promise<Uint8Array>
}
export function createPrintService(deps: { browser: HeadlessBrowser; logger: Logger }): PrintService
```

- [ ] **Step 1: write the failing test**

With a fake `HeadlessBrowser` whose `withPage` hands back a recording stub:
`pdf()` without a `file` renders **every** artboard in canvas order (page, then
y, then x) and merges them; with a `file` it renders exactly that one; an
unknown file name throws a not-found error the route maps to 404; an unavailable
browser surfaces `BrowserUnavailableError` unchanged.

Order the merge test so it would fail if the artboards came back in `Object.keys`
order — that is the bug this test exists to catch.

- [ ] **Step 2–4:** run, implement, run.

Merge with pdf-lib:
```ts
const out = await PDFDocument.create()
for (const bytes of parts) {
  const src = await PDFDocument.load(bytes)
  const pages = await out.copyPages(src, src.getPageIndices())
  for (const p of pages) out.addPage(p)
}
return out.save()
```

## Task 7 — Design routes

- [ ] **Step 1: write the failing test** — `tests/modules/design/print-routes.test.ts`

Assert: `GET /api/v1/designs/print-status` answers `{available:false, reason}`
without throwing when there is no browser; it is registered **before**
`/designs/:id` (otherwise it resolves as a design id — the same trap
`/designs/import` already sits in front of); PNG and PDF answer 503 with the
remediation when unavailable, 404 for an unknown design or artboard, and
`image/png` / `application/pdf` with a `Content-Disposition` filename on success.

- [ ] **Step 2–4:** run, implement, run.

Filenames: `<slug>.png`, `<slug>-<stem>.pdf`, `<slug>.pdf`. `Content-Disposition`
values must be quoted and stripped of anything outside `[A-Za-z0-9._-]`.

- [ ] **Step 5:** wire it in `index.ts`, and close the browser from `onStop`.

## Task 8 — Brand extraction from a live URL

**Interfaces produced:**
```ts
export interface ProbedPage {
  title: string; url: string
  cssText: string                       // every same-origin stylesheet, concatenated
  computed: Record<string, string>      // :root custom properties, resolved
  bodyFont: string; headingFont: string
  colours: string[]                     // resolved, most-used first
}
export interface PageProbe { probe(url: string): Promise<ProbedPage> }
export async function extractFromUrl(probe: PageProbe, url: string, name?: string): Promise<OriginResult>
export function createBrandProbe(browser: HeadlessBrowser): PageProbe
```

- [ ] **Step 1: write the failing test** — `tests/modules/brand/extract-url.test.ts`

Assert: a private or loopback host is refused by `assertSafeBrowserUrl` **before**
the browser is touched (the fake probe records that it was never called); a
non-http scheme is refused; resolved custom properties beat scraped hex; the
result is a candidate — `ok: true` with `tokens`, and nothing written; a probe
that throws fails open with a message, never a stack.

- [ ] **Step 2–4:** run, implement, run.

`extractFromUrl` reuses `extractFromCss` for the stylesheet half, then overlays
the resolved `:root` custom properties, then the font families. Fonts must pass
`FONT_TOKEN_RE` — a live page is exactly the untrusted source the F3 CSS
injection fix was about.

- [ ] **Step 5:** `POST /api/v1/brands/extract-url` and the module wiring.

## Task 9 — Dockerfile

- [ ] **Step 1:** install chromium and its shared libraries in the runtime
  stage, and set `EYAS_CHROMIUM_PATH` to it.
- [ ] **Step 2:** verify the image still starts without a browser by leaving the
  path resolution failure non-fatal — the module must load, `status()` must
  report unavailable, and boot must not warn on every start.

The runtime stage is `oven/bun:1-slim` (Debian). Chromium comes from apt; the
extra weight is roughly 350 MB, and that is the honest cost of this phase.

## Task 10 — Frontend

- [ ] **Step 1:** design detail page — an export menu with PNG (1× / 2×) and PDF
  (this artboard / whole canvas), disabled with a tooltip when
  `print-status` says unavailable. Downloads go through the same plain `<a href>`
  the HTML export already uses.
- [ ] **Step 2:** brand card — a URL field next to the existing extract input.
- [ ] **Step 3:** add every new key to all six locale files, then
  `bun vitest run tests/contracts/web-i18n-parity.contract.test.ts`.
- [ ] **Step 4:** `bun run build:web` — it is the only thing that type-checks
  `src/web`; `bun run lint` excludes it.

## Task 11 — The real-browser smoke test

- [ ] **Step 1:** `tests/modules/design/print-smoke.test.ts`, skipped unless
  `EYAS_PRINT_SMOKE=1`. It renders a two-artboard canvas — one fixed, one flow —
  to PNG and PDF and asserts the magic bytes, the page count and the page size
  in points.
- [ ] **Step 2:** **run it locally** with a real browser and paste the result
  into the report. A print pipeline that has never rendered a page is not
  delivered, only written.

## Task 12 — Documentation

- [ ] `docs/eyas-architecture.md` — extend the design/brand section with F5.
- [ ] `CHANGELOG.md` — one wave entry, including the two new dependencies and
  the image-size cost.
- [ ] `CLAUDE.md` — current-state line.
- [ ] The six `packages/docs` pages, **hand-written**.
- [ ] Update the memory file and `MEMORY.md`.

---

## Self-review

**Spec coverage.** F5 has three bullets. Playwright promotion → Task 1 and 9.
`fixed`/`flow`, PNG per artboard, PDF for the canvas → Tasks 4–7. URL extraction
→ Task 8. All covered.

**Type consistency.** `ArtboardSpec` is produced by Task 3 and consumed by Tasks
4 and 6. `HeadlessBrowser` is produced by Task 2 and consumed by Tasks 6 and 8.
`PaperChoice` is produced by Task 5 and consumed by Tasks 6 and 7. `OriginResult`
is pre-existing in `brand-origins.ts` and reused unchanged.

**Placeholders.** None: every task names its files, its assertions and its
interfaces.

**Known risk.** The `oven/bun:1-slim` chromium install is the one step that
cannot be verified from this machine — it is verified by building the image,
which is outside this session. The plan therefore keeps every runtime path
working without a browser, so a failed image build degrades to "export
unavailable" rather than a broken boot.
