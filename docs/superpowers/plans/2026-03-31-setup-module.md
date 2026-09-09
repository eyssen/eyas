# Setup Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-boot setup wizard with a modular step registry so modules can register their own setup steps, and refactor the auth module to use it.

**Architecture:** A new `setup` core module provides a `SetupRegistry` on `ModuleContext` that other modules (starting with auth) register steps into. A global middleware returns 503 on all non-setup endpoints until all required steps are completed. Setup state is persisted per-step in SQLite so progress survives restarts.

**Tech Stack:** Hono, Drizzle ORM (bun:sqlite), existing Zod validation

**Spec:** `docs/superpowers/specs/2026-03-31-setup-module-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|----------------|
| `src/modules/setup/types.ts` | SetupStepDefinition, SetupField, SetupStep types |
| `src/modules/setup/schema.ts` | Drizzle `setup_steps` table |
| `src/modules/setup/registry.ts` | SetupRegistry — register steps, complete, skip, isComplete |
| `src/modules/setup/middleware.ts` | setupGuard — 503 when setup incomplete |
| `src/modules/setup/routes.ts` | `/api/v1/setup/*` endpoints |
| `src/modules/setup/index.ts` | EyasModule implementation |
| `tests/modules/setup/registry.test.ts` | SetupRegistry unit tests |
| `tests/modules/setup/middleware.test.ts` | setupGuard middleware tests |
| `tests/modules/setup/routes.test.ts` | Setup API endpoint tests |
| `tests/modules/setup/env-auto-complete.test.ts` | Env var auto-complete tests |
| `tests/helpers/test-db.ts` | Shared DB + table creation helper for tests |

### Modified Files

| File | Change |
|------|--------|
| `src/core/types.ts` | Add `setup: SetupRegistry` to `ModuleContext` |
| `src/core/bootstrap.ts` | Create SetupRegistry, register setup module, add setupGuard |
| `src/modules/auth/index.ts` | Add `'setup'` dependency, register setup steps in `onRegister` |
| `src/modules/auth/routes.ts` | Remove setup endpoints, remove `setupSchema` import |
| `src/modules/auth/types.ts` | Remove `setupSchema` |
| `tests/modules/auth/routes-setup.test.ts` | Rewrite: test through setup module API |
| `tests/modules/auth/routes-login.test.ts` | Use test helper to insert user directly |
| `tests/modules/auth/routes-token.test.ts` | Use test helper to insert user directly |
| `tests/modules/auth/routes-users.test.ts` | Use test helper to insert user directly |
| `tests/modules/auth/routes-api-keys.test.ts` | Use test helper to insert user directly |

---

## Task 1: Setup Types

**Files:**
- Create: `src/modules/setup/types.ts`

- [ ] **Step 1: Create setup types**

Create `src/modules/setup/types.ts`:

```typescript
export interface SetupField {
  name: string
  type: 'text' | 'password' | 'email' | 'toggle'
  label: string
  required: boolean
  placeholder?: string
  defaultValue?: string | boolean
}

export interface SetupStepDefinition {
  id: string
  module: string
  title: string
  description: string
  required: boolean
  order: number
  fields: SetupField[]
  onComplete(data: Record<string, unknown>): Promise<void>
}

export interface SetupStep {
  id: string
  module: string
  title: string
  description: string
  required: boolean
  order: number
  fields: SetupField[]
  status: 'pending' | 'completed' | 'skipped'
  completedAt: string | null
}

export interface SetupRegistry {
  registerStep(step: SetupStepDefinition): void
  getSteps(): SetupStep[]
  getStep(id: string): SetupStep | undefined
  isComplete(): boolean
  completeStep(id: string, data: Record<string, unknown>): Promise<void>
  skipStep(id: string): Promise<void>
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/setup/types.ts
git commit -m "feat(setup): add setup module types (SetupRegistry, SetupStep, SetupField)"
```

---

## Task 2: Setup Schema

**Files:**
- Create: `src/modules/setup/schema.ts`

- [ ] **Step 1: Create Drizzle schema**

Create `src/modules/setup/schema.ts`:

```typescript
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const setupSteps = sqliteTable('setup_steps', {
  id: text('id').primaryKey(),
  status: text('status').notNull().default('pending'),
  data: text('data'),
  completedAt: text('completed_at'),
})
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/setup/schema.ts
git commit -m "feat(setup): add Drizzle schema for setup_steps table"
```

---

## Task 3: Test Helper — Shared DB Setup

**Files:**
- Create: `tests/helpers/test-db.ts`

This helper eliminates the duplicated table creation SQL across all auth test files.

- [ ] **Step 1: Create test helper**

Create `tests/helpers/test-db.ts`:

```typescript
import { sql } from 'drizzle-orm'
import { createDatabase, closeDatabase } from '@core/db/connection'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { generateId } from '@shared/crypto'
import { hashPassword } from '@modules/auth/providers/local'

export function createTestDb(label: string) {
  const dbPath = join(tmpdir(), `eyas-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)

  function open() {
    const db = createDatabase(dbPath)
    // Core tables
    db.run(sql`CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, is_system INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')))`)
    db.run(sql`INSERT OR IGNORE INTO roles (id, name, description) VALUES ('owner', 'Owner', 'Root'), ('admin', 'Admin', 'Admin'), ('user', 'User', 'User'), ('agent', 'Agent', 'Agent'), ('guest', 'Guest', 'Guest')`)
    // Auth tables
    db.run(sql`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, email TEXT UNIQUE, password_hash TEXT, role TEXT NOT NULL DEFAULT 'user', is_root_owner INTEGER NOT NULL DEFAULT 0, is_agent INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at TEXT NOT NULL, user_agent TEXT, ip_address TEXT, created_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, key_prefix TEXT NOT NULL, key_hash TEXT NOT NULL, last_used_at TEXT, expires_at TEXT, created_at TEXT NOT NULL, revoked_at TEXT)`)
    // Setup table
    db.run(sql`CREATE TABLE IF NOT EXISTS setup_steps (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pending', data TEXT, completed_at TEXT)`)
    return db
  }

  function cleanup() {
    closeDatabase()
    try { rmSync(dbPath) } catch {}
    try { rmSync(`${dbPath}-wal`) } catch {}
    try { rmSync(`${dbPath}-shm`) } catch {}
  }

  return { open, cleanup, dbPath }
}

/**
 * Insert a test owner user directly into the DB (bypasses setup flow).
 * Returns the user ID.
 */
export async function insertTestOwner(db: any, username = 'testowner', password = 'testpassword123'): Promise<string> {
  const id = generateId()
  const now = new Date().toISOString()
  const passwordHash = await hashPassword(password)
  db.run(sql`INSERT INTO users (id, username, display_name, password_hash, role, is_root_owner, is_agent, status, created_at, updated_at)
    VALUES (${id}, ${username}, ${username}, ${passwordHash}, 'owner', 1, 0, 'active', ${now}, ${now})`)
  return id
}
```

- [ ] **Step 2: Run all existing tests to verify helper doesn't break anything**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run
```

Expected: All 112 existing tests still pass (helper is not imported yet).

- [ ] **Step 3: Commit**

```bash
git add tests/helpers/test-db.ts
git commit -m "test(helpers): add shared test DB helper with insertTestOwner"
```

---

## Task 4: SetupRegistry

**Files:**
- Create: `src/modules/setup/registry.ts`
- Create: `tests/modules/setup/registry.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/modules/setup/registry.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createSetupRegistry } from '@modules/setup/registry'
import { createTestDb } from '../../helpers/test-db'
import type { SetupRegistry, SetupStepDefinition } from '@modules/setup/types'

const testDb = createTestDb('setup-registry')
let db: ReturnType<typeof testDb.open>
let registry: SetupRegistry

function mockStep(overrides: Partial<SetupStepDefinition> = {}): SetupStepDefinition {
  return {
    id: 'test-step',
    module: 'test',
    title: 'Test Step',
    description: 'A test step',
    required: true,
    order: 10,
    fields: [
      { name: 'username', type: 'text', label: 'Username', required: true },
    ],
    onComplete: async () => {},
    ...overrides,
  }
}

beforeEach(() => {
  db = testDb.open()
  registry = createSetupRegistry(db)
})

afterEach(() => {
  testDb.cleanup()
})

describe('SetupRegistry', () => {
  describe('registerStep', () => {
    it('registers a step', () => {
      registry.registerStep(mockStep())
      expect(registry.getSteps()).toHaveLength(1)
      expect(registry.getSteps()[0].id).toBe('test-step')
      expect(registry.getSteps()[0].status).toBe('pending')
    })

    it('rejects duplicate step IDs', () => {
      registry.registerStep(mockStep())
      expect(() => registry.registerStep(mockStep())).toThrow('already registered')
    })

    it('orders steps by order field', () => {
      registry.registerStep(mockStep({ id: 'b', order: 20 }))
      registry.registerStep(mockStep({ id: 'a', order: 10 }))
      const steps = registry.getSteps()
      expect(steps[0].id).toBe('a')
      expect(steps[1].id).toBe('b')
    })
  })

  describe('getStep', () => {
    it('returns a step by ID', () => {
      registry.registerStep(mockStep())
      expect(registry.getStep('test-step')?.title).toBe('Test Step')
    })

    it('returns undefined for unknown ID', () => {
      expect(registry.getStep('unknown')).toBeUndefined()
    })
  })

  describe('completeStep', () => {
    it('marks step as completed', async () => {
      const onComplete = async () => {}
      registry.registerStep(mockStep({ onComplete }))
      await registry.completeStep('test-step', { username: 'admin' })
      expect(registry.getStep('test-step')?.status).toBe('completed')
      expect(registry.getStep('test-step')?.completedAt).toBeTruthy()
    })

    it('calls onComplete callback with data', async () => {
      let receivedData: Record<string, unknown> = {}
      registry.registerStep(mockStep({
        onComplete: async (data) => { receivedData = data },
      }))
      await registry.completeStep('test-step', { username: 'admin' })
      expect(receivedData).toEqual({ username: 'admin' })
    })

    it('strips password fields from persisted data', async () => {
      registry.registerStep(mockStep({
        fields: [
          { name: 'username', type: 'text', label: 'Username', required: true },
          { name: 'password', type: 'password', label: 'Password', required: true },
        ],
        onComplete: async () => {},
      }))
      await registry.completeStep('test-step', { username: 'admin', password: 'secret123' })
      // The step data should not contain the password
      const step = registry.getStep('test-step')!
      // Read persisted data from DB to verify
      expect(step.status).toBe('completed')
    })

    it('throws for unknown step ID', async () => {
      await expect(registry.completeStep('unknown', {})).rejects.toThrow('not found')
    })

    it('keeps step pending if onComplete throws', async () => {
      registry.registerStep(mockStep({
        onComplete: async () => { throw new Error('Failed!') },
      }))
      await expect(registry.completeStep('test-step', {})).rejects.toThrow('Failed!')
      expect(registry.getStep('test-step')?.status).toBe('pending')
    })
  })

  describe('skipStep', () => {
    it('skips an optional step', async () => {
      registry.registerStep(mockStep({ required: false }))
      await registry.skipStep('test-step')
      expect(registry.getStep('test-step')?.status).toBe('skipped')
    })

    it('rejects skipping a required step', async () => {
      registry.registerStep(mockStep({ required: true }))
      await expect(registry.skipStep('test-step')).rejects.toThrow('required')
    })
  })

  describe('isComplete', () => {
    it('returns false when required steps are pending', () => {
      registry.registerStep(mockStep({ required: true }))
      expect(registry.isComplete()).toBe(false)
    })

    it('returns true when all required steps are completed', async () => {
      registry.registerStep(mockStep({ required: true }))
      await registry.completeStep('test-step', { username: 'admin' })
      expect(registry.isComplete()).toBe(true)
    })

    it('returns true when required steps are completed and optional are skipped', async () => {
      registry.registerStep(mockStep({ id: 'req', required: true, order: 10 }))
      registry.registerStep(mockStep({ id: 'opt', required: false, order: 20 }))
      await registry.completeStep('req', {})
      await registry.skipStep('opt')
      expect(registry.isComplete()).toBe(true)
    })

    it('returns true when required steps are completed and optional are pending', async () => {
      registry.registerStep(mockStep({ id: 'req', required: true, order: 10 }))
      registry.registerStep(mockStep({ id: 'opt', required: false, order: 20 }))
      await registry.completeStep('req', {})
      expect(registry.isComplete()).toBe(true)
    })

    it('returns true when no steps are registered', () => {
      expect(registry.isComplete()).toBe(true)
    })

    it('restores state from DB on creation', async () => {
      registry.registerStep(mockStep({ required: true }))
      await registry.completeStep('test-step', { username: 'admin' })

      // Create a new registry pointing to the same DB — should restore state
      const registry2 = createSetupRegistry(db)
      registry2.registerStep(mockStep({ required: true }))
      expect(registry2.getStep('test-step')?.status).toBe('completed')
      expect(registry2.isComplete()).toBe(true)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/setup/registry.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement SetupRegistry**

Create `src/modules/setup/registry.ts`:

```typescript
import { sql } from 'drizzle-orm'
import type { SetupRegistry, SetupStepDefinition, SetupStep } from './types.js'

export function createSetupRegistry(db: any): SetupRegistry {
  const definitions = new Map<string, SetupStepDefinition>()
  const states = new Map<string, { status: 'pending' | 'completed' | 'skipped'; completedAt: string | null }>()
  let completeCache: boolean | null = null

  function loadStateFromDb(id: string) {
    const rows = db.all(sql`SELECT * FROM setup_steps WHERE id = ${id}`) as any[]
    if (rows[0]) {
      states.set(id, { status: rows[0].status, completedAt: rows[0].completed_at })
    }
  }

  function persistState(id: string, status: string, data: Record<string, unknown> | null) {
    const now = status === 'pending' ? null : new Date().toISOString()
    const jsonData = data ? JSON.stringify(data) : null
    db.run(sql`INSERT OR REPLACE INTO setup_steps (id, status, data, completed_at) VALUES (${id}, ${status}, ${jsonData}, ${now})`)
  }

  function invalidateCache() {
    completeCache = null
  }

  function stripPasswords(definition: SetupStepDefinition, data: Record<string, unknown>): Record<string, unknown> {
    const passwordFields = new Set(definition.fields.filter(f => f.type === 'password').map(f => f.name))
    const sanitized: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data)) {
      if (!passwordFields.has(key)) {
        sanitized[key] = value
      }
    }
    return sanitized
  }

  return {
    registerStep(step) {
      if (definitions.has(step.id)) {
        throw new Error(`Setup step "${step.id}" is already registered`)
      }
      definitions.set(step.id, step)
      // Load existing state from DB (for restart recovery)
      loadStateFromDb(step.id)
      if (!states.has(step.id)) {
        states.set(step.id, { status: 'pending', completedAt: null })
      }
      invalidateCache()
    },

    getSteps(): SetupStep[] {
      return Array.from(definitions.values())
        .sort((a, b) => a.order - b.order)
        .map(def => {
          const state = states.get(def.id) ?? { status: 'pending' as const, completedAt: null }
          return {
            id: def.id,
            module: def.module,
            title: def.title,
            description: def.description,
            required: def.required,
            order: def.order,
            fields: def.fields,
            status: state.status,
            completedAt: state.completedAt,
          }
        })
    },

    getStep(id) {
      const def = definitions.get(id)
      if (!def) return undefined
      const state = states.get(id) ?? { status: 'pending' as const, completedAt: null }
      return {
        id: def.id,
        module: def.module,
        title: def.title,
        description: def.description,
        required: def.required,
        order: def.order,
        fields: def.fields,
        status: state.status,
        completedAt: state.completedAt,
      }
    },

    isComplete() {
      if (completeCache !== null) return completeCache
      const result = Array.from(definitions.values())
        .filter(d => d.required)
        .every(d => {
          const state = states.get(d.id)
          return state?.status === 'completed'
        })
      completeCache = result
      return result
    },

    async completeStep(id, data) {
      const def = definitions.get(id)
      if (!def) throw new Error(`Setup step "${id}" not found`)
      // Call the module's onComplete — if it throws, step stays pending
      await def.onComplete(data)
      // Strip passwords before persisting
      const sanitized = stripPasswords(def, data)
      states.set(id, { status: 'completed', completedAt: new Date().toISOString() })
      persistState(id, 'completed', sanitized)
      invalidateCache()
    },

    async skipStep(id) {
      const def = definitions.get(id)
      if (!def) throw new Error(`Setup step "${id}" not found`)
      if (def.required) throw new Error(`Setup step "${id}" is required and cannot be skipped`)
      states.set(id, { status: 'skipped', completedAt: new Date().toISOString() })
      persistState(id, 'skipped', null)
      invalidateCache()
    },
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/setup/registry.test.ts
```

Expected: All 13 tests pass.

- [ ] **Step 5: Run all tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run
```

Expected: All existing + new tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/modules/setup/registry.ts tests/modules/setup/registry.test.ts
git commit -m "feat(setup): add SetupRegistry with DB persistence and password stripping"
```

---

## Task 5: Setup Guard Middleware

**Files:**
- Create: `src/modules/setup/middleware.ts`
- Create: `tests/modules/setup/middleware.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/modules/setup/middleware.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { errorHandler } from '@core/http/middleware/error-handler'
import { setupGuard } from '@modules/setup/middleware'
import type { SetupRegistry } from '@modules/setup/types'

function createMockRegistry(complete: boolean): SetupRegistry {
  return {
    registerStep: vi.fn(),
    getSteps: vi.fn(() => []),
    getStep: vi.fn(),
    isComplete: vi.fn(() => complete),
    completeStep: vi.fn(),
    skipStep: vi.fn(),
  }
}

function createTestApp(registry: SetupRegistry) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', setupGuard(registry))
  app.get('/api/v1/health', (c) => c.json({ ok: true }))
  app.get('/api/v1/setup/status', (c) => c.json({ complete: false }))
  app.get('/api/v1/setup/steps', (c) => c.json({ steps: [] }))
  app.get('/api/v1/data', (c) => c.json({ data: 'secret' }))
  app.post('/api/v1/auth/login', (c) => c.json({ token: '...' }))
  return app
}

describe('setupGuard middleware', () => {
  it('returns 503 on non-setup endpoints when setup is incomplete', async () => {
    const app = createTestApp(createMockRegistry(false))
    const res = await app.request('/api/v1/data')
    expect(res.status).toBe(503)
    const body = await res.json() as Record<string, unknown>
    expect(body.setupRequired).toBe(true)
  })

  it('allows /api/v1/health during setup', async () => {
    const app = createTestApp(createMockRegistry(false))
    const res = await app.request('/api/v1/health')
    expect(res.status).toBe(200)
  })

  it('allows /api/v1/setup/* during setup', async () => {
    const app = createTestApp(createMockRegistry(false))
    const res = await app.request('/api/v1/setup/status')
    expect(res.status).toBe(200)
  })

  it('allows all endpoints when setup is complete', async () => {
    const app = createTestApp(createMockRegistry(true))
    const res = await app.request('/api/v1/data')
    expect(res.status).toBe(200)
  })

  it('blocks POST to non-setup endpoints during setup', async () => {
    const app = createTestApp(createMockRegistry(false))
    const res = await app.request('/api/v1/auth/login', { method: 'POST' })
    expect(res.status).toBe(503)
  })
})
```

- [ ] **Step 2: Implement setupGuard**

Create `src/modules/setup/middleware.ts`:

```typescript
import type { MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { SetupRegistry } from './types.js'

export function setupGuard(registry: SetupRegistry): MiddlewareHandler {
  return async (c, next) => {
    if (registry.isComplete()) {
      return next()
    }
    const path = c.req.path
    if (path.startsWith('/api/v1/setup') || path === '/api/v1/health') {
      return next()
    }
    return c.json({ error: 'Setup required', setupRequired: true }, 503)
  }
}
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/setup/middleware.test.ts
```

Expected: All 5 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/modules/setup/middleware.ts tests/modules/setup/middleware.test.ts
git commit -m "feat(setup): add setupGuard middleware (503 when setup incomplete)"
```

---

## Task 6: Setup Routes

**Files:**
- Create: `src/modules/setup/routes.ts`
- Create: `tests/modules/setup/routes.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/modules/setup/routes.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createSetupRegistry } from '@modules/setup/registry'
import { createSetupRoutes } from '@modules/setup/routes'
import { createTestDb } from '../../helpers/test-db'
import type { SetupRegistry } from '@modules/setup/types'

const testDb = createTestDb('setup-routes')
let db: ReturnType<typeof testDb.open>
let registry: SetupRegistry
let app: Hono

beforeEach(() => {
  db = testDb.open()
  registry = createSetupRegistry(db)

  registry.registerStep({
    id: 'root-owner',
    module: 'auth',
    title: 'Root Owner',
    description: 'Create admin account',
    required: true,
    order: 10,
    fields: [
      { name: 'username', type: 'text', label: 'Username', required: true },
      { name: 'password', type: 'password', label: 'Password', required: true },
    ],
    onComplete: async () => {},
  })

  registry.registerStep({
    id: 'optional-step',
    module: 'test',
    title: 'Optional Config',
    description: 'Something optional',
    required: false,
    order: 20,
    fields: [
      { name: 'value', type: 'text', label: 'Value', required: false },
    ],
    onComplete: async () => {},
  })

  app = new Hono()
  app.onError(errorHandler)
  createSetupRoutes(app, registry)
})

afterEach(() => {
  testDb.cleanup()
})

describe('GET /api/v1/setup/status', () => {
  it('returns incomplete status', async () => {
    const res = await app.request('/api/v1/setup/status')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.complete).toBe(false)
    expect(body.totalSteps).toBe(2)
    expect(body.completedSteps).toBe(0)
    expect(body.currentStep).toBe('root-owner')
  })

  it('returns complete status after all required steps done', async () => {
    await registry.completeStep('root-owner', { username: 'admin', password: 'test12345' })
    const res = await app.request('/api/v1/setup/status')
    const body = await res.json() as any
    expect(body.complete).toBe(true)
    expect(body.completedSteps).toBe(1)
  })
})

describe('GET /api/v1/setup/steps', () => {
  it('returns all steps with fields', async () => {
    const res = await app.request('/api/v1/setup/steps')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.steps).toHaveLength(2)
    expect(body.steps[0].id).toBe('root-owner')
    expect(body.steps[0].fields).toHaveLength(2)
    expect(body.steps[1].id).toBe('optional-step')
  })
})

describe('GET /api/v1/setup/steps/:id', () => {
  it('returns a single step', async () => {
    const res = await app.request('/api/v1/setup/steps/root-owner')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.step.id).toBe('root-owner')
  })

  it('returns 404 for unknown step', async () => {
    const res = await app.request('/api/v1/setup/steps/unknown')
    expect(res.status).toBe(404)
  })
})

describe('POST /api/v1/setup/steps/:id', () => {
  it('completes a step', async () => {
    const res = await app.request('/api/v1/setup/steps/root-owner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'securepass1' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.step.status).toBe('completed')
  })

  it('returns 400 when required field is missing', async () => {
    const res = await app.request('/api/v1/setup/steps/root-owner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin' }),  // missing password
    })
    expect(res.status).toBe(400)
  })

  it('returns 500 when onComplete throws', async () => {
    // Register a step that fails
    registry.registerStep({
      id: 'failing-step',
      module: 'test',
      title: 'Fail',
      description: 'This will fail',
      required: false,
      order: 30,
      fields: [{ name: 'x', type: 'text', label: 'X', required: true }],
      onComplete: async () => { throw new Error('Boom') },
    })
    const res = await app.request('/api/v1/setup/steps/failing-step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 'test' }),
    })
    expect(res.status).toBe(500)
  })

  it('returns 404 after setup is complete', async () => {
    await registry.completeStep('root-owner', { username: 'admin', password: 'test12345' })
    const res = await app.request('/api/v1/setup/steps/optional-step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'test' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/v1/setup/steps/:id/skip', () => {
  it('skips an optional step', async () => {
    const res = await app.request('/api/v1/setup/steps/optional-step/skip', {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.step.status).toBe('skipped')
  })

  it('returns 403 when skipping a required step', async () => {
    const res = await app.request('/api/v1/setup/steps/root-owner/skip', {
      method: 'POST',
    })
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: Implement setup routes**

Create `src/modules/setup/routes.ts`:

```typescript
import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { SetupRegistry } from './types.js'

export function createSetupRoutes(app: Hono, registry: SetupRegistry): void {

  // All setup endpoints return 404 once setup is complete
  app.use('/api/v1/setup/*', async (c, next) => {
    if (registry.isComplete()) {
      throw new HTTPException(404, { message: 'Not Found' })
    }
    return next()
  })

  app.get('/api/v1/setup/status', (c) => {
    const steps = registry.getSteps()
    const completedSteps = steps.filter(s => s.status === 'completed' || s.status === 'skipped').length
    const pendingRequired = steps.find(s => s.required && s.status === 'pending')
    return c.json({
      complete: registry.isComplete(),
      currentStep: pendingRequired?.id ?? null,
      totalSteps: steps.length,
      completedSteps,
    })
  })

  app.get('/api/v1/setup/steps', (c) => {
    return c.json({ steps: registry.getSteps() })
  })

  app.get('/api/v1/setup/steps/:id', (c) => {
    const step = registry.getStep(c.req.param('id'))
    if (!step) throw new HTTPException(404, { message: 'Step not found' })
    return c.json({ step })
  })

  app.post('/api/v1/setup/steps/:id', async (c) => {
    const stepId = c.req.param('id')
    const step = registry.getStep(stepId)
    if (!step) throw new HTTPException(404, { message: 'Step not found' })

    const data = await c.req.json() as Record<string, unknown>

    // Validate required fields
    for (const field of step.fields) {
      if (field.required && (data[field.name] === undefined || data[field.name] === '')) {
        return c.json({ error: `Field "${field.name}" is required` }, 400)
      }
    }

    try {
      await registry.completeStep(stepId, data)
    } catch (err: any) {
      return c.json({ error: err.message }, 500)
    }

    return c.json({ step: registry.getStep(stepId) })
  })

  app.post('/api/v1/setup/steps/:id/skip', async (c) => {
    const stepId = c.req.param('id')
    const step = registry.getStep(stepId)
    if (!step) throw new HTTPException(404, { message: 'Step not found' })

    try {
      await registry.skipStep(stepId)
    } catch (err: any) {
      return c.json({ error: err.message }, 403)
    }

    return c.json({ step: registry.getStep(stepId) })
  })
}
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/setup/routes.test.ts
```

Expected: All 9 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/modules/setup/routes.ts tests/modules/setup/routes.test.ts
git commit -m "feat(setup): add setup API routes (status, steps, complete, skip)"
```

---

## Task 7: Setup Module (EyasModule) + Bootstrap Integration

**Files:**
- Create: `src/modules/setup/index.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/bootstrap.ts`

- [ ] **Step 1: Add SetupRegistry to ModuleContext**

In `src/core/types.ts`, add the import and field:

Add import at the top:
```typescript
import type { SetupRegistry } from '@modules/setup/types'
```

Add to `ModuleContext`:
```typescript
setup: SetupRegistry
```

- [ ] **Step 2: Create setup module**

Create `src/modules/setup/index.ts`:

```typescript
import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { createSetupRoutes } from './routes.js'

export const setupModule: EyasModule = {
  id: 'setup',
  name: 'Setup',
  version: '1.0.0',
  type: 'core',
  required: true,
  description: 'First-boot setup wizard with modular step registry',
  dependencies: [],

  async onRegister(ctx: ModuleContext) {
    ctx.db.run(sql`
      CREATE TABLE IF NOT EXISTS setup_steps (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending',
        data TEXT,
        completed_at TEXT
      )
    `)
    ctx.logger.info('Setup module registered')
  },

  async onStart(ctx: ModuleContext) {
    // Register setup routes
    createSetupRoutes(ctx.http, ctx.setup)

    // Env var auto-complete for headless deployments
    await autoCompleteFromEnv(ctx)

    if (ctx.setup.isComplete()) {
      ctx.logger.info('Setup already complete')
    } else {
      const steps = ctx.setup.getSteps()
      const pending = steps.filter(s => s.required && s.status === 'pending')
      ctx.logger.warn(`Setup incomplete — ${pending.length} required step(s) pending`)
    }
  },

  async onStop() {},
}

async function autoCompleteFromEnv(ctx: ModuleContext): Promise<void> {
  const { setup, logger } = ctx

  // Root owner auto-complete
  const username = process.env.EYAS_SETUP_USERNAME
  const password = process.env.EYAS_SETUP_PASSWORD
  if (username && password) {
    const step = setup.getStep('root-owner')
    if (step && step.status === 'pending') {
      try {
        await setup.completeStep('root-owner', {
          username,
          password,
          displayName: process.env.EYAS_SETUP_DISPLAY_NAME || username,
        })
        logger.info('Setup: root-owner auto-completed from environment variables')
        // Clear password from env
        delete process.env.EYAS_SETUP_PASSWORD
      } catch (err: any) {
        logger.error(`Setup: root-owner auto-complete failed: ${err.message}`)
      }
    }
  }

  // First agent auto-complete
  const agentName = process.env.EYAS_SETUP_AGENT_NAME
  if (agentName) {
    const step = setup.getStep('first-agent')
    if (step && step.status === 'pending') {
      try {
        await setup.completeStep('first-agent', { name: agentName })
        logger.info('Setup: first-agent auto-completed from environment variables')
      } catch (err: any) {
        logger.error(`Setup: first-agent auto-complete failed: ${err.message}`)
      }
    }
  }
}
```

- [ ] **Step 3: Update bootstrap**

In `src/core/bootstrap.ts`:

1. Add imports:
```typescript
import { createSetupRegistry } from '@modules/setup/registry'
import { setupModule } from '@modules/setup/index'
import { setupGuard } from '@modules/setup/middleware'
```

2. After `const app = createApp()`, create the setup registry and add the guard:
```typescript
const setupReg = createSetupRegistry(db)
app.use('*', setupGuard(setupReg))
```

3. Add `setup: setupReg` to the `ctx` object.

4. Register the setup module before permissions:
```typescript
if (!moduleLoader.hasModule(setupModule.id)) {
  moduleLoader.register(setupModule)
}
```

- [ ] **Step 4: Run all tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run
```

Note: Some auth tests will now fail because of the setupGuard returning 503 (no setup completed in those tests). This is expected — we fix those tests in the next tasks.

- [ ] **Step 5: Commit what works**

```bash
git add src/modules/setup/index.ts src/core/types.ts src/core/bootstrap.ts
git commit -m "feat(setup): wire setup module into bootstrap with setupGuard and env auto-complete"
```

---

## Task 8: Refactor Auth Module — Register Setup Steps

**Files:**
- Modify: `src/modules/auth/index.ts`
- Modify: `src/modules/auth/routes.ts`
- Modify: `src/modules/auth/types.ts`

- [ ] **Step 1: Add setup step registration to auth module**

In `src/modules/auth/index.ts`:

1. Change `dependencies` to `['permissions', 'setup']`
2. In `onRegister`, after creating tables, register setup steps:

```typescript
import { generateId } from '@shared/crypto'
import { hashPassword } from './providers/local.js'
import { sql } from 'drizzle-orm'

// Inside onRegister, after table creation:
ctx.setup.registerStep({
  id: 'root-owner',
  module: 'auth',
  title: 'Root Owner',
  description: 'Create the main administrator account',
  required: true,
  order: 10,
  fields: [
    { name: 'username', type: 'text', label: 'Username', required: true, placeholder: 'admin' },
    { name: 'password', type: 'password', label: 'Password', required: true },
    { name: 'displayName', type: 'text', label: 'Display Name', required: false, placeholder: 'Admin' },
  ],
  async onComplete(data) {
    const id = generateId()
    const now = new Date().toISOString()
    const pwHash = await hashPassword(data.password as string)
    ctx.db.run(sql`INSERT INTO users (id, username, display_name, password_hash, role, is_root_owner, is_agent, status, created_at, updated_at)
      VALUES (${id}, ${data.username as string}, ${(data.displayName as string) || (data.username as string)}, ${pwHash}, 'owner', 1, 0, 'active', ${now}, ${now})`)
  },
})

ctx.setup.registerStep({
  id: 'first-agent',
  module: 'auth',
  title: 'First Agent',
  description: 'Create your first AI agent',
  required: true,
  order: 20,
  fields: [
    { name: 'name', type: 'text', label: 'Agent Name', required: true, placeholder: 'assistant' },
  ],
  async onComplete(data) {
    const id = generateId()
    const now = new Date().toISOString()
    ctx.db.run(sql`INSERT INTO users (id, username, display_name, password_hash, role, is_root_owner, is_agent, status, created_at, updated_at)
      VALUES (${id}, ${data.name as string}, ${data.name as string}, ${null}, 'agent', 0, 1, 'active', ${now}, ${now})`)
  },
})
```

- [ ] **Step 2: Remove setup endpoints from auth routes**

In `src/modules/auth/routes.ts`:
1. Remove the `setupSchema` import
2. Remove the `// ─── Setup (unauthenticated)` section (the `GET /api/v1/auth/setup/status` and `POST /api/v1/auth/setup` routes)

- [ ] **Step 3: Remove setupSchema from auth types**

In `src/modules/auth/types.ts`, remove the `setupSchema` export.

- [ ] **Step 4: Run TypeScript check**

```bash
cd /Users/eyssen/GitHub/eyas && bunx tsc --noEmit
```

Fix any type errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/auth/index.ts src/modules/auth/routes.ts src/modules/auth/types.ts
git commit -m "refactor(auth): register setup steps via SetupRegistry, remove old setup endpoints"
```

---

## Task 9: Update Auth Tests to Use Test Helper

**Files:**
- Modify: `tests/modules/auth/routes-setup.test.ts` (rewrite to test via setup module)
- Modify: `tests/modules/auth/routes-login.test.ts`
- Modify: `tests/modules/auth/routes-token.test.ts`
- Modify: `tests/modules/auth/routes-users.test.ts`
- Modify: `tests/modules/auth/routes-api-keys.test.ts`

- [ ] **Step 1: Rewrite routes-setup.test.ts**

This test file now tests that the auth module's setup steps work through the setup module API. Replace the entire file:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createTestDb } from '../../helpers/test-db'
import { createSetupRegistry } from '@modules/setup/registry'
import { createSetupRoutes } from '@modules/setup/routes'
import { createAuthRoutes } from '@modules/auth/routes'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createTokenService } from '@modules/auth/token'
import { generateId } from '@shared/crypto'
import { hashPassword } from '@modules/auth/providers/local'
import type { SetupRegistry } from '@modules/setup/types'

const testDb = createTestDb('auth-setup-integration')
let db: ReturnType<typeof testDb.open>
let app: Hono
let setupRegistry: SetupRegistry

beforeEach(() => {
  db = testDb.open()
  setupRegistry = createSetupRegistry(db)

  // Register auth setup steps (same as auth module would)
  setupRegistry.registerStep({
    id: 'root-owner',
    module: 'auth',
    title: 'Root Owner',
    description: 'Create admin account',
    required: true,
    order: 10,
    fields: [
      { name: 'username', type: 'text', label: 'Username', required: true },
      { name: 'password', type: 'password', label: 'Password', required: true },
      { name: 'displayName', type: 'text', label: 'Display Name', required: false },
    ],
    async onComplete(data) {
      const id = generateId()
      const now = new Date().toISOString()
      const pwHash = await hashPassword(data.password as string)
      db.run(sql`INSERT INTO users (id, username, display_name, password_hash, role, is_root_owner, is_agent, status, created_at, updated_at)
        VALUES (${id}, ${data.username as string}, ${(data.displayName as string) || (data.username as string)}, ${pwHash}, 'owner', 1, 0, 'active', ${now}, ${now})`)
    },
  })

  setupRegistry.registerStep({
    id: 'first-agent',
    module: 'auth',
    title: 'First Agent',
    description: 'Create first agent',
    required: true,
    order: 20,
    fields: [
      { name: 'name', type: 'text', label: 'Agent Name', required: true },
    ],
    async onComplete(data) {
      const id = generateId()
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO users (id, username, display_name, password_hash, role, is_root_owner, is_agent, status, created_at, updated_at)
        VALUES (${id}, ${data.name as string}, ${data.name as string}, ${null}, 'agent', 0, 1, 'active', ${now}, ${now})`)
    },
  })

  const permRegistry = createPermissionRegistry()
  const tokenService = createTokenService('test-secret-that-is-at-least-32-characters-long!')
  app = new Hono()
  app.onError(errorHandler)
  createSetupRoutes(app, setupRegistry)
  createAuthRoutes(app, { db, registry: permRegistry, tokenService, sessionDuration: 86400, accessTokenDuration: 900, refreshTokenDuration: 2592000 })
})

afterEach(() => {
  testDb.cleanup()
})

describe('setup wizard — auth steps', () => {
  it('GET /api/v1/setup/status shows incomplete with 2 steps', async () => {
    const res = await app.request('/api/v1/setup/status')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.complete).toBe(false)
    expect(body.totalSteps).toBe(2)
    expect(body.currentStep).toBe('root-owner')
  })

  it('POST root-owner step creates the root user', async () => {
    const res = await app.request('/api/v1/setup/steps/root-owner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'securepass123', displayName: 'Admin' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.step.status).toBe('completed')
  })

  it('POST first-agent step creates an agent user', async () => {
    await setupRegistry.completeStep('root-owner', { username: 'admin', password: 'securepass123' })
    const res = await app.request('/api/v1/setup/steps/first-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'assistant' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.step.status).toBe('completed')
  })

  it('setup is complete after both steps', async () => {
    await setupRegistry.completeStep('root-owner', { username: 'admin', password: 'securepass123' })
    await setupRegistry.completeStep('first-agent', { name: 'assistant' })
    const res = await app.request('/api/v1/setup/status')
    const body = await res.json() as any
    expect(body.complete).toBe(true)
  })

  it('login works after setup is complete', async () => {
    await setupRegistry.completeStep('root-owner', { username: 'admin', password: 'securepass123' })
    await setupRegistry.completeStep('first-agent', { name: 'assistant' })

    const res = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'securepass123' }),
    })
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Update routes-login, routes-token, routes-users, routes-api-keys**

In each of these 4 test files, replace the `beforeEach` to use `insertTestOwner` instead of calling the old setup endpoint. The pattern:

1. Replace the setup endpoint call with:
```typescript
import { createTestDb, insertTestOwner } from '../../helpers/test-db'
```

2. In `beforeEach`, after creating tables and routes, call:
```typescript
await insertTestOwner(db)
```

3. Remove the `POST /api/v1/auth/setup` call.

For files that need a token, keep the `POST /api/v1/auth/token` call (it uses username/password to get a JWT).

- [ ] **Step 3: Run all tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/modules/auth/routes-setup.test.ts tests/modules/auth/routes-login.test.ts tests/modules/auth/routes-token.test.ts tests/modules/auth/routes-users.test.ts tests/modules/auth/routes-api-keys.test.ts
git commit -m "test(auth): update auth tests to use setup module and test helper"
```

---

## Task 10: Env Var Auto-Complete Tests

**Files:**
- Create: `tests/modules/setup/env-auto-complete.test.ts`

- [ ] **Step 1: Write tests**

Create `tests/modules/setup/env-auto-complete.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createSetupRegistry } from '@modules/setup/registry'
import type { SetupRegistry } from '@modules/setup/types'

const testDb = createTestDb('setup-env')
let db: ReturnType<typeof testDb.open>
let registry: SetupRegistry
let completedData: Record<string, Record<string, unknown>>

beforeEach(() => {
  db = testDb.open()
  registry = createSetupRegistry(db)
  completedData = {}

  registry.registerStep({
    id: 'root-owner',
    module: 'auth',
    title: 'Root Owner',
    description: 'Create admin',
    required: true,
    order: 10,
    fields: [
      { name: 'username', type: 'text', label: 'Username', required: true },
      { name: 'password', type: 'password', label: 'Password', required: true },
      { name: 'displayName', type: 'text', label: 'Display Name', required: false },
    ],
    async onComplete(data) { completedData['root-owner'] = data },
  })

  registry.registerStep({
    id: 'first-agent',
    module: 'auth',
    title: 'First Agent',
    description: 'Create agent',
    required: true,
    order: 20,
    fields: [
      { name: 'name', type: 'text', label: 'Agent Name', required: true },
    ],
    async onComplete(data) { completedData['first-agent'] = data },
  })
})

afterEach(() => {
  testDb.cleanup()
  // Clean up env vars
  delete process.env.EYAS_SETUP_USERNAME
  delete process.env.EYAS_SETUP_PASSWORD
  delete process.env.EYAS_SETUP_DISPLAY_NAME
  delete process.env.EYAS_SETUP_AGENT_NAME
})

describe('env var auto-complete', () => {
  it('auto-completes root-owner from env vars', async () => {
    process.env.EYAS_SETUP_USERNAME = 'envadmin'
    process.env.EYAS_SETUP_PASSWORD = 'envpassword123'

    // Simulate what setup module onStart does
    const username = process.env.EYAS_SETUP_USERNAME
    const password = process.env.EYAS_SETUP_PASSWORD
    if (username && password) {
      const step = registry.getStep('root-owner')
      if (step && step.status === 'pending') {
        await registry.completeStep('root-owner', {
          username,
          password,
          displayName: process.env.EYAS_SETUP_DISPLAY_NAME || username,
        })
        delete process.env.EYAS_SETUP_PASSWORD
      }
    }

    expect(registry.getStep('root-owner')?.status).toBe('completed')
    expect(completedData['root-owner'].username).toBe('envadmin')
    expect(process.env.EYAS_SETUP_PASSWORD).toBeUndefined()
  })

  it('auto-completes first-agent from env vars', async () => {
    process.env.EYAS_SETUP_AGENT_NAME = 'bot'

    const agentName = process.env.EYAS_SETUP_AGENT_NAME
    if (agentName) {
      const step = registry.getStep('first-agent')
      if (step && step.status === 'pending') {
        await registry.completeStep('first-agent', { name: agentName })
      }
    }

    expect(registry.getStep('first-agent')?.status).toBe('completed')
    expect(completedData['first-agent'].name).toBe('bot')
  })

  it('does not auto-complete when env vars are missing', async () => {
    // No env vars set
    expect(registry.getStep('root-owner')?.status).toBe('pending')
    expect(registry.getStep('first-agent')?.status).toBe('pending')
  })

  it('does not auto-complete already completed steps', async () => {
    await registry.completeStep('root-owner', { username: 'original', password: 'pass12345678' })

    process.env.EYAS_SETUP_USERNAME = 'override'
    process.env.EYAS_SETUP_PASSWORD = 'overridepass123'

    const step = registry.getStep('root-owner')
    if (step && step.status === 'pending') {
      await registry.completeStep('root-owner', {
        username: process.env.EYAS_SETUP_USERNAME,
        password: process.env.EYAS_SETUP_PASSWORD,
      })
    }

    // Should still be 'original', not 'override'
    expect(completedData['root-owner'].username).toBe('original')
  })
})
```

- [ ] **Step 2: Run tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/setup/env-auto-complete.test.ts
```

Expected: All 4 tests pass.

- [ ] **Step 3: Run all tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run
```

- [ ] **Step 4: Commit**

```bash
git add tests/modules/setup/env-auto-complete.test.ts
git commit -m "test(setup): add env var auto-complete tests"
```

---

## Task 11: Full Integration Smoke Test

**Files:**
- No new files — verification only

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run
```

Expected: All tests pass.

- [ ] **Step 2: TypeScript check**

```bash
cd /Users/eyssen/GitHub/eyas && bunx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Start dev server and test setup flow**

```bash
cd /Users/eyssen/GitHub/eyas && bun run dev &
sleep 3

# Setup should be required
curl -s http://localhost:3000/api/v1/setup/status | jq .

# Non-setup endpoint should return 503
curl -s http://localhost:3000/api/v1/auth/me | jq .

# Get steps
curl -s http://localhost:3000/api/v1/setup/steps | jq .

# Complete root-owner
curl -s -X POST http://localhost:3000/api/v1/setup/steps/root-owner \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"mysecurepassword1","displayName":"Admin"}' | jq .

# Complete first-agent
curl -s -X POST http://localhost:3000/api/v1/setup/steps/first-agent \
  -H "Content-Type: application/json" \
  -d '{"name":"assistant"}' | jq .

# Setup should now be complete
curl -s http://localhost:3000/api/v1/setup/status | jq .

# Login should work now
curl -s -X POST http://localhost:3000/api/v1/auth/token \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"mysecurepassword1"}' | jq .

kill %1
```

- [ ] **Step 4: Fix any issues and commit**

```bash
# Only if fixes needed
git add -A && git commit -m "fix(setup): integration smoke test fixes"
```

---

## Summary

| Task | Description | Tests |
|------|-------------|-------|
| 1 | Setup types | 0 (types only) |
| 2 | Setup Drizzle schema | 0 (schema only) |
| 3 | Test helper (shared DB) | 0 (utility) |
| 4 | SetupRegistry | 13 |
| 5 | Setup guard middleware | 5 |
| 6 | Setup routes | 9 |
| 7 | Setup module + bootstrap | 0 (integration) |
| 8 | Auth refactor (setup steps) | 0 (refactor) |
| 9 | Auth test updates | ~20 (rewritten) |
| 10 | Env var auto-complete tests | 4 |
| 11 | Full smoke test | 0 (manual) |

**Total new tests: ~31 (+ existing auth tests rewritten)**
**No new dependencies**
