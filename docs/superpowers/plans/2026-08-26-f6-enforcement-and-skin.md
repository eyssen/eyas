# F6 — Enforcement and polish — Implementation Plan

**Goal:** Make a brand something a background run is actually held to, and let a
brand skin the application itself.

**Architecture:** The brand critic joins the existing verification chain rather
than starting a second one — it writes into the same `feedback` object, uses the
same per-lineage round cap and the same single resume. The app skin is a runtime
`<style>` element built from the brand's own tokens by mechanical conversion
only; no colour is invented.

**Tech Stack:** Model gateway, Hono, Zod, Vitest, React, CSS custom properties.

**Spec:** `docs/superpowers/specs/2026-08-26-design-and-brand-system-design.md` §6 F6

---

## Global Constraints

- Never commit, never push, never branch.
- Version frozen at `0.8.14-beta` everywhere.
- All six locales: `en, hu, de, es, fr, tlh`.
- MIT-compatible dependencies only. **F6 adds none.**
- Baseline that must not grow: `bun run test` → 58 failing in 9 files;
  `bun run lint` → 51.
- Never run `bun run full-docs`.
- English code and comments; Hungarian conversation.

---

## Decisions, and why

### D1 — One feedback channel, one round budget

`conversation-runner.ts` already has a chain: deterministic verify commands →
completeness critic → at most `criticMaxRounds` feedback resumes per lineage,
counted through `criticRoundsSpent()` over the whole ancestry.

The brand critic joins that chain as a third link. It writes the same
`feedback: { reason, missing }` object, so it inherits the cap, the single
resume, and the `CriticVerdict`-style event trail for free. It does **not** get
its own loop.

Consequence worth stating: a brand hand-back spends the lineage's one round, so
a later completeness gap becomes the operator's. That is correct — one hand-back
per lineage total is the existing policy, and having two critics each entitled
to a round would be the unbounded loop the round cap exists to prevent.

Order is verify → completeness → brand, each skipped when the previous produced
feedback. A run that did not finish its work is not told about its colours.

### D2 — Fails OPEN, deliberately

Three precedents in this codebase, and they disagree on purpose: the security
judge fails CLOSED because it guards a side effect that has not happened yet;
the completeness critic fails OPEN because the run has already done its work;
`model/cheap-pass.ts` fails open for the same reason.

The brand critic is the softest of the three. It judges the *style* of output
that already exists, and the enforcement policy this system was designed around
is **hard on the frame, soft on the content** — the email shell, the
notification template and `render_branded_html` are deterministic and cannot be
talked out of the brand, while what the agent writes inside them is advice. An
unreachable model must never turn a finished run into a failed one over a
colour. Verdict `unavailable` ⇒ `verification` untouched, no feedback.

### D3 — A deterministic pre-check, so most runs cost nothing

Modelled on `deterministicGroundingCheck`. The model is asked only when both
hold:

1. a brand actually resolves for the conversation, and
2. the run produced something a brand could apply to.

(2) is decided by tool names and transcript markers, not by guessing: an agent
that edited code, ran a search or triaged a ticket has no brand surface, and
asking a model whether its output is on-brand would be both wasteful and
nonsense. Only a run that rendered branded HTML, drafted an email, wrote a
document or touched a design canvas is judged.

### D4 — The skin is single-mode, because a brand has one palette

The five shipped templates each define a light block and a `.dark` block. A
brand defines fourteen colour roles, once. Deriving the other mode means
inventing colours, and this project has spent five phases not doing that.

So a brand skin emits one block, and while it is active the app pins its
light/dark class to whichever the brand's own background luminance implies. The
theme toggle is disabled and says why. A brand that wants both modes needs a
second palette in the schema — a migration, not a polish task.

### D5 — Mechanical conversions only

- hex → HSL triplet is exact arithmetic.
- `readableOn(hex)` picks black or white by WCAG relative luminance — a
  computation, not a taste call. It fills the three foregrounds the brand schema
  has no role for (`danger`, `success`, `warning`).
- The vibrancy/nav/gradient tokens are the brand's own colours at an opacity or
  interpolated between two of them. No new hue appears anywhere.

### D6 — The build-time `@import` list is NOT touched

The spec names it, but there is nothing to import: a brand skin has no CSS file,
it is a `<style>` element built at runtime from the tokens the API returns.
Adding an import would be an empty file. Recorded as a deliberate deviation.

---

## File Structure

**Create**
- `src/modules/brand/brand-critic.ts` — the pre-check, the prompt, the strict
  verdict parse, the fail-open ladder.
- `src/web/src/themes/color.ts` — `hexToHslTriplet`, `relativeLuminance`,
  `readableOn`, `withAlpha`, `mixHex`. Pure.
- `src/web/src/themes/brand-skin.ts` — `buildBrandSkinCss` (pure),
  `applyBrandSkin`, `clearBrandSkin`, `isBrandSkinId`, `brandSkinId`.
- `tests/modules/brand/brand-critic.test.ts`
- `tests/web/brand-skin.test.ts`

**Modify**
- `src/modules/agent/conversation-runner.ts` — the third link in the chain.
- `src/modules/agent/index.ts` — wire the brand resolver and the config flag.
- `src/core/config/schema.ts`, `src/core/types.ts` — `brandCriticEnabled`.
- `src/web/src/themes/registry.ts` — widen the id union.
- `src/web/src/stores/theme-store.ts` — brand skins in the store.
- `src/web/src/app.tsx` — hydrate a stored brand skin on boot.
- `src/web/src/pages/settings/settings-page.tsx` — list brands as skins,
  disable the light/dark toggle while one is active.
- `src/web/src/components/layout/template-selector.tsx` — same list.
- locales × 6 for both the settings and layout namespaces.
- `docs/eyas-architecture.md`, `CHANGELOG.md`, `CLAUDE.md`, six user-doc pages.

---

## Task 1 — The brand critic (pure half)

**Interfaces produced:**
```ts
export type BrandVerdictKind = 'on-brand' | 'off-brand' | 'unavailable'
export interface BrandCriticInput {
  brandCard: string
  transcript: string
  toolNames?: string[]
}
export interface BrandCriticResult { verdict: BrandVerdictKind; reason: string; issues: string[] }
export const BRAND_SURFACE_TOOLS: Set<string>
export function hasBrandSurface(input: { transcript: string; toolNames?: string[] }): boolean
export function parseBrandVerdict(text: string): { verdict: 'on-brand'|'off-brand'; reason: string; issues: string[] } | null
```

- [ ] **Step 1: write the failing test** covering: a code-editing run has no
  brand surface; a run that called `render_branded_html`, `send_email`,
  `design_write` or `create_document` does; a transcript containing an
  `<html>`/`<table>` email shell does; the strict parse rejects prose, a fenced
  non-object, an unknown verdict, and accepts a fenced object.
- [ ] **Step 2–4:** run, implement, run.

## Task 2 — The brand critic (model half)

**Interfaces produced:**
```ts
export interface BrandCriticDeps { gateway; resolveTier?; logger?; metadata? }
export async function runBrandCritic(input: BrandCriticInput, deps: BrandCriticDeps): Promise<BrandCriticResult>
```

- [ ] **Step 1: write the failing test.** No providers ⇒ `unavailable`, never a
  throw. No brand surface ⇒ `unavailable` with a reason, and **the gateway is
  never called** (assert the call count — that is the cost guarantee). A model
  that answers unparseable JSON ends the ladder at `unavailable` rather than
  shopping for a verdict. The untrusted transcript is fenced by a per-call
  nonce, and a transcript that fakes the fence cannot address the critic.
- [ ] **Step 2–4:** run, implement, run.

Reuse `capTranscript` from `agent/critic.ts` rather than re-deriving a budget.

## Task 3 — The chain

- [ ] **Step 1: write the failing test** against `conversation-runner`'s helper
  surface: brand feedback only when the completeness critic produced none; the
  round cap is shared, so a brand hand-back at round ≥ max is dropped; an
  `unavailable` brand verdict leaves `verification` exactly as the completeness
  critic left it.
- [ ] **Step 2–4:** run, implement, run. Add config `agent.brandCriticEnabled`
  (default true) and wire `ctx.brandResolver` through `ConversationCriticDeps`.

## Task 4 — Colour maths

- [ ] **Step 1: write the failing test.** `#7c5cff` → `252 100% 68%`; pure
  greys have hue 0 and saturation 0; `#ffffff` → `0 0% 100%`; short hex is
  accepted; garbage returns null rather than `NaN NaN% NaN%`. `readableOn`
  returns white on a dark brand colour and black on a light one, checked on
  both sides of the threshold. `withAlpha` and `mixHex` round-trip.
- [ ] **Step 2–4:** run, implement, run.

## Task 5 — The skin

**Interfaces produced:**
```ts
export function brandSkinId(brandId: string): string          // `brand-<id>`
export function isBrandSkinId(x: string): boolean
export function brandIdFromSkin(x: string): string | null
export function buildBrandSkinCss(brandId: string, tokens: BrandTokens): string
export function brandSkinMode(tokens: BrandTokens): 'light' | 'dark'
export function applyBrandSkin(brandId: string, tokens: BrandTokens): void
export function clearBrandSkin(): void
```

- [ ] **Step 1: write the failing test.** The CSS selector is exactly
  `:root[data-template="brand-<id>"]`; every `@theme inline` token the app reads
  is present (assert against a frozen list, so adding a token to globals.css
  without adding it here is caught); a brand id with a quote or a brace cannot
  reach the selector or a declaration; the mode follows the background's
  luminance; `applyBrandSkin` replaces rather than accumulates `<style>`
  elements.
- [ ] **Step 2–4:** run, implement, run.

## Task 6 — Store, boot and UI

- [ ] `registry.ts`: `AppSkinId = TemplateId | \`brand-${string}\``.
  `isTemplateId` keeps rejecting `bogus` — `tests/web/theme-registry.test.ts`
  asserts that and must stay green.
- [ ] `theme-store.ts`: accept a brand skin id, persist it, and expose whether
  the light/dark toggle is locked.
- [ ] `app.tsx`: on boot, if the stored skin is a brand, fetch and inject. Until
  it lands the app shows the default skin — a plain default is a better first
  paint than a half-applied palette.
- [ ] Settings + selector: brands listed under the templates with their own
  swatch (background / primary / foreground), and the light/dark control
  disabled with the reason while a brand skin is active.
- [ ] Locale keys × 6, then `web-i18n-parity`, then `bun run build:web`.

## Task 7 — Documentation

- [ ] `docs/eyas-architecture.md` §57, `CHANGELOG.md`, `CLAUDE.md`.
- [ ] The six user pages, hand-written.
- [ ] Memory file + `MEMORY.md`.

---

## Self-review

**Spec coverage.** F6 has two bullets. The critic → Tasks 1–3, with the polarity
chosen and argued (D2). The app-chrome skin → Tasks 4–6, with the `@import`
deviation recorded (D6).

**Type consistency.** `BrandCriticResult` is produced by Task 2 and consumed by
Task 3. `BrandTokens` is the frontend's existing brand type from
`pages/settings/brand-card.tsx`; if it is not exported, Task 5 lifts it to a
shared frontend type rather than re-declaring it.

**The risk being taken.** A brand palette designed for a flyer is not
necessarily a usable application palette. The skin is opt-in, per-viewer, stored
in localStorage, and one click from the default — so a bad-looking result costs
a click, not a support call. That is the reason it is a viewer preference and
not a server-side setting.
