# Auth + Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authentication (login, JWT, API keys) and authorization (CASL-based role permissions with modular extension) to EYAS.

**Architecture:** Two modules — `permissions` (foundational, no deps) and `auth` (depends on permissions). Permissions uses CASL for ability-based access control with a PermissionRegistry that other modules can extend. Auth provides hybrid authentication: httpOnly cookie sessions for web UI, Bearer JWT tokens for API/desktop/mobile, and long-lived API keys.

**Tech Stack:** Hono, Drizzle ORM (bun:sqlite), CASL (@casl/ability), jose (JWT), Bun.password (Argon2id)

**Spec:** `docs/superpowers/specs/2026-03-31-auth-permissions-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|----------------|
| `src/modules/permissions/types.ts` | Role, ActionLevel, SubjectRegistration types |
| `src/modules/permissions/schema.ts` | Drizzle `roles` table |
| `src/modules/permissions/registry.ts` | PermissionRegistry — modules register subjects/actions |
| `src/modules/permissions/roles.ts` | CASL AbilityBuilder per role |
| `src/modules/permissions/middleware.ts` | Hono `requirePermission()` middleware |
| `src/modules/permissions/index.ts` | EyasModule implementation |
| `src/modules/auth/types.ts` | User, Session, ApiKey types + Zod schemas |
| `src/modules/auth/schema.ts` | Drizzle `users`, `sessions`, `api_keys` tables |
| `src/modules/auth/providers/local.ts` | Password hash/verify via Bun.password |
| `src/modules/auth/token.ts` | JWT sign/verify + refresh token logic |
| `src/modules/auth/api-key.ts` | API key generation, hashing, validation |
| `src/modules/auth/middleware.ts` | Hono `authenticate()` middleware |
| `src/modules/auth/routes.ts` | All auth/user/api-key endpoints |
| `src/modules/auth/index.ts` | EyasModule implementation |
| `src/shared/crypto.ts` | Shared SHA-256 hash + ULID generation utilities |
| `tests/modules/permissions/types.test.ts` | Permission type tests |
| `tests/modules/permissions/registry.test.ts` | PermissionRegistry tests |
| `tests/modules/permissions/roles.test.ts` | CASL ability building tests |
| `tests/modules/permissions/middleware.test.ts` | requirePermission middleware tests |
| `tests/modules/auth/providers-local.test.ts` | Password hashing tests |
| `tests/modules/auth/token.test.ts` | JWT token tests |
| `tests/modules/auth/api-key.test.ts` | API key tests |
| `tests/modules/auth/middleware.test.ts` | authenticate middleware tests |
| `tests/modules/auth/routes-setup.test.ts` | Setup endpoint tests |
| `tests/modules/auth/routes-login.test.ts` | Login + session tests |
| `tests/modules/auth/routes-token.test.ts` | Bearer token tests |
| `tests/modules/auth/routes-users.test.ts` | User CRUD tests |
| `tests/modules/auth/routes-api-keys.test.ts` | API key endpoint tests |

### Modified Files

| File | Change |
|------|--------|
| `src/core/types.ts` | Add `permissions` to `ModuleContext` interface |
| `src/core/config/schema.ts` | Add `auth` config section (jwtSecret, session/token durations) |
| `src/core/bootstrap.ts` | Create PermissionRegistry, pass in ModuleContext, register modules |
| `src/core/http/middleware/cors.ts` | Add `X-Eyas-Request` to allowed headers |
| `package.json` | Add `jose`, `@casl/ability` dependencies |
| `vitest.config.ts` | Add `src/modules/**/*.ts` to coverage include |

---

## Task 1: Install Dependencies + Config Schema

**Files:**
- Modify: `package.json`
- Modify: `src/core/config/schema.ts`
- Modify: `src/core/types.ts`
- Modify: `vitest.config.ts`
- Test: `tests/core/config.test.ts`

- [ ] **Step 1: Install jose and @casl/ability**

```bash
cd /Users/eyssen/GitHub/eyas && bun add jose @casl/ability
```

Verify both are MIT licensed:
```bash
cat node_modules/jose/package.json | grep '"license"'
cat node_modules/@casl/ability/package.json | grep '"license"'
```

Expected: Both show `"license": "MIT"`

- [ ] **Step 2: Add auth config section to schema**

In `src/core/config/schema.ts`, add the `auth` section to the Zod schema:

```typescript
import { z } from 'zod'
import type { EyasConfig } from '@core/types'

export const configSchema = z.object({
  server: z.object({
    host: z.string().default('0.0.0.0'),
    port: z.number().int().min(1).max(65535).default(3000),
  }).default({}),
  database: z.object({
    path: z.string().default('data/sqlite/eyas.db'),
  }).default({}),
  log: z.object({
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    pretty: z.boolean().default(true),
  }).default({}),
  i18n: z.object({
    defaultLanguage: z.enum(['hu', 'en']).default('hu'),
    fallbackLanguage: z.literal('en').default('en'),
  }).default({}),
  modules: z.object({
    disabled: z.array(z.string()).default([]),
  }).default({}),
  auth: z.object({
    jwtSecret: z.string().min(32).optional(),
    sessionDuration: z.number().int().positive().default(86400),       // 24h in seconds
    accessTokenDuration: z.number().int().positive().default(900),     // 15min in seconds
    refreshTokenDuration: z.number().int().positive().default(2592000), // 30 days in seconds
  }).default({}),
})

export const defaultConfig: EyasConfig = configSchema.parse({})
```

- [ ] **Step 3: Update EyasConfig type**

In `src/core/types.ts`, add the `auth` section to `EyasConfig`:

```typescript
export interface EyasConfig {
  server: { host: string; port: number }
  database: { path: string }
  log: { level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'; pretty: boolean }
  i18n: { defaultLanguage: 'hu' | 'en'; fallbackLanguage: 'en' }
  modules: { disabled: string[] }
  auth: {
    jwtSecret?: string
    sessionDuration: number
    accessTokenDuration: number
    refreshTokenDuration: number
  }
}
```

- [ ] **Step 4: Update vitest coverage to include modules**

In `vitest.config.ts`, change coverage include:

```typescript
coverage: {
  provider: 'v8',
  include: ['src/core/**/*.ts', 'src/modules/**/*.ts', 'src/shared/**/*.ts'],
  exclude: ['src/web/**'],
},
```

- [ ] **Step 5: Run existing tests to verify no breakage**

```bash
cd /Users/eyssen/GitHub/eyas && bun test
```

Expected: All 9 suites, 32 tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/core/config/schema.ts src/core/types.ts vitest.config.ts
git commit -m "feat(auth): add auth config schema, install jose and @casl/ability"
```

---

## Task 2: Shared Crypto Utilities

**Files:**
- Create: `src/shared/crypto.ts`
- Create: `tests/shared/crypto.test.ts`

- [ ] **Step 1: Write failing tests for SHA-256 hash and ULID**

Create `tests/shared/crypto.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { sha256, generateId, constantTimeEqual } from '@shared/crypto'

describe('crypto utilities', () => {
  describe('sha256', () => {
    it('produces a hex string of 64 characters', async () => {
      const hash = await sha256('hello')
      expect(hash).toHaveLength(64)
      expect(hash).toMatch(/^[0-9a-f]+$/)
    })

    it('produces deterministic output', async () => {
      const a = await sha256('test-input')
      const b = await sha256('test-input')
      expect(a).toBe(b)
    })

    it('produces different output for different input', async () => {
      const a = await sha256('input-a')
      const b = await sha256('input-b')
      expect(a).not.toBe(b)
    })
  })

  describe('generateId', () => {
    it('produces a string of 26 characters (ULID format)', () => {
      const id = generateId()
      expect(id).toHaveLength(26)
      expect(id).toMatch(/^[0-9A-Z]+$/)
    })

    it('generates unique IDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateId()))
      expect(ids.size).toBe(100)
    })

    it('is sortable by time (monotonic)', () => {
      const a = generateId()
      const b = generateId()
      expect(b > a).toBe(true)
    })
  })

  describe('constantTimeEqual', () => {
    it('returns true for equal strings', () => {
      expect(constantTimeEqual('abc', 'abc')).toBe(true)
    })

    it('returns false for different strings', () => {
      expect(constantTimeEqual('abc', 'abd')).toBe(false)
    })

    it('returns false for different lengths', () => {
      expect(constantTimeEqual('abc', 'abcd')).toBe(false)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/shared/crypto.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement crypto utilities**

Create `src/shared/crypto.ts`:

```typescript
import { timingSafeEqual } from 'crypto'

export async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = new Uint8Array(hashBuffer)
  return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ULID: Crockford Base32, 10 chars timestamp + 16 chars random, monotonic
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
let lastTime = 0
let lastRandom = 0n

export function generateId(): string {
  let now = Date.now()
  if (now <= lastTime) {
    // Same millisecond: increment random part for monotonicity
    lastRandom += 1n
  } else {
    lastTime = now
    const bytes = new Uint8Array(10)
    crypto.getRandomValues(bytes)
    lastRandom = bytes.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n)
  }

  // Encode timestamp (10 chars)
  let time = ''
  let t = now
  for (let i = 0; i < 10; i++) {
    time = ENCODING[t % 32] + time
    t = Math.floor(t / 32)
  }

  // Encode random (16 chars)
  let random = ''
  let r = lastRandom
  for (let i = 0; i < 16; i++) {
    random = ENCODING[Number(r % 32n)] + random
    r = r / 32n
  }

  return time + random
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return timingSafeEqual(bufA, bufB)
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/shared/crypto.test.ts
```

Expected: All 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/crypto.ts tests/shared/crypto.test.ts
git commit -m "feat(shared): add SHA-256, ULID, and constant-time comparison utilities"
```

---

## Task 3: Permissions Types + Drizzle Schema

**Files:**
- Create: `src/modules/permissions/types.ts`
- Create: `src/modules/permissions/schema.ts`
- Create: `tests/modules/permissions/types.test.ts`

- [ ] **Step 1: Write failing tests for permission types**

Create `tests/modules/permissions/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  ROLES,
  ROLE_HIERARCHY,
  type RoleId,
  type ActionLevel,
  isRoleAtLeast,
} from '@modules/permissions/types'

describe('permission types', () => {
  it('defines all five roles', () => {
    expect(ROLES).toEqual(['owner', 'admin', 'user', 'agent', 'guest'])
  })

  it('defines role hierarchy with numeric levels', () => {
    expect(ROLE_HIERARCHY.owner).toBeGreaterThan(ROLE_HIERARCHY.admin)
    expect(ROLE_HIERARCHY.admin).toBeGreaterThan(ROLE_HIERARCHY.user)
    expect(ROLE_HIERARCHY.user).toBeGreaterThan(ROLE_HIERARCHY.agent)
    expect(ROLE_HIERARCHY.agent).toBeGreaterThan(ROLE_HIERARCHY.guest)
  })

  describe('isRoleAtLeast', () => {
    it('owner is at least admin', () => {
      expect(isRoleAtLeast('owner', 'admin')).toBe(true)
    })

    it('guest is not at least user', () => {
      expect(isRoleAtLeast('guest', 'user')).toBe(false)
    })

    it('role is at least itself', () => {
      expect(isRoleAtLeast('admin', 'admin')).toBe(true)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/permissions/types.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement permission types**

Create `src/modules/permissions/types.ts`:

```typescript
export const ROLES = ['owner', 'admin', 'user', 'agent', 'guest'] as const
export type RoleId = typeof ROLES[number]

export const ROLE_HIERARCHY: Record<RoleId, number> = {
  owner: 50,
  admin: 40,
  user: 30,
  agent: 20,
  guest: 10,
}

export type ActionLevel = 'auto' | 'ask' | 'ask_always'

export interface SubjectRegistration {
  subject: string
  actions: string[]
  fields?: string[]
  defaults?: Partial<Record<RoleId, string[]>>
}

export function isRoleAtLeast(role: RoleId, minimum: RoleId): boolean {
  return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[minimum]
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/permissions/types.test.ts
```

Expected: All 5 tests pass.

- [ ] **Step 5: Create Drizzle schema for roles table**

Create `src/modules/permissions/schema.ts`:

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const roles = sqliteTable('roles', {
  id: text('id').primaryKey(),                    // 'owner' | 'admin' | 'user' | 'agent' | 'guest'
  name: text('name').notNull(),
  description: text('description'),
  isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const SYSTEM_ROLES = [
  { id: 'owner', name: 'Owner', description: 'Full system control — root user', isSystem: true },
  { id: 'admin', name: 'Admin', description: 'Manage users, settings, modules', isSystem: true },
  { id: 'user', name: 'User', description: 'Standard user access', isSystem: true },
  { id: 'agent', name: 'Agent', description: 'AI agent — restricted to explicit permissions', isSystem: true },
  { id: 'guest', name: 'Guest', description: 'Read-only access', isSystem: true },
] as const
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/permissions/types.ts src/modules/permissions/schema.ts tests/modules/permissions/types.test.ts
git commit -m "feat(permissions): add permission types, role hierarchy, and Drizzle schema"
```

---

## Task 4: PermissionRegistry

**Files:**
- Create: `src/modules/permissions/registry.ts`
- Create: `tests/modules/permissions/registry.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/modules/permissions/registry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { createPermissionRegistry } from '@modules/permissions/registry'

describe('PermissionRegistry', () => {
  it('registers a subject with actions', () => {
    const registry = createPermissionRegistry()
    registry.registerSubject('task', {
      actions: ['create', 'read', 'update', 'delete'],
    })
    const subjects = registry.getRegisteredSubjects()
    expect(subjects).toHaveLength(1)
    expect(subjects[0].subject).toBe('task')
    expect(subjects[0].actions).toEqual(['create', 'read', 'update', 'delete'])
  })

  it('registers a subject with role defaults', () => {
    const registry = createPermissionRegistry()
    registry.registerSubject('task', {
      actions: ['create', 'read', 'update', 'delete'],
      defaults: {
        admin: ['create', 'read', 'update', 'delete'],
        user: ['create', 'read'],
        agent: ['read'],
        guest: ['read'],
      },
    })
    const subjects = registry.getRegisteredSubjects()
    expect(subjects[0].defaults?.admin).toEqual(['create', 'read', 'update', 'delete'])
    expect(subjects[0].defaults?.agent).toEqual(['read'])
  })

  it('rejects duplicate subject registration', () => {
    const registry = createPermissionRegistry()
    registry.registerSubject('task', { actions: ['read'] })
    expect(() => registry.registerSubject('task', { actions: ['read'] }))
      .toThrow('Subject "task" is already registered')
  })

  it('rejects actions in defaults that are not in the actions list', () => {
    const registry = createPermissionRegistry()
    expect(() => registry.registerSubject('task', {
      actions: ['read'],
      defaults: { admin: ['read', 'write'] },
    })).toThrow('Unknown action "write" for subject "task"')
  })

  it('returns empty array when no subjects registered', () => {
    const registry = createPermissionRegistry()
    expect(registry.getRegisteredSubjects()).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/permissions/registry.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement PermissionRegistry**

Create `src/modules/permissions/registry.ts`:

```typescript
import type { RoleId, SubjectRegistration } from './types.js'

export interface PermissionRegistry {
  registerSubject(subject: string, config: {
    actions: string[]
    fields?: string[]
    defaults?: Partial<Record<RoleId, string[]>>
  }): void
  getRegisteredSubjects(): SubjectRegistration[]
}

export function createPermissionRegistry(): PermissionRegistry {
  const subjects = new Map<string, SubjectRegistration>()

  return {
    registerSubject(subject, config) {
      if (subjects.has(subject)) {
        throw new Error(`Subject "${subject}" is already registered`)
      }
      const actionSet = new Set(config.actions)
      if (config.defaults) {
        for (const [role, actions] of Object.entries(config.defaults)) {
          for (const action of actions) {
            if (!actionSet.has(action)) {
              throw new Error(`Unknown action "${action}" for subject "${subject}" (role: ${role})`)
            }
          }
        }
      }
      subjects.set(subject, {
        subject,
        actions: config.actions,
        fields: config.fields,
        defaults: config.defaults,
      })
    },

    getRegisteredSubjects() {
      return Array.from(subjects.values())
    },
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/permissions/registry.test.ts
```

Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/permissions/registry.ts tests/modules/permissions/registry.test.ts
git commit -m "feat(permissions): add PermissionRegistry for modular subject/action registration"
```

---

## Task 5: CASL Ability Builder

**Files:**
- Create: `src/modules/permissions/roles.ts`
- Create: `tests/modules/permissions/roles.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/modules/permissions/roles.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'

describe('buildAbilityForRole', () => {
  it('owner can manage everything', () => {
    const registry = createPermissionRegistry()
    const ability = buildAbilityForRole('owner', registry)
    expect(ability.can('manage', 'all')).toBe(true)
    expect(ability.can('delete', 'anything')).toBe(true)
  })

  it('guest can only read by default', () => {
    const registry = createPermissionRegistry()
    registry.registerSubject('task', {
      actions: ['create', 'read', 'update', 'delete'],
      defaults: { guest: ['read'] },
    })
    const ability = buildAbilityForRole('guest', registry)
    expect(ability.can('read', 'task')).toBe(true)
    expect(ability.can('create', 'task')).toBe(false)
    expect(ability.can('delete', 'task')).toBe(false)
  })

  it('admin gets default permissions from registered subjects', () => {
    const registry = createPermissionRegistry()
    registry.registerSubject('task', {
      actions: ['create', 'read', 'update', 'delete'],
      defaults: {
        admin: ['create', 'read', 'update', 'delete'],
        agent: ['read'],
      },
    })
    const ability = buildAbilityForRole('admin', registry)
    expect(ability.can('create', 'task')).toBe(true)
    expect(ability.can('delete', 'task')).toBe(true)
  })

  it('agent only gets explicitly registered permissions', () => {
    const registry = createPermissionRegistry()
    registry.registerSubject('task', {
      actions: ['create', 'read', 'update', 'delete'],
      defaults: { agent: ['read'] },
    })
    const ability = buildAbilityForRole('agent', registry)
    expect(ability.can('read', 'task')).toBe(true)
    expect(ability.can('create', 'task')).toBe(false)
    expect(ability.can('update', 'task')).toBe(false)
  })

  it('handles no registered subjects gracefully', () => {
    const registry = createPermissionRegistry()
    const ability = buildAbilityForRole('user', registry)
    // user with no registered subjects — can manage own 'user' subject (system default)
    expect(ability.can('read', 'user')).toBe(true)
    expect(ability.can('update', 'user')).toBe(true)
  })

  it('admin can manage users (system default)', () => {
    const registry = createPermissionRegistry()
    const ability = buildAbilityForRole('admin', registry)
    expect(ability.can('create', 'user')).toBe(true)
    expect(ability.can('read', 'user')).toBe(true)
    expect(ability.can('update', 'user')).toBe(true)
    expect(ability.can('delete', 'user')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/permissions/roles.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement CASL ability builder**

Create `src/modules/permissions/roles.ts`:

```typescript
import { AbilityBuilder, PureAbility } from '@casl/ability'
import type { PermissionRegistry } from './registry.js'
import type { RoleId } from './types.js'

export type AppAbility = PureAbility<[string, string]>

export function buildAbilityForRole(role: RoleId, registry: PermissionRegistry): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(PureAbility)

  // Owner: unrestricted
  if (role === 'owner') {
    can('manage', 'all')
    return build()
  }

  // System defaults — user management
  if (role === 'admin') {
    can('create', 'user')
    can('read', 'user')
    can('update', 'user')
    can('delete', 'user')
    can('create', 'api_key')
    can('read', 'api_key')
    can('delete', 'api_key')
  }

  // All authenticated roles can read/update own user profile
  if (role === 'admin' || role === 'user' || role === 'agent') {
    can('read', 'user')
    can('update', 'user')
    can('read', 'api_key')
    can('create', 'api_key')
    can('delete', 'api_key')
  }

  // Guest: read-only system default
  if (role === 'guest') {
    can('read', 'user')
  }

  // Module-registered subjects
  for (const reg of registry.getRegisteredSubjects()) {
    const roleDefaults = reg.defaults?.[role]
    if (roleDefaults) {
      for (const action of roleDefaults) {
        can(action, reg.subject)
      }
    }
  }

  return build()
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/permissions/roles.test.ts
```

Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/permissions/roles.ts tests/modules/permissions/roles.test.ts
git commit -m "feat(permissions): add CASL ability builder with role hierarchy and module defaults"
```

---

## Task 6: Permission Middleware

**Files:**
- Create: `src/modules/permissions/middleware.ts`
- Create: `tests/modules/permissions/middleware.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/modules/permissions/middleware.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { requirePermission } from '@modules/permissions/middleware'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'
import type { AppAbility } from '@modules/permissions/roles'

// Helper: create a test app with a user set in context
function createTestApp(ability: AppAbility) {
  const app = new Hono<{ Variables: { ability: AppAbility; userId: string } }>()
  // Simulate authenticate middleware setting the user
  app.use('*', async (c, next) => {
    c.set('ability', ability)
    c.set('userId', 'test-user-id')
    await next()
  })
  return app
}

describe('requirePermission middleware', () => {
  it('allows request when user has permission', async () => {
    const registry = createPermissionRegistry()
    registry.registerSubject('task', {
      actions: ['read'],
      defaults: { admin: ['read'] },
    })
    const ability = buildAbilityForRole('admin', registry)
    const app = createTestApp(ability)
    app.get('/test', requirePermission('read', 'task'), (c) => c.json({ ok: true }))

    const res = await app.request('/test')
    expect(res.status).toBe(200)
  })

  it('denies request when user lacks permission', async () => {
    const registry = createPermissionRegistry()
    registry.registerSubject('task', {
      actions: ['read', 'delete'],
      defaults: { guest: ['read'] },
    })
    const ability = buildAbilityForRole('guest', registry)
    const app = createTestApp(ability)
    app.delete('/test', requirePermission('delete', 'task'), (c) => c.json({ ok: true }))

    const res = await app.request('/test', { method: 'DELETE' })
    expect(res.status).toBe(403)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toContain('Forbidden')
  })

  it('returns 401 when no ability is set (unauthenticated)', async () => {
    const app = new Hono()
    app.get('/test', requirePermission('read', 'task'), (c) => c.json({ ok: true }))

    const res = await app.request('/test')
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/permissions/middleware.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement requirePermission middleware**

Create `src/modules/permissions/middleware.ts`:

```typescript
import type { MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppAbility } from './roles.js'

export const requirePermission = (action: string, subject: string): MiddlewareHandler => {
  return async (c, next) => {
    const ability = c.get('ability') as AppAbility | undefined
    if (!ability) {
      throw new HTTPException(401, { message: 'Unauthorized' })
    }
    if (!ability.can(action, subject)) {
      throw new HTTPException(403, { message: `Forbidden: cannot ${action} ${subject}` })
    }
    await next()
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/permissions/middleware.test.ts
```

Expected: All 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/permissions/middleware.ts tests/modules/permissions/middleware.test.ts
git commit -m "feat(permissions): add requirePermission Hono middleware"
```

---

## Task 7: Permissions Module (EyasModule Wrapper)

**Files:**
- Create: `src/modules/permissions/index.ts`
- Modify: `src/core/types.ts` (add permissions to ModuleContext)
- Modify: `src/core/bootstrap.ts` (create registry, add to context, register module)

- [ ] **Step 1: Add PermissionRegistry to ModuleContext**

In `src/core/types.ts`, add the import type and extend `ModuleContext`:

```typescript
import type { Hono } from 'hono'
import type { Logger } from 'pino'
import type { PermissionRegistry } from '@modules/permissions/registry'

// ... existing interfaces ...

export interface ModuleContext {
  config: EyasConfig
  db: unknown
  bus: EyasBus
  http: Hono
  logger: Logger
  i18n: { t: (key: string) => string }
  hasModule(id: string): boolean
  getModule<T>(id: string): T
  permissions: PermissionRegistry
}
```

- [ ] **Step 2: Create permissions module**

Create `src/modules/permissions/index.ts`:

```typescript
import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { roles, SYSTEM_ROLES } from './schema.js'

export const permissionsModule: EyasModule = {
  id: 'permissions',
  name: 'Permissions',
  version: '1.0.0',
  type: 'core',
  required: true,
  description: 'CASL-based permission engine with modular subject registration',
  dependencies: [],

  async onRegister(ctx: ModuleContext) {
    // Create roles table
    ctx.db.run(sql`
      CREATE TABLE IF NOT EXISTS roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        is_system INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    ctx.logger.info('Permissions module registered')
  },

  async onStart(ctx: ModuleContext) {
    // Seed system roles
    const db = ctx.db
    for (const role of SYSTEM_ROLES) {
      db.run(sql`
        INSERT OR IGNORE INTO roles (id, name, description, is_system)
        VALUES (${role.id}, ${role.name}, ${role.description}, 1)
      `)
    }
    ctx.logger.info('System roles seeded')
  },

  async onStop() {
    // No cleanup needed
  },
}
```

- [ ] **Step 3: Update bootstrap to create PermissionRegistry and register permissions module**

In `src/core/bootstrap.ts`, add registry creation and module registration:

```typescript
import { createLogger } from './logger.js'
import { loadConfig } from './config/loader.js'
import { createDatabase, closeDatabase } from './db/connection.js'
import { createLocalBus } from './bus/local-bus.js'
import { createApp } from './http/server.js'
import { initI18n, getT } from './i18n/setup.js'
import { ModuleLoader } from './module-loader.js'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { permissionsModule } from '@modules/permissions/index'
import type { ModuleContext } from './types.js'

export interface BootstrapOptions {
  configPath?: string
}

let currentContext: ModuleContext | null = null
const moduleLoader = new ModuleLoader()

export async function bootstrap(options: BootstrapOptions = {}): Promise<ModuleContext> {
  const configPath = options.configPath ?? 'config/default.yaml'
  const config = loadConfig(configPath)
  const logger = createLogger({ level: config.log.level, pretty: config.log.pretty })
  logger.info('EYAS bootstrap starting...')

  await initI18n(config.i18n.defaultLanguage)
  const t = getT() as (key: string) => string

  const db = createDatabase(config.database.path)
  logger.info(t('db.connected'))

  const bus = createLocalBus()
  const app = createApp()
  const permissions = createPermissionRegistry()

  const ctx: ModuleContext = {
    config,
    db,
    bus,
    http: app,
    logger,
    i18n: { t },
    hasModule: (id: string) => moduleLoader.hasModule(id),
    getModule: <T>(id: string) => moduleLoader.getModule(id) as T,
    permissions,
  }

  // Register core modules
  moduleLoader.register(permissionsModule)

  await moduleLoader.startAll(ctx, config.modules.disabled)
  logger.info('EYAS bootstrap complete.')
  currentContext = ctx
  return ctx
}

export async function shutdown(): Promise<void> {
  if (currentContext) {
    currentContext.logger.info('EYAS shutting down...')
    await moduleLoader.stopAll(currentContext)
    closeDatabase()
    currentContext = null
  }
}
```

- [ ] **Step 4: Run all tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun test
```

Expected: All existing + new tests pass. The bootstrap test may need adjustment if it creates a `ModuleContext` mock without `permissions` — if so, add the field to the mock.

- [ ] **Step 5: Fix any mock issues in existing tests**

If `tests/core/bootstrap.test.ts` fails, add `permissions` to the expected context shape. Read the test file, identify the mock that needs updating, and add the missing field.

- [ ] **Step 6: Commit**

```bash
git add src/modules/permissions/index.ts src/core/types.ts src/core/bootstrap.ts
git commit -m "feat(permissions): wire permissions module into core bootstrap with PermissionRegistry"
```

---

## Task 8: Auth Types + Drizzle Schema

**Files:**
- Create: `src/modules/auth/types.ts`
- Create: `src/modules/auth/schema.ts`

- [ ] **Step 1: Create auth types with Zod validation schemas**

Create `src/modules/auth/types.ts`:

```typescript
import { z } from 'zod'

// ─── Zod Schemas (input validation) ──────────────────

export const loginSchema = z.object({
  username: z.string().min(3).max(64),
  password: z.string().min(8).max(128),
})

export const setupSchema = z.object({
  username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9_-]+$/, 'Username must be alphanumeric with - and _'),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(128).optional(),
})

export const createUserSchema = z.object({
  username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  password: z.string().min(8).max(128).optional(),  // optional for agents
  displayName: z.string().min(1).max(128),
  email: z.string().email().optional(),
  role: z.enum(['admin', 'user', 'agent', 'guest']),
  isAgent: z.boolean().default(false),
})

export const updateUserSchema = z.object({
  displayName: z.string().min(1).max(128).optional(),
  email: z.string().email().nullable().optional(),
  role: z.enum(['owner', 'admin', 'user', 'agent', 'guest']).optional(),
  status: z.enum(['active', 'suspended']).optional(),
})

export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(128).optional(),
  email: z.string().email().nullable().optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8).max(128).optional(),
}).refine(
  (data) => !data.newPassword || data.currentPassword,
  { message: 'Current password required to set new password', path: ['currentPassword'] }
)

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(128),
  expiresInDays: z.number().int().positive().optional(),
})

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
})

// ─── TypeScript types ────────────────────────────────

export interface AuthUser {
  id: string
  username: string
  displayName: string
  email: string | null
  role: string
  isRootOwner: boolean
  isAgent: boolean
  status: string
  createdAt: string
  updatedAt: string
}

export interface AuthSession {
  id: string
  userId: string
  expiresAt: string
}

export interface AuthApiKey {
  id: string
  userId: string
  name: string
  keyPrefix: string
  lastUsedAt: string | null
  expiresAt: string | null
  createdAt: string
  revokedAt: string | null
}
```

- [ ] **Step 2: Create Drizzle auth schema**

Create `src/modules/auth/schema.ts`:

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  email: text('email').unique(),
  passwordHash: text('password_hash'),
  role: text('role').notNull().default('user'),
  isRootOwner: integer('is_root_owner', { mode: 'boolean' }).notNull().default(false),
  isAgent: integer('is_agent', { mode: 'boolean' }).notNull().default(false),
  status: text('status').notNull().default('active'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: text('expires_at').notNull(),
  userAgent: text('user_agent'),
  ipAddress: text('ip_address'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  keyHash: text('key_hash').notNull(),
  lastUsedAt: text('last_used_at'),
  expiresAt: text('expires_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  revokedAt: text('revoked_at'),
})
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/auth/types.ts src/modules/auth/schema.ts
git commit -m "feat(auth): add auth types, Zod validation schemas, and Drizzle tables"
```

---

## Task 9: Local Auth Provider (Password Hashing)

**Files:**
- Create: `src/modules/auth/providers/local.ts`
- Create: `tests/modules/auth/providers-local.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/modules/auth/providers-local.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '@modules/auth/providers/local'

describe('local auth provider', () => {
  it('hashes a password with Argon2id', async () => {
    const hash = await hashPassword('test-password-123')
    expect(hash).toContain('argon2id')
    expect(hash).not.toBe('test-password-123')
  })

  it('verifies a correct password', async () => {
    const hash = await hashPassword('correct-password')
    const result = await verifyPassword('correct-password', hash)
    expect(result).toBe(true)
  })

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct-password')
    const result = await verifyPassword('wrong-password', hash)
    expect(result).toBe(false)
  })

  it('generates different hashes for the same password (salted)', async () => {
    const hash1 = await hashPassword('same-password')
    const hash2 = await hashPassword('same-password')
    expect(hash1).not.toBe(hash2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/auth/providers-local.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement local auth provider**

Create `src/modules/auth/providers/local.ts`:

```typescript
export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: 'argon2id' })
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash)
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/auth/providers-local.test.ts
```

Expected: All 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/auth/providers/local.ts tests/modules/auth/providers-local.test.ts
git commit -m "feat(auth): add Argon2id password hashing via Bun.password"
```

---

## Task 10: JWT Token Service

**Files:**
- Create: `src/modules/auth/token.ts`
- Create: `tests/modules/auth/token.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/modules/auth/token.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { createTokenService } from '@modules/auth/token'

describe('token service', () => {
  const secret = 'a-very-secret-key-that-is-at-least-32-chars-long!'
  const service = createTokenService(secret)

  describe('access tokens', () => {
    it('creates a valid JWT access token', async () => {
      const token = await service.signAccessToken({ sub: 'user-123', role: 'owner' }, 900)
      expect(token).toBeTruthy()
      expect(typeof token).toBe('string')
      // JWT has three dot-separated parts
      expect(token.split('.')).toHaveLength(3)
    })

    it('verifies a valid access token and returns payload', async () => {
      const token = await service.signAccessToken({ sub: 'user-123', role: 'admin' }, 900)
      const payload = await service.verifyAccessToken(token)
      expect(payload.sub).toBe('user-123')
      expect(payload.role).toBe('admin')
    })

    it('rejects a tampered token', async () => {
      const token = await service.signAccessToken({ sub: 'user-123', role: 'owner' }, 900)
      const tampered = token.slice(0, -5) + 'XXXXX'
      await expect(service.verifyAccessToken(tampered)).rejects.toThrow()
    })

    it('rejects an expired token', async () => {
      const token = await service.signAccessToken({ sub: 'user-123', role: 'owner' }, -1)
      await expect(service.verifyAccessToken(token)).rejects.toThrow()
    })
  })

  describe('refresh tokens', () => {
    it('generates a random refresh token string', () => {
      const token = service.generateRefreshToken()
      expect(token).toBeTruthy()
      expect(token.length).toBeGreaterThanOrEqual(32)
    })

    it('generates unique tokens', () => {
      const tokens = new Set(Array.from({ length: 50 }, () => service.generateRefreshToken()))
      expect(tokens.size).toBe(50)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/auth/token.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement token service**

Create `src/modules/auth/token.ts`:

```typescript
import { SignJWT, jwtVerify } from 'jose'

export interface TokenPayload {
  sub: string
  role: string
}

export interface TokenService {
  signAccessToken(payload: TokenPayload, expiresInSeconds: number): Promise<string>
  verifyAccessToken(token: string): Promise<TokenPayload>
  generateRefreshToken(): string
}

export function createTokenService(secret: string): TokenService {
  const secretKey = new TextEncoder().encode(secret)

  return {
    async signAccessToken(payload, expiresInSeconds) {
      const now = Math.floor(Date.now() / 1000)
      return new SignJWT({ role: payload.role })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(payload.sub)
        .setIssuedAt(now)
        .setExpirationTime(now + expiresInSeconds)
        .sign(secretKey)
    },

    async verifyAccessToken(token) {
      const { payload } = await jwtVerify(token, secretKey, { algorithms: ['HS256'] })
      return {
        sub: payload.sub!,
        role: payload.role as string,
      }
    },

    generateRefreshToken() {
      const bytes = new Uint8Array(32)
      crypto.getRandomValues(bytes)
      return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
    },
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/auth/token.test.ts
```

Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/auth/token.ts tests/modules/auth/token.test.ts
git commit -m "feat(auth): add JWT token service with jose (sign, verify, refresh)"
```

---

## Task 11: API Key Service

**Files:**
- Create: `src/modules/auth/api-key.ts`
- Create: `tests/modules/auth/api-key.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/modules/auth/api-key.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { generateApiKey, hashApiKey, isApiKeyFormat } from '@modules/auth/api-key'

describe('API key service', () => {
  it('generates a key with eyas_k1_ prefix', () => {
    const key = generateApiKey()
    expect(key).toMatch(/^eyas_k1_[a-f0-9]{32}$/)
  })

  it('generates unique keys', () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateApiKey()))
    expect(keys.size).toBe(50)
  })

  it('extracts prefix (first 8 chars after eyas_k1_)', () => {
    const key = generateApiKey()
    const prefix = key.slice(8, 16) // 8 chars after 'eyas_k1_'
    expect(prefix).toHaveLength(8)
  })

  it('hashes a key to a different value', async () => {
    const key = generateApiKey()
    const hash = await hashApiKey(key)
    expect(hash).not.toBe(key)
    expect(hash).toHaveLength(64) // SHA-256 hex
  })

  it('produces deterministic hash for same key', async () => {
    const key = generateApiKey()
    const hash1 = await hashApiKey(key)
    const hash2 = await hashApiKey(key)
    expect(hash1).toBe(hash2)
  })

  it('identifies API key format correctly', () => {
    expect(isApiKeyFormat('eyas_k1_abcdef1234567890abcdef1234567890')).toBe(true)
    expect(isApiKeyFormat('eyJhbGciOiJIUzI1NiJ9.xxx.xxx')).toBe(false)
    expect(isApiKeyFormat('random-string')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/auth/api-key.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement API key service**

Create `src/modules/auth/api-key.ts`:

```typescript
import { sha256 } from '@shared/crypto'

const API_KEY_PREFIX = 'eyas_k1_'

export function generateApiKey(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const random = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  return `${API_KEY_PREFIX}${random}`
}

export function getKeyPrefix(key: string): string {
  return key.slice(API_KEY_PREFIX.length, API_KEY_PREFIX.length + 8)
}

export async function hashApiKey(key: string): Promise<string> {
  return sha256(key)
}

export function isApiKeyFormat(value: string): boolean {
  return value.startsWith(API_KEY_PREFIX) && value.length === API_KEY_PREFIX.length + 32
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/auth/api-key.test.ts
```

Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/auth/api-key.ts tests/modules/auth/api-key.test.ts
git commit -m "feat(auth): add API key generation, hashing, and format detection"
```

---

## Task 12: Authenticate Middleware

**Files:**
- Create: `src/modules/auth/middleware.ts`
- Create: `tests/modules/auth/middleware.test.ts`
- Modify: `src/core/http/middleware/cors.ts`

- [ ] **Step 1: Update CORS to allow X-Eyas-Request header**

In `src/core/http/middleware/cors.ts`:

```typescript
import { cors } from 'hono/cors'

export const corsMiddleware = cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Eyas-Request'],
  maxAge: 86400,
})
```

- [ ] **Step 2: Write failing tests for authenticate middleware**

Create `tests/modules/auth/middleware.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createAuthMiddleware, csrfProtection } from '@modules/auth/middleware'

// Mock dependencies
const mockVerifyAccessToken = vi.fn()
const mockFindSessionByHash = vi.fn()
const mockFindApiKeyByHash = vi.fn()
const mockFindUserById = vi.fn()
const mockBuildAbility = vi.fn()

function createTestApp() {
  const authenticate = createAuthMiddleware({
    verifyAccessToken: mockVerifyAccessToken,
    findSessionByHash: mockFindSessionByHash,
    findApiKeyByHash: mockFindApiKeyByHash,
    findUserById: mockFindUserById,
    buildAbilityForUser: mockBuildAbility,
  })
  const app = new Hono()
  app.get('/protected', authenticate, (c) => {
    return c.json({ userId: c.get('userId'), role: c.get('role') })
  })
  return app
}

describe('authenticate middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when no auth is provided', async () => {
    const app = createTestApp()
    const res = await app.request('/protected')
    expect(res.status).toBe(401)
  })

  it('authenticates via JWT bearer token', async () => {
    mockVerifyAccessToken.mockResolvedValue({ sub: 'user-1', role: 'owner' })
    mockBuildAbility.mockReturnValue({ can: () => true })

    const app = createTestApp()
    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.test.sig' },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.userId).toBe('user-1')
    expect(body.role).toBe('owner')
  })

  it('authenticates via API key', async () => {
    mockFindApiKeyByHash.mockResolvedValue({ userId: 'user-2' })
    mockFindUserById.mockResolvedValue({ id: 'user-2', role: 'agent', status: 'active' })
    mockBuildAbility.mockReturnValue({ can: () => true })

    const app = createTestApp()
    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer eyas_k1_abcdef1234567890abcdef1234567890' },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.userId).toBe('user-2')
  })

  it('authenticates via session cookie', async () => {
    mockFindSessionByHash.mockResolvedValue({ userId: 'user-3', expiresAt: new Date(Date.now() + 86400000).toISOString() })
    mockFindUserById.mockResolvedValue({ id: 'user-3', role: 'owner', status: 'active' })
    mockBuildAbility.mockReturnValue({ can: () => true })

    const app = createTestApp()
    const res = await app.request('/protected', {
      headers: { Cookie: 'eyas_session=some-session-token' },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.userId).toBe('user-3')
  })

  it('rejects expired session', async () => {
    mockFindSessionByHash.mockResolvedValue({ userId: 'user-3', expiresAt: new Date(Date.now() - 1000).toISOString() })

    const app = createTestApp()
    const res = await app.request('/protected', {
      headers: { Cookie: 'eyas_session=expired-token' },
    })
    expect(res.status).toBe(401)
  })

  it('rejects suspended user', async () => {
    mockFindApiKeyByHash.mockResolvedValue({ userId: 'user-4' })
    mockFindUserById.mockResolvedValue({ id: 'user-4', role: 'agent', status: 'suspended' })

    const app = createTestApp()
    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer eyas_k1_abcdef1234567890abcdef1234567890' },
    })
    expect(res.status).toBe(403)
  })
})

describe('csrfProtection middleware', () => {
  it('allows GET requests without header', async () => {
    const app = new Hono()
    app.use('*', csrfProtection)
    app.get('/test', (c) => c.json({ ok: true }))
    const res = await app.request('/test')
    expect(res.status).toBe(200)
  })

  it('blocks POST without X-Eyas-Request header when cookie is present', async () => {
    const app = new Hono()
    app.use('*', csrfProtection)
    app.post('/test', (c) => c.json({ ok: true }))
    const res = await app.request('/test', {
      method: 'POST',
      headers: { Cookie: 'eyas_session=abc', 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(403)
  })

  it('allows POST with X-Eyas-Request header', async () => {
    const app = new Hono()
    app.use('*', csrfProtection)
    app.post('/test', (c) => c.json({ ok: true }))
    const res = await app.request('/test', {
      method: 'POST',
      headers: { Cookie: 'eyas_session=abc', 'X-Eyas-Request': '1', 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(200)
  })

  it('allows POST without cookie (API auth, no CSRF needed)', async () => {
    const app = new Hono()
    app.use('*', csrfProtection)
    app.post('/test', (c) => c.json({ ok: true }))
    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/auth/middleware.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement authenticate middleware**

Create `src/modules/auth/middleware.ts`:

```typescript
import type { MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { getCookie } from 'hono/cookie'
import { sha256 } from '@shared/crypto'
import { isApiKeyFormat } from './api-key.js'
import type { AppAbility } from '@modules/permissions/roles'

export interface AuthMiddlewareDeps {
  verifyAccessToken(token: string): Promise<{ sub: string; role: string }>
  findSessionByHash(hash: string): Promise<{ userId: string; expiresAt: string } | null>
  findApiKeyByHash(hash: string): Promise<{ userId: string } | null>
  findUserById(id: string): Promise<{ id: string; role: string; status: string } | null>
  buildAbilityForUser(role: string): AppAbility
}

export function createAuthMiddleware(deps: AuthMiddlewareDeps): MiddlewareHandler {
  return async (c, next) => {
    // 1. Try session cookie
    const sessionToken = getCookie(c, 'eyas_session')
    if (sessionToken) {
      const hash = await sha256(sessionToken)
      const session = await deps.findSessionByHash(hash)
      if (session) {
        if (new Date(session.expiresAt) < new Date()) {
          throw new HTTPException(401, { message: 'Session expired' })
        }
        const user = await deps.findUserById(session.userId)
        if (!user || user.status !== 'active') {
          throw new HTTPException(403, { message: 'Account suspended or deleted' })
        }
        c.set('userId', user.id)
        c.set('role', user.role)
        c.set('ability', deps.buildAbilityForUser(user.role))
        c.set('authMethod', 'session')
        return next()
      }
    }

    // 2. Try Authorization header
    const authHeader = c.req.header('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)

      // 2a. API key
      if (isApiKeyFormat(token)) {
        const hash = await sha256(token)
        const apiKey = await deps.findApiKeyByHash(hash)
        if (!apiKey) {
          throw new HTTPException(401, { message: 'Invalid API key' })
        }
        const user = await deps.findUserById(apiKey.userId)
        if (!user || user.status !== 'active') {
          throw new HTTPException(403, { message: 'Account suspended or deleted' })
        }
        c.set('userId', user.id)
        c.set('role', user.role)
        c.set('ability', deps.buildAbilityForUser(user.role))
        c.set('authMethod', 'api_key')
        return next()
      }

      // 2b. JWT
      try {
        const payload = await deps.verifyAccessToken(token)
        c.set('userId', payload.sub)
        c.set('role', payload.role)
        c.set('ability', deps.buildAbilityForUser(payload.role))
        c.set('authMethod', 'jwt')
        return next()
      } catch {
        throw new HTTPException(401, { message: 'Invalid or expired token' })
      }
    }

    // 3. No auth
    throw new HTTPException(401, { message: 'Authentication required' })
  }
}

// CSRF protection: require X-Eyas-Request header on mutating requests when using cookie auth
export const csrfProtection: MiddlewareHandler = async (c, next) => {
  const method = c.req.method
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next()
  }
  // Only enforce CSRF when cookie is present (browser requests)
  const hasCookie = c.req.header('Cookie')?.includes('eyas_session')
  if (hasCookie && !c.req.header('X-Eyas-Request')) {
    throw new HTTPException(403, { message: 'CSRF protection: X-Eyas-Request header required' })
  }
  return next()
}
```

- [ ] **Step 5: Run tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/auth/middleware.test.ts
```

Expected: All 9 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/modules/auth/middleware.ts tests/modules/auth/middleware.test.ts src/core/http/middleware/cors.ts
git commit -m "feat(auth): add authenticate middleware (cookie/JWT/API key) and CSRF protection"
```

---

## Task 13: Auth Routes — Setup + Login + Token

**Files:**
- Create: `src/modules/auth/routes.ts`
- Create: `tests/modules/auth/routes-setup.test.ts`
- Create: `tests/modules/auth/routes-login.test.ts`
- Create: `tests/modules/auth/routes-token.test.ts`

This is the largest task — it creates the route file with setup, login, and token endpoints plus three test files. The route file is split into logical route groups but lives in a single file since all routes share the same dependencies.

- [ ] **Step 1: Write failing tests for setup endpoints**

Create `tests/modules/auth/routes-setup.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createDatabase, closeDatabase } from '@core/db/connection'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { createAuthRoutes } from '@modules/auth/routes'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createTokenService } from '@modules/auth/token'

describe('auth setup routes', () => {
  const dbPath = join(tmpdir(), `eyas-auth-setup-${Date.now()}.db`)
  let db: ReturnType<typeof createDatabase>
  let app: Hono

  beforeEach(() => {
    db = createDatabase(dbPath)
    // Create tables
    db.run(sql`CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, is_system INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')))`)
    db.run(sql`INSERT OR IGNORE INTO roles (id, name, description) VALUES ('owner', 'Owner', 'Root user')`)
    db.run(sql`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, email TEXT UNIQUE, password_hash TEXT, role TEXT NOT NULL DEFAULT 'user', is_root_owner INTEGER NOT NULL DEFAULT 0, is_agent INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at TEXT NOT NULL, user_agent TEXT, ip_address TEXT, created_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, key_prefix TEXT NOT NULL, key_hash TEXT NOT NULL, last_used_at TEXT, expires_at TEXT, created_at TEXT NOT NULL, revoked_at TEXT)`)

    const registry = createPermissionRegistry()
    const tokenService = createTokenService('test-secret-that-is-at-least-32-characters-long!')
    app = new Hono()
    createAuthRoutes(app, { db, registry, tokenService, sessionDuration: 86400, accessTokenDuration: 900, refreshTokenDuration: 2592000 })
  })

  afterEach(() => {
    closeDatabase()
    try { rmSync(dbPath) } catch {}
    try { rmSync(`${dbPath}-wal`) } catch {}
    try { rmSync(`${dbPath}-shm`) } catch {}
  })

  it('GET /api/v1/auth/setup/status returns needsSetup: true when no users', async () => {
    const res = await app.request('/api/v1/auth/setup/status')
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.needsSetup).toBe(true)
  })

  it('POST /api/v1/auth/setup creates root owner', async () => {
    const res = await app.request('/api/v1/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'root', password: 'strongpassword1' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body.username).toBe('root')
    expect(body.role).toBe('owner')
    expect(body.isRootOwner).toBe(true)
  })

  it('GET /api/v1/auth/setup/status returns needsSetup: false after setup', async () => {
    await app.request('/api/v1/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'root', password: 'strongpassword1' }),
    })
    const res = await app.request('/api/v1/auth/setup/status')
    const body = await res.json() as Record<string, unknown>
    expect(body.needsSetup).toBe(false)
  })

  it('POST /api/v1/auth/setup returns 404 when user already exists', async () => {
    await app.request('/api/v1/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'root', password: 'strongpassword1' }),
    })
    const res = await app.request('/api/v1/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'another', password: 'strongpassword1' }),
    })
    expect(res.status).toBe(404)
  })

  it('POST /api/v1/auth/setup validates input', async () => {
    const res = await app.request('/api/v1/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ab', password: 'short' }),
    })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Write failing tests for login endpoints**

Create `tests/modules/auth/routes-login.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createDatabase, closeDatabase } from '@core/db/connection'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { createAuthRoutes } from '@modules/auth/routes'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createTokenService } from '@modules/auth/token'

describe('auth login routes', () => {
  const dbPath = join(tmpdir(), `eyas-auth-login-${Date.now()}.db`)
  let db: ReturnType<typeof createDatabase>
  let app: Hono

  beforeEach(async () => {
    db = createDatabase(dbPath)
    db.run(sql`CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, is_system INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')))`)
    db.run(sql`INSERT OR IGNORE INTO roles (id, name, description) VALUES ('owner', 'Owner', 'Root user')`)
    db.run(sql`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, email TEXT UNIQUE, password_hash TEXT, role TEXT NOT NULL DEFAULT 'user', is_root_owner INTEGER NOT NULL DEFAULT 0, is_agent INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at TEXT NOT NULL, user_agent TEXT, ip_address TEXT, created_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, key_prefix TEXT NOT NULL, key_hash TEXT NOT NULL, last_used_at TEXT, expires_at TEXT, created_at TEXT NOT NULL, revoked_at TEXT)`)

    const registry = createPermissionRegistry()
    const tokenService = createTokenService('test-secret-that-is-at-least-32-characters-long!')
    app = new Hono()
    createAuthRoutes(app, { db, registry, tokenService, sessionDuration: 86400, accessTokenDuration: 900, refreshTokenDuration: 2592000 })

    // Create test user via setup
    await app.request('/api/v1/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
    })
  })

  afterEach(() => {
    closeDatabase()
    try { rmSync(dbPath) } catch {}
    try { rmSync(`${dbPath}-wal`) } catch {}
    try { rmSync(`${dbPath}-shm`) } catch {}
  })

  it('POST /api/v1/auth/login sets session cookie', async () => {
    const res = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
    })
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toContain('eyas_session=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')
  })

  it('POST /api/v1/auth/login rejects wrong password', async () => {
    const res = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testowner', password: 'wrongpassword' }),
    })
    expect(res.status).toBe(401)
  })

  it('POST /api/v1/auth/login rejects nonexistent user', async () => {
    const res = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nobody', password: 'testpassword123' }),
    })
    expect(res.status).toBe(401)
  })

  it('GET /api/v1/auth/me returns user from session', async () => {
    const loginRes = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
    })
    const cookie = loginRes.headers.get('set-cookie')!.split(';')[0]

    const meRes = await app.request('/api/v1/auth/me', {
      headers: { Cookie: cookie },
    })
    expect(meRes.status).toBe(200)
    const body = await meRes.json() as Record<string, unknown>
    expect(body.username).toBe('testowner')
    expect(body.role).toBe('owner')
  })

  it('POST /api/v1/auth/logout clears session', async () => {
    const loginRes = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
    })
    const cookie = loginRes.headers.get('set-cookie')!.split(';')[0]

    const logoutRes = await app.request('/api/v1/auth/logout', {
      method: 'POST',
      headers: { Cookie: cookie, 'X-Eyas-Request': '1' },
    })
    expect(logoutRes.status).toBe(200)

    // Session should be invalid now
    const meRes = await app.request('/api/v1/auth/me', {
      headers: { Cookie: cookie },
    })
    expect(meRes.status).toBe(401)
  })
})
```

- [ ] **Step 3: Write failing tests for token endpoints**

Create `tests/modules/auth/routes-token.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createDatabase, closeDatabase } from '@core/db/connection'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { createAuthRoutes } from '@modules/auth/routes'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createTokenService } from '@modules/auth/token'

describe('auth token routes', () => {
  const dbPath = join(tmpdir(), `eyas-auth-token-${Date.now()}.db`)
  let db: ReturnType<typeof createDatabase>
  let app: Hono

  beforeEach(async () => {
    db = createDatabase(dbPath)
    db.run(sql`CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, is_system INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')))`)
    db.run(sql`INSERT OR IGNORE INTO roles (id, name, description) VALUES ('owner', 'Owner', 'Root user')`)
    db.run(sql`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, email TEXT UNIQUE, password_hash TEXT, role TEXT NOT NULL DEFAULT 'user', is_root_owner INTEGER NOT NULL DEFAULT 0, is_agent INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at TEXT NOT NULL, user_agent TEXT, ip_address TEXT, created_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, key_prefix TEXT NOT NULL, key_hash TEXT NOT NULL, last_used_at TEXT, expires_at TEXT, created_at TEXT NOT NULL, revoked_at TEXT)`)

    const registry = createPermissionRegistry()
    const tokenService = createTokenService('test-secret-that-is-at-least-32-characters-long!')
    app = new Hono()
    createAuthRoutes(app, { db, registry, tokenService, sessionDuration: 86400, accessTokenDuration: 900, refreshTokenDuration: 2592000 })

    await app.request('/api/v1/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
    })
  })

  afterEach(() => {
    closeDatabase()
    try { rmSync(dbPath) } catch {}
    try { rmSync(`${dbPath}-wal`) } catch {}
    try { rmSync(`${dbPath}-shm`) } catch {}
  })

  it('POST /api/v1/auth/token returns access + refresh tokens', async () => {
    const res = await app.request('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.accessToken).toBeTruthy()
    expect(body.refreshToken).toBeTruthy()
    expect(body.expiresIn).toBe(900)
  })

  it('GET /api/v1/auth/me works with JWT access token', async () => {
    const tokenRes = await app.request('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
    })
    const { accessToken } = await tokenRes.json() as Record<string, string>

    const meRes = await app.request('/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(meRes.status).toBe(200)
    const body = await meRes.json() as Record<string, unknown>
    expect(body.username).toBe('testowner')
  })

  it('POST /api/v1/auth/token/refresh returns new access token', async () => {
    const tokenRes = await app.request('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
    })
    const { refreshToken } = await tokenRes.json() as Record<string, string>

    const refreshRes = await app.request('/api/v1/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    expect(refreshRes.status).toBe(200)
    const body = await refreshRes.json() as Record<string, unknown>
    expect(body.accessToken).toBeTruthy()
    expect(body.expiresIn).toBe(900)
  })

  it('POST /api/v1/auth/token rejects wrong password', async () => {
    const res = await app.request('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testowner', password: 'wrongpassword' }),
    })
    expect(res.status).toBe(401)
  })

  it('POST /api/v1/auth/token/refresh rejects invalid token', async () => {
    const res = await app.request('/api/v1/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'invalid-token-value' }),
    })
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 4: Implement auth routes**

Create `src/modules/auth/routes.ts`:

```typescript
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { setCookie, getCookie, deleteCookie } from 'hono/cookie'
import { sql, eq } from 'drizzle-orm'
import { generateId, sha256 } from '@shared/crypto'
import { hashPassword, verifyPassword } from './providers/local.js'
import { generateApiKey, getKeyPrefix, hashApiKey, isApiKeyFormat } from './api-key.js'
import { createAuthMiddleware, csrfProtection } from './middleware.js'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { setupSchema, loginSchema, createUserSchema, updateUserSchema, updateProfileSchema, createApiKeySchema, refreshTokenSchema } from './types.js'
import type { PermissionRegistry } from '@modules/permissions/registry'
import type { TokenService } from './token.js'
import type { RoleId } from '@modules/permissions/types'
import { requirePermission } from '@modules/permissions/middleware.js'
import { isRoleAtLeast } from '@modules/permissions/types.js'

export interface AuthRouteDeps {
  db: any
  registry: PermissionRegistry
  tokenService: TokenService
  sessionDuration: number
  accessTokenDuration: number
  refreshTokenDuration: number
}

export function createAuthRoutes(app: Hono, deps: AuthRouteDeps): void {
  const { db, registry, tokenService, sessionDuration, accessTokenDuration, refreshTokenDuration } = deps

  // ─── Helper functions ──────────────────────────

  function getUserCount(): number {
    const result = db.get<{ count: number }>(sql`SELECT COUNT(*) as count FROM users`)
    return (result as any)?.count ?? 0
  }

  function findUserByUsername(username: string) {
    return db.get<Record<string, unknown>>(sql`SELECT * FROM users WHERE username = ${username} AND status = 'active'`)
  }

  function findUserById(id: string) {
    return db.get<Record<string, unknown>>(sql`SELECT * FROM users WHERE id = ${id}`)
  }

  async function findSessionByHash(hash: string) {
    return db.get<Record<string, unknown>>(sql`SELECT * FROM sessions WHERE token_hash = ${hash}`)
  }

  async function findApiKeyByHash(hash: string) {
    return db.get<Record<string, unknown>>(sql`SELECT * FROM api_keys WHERE key_hash = ${hash} AND revoked_at IS NULL`)
  }

  function userToPublic(user: Record<string, unknown>) {
    return {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      email: user.email,
      role: user.role,
      isRootOwner: !!user.is_root_owner,
      isAgent: !!user.is_agent,
      status: user.status,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    }
  }

  // ─── Authenticate middleware ───────────────────

  const authenticate = createAuthMiddleware({
    verifyAccessToken: (token) => tokenService.verifyAccessToken(token),
    findSessionByHash: async (hash) => {
      const s = await findSessionByHash(hash)
      return s ? { userId: s.user_id as string, expiresAt: s.expires_at as string } : null
    },
    findApiKeyByHash: async (hash) => {
      const k = await findApiKeyByHash(hash)
      if (k) {
        // Update lastUsedAt
        db.run(sql`UPDATE api_keys SET last_used_at = ${new Date().toISOString()} WHERE key_hash = ${hash}`)
        return { userId: k.user_id as string }
      }
      return null
    },
    findUserById: async (id) => {
      const u = findUserById(id)
      return u ? { id: u.id as string, role: u.role as string, status: u.status as string } : null
    },
    buildAbilityForUser: (role) => buildAbilityForRole(role as RoleId, registry),
  })

  // ─── CSRF protection on mutation routes ────────

  app.use('/api/v1/auth/*', csrfProtection)
  app.use('/api/v1/users/*', csrfProtection)
  app.use('/api/v1/api-keys/*', csrfProtection)

  // ─── Setup routes ──────────────────────────────

  app.get('/api/v1/auth/setup/status', (c) => {
    return c.json({ needsSetup: getUserCount() === 0 })
  })

  app.post('/api/v1/auth/setup', async (c) => {
    if (getUserCount() > 0) {
      throw new HTTPException(404, { message: 'Not Found' })
    }
    const body = setupSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json({ error: 'Validation failed', details: body.error.issues }, 400)
    }
    const { username, password, displayName } = body.data
    const id = generateId()
    const now = new Date().toISOString()
    const passwordHash = await hashPassword(password)

    db.run(sql`
      INSERT INTO users (id, username, display_name, password_hash, role, is_root_owner, status, created_at, updated_at)
      VALUES (${id}, ${username}, ${displayName ?? username}, ${passwordHash}, 'owner', 1, 'active', ${now}, ${now})
    `)

    const user = findUserById(id)!
    return c.json(userToPublic(user), 201)
  })

  // ─── Login (session cookie) ────────────────────

  app.post('/api/v1/auth/login', async (c) => {
    const body = loginSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json({ error: 'Validation failed', details: body.error.issues }, 400)
    }
    const { username, password } = body.data
    const user = findUserByUsername(username)
    if (!user || !user.password_hash) {
      throw new HTTPException(401, { message: 'Invalid credentials' })
    }
    const valid = await verifyPassword(password, user.password_hash as string)
    if (!valid) {
      throw new HTTPException(401, { message: 'Invalid credentials' })
    }

    // Create session
    const sessionId = generateId()
    const sessionToken = crypto.randomUUID()
    const tokenHash = await sha256(sessionToken)
    const expiresAt = new Date(Date.now() + sessionDuration * 1000).toISOString()
    const now = new Date().toISOString()

    db.run(sql`
      INSERT INTO sessions (id, user_id, token_hash, expires_at, user_agent, ip_address, created_at)
      VALUES (${sessionId}, ${user.id as string}, ${tokenHash}, ${expiresAt}, ${c.req.header('User-Agent') ?? null}, ${null}, ${now})
    `)

    setCookie(c, 'eyas_session', sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      path: '/',
      maxAge: sessionDuration,
    })

    return c.json({ message: 'Logged in', user: userToPublic(user) })
  })

  // ─── Token (Bearer JWT) ────────────────────────

  app.post('/api/v1/auth/token', async (c) => {
    const body = loginSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json({ error: 'Validation failed', details: body.error.issues }, 400)
    }
    const { username, password } = body.data
    const user = findUserByUsername(username)
    if (!user || !user.password_hash) {
      throw new HTTPException(401, { message: 'Invalid credentials' })
    }
    const valid = await verifyPassword(password, user.password_hash as string)
    if (!valid) {
      throw new HTTPException(401, { message: 'Invalid credentials' })
    }

    const accessToken = await tokenService.signAccessToken(
      { sub: user.id as string, role: user.role as string },
      accessTokenDuration,
    )
    const refreshToken = tokenService.generateRefreshToken()
    const refreshHash = await sha256(refreshToken)
    const expiresAt = new Date(Date.now() + refreshTokenDuration * 1000).toISOString()
    const now = new Date().toISOString()

    // Store refresh token as a session
    db.run(sql`
      INSERT INTO sessions (id, user_id, token_hash, expires_at, user_agent, ip_address, created_at)
      VALUES (${generateId()}, ${user.id as string}, ${refreshHash}, ${expiresAt}, ${c.req.header('User-Agent') ?? null}, ${null}, ${now})
    `)

    return c.json({ accessToken, refreshToken, expiresIn: accessTokenDuration })
  })

  app.post('/api/v1/auth/token/refresh', async (c) => {
    const body = refreshTokenSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json({ error: 'Validation failed', details: body.error.issues }, 400)
    }
    const hash = await sha256(body.data.refreshToken)
    const session = db.get<Record<string, unknown>>(sql`SELECT * FROM sessions WHERE token_hash = ${hash}`)
    if (!session || new Date(session.expires_at as string) < new Date()) {
      throw new HTTPException(401, { message: 'Invalid or expired refresh token' })
    }
    const user = findUserById(session.user_id as string)
    if (!user || user.status !== 'active') {
      throw new HTTPException(401, { message: 'Account not active' })
    }

    const accessToken = await tokenService.signAccessToken(
      { sub: user.id as string, role: user.role as string },
      accessTokenDuration,
    )

    return c.json({ accessToken, expiresIn: accessTokenDuration })
  })

  // ─── Logout ────────────────────────────────────

  app.post('/api/v1/auth/logout', authenticate, async (c) => {
    const sessionToken = getCookie(c, 'eyas_session')
    if (sessionToken) {
      const hash = await sha256(sessionToken)
      db.run(sql`DELETE FROM sessions WHERE token_hash = ${hash}`)
    }
    deleteCookie(c, 'eyas_session', { path: '/' })
    return c.json({ message: 'Logged out' })
  })

  // ─── Me ────────────────────────────────────────

  app.get('/api/v1/auth/me', authenticate, (c) => {
    const userId = c.get('userId') as string
    const user = findUserById(userId)
    if (!user) throw new HTTPException(404, { message: 'User not found' })
    return c.json(userToPublic(user))
  })

  app.patch('/api/v1/auth/me', authenticate, async (c) => {
    const userId = c.get('userId') as string
    const body = updateProfileSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json({ error: 'Validation failed', details: body.error.issues }, 400)
    }
    const user = findUserById(userId)
    if (!user) throw new HTTPException(404, { message: 'User not found' })

    const updates: string[] = []
    const now = new Date().toISOString()

    if (body.data.displayName !== undefined) {
      db.run(sql`UPDATE users SET display_name = ${body.data.displayName}, updated_at = ${now} WHERE id = ${userId}`)
    }
    if (body.data.email !== undefined) {
      db.run(sql`UPDATE users SET email = ${body.data.email}, updated_at = ${now} WHERE id = ${userId}`)
    }
    if (body.data.newPassword && body.data.currentPassword) {
      const valid = await verifyPassword(body.data.currentPassword, user.password_hash as string)
      if (!valid) throw new HTTPException(400, { message: 'Current password is incorrect' })
      const hash = await hashPassword(body.data.newPassword)
      db.run(sql`UPDATE users SET password_hash = ${hash}, updated_at = ${now} WHERE id = ${userId}`)
    }

    const updated = findUserById(userId)!
    return c.json(userToPublic(updated))
  })

  // ─── Users CRUD (owner/admin) ──────────────────

  app.get('/api/v1/users', authenticate, requirePermission('read', 'user'), (c) => {
    const rows = db.all<Record<string, unknown>>(sql`SELECT * FROM users WHERE status != 'deleted' ORDER BY created_at`)
    const users = (rows as Record<string, unknown>[]).map(userToPublic)
    return c.json({ users })
  })

  app.post('/api/v1/users', authenticate, requirePermission('create', 'user'), async (c) => {
    const body = createUserSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json({ error: 'Validation failed', details: body.error.issues }, 400)
    }
    const { username, password, displayName, email, role, isAgent } = body.data

    // Cannot create owner via this endpoint
    if (role === 'owner') {
      throw new HTTPException(403, { message: 'Cannot create owner role via this endpoint' })
    }

    // Check caller's role is high enough
    const callerRole = c.get('role') as RoleId
    if (!isRoleAtLeast(callerRole, role as RoleId)) {
      throw new HTTPException(403, { message: 'Cannot create user with equal or higher role' })
    }

    const id = generateId()
    const now = new Date().toISOString()
    const passwordHash = password ? await hashPassword(password) : null

    db.run(sql`
      INSERT INTO users (id, username, display_name, email, password_hash, role, is_agent, status, created_at, updated_at)
      VALUES (${id}, ${username}, ${displayName}, ${email ?? null}, ${passwordHash}, ${role}, ${isAgent ? 1 : 0}, 'active', ${now}, ${now})
    `)

    const user = findUserById(id)!
    return c.json(userToPublic(user), 201)
  })

  app.get('/api/v1/users/:id', authenticate, requirePermission('read', 'user'), (c) => {
    const user = findUserById(c.req.param('id'))
    if (!user) throw new HTTPException(404, { message: 'User not found' })
    return c.json(userToPublic(user))
  })

  app.patch('/api/v1/users/:id', authenticate, requirePermission('update', 'user'), async (c) => {
    const targetId = c.req.param('id')
    const target = findUserById(targetId)
    if (!target) throw new HTTPException(404, { message: 'User not found' })

    // Root owner protection
    if (target.is_root_owner) {
      const body = await c.req.json() as Record<string, unknown>
      if (body.role && body.role !== 'owner') {
        throw new HTTPException(403, { message: 'Cannot change root owner role' })
      }
      if (body.status === 'suspended') {
        throw new HTTPException(403, { message: 'Cannot suspend root owner' })
      }
    }

    const body = updateUserSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json({ error: 'Validation failed', details: body.error.issues }, 400)
    }

    const now = new Date().toISOString()
    if (body.data.displayName !== undefined) {
      db.run(sql`UPDATE users SET display_name = ${body.data.displayName}, updated_at = ${now} WHERE id = ${targetId}`)
    }
    if (body.data.email !== undefined) {
      db.run(sql`UPDATE users SET email = ${body.data.email}, updated_at = ${now} WHERE id = ${targetId}`)
    }
    if (body.data.role !== undefined) {
      db.run(sql`UPDATE users SET role = ${body.data.role}, updated_at = ${now} WHERE id = ${targetId}`)
    }
    if (body.data.status !== undefined) {
      db.run(sql`UPDATE users SET status = ${body.data.status}, updated_at = ${now} WHERE id = ${targetId}`)
    }

    const updated = findUserById(targetId)!
    return c.json(userToPublic(updated))
  })

  app.delete('/api/v1/users/:id', authenticate, requirePermission('delete', 'user'), (c) => {
    const targetId = c.req.param('id')
    const target = findUserById(targetId)
    if (!target) throw new HTTPException(404, { message: 'User not found' })

    if (target.is_root_owner) {
      throw new HTTPException(403, { message: 'Cannot delete root owner' })
    }

    const now = new Date().toISOString()
    db.run(sql`UPDATE users SET status = 'deleted', updated_at = ${now} WHERE id = ${targetId}`)
    return c.json({ message: 'User deleted' })
  })

  // ─── API Keys ──────────────────────────────────

  app.get('/api/v1/api-keys', authenticate, (c) => {
    const userId = c.get('userId') as string
    const rows = db.all<Record<string, unknown>>(sql`SELECT id, user_id, name, key_prefix, last_used_at, expires_at, created_at, revoked_at FROM api_keys WHERE user_id = ${userId} AND revoked_at IS NULL ORDER BY created_at DESC`)
    return c.json({ apiKeys: rows })
  })

  app.post('/api/v1/api-keys', authenticate, async (c) => {
    const body = createApiKeySchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json({ error: 'Validation failed', details: body.error.issues }, 400)
    }

    const userId = c.get('userId') as string
    const rawKey = generateApiKey()
    const keyHash = await hashApiKey(rawKey)
    const keyPrefix = getKeyPrefix(rawKey)
    const id = generateId()
    const now = new Date().toISOString()
    const expiresAt = body.data.expiresInDays
      ? new Date(Date.now() + body.data.expiresInDays * 86400000).toISOString()
      : null

    db.run(sql`
      INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, expires_at, created_at)
      VALUES (${id}, ${userId}, ${body.data.name}, ${keyPrefix}, ${keyHash}, ${expiresAt}, ${now})
    `)

    // Return the raw key ONCE — never stored or retrievable again
    return c.json({ id, name: body.data.name, key: rawKey, keyPrefix, expiresAt, createdAt: now }, 201)
  })

  app.delete('/api/v1/api-keys/:id', authenticate, async (c) => {
    const keyId = c.req.param('id')
    const userId = c.get('userId') as string
    const now = new Date().toISOString()

    const key = db.get<Record<string, unknown>>(sql`SELECT * FROM api_keys WHERE id = ${keyId} AND user_id = ${userId}`)
    if (!key) throw new HTTPException(404, { message: 'API key not found' })

    db.run(sql`UPDATE api_keys SET revoked_at = ${now} WHERE id = ${keyId}`)
    return c.json({ message: 'API key revoked' })
  })
}
```

- [ ] **Step 5: Run all three test files**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/auth/routes-setup.test.ts tests/modules/auth/routes-login.test.ts tests/modules/auth/routes-token.test.ts
```

Expected: All tests pass (5 setup + 5 login + 5 token = 15 tests).

- [ ] **Step 6: Commit**

```bash
git add src/modules/auth/routes.ts tests/modules/auth/routes-setup.test.ts tests/modules/auth/routes-login.test.ts tests/modules/auth/routes-token.test.ts
git commit -m "feat(auth): add auth routes — setup, login, token, logout, me, users CRUD, API keys"
```

---

## Task 14: User CRUD + API Key Route Tests

**Files:**
- Create: `tests/modules/auth/routes-users.test.ts`
- Create: `tests/modules/auth/routes-api-keys.test.ts`

- [ ] **Step 1: Write user CRUD tests**

Create `tests/modules/auth/routes-users.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createDatabase, closeDatabase } from '@core/db/connection'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { createAuthRoutes } from '@modules/auth/routes'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createTokenService } from '@modules/auth/token'

describe('user CRUD routes', () => {
  const dbPath = join(tmpdir(), `eyas-auth-users-${Date.now()}.db`)
  let db: ReturnType<typeof createDatabase>
  let app: Hono
  let ownerToken: string

  beforeEach(async () => {
    db = createDatabase(dbPath)
    db.run(sql`CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, is_system INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')))`)
    db.run(sql`INSERT OR IGNORE INTO roles (id, name, description) VALUES ('owner', 'Owner', 'Root user'), ('admin', 'Admin', 'Admin'), ('agent', 'Agent', 'Agent'), ('guest', 'Guest', 'Guest'), ('user', 'User', 'User')`)
    db.run(sql`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, email TEXT UNIQUE, password_hash TEXT, role TEXT NOT NULL DEFAULT 'user', is_root_owner INTEGER NOT NULL DEFAULT 0, is_agent INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at TEXT NOT NULL, user_agent TEXT, ip_address TEXT, created_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, key_prefix TEXT NOT NULL, key_hash TEXT NOT NULL, last_used_at TEXT, expires_at TEXT, created_at TEXT NOT NULL, revoked_at TEXT)`)

    const registry = createPermissionRegistry()
    const tokenService = createTokenService('test-secret-that-is-at-least-32-characters-long!')
    app = new Hono()
    createAuthRoutes(app, { db, registry, tokenService, sessionDuration: 86400, accessTokenDuration: 900, refreshTokenDuration: 2592000 })

    // Setup owner
    await app.request('/api/v1/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
    })

    // Get token
    const tokenRes = await app.request('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
    })
    const tokenBody = await tokenRes.json() as Record<string, string>
    ownerToken = tokenBody.accessToken
  })

  afterEach(() => {
    closeDatabase()
    try { rmSync(dbPath) } catch {}
    try { rmSync(`${dbPath}-wal`) } catch {}
    try { rmSync(`${dbPath}-shm`) } catch {}
  })

  it('GET /api/v1/users lists all users', async () => {
    const res = await app.request('/api/v1/users', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { users: unknown[] }
    expect(body.users).toHaveLength(1)
  })

  it('POST /api/v1/users creates an agent', async () => {
    const res = await app.request('/api/v1/users', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'agent-1', displayName: 'Test Agent', role: 'agent', isAgent: true }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body.username).toBe('agent-1')
    expect(body.isAgent).toBe(true)
    expect(body.role).toBe('agent')
  })

  it('POST /api/v1/users rejects owner role creation', async () => {
    const res = await app.request('/api/v1/users', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'bad', displayName: 'Bad', role: 'owner' }),
    })
    expect(res.status).toBe(400) // Zod rejects 'owner' in createUserSchema enum
  })

  it('DELETE /api/v1/users/:id soft-deletes a user', async () => {
    // Create user first
    const createRes = await app.request('/api/v1/users', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'delete-me', displayName: 'Delete Me', role: 'user' }),
    })
    const { id } = await createRes.json() as { id: string }

    const deleteRes = await app.request(`/api/v1/users/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(deleteRes.status).toBe(200)
  })

  it('DELETE /api/v1/users/:id protects root owner', async () => {
    // Find root owner id
    const listRes = await app.request('/api/v1/users', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    const { users } = await listRes.json() as { users: { id: string; isRootOwner: boolean }[] }
    const rootId = users.find(u => u.isRootOwner)!.id

    const res = await app.request(`/api/v1/users/${rootId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(403)
  })

  it('PATCH /api/v1/users/:id protects root owner role change', async () => {
    const listRes = await app.request('/api/v1/users', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    const { users } = await listRes.json() as { users: { id: string; isRootOwner: boolean }[] }
    const rootId = users.find(u => u.isRootOwner)!.id

    const res = await app.request(`/api/v1/users/${rootId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    })
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: Write API key endpoint tests**

Create `tests/modules/auth/routes-api-keys.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createDatabase, closeDatabase } from '@core/db/connection'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { createAuthRoutes } from '@modules/auth/routes'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createTokenService } from '@modules/auth/token'

describe('API key routes', () => {
  const dbPath = join(tmpdir(), `eyas-auth-apikeys-${Date.now()}.db`)
  let db: ReturnType<typeof createDatabase>
  let app: Hono
  let ownerToken: string

  beforeEach(async () => {
    db = createDatabase(dbPath)
    db.run(sql`CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, is_system INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')))`)
    db.run(sql`INSERT OR IGNORE INTO roles (id, name, description) VALUES ('owner', 'Owner', 'Root user')`)
    db.run(sql`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, email TEXT UNIQUE, password_hash TEXT, role TEXT NOT NULL DEFAULT 'user', is_root_owner INTEGER NOT NULL DEFAULT 0, is_agent INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at TEXT NOT NULL, user_agent TEXT, ip_address TEXT, created_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, key_prefix TEXT NOT NULL, key_hash TEXT NOT NULL, last_used_at TEXT, expires_at TEXT, created_at TEXT NOT NULL, revoked_at TEXT)`)

    const registry = createPermissionRegistry()
    const tokenService = createTokenService('test-secret-that-is-at-least-32-characters-long!')
    app = new Hono()
    createAuthRoutes(app, { db, registry, tokenService, sessionDuration: 86400, accessTokenDuration: 900, refreshTokenDuration: 2592000 })

    await app.request('/api/v1/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
    })

    const tokenRes = await app.request('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
    })
    ownerToken = ((await tokenRes.json()) as Record<string, string>).accessToken
  })

  afterEach(() => {
    closeDatabase()
    try { rmSync(dbPath) } catch {}
    try { rmSync(`${dbPath}-wal`) } catch {}
    try { rmSync(`${dbPath}-shm`) } catch {}
  })

  it('POST /api/v1/api-keys creates a key and returns it once', async () => {
    const res = await app.request('/api/v1/api-keys', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test-key' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body.key).toBeTruthy()
    expect((body.key as string)).toMatch(/^eyas_k1_/)
    expect(body.name).toBe('test-key')
  })

  it('GET /api/v1/api-keys lists keys without raw key value', async () => {
    await app.request('/api/v1/api-keys', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'listed-key' }),
    })

    const res = await app.request('/api/v1/api-keys', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { apiKeys: Record<string, unknown>[] }
    expect(body.apiKeys).toHaveLength(1)
    expect(body.apiKeys[0].key_hash).toBeUndefined() // Not exposed
  })

  it('DELETE /api/v1/api-keys/:id revokes a key', async () => {
    const createRes = await app.request('/api/v1/api-keys', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'revoke-me' }),
    })
    const { id } = await createRes.json() as { id: string }

    const deleteRes = await app.request(`/api/v1/api-keys/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(deleteRes.status).toBe(200)

    // Should not appear in list
    const listRes = await app.request('/api/v1/api-keys', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    const body = await listRes.json() as { apiKeys: unknown[] }
    expect(body.apiKeys).toHaveLength(0)
  })

  it('API key can be used for authentication', async () => {
    const createRes = await app.request('/api/v1/api-keys', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'auth-key' }),
    })
    const { key } = await createRes.json() as { key: string }

    const meRes = await app.request('/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${key}` },
    })
    expect(meRes.status).toBe(200)
    const body = await meRes.json() as Record<string, unknown>
    expect(body.username).toBe('testowner')
  })
})
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/auth/routes-users.test.ts tests/modules/auth/routes-api-keys.test.ts
```

Expected: All tests pass (6 user tests + 4 API key tests = 10 tests).

- [ ] **Step 4: Commit**

```bash
git add tests/modules/auth/routes-users.test.ts tests/modules/auth/routes-api-keys.test.ts
git commit -m "test(auth): add user CRUD and API key route tests"
```

---

## Task 15: Auth Module (EyasModule Wrapper) + Bootstrap Integration

**Files:**
- Create: `src/modules/auth/index.ts`
- Modify: `src/core/bootstrap.ts` (register auth module)

- [ ] **Step 1: Create auth module**

Create `src/modules/auth/index.ts`:

```typescript
import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { createAuthRoutes } from './routes.js'
import { createTokenService } from './token.js'

export const authModule: EyasModule = {
  id: 'auth',
  name: 'Auth',
  version: '1.0.0',
  type: 'core',
  required: true,
  description: 'Authentication — users, sessions, JWT tokens, API keys',
  dependencies: ['permissions'],

  async onRegister(ctx: ModuleContext) {
    ctx.db.run(sql`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        email TEXT UNIQUE,
        password_hash TEXT,
        role TEXT NOT NULL DEFAULT 'user',
        is_root_owner INTEGER NOT NULL DEFAULT 0,
        is_agent INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
    ctx.db.run(sql`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        user_agent TEXT,
        ip_address TEXT,
        created_at TEXT NOT NULL
      )
    `)
    ctx.db.run(sql`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        key_prefix TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        last_used_at TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        revoked_at TEXT
      )
    `)
    ctx.logger.info('Auth module registered')
  },

  async onStart(ctx: ModuleContext) {
    // Auto-generate JWT secret if not configured
    let jwtSecret = ctx.config.auth.jwtSecret
    if (!jwtSecret) {
      const bytes = new Uint8Array(32)
      crypto.getRandomValues(bytes)
      jwtSecret = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
      ctx.logger.warn('JWT secret auto-generated — set auth.jwtSecret in config for persistence across restarts')
    }

    const tokenService = createTokenService(jwtSecret)

    createAuthRoutes(ctx.http, {
      db: ctx.db,
      registry: ctx.permissions,
      tokenService,
      sessionDuration: ctx.config.auth.sessionDuration,
      accessTokenDuration: ctx.config.auth.accessTokenDuration,
      refreshTokenDuration: ctx.config.auth.refreshTokenDuration,
    })

    ctx.logger.info('Auth module started')
  },

  async onStop() {
    // No cleanup needed
  },
}
```

- [ ] **Step 2: Register auth module in bootstrap**

In `src/core/bootstrap.ts`, add the import and registration:

```typescript
import { createLogger } from './logger.js'
import { loadConfig } from './config/loader.js'
import { createDatabase, closeDatabase } from './db/connection.js'
import { createLocalBus } from './bus/local-bus.js'
import { createApp } from './http/server.js'
import { initI18n, getT } from './i18n/setup.js'
import { ModuleLoader } from './module-loader.js'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { permissionsModule } from '@modules/permissions/index'
import { authModule } from '@modules/auth/index'
import type { ModuleContext } from './types.js'

export interface BootstrapOptions {
  configPath?: string
}

let currentContext: ModuleContext | null = null
const moduleLoader = new ModuleLoader()

export async function bootstrap(options: BootstrapOptions = {}): Promise<ModuleContext> {
  const configPath = options.configPath ?? 'config/default.yaml'
  const config = loadConfig(configPath)
  const logger = createLogger({ level: config.log.level, pretty: config.log.pretty })
  logger.info('EYAS bootstrap starting...')

  await initI18n(config.i18n.defaultLanguage)
  const t = getT() as (key: string) => string

  const db = createDatabase(config.database.path)
  logger.info(t('db.connected'))

  const bus = createLocalBus()
  const app = createApp()
  const permissions = createPermissionRegistry()

  const ctx: ModuleContext = {
    config,
    db,
    bus,
    http: app,
    logger,
    i18n: { t },
    hasModule: (id: string) => moduleLoader.hasModule(id),
    getModule: <T>(id: string) => moduleLoader.getModule(id) as T,
    permissions,
  }

  // Register core modules
  moduleLoader.register(permissionsModule)
  moduleLoader.register(authModule)

  await moduleLoader.startAll(ctx, config.modules.disabled)
  logger.info('EYAS bootstrap complete.')
  currentContext = ctx
  return ctx
}

export async function shutdown(): Promise<void> {
  if (currentContext) {
    currentContext.logger.info('EYAS shutting down...')
    await moduleLoader.stopAll(currentContext)
    closeDatabase()
    currentContext = null
  }
}
```

- [ ] **Step 3: Run all tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun test
```

Expected: All tests pass — both existing Phase 0 tests and all new auth/permissions tests.

- [ ] **Step 4: Fix any failures**

If any existing tests fail due to the new `permissions` field in `ModuleContext` or the added `auth` config section, update those test mocks accordingly.

- [ ] **Step 5: Commit**

```bash
git add src/modules/auth/index.ts src/core/bootstrap.ts
git commit -m "feat(auth): wire auth module into bootstrap with JWT auto-generation"
```

---

## Task 16: Full Integration Smoke Test

**Files:**
- No new files — manual verification

- [ ] **Step 1: Run the full test suite**

```bash
cd /Users/eyssen/GitHub/eyas && bun test
```

Expected: All suites pass (original 9 + new test files).

- [ ] **Step 2: Start the dev server**

```bash
cd /Users/eyssen/GitHub/eyas && bun run dev
```

Verify in logs:
- "Permissions module registered"
- "System roles seeded"
- "Auth module registered"
- "Auth module started"
- Server starts on configured port

- [ ] **Step 3: Test setup flow via curl**

```bash
# Check setup status
curl -s http://localhost:3000/api/v1/auth/setup/status | jq .

# Create root owner
curl -s -X POST http://localhost:3000/api/v1/auth/setup \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"mysecurepassword1"}' | jq .

# Login
curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"mysecurepassword1"}' -v 2>&1 | grep -i set-cookie

# Get token
curl -s -X POST http://localhost:3000/api/v1/auth/token \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"mysecurepassword1"}' | jq .
```

- [ ] **Step 4: Stop dev server (Ctrl+C) and commit if any fixes were needed**

```bash
# Only if changes were made
git add -A && git commit -m "fix(auth): integration smoke test fixes"
```

---

## Summary

| Task | Description | Tests |
|------|-------------|-------|
| 1 | Dependencies + config schema | 0 (existing pass) |
| 2 | Shared crypto utilities | 7 |
| 3 | Permission types + Drizzle schema | 5 |
| 4 | PermissionRegistry | 5 |
| 5 | CASL ability builder | 6 |
| 6 | Permission middleware | 3 |
| 7 | Permissions module wrapper | 0 (integration) |
| 8 | Auth types + Drizzle schema | 0 (types only) |
| 9 | Local auth provider | 4 |
| 10 | JWT token service | 5 |
| 11 | API key service | 6 |
| 12 | Authenticate middleware | 9 |
| 13 | Auth routes (setup/login/token) | 15 |
| 14 | User CRUD + API key tests | 10 |
| 15 | Auth module wrapper + bootstrap | 0 (integration) |
| 16 | Full smoke test | 0 (manual) |

**Total new tests: ~75**
**New dependencies: jose, @casl/ability (both MIT)**
