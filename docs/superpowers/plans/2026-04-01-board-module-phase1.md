# Board Module Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename chat→conversations module, then add board module with ProjectType→Project→Stage→Conversation hierarchy and kanban frontend.

**Architecture:** Sequential two-part change. Part A is a pure rename refactor (chat→conversations) across backend, frontend, and tests. Part B adds a new `board` module that depends on `conversations` and introduces project_types, projects, stages tables plus ALTER TABLE on conversations. Frontend gets a kanban board page with @dnd-kit drag & drop.

**Tech Stack:** TypeScript, Hono, Drizzle ORM, SQLite, Vitest, React 19, TanStack Router, Zustand, @dnd-kit/core, @dnd-kit/sortable, shadcn/ui, Tailwind CSS

---

## File Structure

### Part A: Rename (files to move/modify)

**Move (git mv):**
- `src/modules/chat/` → `src/modules/conversations/`
- `tests/modules/chat/` → `tests/modules/conversations/`
- `src/web/src/pages/chats/` → `src/web/src/pages/conversations/`
- `src/web/src/stores/chat-store.ts` → `src/web/src/stores/conversation-store.ts`
- `src/web/src/routes/chats.tsx` → `src/web/src/routes/conversations.tsx`

**Modify:**
- `src/core/types.ts` — `ctx.chat` → `ctx.conversations`
- `src/core/bootstrap.ts` — import path + variable name
- `src/modules/auth/routes.ts` — middleware mount path `/api/v1/chat/*` → `/api/v1/conversations/*`
- `src/web/src/components/layout/sidebar.tsx` — labels + API path
- Renamed frontend files — internal references

### Part B: Board Module (new files)

**Create:**
- `src/modules/board/index.ts` — module definition
- `src/modules/board/schema.ts` — Drizzle tables
- `src/modules/board/services/project-type-service.ts`
- `src/modules/board/services/project-service.ts`
- `src/modules/board/services/stage-service.ts`
- `src/modules/board/services/prompt-service.ts`
- `src/modules/board/routes.ts`
- `tests/modules/board/prompt-service.test.ts`
- `tests/modules/board/project-type-service.test.ts`
- `tests/modules/board/project-service.test.ts`
- `tests/modules/board/stage-service.test.ts`
- `tests/modules/board/routes.test.ts`
- `src/web/src/pages/board/board-page.tsx`
- `src/web/src/pages/board/board-header.tsx`
- `src/web/src/pages/board/board-column.tsx`
- `src/web/src/pages/board/board-card.tsx`
- `src/web/src/stores/board-store.ts`
- `src/web/src/routes/board.tsx`

**Modify:**
- `src/core/types.ts` — add `board` to ModuleContext
- `src/core/bootstrap.ts` — register board module
- `src/modules/auth/routes.ts` — add auth middleware for board routes
- `tests/helpers/test-db.ts` — add board tables to test schema
- `src/web/src/components/layout/sidebar.tsx` — add Board nav item

---

## Part A: Chat → Conversations Rename

### Task 1: Backend module rename + fix imports

**Files:**
- Move: `src/modules/chat/` → `src/modules/conversations/`
- Modify: `src/modules/conversations/index.ts`
- Modify: `src/modules/conversations/routes.ts`
- Modify: `src/core/types.ts:57`
- Modify: `src/core/bootstrap.ts:16,94-96`
- Modify: `src/modules/auth/routes.ts:119-121`

- [ ] **Step 1: Move the directory**

```bash
cd /Users/eyssen/GitHub/eyas
git mv src/modules/chat src/modules/conversations
```

- [ ] **Step 2: Update module definition in `src/modules/conversations/index.ts`**

Replace the module definition:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { createConversationService } from './conversation-service.js'

export const conversationsModule: EyasModule = {
  id: 'conversations',
  name: 'Conversations',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Persistent conversations with AI providers — streaming, context tracking',
  dependencies: ['model'],

  async onRegister(ctx: ModuleContext) {
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT, status TEXT NOT NULL DEFAULT 'idle', provider_id TEXT, model_id TEXT, user_id TEXT NOT NULL, tokens_used INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS conversation_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL REFERENCES conversations(id), role TEXT NOT NULL, content TEXT NOT NULL, model TEXT, provider TEXT, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, created_at TEXT NOT NULL)`)

    const conversationService = createConversationService(ctx.db)
    ctx.conversations = conversationService
    ctx.logger.info('Conversations module registered')
  },

  async onStart(ctx: ModuleContext) {
    const { createConversationRoutes } = await import('./routes.js')
    createConversationRoutes(ctx.http, ctx.conversations, ctx.model, ctx.providerConfig)
    ctx.logger.info('Conversations module started')
  },

  async onStop() {},
}
```

- [ ] **Step 3: Update routes in `src/modules/conversations/routes.ts`**

Rename the function and change all route paths from `/api/v1/chat/conversations` to `/api/v1/conversations`:

```typescript
export function createConversationRoutes(
  app: Hono,
  conversationService: ConversationService,
  gateway: ModelGateway,
  configService?: ProviderConfigService,
): void {
  const router = app as any

  // All route paths: /api/v1/chat/conversations → /api/v1/conversations
  router.get('/api/v1/conversations', async (c: any) => {
```

Apply this change to all 6 route registrations in the file:
- `router.get('/api/v1/conversations', ...)` (list)
- `router.post('/api/v1/conversations', ...)` (create)
- `router.get('/api/v1/conversations/:id', ...)` (get)
- `router.patch('/api/v1/conversations/:id', ...)` (update)
- `router.delete('/api/v1/conversations/:id', ...)` (delete)
- `router.post('/api/v1/conversations/:id/messages', ...)` (stream)

- [ ] **Step 4: Update ModuleContext in `src/core/types.ts`**

Change line 57:

```typescript
  conversations: import('@modules/conversations/conversation-service').ConversationService
```

(was `chat: import('@modules/chat/conversation-service').ConversationService`)

- [ ] **Step 5: Update bootstrap in `src/core/bootstrap.ts`**

Change line 16 import:

```typescript
import { conversationsModule } from '@modules/conversations/index'
```

Change lines 94-96:

```typescript
  if (!moduleLoader.hasModule(conversationsModule.id)) {
    moduleLoader.register(conversationsModule)
  }
```

- [ ] **Step 6: Update auth middleware mount in `src/modules/auth/routes.ts`**

Change lines 119-121 from:

```typescript
  // Auth + CSRF on chat endpoints
  router.use('/api/v1/chat/*', authenticate)
  router.use('/api/v1/chat/*', csrfProtection)
```

To:

```typescript
  // Auth + CSRF on conversation endpoints
  router.use('/api/v1/conversations/*', authenticate)
  router.use('/api/v1/conversations/*', csrfProtection)
```

- [ ] **Step 7: Run backend tests**

```bash
bun vitest run tests/core/bootstrap.test.ts
```

Expected: PASS (bootstrap loads the renamed module)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: rename chat module to conversations (backend)"
```

### Task 2: Rename tests + fix imports

**Files:**
- Move: `tests/modules/chat/` → `tests/modules/conversations/`
- Modify: `tests/modules/conversations/conversation-service.test.ts`
- Modify: `tests/modules/conversations/routes.test.ts`

- [ ] **Step 1: Move test directory**

```bash
git mv tests/modules/chat tests/modules/conversations
```

- [ ] **Step 2: Update imports in `tests/modules/conversations/conversation-service.test.ts`**

Change line 4:

```typescript
import { createConversationService, type ConversationService } from '@modules/conversations/conversation-service'
```

- [ ] **Step 3: Update imports and routes in `tests/modules/conversations/routes.test.ts`**

Change imports (lines 7-8):

```typescript
import { createConversationRoutes } from '@modules/conversations/routes'
import { createConversationService } from '@modules/conversations/conversation-service'
```

Change `createChatRoutes` → `createConversationRoutes` (line 99):

```typescript
  createConversationRoutes(app, chatService, gateway, configService)
```

Change variable name `chatService` → `conversationService` throughout.

Change auth middleware mount (line 98):

```typescript
  app.use('/api/v1/conversations/*', authMiddleware)
```

Change all route paths in test expectations from `/api/v1/chat/conversations` to `/api/v1/conversations`:

```typescript
// Every app.request call changes, e.g.:
const res = await app.request('/api/v1/conversations', {
  method: 'POST',
  headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'Test chat' }),
})
```

Apply to all ~15 `app.request` calls in the file.

- [ ] **Step 4: Run all tests**

```bash
bun vitest run
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: rename chat tests to conversations"
```

### Task 3: Frontend rename

**Files:**
- Move: `src/web/src/pages/chats/` → `src/web/src/pages/conversations/`
- Rename files inside: `chat-dialog.tsx` → `conversation-dialog.tsx`, `chat-header.tsx` → `conversation-header.tsx`, `chat-input.tsx` → `conversation-input.tsx`, `chat-messages.tsx` → `conversation-messages.tsx`, `chats-page.tsx` → `conversations-page.tsx`
- Move: `src/web/src/stores/chat-store.ts` → `src/web/src/stores/conversation-store.ts`
- Move: `src/web/src/routes/chats.tsx` → `src/web/src/routes/conversations.tsx`
- Modify: `src/web/src/components/layout/sidebar.tsx`

- [ ] **Step 1: Move and rename frontend files**

```bash
cd /Users/eyssen/GitHub/eyas
git mv src/web/src/pages/chats src/web/src/pages/conversations
git mv src/web/src/pages/conversations/chat-dialog.tsx src/web/src/pages/conversations/conversation-dialog.tsx
git mv src/web/src/pages/conversations/chat-header.tsx src/web/src/pages/conversations/conversation-header.tsx
git mv src/web/src/pages/conversations/chat-input.tsx src/web/src/pages/conversations/conversation-input.tsx
git mv src/web/src/pages/conversations/chat-messages.tsx src/web/src/pages/conversations/conversation-messages.tsx
git mv src/web/src/pages/conversations/chats-page.tsx src/web/src/pages/conversations/conversations-page.tsx
git mv src/web/src/stores/chat-store.ts src/web/src/stores/conversation-store.ts
git mv src/web/src/routes/chats.tsx src/web/src/routes/conversations.tsx
```

- [ ] **Step 2: Update `src/web/src/stores/conversation-store.ts`**

Rename the store hook:

```typescript
export const useConversationStore = create<ChatState>((set) => ({
```

(Rename `ChatState` → `ConversationState`, `ChatMessage` → `ConversationMessage` for consistency)

Full file:

```typescript
import { create } from 'zustand'

interface ConversationMessage {
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
  messages: ConversationMessage[]
}

interface ConversationState {
  activeConversation: Conversation | null
  streamingText: string
  isStreaming: boolean
  setActiveConversation: (conv: Conversation | null) => void
  appendStreamText: (text: string) => void
  setStreaming: (streaming: boolean) => void
  clearStream: () => void
  addMessage: (msg: ConversationMessage) => void
  updateConversation: (update: Partial<Conversation>) => void
}

export const useConversationStore = create<ConversationState>((set) => ({
  activeConversation: null,
  streamingText: '',
  isStreaming: false,

  setActiveConversation: (conv) =>
    set({ activeConversation: conv, streamingText: '', isStreaming: false }),
  appendStreamText: (text) => set((s) => ({ streamingText: s.streamingText + text })),
  setStreaming: (streaming) => set({ isStreaming: streaming }),
  clearStream: () => set({ streamingText: '', isStreaming: false }),

  addMessage: (msg) =>
    set((s) => {
      if (!s.activeConversation) return s
      return {
        activeConversation: {
          ...s.activeConversation,
          messages: [...s.activeConversation.messages, msg],
        },
      }
    }),

  updateConversation: (update) =>
    set((s) => {
      if (!s.activeConversation) return s
      return { activeConversation: { ...s.activeConversation, ...update } }
    }),
}))
```

- [ ] **Step 3: Update `src/web/src/pages/conversations/conversation-dialog.tsx`**

Change imports:

```typescript
import { useConversationStore } from '@/stores/conversation-store'
import { ContextBar } from './context-bar'
import { ConversationHeader } from './conversation-header'
import { ConversationMessages } from './conversation-messages'
import { ConversationInput } from './conversation-input'
```

Change `useChatStore` → `useConversationStore`.

Change API paths:
- `/chat/conversations/${conversationId}` → `/conversations/${conversationId}` (useApi call, line 16)
- `/api/v1/chat/conversations/${sendingId}/messages` → `/api/v1/conversations/${sendingId}/messages` (fetch call, line 82)
- `/chat/conversations/${conversationId}` → `/conversations/${conversationId}` (api.patch calls, lines 163, 169)

Rename component exports:
- `ChatDialog` → `ConversationDialog`
- `ChatDialogProps` → `ConversationDialogProps`

- [ ] **Step 4: Update `src/web/src/pages/conversations/conversation-header.tsx`**

Rename exports: `ChatHeader` → `ConversationHeader`, `ChatHeaderProps` → `ConversationHeaderProps`.

- [ ] **Step 5: Update `src/web/src/pages/conversations/conversation-input.tsx`**

Rename exports: `ChatInput` → `ConversationInput`, `ChatInputProps` → `ConversationInputProps`.

- [ ] **Step 6: Update `src/web/src/pages/conversations/conversation-messages.tsx`**

Rename exports: `ChatMessages` → `ConversationMessages`, `ChatMessagesProps` → `ConversationMessagesProps`.

- [ ] **Step 7: Update `src/web/src/pages/conversations/conversations-page.tsx`**

Change:
- Import `ConversationDialog` from `./conversation-dialog`
- API path: `/chat/conversations` → `/conversations`
- `useSearch({ from: '/chats' })` → `useSearch({ from: '/conversations' })`
- Page title: `"Chats"` → `"Conversations"`
- Empty state text: `"New Chat"` → `"New Conversation"`
- Export: `ChatsPage` → `ConversationsPage`

```typescript
import { ConversationDialog } from './conversation-dialog'

// ...
const { data, refetch } = useApi<{ conversations: ConversationListItem[] }>('/conversations')
// ...
const search = useSearch({ from: '/conversations' })
// ...
<h1 className="page-title">Conversations</h1>
// ...
<ConversationDialog conversationId={selectedId} onClose={handleClose} />
```

- [ ] **Step 8: Update `src/web/src/routes/conversations.tsx`**

```typescript
import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import ConversationsPage from '@/pages/conversations/conversations-page'

export const Route = createFileRoute('/conversations')({
  component: () => (
    <AppLayout>
      <ConversationsPage />
    </AppLayout>
  ),
  validateSearch: (search: Record<string, unknown>) => ({
    id: (search.id as string) || undefined,
  }),
})
```

- [ ] **Step 9: Update `src/web/src/components/layout/sidebar.tsx`**

Change nav items:

```typescript
  { path: '/conversations', label: 'Conversations', icon: MessageSquare },
```

Change "New Chat" button:
- API path: `api.post<{ id: string }>('/conversations', {})` (was `/chat/conversations`)
- Navigate: `navigate({ to: '/conversations', search: { id: conv.id } as any })`
- Label: `New Conversation`

- [ ] **Step 10: Regenerate TanStack Router route tree**

```bash
cd /Users/eyssen/GitHub/eyas/src/web && npx @tanstack/router-cli generate
```

This auto-generates `routeTree.gen.ts` from the renamed file.

- [ ] **Step 11: Build frontend to verify**

```bash
cd /Users/eyssen/GitHub/eyas/src/web && bun run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 12: Run all tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run
```

Expected: All tests PASS.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "refactor: rename chat to conversations (frontend + tests)"
```

---

## Part B: Board Module

### Task 4: Prompt service (pure function, no DB)

**Files:**
- Create: `src/modules/board/services/prompt-service.ts`
- Create: `tests/modules/board/prompt-service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/modules/board/prompt-service.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { resolvePromptChain } from '@modules/board/services/prompt-service'

describe('resolvePromptChain', () => {
  it('returns empty string when all levels are empty', () => {
    expect(resolvePromptChain(undefined, undefined, undefined)).toBe('')
  })

  it('uses type prompt when others are empty', () => {
    expect(resolvePromptChain('You are a bug tracker', undefined, undefined)).toBe('You are a bug tracker')
  })

  it('project overrides type when no "+" prefix', () => {
    expect(resolvePromptChain('Type prompt', 'Project override', undefined)).toBe('Project override')
  })

  it('project extends type with "+" prefix', () => {
    expect(resolvePromptChain('Type prompt', '+ Extra context', undefined)).toBe('Type prompt\nExtra context')
  })

  it('conversation overrides everything when no "+" prefix', () => {
    expect(resolvePromptChain('Type', 'Project', 'Conv override')).toBe('Conv override')
  })

  it('conversation extends with "+" prefix', () => {
    expect(resolvePromptChain('Type', '+ Project ext', '+ Conv ext')).toBe('Type\nProject ext\nConv ext')
  })

  it('handles "+" extend on empty parent', () => {
    expect(resolvePromptChain(undefined, '+ Extend nothing', undefined)).toBe('Extend nothing')
  })

  it('trims whitespace', () => {
    expect(resolvePromptChain('  Type  ', '  + Extra  ', undefined)).toBe('Type\nExtra')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun vitest run tests/modules/board/prompt-service.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/modules/board/services/prompt-service.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Resolve prompt inheritance: ProjectType → Project → Conversation.
 * Empty/null = inherit parent. "+" prefix = extend parent. Other = override.
 */
export function resolvePromptChain(
  typePrompt: string | undefined,
  projectPrompt: string | undefined,
  conversationPrompt: string | undefined,
): string {
  const base = typePrompt?.trim() || ''
  const mid = applyLevel(base, projectPrompt)
  return applyLevel(mid, conversationPrompt)
}

function applyLevel(parent: string, child: string | undefined): string {
  if (!child || child.trim() === '') return parent
  const trimmed = child.trim()
  if (trimmed.startsWith('+')) {
    const extension = trimmed.slice(1).trim()
    return parent ? `${parent}\n${extension}` : extension
  }
  return trimmed
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun vitest run tests/modules/board/prompt-service.test.ts
```

Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/board/services/prompt-service.ts tests/modules/board/prompt-service.test.ts
git commit -m "feat(board): add prompt inheritance service"
```

### Task 5: Board schema + project type service

**Files:**
- Create: `src/modules/board/schema.ts`
- Create: `src/modules/board/services/project-type-service.ts`
- Create: `tests/modules/board/project-type-service.test.ts`
- Modify: `tests/helpers/test-db.ts`

- [ ] **Step 1: Create Drizzle schema**

Create `src/modules/board/schema.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

export const projectTypes = sqliteTable('project_types', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  prompt: text('prompt').notNull().default(''),
  defaultStages: text('default_stages').notNull().default('["Backlog","In Progress","Done"]'),
  defaultPriority: text('default_priority').notNull().default('normal'),
  color: text('color'),
  icon: text('icon'),
  indexedSources: text('indexed_sources'),
  skills: text('skills'),
  permissions: text('permissions'),
  createdAt: text('created_at').notNull(),
})

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  typeId: text('type_id'),
  prompt: text('prompt'),
  indexedSources: text('indexed_sources'),
  skills: text('skills'),
  permissions: text('permissions'),
  color: text('color'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const stages = sqliteTable('stages', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  color: text('color'),
  sortOrder: integer('sort_order').notNull().default(0),
  isClosed: integer('is_closed').notNull().default(0),
  isHidden: integer('is_hidden').notNull().default(0),
  isFolded: integer('is_folded').notNull().default(0),
  botListen: integer('bot_listen').notNull().default(0),
  autoAssigneeId: text('auto_assignee_id'),
  createdAt: text('created_at').notNull(),
})
```

- [ ] **Step 2: Write the failing test for ProjectTypeService**

Create `tests/modules/board/project-type-service.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createProjectTypeService, type ProjectTypeService } from '@modules/board/services/project-type-service'

const testDb = createTestDb('board-project-types')
let db: ReturnType<typeof testDb.open>
let svc: ProjectTypeService

beforeEach(() => {
  db = testDb.open()
  svc = createProjectTypeService(db)
})
afterEach(() => testDb.cleanup())

describe('ProjectTypeService', () => {
  describe('create', () => {
    it('creates a project type with defaults', () => {
      const pt = svc.create({ name: 'Bug Tracker' })
      expect(pt.id).toBeTruthy()
      expect(pt.name).toBe('Bug Tracker')
      expect(pt.defaultStages).toEqual(['Backlog', 'In Progress', 'Done'])
      expect(pt.defaultPriority).toBe('normal')
    })

    it('creates with custom stages and priority', () => {
      const pt = svc.create({
        name: 'Custom',
        defaultStages: ['Todo', 'Doing', 'Review', 'Done'],
        defaultPriority: 'high',
        prompt: 'You are a project manager',
        color: '#ff0000',
        icon: 'bug',
      })
      expect(pt.defaultStages).toEqual(['Todo', 'Doing', 'Review', 'Done'])
      expect(pt.defaultPriority).toBe('high')
      expect(pt.prompt).toBe('You are a project manager')
    })
  })

  describe('list', () => {
    it('returns all project types', () => {
      svc.create({ name: 'Type A' })
      svc.create({ name: 'Type B' })
      expect(svc.list()).toHaveLength(2)
    })
  })

  describe('get', () => {
    it('returns a project type by id', () => {
      const created = svc.create({ name: 'Test' })
      const found = svc.get(created.id)
      expect(found).not.toBeNull()
      expect(found!.name).toBe('Test')
    })

    it('returns null for non-existent id', () => {
      expect(svc.get('nonexistent')).toBeNull()
    })
  })

  describe('update', () => {
    it('updates name and prompt', () => {
      const pt = svc.create({ name: 'Old' })
      svc.update(pt.id, { name: 'New', prompt: 'Updated prompt' })
      const updated = svc.get(pt.id)
      expect(updated!.name).toBe('New')
      expect(updated!.prompt).toBe('Updated prompt')
    })
  })

  describe('delete', () => {
    it('deletes a project type', () => {
      const pt = svc.create({ name: 'ToDelete' })
      svc.delete(pt.id)
      expect(svc.get(pt.id)).toBeNull()
    })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
bun vitest run tests/modules/board/project-type-service.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 4: Add board tables to test-db helper**

Add these lines to `tests/helpers/test-db.ts` inside the `open()` function, after the conversation_messages table:

```typescript
    db.run(sql`CREATE TABLE IF NOT EXISTS project_types (id TEXT PRIMARY KEY, name TEXT NOT NULL, prompt TEXT NOT NULL DEFAULT '', default_stages TEXT NOT NULL DEFAULT '["Backlog","In Progress","Done"]', default_priority TEXT NOT NULL DEFAULT 'normal', color TEXT, icon TEXT, indexed_sources TEXT, skills TEXT, permissions TEXT, created_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, type_id TEXT, prompt TEXT, indexed_sources TEXT, skills TEXT, permissions TEXT, color TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS stages (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT, sort_order INTEGER NOT NULL DEFAULT 0, is_closed INTEGER NOT NULL DEFAULT 0, is_hidden INTEGER NOT NULL DEFAULT 0, is_folded INTEGER NOT NULL DEFAULT 0, bot_listen INTEGER NOT NULL DEFAULT 0, auto_assignee_id TEXT, created_at TEXT NOT NULL)`)
```

- [ ] **Step 5: Write ProjectTypeService implementation**

Create `src/modules/board/services/project-type-service.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'

export interface ProjectType {
  id: string
  name: string
  prompt: string
  defaultStages: string[]
  defaultPriority: string
  color: string | null
  icon: string | null
  indexedSources: string[] | null
  skills: string[] | null
  permissions: Record<string, unknown> | null
  createdAt: string
}

export interface CreateProjectTypeInput {
  name: string
  prompt?: string
  defaultStages?: string[]
  defaultPriority?: string
  color?: string
  icon?: string
  indexedSources?: string[]
  skills?: string[]
  permissions?: Record<string, unknown>
}

export interface UpdateProjectTypeInput {
  name?: string
  prompt?: string
  defaultStages?: string[]
  defaultPriority?: string
  color?: string | null
  icon?: string | null
  indexedSources?: string[] | null
  skills?: string[] | null
  permissions?: Record<string, unknown> | null
}

export interface ProjectTypeService {
  create(input: CreateProjectTypeInput): ProjectType
  list(): ProjectType[]
  get(id: string): ProjectType | null
  update(id: string, input: UpdateProjectTypeInput): void
  delete(id: string): void
}

function toProjectType(raw: any): ProjectType {
  return {
    id: raw.id,
    name: raw.name,
    prompt: raw.prompt,
    defaultStages: JSON.parse(raw.default_stages),
    defaultPriority: raw.default_priority,
    color: raw.color,
    icon: raw.icon,
    indexedSources: raw.indexed_sources ? JSON.parse(raw.indexed_sources) : null,
    skills: raw.skills ? JSON.parse(raw.skills) : null,
    permissions: raw.permissions ? JSON.parse(raw.permissions) : null,
    createdAt: raw.created_at,
  }
}

export function createProjectTypeService(db: any): ProjectTypeService {
  return {
    create(input: CreateProjectTypeInput): ProjectType {
      const id = generateId()
      const now = new Date().toISOString()
      const defaultStages = JSON.stringify(input.defaultStages ?? ['Backlog', 'In Progress', 'Done'])
      const defaultPriority = input.defaultPriority ?? 'normal'
      db.run(sql`INSERT INTO project_types (id, name, prompt, default_stages, default_priority, color, icon, indexed_sources, skills, permissions, created_at)
        VALUES (${id}, ${input.name}, ${input.prompt ?? ''}, ${defaultStages}, ${defaultPriority}, ${input.color ?? null}, ${input.icon ?? null}, ${input.indexedSources ? JSON.stringify(input.indexedSources) : null}, ${input.skills ? JSON.stringify(input.skills) : null}, ${input.permissions ? JSON.stringify(input.permissions) : null}, ${now})`)
      return toProjectType((db.all(sql`SELECT * FROM project_types WHERE id = ${id}`) as any[])[0])
    },

    list(): ProjectType[] {
      return (db.all(sql`SELECT * FROM project_types ORDER BY name`) as any[]).map(toProjectType)
    },

    get(id: string): ProjectType | null {
      const rows = db.all(sql`SELECT * FROM project_types WHERE id = ${id}`) as any[]
      return rows.length > 0 ? toProjectType(rows[0]) : null
    },

    update(id: string, input: UpdateProjectTypeInput): void {
      if (input.name !== undefined) db.run(sql`UPDATE project_types SET name = ${input.name} WHERE id = ${id}`)
      if (input.prompt !== undefined) db.run(sql`UPDATE project_types SET prompt = ${input.prompt} WHERE id = ${id}`)
      if (input.defaultStages !== undefined) db.run(sql`UPDATE project_types SET default_stages = ${JSON.stringify(input.defaultStages)} WHERE id = ${id}`)
      if (input.defaultPriority !== undefined) db.run(sql`UPDATE project_types SET default_priority = ${input.defaultPriority} WHERE id = ${id}`)
      if (input.color !== undefined) db.run(sql`UPDATE project_types SET color = ${input.color} WHERE id = ${id}`)
      if (input.icon !== undefined) db.run(sql`UPDATE project_types SET icon = ${input.icon} WHERE id = ${id}`)
    },

    delete(id: string): void {
      db.run(sql`DELETE FROM project_types WHERE id = ${id}`)
    },
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
bun vitest run tests/modules/board/project-type-service.test.ts
```

Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/modules/board/schema.ts src/modules/board/services/project-type-service.ts tests/modules/board/project-type-service.test.ts tests/helpers/test-db.ts
git commit -m "feat(board): add schema + project type service"
```

### Task 6: Project service with auto-stage creation

**Files:**
- Create: `src/modules/board/services/project-service.ts`
- Create: `tests/modules/board/project-service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/modules/board/project-service.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createProjectTypeService } from '@modules/board/services/project-type-service'
import { createProjectService, type ProjectService } from '@modules/board/services/project-service'

const testDb = createTestDb('board-projects')
let db: ReturnType<typeof testDb.open>
let svc: ProjectService

beforeEach(() => {
  db = testDb.open()
  const typeService = createProjectTypeService(db)
  svc = createProjectService(db, typeService)
})
afterEach(() => testDb.cleanup())

describe('ProjectService', () => {
  describe('create', () => {
    it('creates a standalone project without type', () => {
      const project = svc.create({ name: 'My Project' })
      expect(project.id).toBeTruthy()
      expect(project.name).toBe('My Project')
      expect(project.typeId).toBeNull()
    })

    it('creates a project from type with auto-generated stages', () => {
      const typeService = createProjectTypeService(db)
      const pt = typeService.create({ name: 'Bug Tracker', defaultStages: ['New', 'In Progress', 'Resolved'] })

      const project = svc.create({ name: 'Bugs Q2', typeId: pt.id })
      expect(project.typeId).toBe(pt.id)

      const withStages = svc.getWithStages(project.id)
      expect(withStages).not.toBeNull()
      expect(withStages!.stages).toHaveLength(3)
      expect(withStages!.stages[0].name).toBe('New')
      expect(withStages!.stages[0].sortOrder).toBe(0)
      expect(withStages!.stages[1].name).toBe('In Progress')
      expect(withStages!.stages[1].sortOrder).toBe(1)
      expect(withStages!.stages[2].name).toBe('Resolved')
      expect(withStages!.stages[2].sortOrder).toBe(2)
    })
  })

  describe('list', () => {
    it('returns all projects', () => {
      svc.create({ name: 'A' })
      svc.create({ name: 'B' })
      expect(svc.list()).toHaveLength(2)
    })
  })

  describe('update', () => {
    it('updates project fields', () => {
      const p = svc.create({ name: 'Old' })
      svc.update(p.id, { name: 'New', color: '#00ff00' })
      const updated = svc.get(p.id)
      expect(updated!.name).toBe('New')
      expect(updated!.color).toBe('#00ff00')
    })
  })

  describe('delete', () => {
    it('deletes project and cascades stages', () => {
      const typeService = createProjectTypeService(db)
      const pt = typeService.create({ name: 'T', defaultStages: ['A', 'B'] })
      const p = svc.create({ name: 'P', typeId: pt.id })

      svc.delete(p.id)
      expect(svc.get(p.id)).toBeNull()
      expect(svc.getWithStages(p.id)).toBeNull()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun vitest run tests/modules/board/project-service.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `src/modules/board/services/project-service.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import type { ProjectTypeService } from './project-type-service.js'

export interface Project {
  id: string
  name: string
  description: string | null
  typeId: string | null
  prompt: string | null
  color: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface Stage {
  id: string
  projectId: string
  name: string
  color: string | null
  sortOrder: number
  isClosed: boolean
  isHidden: boolean
  isFolded: boolean
  botListen: boolean
  autoAssigneeId: string | null
  createdAt: string
}

export interface ProjectWithStages extends Project {
  stages: Stage[]
}

export interface CreateProjectInput {
  name: string
  description?: string
  typeId?: string
  prompt?: string
  color?: string
}

export interface UpdateProjectInput {
  name?: string
  description?: string | null
  prompt?: string | null
  color?: string | null
  sortOrder?: number
}

export interface ProjectService {
  create(input: CreateProjectInput): Project
  list(): Project[]
  get(id: string): Project | null
  getWithStages(id: string): ProjectWithStages | null
  update(id: string, input: UpdateProjectInput): void
  delete(id: string): void
}

function toProject(raw: any): Project {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    typeId: raw.type_id,
    prompt: raw.prompt,
    color: raw.color,
    sortOrder: raw.sort_order,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  }
}

function toStage(raw: any): Stage {
  return {
    id: raw.id,
    projectId: raw.project_id,
    name: raw.name,
    color: raw.color,
    sortOrder: raw.sort_order,
    isClosed: raw.is_closed === 1,
    isHidden: raw.is_hidden === 1,
    isFolded: raw.is_folded === 1,
    botListen: raw.bot_listen === 1,
    autoAssigneeId: raw.auto_assignee_id,
    createdAt: raw.created_at,
  }
}

export function createProjectService(db: any, typeService: ProjectTypeService): ProjectService {
  return {
    create(input: CreateProjectInput): Project {
      const id = generateId()
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO projects (id, name, description, type_id, prompt, color, sort_order, created_at, updated_at)
        VALUES (${id}, ${input.name}, ${input.description ?? null}, ${input.typeId ?? null}, ${input.prompt ?? null}, ${input.color ?? null}, 0, ${now}, ${now})`)

      // Auto-create stages from project type
      if (input.typeId) {
        const pt = typeService.get(input.typeId)
        if (pt) {
          pt.defaultStages.forEach((stageName, idx) => {
            const stageId = generateId()
            const isClosed = idx === pt.defaultStages.length - 1 ? 1 : 0
            db.run(sql`INSERT INTO stages (id, project_id, name, sort_order, is_closed, is_hidden, is_folded, bot_listen, created_at)
              VALUES (${stageId}, ${id}, ${stageName}, ${idx}, ${isClosed}, 0, 0, 0, ${now})`)
          })
        }
      }

      return toProject((db.all(sql`SELECT * FROM projects WHERE id = ${id}`) as any[])[0])
    },

    list(): Project[] {
      return (db.all(sql`SELECT * FROM projects ORDER BY sort_order, name`) as any[]).map(toProject)
    },

    get(id: string): Project | null {
      const rows = db.all(sql`SELECT * FROM projects WHERE id = ${id}`) as any[]
      return rows.length > 0 ? toProject(rows[0]) : null
    },

    getWithStages(id: string): ProjectWithStages | null {
      const project = this.get(id)
      if (!project) return null
      const stageRows = db.all(sql`SELECT * FROM stages WHERE project_id = ${id} ORDER BY sort_order`) as any[]
      return { ...project, stages: stageRows.map(toStage) }
    },

    update(id: string, input: UpdateProjectInput): void {
      const now = new Date().toISOString()
      if (input.name !== undefined) db.run(sql`UPDATE projects SET name = ${input.name}, updated_at = ${now} WHERE id = ${id}`)
      if (input.description !== undefined) db.run(sql`UPDATE projects SET description = ${input.description}, updated_at = ${now} WHERE id = ${id}`)
      if (input.prompt !== undefined) db.run(sql`UPDATE projects SET prompt = ${input.prompt}, updated_at = ${now} WHERE id = ${id}`)
      if (input.color !== undefined) db.run(sql`UPDATE projects SET color = ${input.color}, updated_at = ${now} WHERE id = ${id}`)
      if (input.sortOrder !== undefined) db.run(sql`UPDATE projects SET sort_order = ${input.sortOrder}, updated_at = ${now} WHERE id = ${id}`)
    },

    delete(id: string): void {
      db.run(sql`DELETE FROM stages WHERE project_id = ${id}`)
      db.run(sql`UPDATE conversations SET project_id = NULL, stage_id = NULL WHERE project_id = ${id}`)
      db.run(sql`DELETE FROM projects WHERE id = ${id}`)
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun vitest run tests/modules/board/project-service.test.ts
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/board/services/project-service.ts tests/modules/board/project-service.test.ts
git commit -m "feat(board): add project service with auto-stage creation"
```

### Task 7: Stage service with reorder

**Files:**
- Create: `src/modules/board/services/stage-service.ts`
- Create: `tests/modules/board/stage-service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/modules/board/stage-service.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createProjectTypeService } from '@modules/board/services/project-type-service'
import { createProjectService } from '@modules/board/services/project-service'
import { createStageService, type StageService } from '@modules/board/services/stage-service'

const testDb = createTestDb('board-stages')
let db: ReturnType<typeof testDb.open>
let stageSvc: StageService
let projectId: string

beforeEach(() => {
  db = testDb.open()
  const typeService = createProjectTypeService(db)
  const projectService = createProjectService(db, typeService)
  stageSvc = createStageService(db)
  const project = projectService.create({ name: 'Test Project' })
  projectId = project.id
})
afterEach(() => testDb.cleanup())

describe('StageService', () => {
  describe('create', () => {
    it('creates a stage in a project', () => {
      const stage = stageSvc.create({ projectId, name: 'New Stage' })
      expect(stage.id).toBeTruthy()
      expect(stage.name).toBe('New Stage')
      expect(stage.projectId).toBe(projectId)
    })
  })

  describe('listByProject', () => {
    it('returns stages ordered by sortOrder', () => {
      stageSvc.create({ projectId, name: 'C', sortOrder: 2 })
      stageSvc.create({ projectId, name: 'A', sortOrder: 0 })
      stageSvc.create({ projectId, name: 'B', sortOrder: 1 })
      const stages = stageSvc.listByProject(projectId)
      expect(stages.map(s => s.name)).toEqual(['A', 'B', 'C'])
    })
  })

  describe('update', () => {
    it('updates stage properties', () => {
      const stage = stageSvc.create({ projectId, name: 'Old' })
      stageSvc.update(stage.id, { name: 'New', color: '#ff0000', isClosed: true })
      const updated = stageSvc.get(stage.id)
      expect(updated!.name).toBe('New')
      expect(updated!.color).toBe('#ff0000')
      expect(updated!.isClosed).toBe(true)
    })
  })

  describe('reorder', () => {
    it('reorders stages by id array', () => {
      const a = stageSvc.create({ projectId, name: 'A', sortOrder: 0 })
      const b = stageSvc.create({ projectId, name: 'B', sortOrder: 1 })
      const c = stageSvc.create({ projectId, name: 'C', sortOrder: 2 })

      stageSvc.reorder(projectId, [c.id, a.id, b.id])

      const stages = stageSvc.listByProject(projectId)
      expect(stages.map(s => s.name)).toEqual(['C', 'A', 'B'])
    })
  })

  describe('delete', () => {
    it('deletes a stage', () => {
      const stage = stageSvc.create({ projectId, name: 'ToDelete' })
      stageSvc.delete(stage.id)
      expect(stageSvc.get(stage.id)).toBeNull()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun vitest run tests/modules/board/stage-service.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `src/modules/board/services/stage-service.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import type { Stage } from './project-service.js'

export interface CreateStageInput {
  projectId: string
  name: string
  color?: string
  sortOrder?: number
  isClosed?: boolean
}

export interface UpdateStageInput {
  name?: string
  color?: string | null
  sortOrder?: number
  isClosed?: boolean
  isHidden?: boolean
  isFolded?: boolean
}

export interface StageService {
  create(input: CreateStageInput): Stage
  get(id: string): Stage | null
  listByProject(projectId: string): Stage[]
  update(id: string, input: UpdateStageInput): void
  reorder(projectId: string, stageIds: string[]): void
  delete(id: string): void
}

function toStage(raw: any): Stage {
  return {
    id: raw.id,
    projectId: raw.project_id,
    name: raw.name,
    color: raw.color,
    sortOrder: raw.sort_order,
    isClosed: raw.is_closed === 1,
    isHidden: raw.is_hidden === 1,
    isFolded: raw.is_folded === 1,
    botListen: raw.bot_listen === 1,
    autoAssigneeId: raw.auto_assignee_id,
    createdAt: raw.created_at,
  }
}

export function createStageService(db: any): StageService {
  return {
    create(input: CreateStageInput): Stage {
      const id = generateId()
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO stages (id, project_id, name, color, sort_order, is_closed, is_hidden, is_folded, bot_listen, created_at)
        VALUES (${id}, ${input.projectId}, ${input.name}, ${input.color ?? null}, ${input.sortOrder ?? 0}, ${input.isClosed ? 1 : 0}, 0, 0, 0, ${now})`)
      return toStage((db.all(sql`SELECT * FROM stages WHERE id = ${id}`) as any[])[0])
    },

    get(id: string): Stage | null {
      const rows = db.all(sql`SELECT * FROM stages WHERE id = ${id}`) as any[]
      return rows.length > 0 ? toStage(rows[0]) : null
    },

    listByProject(projectId: string): Stage[] {
      return (db.all(sql`SELECT * FROM stages WHERE project_id = ${projectId} ORDER BY sort_order`) as any[]).map(toStage)
    },

    update(id: string, input: UpdateStageInput): void {
      if (input.name !== undefined) db.run(sql`UPDATE stages SET name = ${input.name} WHERE id = ${id}`)
      if (input.color !== undefined) db.run(sql`UPDATE stages SET color = ${input.color} WHERE id = ${id}`)
      if (input.sortOrder !== undefined) db.run(sql`UPDATE stages SET sort_order = ${input.sortOrder} WHERE id = ${id}`)
      if (input.isClosed !== undefined) db.run(sql`UPDATE stages SET is_closed = ${input.isClosed ? 1 : 0} WHERE id = ${id}`)
      if (input.isHidden !== undefined) db.run(sql`UPDATE stages SET is_hidden = ${input.isHidden ? 1 : 0} WHERE id = ${id}`)
      if (input.isFolded !== undefined) db.run(sql`UPDATE stages SET is_folded = ${input.isFolded ? 1 : 0} WHERE id = ${id}`)
    },

    reorder(projectId: string, stageIds: string[]): void {
      stageIds.forEach((id, idx) => {
        db.run(sql`UPDATE stages SET sort_order = ${idx} WHERE id = ${id} AND project_id = ${projectId}`)
      })
    },

    delete(id: string): void {
      db.run(sql`UPDATE conversations SET stage_id = NULL WHERE stage_id = ${id}`)
      db.run(sql`DELETE FROM stages WHERE id = ${id}`)
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun vitest run tests/modules/board/stage-service.test.ts
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/board/services/stage-service.ts tests/modules/board/stage-service.test.ts
git commit -m "feat(board): add stage service with reorder"
```

### Task 8: Board module definition + routes + conversation extension

**Files:**
- Create: `src/modules/board/index.ts`
- Create: `src/modules/board/routes.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/bootstrap.ts`
- Modify: `src/modules/auth/routes.ts`
- Modify: `src/modules/conversations/conversation-service.ts`

- [ ] **Step 1: Extend ConversationService update method**

In `src/modules/conversations/conversation-service.ts`, extend the `update` method's input type and implementation to accept board fields:

Add to the `update` method parameter type:

```typescript
    update(id: string, update: { title?: string; status?: string; providerId?: string; modelId?: string; projectId?: string; stageId?: string; priority?: string; pinned?: boolean; position?: number; dueDate?: string | null; prompt?: string | null; assignees?: string[]; tags?: string[] }): void {
```

Add to the update method body (after the existing `modelId` block):

```typescript
      if (update.projectId !== undefined) {
        db.run(sql`UPDATE conversations SET project_id = ${update.projectId}, updated_at = ${now} WHERE id = ${id}`)
      }
      if (update.stageId !== undefined) {
        db.run(sql`UPDATE conversations SET stage_id = ${update.stageId}, updated_at = ${now} WHERE id = ${id}`)
      }
      if (update.priority !== undefined) {
        db.run(sql`UPDATE conversations SET priority = ${update.priority}, updated_at = ${now} WHERE id = ${id}`)
      }
      if (update.pinned !== undefined) {
        db.run(sql`UPDATE conversations SET pinned = ${update.pinned ? 1 : 0}, updated_at = ${now} WHERE id = ${id}`)
      }
      if (update.position !== undefined) {
        db.run(sql`UPDATE conversations SET position = ${update.position}, updated_at = ${now} WHERE id = ${id}`)
      }
      if (update.dueDate !== undefined) {
        db.run(sql`UPDATE conversations SET due_date = ${update.dueDate}, updated_at = ${now} WHERE id = ${id}`)
      }
      if (update.prompt !== undefined) {
        db.run(sql`UPDATE conversations SET prompt = ${update.prompt}, updated_at = ${now} WHERE id = ${id}`)
      }
      if (update.assignees !== undefined) {
        db.run(sql`UPDATE conversations SET assignees = ${JSON.stringify(update.assignees)}, updated_at = ${now} WHERE id = ${id}`)
      }
      if (update.tags !== undefined) {
        db.run(sql`UPDATE conversations SET tags = ${JSON.stringify(update.tags)}, updated_at = ${now} WHERE id = ${id}`)
      }
```

Also extend `toConversation` to include board fields:

```typescript
function toConversation(raw: any): Conversation {
  return {
    id: raw.id,
    title: raw.title,
    status: raw.status,
    providerId: raw.provider_id,
    modelId: raw.model_id,
    userId: raw.user_id,
    tokensUsed: raw.tokens_used,
    projectId: raw.project_id ?? null,
    stageId: raw.stage_id ?? null,
    priority: raw.priority ?? 'normal',
    pinned: raw.pinned === 1,
    position: raw.position ?? 0,
    dueDate: raw.due_date ?? null,
    prompt: raw.prompt ?? null,
    assignees: raw.assignees ? JSON.parse(raw.assignees) : [],
    tags: raw.tags ? JSON.parse(raw.tags) : [],
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  }
}
```

And extend the `Conversation` interface:

```typescript
export interface Conversation {
  id: string
  title: string | null
  status: string
  providerId: string | null
  modelId: string | null
  userId: string
  tokensUsed: number
  projectId: string | null
  stageId: string | null
  priority: string
  pinned: boolean
  position: number
  dueDate: string | null
  prompt: string | null
  assignees: string[]
  tags: string[]
  createdAt: string
  updatedAt: string
}
```

- [ ] **Step 2: Add board fields to conversations schema**

In `src/modules/conversations/schema.ts`, add after `updatedAt`:

```typescript
  projectId: text('project_id'),
  stageId: text('stage_id'),
  priority: text('priority').default('normal'),
  pinned: integer('pinned').default(0),
  position: real('position').default(0),
  dueDate: text('due_date'),
  prompt: text('prompt'),
  assignees: text('assignees'),
  tags: text('tags'),
```

(Add `real` to the import from `drizzle-orm/sqlite-core`.)

- [ ] **Step 3: Create board module definition**

Create `src/modules/board/index.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { createProjectTypeService } from './services/project-type-service.js'
import { createProjectService } from './services/project-service.js'
import { createStageService } from './services/stage-service.js'

export const boardModule: EyasModule = {
  id: 'board',
  name: 'Board',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Kanban board — project types, projects, stages, conversation management',
  dependencies: ['conversations'],

  async onRegister(ctx: ModuleContext) {
    // Create board tables
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS project_types (id TEXT PRIMARY KEY, name TEXT NOT NULL, prompt TEXT NOT NULL DEFAULT '', default_stages TEXT NOT NULL DEFAULT '["Backlog","In Progress","Done"]', default_priority TEXT NOT NULL DEFAULT 'normal', color TEXT, icon TEXT, indexed_sources TEXT, skills TEXT, permissions TEXT, created_at TEXT NOT NULL)`)
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, type_id TEXT, prompt TEXT, indexed_sources TEXT, skills TEXT, permissions TEXT, color TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS stages (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT, sort_order INTEGER NOT NULL DEFAULT 0, is_closed INTEGER NOT NULL DEFAULT 0, is_hidden INTEGER NOT NULL DEFAULT 0, is_folded INTEGER NOT NULL DEFAULT 0, bot_listen INTEGER NOT NULL DEFAULT 0, auto_assignee_id TEXT, created_at TEXT NOT NULL)`)

    // Extend conversations table with board fields
    const boardColumns = [
      { name: 'project_id', def: 'TEXT' },
      { name: 'stage_id', def: 'TEXT' },
      { name: 'priority', def: "TEXT DEFAULT 'normal'" },
      { name: 'pinned', def: 'INTEGER DEFAULT 0' },
      { name: 'position', def: 'REAL DEFAULT 0' },
      { name: 'due_date', def: 'TEXT' },
      { name: 'prompt', def: 'TEXT' },
      { name: 'assignees', def: 'TEXT' },
      { name: 'tags', def: 'TEXT' },
    ]
    for (const col of boardColumns) {
      try { ctx.db.run(sql.raw(`ALTER TABLE conversations ADD COLUMN ${col.name} ${col.def}`)) }
      catch { /* column already exists */ }
    }

    // Indexes
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_conv_project_stage ON conversations(project_id, stage_id)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_conv_project_position ON conversations(project_id, position)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_stages_project ON stages(project_id, sort_order)`)

    const projectTypeService = createProjectTypeService(ctx.db)
    const projectService = createProjectService(ctx.db, projectTypeService)
    const stageService = createStageService(ctx.db)

    ctx.board = { projectTypes: projectTypeService, projects: projectService, stages: stageService }
    ctx.logger.info('Board module registered')
  },

  async onStart(ctx: ModuleContext) {
    const { createBoardRoutes } = await import('./routes.js')
    createBoardRoutes(ctx.http, ctx.board, ctx.conversations)
    ctx.logger.info('Board module started')
  },

  async onStop() {},
}
```

- [ ] **Step 4: Update ModuleContext in `src/core/types.ts`**

Add after the `conversations` line:

```typescript
  board: {
    projectTypes: import('@modules/board/services/project-type-service').ProjectTypeService
    projects: import('@modules/board/services/project-service').ProjectService
    stages: import('@modules/board/services/stage-service').StageService
  }
```

- [ ] **Step 5: Update bootstrap to register board module**

In `src/core/bootstrap.ts`, add import:

```typescript
import { boardModule } from '@modules/board/index'
```

Add after the conversations module registration (after line 96):

```typescript
  if (!moduleLoader.hasModule(boardModule.id)) {
    moduleLoader.register(boardModule)
  }
```

- [ ] **Step 6: Add auth middleware for board routes**

In `src/modules/auth/routes.ts`, add after the conversations middleware lines:

```typescript
  // Auth + CSRF on board endpoints
  router.use('/api/v1/project-types/*', authenticate)
  router.use('/api/v1/project-types/*', csrfProtection)
  router.use('/api/v1/projects/*', authenticate)
  router.use('/api/v1/projects/*', csrfProtection)
  router.use('/api/v1/stages/*', authenticate)
  router.use('/api/v1/stages/*', csrfProtection)
```

- [ ] **Step 7: Create board routes**

Create `src/modules/board/routes.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ProjectTypeService } from './services/project-type-service.js'
import type { ProjectService } from './services/project-service.js'
import type { StageService } from './services/stage-service.js'
import type { ConversationService } from '@modules/conversations/conversation-service.js'

interface BoardServices {
  projectTypes: ProjectTypeService
  projects: ProjectService
  stages: StageService
}

export function createBoardRoutes(
  app: Hono,
  board: BoardServices,
  conversationService: ConversationService,
): void {
  const router = app as any

  // ─── Project Types ─────────────────────────────

  router.get('/api/v1/project-types', (c: any) => {
    return c.json({ projectTypes: board.projectTypes.list() })
  })

  router.post('/api/v1/project-types', async (c: any) => {
    const body = await c.req.json()
    if (!body.name) throw new HTTPException(400, { message: 'name is required' })
    const pt = board.projectTypes.create(body)
    return c.json(pt, 201)
  })

  router.patch('/api/v1/project-types/:id', async (c: any) => {
    const id = c.req.param('id')
    if (!board.projectTypes.get(id)) throw new HTTPException(404, { message: 'Project type not found' })
    const body = await c.req.json()
    board.projectTypes.update(id, body)
    return c.json(board.projectTypes.get(id))
  })

  router.delete('/api/v1/project-types/:id', (c: any) => {
    const id = c.req.param('id')
    if (!board.projectTypes.get(id)) throw new HTTPException(404, { message: 'Project type not found' })
    board.projectTypes.delete(id)
    return c.json({ message: 'Deleted' })
  })

  // ─── Projects ──────────────────────────────────

  router.get('/api/v1/projects', (c: any) => {
    return c.json({ projects: board.projects.list() })
  })

  router.post('/api/v1/projects', async (c: any) => {
    const body = await c.req.json()
    if (!body.name) throw new HTTPException(400, { message: 'name is required' })
    const project = board.projects.create(body)
    return c.json(project, 201)
  })

  router.get('/api/v1/projects/:id', (c: any) => {
    const id = c.req.param('id')
    const project = board.projects.getWithStages(id)
    if (!project) throw new HTTPException(404, { message: 'Project not found' })
    return c.json(project)
  })

  router.patch('/api/v1/projects/:id', async (c: any) => {
    const id = c.req.param('id')
    if (!board.projects.get(id)) throw new HTTPException(404, { message: 'Project not found' })
    const body = await c.req.json()
    board.projects.update(id, body)
    return c.json(board.projects.get(id))
  })

  router.delete('/api/v1/projects/:id', (c: any) => {
    const id = c.req.param('id')
    if (!board.projects.get(id)) throw new HTTPException(404, { message: 'Project not found' })
    board.projects.delete(id)
    return c.json({ message: 'Deleted' })
  })

  // ─── Board View ────────────────────────────────

  router.get('/api/v1/projects/:id/board', (c: any) => {
    const id = c.req.param('id')
    const project = board.projects.getWithStages(id)
    if (!project) throw new HTTPException(404, { message: 'Project not found' })
    const userId = c.get('userId') as string

    const stagesWithConversations = project.stages
      .filter(s => !s.isHidden)
      .map(stage => {
        const conversations = conversationService
          .listByProject(id, stage.id)
        return { ...stage, conversations }
      })

    return c.json({
      project: { id: project.id, name: project.name, color: project.color, prompt: project.prompt, typeId: project.typeId },
      stages: stagesWithConversations,
    })
  })

  router.post('/api/v1/projects/:id/conversations', async (c: any) => {
    const projectId = c.req.param('id')
    const project = board.projects.getWithStages(projectId)
    if (!project) throw new HTTPException(404, { message: 'Project not found' })

    const userId = c.get('userId') as string
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })

    const body = await c.req.json().catch(() => ({}))
    const firstStage = project.stages.find(s => !s.isHidden && !s.isClosed) ?? project.stages[0]
    if (!firstStage) throw new HTTPException(400, { message: 'Project has no stages' })

    const conv = conversationService.create({ userId, title: body.title })
    conversationService.update(conv.id, {
      projectId,
      stageId: firstStage.id,
      priority: body.priority ?? 'normal',
      position: body.position ?? 1.0,
    })

    return c.json(conversationService.get(conv.id), 201)
  })

  // ─── Stages ────────────────────────────────────

  router.post('/api/v1/projects/:id/stages', async (c: any) => {
    const projectId = c.req.param('id')
    if (!board.projects.get(projectId)) throw new HTTPException(404, { message: 'Project not found' })
    const body = await c.req.json()
    if (!body.name) throw new HTTPException(400, { message: 'name is required' })
    const stage = board.stages.create({ projectId, ...body })
    return c.json(stage, 201)
  })

  router.patch('/api/v1/stages/:id', async (c: any) => {
    const id = c.req.param('id')
    if (!board.stages.get(id)) throw new HTTPException(404, { message: 'Stage not found' })
    const body = await c.req.json()
    board.stages.update(id, body)
    return c.json(board.stages.get(id))
  })

  router.delete('/api/v1/stages/:id', (c: any) => {
    const id = c.req.param('id')
    if (!board.stages.get(id)) throw new HTTPException(404, { message: 'Stage not found' })
    board.stages.delete(id)
    return c.json({ message: 'Deleted' })
  })

  router.patch('/api/v1/projects/:id/stages/reorder', async (c: any) => {
    const projectId = c.req.param('id')
    if (!board.projects.get(projectId)) throw new HTTPException(404, { message: 'Project not found' })
    const body = await c.req.json()
    if (!Array.isArray(body.ids)) throw new HTTPException(400, { message: 'ids array required' })
    board.stages.reorder(projectId, body.ids)
    return c.json({ message: 'Reordered' })
  })

  // ─── Conversation Move (drag & drop) ──────────

  router.patch('/api/v1/conversations/:id/move', async (c: any) => {
    const userId = c.get('userId') as string
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    const id = c.req.param('id')
    const conv = conversationService.get(id)
    if (!conv || conv.userId !== userId) throw new HTTPException(404, { message: 'Conversation not found' })
    const body = await c.req.json()
    if (!body.stageId || body.position === undefined) {
      throw new HTTPException(400, { message: 'stageId and position required' })
    }
    conversationService.update(id, { stageId: body.stageId, position: body.position })
    return c.json({ message: 'Moved' })
  })
}
```

- [ ] **Step 8: Add `listByProject` to ConversationService**

In `src/modules/conversations/conversation-service.ts`, add to the interface:

```typescript
  listByProject(projectId: string, stageId: string): Conversation[]
```

Add to the implementation:

```typescript
    listByProject(projectId: string, stageId: string): Conversation[] {
      const rows = db.all(sql`SELECT * FROM conversations WHERE project_id = ${projectId} AND stage_id = ${stageId} AND status != 'deleted' ORDER BY position ASC`) as any[]
      return rows.map(toConversation)
    },
```

- [ ] **Step 9: Update test-db with board columns on conversations**

In `tests/helpers/test-db.ts`, update the conversations CREATE TABLE to include board fields:

```typescript
    db.run(sql`CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT, status TEXT NOT NULL DEFAULT 'idle', provider_id TEXT, model_id TEXT, user_id TEXT NOT NULL, tokens_used INTEGER NOT NULL DEFAULT 0, project_id TEXT, stage_id TEXT, priority TEXT DEFAULT 'normal', pinned INTEGER DEFAULT 0, position REAL DEFAULT 0, due_date TEXT, prompt TEXT, assignees TEXT, tags TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
```

- [ ] **Step 10: Run all tests**

```bash
bun vitest run
```

Expected: All tests PASS (existing + new)

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(board): add board module with routes, conversation extension"
```

### Task 9: Board routes test

**Files:**
- Create: `tests/modules/board/routes.test.ts`

- [ ] **Step 1: Write the route tests**

Create `tests/modules/board/routes.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createTestDb, insertTestOwner } from '../../helpers/test-db'
import { createBoardRoutes } from '@modules/board/routes'
import { createConversationService } from '@modules/conversations/conversation-service'
import { createProjectTypeService } from '@modules/board/services/project-type-service'
import { createProjectService } from '@modules/board/services/project-service'
import { createStageService } from '@modules/board/services/stage-service'
import { createAuthRoutes } from '@modules/auth/routes'
import { createAuthMiddleware } from '@modules/auth/middleware'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createTokenService } from '@modules/auth/token'
import { buildAbilityForRole } from '@modules/permissions/roles'
import type { RoleId } from '@modules/permissions/types'

const testDb = createTestDb('board-routes')
let db: ReturnType<typeof testDb.open>
let app: Hono
let ownerToken: string

beforeEach(async () => {
  db = testDb.open()
  const conversationService = createConversationService(db)
  const projectTypeService = createProjectTypeService(db)
  const projectService = createProjectService(db, projectTypeService)
  const stageService = createStageService(db)
  const board = { projectTypes: projectTypeService, projects: projectService, stages: stageService }

  const permRegistry = createPermissionRegistry()
  const tokenService = createTokenService('test-secret-that-is-at-least-32-characters-long!')

  const authMiddleware = createAuthMiddleware({
    verifyAccessToken: (token) => tokenService.verifyAccessToken(token),
    findSessionByHash: async (hash) => {
      const rows = db.all(sql`SELECT * FROM sessions WHERE token_hash = ${hash}`) as any[]
      const s = rows[0]
      return s ? { userId: s.user_id, expiresAt: s.expires_at } : null
    },
    findApiKeyByHash: async () => null,
    findUserById: async (id) => {
      const rows = db.all(sql`SELECT * FROM users WHERE id = ${id}`) as any[]
      const u = rows[0]
      return u ? { id: u.id, role: u.role, status: u.status } : null
    },
    buildAbilityForUser: (role) => buildAbilityForRole(role as RoleId, permRegistry),
  })

  app = new Hono()
  app.onError(errorHandler)
  createAuthRoutes(app, { db, registry: permRegistry, tokenService, sessionDuration: 86400, accessTokenDuration: 900, refreshTokenDuration: 2592000 })

  app.use('/api/v1/project-types/*', authMiddleware)
  app.use('/api/v1/projects/*', authMiddleware)
  app.use('/api/v1/stages/*', authMiddleware)
  app.use('/api/v1/conversations/*', authMiddleware)
  createBoardRoutes(app, board, conversationService)

  await insertTestOwner(db)
  const tokenRes = await app.request('/api/v1/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
  })
  ownerToken = ((await tokenRes.json()) as any).accessToken
})
afterEach(() => testDb.cleanup())

const auth = () => ({ Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' })

describe('Project Types API', () => {
  it('CRUD flow', async () => {
    // Create
    const createRes = await app.request('/api/v1/project-types', { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'Bug Tracker', defaultStages: ['New', 'Active', 'Resolved'] }) })
    expect(createRes.status).toBe(201)
    const pt = await createRes.json() as any
    expect(pt.name).toBe('Bug Tracker')

    // List
    const listRes = await app.request('/api/v1/project-types', { headers: auth() })
    const listBody = await listRes.json() as any
    expect(listBody.projectTypes).toHaveLength(1)

    // Update
    const updateRes = await app.request(`/api/v1/project-types/${pt.id}`, { method: 'PATCH', headers: auth(), body: JSON.stringify({ name: 'Updated' }) })
    expect(updateRes.status).toBe(200)
    expect((await updateRes.json() as any).name).toBe('Updated')

    // Delete
    const delRes = await app.request(`/api/v1/project-types/${pt.id}`, { method: 'DELETE', headers: auth() })
    expect(delRes.status).toBe(200)
  })
})

describe('Projects API', () => {
  it('creates project with auto-stages from type', async () => {
    const ptRes = await app.request('/api/v1/project-types', { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'Dev', defaultStages: ['Backlog', 'Doing', 'Done'] }) })
    const pt = await ptRes.json() as any

    const projRes = await app.request('/api/v1/projects', { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'Sprint 1', typeId: pt.id }) })
    expect(projRes.status).toBe(201)
    const proj = await projRes.json() as any

    const detailRes = await app.request(`/api/v1/projects/${proj.id}`, { headers: auth() })
    const detail = await detailRes.json() as any
    expect(detail.stages).toHaveLength(3)
    expect(detail.stages[0].name).toBe('Backlog')
  })
})

describe('Board View API', () => {
  it('returns full board with stages and conversations', async () => {
    // Setup: type → project → add conversation
    const ptRes = await app.request('/api/v1/project-types', { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'T', defaultStages: ['Todo', 'Done'] }) })
    const pt = await ptRes.json() as any

    const projRes = await app.request('/api/v1/projects', { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'P', typeId: pt.id }) })
    const proj = await projRes.json() as any

    const convRes = await app.request(`/api/v1/projects/${proj.id}/conversations`, { method: 'POST', headers: auth(), body: JSON.stringify({ title: 'Fix login bug' }) })
    expect(convRes.status).toBe(201)

    const boardRes = await app.request(`/api/v1/projects/${proj.id}/board`, { headers: auth() })
    expect(boardRes.status).toBe(200)
    const board = await boardRes.json() as any
    expect(board.project.name).toBe('P')
    expect(board.stages.length).toBeGreaterThanOrEqual(1)
    const todoStage = board.stages.find((s: any) => s.name === 'Todo')
    expect(todoStage.conversations).toHaveLength(1)
    expect(todoStage.conversations[0].title).toBe('Fix login bug')
  })
})

describe('Conversation Move API', () => {
  it('moves a conversation to a different stage', async () => {
    const ptRes = await app.request('/api/v1/project-types', { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'T', defaultStages: ['A', 'B'] }) })
    const pt = await ptRes.json() as any

    const projRes = await app.request('/api/v1/projects', { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'P', typeId: pt.id }) })
    const proj = await projRes.json() as any

    const convRes = await app.request(`/api/v1/projects/${proj.id}/conversations`, { method: 'POST', headers: auth(), body: JSON.stringify({ title: 'Move me' }) })
    const conv = await convRes.json() as any

    // Get stages
    const detailRes = await app.request(`/api/v1/projects/${proj.id}`, { headers: auth() })
    const detail = await detailRes.json() as any
    const stageB = detail.stages.find((s: any) => s.name === 'B')

    const moveRes = await app.request(`/api/v1/conversations/${conv.id}/move`, {
      method: 'PATCH', headers: auth(),
      body: JSON.stringify({ stageId: stageB.id, position: 1.0 }),
    })
    expect(moveRes.status).toBe(200)

    // Verify on board
    const boardRes = await app.request(`/api/v1/projects/${proj.id}/board`, { headers: auth() })
    const board = await boardRes.json() as any
    const bStage = board.stages.find((s: any) => s.name === 'B')
    expect(bStage.conversations).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

```bash
bun vitest run tests/modules/board/routes.test.ts
```

Expected: All tests PASS

- [ ] **Step 3: Run full test suite**

```bash
bun vitest run
```

Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add tests/modules/board/routes.test.ts
git commit -m "test(board): add route integration tests"
```

### Task 10: Install @dnd-kit + board frontend store & route

**Files:**
- Create: `src/web/src/stores/board-store.ts`
- Create: `src/web/src/routes/board.tsx`
- Modify: `src/web/src/components/layout/sidebar.tsx`

- [ ] **Step 1: Install @dnd-kit**

```bash
cd /Users/eyssen/GitHub/eyas/src/web && bun add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

- [ ] **Step 2: Create board store**

Create `src/web/src/stores/board-store.ts`:

```typescript
import { create } from 'zustand'
import { api } from '@/lib/api'

interface BoardConversation {
  id: string
  title: string | null
  priority: string
  pinned: boolean
  position: number
  dueDate: string | null
  assignees: string[]
  tags: string[]
  tokensUsed: number
  status: string
}

interface BoardStage {
  id: string
  name: string
  color: string | null
  sortOrder: number
  isClosed: boolean
  isFolded: boolean
  conversations: BoardConversation[]
}

interface BoardProject {
  id: string
  name: string
  color: string | null
  prompt: string | null
  typeId: string | null
}

interface BoardState {
  currentProjectId: string | null
  project: BoardProject | null
  stages: BoardStage[]
  projects: { id: string; name: string; color: string | null }[]
  isLoading: boolean

  fetchProjects: () => Promise<void>
  setProject: (id: string) => void
  fetchBoard: (projectId: string) => Promise<void>
  moveConversation: (convId: string, stageId: string, position: number) => void
  addConversation: (title: string) => Promise<void>
}

export const useBoardStore = create<BoardState>((set, get) => ({
  currentProjectId: null,
  project: null,
  stages: [],
  projects: [],
  isLoading: false,

  fetchProjects: async () => {
    const data = await api.get<{ projects: { id: string; name: string; color: string | null }[] }>('/projects')
    set({ projects: data.projects })
    // Auto-select first project if none selected
    if (!get().currentProjectId && data.projects.length > 0) {
      get().setProject(data.projects[0].id)
    }
  },

  setProject: (id: string) => {
    set({ currentProjectId: id })
    get().fetchBoard(id)
  },

  fetchBoard: async (projectId: string) => {
    set({ isLoading: true })
    try {
      const data = await api.get<{ project: BoardProject; stages: BoardStage[] }>(`/projects/${projectId}/board`)
      set({ project: data.project, stages: data.stages, isLoading: false })
    } catch {
      set({ isLoading: false })
    }
  },

  moveConversation: (convId: string, stageId: string, position: number) => {
    // Optimistic update
    set((state) => {
      const newStages = state.stages.map(stage => ({
        ...stage,
        conversations: stage.conversations.filter(c => c.id !== convId),
      }))
      const targetStage = newStages.find(s => s.id === stageId)
      const movedConv = state.stages.flatMap(s => s.conversations).find(c => c.id === convId)
      if (targetStage && movedConv) {
        targetStage.conversations.push({ ...movedConv, position })
        targetStage.conversations.sort((a, b) => a.position - b.position)
      }
      return { stages: newStages }
    })

    // Fire and forget API call
    api.patch(`/conversations/${convId}/move`, { stageId, position }).catch(() => {
      // Revert on failure by refetching
      const projectId = get().currentProjectId
      if (projectId) get().fetchBoard(projectId)
    })
  },

  addConversation: async (title: string) => {
    const projectId = get().currentProjectId
    if (!projectId) return
    await api.post(`/projects/${projectId}/conversations`, { title })
    get().fetchBoard(projectId)
  },
}))
```

- [ ] **Step 3: Create board route**

Create `src/web/src/routes/board.tsx`:

```typescript
import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import BoardPage from '@/pages/board/board-page'

export const Route = createFileRoute('/board')({
  component: () => (
    <AppLayout>
      <BoardPage />
    </AppLayout>
  ),
})
```

- [ ] **Step 4: Add Board to sidebar**

In `src/web/src/components/layout/sidebar.tsx`, add the import:

```typescript
import {
  LayoutDashboard,
  Bot,
  KeyRound,
  Users,
  Settings,
  MessageSquare,
  MessageSquarePlus,
  KanbanSquare,
} from 'lucide-react'
```

Add to navItems after Conversations:

```typescript
  { path: '/board', label: 'Board', icon: KanbanSquare },
```

- [ ] **Step 5: Regenerate route tree**

```bash
cd /Users/eyssen/GitHub/eyas/src/web && npx @tanstack/router-cli generate
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(board): add board store, route, sidebar nav"
```

### Task 11: Kanban board frontend components

**Files:**
- Create: `src/web/src/pages/board/board-page.tsx`
- Create: `src/web/src/pages/board/board-header.tsx`
- Create: `src/web/src/pages/board/board-column.tsx`
- Create: `src/web/src/pages/board/board-card.tsx`

- [ ] **Step 1: Create board-card.tsx**

Create `src/web/src/pages/board/board-card.tsx`:

```tsx
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Badge } from '@/components/ui/badge'
import { useNavigate } from '@tanstack/react-router'

interface BoardCardProps {
  id: string
  title: string | null
  priority: string
  dueDate: string | null
  tags: string[]
  status: string
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  normal: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  low: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
}

export function BoardCard({ id, title, priority, dueDate, tags, status }: BoardCardProps) {
  const navigate = useNavigate()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => navigate({ to: '/conversations', search: { id } as any })}
      className="glass-card p-3 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow group"
    >
      <div className="text-sm font-medium truncate mb-2">{title || 'Untitled'}</div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {priority !== 'normal' && (
          <Badge variant="outline" className={`text-[10px] ${PRIORITY_COLORS[priority] ?? ''}`}>
            {priority}
          </Badge>
        )}
        {tags.map(tag => (
          <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
        ))}
        {dueDate && (
          <span className="text-[10px] text-muted-foreground ml-auto">{dueDate}</span>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create board-column.tsx**

Create `src/web/src/pages/board/board-column.tsx`:

```tsx
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { BoardCard } from './board-card'

interface Conversation {
  id: string
  title: string | null
  priority: string
  dueDate: string | null
  tags: string[]
  status: string
  position: number
}

interface BoardColumnProps {
  id: string
  name: string
  color: string | null
  isClosed: boolean
  isFolded: boolean
  conversations: Conversation[]
}

export function BoardColumn({ id, name, color, isClosed, isFolded, conversations }: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col w-[280px] min-w-[280px] rounded-xl ${isClosed ? 'opacity-60' : ''} ${isOver ? 'ring-2 ring-primary/50' : ''}`}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-2.5 rounded-t-xl vibrancy border border-[var(--vibrancy-border)]">
        {color && <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />}
        <span className="text-xs font-semibold uppercase tracking-wide flex-1 truncate">{name}</span>
        <span className="text-[10px] text-muted-foreground">{conversations.length}</span>
      </div>

      {/* Cards */}
      {!isFolded && (
        <div className="flex-1 p-2 space-y-2 min-h-[80px] vibrancy border border-t-0 border-[var(--vibrancy-border)] rounded-b-xl">
          <SortableContext items={conversations.map(c => c.id)} strategy={verticalListSortingStrategy}>
            {conversations.map(conv => (
              <BoardCard
                key={conv.id}
                id={conv.id}
                title={conv.title}
                priority={conv.priority}
                dueDate={conv.dueDate}
                tags={conv.tags}
                status={conv.status}
              />
            ))}
          </SortableContext>
          {conversations.length === 0 && (
            <div className="text-[11px] text-muted-foreground/50 text-center py-4">
              Drop here
            </div>
          )}
        </div>
      )}

      {isFolded && (
        <div className="px-3 py-2 text-[10px] text-muted-foreground vibrancy border border-t-0 border-[var(--vibrancy-border)] rounded-b-xl">
          {conversations.length} conversations
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create board-header.tsx**

Create `src/web/src/pages/board/board-header.tsx`:

```tsx
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus } from 'lucide-react'
import { useBoardStore } from '@/stores/board-store'

interface BoardHeaderProps {
  projectName: string
  projects: { id: string; name: string; color: string | null }[]
  currentProjectId: string | null
  onProjectChange: (id: string) => void
}

export function BoardHeader({ projectName, projects, currentProjectId, onProjectChange }: BoardHeaderProps) {
  const [newTitle, setNewTitle] = useState('')
  const [showInput, setShowInput] = useState(false)
  const addConversation = useBoardStore(s => s.addConversation)

  const handleAdd = async () => {
    if (!newTitle.trim()) return
    await addConversation(newTitle.trim())
    setNewTitle('')
    setShowInput(false)
  }

  return (
    <div className="flex items-center gap-4 mb-4">
      <select
        value={currentProjectId ?? ''}
        onChange={(e) => onProjectChange(e.target.value)}
        className="h-9 px-3 text-sm bg-accent/30 border border-border/50 rounded-lg focus:outline-none focus:ring-1 focus:ring-ring font-semibold"
      >
        {projects.map(p => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>

      <div className="flex-1" />

      {showInput ? (
        <div className="flex items-center gap-2">
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="Conversation title..."
            className="h-9 w-60 text-sm"
            autoFocus
          />
          <Button size="sm" onClick={handleAdd} disabled={!newTitle.trim()}>Add</Button>
          <Button size="sm" variant="ghost" onClick={() => setShowInput(false)}>Cancel</Button>
        </div>
      ) : (
        <Button size="sm" onClick={() => setShowInput(true)}>
          <Plus className="h-4 w-4 mr-1" />
          New Conversation
        </Button>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Create board-page.tsx**

Create `src/web/src/pages/board/board-page.tsx`:

```tsx
import { useEffect } from 'react'
import { DndContext, DragOverlay, closestCorners, type DragEndEvent } from '@dnd-kit/core'
import { useBoardStore } from '@/stores/board-store'
import { BoardHeader } from './board-header'
import { BoardColumn } from './board-column'

export default function BoardPage() {
  const {
    currentProjectId, project, stages, projects, isLoading,
    fetchProjects, setProject, moveConversation,
  } = useBoardStore()

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || !active) return

    const convId = active.id as string
    const targetStageId = over.id as string

    // Find if dropped over a stage column
    const targetStage = stages.find(s => s.id === targetStageId)
    if (targetStage) {
      // Dropped on a column — put at end
      const lastPos = targetStage.conversations.length > 0
        ? targetStage.conversations[targetStage.conversations.length - 1].position + 1.0
        : 1.0
      moveConversation(convId, targetStageId, lastPos)
      return
    }

    // Dropped on another card — find which stage that card is in
    for (const stage of stages) {
      const overConv = stage.conversations.find(c => c.id === over.id)
      if (overConv) {
        const overIdx = stage.conversations.indexOf(overConv)
        const prevPos = overIdx > 0 ? stage.conversations[overIdx - 1].position : 0
        const newPos = (prevPos + overConv.position) / 2
        moveConversation(convId, stage.id, newPos)
        return
      }
    }
  }

  if (projects.length === 0 && !isLoading) {
    return (
      <div>
        <h1 className="page-title mb-2">Board</h1>
        <p className="text-sm text-muted-foreground">No projects yet. Create one to get started.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <BoardHeader
        projectName={project?.name ?? ''}
        projects={projects}
        currentProjectId={currentProjectId}
        onProjectChange={setProject}
      />

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Loading...</div>
      ) : (
        <DndContext collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
          <div className="flex-1 overflow-x-auto">
            <div className="flex gap-4 pb-4 min-h-[400px]">
              {stages.map(stage => (
                <BoardColumn
                  key={stage.id}
                  id={stage.id}
                  name={stage.name}
                  color={stage.color}
                  isClosed={stage.isClosed}
                  isFolded={stage.isFolded}
                  conversations={stage.conversations}
                />
              ))}
            </div>
          </div>
        </DndContext>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Build frontend**

```bash
cd /Users/eyssen/GitHub/eyas/src/web && bun run build
```

Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(board): add kanban board frontend with drag & drop"
```

### Task 12: Final integration test — full suite

**Files:** None new — verification only.

- [ ] **Step 1: Run all backend tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run
```

Expected: All tests PASS

- [ ] **Step 2: Build frontend**

```bash
cd /Users/eyssen/GitHub/eyas/src/web && bun run build
```

Expected: Build succeeds with no errors

- [ ] **Step 3: Manual smoke test**

```bash
cd /Users/eyssen/GitHub/eyas && bun src/main.ts &
cd src/web && bun run dev &
```

Check:
1. `/conversations` page works (renamed from `/chats`)
2. `/board` page loads
3. Sidebar shows "Conversations" and "Board"
4. API: `curl -s localhost:3000/api/v1/conversations | jq` works
5. API: `curl -s localhost:3000/api/v1/projects | jq` works

- [ ] **Step 4: Stop servers and commit if any fixes were needed**

```bash
# Kill background processes
kill %1 %2
```
