# Frontend template (skin) system + Status Bar module — Design

**Date:** 2026-07-09
**Status:** Approved (design), pending implementation plan
**Owner:** krisz@eyssen.com

## Problem / goal

The EYAS frontend currently ships a single visual identity (macOS Sequoia
vibrancy). The user wants to let the end-user pick between multiple looks. We
add a **template (skin) system** with 5 starter templates — the existing Sequoia
plus 4 new ones designed as mockups (Nebula, Atelier, Halo, Terminal) — chosen
from a **template selector** in the top bar, next to the light/dark toggle.

Separately, the Terminal mockup's bottom info bar is promoted to a **core shell
element that appears in every template**, implemented as its own EYAS **module**
(`statusbar`) so its content can be extended later.

## Scope

**In scope (v1):**
- A CSS-variable "skin" system: `data-template="<id>"` on `<html>`, one token
  pack per template (both light and dark), in a dedicated `themes/` directory.
- 5 templates: `sequoia` (current default), `nebula`, `atelier`, `halo`, `terminal`.
- A template selector control in the top bar (before the theme toggle).
- A `statusbar` module (backend + frontend) rendering a full-width bottom bar in
  every template, with 4 segment groups.

**Out of scope (v1) — deliberate:**
- Per-page structural flourishes from the mockups (Terminal's `ke@eyas ~/board $`
  prompt line, Atelier's editorial masthead, Nebula's animated aurora canvas).
  A template is a **skin** (palette, typography, depth, shape, background) applied
  through tokens across the whole app — not a per-page layout rewrite. Deeper
  per-template chrome can be layered on later, template by template.
- Per-user (DB) persistence of the chosen template/mode. v1 persists to
  `localStorage` (consistent with the current theme store). DB-backed per-user
  preference is a straightforward later upgrade.

## Current architecture (verified)

- Theming is fully token-based. `src/web/src/globals.css` defines ~25 CSS custom
  properties under `:root` (light) and `.dark` (dark): shadcn tokens
  (`--background`, `--foreground`, `--card`, `--primary`, … as HSL triples),
  `--radius`, and EYAS material tokens (`--vibrancy-bg`, `--card-glass`,
  `--card-shadow`, `--nav-active-*`, `--gradient-bg`). Utilities `.vibrancy`,
  `.glass-card`, `.section-label`, `.page-title`, `.nav-active` read the tokens.
- Mode is a `.dark` class on `document.documentElement`, driven by
  `src/web/src/stores/theme-store.ts` (Zustand), persisted to `localStorage`
  key `eyas-theme`, default `dark`.
- The body font-family is currently **hardcoded** in `globals.css` (SF Pro stack).
- Shell: `src/web/src/components/layout/app-layout.tsx` =
  `TopBar` / (`Sidebar` + `main`) / `SearchBar` in a `flex h-screen flex-col`.
- Top bar `top-bar.tsx` right cluster = `<ThemeToggle /> <NotificationBell /> <UserMenu />`.
- Backend module shape: `EyasModule` (`id`, `type`, `onRegister`, `onStart`,
  `routes`, optional `settings` page metadata); modules registered in
  `src/core/bootstrap.ts`. Frontend has a WS hook `use-websocket.ts` for live data.
- Sidebar nav is hardcoded on the frontend (not a runtime registry).

## Design

### A. Template (skin) system

**Directory:** `src/web/src/themes/`
- `registry.ts` — exported `TEMPLATES` array: `{ id, label, description, swatch: string[] }`
  for the selector; `sequoia` first (default).
- `index.css` — `@import`s each template css; imported once from `globals.css`
  (or `main.tsx`).
- `nebula.css`, `atelier.css`, `halo.css`, `terminal.css`.

**Mechanism:** set `data-template="<id>"` on `document.documentElement`. Mode stays
the `.dark` class. Each non-default template css defines two blocks:
```css
:root[data-template="nebula"]      { /* light token overrides */ }
:root[data-template="nebula"].dark { /* dark token overrides  */ }
```
`sequoia` is the **default**: selecting it removes the `data-template` attribute so
the app falls back to the untouched `globals.css` `:root` / `.dark` — the existing
look, unchanged. There is therefore no `sequoia.css` (the default lives in
`globals.css`); `sequoia` still appears in the registry as the first entry.

**Tokens.** Templates override the existing ~25 variables plus a small set of NEW
tokens we introduce so skins can express type and shape:
- Font tokens: `--font-sans`, `--font-display`, `--font-mono`. Tokenize the
  `body` font-family in `globals.css` to read `--font-sans`; components/utilities
  use `--font-display` (headings) and `--font-mono` (numerics/labels). Font stacks
  are cross-platform with fallbacks (EYAS is a general product; no external fonts):
  e.g. Atelier `'Baskerville','Georgia',serif`; Terminal `'SF Mono','Menlo','Consolas',ui-monospace,monospace`.
- Shape/effect tokens: `--border-width` (Terminal = 2px hard), `--shadow-offset`
  (brutalist offset), reused `--radius` (Terminal = 0), `--gradient-bg` (Nebula
  aurora), `--card-glass`/`--vibrancy-bg` (glass depth). New tokens get sensible
  defaults in `globals.css` `:root`/`.dark` so the default look is unchanged.

**Both modes per template.** Every template ships a light AND a dark token set
(the counterpart mode is designed tastefully, e.g. a light Nebula, a dark
Atelier). The light/dark toggle works within any template.

**Store.** Extend `theme-store.ts` (or add `template-store.ts`) with:
`template: string`, `setTemplate(id)`, applying `data-template` on the root and
persisting to `localStorage` key `eyas-template` (default `sequoia`). Applied on
app init alongside the existing theme application.

### B. Template selector

`src/web/src/components/layout/template-selector.tsx` — a popover trigger placed
in the top bar right cluster **before** `<ThemeToggle />`. Lists `TEMPLATES` with
label + a mini swatch (2–3 color dots from `swatch`) + active check; selecting
calls `setTemplate(id)`. Keyboard-accessible, visible focus state.

### C. Status bar module (`statusbar`)

**Backend** `src/modules/statusbar/`:
- `index.ts` — `EyasModule` id `statusbar`, registers routes on `onStart`.
- `segments.ts` — a server-side **segment registry**: each provider returns a
  `{ id, data }` for a segment. v1 providers compute the server-derived data:
  task counts (open / overdue / running) and active-agent count from the DB;
  sync status; EYAS version + env from config. Extensible: adding content later =
  registering a provider.
- `routes.ts` — `GET /api/v1/statusbar` returns the aggregated snapshot
  `{ segments: {...} }`. CASL-protected like other endpoints.

**Frontend** `src/web/src/components/layout/status-bar.tsx`:
- Rendered in `app-layout.tsx` as a full-width footer row after the
  (Sidebar + main) row → appears in **every** template.
- Styled purely through tokens (`.vibrancy` material, `hsl(var(--foreground))`,
  `--font-mono` + `tabular-nums` for numerics, `1px` top border via `--border`),
  so it adapts to each skin automatically. Height ~26px.
- Fetches the snapshot on load and refreshes from existing WS events
  (agent progress, board changes); the clock and current-view/context segment
  are client-derived (from the router). A frontend **segment registry** (array of
  small segment components) makes adding UI segments a one-line change.
- **v1 segments:** (1) view/board context + `N tasks · N overdue · N running`;
  (2) active agents; (3) connection/sync status (`SYNCED` · `OFFLINE`);
  (4) EYAS version + live clock.

Registered in `src/core/bootstrap.ts`.

## File map (new / touched)

```
NEW  src/web/src/themes/registry.ts
NEW  src/web/src/themes/index.css
NEW  src/web/src/themes/{nebula,atelier,halo,terminal}.css   (sequoia = default in globals.css)
NEW  src/web/src/components/layout/template-selector.tsx
NEW  src/web/src/components/layout/status-bar.tsx
NEW  src/modules/statusbar/{index.ts,routes.ts,segments.ts}
EDIT src/web/src/globals.css            (font tokens + new skin tokens; import themes)
EDIT src/web/src/stores/theme-store.ts  (template state + apply + persist)
EDIT src/web/src/components/layout/top-bar.tsx     (template selector before toggle)
EDIT src/web/src/components/layout/app-layout.tsx  (status bar row)
EDIT src/core/bootstrap.ts              (register statusbar module)
NEW  tests: template store apply, statusbar routes snapshot, statusbar module registration
```

## Build order

1. `globals.css`: introduce `--font-sans/-display/-mono` (body reads `--font-sans`)
   and new skin tokens with defaults; `@import` the themes.
2. `themes/`: `registry.ts` + 5 css token packs (each light + dark).
3. `theme-store`: template state, `setTemplate`, persistence; apply on init.
4. `template-selector.tsx` into the top bar.
5. `statusbar` module: backend (index/routes/segments) + frontend
   (`status-bar.tsx` + segment registry) + `app-layout` wiring + bootstrap register.
6. Tests.

## Testing

- Template store: `setTemplate` sets `data-template`, persists, and defaults to
  `sequoia`; light/dark toggle composes with template.
- Statusbar backend: `GET /api/v1/statusbar` returns the 4 segment data groups;
  counts computed correctly from seeded data; module registers cleanly.
- Statusbar frontend: renders segments from a snapshot; clock/context client-derived.
- Visual sanity: each of the 5 templates applies its tokens app-wide in both modes.

## Decisions & risks

- **Skin depth confirmed:** token packs only (no per-page flourishes in v1).
- **Cross-platform fonts:** stacks with fallbacks; non-macOS users see the nearest
  available face (acceptable; EYAS is a general product).
- **Persistence:** `localStorage` v1 (matches theme); per-user DB is a later upgrade.
- **Status bar data:** part server-derived (counts, agents, sync, version), part
  client-derived (context, clock); live via existing WS events, no new socket.
- **Rule 9 honored:** every color/type/shape decision flows through CSS variables;
  no hardcoded colors in components. Templates only redefine tokens.
