# Chat Module Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persistent chat with AI providers — SSE streaming, context tracking, provider/model selection, conversation management with status lifecycle.

**Architecture:** New `chat` module with `conversations` + `conversation_messages` DB tables. A `ConversationService` handles CRUD and token tracking. SSE streaming reuses the existing model gateway. Frontend adds sidebar navigation (New Chat button + Chats list), a chat list page, and a central chat dialog with provider/model dropdowns and context window progress bar. Default provider/model is stored via new columns on `provider_config`.

**Tech Stack:** Hono (SSE streaming), Drizzle ORM (SQLite), React 19, shadcn/ui, TanStack Router, Zustand

---

## File Structure

### Backend (new files)
| File | Responsibility |
|------|---------------|
| `src/modules/chat/index.ts` | Module manifest — create tables, register in bootstrap |
| `src/modules/chat/schema.ts` | Drizzle schema for conversations + messages |
| `src/modules/chat/conversation-service.ts` | CRUD + token tracking + title generation |
| `src/modules/chat/routes.ts` | API endpoints (CRUD + SSE stream) |

### Backend (modified files)
| File | Change |
|------|--------|
| `src/core/bootstrap.ts` | Import + register chat module |
| `src/core/types.ts` | Add `chat` to ModuleContext |
| `src/modules/auth/routes.ts` | Add auth+CSRF middleware for `/api/v1/chat/*` |
| `src/modules/model/schema.ts` | Add `is_default`, `default_model` columns |
| `src/modules/model/provider-config-service.ts` | Add default provider/model methods |
| `src/modules/model/index.ts` | ALTER TABLE for new columns |
| `src/modules/model/routes.ts` | Add GET/PUT `/model/defaults` endpoints |
| `tests/helpers/test-db.ts` | Add conversations + messages tables |

### Frontend (new files)
| File | Responsibility |
|------|---------------|
| `src/web/src/routes/chats.tsx` | TanStack route for /chats |
| `src/web/src/pages/chats/chats-page.tsx` | Conversation list page |
| `src/web/src/pages/chats/chat-dialog.tsx` | Main chat dialog (central modal) |
| `src/web/src/pages/chats/chat-header.tsx` | Title + provider/model selectors + status |
| `src/web/src/pages/chats/chat-messages.tsx` | Message list with auto-scroll + streaming |
| `src/web/src/pages/chats/chat-input.tsx` | Multi-line input + send button |
| `src/web/src/pages/chats/context-bar.tsx` | Token usage progress bar |
| `src/web/src/stores/chat-store.ts` | Zustand store for active chat state |

### Frontend (modified files)
| File | Change |
|------|--------|
| `src/web/src/components/layout/sidebar.tsx` | Add New Chat button + Chats nav item |
| `src/web/src/pages/providers/provider-panel.tsx` | Add "Set as Default" + default model selector |

### Test files
| File | Tests |
|------|-------|
| `tests/modules/chat/conversation-service.test.ts` | Service CRUD + token tracking |
| `tests/modules/chat/routes.test.ts` | API endpoints |
| `tests/modules/model/provider-defaults.test.ts` | Default provider/model |

---

### Task 1: Default Provider/Model — Backend

**Files:**
- Modify: `src/modules/model/schema.ts`
- Modify: `src/modules/model/provider-config-service.ts`
- Modify: `src/modules/model/index.ts`
- Modify: `src/modules/model/routes.ts`
- Modify: `tests/helpers/test-db.ts`
- Create: `tests/modules/model/provider-defaults.test.ts`

- [ ] **Step 1: Write failing test for default provider/model**

Create `tests/modules/model/provider-defaults.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import { createProviderConfigService } from '@modules/model/provider-config-service'

const testDb = createTestDb('provider-defaults')
let db: ReturnType<typeof testDb.open>

beforeEach(() => { db = testDb.open() })
afterEach(() => testDb.cleanup())

describe('default provider/model', () => {
  it('getDefault returns null when no default set', () => {
    const svc = createProviderConfigService(db)
    svc.ensureProvider('anthropic')
    expect(svc.getDefault()).toBeNull()
  })

  it('setDefault marks a provider as default', () => {
    const svc = createProviderConfigService(db)
    svc.ensureProvider('anthropic')
    svc.ensureProvider('openai')
    svc.setDefault('anthropic', 'claude-sonnet-4-5-20250514')
    const def = svc.getDefault()
    expect(def).toEqual({ providerId: 'anthropic', modelId: 'claude-sonnet-4-5-20250514' })
  })

  it('setDefault clears previous default', () => {
    const svc = createProviderConfigService(db)
    svc.ensureProvider('anthropic')
    svc.ensureProvider('openai')
    svc.setDefault('anthropic', 'claude-sonnet-4-5-20250514')
    svc.setDefault('openai', 'gpt-4o')
    const def = svc.getDefault()
    expect(def).toEqual({ providerId: 'openai', modelId: 'gpt-4o' })
    const anthropic = svc.getProvider('anthropic')
    expect(anthropic!.isDefault).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/model/provider-defaults.test.ts`
Expected: FAIL — `is_default` column doesn't exist

- [ ] **Step 3: Add columns to schema, service, test-db, and module**

Update `src/modules/model/schema.ts` — add 2 fields to `providerConfig`:
```typescript
  isDefault: integer('is_default').notNull().default(0),
  defaultModel: text('default_model'),
```

Update `tests/helpers/test-db.ts` — change the provider_config CREATE TABLE to include new columns:
```sql
CREATE TABLE IF NOT EXISTS provider_config (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, settings TEXT DEFAULT '{}', is_default INTEGER NOT NULL DEFAULT 0, default_model TEXT, updated_at TEXT NOT NULL)
```

Update `src/modules/model/index.ts` — same change in the `onRegister` CREATE TABLE SQL.

Update `src/modules/model/provider-config-service.ts`:
- Add `isDefault: boolean` and `defaultModel: string | null` to `ProviderConfigRow`
- Update `toRow()` to map `raw.is_default` and `raw.default_model`
- Update `ensureProvider()` INSERT to include `is_default` and `default_model`
- Add two new methods:

```typescript
    getDefault(): { providerId: string; modelId: string } | null {
      const rows = db.all(sql`SELECT id, default_model FROM provider_config WHERE is_default = 1`) as any[]
      if (rows.length === 0 || !rows[0].default_model) return null
      return { providerId: rows[0].id, modelId: rows[0].default_model }
    },

    setDefault(providerId: string, modelId: string): void {
      const now = new Date().toISOString()
      db.run(sql`UPDATE provider_config SET is_default = 0, updated_at = ${now}`)
      db.run(sql`UPDATE provider_config SET is_default = 1, default_model = ${modelId}, updated_at = ${now} WHERE id = ${providerId}`)
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest run tests/modules/model/provider-defaults.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Add GET/PUT /model/defaults endpoints**

In `src/modules/model/routes.ts`, add before the `// ─── All Models` section:

```typescript
  // ─── Default Provider/Model ─────────────────────
  router.get('/api/v1/model/defaults', async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    if (!configService) throw new HTTPException(501, { message: 'Config service not available' })
    const def = configService.getDefault()
    return c.json(def ?? { providerId: null, modelId: null })
  })

  router.put('/api/v1/model/defaults', async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    if (!configService) throw new HTTPException(501, { message: 'Config service not available' })
    const { providerId, modelId } = await c.req.json()
    if (!providerId || !modelId) throw new HTTPException(400, { message: 'providerId and modelId required' })
    configService.setDefault(providerId, modelId)
    return c.json({ providerId, modelId })
  })
```

- [ ] **Step 6: Run all model tests**

Run: `bun vitest run tests/modules/model/`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add src/modules/model/ tests/modules/model/provider-defaults.test.ts tests/helpers/test-db.ts
git commit -m "feat(model): add default provider/model support with GET/PUT /model/defaults"
```

---

### Task 2: Chat Module — DB Tables + ConversationService

**Files:**
- Create: `src/modules/chat/schema.ts`
- Create: `src/modules/chat/conversation-service.ts`
- Create: `tests/modules/chat/conversation-service.test.ts`

- [ ] **Step 1: Write failing tests for ConversationService**

Create `tests/modules/chat/conversation-service.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import { createConversationService, type ConversationService } from '@modules/chat/conversation-service'

const testDb = createTestDb('chat-service')
let db: ReturnType<typeof testDb.open>
let svc: ConversationService

beforeEach(() => {
  db = testDb.open()
  svc = createConversationService(db)
})
afterEach(() => testDb.cleanup())

describe('ConversationService', () => {
  describe('create', () => {
    it('creates a conversation with defaults', () => {
      const conv = svc.create({ userId: 'user-1' })
      expect(conv.id).toBeTruthy()
      expect(conv.status).toBe('idle')
      expect(conv.tokensUsed).toBe(0)
      expect(conv.userId).toBe('user-1')
    })

    it('creates with optional title and provider', () => {
      const conv = svc.create({ userId: 'user-1', title: 'Test Chat', providerId: 'openai', modelId: 'gpt-4o' })
      expect(conv.title).toBe('Test Chat')
      expect(conv.providerId).toBe('openai')
      expect(conv.modelId).toBe('gpt-4o')
    })
  })

  describe('list', () => {
    it('returns conversations excluding deleted', () => {
      svc.create({ userId: 'user-1' })
      svc.create({ userId: 'user-1' })
      const deleted = svc.create({ userId: 'user-1' })
      svc.update(deleted.id, { status: 'deleted' })
      const list = svc.list('user-1')
      expect(list).toHaveLength(2)
    })

    it('filters by status', () => {
      svc.create({ userId: 'user-1' })
      const archived = svc.create({ userId: 'user-1' })
      svc.update(archived.id, { status: 'archived' })
      const active = svc.list('user-1', { excludeArchived: true })
      expect(active).toHaveLength(1)
    })
  })

  describe('get', () => {
    it('returns conversation with messages', () => {
      const conv = svc.create({ userId: 'user-1' })
      svc.addMessage(conv.id, { role: 'user', content: 'Hello' })
      svc.addMessage(conv.id, { role: 'assistant', content: 'Hi there!', model: 'gpt-4o', provider: 'openai', tokensIn: 5, tokensOut: 10 })
      const result = svc.get(conv.id)
      expect(result!.messages).toHaveLength(2)
      expect(result!.messages[0].role).toBe('user')
      expect(result!.messages[1].tokensOut).toBe(10)
    })
  })

  describe('addMessage', () => {
    it('saves message and updates tokens_used on conversation', () => {
      const conv = svc.create({ userId: 'user-1' })
      svc.addMessage(conv.id, { role: 'user', content: 'Hello', tokensIn: 5 })
      svc.addMessage(conv.id, { role: 'assistant', content: 'Hi!', tokensIn: 5, tokensOut: 10, model: 'gpt-4o', provider: 'openai' })
      const updated = svc.get(conv.id)
      expect(updated!.tokensUsed).toBe(20)
    })
  })

  describe('update', () => {
    it('updates title', () => {
      const conv = svc.create({ userId: 'user-1' })
      svc.update(conv.id, { title: 'New Title' })
      expect(svc.get(conv.id)!.title).toBe('New Title')
    })

    it('updates status', () => {
      const conv = svc.create({ userId: 'user-1' })
      svc.update(conv.id, { status: 'working' })
      expect(svc.get(conv.id)!.status).toBe('working')
    })
  })

  describe('softDelete', () => {
    it('sets status to deleted', () => {
      const conv = svc.create({ userId: 'user-1' })
      svc.softDelete(conv.id)
      expect(svc.get(conv.id)!.status).toBe('deleted')
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/chat/conversation-service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Update test-db helper with chat tables**

In `tests/helpers/test-db.ts`, add after the model_config CREATE TABLE:

```typescript
    db.run(sql`CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT, status TEXT NOT NULL DEFAULT 'idle', provider_id TEXT, model_id TEXT, user_id TEXT NOT NULL, tokens_used INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS conversation_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL REFERENCES conversations(id), role TEXT NOT NULL, content TEXT NOT NULL, model TEXT, provider TEXT, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, created_at TEXT NOT NULL)`)
```

- [ ] **Step 4: Create schema.ts**

Create `src/modules/chat/schema.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  title: text('title'),
  status: text('status').notNull().default('idle'),
  providerId: text('provider_id'),
  modelId: text('model_id'),
  userId: text('user_id').notNull(),
  tokensUsed: integer('tokens_used').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const conversationMessages = sqliteTable('conversation_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  conversationId: text('conversation_id').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  model: text('model'),
  provider: text('provider'),
  tokensIn: integer('tokens_in').default(0),
  tokensOut: integer('tokens_out').default(0),
  createdAt: text('created_at').notNull(),
})
```

- [ ] **Step 5: Implement ConversationService**

Create `src/modules/chat/conversation-service.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'

export interface Conversation {
  id: string
  title: string | null
  status: string
  providerId: string | null
  modelId: string | null
  userId: string
  tokensUsed: number
  createdAt: string
  updatedAt: string
}

export interface ConversationMessage {
  id: number
  conversationId: string
  role: string
  content: string
  model: string | null
  provider: string | null
  tokensIn: number
  tokensOut: number
  createdAt: string
}

export interface ConversationWithMessages extends Conversation {
  messages: ConversationMessage[]
}

export interface CreateConversationInput {
  userId: string
  title?: string
  providerId?: string
  modelId?: string
}

export interface AddMessageInput {
  role: string
  content: string
  model?: string
  provider?: string
  tokensIn?: number
  tokensOut?: number
}

export interface ConversationService {
  create(input: CreateConversationInput): Conversation
  list(userId: string, options?: { excludeArchived?: boolean; status?: string }): Conversation[]
  get(id: string): ConversationWithMessages | null
  update(id: string, update: { title?: string; status?: string; providerId?: string; modelId?: string }): void
  addMessage(conversationId: string, input: AddMessageInput): ConversationMessage
  softDelete(id: string): void
}

function toConversation(raw: any): Conversation {
  return {
    id: raw.id,
    title: raw.title,
    status: raw.status,
    providerId: raw.provider_id,
    modelId: raw.model_id,
    userId: raw.user_id,
    tokensUsed: raw.tokens_used,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  }
}

function toMessage(raw: any): ConversationMessage {
  return {
    id: raw.id,
    conversationId: raw.conversation_id,
    role: raw.role,
    content: raw.content,
    model: raw.model,
    provider: raw.provider,
    tokensIn: raw.tokens_in ?? 0,
    tokensOut: raw.tokens_out ?? 0,
    createdAt: raw.created_at,
  }
}

export function createConversationService(db: any): ConversationService {
  return {
    create(input: CreateConversationInput): Conversation {
      const id = generateId()
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO conversations (id, title, status, provider_id, model_id, user_id, tokens_used, created_at, updated_at)
        VALUES (${id}, ${input.title ?? null}, 'idle', ${input.providerId ?? null}, ${input.modelId ?? null}, ${input.userId}, 0, ${now}, ${now})`)
      return { id, title: input.title ?? null, status: 'idle', providerId: input.providerId ?? null, modelId: input.modelId ?? null, userId: input.userId, tokensUsed: 0, createdAt: now, updatedAt: now }
    },

    list(userId: string, options?: { excludeArchived?: boolean; status?: string }): Conversation[] {
      let rows: any[]
      if (options?.status) {
        rows = db.all(sql`SELECT * FROM conversations WHERE user_id = ${userId} AND status = ${options.status} ORDER BY updated_at DESC`) as any[]
      } else if (options?.excludeArchived) {
        rows = db.all(sql`SELECT * FROM conversations WHERE user_id = ${userId} AND status NOT IN ('deleted', 'archived') ORDER BY updated_at DESC`) as any[]
      } else {
        rows = db.all(sql`SELECT * FROM conversations WHERE user_id = ${userId} AND status != 'deleted' ORDER BY updated_at DESC`) as any[]
      }
      return rows.map(toConversation)
    },

    get(id: string): ConversationWithMessages | null {
      const rows = db.all(sql`SELECT * FROM conversations WHERE id = ${id}`) as any[]
      if (rows.length === 0) return null
      const conv = toConversation(rows[0])
      const msgRows = db.all(sql`SELECT * FROM conversation_messages WHERE conversation_id = ${id} ORDER BY id ASC`) as any[]
      return { ...conv, messages: msgRows.map(toMessage) }
    },

    update(id: string, update: { title?: string; status?: string; providerId?: string; modelId?: string }): void {
      const now = new Date().toISOString()
      if (update.title !== undefined) {
        db.run(sql`UPDATE conversations SET title = ${update.title}, updated_at = ${now} WHERE id = ${id}`)
      }
      if (update.status !== undefined) {
        db.run(sql`UPDATE conversations SET status = ${update.status}, updated_at = ${now} WHERE id = ${id}`)
      }
      if (update.providerId !== undefined) {
        db.run(sql`UPDATE conversations SET provider_id = ${update.providerId}, updated_at = ${now} WHERE id = ${id}`)
      }
      if (update.modelId !== undefined) {
        db.run(sql`UPDATE conversations SET model_id = ${update.modelId}, updated_at = ${now} WHERE id = ${id}`)
      }
    },

    addMessage(conversationId: string, input: AddMessageInput): ConversationMessage {
      const now = new Date().toISOString()
      const tokensIn = input.tokensIn ?? 0
      const tokensOut = input.tokensOut ?? 0
      db.run(sql`INSERT INTO conversation_messages (conversation_id, role, content, model, provider, tokens_in, tokens_out, created_at)
        VALUES (${conversationId}, ${input.role}, ${input.content}, ${input.model ?? null}, ${input.provider ?? null}, ${tokensIn}, ${tokensOut}, ${now})`)
      const rows = db.all(sql`SELECT * FROM conversation_messages WHERE conversation_id = ${conversationId} ORDER BY id DESC LIMIT 1`) as any[]
      // Update conversation token count
      const totalTokens = tokensIn + tokensOut
      if (totalTokens > 0) {
        db.run(sql`UPDATE conversations SET tokens_used = tokens_used + ${totalTokens}, updated_at = ${now} WHERE id = ${conversationId}`)
      }
      return toMessage(rows[0])
    },

    softDelete(id: string): void {
      const now = new Date().toISOString()
      db.run(sql`UPDATE conversations SET status = 'deleted', updated_at = ${now} WHERE id = ${id}`)
    },
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun vitest run tests/modules/chat/conversation-service.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 7: Commit**

```bash
git add src/modules/chat/schema.ts src/modules/chat/conversation-service.ts tests/modules/chat/conversation-service.test.ts tests/helpers/test-db.ts
git commit -m "feat(chat): add conversation service with CRUD + token tracking"
```

---

### Task 3: Chat Module — Registration + Routes

**Files:**
- Create: `src/modules/chat/index.ts`
- Create: `src/modules/chat/routes.ts`
- Modify: `src/core/bootstrap.ts`
- Modify: `src/core/types.ts`
- Modify: `src/modules/auth/routes.ts`
- Create: `tests/modules/chat/routes.test.ts`

- [ ] **Step 1: Create chat module manifest**

Create `src/modules/chat/index.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { createConversationService } from './conversation-service.js'

export const chatModule: EyasModule = {
  id: 'chat',
  name: 'Chat',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Persistent chat with AI providers — streaming, context tracking',
  dependencies: ['model'],

  async onRegister(ctx: ModuleContext) {
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT, status TEXT NOT NULL DEFAULT 'idle', provider_id TEXT, model_id TEXT, user_id TEXT NOT NULL, tokens_used INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS conversation_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL REFERENCES conversations(id), role TEXT NOT NULL, content TEXT NOT NULL, model TEXT, provider TEXT, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, created_at TEXT NOT NULL)`)

    const chatService = createConversationService(ctx.db)
    ctx.chat = chatService
    ctx.logger.info('Chat module registered')
  },

  async onStart(ctx: ModuleContext) {
    ctx.logger.info('Chat module started')
  },

  async onStop() {},
}
```

- [ ] **Step 2: Add chat to ModuleContext**

In `src/core/types.ts`, add after the `providerReload` line:

```typescript
  chat: import('@modules/chat/conversation-service').ConversationService
```

- [ ] **Step 3: Register in bootstrap**

In `src/core/bootstrap.ts`, add import:
```typescript
import { chatModule } from '@modules/chat/index'
```

Add registration after the model module (around line 86):
```typescript
  if (!moduleLoader.hasModule(chatModule.id)) {
    moduleLoader.register(chatModule)
  }
```

- [ ] **Step 4: Add auth middleware for chat routes**

In `src/modules/auth/routes.ts`, add after line 117 (`router.use('/api/v1/model/*', csrfProtection)`):

```typescript
  // Auth + CSRF on chat endpoints
  router.use('/api/v1/chat/*', authenticate)
  router.use('/api/v1/chat/*', csrfProtection)
```

- [ ] **Step 5: Create chat routes**

Create `src/modules/chat/routes.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ConversationService } from './conversation-service.js'
import type { ModelGateway } from '@modules/model/types'
import type { ProviderConfigService } from '@modules/model/provider-config-service'

export function createChatRoutes(
  app: Hono,
  chatService: ConversationService,
  gateway: ModelGateway,
  configService?: ProviderConfigService,
): void {
  const router = app as any

  // ─── List Conversations ─────────────────────────
  router.get('/api/v1/chat/conversations', async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    const status = c.req.query('status')
    const excludeArchived = c.req.query('active') === 'true'
    const conversations = chatService.list(userId, { status, excludeArchived })
    return c.json({ conversations })
  })

  // ─── Create Conversation ────────────────────────
  router.post('/api/v1/chat/conversations', async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    const body = await c.req.json().catch(() => ({}))
    // Use defaults if no provider/model specified
    let providerId = body.providerId
    let modelId = body.modelId
    if (!providerId && configService) {
      const def = configService.getDefault()
      if (def) {
        providerId = def.providerId
        modelId = def.modelId
      }
    }
    const conversation = chatService.create({ userId, title: body.title, providerId, modelId })
    return c.json(conversation, 201)
  })

  // ─── Get Conversation with Messages ─────────────
  router.get('/api/v1/chat/conversations/:id', async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    const conv = chatService.get(c.req.param('id'))
    if (!conv || conv.userId !== userId) throw new HTTPException(404, { message: 'Conversation not found' })
    return c.json(conv)
  })

  // ─── Update Conversation ────────────────────────
  router.patch('/api/v1/chat/conversations/:id', async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    const id = c.req.param('id')
    const conv = chatService.get(id)
    if (!conv || conv.userId !== userId) throw new HTTPException(404, { message: 'Conversation not found' })
    const body = await c.req.json()
    chatService.update(id, body)
    return c.json(chatService.get(id))
  })

  // ─── Soft Delete ────────────────────────────────
  router.delete('/api/v1/chat/conversations/:id', async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    const id = c.req.param('id')
    const conv = chatService.get(id)
    if (!conv || conv.userId !== userId) throw new HTTPException(404, { message: 'Conversation not found' })
    chatService.softDelete(id)
    return c.json({ message: 'Conversation deleted' })
  })

  // ─── Send Message + Stream Response ─────────────
  router.post('/api/v1/chat/conversations/:id/messages', async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })

    const id = c.req.param('id')
    const conv = chatService.get(id)
    if (!conv || conv.userId !== userId) throw new HTTPException(404, { message: 'Conversation not found' })

    const body = await c.req.json()
    if (!body.content || typeof body.content !== 'string') {
      throw new HTTPException(400, { message: 'content string is required' })
    }

    const providerId = body.provider || conv.providerId
    const modelId = body.model || conv.modelId
    if (!providerId || !modelId) {
      throw new HTTPException(400, { message: 'No provider/model configured for this conversation' })
    }

    // Save user message
    chatService.addMessage(id, { role: 'user', content: body.content })
    chatService.update(id, { status: 'working' })

    // Build message history for the AI
    const fullConv = chatService.get(id)!
    const messages = fullConv.messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))

    const stream = new ReadableStream({
      async start(controller) {
        try {
          let fullText = ''
          let totalIn = 0
          let totalOut = 0

          for await (const event of gateway.stream({ provider: providerId, model: modelId, messages })) {
            if (event.type === 'text') {
              fullText += event.text
              controller.enqueue(`data: ${JSON.stringify(event)}\n\n`)
            } else if (event.type === 'done') {
              totalIn = event.response.usage.inputTokens
              totalOut = event.response.usage.outputTokens
              // Save assistant message
              const saved = chatService.addMessage(id, {
                role: 'assistant',
                content: fullText,
                model: modelId,
                provider: providerId,
                tokensIn: totalIn,
                tokensOut: totalOut,
              })
              chatService.update(id, { status: 'idle' })
              const updatedConv = chatService.get(id)!
              controller.enqueue(`data: ${JSON.stringify({ type: 'done', message: saved, conversation: { tokensUsed: updatedConv.tokensUsed, status: 'idle' } })}\n\n`)
            } else if (event.type === 'error') {
              chatService.update(id, { status: 'idle' })
              controller.enqueue(`data: ${JSON.stringify({ type: 'error', error: event.error.message })}\n\n`)
            }
          }
        } catch (err: any) {
          chatService.update(id, { status: 'idle' })
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

- [ ] **Step 6: Wire routes in chat module onStart**

Update `src/modules/chat/index.ts` onStart:

```typescript
  async onStart(ctx: ModuleContext) {
    const { createChatRoutes } = await import('./routes.js')
    createChatRoutes(ctx.http, ctx.chat, ctx.model, ctx.providerConfig)
    ctx.logger.info('Chat module started')
  },
```

- [ ] **Step 7: Write route tests**

Create `tests/modules/chat/routes.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createTestDb, insertTestOwner } from '../../helpers/test-db'
import { createConversationService } from '@modules/chat/conversation-service'
import { createChatRoutes } from '@modules/chat/routes'
import { createModelGateway } from '@modules/model/gateway'
import { createAuthRoutes } from '@modules/auth/routes'
import { createAuthMiddleware } from '@modules/auth/middleware'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createTokenService } from '@modules/auth/token'
import { buildAbilityForRole } from '@modules/permissions/roles'
import type { AIProvider, ModelInfo, ModelRequest, ModelResponse, StreamEvent } from '@modules/model/types'

function createMockProvider(): AIProvider {
  return {
    id: 'mock',
    name: 'Mock Provider',
    async listModels(): Promise<ModelInfo[]> {
      return [{ id: 'mock-model', name: 'Mock', provider: 'mock', contextWindow: 100000, maxOutputTokens: 4096, supportsTools: true, supportsImages: true, supportsStreaming: true }]
    },
    async complete(): Promise<ModelResponse> {
      return { id: 'r1', provider: 'mock', model: 'mock-model', content: [{ type: 'text', text: 'Hello!' }], stopReason: 'end', usage: { inputTokens: 5, outputTokens: 3 } }
    },
    async *stream(): AsyncIterable<StreamEvent> {
      yield { type: 'text', text: 'Hello!' }
      yield { type: 'done', response: { id: 'r1', provider: 'mock', model: 'mock-model', content: [{ type: 'text', text: 'Hello!' }], stopReason: 'end', usage: { inputTokens: 5, outputTokens: 3 } } }
    },
  }
}

const testDb = createTestDb('chat-routes')
let db: ReturnType<typeof testDb.open>
let app: Hono
let ownerToken: string

beforeEach(async () => {
  db = testDb.open()
  const gateway = createModelGateway()
  gateway.registerProvider(createMockProvider())
  const chatService = createConversationService(db)

  app = new Hono()
  app.onError(errorHandler)
  const permRegistry = createPermissionRegistry()
  const tokenService = createTokenService('test-jwt-secret')
  const ownerId = await insertTestOwner(db)
  const ability = buildAbilityForRole('owner')
  permRegistry.setAbility(ownerId, ability)
  const authMiddleware = createAuthMiddleware({ db, permissionRegistry: permRegistry, tokenService, buildAbilityForUser: (role) => buildAbilityForRole(role as any) })
  createAuthRoutes(app, { db, registry: permRegistry, tokenService, sessionDuration: 3600, accessTokenDuration: 900, refreshTokenDuration: 86400 })
  createChatRoutes(app, chatService, gateway)

  const loginRes = await app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
  })
  // Get session cookie
  ownerToken = loginRes.headers.get('Set-Cookie') || ''
})

afterEach(() => testDb.cleanup())

function authHeaders(): Record<string, string> {
  return { Cookie: ownerToken, 'X-Eyas-Request': '1', 'Content-Type': 'application/json' }
}

describe('Chat Routes', () => {
  it('POST /conversations creates a conversation', async () => {
    const res = await app.request('/api/v1/chat/conversations', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ title: 'Test Chat' }),
    })
    expect(res.status).toBe(201)
    const data = await res.json() as any
    expect(data.title).toBe('Test Chat')
    expect(data.status).toBe('idle')
  })

  it('GET /conversations lists conversations', async () => {
    await app.request('/api/v1/chat/conversations', { method: 'POST', headers: authHeaders(), body: JSON.stringify({}) })
    await app.request('/api/v1/chat/conversations', { method: 'POST', headers: authHeaders(), body: JSON.stringify({}) })
    const res = await app.request('/api/v1/chat/conversations', { headers: authHeaders() })
    const data = await res.json() as any
    expect(data.conversations).toHaveLength(2)
  })

  it('DELETE /conversations/:id soft-deletes', async () => {
    const createRes = await app.request('/api/v1/chat/conversations', { method: 'POST', headers: authHeaders(), body: JSON.stringify({}) })
    const conv = await createRes.json() as any
    const delRes = await app.request(`/api/v1/chat/conversations/${conv.id}`, { method: 'DELETE', headers: authHeaders() })
    expect(delRes.status).toBe(200)
    // Should not appear in list
    const listRes = await app.request('/api/v1/chat/conversations', { headers: authHeaders() })
    const list = await listRes.json() as any
    expect(list.conversations).toHaveLength(0)
  })

  it('POST /conversations/:id/messages streams AI response', async () => {
    const createRes = await app.request('/api/v1/chat/conversations', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ providerId: 'mock', modelId: 'mock-model' }) })
    const conv = await createRes.json() as any

    const msgRes = await app.request(`/api/v1/chat/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ content: 'Hi' }),
    })
    expect(msgRes.status).toBe(200)
    expect(msgRes.headers.get('Content-Type')).toBe('text/event-stream')
    const text = await msgRes.text()
    expect(text).toContain('"type":"text"')
    expect(text).toContain('"type":"done"')
  })
})
```

- [ ] **Step 8: Run all tests**

Run: `bun vitest run tests/modules/chat/`
Expected: ALL PASS

- [ ] **Step 9: Commit**

```bash
git add src/modules/chat/ src/core/bootstrap.ts src/core/types.ts src/modules/auth/routes.ts tests/modules/chat/
git commit -m "feat(chat): add chat module with conversation CRUD + SSE streaming"
```

---

### Task 4: Frontend — Sidebar + Routes + Chat Store

**Files:**
- Modify: `src/web/src/components/layout/sidebar.tsx`
- Create: `src/web/src/routes/chats.tsx`
- Create: `src/web/src/stores/chat-store.ts`
- Create: `src/web/src/pages/chats/chats-page.tsx`

- [ ] **Step 1: Update sidebar with New Chat + Chats**

Replace the navItems in `src/web/src/components/layout/sidebar.tsx`:

```typescript
import { Link, useNavigate, useLocation } from '@tanstack/react-router'
import { LayoutDashboard, Bot, KeyRound, Users, Settings, MessageSquarePlus, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/chats', label: 'Chats', icon: MessageSquare },
  { path: '/providers', label: 'Providers', icon: Bot },
  { path: '/secrets', label: 'Secrets', icon: KeyRound },
  { path: '/users', label: 'Users', icon: Users },
] as const
```

Add a "New Chat" button before the navItems loop (after the "Navigation" section-label div):

```tsx
        <button
          type="button"
          onClick={async () => {
            const conv = await api.post<{ id: string }>('/chat/conversations', {})
            navigate({ to: '/chats', search: { id: conv.id } })
          }}
          className="flex items-center gap-2 px-3 py-2 rounded-[7px] text-[13px] transition-colors text-muted-foreground hover:text-foreground hover:bg-accent/50 w-full text-left mb-1"
        >
          <MessageSquarePlus className="h-4 w-4" />
          New Chat
        </button>
```

Add `const navigate = useNavigate()` after the `useLocation` hook.

- [ ] **Step 2: Create route file**

Create `src/web/src/routes/chats.tsx`:

```typescript
import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import ChatsPage from '@/pages/chats/chats-page'

export const Route = createFileRoute('/chats')({
  component: () => (
    <AppLayout>
      <ChatsPage />
    </AppLayout>
  ),
  validateSearch: (search: Record<string, unknown>) => ({
    id: (search.id as string) || undefined,
  }),
})
```

- [ ] **Step 3: Create chat store**

Create `src/web/src/stores/chat-store.ts`:

```typescript
import { create } from 'zustand'

interface ChatMessage {
  id: number
  role: string
  content: string
  model: string | null
  provider: string | null
  tokensIn: number
  tokensOut: number
  createdAt: string
}

interface Conversation {
  id: string
  title: string | null
  status: string
  providerId: string | null
  modelId: string | null
  tokensUsed: number
  createdAt: string
  updatedAt: string
  messages: ChatMessage[]
}

interface ChatState {
  conversations: Conversation[]
  activeConversation: Conversation | null
  streamingText: string
  isStreaming: boolean
  setConversations: (conversations: Conversation[]) => void
  setActiveConversation: (conv: Conversation | null) => void
  appendStreamText: (text: string) => void
  setStreaming: (streaming: boolean) => void
  clearStream: () => void
  addMessage: (msg: ChatMessage) => void
  updateConversation: (update: Partial<Conversation>) => void
}

export const useChatStore = create<ChatState>((set) => ({
  conversations: [],
  activeConversation: null,
  streamingText: '',
  isStreaming: false,

  setConversations: (conversations) => set({ conversations }),
  setActiveConversation: (conv) => set({ activeConversation: conv, streamingText: '', isStreaming: false }),

  appendStreamText: (text) => set((s) => ({ streamingText: s.streamingText + text })),
  setStreaming: (streaming) => set({ isStreaming: streaming }),
  clearStream: () => set({ streamingText: '', isStreaming: false }),

  addMessage: (msg) => set((s) => {
    if (!s.activeConversation) return s
    return {
      activeConversation: {
        ...s.activeConversation,
        messages: [...s.activeConversation.messages, msg],
      },
    }
  }),

  updateConversation: (update) => set((s) => {
    if (!s.activeConversation) return s
    return { activeConversation: { ...s.activeConversation, ...update } }
  }),
}))
```

- [ ] **Step 4: Create chats page (list + dialog trigger)**

Create `src/web/src/pages/chats/chats-page.tsx`:

```typescript
import { useState, useEffect, useCallback } from 'react'
import { useSearch } from '@tanstack/react-router'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { ChatDialog } from './chat-dialog'

interface ConversationListItem {
  id: string
  title: string | null
  status: string
  providerId: string | null
  modelId: string | null
  tokensUsed: number
  updatedAt: string
}

const STATUS_STYLES: Record<string, { color: string; label: string }> = {
  idle: { color: 'text-zinc-400', label: 'Idle' },
  working: { color: 'text-blue-400 animate-pulse', label: 'Working...' },
  waiting: { color: 'text-yellow-400', label: 'Waiting' },
  archived: { color: 'text-zinc-600', label: 'Archived' },
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function ChatsPage() {
  const search = useSearch({ from: '/chats' })
  const { data, refetch } = useApi<{ conversations: ConversationListItem[] }>('/chat/conversations')
  const [selectedId, setSelectedId] = useState<string | null>(search.id || null)
  const [filter, setFilter] = useState<'all' | 'active' | 'archived'>('all')

  useEffect(() => {
    if (search.id) setSelectedId(search.id)
  }, [search.id])

  const conversations = (data?.conversations ?? []).filter(c => {
    if (filter === 'active') return c.status !== 'archived'
    if (filter === 'archived') return c.status === 'archived'
    return true
  })

  const handleClose = useCallback(() => {
    setSelectedId(null)
    refetch()
  }, [refetch])

  return (
    <div>
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <h1 className="page-title">Chats</h1>
          <p className="text-sm text-muted-foreground">Your conversations with AI</p>
        </div>
        <div className="flex gap-1 text-xs">
          {(['all', 'active', 'archived'] as const).map(f => (
            <button
              key={f}
              className={`px-3 py-1 rounded-md transition-colors ${filter === f ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {conversations.map(conv => {
          const style = STATUS_STYLES[conv.status] ?? STATUS_STYLES.idle
          return (
            <button
              key={conv.id}
              type="button"
              className="glass-card p-4 flex items-center gap-4 text-left w-full hover:bg-accent/30 transition-colors cursor-pointer"
              onClick={() => setSelectedId(conv.id)}
            >
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${style.color.includes('animate') ? 'bg-blue-400 animate-pulse' : conv.status === 'idle' ? 'bg-zinc-400' : conv.status === 'waiting' ? 'bg-yellow-400' : 'bg-zinc-600'}`} />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{conv.title || 'Untitled'}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{timeAgo(conv.updatedAt)}</div>
              </div>
              <Badge variant="outline" className="text-[10px] flex-shrink-0">{style.label}</Badge>
            </button>
          )
        })}
        {conversations.length === 0 && (
          <p className="text-sm text-muted-foreground mt-4 text-center">No conversations yet. Click "New Chat" to start one.</p>
        )}
      </div>

      <ChatDialog
        conversationId={selectedId}
        onClose={handleClose}
      />
    </div>
  )
}
```

- [ ] **Step 5: Verify frontend compiles**

Create stub `src/web/src/pages/chats/chat-dialog.tsx`:

```typescript
interface ChatDialogProps {
  conversationId: string | null
  onClose: () => void
}

export function ChatDialog({ conversationId, onClose }: ChatDialogProps) {
  if (!conversationId) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-[70%] max-h-[90vh] bg-background border rounded-xl shadow-2xl p-6">
        <p>Chat dialog for {conversationId} — implementing next</p>
      </div>
    </div>
  )
}
```

Run: `cd src/web && bun run build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add src/web/src/
git commit -m "feat(web): add sidebar nav (New Chat + Chats), chats list page, chat store"
```

---

### Task 5: Frontend — Context Bar + Chat Header

**Files:**
- Create: `src/web/src/pages/chats/context-bar.tsx`
- Create: `src/web/src/pages/chats/chat-header.tsx`

- [ ] **Step 1: Create context bar component**

Create `src/web/src/pages/chats/context-bar.tsx`:

```typescript
interface ContextBarProps {
  tokensUsed: number
  contextWindow: number
}

export function ContextBar({ tokensUsed, contextWindow }: ContextBarProps) {
  if (contextWindow <= 0) return null
  const pct = Math.min((tokensUsed / contextWindow) * 100, 100)
  const color = pct < 50 ? 'bg-emerald-500' : pct < 75 ? 'bg-yellow-500' : 'bg-red-500'

  return (
    <div className="w-full h-1.5 bg-accent/30 rounded-full overflow-hidden" title={`${tokensUsed.toLocaleString()} / ${contextWindow.toLocaleString()} tokens (${pct.toFixed(1)}%)`}>
      <div className={`h-full ${color} transition-all duration-300`} style={{ width: `${pct}%` }} />
    </div>
  )
}
```

- [ ] **Step 2: Create chat header component**

Create `src/web/src/pages/chats/chat-header.tsx`:

```typescript
import { useState, useEffect } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { X, Pencil, Check } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface ProviderOption { id: string; name: string; enabled: boolean; active: boolean; modelCount: number; enabledModelCount: number }
interface ModelOption { id: string; modelId: string; name: string; enabled: boolean }

interface ChatHeaderProps {
  conversationId: string
  title: string | null
  status: string
  providerId: string | null
  modelId: string | null
  onClose: () => void
  onProviderChange: (providerId: string, modelId: string) => void
  onTitleChange: (title: string) => void
}

const STATUS_BADGE: Record<string, { variant: 'secondary' | 'outline' | 'destructive'; className: string; label: string }> = {
  idle: { variant: 'outline', className: 'text-zinc-400', label: 'Idle' },
  working: { variant: 'secondary', className: 'text-blue-400 animate-pulse', label: 'Working...' },
  waiting: { variant: 'secondary', className: 'text-yellow-400', label: 'Waiting' },
  archived: { variant: 'outline', className: 'text-zinc-600', label: 'Archived' },
}

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: 'Anthropic', openai: 'OpenAI', openrouter: 'OpenRouter',
  gemini: 'Gemini', 'claude-code': 'Claude Code CLI',
}

export function ChatHeader({ conversationId, title, status, providerId, modelId, onClose, onProviderChange, onTitleChange }: ChatHeaderProps) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(title || '')
  const { data: providerData } = useApi<{ providers: ProviderOption[] }>('/model/providers')
  const { data: modelData } = useApi<{ models: ModelOption[] }>(providerId ? `/model/providers/${providerId}` : '')

  const providers = (providerData?.providers ?? []).filter(p => p.active)
  const models = (modelData as any)?.models ?? []

  const saveTitle = () => {
    if (titleDraft.trim()) {
      onTitleChange(titleDraft.trim())
    }
    setEditingTitle(false)
  }

  const badge = STATUS_BADGE[status] ?? STATUS_BADGE.idle

  return (
    <div className="flex items-center gap-3 p-4 border-b">
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {editingTitle ? (
          <div className="flex items-center gap-1">
            <Input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveTitle()}
              onBlur={saveTitle}
              className="h-7 text-sm w-60"
              autoFocus
            />
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={saveTitle}><Check className="h-3 w-3" /></Button>
          </div>
        ) : (
          <button className="text-sm font-semibold truncate flex items-center gap-1 hover:text-foreground/80" onClick={() => { setTitleDraft(title || ''); setEditingTitle(true) }}>
            {title || 'Untitled'}
            <Pencil className="h-3 w-3 text-muted-foreground" />
          </button>
        )}
        <Badge variant={badge.variant} className={`text-[10px] ${badge.className}`}>{badge.label}</Badge>
      </div>

      <Select value={providerId ?? ''} onValueChange={(val) => { onProviderChange(val, '') }}>
        <SelectTrigger className="w-[140px] h-8 text-xs">
          <SelectValue placeholder="Provider" />
        </SelectTrigger>
        <SelectContent>
          {providers.map(p => (
            <SelectItem key={p.id} value={p.id} className="text-xs">{PROVIDER_NAMES[p.id] ?? p.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={modelId ?? ''} onValueChange={(val) => { if (providerId) onProviderChange(providerId, val) }}>
        <SelectTrigger className="w-[200px] h-8 text-xs">
          <SelectValue placeholder="Model" />
        </SelectTrigger>
        <SelectContent>
          {models.filter((m: ModelOption) => m.enabled).map((m: ModelOption) => (
            <SelectItem key={m.id} value={m.modelId} className="text-xs">{m.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 flex-shrink-0">
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
```

- [ ] **Step 3: Verify build**

Run: `cd src/web && bun run build`
Expected: Build succeeds (Select component should already be installed)

Check if Select is available: `ls src/web/src/components/ui/select.tsx`. If missing, install: `cd src/web && bunx shadcn@latest add select --yes`

- [ ] **Step 4: Commit**

```bash
git add src/web/src/pages/chats/
git commit -m "feat(web): add context bar and chat header with provider/model selectors"
```

---

### Task 6: Frontend — Chat Messages + Input

**Files:**
- Create: `src/web/src/pages/chats/chat-messages.tsx`
- Create: `src/web/src/pages/chats/chat-input.tsx`

- [ ] **Step 1: Create chat messages component**

Create `src/web/src/pages/chats/chat-messages.tsx`:

```typescript
import { useEffect, useRef } from 'react'
import { Bot, User } from 'lucide-react'

interface Message {
  id: number
  role: string
  content: string
  createdAt: string
}

interface ChatMessagesProps {
  messages: Message[]
  streamingText: string
  isStreaming: boolean
}

export function ChatMessages({ messages, streamingText, isStreaming }: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, streamingText])

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.map(msg => (
        <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
          {msg.role !== 'user' && (
            <div className="h-7 w-7 rounded-lg bg-accent/50 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Bot className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
          <div className={`max-w-[75%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-accent/40'}`}>
            <div className="whitespace-pre-wrap">{msg.content}</div>
          </div>
          {msg.role === 'user' && (
            <div className="h-7 w-7 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <User className="h-4 w-4 text-primary" />
            </div>
          )}
        </div>
      ))}

      {isStreaming && streamingText && (
        <div className="flex gap-3">
          <div className="h-7 w-7 rounded-lg bg-accent/50 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Bot className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="max-w-[75%] rounded-xl px-4 py-2.5 text-sm leading-relaxed bg-accent/40">
            <div className="whitespace-pre-wrap">{streamingText}<span className="animate-pulse">|</span></div>
          </div>
        </div>
      )}

      {messages.length === 0 && !isStreaming && (
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          Start a conversation...
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}
```

- [ ] **Step 2: Create chat input component**

Create `src/web/src/pages/chats/chat-input.tsx`:

```typescript
import { useState, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { ArrowUp, Paperclip } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface ChatInputProps {
  onSend: (content: string) => void
  disabled: boolean
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [value, disabled, onSend])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value)
    // Auto-resize
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 240) + 'px'
  }

  return (
    <div className="border-t p-3 flex items-end gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-9 w-9 flex-shrink-0 text-muted-foreground" disabled>
            <Paperclip className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>File attachments — coming soon</TooltipContent>
      </Tooltip>

      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder="Type a message... (Shift+Enter for newline)"
        disabled={disabled}
        rows={1}
        className="flex-1 resize-none bg-accent/30 border border-border/50 rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring min-h-[38px] max-h-[240px]"
      />

      <Button
        size="icon"
        className="h-9 w-9 flex-shrink-0"
        disabled={disabled || !value.trim()}
        onClick={handleSend}
      >
        <ArrowUp className="h-4 w-4" />
      </Button>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/web/src/pages/chats/
git commit -m "feat(web): add chat messages list and multi-line input components"
```

---

### Task 7: Frontend — Chat Dialog (Main Component)

**Files:**
- Rewrite: `src/web/src/pages/chats/chat-dialog.tsx`

- [ ] **Step 1: Implement full chat dialog**

Replace `src/web/src/pages/chats/chat-dialog.tsx`:

```typescript
import { useEffect, useCallback } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { useChatStore } from '@/stores/chat-store'
import { ContextBar } from './context-bar'
import { ChatHeader } from './chat-header'
import { ChatMessages } from './chat-messages'
import { ChatInput } from './chat-input'

interface ChatDialogProps {
  conversationId: string | null
  onClose: () => void
}

export function ChatDialog({ conversationId, onClose }: ChatDialogProps) {
  const { data, refetch } = useApi<any>(conversationId ? `/chat/conversations/${conversationId}` : '')
  const { activeConversation, setActiveConversation, streamingText, isStreaming, appendStreamText, setStreaming, clearStream, addMessage, updateConversation } = useChatStore()

  // Load conversation into store when data arrives
  useEffect(() => {
    if (data) {
      setActiveConversation(data)
    }
  }, [data, setActiveConversation])

  // Escape to close
  useEffect(() => {
    if (!conversationId) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [conversationId, onClose])

  // Clean up on close
  useEffect(() => {
    if (!conversationId) {
      setActiveConversation(null)
    }
  }, [conversationId, setActiveConversation])

  const handleSend = useCallback(async (content: string) => {
    if (!conversationId || !activeConversation) return

    // Optimistically add user message
    const userMsg = { id: Date.now(), role: 'user', content, model: null, provider: null, tokensIn: 0, tokensOut: 0, createdAt: new Date().toISOString() }
    addMessage(userMsg)
    setStreaming(true)
    clearStream()

    try {
      const res = await fetch(`/api/v1/chat/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Eyas-Request': '1' },
        credentials: 'include',
        body: JSON.stringify({ content }),
      })

      const reader = res.body?.getReader()
      if (!reader) return
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const json = line.slice(6)
          try {
            const event = JSON.parse(json)
            if (event.type === 'text') {
              appendStreamText(event.text)
            } else if (event.type === 'done') {
              addMessage(event.message)
              if (event.conversation) {
                updateConversation({ tokensUsed: event.conversation.tokensUsed, status: event.conversation.status })
              }
            } else if (event.type === 'title') {
              updateConversation({ title: event.title })
            } else if (event.type === 'error') {
              console.error('Stream error:', event.error)
            }
          } catch {}
        }
      }
    } catch (err) {
      console.error('Send error:', err)
    } finally {
      setStreaming(false)
    }
  }, [conversationId, activeConversation, addMessage, appendStreamText, setStreaming, clearStream, updateConversation])

  const handleProviderChange = useCallback(async (providerId: string, modelId: string) => {
    if (!conversationId) return
    await api.patch(`/chat/conversations/${conversationId}`, { providerId, modelId: modelId || undefined })
    refetch()
  }, [conversationId, refetch])

  const handleTitleChange = useCallback(async (title: string) => {
    if (!conversationId) return
    await api.patch(`/chat/conversations/${conversationId}`, { title })
    updateConversation({ title })
  }, [conversationId, updateConversation])

  if (!conversationId) return null

  const conv = activeConversation
  // Determine context window from the selected model
  const contextWindow = 200000 // Default — will be enhanced when model info is available

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-[70%] min-w-[600px] max-w-[1000px] h-[90vh] bg-background border rounded-xl shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-200">
        <ContextBar tokensUsed={conv?.tokensUsed ?? 0} contextWindow={contextWindow} />

        <ChatHeader
          conversationId={conversationId}
          title={conv?.title ?? null}
          status={conv?.status ?? 'idle'}
          providerId={conv?.providerId ?? null}
          modelId={conv?.modelId ?? null}
          onClose={onClose}
          onProviderChange={handleProviderChange}
          onTitleChange={handleTitleChange}
        />

        <ChatMessages
          messages={conv?.messages ?? []}
          streamingText={streamingText}
          isStreaming={isStreaming}
        />

        <ChatInput
          onSend={handleSend}
          disabled={isStreaming || conv?.status === 'working'}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

Run: `cd src/web && bun run build`
Expected: Build succeeds. If `Select` or `Tooltip` components are missing, install them:
```bash
cd src/web && bunx shadcn@latest add select tooltip --yes
```

- [ ] **Step 3: Commit**

```bash
git add src/web/src/pages/chats/chat-dialog.tsx
git commit -m "feat(web): implement full chat dialog with SSE streaming, context bar, provider selector"
```

---

### Task 8: Frontend — Default Provider in Provider Panel

**Files:**
- Modify: `src/web/src/pages/providers/provider-panel.tsx`

- [ ] **Step 1: Add "Set as Default" section to provider panel**

In `src/web/src/pages/providers/provider-panel.tsx`, add between the API key section and the separator (after the `{isClaudeCode && ...}` block):

```tsx
          {/* Default Settings */}
          {detail?.active && (
            <div className="space-y-3">
              <span className="text-sm font-medium">Default Settings</span>
              <Button
                variant={detail.isDefault ? 'secondary' : 'outline'}
                size="sm"
                className="w-full"
                onClick={async () => {
                  const modelId = detail.models[0]?.modelId || ''
                  await api.put('/model/defaults', { providerId, modelId })
                  refetch()
                  onRefresh()
                }}
              >
                {detail.isDefault ? '★ Default Provider' : 'Set as Default Provider'}
              </Button>
            </div>
          )}
```

Note: The provider detail response needs to include `isDefault`. Update the GET `/model/providers/:id` endpoint in `src/modules/model/routes.ts` to include it from `cfg.isDefault`.

- [ ] **Step 2: Verify build**

Run: `cd src/web && bun run build`

- [ ] **Step 3: Commit**

```bash
git add src/web/src/pages/providers/provider-panel.tsx
git commit -m "feat(web): add Set as Default Provider button in provider panel"
```

---

### Task 9: Run All Tests + Smoke Test

- [ ] **Step 1: Run all backend tests**

Run: `bun vitest run`
Expected: ALL PASS

- [ ] **Step 2: Build frontend**

Run: `cd src/web && bun run build`
Expected: Build succeeds

- [ ] **Step 3: Manual smoke test**

1. Start backend: `bun src/main.ts`
2. Start frontend: `cd src/web && bun run dev`
3. Navigate to `localhost:5173`
4. Click "New Chat" in sidebar — should open chat dialog
5. Select provider and model in dropdowns
6. Type a message and press Enter — should stream response
7. Context bar should update after response
8. Close dialog, verify conversation appears in Chats list
9. Click conversation to reopen — messages should be persisted
10. Check Dashboard — counts should be accurate

- [ ] **Step 4: Final commit if fixes needed**

```bash
git add -A
git commit -m "fix: smoke test adjustments for chat module"
```
