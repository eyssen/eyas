# Enhanced Provider Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full provider configuration UI with dynamic model lists, per-model enable/disable, hot-reload, and Claude Code CLI provider.

**Architecture:** SQLite tables (`provider_config`, `model_config`) store enable/disable state and cached model lists. A `ProviderConfigService` provides CRUD. The gateway gains `unregisterProvider()` and enabled-model filtering. Each provider submodule reads config from DB on start. Frontend replaces the simple dialog with a slideout panel showing models and API key management.

**Tech Stack:** Drizzle ORM (SQLite), Hono, Vitest, React 19, shadcn/ui, TanStack Router, `@anthropic-ai/claude-code` SDK

---

### Task 1: Database Tables for Provider and Model Config

**Files:**
- Create: `src/modules/model/schema.ts`
- Modify: `tests/helpers/test-db.ts:16-23`

- [ ] **Step 1: Write the failing test for provider_config table**

Create `tests/modules/model/provider-config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'

const testDb = createTestDb('provider-config')
let db: ReturnType<typeof testDb.open>

beforeEach(() => { db = testDb.open() })
afterEach(() => testDb.cleanup())

describe('provider_config table', () => {
  it('creates provider_config row', () => {
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO provider_config (id, enabled, settings, updated_at) VALUES ('anthropic', 1, '{}', ${now})`)
    const rows = db.all(sql`SELECT * FROM provider_config WHERE id = 'anthropic'`) as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('anthropic')
    expect(rows[0].enabled).toBe(1)
  })

  it('enforces primary key uniqueness', () => {
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO provider_config (id, enabled, settings, updated_at) VALUES ('openai', 1, '{}', ${now})`)
    expect(() => {
      db.run(sql`INSERT INTO provider_config (id, enabled, settings, updated_at) VALUES ('openai', 1, '{}', ${now})`)
    }).toThrow()
  })
})

describe('model_config table', () => {
  it('creates model_config row with FK to provider_config', () => {
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO provider_config (id, enabled, settings, updated_at) VALUES ('anthropic', 1, '{}', ${now})`)
    db.run(sql`INSERT INTO model_config (id, provider_id, model_id, enabled, name, context_window, max_output_tokens, supports_tools, supports_images, supports_streaming, updated_at) VALUES ('anthropic:claude-sonnet-4-5', 'anthropic', 'claude-sonnet-4-5-20250514', 1, 'Claude Sonnet 4.5', 200000, 16000, 1, 1, 1, ${now})`)
    const rows = db.all(sql`SELECT * FROM model_config WHERE provider_id = 'anthropic'`) as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0].model_id).toBe('claude-sonnet-4-5-20250514')
  })

  it('can disable a model', () => {
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO provider_config (id, enabled, settings, updated_at) VALUES ('openai', 1, '{}', ${now})`)
    db.run(sql`INSERT INTO model_config (id, provider_id, model_id, enabled, name, context_window, max_output_tokens, supports_tools, supports_images, supports_streaming, updated_at) VALUES ('openai:gpt-4o', 'openai', 'gpt-4o', 1, 'GPT-4o', 128000, 16384, 1, 1, 1, ${now})`)
    db.run(sql`UPDATE model_config SET enabled = 0 WHERE id = 'openai:gpt-4o'`)
    const rows = db.all(sql`SELECT enabled FROM model_config WHERE id = 'openai:gpt-4o'`) as any[]
    expect(rows[0].enabled).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/model/provider-config.test.ts`
Expected: FAIL — table `provider_config` does not exist

- [ ] **Step 3: Create schema file and update test-db helper**

Create `src/modules/model/schema.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const providerConfig = sqliteTable('provider_config', {
  id: text('id').primaryKey(),
  enabled: integer('enabled').notNull().default(1),
  settings: text('settings').default('{}'),
  updatedAt: text('updated_at').notNull(),
})

export const modelConfig = sqliteTable('model_config', {
  id: text('id').primaryKey(),
  providerId: text('provider_id').notNull().references(() => providerConfig.id),
  modelId: text('model_id').notNull(),
  enabled: integer('enabled').notNull().default(1),
  name: text('name').notNull(),
  contextWindow: integer('context_window'),
  maxOutputTokens: integer('max_output_tokens'),
  supportsTools: integer('supports_tools').default(1),
  supportsImages: integer('supports_images').default(1),
  supportsStreaming: integer('supports_streaming').default(1),
  updatedAt: text('updated_at').notNull(),
})
```

Add to `tests/helpers/test-db.ts` inside the `open()` function, after the existing `CREATE TABLE` statements (after line 22):

```typescript
    db.run(sql`CREATE TABLE IF NOT EXISTS provider_config (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, settings TEXT DEFAULT '{}', updated_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS model_config (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES provider_config(id), model_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, name TEXT NOT NULL, context_window INTEGER, max_output_tokens INTEGER, supports_tools INTEGER DEFAULT 1, supports_images INTEGER DEFAULT 1, supports_streaming INTEGER DEFAULT 1, updated_at TEXT NOT NULL)`)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest run tests/modules/model/provider-config.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/modules/model/schema.ts tests/modules/model/provider-config.test.ts tests/helpers/test-db.ts
git commit -m "feat(model): add provider_config and model_config DB tables"
```

---

### Task 2: ProviderConfigService — CRUD Operations

**Files:**
- Create: `src/modules/model/provider-config-service.ts`
- Create: `tests/modules/model/provider-config-service.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/modules/model/provider-config-service.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import { createProviderConfigService } from '@modules/model/provider-config-service'

const testDb = createTestDb('provider-config-service')
let db: ReturnType<typeof testDb.open>

beforeEach(() => { db = testDb.open() })
afterEach(() => testDb.cleanup())

describe('ProviderConfigService', () => {
  describe('ensureProvider', () => {
    it('creates provider_config row if missing', () => {
      const svc = createProviderConfigService(db)
      const config = svc.ensureProvider('anthropic')
      expect(config.id).toBe('anthropic')
      expect(config.enabled).toBe(true)
    })

    it('returns existing row without overwriting', () => {
      const svc = createProviderConfigService(db)
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO provider_config (id, enabled, settings, updated_at) VALUES ('openai', 0, '{"custom":true}', ${now})`)
      const config = svc.ensureProvider('openai')
      expect(config.enabled).toBe(false)
      expect(config.settings).toEqual({ custom: true })
    })
  })

  describe('getProvider', () => {
    it('returns null for missing provider', () => {
      const svc = createProviderConfigService(db)
      expect(svc.getProvider('nonexistent')).toBeNull()
    })
  })

  describe('updateProvider', () => {
    it('updates enabled flag', () => {
      const svc = createProviderConfigService(db)
      svc.ensureProvider('anthropic')
      svc.updateProvider('anthropic', { enabled: false })
      const config = svc.getProvider('anthropic')
      expect(config!.enabled).toBe(false)
    })
  })

  describe('listProviders', () => {
    it('returns all provider configs', () => {
      const svc = createProviderConfigService(db)
      svc.ensureProvider('anthropic')
      svc.ensureProvider('openai')
      const list = svc.listProviders()
      expect(list).toHaveLength(2)
    })
  })

  describe('model config', () => {
    it('upserts models from ModelInfo array', () => {
      const svc = createProviderConfigService(db)
      svc.ensureProvider('anthropic')
      svc.upsertModels('anthropic', [
        { id: 'claude-sonnet-4-5-20250514', name: 'Claude Sonnet 4.5', provider: 'anthropic', contextWindow: 200000, maxOutputTokens: 16000, supportsTools: true, supportsImages: true, supportsStreaming: true },
      ])
      const models = svc.listModels('anthropic')
      expect(models).toHaveLength(1)
      expect(models[0].modelId).toBe('claude-sonnet-4-5-20250514')
      expect(models[0].enabled).toBe(true)
    })

    it('preserves enabled flag on upsert', () => {
      const svc = createProviderConfigService(db)
      svc.ensureProvider('openai')
      svc.upsertModels('openai', [
        { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', contextWindow: 128000, maxOutputTokens: 16384, supportsTools: true, supportsImages: true, supportsStreaming: true },
      ])
      svc.updateModel('openai:gpt-4o', { enabled: false })
      // Upsert again — enabled should stay false
      svc.upsertModels('openai', [
        { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', contextWindow: 128000, maxOutputTokens: 16384, supportsTools: true, supportsImages: true, supportsStreaming: true },
      ])
      const models = svc.listModels('openai')
      expect(models[0].enabled).toBe(false)
    })

    it('updateModel changes enabled', () => {
      const svc = createProviderConfigService(db)
      svc.ensureProvider('gemini')
      svc.upsertModels('gemini', [
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'gemini', contextWindow: 1048576, maxOutputTokens: 8192, supportsTools: true, supportsImages: true, supportsStreaming: true },
      ])
      svc.updateModel('gemini:gemini-2.0-flash', { enabled: false })
      const models = svc.listModels('gemini')
      expect(models[0].enabled).toBe(false)
    })

    it('listEnabledModels returns only enabled models as ModelInfo', () => {
      const svc = createProviderConfigService(db)
      svc.ensureProvider('anthropic')
      svc.upsertModels('anthropic', [
        { id: 'model-a', name: 'A', provider: 'anthropic', contextWindow: 200000, maxOutputTokens: 16000, supportsTools: true, supportsImages: true, supportsStreaming: true },
        { id: 'model-b', name: 'B', provider: 'anthropic', contextWindow: 200000, maxOutputTokens: 16000, supportsTools: true, supportsImages: true, supportsStreaming: true },
      ])
      svc.updateModel('anthropic:model-b', { enabled: false })
      const enabled = svc.listEnabledModels('anthropic')
      expect(enabled).toHaveLength(1)
      expect(enabled[0].id).toBe('model-a')
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/model/provider-config-service.test.ts`
Expected: FAIL — cannot resolve `@modules/model/provider-config-service`

- [ ] **Step 3: Implement ProviderConfigService**

Create `src/modules/model/provider-config-service.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { ModelInfo } from './types.js'

export interface ProviderConfigRow {
  id: string
  enabled: boolean
  settings: Record<string, unknown>
  updatedAt: string
}

export interface ModelConfigRow {
  id: string
  providerId: string
  modelId: string
  enabled: boolean
  name: string
  contextWindow: number | null
  maxOutputTokens: number | null
  supportsTools: boolean
  supportsImages: boolean
  supportsStreaming: boolean
  updatedAt: string
}

export interface ProviderConfigService {
  ensureProvider(id: string): ProviderConfigRow
  getProvider(id: string): ProviderConfigRow | null
  updateProvider(id: string, update: { enabled?: boolean; settings?: Record<string, unknown> }): void
  listProviders(): ProviderConfigRow[]
  upsertModels(providerId: string, models: ModelInfo[]): void
  listModels(providerId: string): ModelConfigRow[]
  listEnabledModels(providerId: string): ModelInfo[]
  updateModel(id: string, update: { enabled?: boolean }): void
}

export function createProviderConfigService(db: any): ProviderConfigService {
  function toRow(raw: any): ProviderConfigRow {
    return {
      id: raw.id,
      enabled: raw.enabled === 1,
      settings: JSON.parse(raw.settings || '{}'),
      updatedAt: raw.updated_at,
    }
  }

  function toModelRow(raw: any): ModelConfigRow {
    return {
      id: raw.id,
      providerId: raw.provider_id,
      modelId: raw.model_id,
      enabled: raw.enabled === 1,
      name: raw.name,
      contextWindow: raw.context_window,
      maxOutputTokens: raw.max_output_tokens,
      supportsTools: raw.supports_tools === 1,
      supportsImages: raw.supports_images === 1,
      supportsStreaming: raw.supports_streaming === 1,
      updatedAt: raw.updated_at,
    }
  }

  function modelRowToInfo(row: ModelConfigRow): ModelInfo {
    return {
      id: row.modelId,
      name: row.name,
      provider: row.providerId,
      contextWindow: row.contextWindow ?? 0,
      maxOutputTokens: row.maxOutputTokens ?? 0,
      supportsTools: row.supportsTools,
      supportsImages: row.supportsImages,
      supportsStreaming: row.supportsStreaming,
    }
  }

  return {
    ensureProvider(id: string): ProviderConfigRow {
      const existing = db.all(sql`SELECT * FROM provider_config WHERE id = ${id}`) as any[]
      if (existing.length > 0) return toRow(existing[0])
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO provider_config (id, enabled, settings, updated_at) VALUES (${id}, 1, '{}', ${now})`)
      return { id, enabled: true, settings: {}, updatedAt: now }
    },

    getProvider(id: string): ProviderConfigRow | null {
      const rows = db.all(sql`SELECT * FROM provider_config WHERE id = ${id}`) as any[]
      return rows.length > 0 ? toRow(rows[0]) : null
    },

    updateProvider(id: string, update: { enabled?: boolean; settings?: Record<string, unknown> }): void {
      const now = new Date().toISOString()
      if (update.enabled !== undefined) {
        db.run(sql`UPDATE provider_config SET enabled = ${update.enabled ? 1 : 0}, updated_at = ${now} WHERE id = ${id}`)
      }
      if (update.settings !== undefined) {
        db.run(sql`UPDATE provider_config SET settings = ${JSON.stringify(update.settings)}, updated_at = ${now} WHERE id = ${id}`)
      }
    },

    listProviders(): ProviderConfigRow[] {
      const rows = db.all(sql`SELECT * FROM provider_config ORDER BY id`) as any[]
      return rows.map(toRow)
    },

    upsertModels(providerId: string, models: ModelInfo[]): void {
      const now = new Date().toISOString()
      for (const m of models) {
        const compositeId = `${providerId}:${m.id}`
        const existing = db.all(sql`SELECT enabled FROM model_config WHERE id = ${compositeId}`) as any[]
        const enabled = existing.length > 0 ? existing[0].enabled : 1
        db.run(sql`INSERT OR REPLACE INTO model_config (id, provider_id, model_id, enabled, name, context_window, max_output_tokens, supports_tools, supports_images, supports_streaming, updated_at)
          VALUES (${compositeId}, ${providerId}, ${m.id}, ${enabled}, ${m.name}, ${m.contextWindow}, ${m.maxOutputTokens}, ${m.supportsTools ? 1 : 0}, ${m.supportsImages ? 1 : 0}, ${m.supportsStreaming ? 1 : 0}, ${now})`)
      }
    },

    listModels(providerId: string): ModelConfigRow[] {
      const rows = db.all(sql`SELECT * FROM model_config WHERE provider_id = ${providerId} ORDER BY name`) as any[]
      return rows.map(toModelRow)
    },

    listEnabledModels(providerId: string): ModelInfo[] {
      const rows = db.all(sql`SELECT * FROM model_config WHERE provider_id = ${providerId} AND enabled = 1 ORDER BY name`) as any[]
      return rows.map(toModelRow).map(modelRowToInfo)
    },

    updateModel(id: string, update: { enabled?: boolean }): void {
      const now = new Date().toISOString()
      if (update.enabled !== undefined) {
        db.run(sql`UPDATE model_config SET enabled = ${update.enabled ? 1 : 0}, updated_at = ${now} WHERE id = ${id}`)
      }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest run tests/modules/model/provider-config-service.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/modules/model/provider-config-service.ts tests/modules/model/provider-config-service.test.ts
git commit -m "feat(model): add ProviderConfigService for provider/model CRUD"
```

---

### Task 3: Extend Types — fetchModels, ProviderListItem, ProviderDetail

**Files:**
- Modify: `src/modules/model/types.ts:98-115`

- [ ] **Step 1: Update AIProvider interface and add response types**

In `src/modules/model/types.ts`, add `fetchModels?()` to `AIProvider` and add new response types at the end:

After line 103 (`stream(request: ModelRequest): AsyncIterable<StreamEvent>`), add:

```typescript
  fetchModels?(): Promise<ModelInfo[]>
```

After line 115 (end of `ModelGateway` interface), add:

```typescript

// ─── Enhanced Provider Types ──────────────────

export interface ProviderListItem {
  id: string
  name: string
  enabled: boolean
  active: boolean
  hasApiKey: boolean | null
  modelCount: number
  enabledModelCount: number
}

export interface ProviderDetail {
  id: string
  name: string
  enabled: boolean
  active: boolean
  hasApiKey: boolean | null
  models: ModelConfigItem[]
}

export interface ModelConfigItem {
  id: string
  modelId: string
  name: string
  enabled: boolean
  contextWindow: number | null
  maxOutputTokens: number | null
  supportsTools: boolean
  supportsImages: boolean
  supportsStreaming: boolean
}
```

- [ ] **Step 2: Add unregisterProvider to ModelGateway interface**

In `src/modules/model/types.ts`, add to the `ModelGateway` interface (after `registerProvider`):

```typescript
  unregisterProvider(id: string): void
```

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `bun vitest run tests/modules/model/`
Expected: ALL PASS — the new optional method and new types don't break existing code

- [ ] **Step 4: Commit**

```bash
git add src/modules/model/types.ts
git commit -m "feat(model): extend types with fetchModels, provider list/detail types"
```

---

### Task 4: Gateway Changes — unregisterProvider + Model Config Integration

**Files:**
- Modify: `src/modules/model/gateway.ts`
- Modify: `tests/modules/model/gateway.test.ts`

- [ ] **Step 1: Write failing tests for new gateway behavior**

Add to `tests/modules/model/gateway.test.ts`, inside the outer `describe('ModelGateway')` block:

```typescript
  describe('unregisterProvider', () => {
    it('removes a registered provider', () => {
      const provider = createMockProvider('provider-a', [mockModelA])
      gateway.registerProvider(provider)
      expect(gateway.getProvider('provider-a')).toBeDefined()
      gateway.unregisterProvider('provider-a')
      expect(gateway.getProvider('provider-a')).toBeUndefined()
    })

    it('invalidates model cache on unregister', async () => {
      gateway.registerProvider(createMockProvider('provider-a', [mockModelA]))
      // Warm cache
      await gateway.complete({ model: 'model-a', messages: [{ role: 'user', content: 'hi' }] })
      gateway.unregisterProvider('provider-a')
      await expect(gateway.complete({
        model: 'model-a',
        messages: [{ role: 'user', content: 'hi' }],
      })).rejects.toThrow('No provider found for model: model-a')
    })

    it('is a no-op for unknown provider', () => {
      expect(() => gateway.unregisterProvider('unknown')).not.toThrow()
    })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/model/gateway.test.ts`
Expected: FAIL — `gateway.unregisterProvider is not a function`

- [ ] **Step 3: Implement unregisterProvider**

In `src/modules/model/gateway.ts`, add to the returned object (after `registerProvider`):

```typescript
    unregisterProvider(id: string) {
      providers.delete(id)
      modelCache = null
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest run tests/modules/model/gateway.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/model/gateway.ts tests/modules/model/gateway.test.ts
git commit -m "feat(model): add unregisterProvider to gateway"
```

---

### Task 5: New and Modified API Endpoints

**Files:**
- Modify: `src/modules/model/routes.ts`
- Modify: `src/modules/auth/index.ts:138`
- Create: `tests/modules/model/routes-providers.test.ts`

- [ ] **Step 1: Write failing tests for new endpoints**

Create `tests/modules/model/routes-providers.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createTestDb, insertTestOwner } from '../../helpers/test-db'
import { createModelRoutes } from '@modules/model/routes'
import { createModelGateway } from '@modules/model/gateway'
import { createProviderConfigService } from '@modules/model/provider-config-service'
import { createAuthRoutes } from '@modules/auth/routes'
import { createAuthMiddleware } from '@modules/auth/middleware'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createTokenService } from '@modules/auth/token'
import { buildAbilityForRole } from '@modules/permissions/roles'
import type { AIProvider, ModelInfo, ModelRequest, ModelResponse, StreamEvent } from '@modules/model/types'
import type { ProviderConfigService } from '@modules/model/provider-config-service'

function createMockProvider(id = 'mock', models?: ModelInfo[]): AIProvider {
  const defaultModels: ModelInfo[] = [{
    id: 'mock-model', name: 'Mock Model', provider: id,
    contextWindow: 100000, maxOutputTokens: 4096,
    supportsTools: true, supportsImages: true, supportsStreaming: true,
  }]
  return {
    id,
    name: `Mock ${id}`,
    async listModels() { return models ?? defaultModels },
    async complete(): Promise<ModelResponse> {
      return {
        id: 'resp-1', provider: id, model: 'mock-model',
        content: [{ type: 'text', text: 'Mock response' }],
        stopReason: 'end', usage: { inputTokens: 10, outputTokens: 5 },
      }
    },
    async *stream(): AsyncIterable<StreamEvent> {
      yield { type: 'text', text: 'Mock stream' }
      yield {
        type: 'done', response: {
          id: 'resp-1', provider: id, model: 'mock-model',
          content: [{ type: 'text', text: 'Mock stream' }],
          stopReason: 'end', usage: { inputTokens: 10, outputTokens: 5 },
        },
      }
    },
  }
}

const testDb = createTestDb('routes-providers')
let db: ReturnType<typeof testDb.open>
let app: Hono
let ownerToken: string
let configService: ProviderConfigService

beforeEach(async () => {
  db = testDb.open()
  const gateway = createModelGateway()
  gateway.registerProvider(createMockProvider('anthropic'))
  configService = createProviderConfigService(db)
  configService.ensureProvider('anthropic')
  configService.upsertModels('anthropic', [{
    id: 'mock-model', name: 'Mock Model', provider: 'anthropic',
    contextWindow: 100000, maxOutputTokens: 4096,
    supportsTools: true, supportsImages: true, supportsStreaming: true,
  }])

  app = new Hono()
  app.onError(errorHandler)
  const permRegistry = createPermissionRegistry()
  const tokenService = createTokenService('test-jwt-secret')
  const ownerId = await insertTestOwner(db)
  const ability = buildAbilityForRole('owner')
  permRegistry.setAbility(ownerId, ability)
  const authMiddleware = createAuthMiddleware({ db, permissionRegistry: permRegistry, tokenService })
  createAuthRoutes(app, { db, registry: permRegistry, tokenService, sessionDuration: 3600, accessTokenDuration: 900, refreshTokenDuration: 86400 })
  createModelRoutes(app, gateway, authMiddleware, configService)

  // Login to get token
  const loginRes = await app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
  })
  const loginData = await loginRes.json() as any
  ownerToken = loginData.accessToken
})

afterEach(() => testDb.cleanup())

describe('GET /api/v1/model/providers', () => {
  it('returns enhanced provider list with enabled/active/modelCount', async () => {
    const res = await app.request('/api/v1/model/providers', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.providers).toHaveLength(1)
    expect(data.providers[0]).toMatchObject({
      id: 'anthropic',
      enabled: true,
      active: true,
      modelCount: 1,
      enabledModelCount: 1,
    })
  })
})

describe('GET /api/v1/model/providers/:id', () => {
  it('returns provider detail with models', async () => {
    const res = await app.request('/api/v1/model/providers/anthropic', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.id).toBe('anthropic')
    expect(data.models).toHaveLength(1)
    expect(data.models[0]).toHaveProperty('enabled')
    expect(data.models[0]).toHaveProperty('modelId')
  })
})

describe('PATCH /api/v1/model/providers/:id', () => {
  it('updates provider enabled flag', async () => {
    const res = await app.request('/api/v1/model/providers/anthropic', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    })
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.enabled).toBe(false)
  })
})

describe('PATCH /api/v1/model/providers/:id/models/:modelId', () => {
  it('updates model enabled flag', async () => {
    const res = await app.request('/api/v1/model/providers/anthropic/models/anthropic:mock-model', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    })
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.enabled).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/model/routes-providers.test.ts`
Expected: FAIL — `createModelRoutes` does not accept `configService` argument

- [ ] **Step 3: Rewrite routes.ts with enhanced endpoints**

Replace `src/modules/model/routes.ts` with:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono, MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ModelGateway, ProviderListItem, ModelConfigItem } from './types.js'
import type { ProviderConfigService } from './provider-config-service.js'

export function createModelRoutes(
  app: Hono,
  gateway: ModelGateway,
  authenticate?: MiddlewareHandler,
  configService?: ProviderConfigService,
): void {
  const router = app as any

  if (authenticate) {
    router.use('/api/v1/model/*', authenticate)
  }

  // ─── Enhanced Provider List ─────────────────────
  router.get('/api/v1/model/providers', async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })

    if (!configService) {
      // Fallback: legacy behavior
      const providers = gateway.listProviders()
      const result = await Promise.all(providers.map(async p => {
        const models = await p.listModels()
        return { id: p.id, name: p.name, modelCount: models.length }
      }))
      return c.json({ providers: result })
    }

    const configs = configService.listProviders()
    const providers: ProviderListItem[] = configs.map(cfg => {
      const provider = gateway.getProvider(cfg.id)
      const models = configService.listModels(cfg.id)
      const enabledModels = models.filter(m => m.enabled)
      return {
        id: cfg.id,
        name: provider?.name ?? cfg.id,
        enabled: cfg.enabled,
        active: cfg.enabled && !!provider,
        hasApiKey: provider ? true : null,
        modelCount: models.length,
        enabledModelCount: enabledModels.length,
      }
    })
    return c.json({ providers })
  })

  // ─── Provider Detail ────────────────────────────
  router.get('/api/v1/model/providers/:id', async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })

    const id = c.req.param('id')

    if (!configService) {
      const provider = gateway.getProvider(id)
      if (!provider) throw new HTTPException(404, { message: 'Provider not found' })
      const models = await provider.listModels()
      return c.json({ id: provider.id, name: provider.name, models })
    }

    const cfg = configService.getProvider(id)
    if (!cfg) throw new HTTPException(404, { message: 'Provider not found' })
    const provider = gateway.getProvider(id)
    const modelRows = configService.listModels(id)
    const models: ModelConfigItem[] = modelRows.map(m => ({
      id: m.id,
      modelId: m.modelId,
      name: m.name,
      enabled: m.enabled,
      contextWindow: m.contextWindow,
      maxOutputTokens: m.maxOutputTokens,
      supportsTools: m.supportsTools,
      supportsImages: m.supportsImages,
      supportsStreaming: m.supportsStreaming,
    }))

    return c.json({
      id: cfg.id,
      name: provider?.name ?? cfg.id,
      enabled: cfg.enabled,
      active: cfg.enabled && !!provider,
      hasApiKey: provider ? true : null,
      models,
    })
  })

  // ─── Update Provider Config ─────────────────────
  router.patch('/api/v1/model/providers/:id', async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    if (!configService) throw new HTTPException(501, { message: 'Config service not available' })

    const id = c.req.param('id')
    const body = await c.req.json()
    configService.updateProvider(id, body)
    const updated = configService.getProvider(id)
    return c.json(updated)
  })

  // ─── Hot-Reload Provider ────────────────────────
  router.post('/api/v1/model/providers/:id/reload', async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })

    const id = c.req.param('id')
    // Unregister existing
    gateway.unregisterProvider(id)
    // The actual re-registration is done by the caller (frontend triggers, submodule re-inits)
    // For now, return the updated status
    const cfg = configService?.getProvider(id)
    const provider = gateway.getProvider(id)
    return c.json({
      id,
      enabled: cfg?.enabled ?? false,
      active: !!provider,
    })
  })

  // ─── Refresh Models from API ────────────────────
  router.post('/api/v1/model/providers/:id/models/refresh', async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    if (!configService) throw new HTTPException(501, { message: 'Config service not available' })

    const id = c.req.param('id')
    const provider = gateway.getProvider(id)
    if (!provider) throw new HTTPException(404, { message: 'Provider not active' })

    let models
    if (provider.fetchModels) {
      models = await provider.fetchModels()
    } else {
      models = await provider.listModels()
    }
    configService.upsertModels(id, models)
    return c.json({ modelCount: models.length, models: configService.listModels(id) })
  })

  // ─── Update Model Config ────────────────────────
  router.patch('/api/v1/model/providers/:id/models/:modelId', async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    if (!configService) throw new HTTPException(501, { message: 'Config service not available' })

    const modelId = c.req.param('modelId')
    const body = await c.req.json()
    configService.updateModel(modelId, body)
    const models = configService.listModels(c.req.param('id'))
    const updated = models.find(m => m.id === modelId)
    return c.json(updated)
  })

  // ─── All Models ─────────────────────────────────
  router.get('/api/v1/model/models', async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    const models = await gateway.listAllModels()
    return c.json({ models })
  })

  // ─── Complete / Stream (unchanged) ──────────────
  router.post('/api/v1/model/complete', async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    const body = await c.req.json()
    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      throw new HTTPException(400, { message: 'messages array is required' })
    }
    const response = await gateway.complete(body)
    return c.json(response)
  })

  router.post('/api/v1/model/stream', async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    const body = await c.req.json()
    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      throw new HTTPException(400, { message: 'messages array is required' })
    }
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of gateway.stream(body)) {
            controller.enqueue(`data: ${JSON.stringify(event)}\n\n`)
          }
        } catch (err: any) {
          controller.enqueue(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`)
        }
        controller.close()
      },
    })
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    })
  })
}
```

- [ ] **Step 4: Update auth module to pass configService**

In `src/modules/auth/index.ts`, line 138, change:

```typescript
    createModelRoutes(ctx.http, ctx.model)
```

to:

```typescript
    createModelRoutes(ctx.http, ctx.model, undefined, ctx.providerConfig)
```

Note: `ctx.providerConfig` will be set by the model module's `onStart` (Task 6). For now, the routes accept `undefined` and fall back to legacy behavior, so existing tests still pass.

- [ ] **Step 5: Run new and existing route tests**

Run: `bun vitest run tests/modules/model/routes`
Expected: ALL PASS (both `routes.test.ts` and `routes-providers.test.ts`)

- [ ] **Step 6: Commit**

```bash
git add src/modules/model/routes.ts src/modules/auth/index.ts tests/modules/model/routes-providers.test.ts
git commit -m "feat(model): add enhanced provider/model config API endpoints"
```

---

### Task 6: Model Module onStart — Initialize Config Service + Table Creation

**Files:**
- Modify: `src/modules/model/index.ts`
- Modify: `src/core/types.ts:44-57`

- [ ] **Step 1: Add providerConfig to ModuleContext**

In `src/core/types.ts`, add to the `ModuleContext` interface (after `model: ModelGateway`):

```typescript
  providerConfig: import('@modules/model/provider-config-service').ProviderConfigService
```

Note: Use the import type form. The full line:

```typescript
  providerConfig: import('@modules/model/provider-config-service').ProviderConfigService
```

- [ ] **Step 2: Update model module onRegister to create tables and config service**

Rewrite `src/modules/model/index.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { createModelGateway } from './gateway.js'
import { createProviderConfigService } from './provider-config-service.js'
import { anthropicManifest } from './submodules/anthropic/manifest.js'
import { openaiManifest } from './submodules/openai/manifest.js'
import { openrouterManifest } from './submodules/openrouter/manifest.js'
import { geminiManifest } from './submodules/gemini/manifest.js'

export const modelModule: EyasModule = {
  id: 'model',
  name: 'Model',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'AI provider gateway — Anthropic, OpenAI, OpenRouter, Gemini',
  dependencies: ['secrets'],

  submodules: [anthropicManifest, openaiManifest, openrouterManifest, geminiManifest],

  async onRegister(ctx: ModuleContext) {
    // Create tables
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS provider_config (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, settings TEXT DEFAULT '{}', updated_at TEXT NOT NULL)`)
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS model_config (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES provider_config(id), model_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, name TEXT NOT NULL, context_window INTEGER, max_output_tokens INTEGER, supports_tools INTEGER DEFAULT 1, supports_images INTEGER DEFAULT 1, supports_streaming INTEGER DEFAULT 1, updated_at TEXT NOT NULL)`)

    const gateway = createModelGateway()
    const configService = createProviderConfigService(ctx.db)
    ctx.model = gateway
    ctx.providerConfig = configService
    ctx.logger.info('Model module registered')
  },

  async onStart(ctx: ModuleContext) {
    const submodules = modelModule.submodules ?? []
    for (const sub of submodules) {
      if (sub.enabled && sub.onStart) {
        await sub.onStart(ctx)
      }
    }
    const providerCount = ctx.model.listProviders().length
    ctx.logger.info({ providerCount }, 'Model module started')
  },

  async onStop() {},
}
```

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `bun vitest run tests/modules/model/`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/modules/model/index.ts src/core/types.ts
git commit -m "feat(model): create provider config tables on module register"
```

---

### Task 7: Submodule onStart Refactor — Use Config Service

**Files:**
- Modify: `src/modules/model/submodules/anthropic/manifest.ts`
- Modify: `src/modules/model/submodules/openai/manifest.ts`
- Modify: `src/modules/model/submodules/openrouter/manifest.ts`
- Modify: `src/modules/model/submodules/gemini/manifest.ts`

- [ ] **Step 1: Refactor Anthropic manifest**

Replace `src/modules/model/submodules/anthropic/manifest.ts`:

```typescript
import type { SubmoduleManifest, ModuleContext } from '@core/types'
import { createAnthropicProvider } from './provider.js'

export const anthropicManifest: SubmoduleManifest = {
  id: 'model.anthropic',
  name: 'Anthropic Claude API',
  parentModule: 'model',
  enabled: true,

  async onStart(ctx: ModuleContext) {
    const config = ctx.providerConfig.ensureProvider('anthropic')
    if (!config.enabled) {
      ctx.logger.info('Anthropic provider disabled in config')
      return
    }

    const apiKey = await ctx.secrets.get('anthropic-api-key', 'system')
    if (!apiKey) {
      ctx.logger.warn('Anthropic provider skipped — no API key in secrets')
      return
    }

    const provider = createAnthropicProvider(apiKey)
    ctx.model.registerProvider(provider)

    // Populate model_config if empty
    const existingModels = ctx.providerConfig.listModels('anthropic')
    if (existingModels.length === 0) {
      const models = await provider.listModels()
      ctx.providerConfig.upsertModels('anthropic', models)
    }

    ctx.logger.info('Anthropic provider registered')
  },
}
```

- [ ] **Step 2: Refactor OpenAI manifest**

Replace `src/modules/model/submodules/openai/manifest.ts`:

```typescript
import type { SubmoduleManifest, ModuleContext } from '@core/types'
import { createOpenAIProvider } from './provider.js'

export const openaiManifest: SubmoduleManifest = {
  id: 'model.openai',
  name: 'OpenAI',
  parentModule: 'model',
  enabled: true,

  async onStart(ctx: ModuleContext) {
    const config = ctx.providerConfig.ensureProvider('openai')
    if (!config.enabled) {
      ctx.logger.info('OpenAI provider disabled in config')
      return
    }

    const apiKey = await ctx.secrets.get('openai-api-key', 'system')
    if (!apiKey) {
      ctx.logger.warn('OpenAI provider skipped — no API key in secrets')
      return
    }

    const provider = createOpenAIProvider({ apiKey })
    ctx.model.registerProvider(provider)

    const existingModels = ctx.providerConfig.listModels('openai')
    if (existingModels.length === 0) {
      const models = await provider.listModels()
      ctx.providerConfig.upsertModels('openai', models)
    }

    ctx.logger.info('OpenAI provider registered')
  },
}
```

- [ ] **Step 3: Refactor OpenRouter manifest**

Replace `src/modules/model/submodules/openrouter/manifest.ts`:

```typescript
import type { SubmoduleManifest, ModuleContext } from '@core/types'
import { createOpenRouterProvider } from './provider.js'

export const openrouterManifest: SubmoduleManifest = {
  id: 'model.openrouter',
  name: 'OpenRouter',
  parentModule: 'model',
  enabled: true,

  async onStart(ctx: ModuleContext) {
    const config = ctx.providerConfig.ensureProvider('openrouter')
    if (!config.enabled) {
      ctx.logger.info('OpenRouter provider disabled in config')
      return
    }

    const apiKey = await ctx.secrets.get('openrouter-api-key', 'system')
    if (!apiKey) {
      ctx.logger.warn('OpenRouter provider skipped — no API key in secrets')
      return
    }

    const provider = createOpenRouterProvider(apiKey)
    ctx.model.registerProvider(provider)

    const existingModels = ctx.providerConfig.listModels('openrouter')
    if (existingModels.length === 0) {
      const models = await provider.listModels()
      ctx.providerConfig.upsertModels('openrouter', models)
    }

    ctx.logger.info('OpenRouter provider registered')
  },
}
```

- [ ] **Step 4: Refactor Gemini manifest**

Replace `src/modules/model/submodules/gemini/manifest.ts`:

```typescript
import type { SubmoduleManifest, ModuleContext } from '@core/types'
import { createGeminiProvider } from './provider.js'

export const geminiManifest: SubmoduleManifest = {
  id: 'model.gemini',
  name: 'Google Gemini',
  parentModule: 'model',
  enabled: true,

  async onStart(ctx: ModuleContext) {
    const config = ctx.providerConfig.ensureProvider('gemini')
    if (!config.enabled) {
      ctx.logger.info('Gemini provider disabled in config')
      return
    }

    const apiKey = await ctx.secrets.get('gemini-api-key', 'system')
    if (!apiKey) {
      ctx.logger.warn('Gemini provider skipped — no API key in secrets')
      return
    }

    const provider = createGeminiProvider(apiKey)
    ctx.model.registerProvider(provider)

    const existingModels = ctx.providerConfig.listModels('gemini')
    if (existingModels.length === 0) {
      const models = await provider.listModels()
      ctx.providerConfig.upsertModels('gemini', models)
    }

    ctx.logger.info('Gemini provider registered')
  },
}
```

- [ ] **Step 5: Run all tests**

Run: `bun vitest run tests/modules/model/`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/model/submodules/*/manifest.ts
git commit -m "refactor(model): submodule onStart reads provider_config, populates model_config"
```

---

### Task 8: fetchModels() — OpenAI, OpenRouter, Gemini

**Files:**
- Modify: `src/modules/model/submodules/openai/provider.ts`
- Modify: `src/modules/model/submodules/openrouter/provider.ts`
- Modify: `src/modules/model/submodules/gemini/provider.ts`

- [ ] **Step 1: Add fetchModels to OpenAI provider**

In `src/modules/model/submodules/openai/provider.ts`, add after the `listModels()` method (after line 36):

```typescript
    async fetchModels() {
      const response = await client.models.list()
      const chatModels: ModelInfo[] = []
      for await (const model of response) {
        if (model.id.startsWith('gpt-') || model.id.startsWith('o1') || model.id.startsWith('o3') || model.id.startsWith('o4')) {
          chatModels.push({
            id: model.id,
            name: model.id,
            provider: providerId,
            contextWindow: 128000,
            maxOutputTokens: 16384,
            supportsTools: true,
            supportsImages: !model.id.includes('mini'),
            supportsStreaming: true,
          })
        }
      }
      return chatModels.length > 0 ? chatModels : models
    },
```

- [ ] **Step 2: Add fetchModels to OpenRouter provider**

In `src/modules/model/submodules/openrouter/provider.ts`, after `createOpenRouterProvider` function, we need to override `fetchModels`. Replace the entire file:

```typescript
import { createOpenAIProvider } from '../openai/provider.js'
import type { AIProvider, ModelInfo } from '../../types.js'

const OPENROUTER_MODELS: ModelInfo[] = [
  { id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4.5 (OpenRouter)', provider: 'openrouter', contextWindow: 200000, maxOutputTokens: 16000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'openai/gpt-4o', name: 'GPT-4o (OpenRouter)', provider: 'openrouter', contextWindow: 128000, maxOutputTokens: 16384, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash (OpenRouter)', provider: 'openrouter', contextWindow: 1048576, maxOutputTokens: 8192, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'meta-llama/llama-3.1-405b-instruct', name: 'Llama 3.1 405B (OpenRouter)', provider: 'openrouter', contextWindow: 131072, maxOutputTokens: 4096, supportsTools: true, supportsImages: false, supportsStreaming: true },
]

export function createOpenRouterProvider(apiKey: string): AIProvider {
  const base = createOpenAIProvider({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    providerId: 'openrouter',
    providerName: 'OpenRouter',
    models: OPENROUTER_MODELS,
    defaultHeaders: {
      'HTTP-Referer': 'https://eyas.app',
      'X-Title': 'EYAS',
    },
  })

  return {
    ...base,
    async fetchModels(): Promise<ModelInfo[]> {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!res.ok) return OPENROUTER_MODELS
      const data = await res.json() as { data: Array<{ id: string; name: string; context_length: number; top_provider?: { max_completion_tokens?: number } }> }
      return data.data.map(m => ({
        id: m.id,
        name: m.name || m.id,
        provider: 'openrouter',
        contextWindow: m.context_length || 0,
        maxOutputTokens: m.top_provider?.max_completion_tokens || 4096,
        supportsTools: true,
        supportsImages: true,
        supportsStreaming: true,
      }))
    },
  }
}
```

- [ ] **Step 3: Add fetchModels to Gemini provider**

In `src/modules/model/submodules/gemini/provider.ts`, add after the `listModels()` method (after line 19):

```typescript
    async fetchModels() {
      const pager = await ai.models.list()
      const chatModels: ModelInfo[] = []
      for (const model of pager) {
        if (model.supportedActions?.includes('generateContent')) {
          chatModels.push({
            id: model.name?.replace('models/', '') ?? '',
            name: model.displayName ?? model.name ?? '',
            provider: 'gemini',
            contextWindow: model.inputTokenLimit ?? 0,
            maxOutputTokens: model.outputTokenLimit ?? 0,
            supportsTools: true,
            supportsImages: true,
            supportsStreaming: true,
          })
        }
      }
      return chatModels.length > 0 ? chatModels : GEMINI_MODELS
    },
```

- [ ] **Step 4: Run existing tests to verify no regressions**

Run: `bun vitest run tests/modules/model/`
Expected: ALL PASS — `fetchModels` is optional, existing tests don't call it

- [ ] **Step 5: Commit**

```bash
git add src/modules/model/submodules/openai/provider.ts src/modules/model/submodules/openrouter/provider.ts src/modules/model/submodules/gemini/provider.ts
git commit -m "feat(model): add fetchModels() to OpenAI, OpenRouter, Gemini providers"
```

---

### Task 9: Claude Code CLI Provider

**Files:**
- Create: `src/modules/model/submodules/claude-code/provider.ts`
- Create: `src/modules/model/submodules/claude-code/manifest.ts`
- Create: `tests/modules/model/claude-code-provider.test.ts`
- Modify: `src/modules/model/index.ts:8-19`
- Modify: `package.json`

- [ ] **Step 1: Install @anthropic-ai/claude-code**

Run: `bun add @anthropic-ai/claude-code`

Verify license is MIT in `node_modules/@anthropic-ai/claude-code/package.json`.

- [ ] **Step 2: Write failing test for Claude Code provider**

Create `tests/modules/model/claude-code-provider.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider'

describe('Claude Code Provider', () => {
  it('has correct id and name', () => {
    const provider = createClaudeCodeProvider()
    expect(provider.id).toBe('claude-code')
    expect(provider.name).toBe('Claude Code CLI')
  })

  it('lists available models', async () => {
    const provider = createClaudeCodeProvider()
    const models = await provider.listModels()
    expect(models.length).toBeGreaterThan(0)
    expect(models[0].provider).toBe('claude-code')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun vitest run tests/modules/model/claude-code-provider.test.ts`
Expected: FAIL — cannot resolve module

- [ ] **Step 4: Implement Claude Code provider**

Create `src/modules/model/submodules/claude-code/provider.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { query, type ClaudeCodeOptions } from '@anthropic-ai/claude-code'
import type { AIProvider, ModelInfo, ModelRequest, ModelResponse, StreamEvent, ContentBlock } from '../../types.js'

const CLAUDE_CODE_MODELS: ModelInfo[] = [
  { id: 'claude-code-opus', name: 'Claude Code (Opus)', provider: 'claude-code', contextWindow: 200000, maxOutputTokens: 32000, supportsTools: false, supportsImages: false, supportsStreaming: true },
  { id: 'claude-code-sonnet', name: 'Claude Code (Sonnet)', provider: 'claude-code', contextWindow: 200000, maxOutputTokens: 16000, supportsTools: false, supportsImages: false, supportsStreaming: true },
]

export interface ClaudeCodeProviderConfig {
  cliPath?: string
  maxTurns?: number
}

export function createClaudeCodeProvider(config?: ClaudeCodeProviderConfig): AIProvider {
  return {
    id: 'claude-code',
    name: 'Claude Code CLI',

    async listModels() {
      return CLAUDE_CODE_MODELS
    },

    async complete(request: ModelRequest): Promise<ModelResponse> {
      const prompt = typeof request.messages[request.messages.length - 1]?.content === 'string'
        ? request.messages[request.messages.length - 1].content as string
        : ''

      const options: ClaudeCodeOptions = {
        prompt,
        maxTurns: config?.maxTurns ?? 1,
        allowedTools: [],
      }
      if (config?.cliPath) {
        options.cliPath = config.cliPath
      }
      if (request.system) {
        options.systemPrompt = request.system
      }

      const result = await query(options)

      const textContent = result
        .filter((msg: any) => msg.type === 'text')
        .map((msg: any) => msg.text)
        .join('')

      const contentBlocks: ContentBlock[] = textContent
        ? [{ type: 'text', text: textContent }]
        : [{ type: 'text', text: '' }]

      return {
        id: `cc-${Date.now()}`,
        provider: 'claude-code',
        model: request.model || 'claude-code-sonnet',
        content: contentBlocks,
        stopReason: 'end',
        usage: { inputTokens: 0, outputTokens: 0 },
      }
    },

    async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
      // Claude Code SDK doesn't support true streaming in query mode
      // Execute as complete() and yield the result
      const response = await this.complete(request)
      for (const block of response.content) {
        if (block.type === 'text') {
          yield { type: 'text', text: block.text }
        }
      }
      yield { type: 'done', response }
    },
  }
}
```

- [ ] **Step 5: Create manifest**

Create `src/modules/model/submodules/claude-code/manifest.ts`:

```typescript
import type { SubmoduleManifest, ModuleContext } from '@core/types'
import { createClaudeCodeProvider } from './provider.js'

export const claudeCodeManifest: SubmoduleManifest = {
  id: 'model.claude-code',
  name: 'Claude Code CLI',
  parentModule: 'model',
  enabled: true,

  async onStart(ctx: ModuleContext) {
    const config = ctx.providerConfig.ensureProvider('claude-code')
    if (!config.enabled) {
      ctx.logger.info('Claude Code provider disabled in config')
      return
    }

    // Check if claude CLI is available
    try {
      const proc = Bun.spawn(['claude', '--version'], { stdout: 'pipe', stderr: 'pipe' })
      await proc.exited
      if (proc.exitCode !== 0) {
        ctx.logger.warn('Claude Code CLI not available — provider skipped')
        return
      }
    } catch {
      ctx.logger.warn('Claude Code CLI not found on PATH — provider skipped')
      return
    }

    const provider = createClaudeCodeProvider()
    ctx.model.registerProvider(provider)

    const existingModels = ctx.providerConfig.listModels('claude-code')
    if (existingModels.length === 0) {
      const models = await provider.listModels()
      ctx.providerConfig.upsertModels('claude-code', models)
    }

    ctx.logger.info('Claude Code CLI provider registered')
  },
}
```

- [ ] **Step 6: Register in model module index**

In `src/modules/model/index.ts`, add import and submodule:

Add import (after gemini import):
```typescript
import { claudeCodeManifest } from './submodules/claude-code/manifest.js'
```

Change the `submodules` array to include it:
```typescript
  submodules: [anthropicManifest, openaiManifest, openrouterManifest, geminiManifest, claudeCodeManifest],
```

Update the description:
```typescript
  description: 'AI provider gateway — Anthropic, OpenAI, OpenRouter, Gemini, Claude Code CLI',
```

- [ ] **Step 7: Run test to verify it passes**

Run: `bun vitest run tests/modules/model/claude-code-provider.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 8: Run all model tests**

Run: `bun vitest run tests/modules/model/`
Expected: ALL PASS

- [ ] **Step 9: Commit**

```bash
git add src/modules/model/submodules/claude-code/ src/modules/model/index.ts package.json bun.lock
git commit -m "feat(model): add Claude Code CLI provider via @anthropic-ai/claude-code SDK"
```

---

### Task 10: Wire configService in Auth Module

**Files:**
- Modify: `src/modules/auth/index.ts:138`

- [ ] **Step 1: Update the createModelRoutes call to pass configService**

In `src/modules/auth/index.ts`, change line 138 from:

```typescript
    createModelRoutes(ctx.http, ctx.model)
```

to:

```typescript
    createModelRoutes(ctx.http, ctx.model, undefined, ctx.providerConfig)
```

Note: `authenticate` is already applied via `router.use('/api/v1/model/*', authenticate)` inside the routes, the third arg is passed as `undefined` because the auth middleware is already set up earlier in `createAuthRoutes`. Check if existing route tests still pass — if they use the 3-arg form, the 4th arg is optional so no change needed there.

- [ ] **Step 2: Run all backend tests**

Run: `bun vitest run`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add src/modules/auth/index.ts
git commit -m "feat(model): wire providerConfig into model routes via auth module"
```

---

### Task 11: Frontend — Provider Cards with Enable/Disable

**Files:**
- Create: `src/web/src/pages/providers/provider-card.tsx`
- Modify: `src/web/src/pages/providers/providers-page.tsx`

- [ ] **Step 1: Create ProviderCard component**

Create `src/web/src/pages/providers/provider-card.tsx`:

```tsx
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Bot, Key, Terminal } from 'lucide-react'

export interface ProviderCardData {
  id: string
  name: string
  enabled: boolean
  active: boolean
  hasApiKey: boolean | null
  modelCount: number
  enabledModelCount: number
}

interface ProviderCardProps {
  provider: ProviderCardData
  onToggle: (id: string, enabled: boolean) => void
  onClick: (id: string) => void
}

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  anthropic: 'Claude models (Opus, Sonnet, Haiku)',
  openai: 'GPT-4o, GPT-4 Turbo, o3',
  openrouter: 'Multi-provider gateway (100+ models)',
  gemini: 'Gemini 2.5 Pro, Flash',
  'claude-code': 'Local Claude Code CLI session',
}

export function ProviderCard({ provider, onToggle, onClick }: ProviderCardProps) {
  const isClaudeCode = provider.id === 'claude-code'

  return (
    <button
      type="button"
      className="glass-card p-4 flex items-start gap-4 text-left w-full hover:bg-accent/30 transition-colors cursor-pointer"
      onClick={() => onClick(provider.id)}
    >
      <div className="h-10 w-10 rounded-xl bg-accent/50 flex items-center justify-center flex-shrink-0">
        {isClaudeCode ? (
          <Terminal className="h-5 w-5 text-muted-foreground" />
        ) : (
          <Bot className="h-5 w-5 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{provider.name}</span>
          {provider.active ? (
            <Badge variant="secondary" className="text-emerald-500 text-[10px]">● Active</Badge>
          ) : provider.enabled ? (
            <Badge variant="outline" className="text-amber-500 text-[10px]">
              {isClaudeCode ? 'CLI not found' : 'No API key'}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground text-[10px]">Disabled</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {PROVIDER_DESCRIPTIONS[provider.id] ?? ''}
        </p>
        {provider.modelCount > 0 && (
          <p className="text-xs text-muted-foreground mt-1">
            {provider.enabledModelCount}/{provider.modelCount} models enabled
          </p>
        )}
      </div>
      <div
        className="flex-shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <Switch
          checked={provider.enabled}
          onCheckedChange={(checked) => onToggle(provider.id, checked)}
        />
      </div>
    </button>
  )
}
```

- [ ] **Step 2: Rewrite providers-page.tsx to use cards**

Replace `src/web/src/pages/providers/providers-page.tsx`:

```tsx
import { useState, useCallback } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { ProviderCard, type ProviderCardData } from './provider-card'
import { ProviderPanel } from './provider-panel'

export default function ProvidersPage() {
  const { data, refetch } = useApi<{ providers: ProviderCardData[] }>('/model/providers')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const providers = data?.providers ?? []
  const selected = providers.find(p => p.id === selectedId) ?? null

  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    await api.patch(`/model/providers/${id}`, { enabled })
    refetch()
  }, [refetch])

  const handleSelect = useCallback((id: string) => {
    setSelectedId(prev => prev === id ? null : id)
  }, [])

  const handleClose = useCallback(() => {
    setSelectedId(null)
  }, [])

  return (
    <div>
      <h1 className="page-title">Providers</h1>
      <p className="text-sm text-muted-foreground mb-5">Configure AI providers, API keys, and model availability</p>

      <div className="grid grid-cols-2 gap-3">
        {providers.map(provider => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            onToggle={handleToggle}
            onClick={handleSelect}
          />
        ))}
      </div>

      {providers.length === 0 && (
        <p className="text-sm text-muted-foreground mt-4">
          No providers configured. Providers will appear after the server initializes the model module.
        </p>
      )}

      <ProviderPanel
        providerId={selectedId}
        onClose={handleClose}
        onRefresh={refetch}
      />
    </div>
  )
}
```

- [ ] **Step 3: Ensure Switch component is installed**

Run: `cd src/web && bunx shadcn@latest add switch --yes`

- [ ] **Step 4: Verify frontend compiles**

Run: `cd src/web && bun run build`
Expected: Build succeeds (ProviderPanel will be created in next task — create a stub first)

Create stub `src/web/src/pages/providers/provider-panel.tsx`:

```tsx
interface ProviderPanelProps {
  providerId: string | null
  onClose: () => void
  onRefresh: () => void
}

export function ProviderPanel({ providerId, onClose }: ProviderPanelProps) {
  if (!providerId) return null
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute right-0 top-0 bottom-0 w-1/2 bg-background border-l p-6">
        <p>Panel for {providerId} — coming next</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add src/web/src/pages/providers/
git commit -m "feat(web): provider cards with enable/disable toggle and slideout stub"
```

---

### Task 12: Frontend — Provider Slideout Panel

**Files:**
- Rewrite: `src/web/src/pages/providers/provider-panel.tsx`
- Create: `src/web/src/pages/providers/provider-api-key-section.tsx`
- Create: `src/web/src/pages/providers/provider-models-section.tsx`

- [ ] **Step 1: Create API key management section**

Create `src/web/src/pages/providers/provider-api-key-section.tsx`:

```tsx
import { useState } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'

const SECRET_NAMES: Record<string, string> = {
  anthropic: 'anthropic-api-key',
  openai: 'openai-api-key',
  openrouter: 'openrouter-api-key',
  gemini: 'gemini-api-key',
}

interface ApiKeySectionProps {
  providerId: string
  hasApiKey: boolean | null
  onKeyChanged: () => void
}

export function ApiKeySection({ providerId, hasApiKey, onKeyChanged }: ApiKeySectionProps) {
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const secretName = SECRET_NAMES[providerId]

  // Claude Code doesn't use API keys
  if (!secretName) return null

  const handleSave = async () => {
    if (!apiKey) return
    setSaving(true)
    try {
      await api.post('/secrets', { name: secretName, scope: 'system', value: apiKey })
      await api.post(`/model/providers/${providerId}/reload`)
      setApiKey('')
      onKeyChanged()
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async () => {
    setSaving(true)
    try {
      await api.delete(`/secrets/${secretName}?scope=system`)
      await api.post(`/model/providers/${providerId}/reload`)
      onKeyChanged()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">API Key</Label>
        {hasApiKey ? (
          <Badge variant="secondary" className="text-emerald-500 text-[10px]">Key saved</Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground text-[10px]">No key</Badge>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          type="password"
          placeholder="Enter API key..."
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="flex-1"
        />
        <Button size="sm" onClick={handleSave} disabled={saving || !apiKey}>
          Save
        </Button>
      </div>
      {hasApiKey && (
        <Button variant="outline" size="sm" onClick={handleRemove} disabled={saving} className="text-destructive">
          Remove Key
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        Stored encrypted in the secrets vault. Provider reloads automatically after saving.
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Create models list section**

Create `src/web/src/pages/providers/provider-models-section.tsx`:

```tsx
import { useState } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { RefreshCw } from 'lucide-react'

interface ModelConfigItem {
  id: string
  modelId: string
  name: string
  enabled: boolean
  contextWindow: number | null
  maxOutputTokens: number | null
  supportsTools: boolean
  supportsImages: boolean
  supportsStreaming: boolean
}

interface ModelsSectionProps {
  providerId: string
  models: ModelConfigItem[]
  onModelsChanged: () => void
}

function formatNumber(n: number | null): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

export function ModelsSection({ providerId, models, onModelsChanged }: ModelsSectionProps) {
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await api.post(`/model/providers/${providerId}/models/refresh`)
      onModelsChanged()
    } finally {
      setRefreshing(false)
    }
  }

  const handleToggleModel = async (modelId: string, enabled: boolean) => {
    await api.patch(`/model/providers/${providerId}/models/${modelId}`, { enabled })
    onModelsChanged()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Models ({models.length})</span>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={`h-3 w-3 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh from API
        </Button>
      </div>

      {models.length === 0 ? (
        <p className="text-xs text-muted-foreground">No models loaded. Click refresh to fetch from the provider API.</p>
      ) : (
        <div className="space-y-1">
          {models.map(model => (
            <div key={model.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-accent/30">
              <Switch
                checked={model.enabled}
                onCheckedChange={(checked) => handleToggleModel(model.id, checked)}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{model.name}</div>
                <div className="text-[10px] text-muted-foreground font-mono truncate">{model.modelId}</div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {model.contextWindow && (
                  <Badge variant="outline" className="text-[10px]">{formatNumber(model.contextWindow)} ctx</Badge>
                )}
                {model.supportsTools && (
                  <Badge variant="outline" className="text-[10px]">Tools</Badge>
                )}
                {model.supportsImages && (
                  <Badge variant="outline" className="text-[10px]">Vision</Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Implement full slideout panel**

Replace `src/web/src/pages/providers/provider-panel.tsx`:

```tsx
import { useEffect, useCallback } from 'react'
import { useApi } from '@/hooks/use-api'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { X } from 'lucide-react'
import { api } from '@/lib/api'
import { ApiKeySection } from './provider-api-key-section'
import { ModelsSection } from './provider-models-section'

interface ProviderDetail {
  id: string
  name: string
  enabled: boolean
  active: boolean
  hasApiKey: boolean | null
  models: Array<{
    id: string
    modelId: string
    name: string
    enabled: boolean
    contextWindow: number | null
    maxOutputTokens: number | null
    supportsTools: boolean
    supportsImages: boolean
    supportsStreaming: boolean
  }>
}

interface ProviderPanelProps {
  providerId: string | null
  onClose: () => void
  onRefresh: () => void
}

export function ProviderPanel({ providerId, onClose, onRefresh }: ProviderPanelProps) {
  const { data, refetch } = useApi<ProviderDetail>(
    providerId ? `/model/providers/${providerId}` : ''
  )

  // Close on Escape
  useEffect(() => {
    if (!providerId) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [providerId, onClose])

  const handleToggleEnabled = useCallback(async (enabled: boolean) => {
    if (!providerId) return
    await api.patch(`/model/providers/${providerId}`, { enabled })
    refetch()
    onRefresh()
  }, [providerId, refetch, onRefresh])

  const handleKeyOrModelsChanged = useCallback(() => {
    refetch()
    onRefresh()
  }, [refetch, onRefresh])

  if (!providerId) return null

  const detail = data
  const isClaudeCode = providerId === 'claude-code'

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="absolute right-0 top-0 bottom-0 w-1/2 min-w-[400px] max-w-[600px] bg-background border-l shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">{detail?.name ?? providerId}</h2>
            {detail?.active ? (
              <Badge variant="secondary" className="text-emerald-500 text-[10px]">● Active</Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground text-[10px]">Inactive</Badge>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={detail?.enabled ?? false}
              onCheckedChange={handleToggleEnabled}
            />
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* API Key Section */}
          {!isClaudeCode && detail && (
            <ApiKeySection
              providerId={providerId}
              hasApiKey={detail.hasApiKey}
              onKeyChanged={handleKeyOrModelsChanged}
            />
          )}

          {isClaudeCode && (
            <div className="space-y-1">
              <span className="text-sm font-medium">Authentication</span>
              <p className="text-xs text-muted-foreground">
                Uses the locally installed Claude Code CLI session. No API key needed — authenticate via the <code className="text-[10px]">claude</code> CLI.
              </p>
            </div>
          )}

          {/* Separator */}
          <div className="border-t" />

          {/* Models Section */}
          {detail && (
            <ModelsSection
              providerId={providerId}
              models={detail.models}
              onModelsChanged={handleKeyOrModelsChanged}
            />
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify frontend compiles**

Run: `cd src/web && bun run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/web/src/pages/providers/
git commit -m "feat(web): provider slideout panel with API key management and model toggles"
```

---

### Task 13: Fix useApi for Empty Path + Final Integration Test

**Files:**
- Modify: `src/web/src/hooks/use-api.ts`

- [ ] **Step 1: Guard useApi against empty path**

The `ProviderPanel` calls `useApi('')` when no provider is selected. The hook should skip the fetch:

In `src/web/src/hooks/use-api.ts`, modify the `useEffect` to skip when path is empty:

```typescript
  useEffect(() => {
    if (!path) {
      setData(null)
      setIsLoading(false)
      return
    }
    let cancelled = false
    setIsLoading(true)
    // ... rest unchanged
```

- [ ] **Step 2: Verify frontend compiles and runs**

Run: `cd src/web && bun run build`
Expected: Build succeeds

- [ ] **Step 3: Run all backend tests**

Run: `bun vitest run`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/web/src/hooks/use-api.ts
git commit -m "fix(web): skip API fetch for empty path in useApi hook"
```

---

### Task 14: Manual Smoke Test

- [ ] **Step 1: Start backend**

Run: `bun src/main.ts`
Expected: Server starts on port 3000, logs show provider registration

- [ ] **Step 2: Start frontend**

Run: `cd src/web && bun run dev`
Expected: Vite dev server on port 5173

- [ ] **Step 3: Test the providers page**

1. Navigate to `http://localhost:5173/providers`
2. Verify all 5 provider cards show (Anthropic, OpenAI, OpenRouter, Gemini, Claude Code)
3. Click a provider card — slideout panel opens from right
4. Toggle enable/disable on a provider — card updates
5. If API key is set, model list should show
6. Toggle a model on/off
7. Click "Refresh from API" (for a configured provider)
8. Close panel with X button or Escape key
9. Verify Claude Code shows "CLI session" instead of API key section

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: smoke test adjustments for enhanced provider management"
```
