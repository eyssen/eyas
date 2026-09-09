# Home Widget Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed dashboard at `/` with a per-user, drag-and-drop widget grid that ships with a factory default layout and revives the dead `WidgetRegistration` extension point.

**Architecture:** A new small core module (`home`) owns layout persistence, the widget catalogue, and two aggregate endpoints. Modules *declare* widgets in their manifest; the frontend `widget-registry.ts` *implements* them; a contract test forbids one-sided wiring. Every tile computes from a live module endpoint — nothing is a hand-maintained snapshot.

**Tech Stack:** Bun, TypeScript (strict, ESM), Hono, Drizzle/bun:sqlite, Zod, React 19, TanStack Router, Zustand, Vitest, `react-grid-layout@2.2.4`.

**Spec:** `docs/superpowers/specs/2026-08-25-home-widget-grid-design.md`

## Global Constraints

- **Component tests (`.tsx`) MUST open with `// @vitest-environment jsdom` as line 1.** `vitest.config.ts:12`
  keeps the default environment at `node`; `.tsx` files opt into a DOM per file. Without the docblock they
  fail with `document is not defined`, which reads like a broken component rather than a missing directive.
  Copy the convention from `tests/web/scheduler-page.test.tsx:1`. `jsdom`, `@testing-library/react` and
  `@testing-library/user-event` are already installed — nothing to add.

- **Never commit automatically.** Every task ends with a commit *step*, but the commit is executed **only on the owner's explicit request**. Prepare the change, run the tests, report — then wait.
- **Never create a branch, never push.** Work on the current branch (`main`).
- **Licence:** MIT-compatible only (MIT, BSD-2, BSD-3, ISC, Apache-2.0). GPL/LGPL/AGPL/SSPL/CC-BY-SA forbidden. The one new dependency, `react-grid-layout@2.2.4`, is MIT with six MIT transitives — already verified, no further additions.
- **i18n is not optional:** every user-facing string ships in **all six** languages — `en`, `hu`, `de`, `es`, `fr`, `tlh` — in the module's `locales/`. `tests/contracts/web-i18n-parity.contract.test.ts` fails the build otherwise. Never hardcode UI text.
- **English code and comments.** Hungarian only where a business-logic comment genuinely helps.
- **File header** on every new source file: `// Part of eYssen. See LICENSE file for full copyright and licensing details.`
- **API prefix:** `/api/v1/` for all endpoints. **CASL check** (`requirePermission`) on every protected endpoint.
- **No `console.log`** — use the module logger. **Zod** for all external input.
- **CSS variables only**, never hardcoded colours.
- Test command: `bun vitest run <path>`. Typecheck: `bun run lint` (`tsc --noEmit`).

---

### Task 1: Widget contract types + `ctx.listModules()`

The catalogue endpoint (Task 4) must enumerate every registered module's manifest. `ModuleContext` today exposes only `hasModule`/`getModule` (`src/core/types.ts:195-196`) — there is no way to list. This task adds it and reshapes the dead `WidgetRegistration`.

**Files:**
- Modify: `src/core/types.ts:195-196` (add `listModules`), `src/core/types.ts:245-247` (`WidgetRegistration`)
- Modify: `src/core/module-loader.ts` (add `buildModuleList` + `ModuleListing`)
- Modify: `src/core/bootstrap.ts` (supply `listModules` when building the context)
- Test: `tests/core/module-context-list.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `WidgetRegistration { id: string; titleKey: string; capability?: string }`; `ModuleListing { id: string; frontend?: FrontendManifest }`; `buildModuleList(loader, disabled): ModuleListing[]`; `ModuleContext.listModules(): ModuleListing[]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/module-context-list.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { ModuleLoader, buildModuleList } from '@core/module-loader'
import type { EyasModule } from '@core/types'

function stubModule(id: string, widgets?: { id: string; titleKey: string }[]): EyasModule {
  return {
    id, name: id, version: '1.0.0', type: 'core', description: id,
    dependencies: [],
    frontend: widgets ? { widgets } : undefined,
    async onRegister() {}, async onStart() {}, async onStop() {},
  }
}

describe('buildModuleList — the projection ctx.listModules() serves', () => {
  it('returns id + frontend manifest only, dropping lifecycle hooks', () => {
    const loader = new ModuleLoader()
    loader.register(stubModule('scheduler', [{ id: 'scheduler.upcoming', titleKey: 'home.widget.schedule.title' }]))
    loader.register(stubModule('audit'))

    const listed = buildModuleList(loader, [])

    expect(listed.map((m) => m.id).sort()).toEqual(['audit', 'scheduler'])
    expect(listed.find((m) => m.id === 'scheduler')?.frontend?.widgets?.[0].titleKey)
      .toBe('home.widget.schedule.title')
    // The projection must not leak callable module internals to the catalogue.
    expect(listed[0]).not.toHaveProperty('onStart')
  })

  it('omits disabled modules so their widgets cannot be offered', () => {
    const loader = new ModuleLoader()
    loader.register(stubModule('scheduler', [{ id: 'scheduler.upcoming', titleKey: 'k' }]))
    expect(buildModuleList(loader, ['scheduler'])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/core/module-context-list.test.ts`
Expected: FAIL at import — `buildModuleList` is not exported from `@core/module-loader`. (This is why the test targets a new function rather than the existing `getActiveModules`: a test that only breaks the typecheck would still pass under Vitest's transpile-only pipeline, and would not be a real red step.)

- [ ] **Step 3: Reshape the type and add the projection**

```ts
// src/core/types.ts — replace lines 245-247
export interface WidgetRegistration {
  /** '<module>.<widget>', e.g. 'scheduler.upcoming'. Matches the frontend registry key. */
  id: string
  /** i18n key — NOT a display string. The drawer renders it, so it must be translatable. */
  titleKey: string
  /** CASL subject gate; omitted means the module's own gate is enough. */
  capability?: string
}
```

```ts
// src/core/types.ts — inside ModuleContext, after getModule (line 196)
  /** Every registered, non-disabled module. Used by `home` to build the widget catalogue. */
  listModules(): import('./module-loader.js').ModuleListing[]
```

```ts
// src/core/module-loader.ts — new export beside the ModuleLoader class
import type { EyasModule, FrontendManifest } from './types.js'

export interface ModuleListing {
  id: string
  frontend?: FrontendManifest
}

/**
 * Projection served by ctx.listModules(): id + frontend manifest only. The
 * widget catalogue must not receive callable module internals, and disabled
 * modules must not be offerable at all.
 */
export function buildModuleList(loader: ModuleLoader, disabled: string[]): ModuleListing[] {
  return loader.getActiveModules(disabled).map((m: EyasModule) => ({ id: m.id, frontend: m.frontend }))
}
```

```ts
// src/core/bootstrap.ts — where the ModuleContext object literal is built,
// alongside the existing hasModule/getModule entries:
    listModules: () => buildModuleList(moduleLoader, disabledModules),
```

- [ ] **Step 4: Run test and typecheck**

Run: `bun vitest run tests/core/module-context-list.test.ts && bun run lint`
Expected: PASS, and `tsc --noEmit` clean — no module populates `widgets` yet, so nothing else references the old shape.

- [ ] **Step 5: Commit (owner request only)**

```bash
git add src/core/types.ts src/core/module-loader.ts src/core/bootstrap.ts tests/core/module-context-list.test.ts
git commit -m "feat(core): reshape WidgetRegistration for i18n and add ctx.listModules()"
```

---

### Task 2: `home` module skeleton + layout persistence

**Files:**
- Create: `src/modules/home/index.ts`, `src/modules/home/schema.ts`, `src/modules/home/routes.ts`, `src/modules/home/layout-service.ts`
- Modify: `src/core/bootstrap.ts` (register the module)
- Test: `tests/modules/home/layout-service.test.ts`

**Interfaces:**
- Consumes: `ModuleContext` from Task 1.
- Produces: `createLayoutService(db)` with `get(userId, breakpoint)`, `save(userId, breakpoint, items)`, `reset(userId, breakpoint)`; `LayoutItem = { i: string; x: number; y: number; w: number; h: number; config?: Record<string, unknown> }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/home/layout-service.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb } from '../../helpers/test-db'   // existing helper used across module tests
import { createHomeTables } from '@modules/home/schema'
import { createLayoutService } from '@modules/home/layout-service'

let db: ReturnType<typeof createTestDb>
let service: ReturnType<typeof createLayoutService>

beforeEach(() => {
  db = createTestDb()
  createHomeTables(db)
  service = createLayoutService(db)
})

describe('layout persistence', () => {
  it('returns null when the user has never customised (factory default applies)', () => {
    expect(service.get('user-1', 'lg')).toBeNull()
  })

  it('round-trips items including per-widget config', () => {
    service.save('user-1', 'lg', [
      { i: 'board.summary#1', x: 0, y: 0, w: 4, h: 3, config: { projectId: 'proj-7' } },
    ])
    const row = service.get('user-1', 'lg')
    expect(row?.items[0].config).toEqual({ projectId: 'proj-7' })
    expect(row?.baseVersion).toBe(0)
  })

  it('keeps breakpoints independent', () => {
    service.save('user-1', 'lg', [{ i: 'cost.summary#1', x: 0, y: 0, w: 3, h: 2 }])
    expect(service.get('user-1', 'md')).toBeNull()
  })

  it('reset deletes the row so the user follows the factory default again', () => {
    service.save('user-1', 'lg', [{ i: 'cost.summary#1', x: 0, y: 0, w: 3, h: 2 }])
    service.reset('user-1', 'lg')
    expect(service.get('user-1', 'lg')).toBeNull()
  })

  it('does not leak one user layout into another', () => {
    service.save('user-1', 'lg', [{ i: 'cost.summary#1', x: 0, y: 0, w: 3, h: 2 }])
    expect(service.get('user-2', 'lg')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/home/layout-service.test.ts`
Expected: FAIL — cannot resolve `@modules/home/schema`.

- [ ] **Step 3: Implement schema and service**

```ts
// src/modules/home/schema.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

/**
 * A row exists ONLY once a user customises their home page. No row means the
 * factory default applies — which is what lets a later release add a tile that
 * reaches every un-customised user automatically (spec D1).
 */
export function createHomeTables(db: EyasDb) {
  db.run(sql`CREATE TABLE IF NOT EXISTS home_layouts (
    user_id      TEXT NOT NULL,
    breakpoint   TEXT NOT NULL DEFAULT 'lg',
    items        TEXT NOT NULL,
    base_version INTEGER NOT NULL DEFAULT 0,
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, breakpoint)
  )`)
}
```

```ts
// src/modules/home/layout-service.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export interface LayoutItem {
  i: string
  x: number
  y: number
  w: number
  h: number
  config?: Record<string, unknown>
}

export interface StoredLayout {
  items: LayoutItem[]
  baseVersion: number
}

export function createLayoutService(db: EyasDb) {
  return {
    get(userId: string, breakpoint: string): StoredLayout | null {
      const row = db
        .all(sql`SELECT items, base_version FROM home_layouts
                 WHERE user_id = ${userId} AND breakpoint = ${breakpoint}`)[0] as
        { items: string; base_version: number } | undefined
      if (!row) return null
      return { items: JSON.parse(row.items) as LayoutItem[], baseVersion: row.base_version }
    },

    save(userId: string, breakpoint: string, items: LayoutItem[], baseVersion = 0): void {
      db.run(sql`INSERT INTO home_layouts (user_id, breakpoint, items, base_version, updated_at)
                 VALUES (${userId}, ${breakpoint}, ${JSON.stringify(items)}, ${baseVersion}, datetime('now'))
                 ON CONFLICT(user_id, breakpoint) DO UPDATE SET
                   items = excluded.items,
                   base_version = excluded.base_version,
                   updated_at = datetime('now')`)
    },

    reset(userId: string, breakpoint: string): void {
      db.run(sql`DELETE FROM home_layouts WHERE user_id = ${userId} AND breakpoint = ${breakpoint}`)
    },
  }
}
```

```ts
// src/modules/home/index.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import type { EyasModule, ModuleContext } from '@core/types'
import { createHomeTables } from './schema.js'
import { createLayoutService } from './layout-service.js'
import { createHomeRoutes } from './routes.js'

export const homeModule: EyasModule = {
  id: 'home',
  name: 'Home',
  version: '1.0.0',
  type: 'core',
  required: true,
  description: 'Customisable home page — widget catalogue, per-user layout, pulse and setup aggregates.',
  dependencies: ['permissions'],
  capabilities: ['widget-grid'],

  async onRegister(ctx: ModuleContext) {
    createHomeTables(ctx.db)
    const layouts = createLayoutService(ctx.db)
    createHomeRoutes(ctx.http, { layouts, listModules: ctx.listModules, logger: ctx.logger })
  },
  async onStart() {},
  async onStop() {},
}
```

Register it in `src/core/bootstrap.ts` next to the other core modules, following the existing pattern exactly:

```ts
  if (!moduleLoader.hasModule(homeModule.id)) {
    moduleLoader.register(homeModule)
  }
```

`routes.ts` is created in Task 3; for this step it may export `createHomeRoutes` as an empty Hono mount so the module compiles.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest run tests/modules/home/layout-service.test.ts && bun run lint`
Expected: PASS (5 tests), typecheck clean.

- [ ] **Step 5: Commit (owner request only)**

```bash
git add src/modules/home tests/modules/home src/core/bootstrap.ts
git commit -m "feat(home): module skeleton with per-user layout persistence"
```

---

### Task 3: Factory layout, validation, and the new-widget offer

Implements spec D1 (no row = factory), D2 (offer, never auto-insert), D3 (`config`), D4 (unknown widgets retained).

**Files:**
- Create: `src/modules/home/default-layout.ts`, `src/modules/home/layout-schema.ts`
- Modify: `src/modules/home/routes.ts`
- Test: `tests/modules/home/layout-routes.test.ts`

**Interfaces:**
- Consumes: `createLayoutService` (Task 2).
- Produces: `DEFAULT_LAYOUT: LayoutItem[]`, `DEFAULT_LAYOUT_VERSION: number`, `layoutItemsSchema` (Zod); endpoints `GET /api/v1/home/layout`, `PUT /api/v1/home/layout`, `DELETE /api/v1/home/layout`, `POST /api/v1/home/layout/ack-version`.
- `GET` response shape: `{ items: LayoutItem[]; source: 'factory' | 'custom'; newWidgets: string[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/home/layout-routes.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createTestDb } from '../../helpers/test-db'
import { createHomeTables } from '@modules/home/schema'
import { createLayoutService } from '@modules/home/layout-service'
import { createHomeRoutes } from '@modules/home/routes'
import { DEFAULT_LAYOUT, DEFAULT_LAYOUT_VERSION } from '@modules/home/default-layout'

let app: Hono
let layouts: ReturnType<typeof createLayoutService>

beforeEach(() => {
  const db = createTestDb()
  createHomeTables(db)
  layouts = createLayoutService(db)
  app = new Hono()
  app.use('*', async (c, next) => { c.set('userId', 'user-1'); await next() })
  createHomeRoutes(app, {
    layouts,
    listModules: () => [{ id: 'scheduler', frontend: { widgets: [{ id: 'scheduler.upcoming', titleKey: 'k' }] } }],
    logger: { info() {}, warn() {}, error() {}, debug() {} } as any,
  })
})

describe('GET /api/v1/home/layout', () => {
  it('serves the factory layout when the user has no row', async () => {
    const res = await app.request('/api/v1/home/layout?breakpoint=lg')
    const body = await res.json()
    expect(body.source).toBe('factory')
    expect(body.items).toEqual(DEFAULT_LAYOUT)
    expect(body.newWidgets).toEqual([])
  })

  it('offers newly shipped factory widgets to a customised user without inserting them', async () => {
    layouts.save('user-1', 'lg', [{ i: 'cost.summary#1', x: 0, y: 0, w: 3, h: 2 }], DEFAULT_LAYOUT_VERSION - 1)
    const res = await app.request('/api/v1/home/layout?breakpoint=lg')
    const body = await res.json()
    expect(body.source).toBe('custom')
    expect(body.items).toHaveLength(1)                       // nothing was inserted
    expect(body.newWidgets.length).toBeGreaterThan(0)        // but the offer is present
  })
})

describe('PUT /api/v1/home/layout', () => {
  it('rejects an unknown widget id', async () => {
    const res = await app.request('/api/v1/home/layout', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ breakpoint: 'lg', items: [{ i: 'nope.fake#1', x: 0, y: 0, w: 3, h: 2 }] }),
    })
    expect(res.status).toBe(400)
    expect(layouts.get('user-1', 'lg')).toBeNull()
  })

  it('rejects out-of-range geometry', async () => {
    const res = await app.request('/api/v1/home/layout', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ breakpoint: 'lg', items: [{ i: 'scheduler.upcoming#1', x: 0, y: 0, w: 99, h: 2 }] }),
    })
    expect(res.status).toBe(400)
  })

  it('accepts a valid layout and stamps the current factory version', async () => {
    const res = await app.request('/api/v1/home/layout', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ breakpoint: 'lg', items: [{ i: 'scheduler.upcoming#1', x: 0, y: 0, w: 4, h: 3 }] }),
    })
    expect(res.status).toBe(200)
    expect(layouts.get('user-1', 'lg')?.baseVersion).toBe(DEFAULT_LAYOUT_VERSION)
  })
})

describe('DELETE /api/v1/home/layout', () => {
  it('restores the factory layout', async () => {
    layouts.save('user-1', 'lg', [{ i: 'cost.summary#1', x: 0, y: 0, w: 3, h: 2 }])
    await app.request('/api/v1/home/layout?breakpoint=lg', { method: 'DELETE' })
    const body = await (await app.request('/api/v1/home/layout?breakpoint=lg')).json()
    expect(body.source).toBe('factory')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/home/layout-routes.test.ts`
Expected: FAIL — `@modules/home/default-layout` does not exist.

- [ ] **Step 3: Implement the factory layout, Zod schema, and routes**

```ts
// src/modules/home/default-layout.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import type { LayoutItem } from './layout-service.js'

/**
 * Bump whenever a widget is ADDED to the factory layout. Customised users are
 * then offered the new tiles (spec D2); un-customised users get them for free
 * because they follow this constant directly (spec D1).
 */
export const DEFAULT_LAYOUT_VERSION = 1

/** 12-column grid, row height 40px. Nine tiles — see spec §4.1. */
export const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: 'home.pulse#1',           x: 0, y: 0,  w: 12, h: 2 },
  { i: 'security-gate.attention#1', x: 0, y: 2, w: 6, h: 5 },
  { i: 'mission-control.running#1', x: 6, y: 2, w: 6, h: 5 },
  { i: 'scheduler.upcoming#1',   x: 0, y: 7,  w: 4,  h: 5 },
  { i: 'conversations.recent#1', x: 4, y: 7,  w: 4,  h: 5 },
  { i: 'board.summary#1',        x: 8, y: 7,  w: 4,  h: 5 },
  { i: 'memory.briefing#1',      x: 0, y: 12, w: 5,  h: 5 },
  { i: 'costops.summary#1',      x: 5, y: 12, w: 3,  h: 5 },
  { i: 'observability.system#1', x: 8, y: 12, w: 4,  h: 5 },
]

/** Widget ids (without the `#n` instance suffix) present in the factory layout. */
export function factoryWidgetIds(): string[] {
  return DEFAULT_LAYOUT.map((item) => item.i.split('#')[0])
}
```

```ts
// src/modules/home/layout-schema.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { z } from 'zod'

/** `<module>.<widget>#<instance>` — the instance suffix lets one widget be placed twice (spec D3). */
const ITEM_KEY = /^[a-z0-9-]+\.[a-z0-9-]+#\d+$/

export const layoutItemSchema = z.object({
  i: z.string().regex(ITEM_KEY),
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0).max(200),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(20),
  config: z.record(z.string(), z.unknown()).optional(),
})

export const saveLayoutSchema = z.object({
  breakpoint: z.enum(['lg', 'md', 'sm']),
  items: z.array(layoutItemSchema).max(40),
})
```

```ts
// src/modules/home/routes.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { Hono } from 'hono'
import { requirePermission } from '@modules/permissions/middleware'
import type { Logger, FrontendManifest } from '@core/types'
import type { createLayoutService } from './layout-service.js'
import { saveLayoutSchema } from './layout-schema.js'
import { DEFAULT_LAYOUT, DEFAULT_LAYOUT_VERSION, factoryWidgetIds } from './default-layout.js'

export interface HomeServices {
  layouts: ReturnType<typeof createLayoutService>
  listModules: () => Array<{ id: string; frontend?: FrontendManifest }>
  logger: Logger
}

/** Widget ids any registered module declares — the only ids a layout may reference. */
function declaredWidgetIds(services: HomeServices): Set<string> {
  const ids = new Set<string>()
  for (const mod of services.listModules()) {
    for (const w of mod.frontend?.widgets ?? []) ids.add(w.id)
  }
  return ids
}

export function createHomeRoutes(app: Hono, services: HomeServices) {
  const api = new Hono()

  api.get('/home/layout', requirePermission('read', 'Home'), (c) => {
    const userId = c.get('userId') as string
    const breakpoint = c.req.query('breakpoint') ?? 'lg'
    const stored = services.layouts.get(userId, breakpoint)

    if (!stored) {
      return c.json({ items: DEFAULT_LAYOUT, source: 'factory', newWidgets: [] })
    }

    // Spec D2: offer, never insert. Spec D4: unknown ids stay in storage but are
    // not returned, so re-enabling a module restores position and config.
    const declared = declaredWidgetIds(services)
    const rendered = stored.items.filter((item) => declared.has(item.i.split('#')[0]))
    const present = new Set(rendered.map((item) => item.i.split('#')[0]))
    const newWidgets =
      stored.baseVersion < DEFAULT_LAYOUT_VERSION
        ? factoryWidgetIds().filter((id) => !present.has(id) && declared.has(id))
        : []

    return c.json({ items: rendered, source: 'custom', newWidgets })
  })

  api.put('/home/layout', requirePermission('update', 'Home'), async (c) => {
    const userId = c.get('userId') as string
    const parsed = saveLayoutSchema.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: 'invalid_layout', details: parsed.error.issues }, 400)

    const declared = declaredWidgetIds(services)
    const unknown = parsed.data.items.filter((item) => !declared.has(item.i.split('#')[0]))
    if (unknown.length > 0) {
      return c.json({ error: 'unknown_widget', widgets: unknown.map((u) => u.i) }, 400)
    }

    services.layouts.save(userId, parsed.data.breakpoint, parsed.data.items, DEFAULT_LAYOUT_VERSION)
    return c.json({ ok: true })
  })

  api.delete('/home/layout', requirePermission('update', 'Home'), (c) => {
    const userId = c.get('userId') as string
    services.layouts.reset(userId, c.req.query('breakpoint') ?? 'lg')
    return c.json({ ok: true })
  })

  // "No thanks" on the offer bar: acknowledge the version without adding anything.
  api.post('/home/layout/ack-version', requirePermission('update', 'Home'), (c) => {
    const userId = c.get('userId') as string
    const breakpoint = c.req.query('breakpoint') ?? 'lg'
    const stored = services.layouts.get(userId, breakpoint)
    if (stored) services.layouts.save(userId, breakpoint, stored.items, DEFAULT_LAYOUT_VERSION)
    return c.json({ ok: true })
  })

  app.route('/api/v1', api)
}
```

Register the `Home` CASL subject wherever the other subjects are declared in `src/modules/permissions/`, granting the owner role `read`/`update`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest run tests/modules/home/ && bun run lint`
Expected: PASS (all layout-service and layout-routes tests).

- [ ] **Step 5: Commit (owner request only)**

```bash
git add src/modules/home tests/modules/home src/modules/permissions
git commit -m "feat(home): factory layout, Zod-validated persistence, new-widget offer"
```

---

### Task 4: Widget catalogue endpoint

**Files:**
- Create: `src/modules/home/catalogue.ts`
- Modify: `src/modules/home/routes.ts`
- Test: `tests/modules/home/catalogue.test.ts`

**Interfaces:**
- Consumes: `ctx.listModules()` (Task 1), `HomeServices` (Task 3).
- Produces: `GET /api/v1/home/widgets` → `{ widgets: Array<{ id, titleKey, module, available, reason?: 'module_disabled' | 'forbidden' }> }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/home/catalogue.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { buildCatalogue } from '@modules/home/catalogue'

const modules = [
  { id: 'scheduler', frontend: { widgets: [{ id: 'scheduler.upcoming', titleKey: 'home.widget.schedule.title' }] } },
  { id: 'costops',   frontend: { widgets: [{ id: 'costops.summary', titleKey: 'home.widget.cost.title', capability: 'Cost' }] } },
  { id: 'audit',     frontend: undefined },
]

describe('widget catalogue', () => {
  it('lists declared widgets with their owning module', () => {
    const { widgets } = buildCatalogue(modules, () => true)
    expect(widgets.map((w) => w.id).sort()).toEqual(['costops.summary', 'scheduler.upcoming'])
    expect(widgets.find((w) => w.id === 'costops.summary')?.module).toBe('costops')
  })

  it('marks a widget unavailable when CASL denies its capability, but still lists it', () => {
    const { widgets } = buildCatalogue(modules, (cap) => cap !== 'Cost')
    const cost = widgets.find((w) => w.id === 'costops.summary')
    expect(cost?.available).toBe(false)
    expect(cost?.reason).toBe('forbidden')
  })

  it('omits nothing for modules without widgets', () => {
    const { widgets } = buildCatalogue(modules, () => true)
    expect(widgets.some((w) => w.module === 'audit')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/home/catalogue.test.ts`
Expected: FAIL — `@modules/home/catalogue` does not exist.

- [ ] **Step 3: Implement**

```ts
// src/modules/home/catalogue.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import type { FrontendManifest } from '@core/types'

export interface CatalogueEntry {
  id: string
  titleKey: string
  module: string
  available: boolean
  reason?: 'module_disabled' | 'forbidden'
}

/**
 * Unavailable widgets stay in the list (rendered dimmed in the drawer) so the
 * operator can see what the system COULD show if a module were enabled.
 * `listModules` already excludes disabled modules, so anything absent from it
 * is simply not offered.
 */
export function buildCatalogue(
  modules: Array<{ id: string; frontend?: FrontendManifest }>,
  can: (capability: string) => boolean,
): { widgets: CatalogueEntry[] } {
  const widgets: CatalogueEntry[] = []
  for (const mod of modules) {
    for (const w of mod.frontend?.widgets ?? []) {
      const allowed = w.capability ? can(w.capability) : true
      widgets.push({
        id: w.id,
        titleKey: w.titleKey,
        module: mod.id,
        available: allowed,
        ...(allowed ? {} : { reason: 'forbidden' as const }),
      })
    }
  }
  return { widgets }
}
```

Add to `src/modules/home/routes.ts`:

```ts
  api.get('/home/widgets', requirePermission('read', 'Home'), (c) => {
    const ability = c.get('ability') as { can: (action: string, subject: string) => boolean } | undefined
    return c.json(buildCatalogue(services.listModules(), (cap) => ability?.can('read', cap) ?? true))
  })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest run tests/modules/home/catalogue.test.ts && bun run lint`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit (owner request only)**

```bash
git add src/modules/home tests/modules/home
git commit -m "feat(home): widget catalogue endpoint with availability reasons"
```

---

### Task 5: Pulse aggregate endpoint

Five figures from three modules; without aggregation the smallest tile would be the most expensive (spec §4.4).

**Files:**
- Create: `src/modules/home/pulse.ts`
- Modify: `src/modules/home/routes.ts`, `src/modules/home/index.ts` (pass optional module handles)
- Test: `tests/modules/home/pulse.test.ts`

**SECURITY REQUIREMENT (Ruling 7) — the pulse must be user-scoped.** A pre-existing defect in
`/api/v1/mission-control/snapshot` (`src/modules/mission-control/routes.ts:51-54`) filters the `agents`
array per owner for non-admins but returns `snap.totals` unfiltered, and `totals` is computed over ALL
agents (`aggregator.ts:91-96`) — so a non-admin currently sees installation-wide running/waiting counts and
`costTodayUsd`. `/home/pulse` must NOT inherit this: running / waiting / costTodayUsd are computed from the
requesting user's own agents; admin and owner see installation-wide figures. Add a test asserting a
non-admin's pulse excludes another user's agent and cost.

**Interfaces:**
- Consumes: `HomeServices` (Task 3) — **extended here** with `pulse?: PulseDeps`, populated in `index.ts` behind `ctx.hasModule('mission-control')` / `ctx.hasModule('scheduler')` / `ctx.hasModule('security-gate')` guards. Absent module → the corresponding dep returns 0.
- Produces: `computePulse(deps): Pulse` where `Pulse = { attention: number; running: number; waiting: number; costTodayUsd: number; failedJobs: number }`; `PulseDeps` as defined in Step 3; endpoint `GET /api/v1/home/pulse`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/home/pulse.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { computePulse } from '@modules/home/pulse'

describe('pulse aggregate', () => {
  it('sums the five figures from their owning modules', () => {
    const pulse = computePulse({
      pendingApprovals: () => 2,
      stuckApprovals: () => 1,
      snapshot: () => ({ totals: { running: 3, waiting: 1, costTodayUsd: 4.82 } }),
      failedJobsSince: () => 1,
    })
    expect(pulse).toEqual({ attention: 3, running: 3, waiting: 1, costTodayUsd: 4.82, failedJobs: 1 })
  })

  it('degrades to zeros rather than throwing when a module is absent', () => {
    const pulse = computePulse({
      pendingApprovals: () => { throw new Error('autonomy disabled') },
      stuckApprovals: () => 0,
      snapshot: () => null,
      failedJobsSince: () => { throw new Error('scheduler disabled') },
    })
    expect(pulse).toEqual({ attention: 0, running: 0, waiting: 0, costTodayUsd: 0, failedJobs: 0 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/home/pulse.test.ts`
Expected: FAIL — `@modules/home/pulse` does not exist.

- [ ] **Step 3: Implement**

```ts
// src/modules/home/pulse.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface Pulse {
  attention: number
  running: number
  waiting: number
  costTodayUsd: number
  failedJobs: number
}

export interface PulseDeps {
  pendingApprovals: () => number
  stuckApprovals: () => number
  snapshot: () => { totals?: { running?: number; waiting?: number; costTodayUsd?: number } } | null
  failedJobsSince: () => number
}

/** A disabled or failing module must yield a zero, never a broken home page. */
function safe(fn: () => number): number {
  try { return fn() } catch { return 0 }
}

export function computePulse(deps: PulseDeps): Pulse {
  let totals: { running?: number; waiting?: number; costTodayUsd?: number } | undefined
  try { totals = deps.snapshot()?.totals } catch { totals = undefined }

  return {
    attention: safe(deps.pendingApprovals) + safe(deps.stuckApprovals),
    running: totals?.running ?? 0,
    waiting: totals?.waiting ?? 0,
    costTodayUsd: totals?.costTodayUsd ?? 0,
    failedJobs: safe(deps.failedJobsSince),
  }
}
```

Wire it in `routes.ts` behind `requirePermission('read', 'Home')`, reading the mission-control snapshot and scheduler executions through `ctx.hasModule(...)`/`ctx.getModule(...)` guards in `index.ts` so a disabled module yields zeros rather than a 500.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest run tests/modules/home/pulse.test.ts && bun run lint`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit (owner request only)**

```bash
git add src/modules/home tests/modules/home
git commit -m "feat(home): pulse aggregate endpoint, degrading to zeros on absent modules"
```

---

### Task 6: Setup-status aggregate

Collapses the 10 requests in `setup-recommendations-card.tsx:103-117` into one cached call.

**Files:**
- Create: `src/modules/home/setup-status.ts`
- Modify: `src/modules/home/routes.ts`, `src/web/src/pages/dashboard/setup-recommendations-card.tsx`
- Test: `tests/modules/home/setup-status.test.ts`

**CRITICAL — port the predicates, not a count.** The card's ten checks are NOT "is there at least one row".
They are ten `useMemo` predicates in `setup-recommendations-card.tsx` with distinct logic: `modelsDone`
inspects provider enabled+configured state; `memoryDone` counts vault keys excluding `path`/`root`;
`ingressDone` and `channelsDone` have their own shapes. The `createSetupStatus({ providers: () => 2 })`
sketch below implies `count > 0`, which would silently change what "done" means for at least four checks —
a green test suite over a changed meaning. Port each predicate's ACTUAL logic and demonstrate equivalence
per check in the report, naming the source line of each original predicate.

**Interfaces:**
- Consumes: `HomeServices` (Task 3).
- Produces: `GET /api/v1/home/setup-status` → `{ items: Array<{ id: string; done: boolean | null }>; cachedAt: string }`. `null` means "unknown" — the card keeps showing the recommendation, matching today's behaviour at `setup-recommendations-card.tsx:246`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/home/setup-status.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi } from 'vitest'
import { createSetupStatus } from '@modules/home/setup-status'

describe('setup status aggregate', () => {
  it('reports each check as done / not done / unknown', () => {
    const status = createSetupStatus({
      providers: () => 2, projects: () => 0, agents: () => 1,
      prompts: () => null, backups: () => 0,
    }, 60_000)
    const { items } = status.get()
    expect(items.find((i) => i.id === 'providers')?.done).toBe(true)
    expect(items.find((i) => i.id === 'projects')?.done).toBe(false)
    expect(items.find((i) => i.id === 'prompts')?.done).toBeNull()
  })

  it('serves from cache within the TTL instead of re-querying', () => {
    const providers = vi.fn(() => 1)
    const status = createSetupStatus(
      { providers, projects: () => 1, agents: () => 1, prompts: () => 1, backups: () => 1 },
      60_000,
    )
    status.get()
    status.get()
    expect(providers).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/home/setup-status.test.ts`
Expected: FAIL — `@modules/home/setup-status` does not exist.

- [ ] **Step 3: Implement**

```ts
// src/modules/home/setup-status.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface SetupCheck { id: string; done: boolean | null }
export type CheckFns = Record<string, () => number | null>

/**
 * `null` count means "could not determine" and maps to done: null — the card
 * keeps the recommendation visible, matching the existing frontend behaviour.
 */
export function createSetupStatus(checks: CheckFns, ttlMs: number) {
  let cache: { items: SetupCheck[]; cachedAt: number } | null = null

  return {
    get(now = Date.now()) {
      if (cache && now - cache.cachedAt < ttlMs) {
        return { items: cache.items, cachedAt: new Date(cache.cachedAt).toISOString() }
      }
      const items: SetupCheck[] = Object.entries(checks).map(([id, fn]) => {
        let count: number | null
        try { count = fn() } catch { count = null }
        return { id, done: count === null ? null : count > 0 }
      })
      cache = { items, cachedAt: now }
      return { items, cachedAt: new Date(now).toISOString() }
    },
  }
}
```

Then replace the ten `useApi` calls in `setup-recommendations-card.tsx:103-117` with a single `useApi<{ items: SetupCheck[] }>('/home/setup-status')`, mapping each `id` to the existing recommendation rows. Keep every recommendation's text and link exactly as-is — this task changes the data source, not the content.

- [ ] **Step 4: Run tests**

Run: `bun vitest run tests/modules/home/setup-status.test.ts && bun run lint`
Expected: PASS (2 tests), typecheck clean.

- [ ] **Step 5: Commit (owner request only)**

```bash
git add src/modules/home tests/modules/home src/web/src/pages/dashboard/setup-recommendations-card.tsx
git commit -m "perf(home): collapse 10 setup-check requests into one cached aggregate"
```

---

### Task 7: Frontend widget registry + contract test

The load-bearing task: this is what stops the widget system decaying into what `WidgetRegistration` is today.

**Files:**
- Create: `src/web/src/pages/home/widget-registry.ts`, `src/web/src/pages/home/widget-frame.tsx`, `src/web/src/pages/home/i18n.ts`, `src/web/src/pages/home/locales/{en,hu,de,es,fr,tlh}.json`
- Test: `tests/contracts/widgets.contract.test.ts`

**Interfaces:**
- Consumes: `WidgetRegistration` (Task 1).
- Produces: `WIDGETS: Record<string, WidgetDef>`; `WidgetFrame` component (title, icon, badge, open-link, loading/empty/error states, drag handle, remove button).

- [ ] **Step 1: Write the failing contract test**

```ts
// tests/contracts/widgets.contract.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { WIDGETS } from '../../src/web/src/pages/home/widget-registry'
import en from '../../src/web/src/pages/home/locales/en.json'

/** Every `frontend: { widgets: [...] }` id declared by any module manifest. */
function declaredWidgetIds(): string[] {
  const ids: string[] = []
  const modulesDir = join(process.cwd(), 'src/modules')
  for (const mod of readdirSync(modulesDir, { withFileTypes: true })) {
    if (!mod.isDirectory()) continue
    const manifest = join(modulesDir, mod.name, 'index.ts')
    let source: string
    try { source = readFileSync(manifest, 'utf8') } catch { continue }
    // Scope to the `widgets: [ ... ]` block first (Ruling 10). A bare dotted-id
    // regex over the whole manifest also matches submodule/tool/page ids and
    // would fail CI with a nonsense "undeclared widget" message.
    const block = source.match(/widgets:\s*\[([\s\S]*?)\]/)
    if (!block) continue
    for (const m of block[1].matchAll(/id:\s*'([a-z0-9-]+\.[a-z0-9-]+)'/g)) ids.push(m[1])
  }
  return ids
}

describe('widget contract — backend declaration ↔ frontend implementation', () => {
  it('every declared widget has a frontend component', () => {
    const missing = declaredWidgetIds().filter((id) => !WIDGETS[id])
    expect(missing, `declared but not implemented: ${missing.join(', ')}`).toEqual([])
  })

  it('every implemented widget is declared by a module', () => {
    const declared = new Set(declaredWidgetIds())
    const orphans = Object.keys(WIDGETS).filter((id) => !declared.has(id))
    expect(orphans, `implemented but not declared: ${orphans.join(', ')}`).toEqual([])
  })

  it('every widget titleKey resolves in the English bundle', () => {
    const unresolved = Object.values(WIDGETS)
      .map((w) => w.titleKey)
      .filter((key) => !(key in (en as Record<string, string>)))
    expect(unresolved, `missing i18n keys: ${unresolved.join(', ')}`).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/contracts/widgets.contract.test.ts`
Expected: FAIL — cannot resolve `widget-registry`.

- [ ] **Step 3: Create the registry, frame and i18n bundle**

```ts
// src/web/src/pages/home/widget-registry.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import type { FC } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { ZodType } from 'zod'
import type { WsTopicKey } from '@/lib/ws-topics'

export interface WidgetDef {
  id: string
  titleKey: string
  icon: LucideIcon
  layout: { w: number; h: number; minW: number; minH: number }
  /** Both fields = hybrid (Pulse); neither = load once. See spec §3.2. */
  refresh: { topics?: WsTopicKey[]; pollMs?: number }
  configSchema?: ZodType
  Component: FC<{ config: unknown }>
}

/** Populated by Tasks 10-13. The contract test above enforces both directions. */
export const WIDGETS: Record<string, WidgetDef> = {}
```

`widget-frame.tsx` is `dashboard-section.tsx` (105 lines) copied and extended: keep the existing title / icon / badge+tone / href / loading / empty props verbatim, add `onRemove?: () => void` (the × button, edit mode only) and a `data-grid-handle` element for the drag handle. Keep `DashboardRow` exported from the same file — the tiles reuse it unchanged.

`i18n.ts` mirrors `pages/dashboard/i18n.ts` exactly:

```ts
// src/web/src/pages/home/i18n.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { registerBundle, t, tOr } from '@/i18n'
import en from './locales/en.json'
import hu from './locales/hu.json'
import de from './locales/de.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import tlh from './locales/tlh.json'

registerBundle({ en, hu, de, es, fr, tlh })
export { t, tOr }
```

Seed all six locale files with the edit-mode and drawer keys (identical key sets, translated values):

```json
{
  "home.title": "Home",
  "home.edit.start": "Edit home page",
  "home.edit.done": "Done",
  "home.edit.reset": "Restore factory layout",
  "home.drawer.title": "Add widget",
  "home.drawer.hint": "Drag onto the grid. Widgets from disabled modules appear dimmed.",
  "home.drawer.unavailable": "Module disabled",
  "home.offer.title": "New widgets available",
  "home.offer.add": "Add",
  "home.offer.dismiss": "No thanks",
  "home.widget.error": "Unavailable",
  "home.widget.retry": "Retry"
}
```

- [ ] **Step 4: Run tests**

Run: `bun vitest run tests/contracts/widgets.contract.test.ts tests/contracts/web-i18n-parity.contract.test.ts && bun run lint`
Expected: PASS — `WIDGETS` is empty and no module declares widgets yet, so both directions are trivially satisfied; the parity test confirms all six locale files carry identical key sets.

- [ ] **Step 5: Commit (owner request only)**

```bash
git add src/web/src/pages/home tests/contracts/widgets.contract.test.ts
git commit -m "feat(web): widget registry, frame and contract test forbidding one-sided wiring"
```

---

### Task 8: `useWidgetData` hook

**Files:**
- Create: `src/web/src/pages/home/use-widget-data.ts`
- Test: `tests/web/use-widget-data.test.ts`

**Interfaces:**
- Consumes: `api` (`@/lib/api`), `WS_TOPICS` (`@/lib/ws-topics`), the existing websocket hook.
- Produces: `useWidgetData<T>(path: string, refresh: WidgetDef['refresh']): { data: T | null; error: ApiError | null; isLoading: boolean; refetch: () => void }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/web/use-widget-data.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useWidgetData, __resetInflight } from '@/pages/home/use-widget-data'
import { api } from '@/lib/api'

beforeEach(() => { __resetInflight(); vi.useFakeTimers({ shouldAdvanceTime: true }) })
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('useWidgetData', () => {
  it('keeps the previous data visible while refetching (no empty flash)', async () => {
    const get = vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ n: 1 } as never)
      .mockImplementationOnce(() => new Promise(() => {}) as never)   // never settles
    const { result } = renderHook(() => useWidgetData<{ n: number }>('/x', {}))
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }))

    act(() => { result.current.refetch() })
    expect(result.current.data).toEqual({ n: 1 })   // still the old value, NOT null
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('polls on the declared interval', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ n: 1 } as never)
    renderHook(() => useWidgetData('/x', { pollMs: 1000 }))
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('stops polling while the document is hidden', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ n: 1 } as never)
    renderHook(() => useWidgetData('/x', { pollMs: 1000 }))
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('shares one in-flight request between tiles on the same path', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ n: 1 } as never)
    renderHook(() => useWidgetData('/shared', {}))
    renderHook(() => useWidgetData('/shared', {}))
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/web/use-widget-data.test.ts`
Expected: FAIL — module `@/pages/home/use-widget-data` not found.

- [ ] **Step 3: Implement**

```ts
// src/web/src/pages/home/use-widget-data.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '@/lib/api'
import type { WidgetDef } from './widget-registry'

/** Same path requested in the same tick shares one response (spec §4.5). */
const inflight = new Map<string, Promise<unknown>>()

export function __resetInflight() { inflight.clear() }

function sharedGet<T>(path: string): Promise<T> {
  const existing = inflight.get(path)
  if (existing) return existing as Promise<T>
  const p = api.get<T>(path).finally(() => inflight.delete(path))
  inflight.set(path, p)
  return p
}

export function useWidgetData<T>(path: string, refresh: WidgetDef['refresh']) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const visible = useRef(true)

  // Stale-while-revalidate: unlike useApi (hooks/use-api.ts:21,28) this never
  // clears data before the new response lands — nine tiles clearing on every
  // refresh would flicker visibly.
  const load = useCallback(() => {
    sharedGet<T>(path)
      .then((d) => { setData(d); setError(null) })
      .catch((e) => setError(e instanceof ApiError ? e : new ApiError(0, String(e))))
      .finally(() => setIsLoading(false))
  }, [path])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!refresh.pollMs) return
    const onVisibility = () => { visible.current = document.visibilityState === 'visible' }
    document.addEventListener('visibilitychange', onVisibility)
    const id = setInterval(() => { if (visible.current) load() }, refresh.pollMs)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisibility) }
  }, [refresh.pollMs, load])

  return { data, error, isLoading, refetch: load }
}
```

WS subscription is added in the same hook using the project's existing websocket hook: subscribe to `refresh.topics`, call `load()` on each thin ping. Data still crosses REST — never read payload from the frame.

- [ ] **Step 4: Run tests**

Run: `bun vitest run tests/web/use-widget-data.test.ts && bun run lint`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit (owner request only)**

```bash
git add src/web/src/pages/home/use-widget-data.ts tests/web/use-widget-data.test.ts
git commit -m "feat(web): useWidgetData with SWR, gated polling and in-flight dedupe"
```

---

### Task 9: The grid page

**Files:**
- Create: `src/web/src/pages/home/home-page.tsx`, `src/web/src/pages/home/widget-boundary.tsx`, `src/web/src/pages/home/widget-drawer.tsx`
- Modify: `package.json` (add `react-grid-layout`)
- Test: `tests/web/home-page.test.tsx`
- **NOT** `src/web/src/routes/index.tsx` — the route switch happens at the end of Task 13, once all nine widgets exist. Until then `/` keeps serving the old dashboard and `HomePage` is reachable only from its tests.

**Interfaces:**
- Consumes: `WIDGETS` (Task 7), `useWidgetData` (Task 8), `GET/PUT/DELETE /api/v1/home/layout` (Task 3), `GET /api/v1/home/widgets` (Task 4).
- Produces: `HomePage` component mounted at `/`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/web/home-page.test.tsx
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import HomePage from '@/pages/home/home-page'
import { api } from '@/lib/api'

beforeEach(() => {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.startsWith('/home/layout')) {
      return { items: [{ i: 'costops.summary#1', x: 0, y: 0, w: 3, h: 2 }], source: 'factory', newWidgets: [] } as never
    }
    if (path === '/home/widgets') {
      return { widgets: [{ id: 'costops.summary', titleKey: 'home.widget.cost.title', module: 'costops', available: true }] } as never
    }
    return {} as never
  })
})

describe('home page grid', () => {
  it('renders the tiles the layout endpoint returns', async () => {
    render(<HomePage />)
    await waitFor(() => expect(screen.getByTestId('widget-costops.summary#1')).toBeInTheDocument())
  })

  it('reveals the drawer in edit mode only', async () => {
    render(<HomePage />)
    await waitFor(() => screen.getByTestId('widget-costops.summary#1'))
    expect(screen.queryByTestId('widget-drawer')).toBeNull()
    fireEvent.click(screen.getByTestId('edit-toggle'))
    expect(screen.getByTestId('widget-drawer')).toBeInTheDocument()
  })

  it('persists the layout after a change', async () => {
    const put = vi.spyOn(api, 'put').mockResolvedValue({ ok: true } as never)
    render(<HomePage />)
    await waitFor(() => screen.getByTestId('widget-costops.summary#1'))
    fireEvent.click(screen.getByTestId('edit-toggle'))
    fireEvent.click(screen.getByTestId('remove-costops.summary#1'))
    await waitFor(() => expect(put).toHaveBeenCalledWith('/home/layout', expect.objectContaining({ items: [] })))
  })

  it('a failing tile degrades itself, not the page', async () => {
    render(<HomePage />)
    await waitFor(() => screen.getByTestId('widget-costops.summary#1'))
    // The boundary catches the throw and renders the error state in place.
    expect(screen.queryByTestId('home-grid')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/web/home-page.test.tsx`
Expected: FAIL — `@/pages/home/home-page` not found.

- [ ] **Step 3: Add the dependency and implement**

```bash
bun add react-grid-layout@2.2.4
```

**The stylesheets are not optional and the plan originally omitted them.** `react-grid-layout` ships the
drag placeholder, the resize handle and the dragging transform in CSS; without these two imports the grid
passes every test (jsdom ignores CSS) and is unusable in a browser:

```ts
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
```

Import them from the component that owns the grid, NOT from `globals.css` — pages without a grid should
not load them. The library ships fixed colours for the drag placeholder; override them with
`hsl(var(--primary) / …)` to satisfy the project's CSS-variables-only rule.

`home-page.tsx` responsibilities, kept to roughly 150 lines:
- load `/home/layout?breakpoint=<bp>` and `/home/widgets` once on mount;
- render `<ResponsiveGridLayout cols={{ lg: 12, md: 8, sm: 4 }} rowHeight={40} isDraggable={editing} isResizable={editing} draggableHandle="[data-grid-handle]">`, one child per item wrapped in `WidgetBoundary`;
- `onLayoutChange` → 800 ms debounce → `PUT /home/layout` with the current breakpoint;
- edit toggle, drawer (`widget-drawer.tsx`, listing catalogue entries, dimming `available: false`), remove button per tile, "restore factory layout" → `DELETE`;
- the offer bar when `newWidgets.length > 0`: **Add** appends them at the bottom and `PUT`s; **No thanks** calls `POST /home/layout/ack-version`.

```tsx
// src/web/src/pages/home/widget-boundary.tsx
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { Component, type ReactNode } from 'react'
import { t } from './i18n'

/**
 * One module fault must not white out the landing page: the boundary is
 * per-tile, so a 500 from /costops/summary shows "Unavailable" on the Cost
 * tile while the other eight keep working.
 */
export class WidgetBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) {
      return <div className="glass-card p-3 text-xs text-muted-foreground">{t('home.widget.error')}</div>
    }
    return this.props.children
  }
}
```

Do **not** touch `src/web/src/routes/index.tsx` in this task (see Files above).

- [ ] **Step 4: Run tests**

Run: `bun vitest run tests/web/home-page.test.tsx && bun run lint`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit (owner request only)**

```bash
git add package.json bun.lockb src/web/src/pages/home tests/web/home-page.test.tsx
git commit -m "feat(web): drag-and-drop home grid with per-tile error boundary"
```

---

### Task 10: Attention and Conversations tiles

The first real tiles. Both reuse `dashboard-utils.ts` unchanged — no logic is rewritten, so `tests/web/dashboard-utils.test.ts` keeps covering it.

**Files:**
- Create: `src/web/src/pages/home/widgets/attention-widget.tsx`, `src/web/src/pages/home/widgets/conversations-widget.tsx`
- Modify: `src/web/src/pages/home/widget-registry.ts`, `src/modules/security-gate/index.ts` + `src/modules/conversations/index.ts` manifests (declare widgets), all six `locales/*.json`
- Test: `tests/web/home-widgets-attention.test.tsx`

**Interfaces:**
- Consumes: `WidgetDef` (Task 7), `useWidgetData` (Task 8), `buildAttentionItems`/`pickPinned`/`pickRecent`/`pickDueFocus` from `@/pages/dashboard/dashboard-utils`.
- Produces: registry entries `security-gate.attention`, `conversations.recent`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/web/home-widgets-attention.test.tsx
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { AttentionWidget } from '@/pages/home/widgets/attention-widget'
import { api } from '@/lib/api'

beforeEach(() => {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.includes('status=pending')) {
      return { approvals: [{ id: 7, title: 'Write deploy/k8s/ingress.yaml', createdAt: new Date().toISOString() }] } as never
    }
    return { approvals: [], conversations: [], alerts: [] } as never
  })
})

describe('attention widget', () => {
  it('lists a pending approval with approve and reject controls', async () => {
    render(<AttentionWidget config={{}} />)
    await waitFor(() => expect(screen.getByText(/ingress.yaml/)).toBeInTheDocument())
    expect(screen.getByTestId('approve-7')).toBeInTheDocument()
    expect(screen.getByTestId('reject-7')).toBeInTheDocument()
  })

  it('posts the decision and refetches', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    render(<AttentionWidget config={{}} />)
    await waitFor(() => screen.getByTestId('approve-7'))
    fireEvent.click(screen.getByTestId('approve-7'))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/autonomy/approvals/7/approve'))
  })

  it('shows the empty state when nothing needs attention', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ approvals: [], conversations: [], alerts: [] } as never)
    render(<AttentionWidget config={{}} />)
    await waitFor(() => expect(screen.getByText(/nothing needs your attention/i)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/web/home-widgets-attention.test.tsx`
Expected: FAIL — `attention-widget` not found.

- [ ] **Step 3: Implement both tiles and declare them**

Lift the JSX from `dashboard-page.tsx:262-338` (attention list) and `:388-410` (recent conversations) into the two components, replacing `useApi` with `useWidgetData` and `DashboardSection` with `WidgetFrame`. Keep the `dashboard-utils` calls and the `kindLabel`/`kindTone` helpers verbatim — move them next to the widget that uses them.

```ts
// src/web/src/pages/home/widget-registry.ts — replace the empty WIDGETS from Task 7
import { AlertTriangle, MessageSquare } from 'lucide-react'
import { WS_TOPICS } from '@/lib/ws-topics'
import { AttentionWidget } from './widgets/attention-widget'
import { ConversationsWidget } from './widgets/conversations-widget'

export const WIDGETS: Record<string, WidgetDef> = {
  'security-gate.attention': {
    id: 'security-gate.attention',
    titleKey: 'home.widget.attention.title',
    icon: AlertTriangle,
    layout: { w: 6, h: 5, minW: 3, minH: 3 },
    refresh: { topics: ['autonomy'] },
    Component: AttentionWidget,
  },
  'conversations.recent': {
    id: 'conversations.recent',
    titleKey: 'home.widget.conversations.title',
    icon: MessageSquare,
    layout: { w: 4, h: 5, minW: 3, minH: 3 },
    refresh: { pollMs: 60_000 },
    Component: ConversationsWidget,
  },
}
```

Declare them in the module manifests:

```ts
// src/modules/security-gate/index.ts (and the equivalent in conversations)
// NOTE: the approvals API (/api/v1/autonomy/approvals) is served by the
// security-gate module — there is no `autonomy` module. The widget id follows
// the owning MODULE, not the URL prefix.
  frontend: {
    widgets: [{ id: 'security-gate.attention', titleKey: 'home.widget.attention.title' }],
  },
```

Add `home.widget.attention.title`, `home.widget.attention.empty`, `home.widget.conversations.title`, `home.widget.conversations.empty` and the approve/reject labels to **all six** locale files.

- [ ] **Step 4: Run tests**

Run: `bun vitest run tests/web/home-widgets-attention.test.tsx tests/contracts/ && bun run lint`
Expected: PASS — including the widget contract (both directions now non-trivially satisfied) and i18n parity.

- [ ] **Step 5: Commit (owner request only)**

```bash
git add src/web/src/pages/home src/modules/security-gate src/modules/conversations tests/web/home-widgets-attention.test.tsx
git commit -m "feat(home): attention and conversations tiles"
```

---

### Task 11: Running agents and Board tiles

**Files:**
- Create: `src/web/src/pages/home/widgets/running-agents-widget.tsx`, `src/web/src/pages/home/widgets/board-widget.tsx`
- Modify: `widget-registry.ts`, `src/modules/mission-control/index.ts`, `src/modules/board/index.ts`, all six locale files
- Test: `tests/web/home-widgets-running.test.tsx`

**Interfaces:**
- Consumes: `useMissionControl` (`@/pages/mission-control/hooks/useMissionControl`), `WidgetDef`.
- Produces: registry entries `mission-control.running`, `board.summary` (the latter with `configSchema = z.object({ projectId: z.string() })`).

- [ ] **Step 1: Write the failing test**

```tsx
// tests/web/home-widgets-running.test.tsx
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { RunningAgentsWidget } from '@/pages/home/widgets/running-agents-widget'
import { BoardWidget } from '@/pages/home/widgets/board-widget'
import { api } from '@/lib/api'

beforeEach(() => {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.includes('mission-control/snapshot')) {
      return {
        agents: [{ sessionId: 's1', agentName: 'Researcher', status: 'running', costUsd: 1.24, currentAction: 'reading sources', lastUpdatedAt: new Date().toISOString(), pendingApprovals: 0 }],
        totals: { running: 1, waiting: 0, costTodayUsd: 1.24 },
      } as never
    }
    return { stages: [{ name: 'Doing', cards: 3 }] } as never
  })
})

describe('running agents widget', () => {
  it('shows a running agent with pause and stop controls', async () => {
    render(<RunningAgentsWidget config={{}} />)
    await waitFor(() => expect(screen.getByText('Researcher')).toBeInTheDocument())
    expect(screen.getByTestId('pause-s1')).toBeInTheDocument()
    expect(screen.getByTestId('interrupt-s1')).toBeInTheDocument()
  })

  it('sends the pause command', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    render(<RunningAgentsWidget config={{}} />)
    await waitFor(() => screen.getByTestId('pause-s1'))
    fireEvent.click(screen.getByTestId('pause-s1'))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/mission-control/agents/s1/pause'))
  })
})

describe('board widget', () => {
  it('renders the configured project and nothing else', async () => {
    render(<BoardWidget config={{ projectId: 'proj-7' }} />)
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/projects/proj-7/board'))
  })

  it('asks for configuration when no project is set', () => {
    render(<BoardWidget config={{}} />)
    expect(screen.getByTestId('board-needs-config')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/web/home-widgets-running.test.tsx`
Expected: FAIL — components not found.

- [ ] **Step 3: Implement**

Running agents: lift `dashboard-page.tsx:418-455`, add the three commands (`/mission-control/agents/:sessionId/{interrupt,pause,resume}`) as `DashboardRow` actions with `data-testid={`pause-${sessionId}`}` etc.

Board: `useWidgetData('/projects/' + config.projectId + '/board', { topics: [WS_TOPICS.board(config.projectId)] })`; when `projectId` is absent, render a configuration prompt with a project picker (`GET /projects`) that writes back through the grid's `onConfigChange`. Register with `configSchema: z.object({ projectId: z.string().min(1) })`.

Add the widget declarations to both module manifests and the new keys to all six locale files.

- [ ] **Step 4: Run tests**

Run: `bun vitest run tests/web/home-widgets-running.test.tsx tests/contracts/ && bun run lint`
Expected: PASS (4 tests + contracts).

- [ ] **Step 5: Commit (owner request only)**

```bash
git add src/web/src/pages/home src/modules/mission-control src/modules/board tests/web/home-widgets-running.test.tsx
git commit -m "feat(home): running agents and configurable board tiles"
```

---

### Task 12: Schedule and Briefing tiles

The Schedule tile is the one that surfaces something the current dashboard never shows: a job whose **last run failed**.

**Files:**
- Create: `src/web/src/pages/home/widgets/schedule-widget.tsx`, `src/web/src/pages/home/widgets/briefing-widget.tsx`
- Modify: `widget-registry.ts`, `src/modules/scheduler/index.ts`, `src/modules/memory/index.ts`, all six locale files
- Test: `tests/web/home-widgets-schedule.test.tsx`

**Interfaces:**
- Consumes: `pickNextJobs` from `@/pages/dashboard/dashboard-utils`, `useWidgetData`.
- Produces: registry entries `scheduler.upcoming`, `memory.briefing`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/web/home-widgets-schedule.test.tsx
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ScheduleWidget } from '@/pages/home/widgets/schedule-widget'
import { api } from '@/lib/api'

beforeEach(() => {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.includes('/scheduler/jobs')) {
      return { jobs: [
        { id: 'j1', name: 'Daily briefing', status: 'active', nextRunAt: new Date(Date.now() + 720_000).toISOString() },
        { id: 'j2', name: 'Weekly backup', status: 'active', nextRunAt: new Date(Date.now() + 86_400_000).toISOString() },
      ] } as never
    }
    if (path.includes('/scheduler/executions')) {
      return { executions: [{ jobId: 'j2', status: 'failed', finishedAt: new Date(Date.now() - 172_800_000).toISOString() }] } as never
    }
    return {} as never
  })
})

describe('schedule widget', () => {
  it('marks a job whose last execution failed', async () => {
    render(<ScheduleWidget config={{}} />)
    await waitFor(() => expect(screen.getByTestId('job-failed-j2')).toBeInTheDocument())
    expect(screen.queryByTestId('job-failed-j1')).toBeNull()
  })

  it('runs a job on demand', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never)
    render(<ScheduleWidget config={{}} />)
    await waitFor(() => screen.getByTestId('run-now-j1'))
    fireEvent.click(screen.getByTestId('run-now-j1'))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/scheduler/jobs/j1/run'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/web/home-widgets-schedule.test.tsx`
Expected: FAIL — `schedule-widget` not found.

- [ ] **Step 3: Implement**

Schedule: fetch `/scheduler/jobs?status=active` and `/scheduler/executions?limit=50`; join by `jobId`, take each job's most recent execution, and flag `status === 'failed'` with a `data-testid={`job-failed-${id}`}` red row. Reuse `pickNextJobs` for ordering. Action: `POST /scheduler/jobs/:id/run`. `refresh: { pollMs: 60_000 }` — the scheduler broadcasts no WS events (spec §4.3).

Briefing: lift `dashboard-page.tsx:457-472` verbatim, `refresh: { pollMs: 900_000 }`.

Declare both in their manifests; add the keys to all six locale files.

- [ ] **Step 4: Run tests**

Run: `bun vitest run tests/web/home-widgets-schedule.test.tsx tests/contracts/ && bun run lint`
Expected: PASS (2 tests + contracts).

- [ ] **Step 5: Commit (owner request only)**

```bash
git add src/web/src/pages/home src/modules/scheduler src/modules/memory tests/web/home-widgets-schedule.test.tsx
git commit -m "feat(home): schedule tile surfacing failed runs, and briefing tile"
```

---

### Task 13: Pulse, Cost and System tiles

**Files:**
- Create: `src/web/src/pages/home/widgets/pulse-widget.tsx`, `cost-widget.tsx`, `system-widget.tsx`
- Modify: `widget-registry.ts`, `src/modules/home/index.ts`, `src/modules/costops/index.ts`, `src/modules/observability/index.ts`, all six locale files
- Test: `tests/web/home-widgets-pulse.test.tsx`

**Interfaces:**
- Consumes: `GET /api/v1/home/pulse` (Task 5), `useWidgetData`.
- Produces: registry entries `home.pulse`, `costops.summary`, `observability.system`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/web/home-widgets-pulse.test.tsx
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { PulseWidget } from '@/pages/home/widgets/pulse-widget'
import { api } from '@/lib/api'

beforeEach(() => {
  vi.spyOn(api, 'get').mockResolvedValue(
    { attention: 3, running: 2, waiting: 1, costTodayUsd: 4.82, failedJobs: 1 } as never,
  )
})

describe('pulse widget', () => {
  it('renders all five figures', async () => {
    render(<PulseWidget config={{}} />)
    await waitFor(() => expect(screen.getByTestId('pulse-attention')).toHaveTextContent('3'))
    expect(screen.getByTestId('pulse-running')).toHaveTextContent('2')
    expect(screen.getByTestId('pulse-waiting')).toHaveTextContent('1')
    expect(screen.getByTestId('pulse-cost')).toHaveTextContent('4.82')
    expect(screen.getByTestId('pulse-failed')).toHaveTextContent('1')
  })

  it('tones the failed-job figure as an error only when non-zero', async () => {
    render(<PulseWidget config={{}} />)
    await waitFor(() => expect(screen.getByTestId('pulse-failed').className).toMatch(/destructive/))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/web/home-widgets-pulse.test.tsx`
Expected: FAIL — `pulse-widget` not found.

- [ ] **Step 3: Implement**

Pulse: single `useWidgetData('/home/pulse', { topics: ['missionControl'], pollMs: 60_000 })` — hybrid, because the failed-job figure cannot arrive on a WS ping (spec §4.1). Five `StatChip`-style cells lifted from `dashboard-page.tsx:497-534`, each a router link to its list. Colours through CSS variables only (`text-destructive`, `text-emerald-*` tokens already in use).

Cost: `/costops/summary`, `pollMs: 60_000`. System: `/observability/anomalies` + `/scheduler/health`, `pollMs: 60_000`.

Declare `home.pulse` in the `home` module's own manifest; the other two in their modules. Keys into all six locale files.

- [ ] **Step 4: Switch the `/` route to the new page**

All nine factory widgets exist as of this step, so the grid is no longer partial — this is the first moment the route switch is safe.

```tsx
// src/web/src/routes/index.tsx
import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import HomePage from '@/pages/home/home-page'

export const Route = createFileRoute('/')({
  component: () => (
    <AppLayout>
      <HomePage />
    </AppLayout>
  ),
})
```

- [ ] **Step 5: Run tests**

Run: `bun vitest run tests/web/home-widgets-pulse.test.tsx tests/contracts/ && bun run lint`
Expected: PASS (2 tests + contracts). All nine factory widgets now exist, so `DEFAULT_LAYOUT` resolves fully.

- [ ] **Step 6: Commit (owner request only)**

```bash
git add src/web/src/pages/home src/web/src/routes/index.tsx src/modules/home src/modules/costops src/modules/observability tests/web/home-widgets-pulse.test.tsx
git commit -m "feat(home): pulse, cost and system tiles; switch / to the widget grid"
```

---

### Task 14: Retire the old dashboard

**Files:**
- Delete: `src/web/src/pages/dashboard/dashboard-page.tsx`, `src/web/src/pages/dashboard/autonomy-nudge-card.tsx`
- Move: `setup-recommendations-card.tsx`, `dashboard-section.tsx`, `status-dot.tsx`, `dashboard-utils.ts`, `locales/` → `src/web/src/pages/home/`
- Modify: `tests/web/dashboard-utils.test.ts` (import path only)
- Test: `tests/web/home-page.test.tsx` (extend with the setup strip)

**Interfaces:**
- Consumes: everything from Tasks 9-13.
- Produces: no `pages/dashboard/` directory; `HomePage` renders `SetupRecommendationsCard` as a fixed strip above the grid.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/web/home-page.test.tsx — append
it('shows the setup strip above the grid while recommendations are open', async () => {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === '/home/setup-status') return { items: [{ id: 'providers', done: false }] } as never
    if (path.startsWith('/home/layout')) return { items: [], source: 'factory', newWidgets: [] } as never
    return { widgets: [] } as never
  })
  render(<HomePage />)
  await waitFor(() => expect(screen.getByTestId('setup-strip')).toBeInTheDocument())
})

it('hides the setup strip when every recommendation is done', async () => {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === '/home/setup-status') return { items: [{ id: 'providers', done: true }] } as never
    if (path.startsWith('/home/layout')) return { items: [], source: 'factory', newWidgets: [] } as never
    return { widgets: [] } as never
  })
  render(<HomePage />)
  await waitFor(() => expect(screen.queryByTestId('setup-strip')).toBeNull())
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/web/home-page.test.tsx`
Expected: FAIL — no `setup-strip` test id.

- [ ] **Step 3: Move, delete, wire**

```bash
git mv src/web/src/pages/dashboard/setup-recommendations-card.tsx src/web/src/pages/home/
git mv src/web/src/pages/dashboard/dashboard-utils.ts src/web/src/pages/home/
git mv src/web/src/pages/dashboard/status-dot.tsx src/web/src/pages/home/
git mv src/web/src/pages/dashboard/dashboard-section.tsx src/web/src/pages/home/
git mv src/web/src/pages/dashboard/locales src/web/src/pages/home/legacy-locales
git rm src/web/src/pages/dashboard/dashboard-page.tsx src/web/src/pages/dashboard/autonomy-nudge-card.tsx
```

Merge `legacy-locales/*.json` into `pages/home/locales/*.json` (keys unchanged where the string is unchanged), then delete `legacy-locales`. Drop the three `dashboard.nudge.*` keys — the component they served is gone. Render `<SetupRecommendationsCard data-testid="setup-strip" />` above `<ResponsiveGridLayout>` in `home-page.tsx`, returning `null` when no item has `done === false || done === null`.

- [ ] **Step 4: Run the full suite**

Run: `bun vitest run && bun run lint`
Expected: PASS — the whole suite, including `tests/web/dashboard-utils.test.ts` under its new import path and both contract tests. Confirm no file outside `pages/home/` imports from `pages/dashboard/`:

```bash
grep -rn "pages/dashboard" src/ tests/ | grep -v node_modules
```
Expected: no output.

- [ ] **Step 5: Commit (owner request only)**

```bash
git add -A src/web/src/pages tests/web
git commit -m "refactor(web): retire fixed dashboard, delete dead AutonomyNudgeCard"
```

---

### Task 15: Documentation and changelog

**Files:**
- Modify: `CHANGELOG.md`, `CLAUDE.md` (module list), `docs/eyas-architecture.md`
- Create: `packages/docs/src/content/docs/{en,hu,de,es,fr,tlh}/daily/home.md`

**Interfaces:**
- Consumes: the finished feature.
- Produces: user documentation reachable from the in-app contextual help (`ContextualHelp helpId="daily.home"`).

- [ ] **Step 1: Write the docs page in all six languages**

Cover: what the home page shows, how to enter edit mode, how to add/remove/resize a widget, what "restore factory layout" does, and that new widgets are offered rather than inserted. Follow the structure of the existing `daily/dashboard.*` pages.

- [ ] **Step 2: Update CHANGELOG.md**

Add a `## [Unreleased]` entry describing the widget grid, the revived widget extension point, the setup-request collapse, and the `AutonomyNudgeCard` removal.

- [ ] **Step 3: Update CLAUDE.md and the architecture doc**

Add `home` to the Core Modules list in `CLAUDE.md`. Add a section to `docs/eyas-architecture.md` describing the widget contract and pointing at the spec.

- [ ] **Step 4: Verify the docs build**

Run: `bun run docs:build`
Expected: build succeeds, the new page present in all six language trees.

- [ ] **Step 5: Commit (owner request only)**

```bash
git add CHANGELOG.md CLAUDE.md docs packages/docs
git commit -m "docs: home widget grid — user guide in six languages"
```

---

## Backlog (deliberately out of scope — see spec §10)

1. **`scheduler` WS topic.** Job execution broadcasts nothing, so the Schedule tile and the Pulse failed-job figure poll at 60s. Adding the topic would make both event-driven.
2. **`PageRegistration.title` is an untranslated backend display string** (`src/core/types.ts:241`) — the same defect `WidgetRegistration.title` had, but it feeds the sidebar, not the grid.
3. **No skill-run endpoint.** The `skills` module exposes list / match / toggle only, so a "skill deck" tile with model and effort selection needs new backend surface before it can be built.
