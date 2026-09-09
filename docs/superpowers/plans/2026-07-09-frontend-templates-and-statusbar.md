# Frontend Templates (skins) + Status Bar Module — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pick between 5 visual templates (skins) from a top-bar selector, and add an always-present, extensible bottom status bar implemented as its own EYAS module.

**Architecture:** Templates are pure CSS-variable token packs selected via `data-template="<id>"` on `<html>` (mode stays the `.dark` class), living in `src/web/src/themes/`. The status bar is a token-styled shell element in `app-layout`, fed by a new backend `statusbar` module that owns the (extensible) segment data.

**Tech Stack:** React 19 + Vite + Tailwind (CSS custom properties), Zustand store, Hono routes, Drizzle/bun:sqlite, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-09-frontend-templates-and-statusbar-design.md`

## Global Constraints

- CSS variables only — never hardcode colors in components (Architecture Rule 9). Templates redefine tokens only.
- English code and comments; vendor-neutral copy. The one brand accent allowed is eYssen red.
- No external resources introduced for templates (no font CDNs); font stacks use OS-available faces with generic fallbacks (EYAS is cross-platform).
- Every protected endpoint keeps its CASL check; `/api/v1/` prefix for all APIs.
- Run from repo root. Frontend typecheck: `cd src/web && bunx tsc --noEmit -p tsconfig.json`. Root tests: `bun vitest run <path>`. Root typecheck: `bun run lint`.
- Never commit without the user's explicit request (project rule); steps below include commits but the executor pauses for approval per the user's workflow.

---

# PHASE A — Template (skin) system

Independently shippable: after Phase A the app has a working template selector with 5 skins. The status bar (Phase B) is not required for this to work.

## Task A1: Font + skin tokens in globals.css

**Files:**
- Modify: `src/web/src/globals.css` (`:root` ~4-36, `.dark` ~38-69, `body` ~77-83)

**Interfaces:**
- Produces new CSS custom properties available app-wide, with defaults equal to the current look: `--font-sans`, `--font-display`, `--font-mono`, `--border-width`, `--shadow-offset`.

- [ ] **Step 1: Add font + skin tokens to `:root`** (after `--radius: 0.75rem;`)

```css
    --radius: 0.75rem;
    /* Type + skin knobs (templates override these) */
    --font-sans: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
    --font-display: var(--font-sans);
    --font-mono: 'SF Mono', 'Menlo', 'Consolas', ui-monospace, monospace;
    --border-width: 1px;
    --shadow-offset: 0 0 0 0 transparent; /* box-shadow value; brutalist templates set an offset */
```

- [ ] **Step 2: Point `body` font at the token**

Replace the `font-family:` line inside `body { … }`:

```css
  body {
    background: var(--gradient-bg);
    color: hsl(var(--foreground));
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
```

- [ ] **Step 3: Import the themes bundle** (top of file, after `@import "tailwindcss";`)

```css
@import "tailwindcss";
@import "./themes/index.css";
```

- [ ] **Step 4: Verify no visual regression (default = Sequoia unchanged)**

Run: `cd src/web && bunx vite build`
Expected: build succeeds. (`themes/index.css` must exist — created empty first if needed; Task A3 fills it. For this task, create `src/web/src/themes/index.css` as an empty file so the import resolves.)

- [ ] **Step 5: Commit**

```bash
git add src/web/src/globals.css src/web/src/themes/index.css
git commit -m "feat(web): tokenize fonts + skin knobs; wire themes import"
```

## Task A2: Template registry

**Files:**
- Create: `src/web/src/themes/registry.ts`
- Test: `tests/web/theme-registry.test.ts`

**Interfaces:**
- Produces:
  - `type TemplateId = 'sequoia' | 'nebula' | 'atelier' | 'halo' | 'terminal'`
  - `interface TemplateMeta { id: TemplateId; label: string; description: string; swatch: [string, string, string] }`
  - `const TEMPLATES: TemplateMeta[]` (sequoia first)
  - `const DEFAULT_TEMPLATE: TemplateId = 'sequoia'`
  - `function isTemplateId(x: string): x is TemplateId`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { TEMPLATES, DEFAULT_TEMPLATE, isTemplateId } from '../../src/web/src/themes/registry'

describe('template registry', () => {
  it('has 5 templates with sequoia first and default', () => {
    expect(TEMPLATES.map(t => t.id)).toEqual(['sequoia', 'nebula', 'atelier', 'halo', 'terminal'])
    expect(DEFAULT_TEMPLATE).toBe('sequoia')
  })
  it('every template has a label, description and 3 swatch colors', () => {
    for (const t of TEMPLATES) {
      expect(t.label.length).toBeGreaterThan(0)
      expect(t.description.length).toBeGreaterThan(0)
      expect(t.swatch).toHaveLength(3)
    }
  })
  it('validates ids', () => {
    expect(isTemplateId('nebula')).toBe(true)
    expect(isTemplateId('bogus')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/web/theme-registry.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `registry.ts`**

```ts
export type TemplateId = 'sequoia' | 'nebula' | 'atelier' | 'halo' | 'terminal'

export interface TemplateMeta {
  id: TemplateId
  label: string
  description: string
  /** three representative colors for the selector swatch */
  swatch: [string, string, string]
}

export const DEFAULT_TEMPLATE: TemplateId = 'sequoia'

export const TEMPLATES: TemplateMeta[] = [
  { id: 'sequoia',  label: 'Sequoia',  description: 'macOS vibrancy — the original EYAS look', swatch: ['#0a0a14', '#5b6cff', '#ffffff'] },
  { id: 'nebula',   label: 'Nebula',   description: 'Cosmic dark, aurora glow, glass panels',   swatch: ['#06070d', '#7c5cff', '#22d3ee'] },
  { id: 'atelier',  label: 'Atelier',  description: 'Light editorial luxe, serif display',       swatch: ['#f7f2e9', '#c8281c', '#14100a'] },
  { id: 'halo',     label: 'Halo',     description: 'Spatial depth, floating frosted panels',     swatch: ['#111721', '#5ad7e6', '#6ea6fe'] },
  { id: 'terminal', label: 'Terminal', description: 'Neo-brutalist dev tool, monospace',          swatch: ['#f0ede4', '#16150f', '#e5231b'] },
]

const IDS = new Set<string>(TEMPLATES.map(t => t.id))
export function isTemplateId(x: string): x is TemplateId {
  return IDS.has(x)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest run tests/web/theme-registry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/web/src/themes/registry.ts tests/web/theme-registry.test.ts
git commit -m "feat(web): template registry (5 skins)"
```

## Task A3: Theme token packs (nebula, atelier, halo, terminal)

**Files:**
- Create: `src/web/src/themes/{nebula,atelier,halo,terminal}.css`
- Modify: `src/web/src/themes/index.css` (import the four)

**Token contract (each non-default template).** Redefine, for BOTH a light block
`:root[data-template="<id>"]` and a dark block `:root[data-template="<id>"].dark`,
the token set the app already consumes plus the new knobs from A1:
`--background --foreground --card --card-foreground --popover --popover-foreground
--primary --primary-foreground --secondary --secondary-foreground --muted
--muted-foreground --accent --accent-foreground --destructive --border --input
--ring --radius --vibrancy-bg --vibrancy-border --card-glass --card-shadow
--nav-active-bg --nav-active-color --nav-active-glow --gradient-bg
--font-sans --font-display --font-mono --border-width --shadow-offset`.
(Shadcn color tokens are `H S% L%` triples used as `hsl(var(--x))`.)

**Source of truth:** the verified mockups already contain each palette. Extract from:
`scratchpad/eyas-design-{nebula,atelier,halo,terminal}.html` (their `:root`/theme blocks).
Anchor values to map into the tokens:

- **nebula** (dark-first): bg `#06070d`→`230 40% 4%`; ink `#f0f1fb`; primary/accent violet `#7c5cff`; secondary cyan `#22d3ee`; destructive/brand-spark red `#ff3b5c`; `--gradient-bg` = the aurora radial-mesh from the mockup; `--card-glass` frosted (`rgba(255,255,255,.04)`), `--radius: 0.75rem`, `--font-display: 'Futura','Avenir Next',var(--font-sans)`. Light block: a muted lavender-white variant.
- **atelier** (light-first): paper `#f7f2e9`→`43 43% 94%`; ink `#14100a`; accent red `#c8281c`; hairline borders `rgba(20,16,10,.16)`; `--radius: 0.375rem`; `--font-display: 'Baskerville','Didot','Georgia',serif`; `--gradient-bg` flat warm paper. Dark block: an "ink on charcoal paper" variant keeping the red accent.
- **halo** (dark spatial, per mockup `:root`): bg `#111721`; text `#f0f5fa`; primary teal/azure `#5ad7e6`/`#6ea6fe`; red spark `#ff453a`; heavy `--card-glass` translucency, large `--radius: 1.25rem`, ambient `--card-shadow` (multi-stop). Light block: the soft-light spatial variant.
- **terminal** (light-first): paper `#f0ede4`→`46 20% 92%`; ink `#16150f`; signal red `#e5231b`; `--radius: 0`; `--border-width: 2px`; `--shadow-offset: 4px 4px 0 hsl(var(--foreground))`; `--font-sans: var(--font-mono)` and `--font-mono: 'SF Mono','Menlo','Consolas',ui-monospace,monospace`. Dark block: green/amber phosphor on near-black.

- [ ] **Step 1: Write `terminal.css` (fully worked example)**

```css
:root[data-template="terminal"] {
  --background: 46 20% 92%;
  --foreground: 51 20% 8%;
  --card: 47 33% 96%;
  --card-foreground: 51 20% 8%;
  --popover: 47 33% 96%;
  --popover-foreground: 51 20% 8%;
  --primary: 3 82% 50%;              /* #e5231b eYssen red = signal/action */
  --primary-foreground: 0 0% 100%;
  --secondary: 46 15% 86%;
  --secondary-foreground: 51 20% 8%;
  --muted: 46 15% 86%;
  --muted-foreground: 48 8% 38%;
  --accent: 46 15% 86%;
  --accent-foreground: 51 20% 8%;
  --destructive: 3 82% 50%;
  --border: 51 20% 8%;               /* hard ink borders */
  --input: 51 20% 8%;
  --ring: 3 82% 50%;
  --radius: 0px;
  --border-width: 2px;
  --shadow-offset: 4px 4px 0 hsl(var(--foreground));
  --font-sans: 'SF Mono', 'Menlo', 'Consolas', ui-monospace, monospace;
  --font-display: var(--font-sans);
  --font-mono: var(--font-sans);
  --vibrancy-bg: #faf8f2;
  --vibrancy-border: rgba(22,21,15,.14);
  --card-glass: #faf8f2;
  --card-shadow: var(--shadow-offset);
  --nav-active-bg: rgba(229,35,27,.10);
  --nav-active-color: #e5231b;
  --nav-active-glow: transparent;
  --gradient-bg: #f0ede4;
}
:root[data-template="terminal"].dark {
  --background: 60 6% 6%;
  --foreground: 80 60% 82%;          /* phosphor green-ish ink */
  --card: 60 6% 9%;
  --card-foreground: 80 60% 82%;
  --popover: 60 6% 9%;
  --popover-foreground: 80 60% 82%;
  --primary: 3 90% 58%;
  --primary-foreground: 0 0% 100%;
  --secondary: 60 6% 14%;
  --secondary-foreground: 80 60% 82%;
  --muted: 60 6% 14%;
  --muted-foreground: 70 15% 55%;
  --accent: 60 6% 14%;
  --accent-foreground: 80 60% 82%;
  --destructive: 3 90% 58%;
  --border: 80 20% 30%;
  --input: 80 20% 30%;
  --ring: 3 90% 58%;
  --radius: 0px;
  --border-width: 2px;
  --shadow-offset: 4px 4px 0 hsl(var(--border));
  --font-sans: 'SF Mono', 'Menlo', 'Consolas', ui-monospace, monospace;
  --font-display: var(--font-sans);
  --font-mono: var(--font-sans);
  --vibrancy-bg: rgba(12,12,10,.85);
  --vibrancy-border: rgba(180,200,120,.18);
  --card-glass: #0f0f0c;
  --card-shadow: var(--shadow-offset);
  --nav-active-bg: rgba(229,35,27,.16);
  --nav-active-color: #ff5c4d;
  --nav-active-glow: transparent;
  --gradient-bg: #0a0a08;
}
```

- [ ] **Step 2: Write `nebula.css`, `atelier.css`, `halo.css`**

Follow the same two-block structure and the full token contract above, taking
values from each mockup's palette (anchors listed above). Keep the shadcn tokens
as `H S% L%` triples. Each must define ALL tokens in the contract (no partial packs).

- [ ] **Step 3: Fill `themes/index.css`**

```css
@import "./nebula.css";
@import "./atelier.css";
@import "./halo.css";
@import "./terminal.css";
```

- [ ] **Step 4: Verify each template applies app-wide, both modes**

Run: `cd src/web && bunx vite build` (must succeed).
Then a manual/Playwright check per template: set `document.documentElement.dataset.template` and toggle `.dark`; the whole board restyles. Expected: 5 templates × 2 modes render coherently, no contrast failures.

- [ ] **Step 5: Commit**

```bash
git add src/web/src/themes/
git commit -m "feat(web): nebula/atelier/halo/terminal token packs"
```

## Task A4: Template state in the theme store

**Files:**
- Modify: `src/web/src/stores/theme-store.ts`
- Modify: `src/web/src/app.tsx:18` (apply template on init)
- Test: `tests/web/theme-template.test.ts`

**Interfaces:**
- Consumes: `TEMPLATES`, `DEFAULT_TEMPLATE`, `isTemplateId`, `TemplateId` (Task A2).
- Produces:
  - pure `resolveInitialTemplate(stored: string | null): TemplateId`
  - `applyTemplate(id: TemplateId): void` (sets/removes `data-template`, persists `eyas-template`)
  - store additions: `template: TemplateId`, `setTemplate(id: TemplateId): void`

- [ ] **Step 1: Write the failing test** (pure helper — DOM-free)

```ts
import { describe, it, expect } from 'vitest'
import { resolveInitialTemplate } from '../../src/web/src/stores/theme-store'

describe('resolveInitialTemplate', () => {
  it('returns the stored template when valid', () => {
    expect(resolveInitialTemplate('terminal')).toBe('terminal')
  })
  it('falls back to sequoia for null or unknown', () => {
    expect(resolveInitialTemplate(null)).toBe('sequoia')
    expect(resolveInitialTemplate('bogus')).toBe('sequoia')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/web/theme-template.test.ts`
Expected: FAIL (`resolveInitialTemplate` not exported).

- [ ] **Step 3: Extend `theme-store.ts`**

```ts
import { create } from 'zustand'
import { DEFAULT_TEMPLATE, isTemplateId, type TemplateId } from '@/themes/registry'

type Theme = 'dark' | 'light'

interface ThemeState {
  theme: Theme
  template: TemplateId
  toggle: () => void
  set: (theme: Theme) => void
  setTemplate: (id: TemplateId) => void
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  localStorage.setItem('eyas-theme', theme)
}

export function resolveInitialTemplate(stored: string | null): TemplateId {
  return stored && isTemplateId(stored) ? stored : DEFAULT_TEMPLATE
}

export function applyTemplate(id: TemplateId) {
  // sequoia is the default look → no attribute; others set data-template
  if (id === DEFAULT_TEMPLATE) delete document.documentElement.dataset.template
  else document.documentElement.dataset.template = id
  localStorage.setItem('eyas-template', id)
}

const storedTheme = localStorage.getItem('eyas-theme') as Theme | null
const initialTheme: Theme = storedTheme || 'dark'
const initialTemplate = resolveInitialTemplate(localStorage.getItem('eyas-template'))

export const useThemeStore = create<ThemeState>((set) => ({
  theme: initialTheme,
  template: initialTemplate,
  toggle: () =>
    set((state) => {
      const next = state.theme === 'dark' ? 'light' : 'dark'
      applyTheme(next)
      return { theme: next }
    }),
  set: (theme: Theme) => {
    applyTheme(theme)
    set({ theme })
  },
  setTemplate: (id: TemplateId) => {
    applyTemplate(id)
    set({ template: id })
  },
}))
```

- [ ] **Step 4: Apply template on init in `app.tsx`**

At `src/web/src/app.tsx:18` there is `document.documentElement.classList.toggle('dark', theme === 'dark')`. Add, right after it, the template application on mount:

```ts
    document.documentElement.classList.toggle('dark', theme === 'dark')
    const t = useThemeStore.getState().template
    if (t !== 'sequoia') document.documentElement.dataset.template = t
    else delete document.documentElement.dataset.template
```

- [ ] **Step 5: Run test + typecheck**

Run: `bun vitest run tests/web/theme-template.test.ts`
Expected: PASS.
Run: `cd src/web && bunx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/web/src/stores/theme-store.ts src/web/src/app.tsx tests/web/theme-template.test.ts
git commit -m "feat(web): template state + persistence in theme store"
```

## Task A5: Template selector in the top bar

**Files:**
- Create: `src/web/src/components/layout/template-selector.tsx`
- Modify: `src/web/src/components/layout/top-bar.tsx:31-36` (add before `<ThemeToggle />`)

**Interfaces:**
- Consumes: `TEMPLATES` (A2), `useThemeStore().template` + `setTemplate` (A4). Reuses existing UI primitives from `@/components/ui/*` (a popover/dropdown already in the codebase; if none, a simple button + absolutely-positioned menu).

- [ ] **Step 1: Implement `template-selector.tsx`**

```tsx
import { useState } from 'react'
import { Palette, Check } from 'lucide-react'
import { useThemeStore } from '@/stores/theme-store'
import { TEMPLATES } from '@/themes/registry'

export function TemplateSelector() {
  const { template, setTemplate } = useThemeStore()
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        aria-label="Choose template"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-accent transition-colors text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring outline-none"
      >
        <Palette className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-64 z-50 glass-card p-1.5" role="menu">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                role="menuitemradio"
                aria-checked={template === t.id}
                onClick={() => { setTemplate(t.id); setOpen(false) }}
                className="w-full flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent transition-colors text-left"
              >
                <span className="flex -space-x-1">
                  {t.swatch.map((c, i) => (
                    <span key={i} className="h-3.5 w-3.5 rounded-full border border-border" style={{ background: c }} />
                  ))}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-foreground">{t.label}</span>
                  <span className="block text-[11px] text-muted-foreground truncate">{t.description}</span>
                </span>
                {template === t.id && <Check className="h-4 w-4 text-primary flex-shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire into the top bar** (`top-bar.tsx`, right cluster)

```tsx
import { TemplateSelector } from './template-selector'
// …
      <div className="flex items-center gap-2">
        <TemplateSelector />
        <ThemeToggle />
        <NotificationBell />
        <UserMenu />
      </div>
```

- [ ] **Step 3: Verify (typecheck + visual)**

Run: `cd src/web && bunx tsc --noEmit -p tsconfig.json` (exit 0).
Visual: dev server, click the palette icon, switch templates — the whole app restyles live; light/dark still works within each.

- [ ] **Step 4: Commit**

```bash
git add src/web/src/components/layout/template-selector.tsx src/web/src/components/layout/top-bar.tsx
git commit -m "feat(web): template selector in top bar"
```

---

# PHASE B — Status Bar module

Independently shippable: adds an always-present bottom status bar. Works with any template (Phase A) and with the current default alone.

## Task B1: `statusbar` backend module

**Files:**
- Create: `src/modules/statusbar/index.ts`, `src/modules/statusbar/segments.ts`, `src/modules/statusbar/routes.ts`
- Modify: `src/core/bootstrap.ts` (import + register near `boardModule`, ~line 143)
- Test: `tests/modules/statusbar/routes.test.ts`

**Interfaces:**
- Produces:
  - `segments.ts`: `interface StatusbarSnapshot { tasks: { open: number; overdue: number; running: number }; agents: { running: number }; version: string; env: string }`; `function buildSnapshot(db: EyasDb, config: EyasConfig): StatusbarSnapshot`
  - `routes.ts`: `createStatusbarRoutes(app: Hono, db: EyasDb, config: EyasConfig): void` → `GET /api/v1/statusbar` returns `{ snapshot: StatusbarSnapshot }`
  - `index.ts`: `statusbarModule: EyasModule` (id `statusbar`)

- [ ] **Step 1: Write the failing test** (mirror `tests/modules/setup/routes.test.ts` DB pattern)

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createTestDb } from '../../helpers/test-db'
import { createStatusbarRoutes } from '@modules/statusbar/routes'

const testDb = createTestDb('statusbar')
let db: ReturnType<typeof testDb.open>
let app: Hono

beforeEach(() => {
  db = testDb.open()
  const now = new Date().toISOString()
  const past = new Date(Date.now() - 86400000).toISOString()
  // two open conversations, one overdue, one running; one running agent session
  db.run(sql`INSERT INTO conversations (id, title, status, user_id, due_date, created_at, updated_at) VALUES
    ('c1','A','idle','u1',${past},${now},${now}),
    ('c2','B','running','u1',NULL,${now},${now})`)
  db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at) VALUES
    ('s1','c2','ag1','running',${now})`)
  app = new Hono()
  app.onError(errorHandler)
  createStatusbarRoutes(app, db as any, { server: { port: 3000 } } as any)
})
afterEach(() => testDb.cleanup())

describe('GET /api/v1/statusbar', () => {
  it('returns a snapshot with task and agent counts', async () => {
    const res = await app.request('/api/v1/statusbar')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.snapshot.tasks.open).toBe(2)
    expect(body.snapshot.tasks.overdue).toBe(1)
    expect(body.snapshot.tasks.running).toBe(1)
    expect(body.snapshot.agents.running).toBe(1)
    expect(typeof body.snapshot.version).toBe('string')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/statusbar/routes.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `segments.ts`**

```ts
import { sql } from 'drizzle-orm'
import type { EyasConfig, EyasDb } from '@core/types'

export interface StatusbarSnapshot {
  tasks: { open: number; overdue: number; running: number }
  agents: { running: number }
  version: string
  env: string
}

function count(db: EyasDb, query: unknown): number {
  const rows = db.all(query) as Array<{ n: number }>
  return rows[0]?.n ?? 0
}

// v1 segment providers. Extend by adding fields here + a frontend segment.
export function buildSnapshot(db: EyasDb, config: EyasConfig): StatusbarSnapshot {
  const nowIso = new Date().toISOString()
  const open = count(db, sql`SELECT COUNT(*) AS n FROM conversations WHERE status != 'done'`)
  const overdue = count(db, sql`SELECT COUNT(*) AS n FROM conversations WHERE status != 'done' AND due_date IS NOT NULL AND due_date < ${nowIso}`)
  const running = count(db, sql`SELECT COUNT(*) AS n FROM conversations WHERE status = 'running'`)
  const agentsRunning = count(db, sql`SELECT COUNT(*) AS n FROM agent_sessions WHERE status = 'running'`)
  return {
    tasks: { open, overdue, running },
    agents: { running: agentsRunning },
    version: process.env.npm_package_version ?? '1.0.0',
    env: process.env.NODE_ENV ?? 'development',
  }
}
```

- [ ] **Step 4: Implement `routes.ts`**

```ts
import type { Hono } from 'hono'
import type { EyasConfig, EyasDb } from '@core/types'
import { buildSnapshot } from './segments.js'

export function createStatusbarRoutes(app: Hono, db: EyasDb, config: EyasConfig): void {
  app.get('/api/v1/statusbar', (c) => {
    return c.json({ snapshot: buildSnapshot(db, config) })
  })
}
```

- [ ] **Step 5: Implement `index.ts`**

```ts
import type { EyasModule, ModuleContext } from '@core/types'
import { createStatusbarRoutes } from './routes.js'

export const statusbarModule: EyasModule = {
  id: 'statusbar',
  name: 'Status Bar',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Bottom status bar segments (task/agent/sync/version)',
  dependencies: [],
  async onStart(ctx: ModuleContext) {
    createStatusbarRoutes(ctx.http, ctx.db, ctx.config)
    ctx.logger.info('Status bar module registered')
  },
}
```

- [ ] **Step 6: Register in `bootstrap.ts`** (import at top with the other modules; register near `boardModule` ~line 143)

```ts
import { statusbarModule } from '@modules/statusbar/index'
// … near boardModule registration:
  if (!moduleLoader.hasModule(statusbarModule.id)) {
    moduleLoader.register(statusbarModule)
  }
```

- [ ] **Step 7: Run test + typecheck**

Run: `bun vitest run tests/modules/statusbar/routes.test.ts` → PASS.
Run: `bun run lint` → exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/modules/statusbar/ src/core/bootstrap.ts tests/modules/statusbar/routes.test.ts
git commit -m "feat(statusbar): backend module + snapshot endpoint"
```

## Task B2: Status bar frontend (shell element)

**Files:**
- Create: `src/web/src/components/layout/status-bar.tsx`
- Modify: `src/web/src/components/layout/app-layout.tsx` (add the row after the main flex row)

**Interfaces:**
- Consumes: `GET /api/v1/statusbar` (B1) via `api.get`; `useThemeStore` (mode); the router `useLocation` for the context segment. Reuses `use-websocket.ts` for a light refresh trigger.

- [ ] **Step 1: Implement `status-bar.tsx`** (token-styled, appears in every template)

```tsx
import { useEffect, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { api } from '@/lib/api'

interface Snapshot {
  tasks: { open: number; overdue: number; running: number }
  agents: { running: number }
  version: string
  env: string
}

function useClock() {
  const [t, setT] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return t.toLocaleTimeString(undefined, { hour12: false })
}

export function StatusBar() {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [online, setOnline] = useState(true)
  const clock = useClock()
  const path = useRouterState({ select: (s) => s.location.pathname })

  const refresh = () =>
    api.get<{ snapshot: Snapshot }>('/statusbar')
      .then((d) => { setSnap(d.snapshot); setOnline(true) })
      .catch(() => setOnline(false))

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 15000)
    return () => clearInterval(id)
  }, [])

  const view = path.replace(/^\//, '').split('/')[0] || 'dashboard'

  return (
    <footer className="h-[26px] vibrancy border-t border-[var(--vibrancy-border)] flex items-center gap-4 px-3 text-[11px] text-muted-foreground flex-shrink-0 select-none"
            style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
      <span className="uppercase tracking-wide text-foreground">{view}</span>
      {snap && (
        <span className="flex items-center gap-3">
          <span>{snap.tasks.open} tasks</span>
          <span className={snap.tasks.overdue ? 'text-[hsl(var(--destructive))]' : ''}>{snap.tasks.overdue} overdue</span>
          <span>{snap.tasks.running} running</span>
        </span>
      )}
      <span className="ml-auto flex items-center gap-4">
        {snap && <span>{snap.agents.running} agents</span>}
        <span className={online ? 'text-[hsl(var(--nav-active-color))]' : 'text-[hsl(var(--destructive))]'}>
          {online ? 'SYNCED' : 'OFFLINE'}
        </span>
        {snap && <span>EYAS v{snap.version}</span>}
        <span>{clock}</span>
      </span>
    </footer>
  )
}
```

- [ ] **Step 2: Mount it in `app-layout.tsx`**

```tsx
import { StatusBar } from './status-bar'
// …
export function AppLayout({ children, noPadding }: AppLayoutProps) {
  return (
    <div className="flex h-screen flex-col">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className={`flex-1 overflow-auto${noPadding ? '' : ' p-6'}`}>{children}</main>
      </div>
      <StatusBar />
      <SearchBar />
    </div>
  )
}
```

- [ ] **Step 3: Verify (typecheck + visual across templates)**

Run: `cd src/web && bunx tsc --noEmit -p tsconfig.json` (exit 0).
Visual: the bar shows on every page, styled per active template (mono numerics, tabular alignment); counts populate from the endpoint; clock ticks; switching templates restyles it.

- [ ] **Step 4: Commit**

```bash
git add src/web/src/components/layout/status-bar.tsx src/web/src/components/layout/app-layout.tsx
git commit -m "feat(web): core status bar shell element"
```

---

## Self-review notes (author)

- **Spec coverage:** template dir + registry (A2/A3), data-template mechanism (A1/A4), selector before theme toggle (A5), sequoia=default via no-attribute (A4 `applyTemplate`), both light+dark per template (A3), statusbar as its own module (B1) with extensible segments (B1 `segments.ts` + B2 registry-style composition), all 4 v1 segments (B1/B2), appears in every template via token-styled shell (B2). Covered.
- **Placeholder scan:** CSS token values for nebula/atelier/halo are specified by contract + anchors + mockup source rather than full hex dumps — deliberate (the mockups are the verified palette source); terminal.css is fully worked as the pattern. No "TODO/handle edge cases" placeholders in logic tasks.
- **Type consistency:** `TemplateId`, `TemplateMeta`, `TEMPLATES`, `DEFAULT_TEMPLATE`, `isTemplateId`, `resolveInitialTemplate`, `applyTemplate`, `setTemplate`, `StatusbarSnapshot`, `buildSnapshot`, `createStatusbarRoutes` used consistently across tasks.
- **Note:** DB column assumptions (`conversations.status/due_date`, `agent_sessions.status`) match `tests/helpers/test-db.ts` schema; if production column semantics differ (e.g. a `done` stage vs `status`), adjust the SQL in B1 Step 3 to the real closed-state definition during implementation.
