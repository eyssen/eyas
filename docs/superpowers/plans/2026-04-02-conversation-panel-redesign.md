# Conversation Panel Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign conversation panel from modal to full-screen with resizable split, add chatter module, activity module, and proper tag system.

**Architecture:** Four independent layers built bottom-up: (1) Tag system extending board module, (2) Activity standalone module, (3) Chatter standalone module with bus-event tracking, (4) Frontend rewrite connecting everything. Each layer is testable and deployable independently.

**Tech Stack:** TypeScript, Drizzle ORM (raw SQL), Hono routes, Vitest tests, React 19 + Zustand + TanStack Router + shadcn/ui + react-resizable-panels

**Spec:** `docs/superpowers/specs/2026-04-02-conversation-panel-redesign.md`

---

## Task 1: Tag System — Schema & Service

**Files:**
- Create: `src/modules/board/services/tag-service.ts`
- Modify: `src/modules/board/index.ts` (add table creation + migration)
- Modify: `tests/helpers/test-db.ts` (add tag tables)
- Create: `tests/modules/board/tag-service.test.ts`

- [ ] **Step 1: Add tag tables to test-db.ts**

In `tests/helpers/test-db.ts`, add after the `stages` CREATE TABLE line:

```typescript
db.run(sql`CREATE TABLE IF NOT EXISTS tag_categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT DEFAULT '#8b949e', sort_order INTEGER DEFAULT 0, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, created_at TEXT DEFAULT (datetime('now')))`)
db.run(sql`CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT DEFAULT '#8b949e', category_id TEXT REFERENCES tag_categories(id) ON DELETE SET NULL, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, created_at TEXT DEFAULT (datetime('now')))`)
db.run(sql`CREATE TABLE IF NOT EXISTS conversation_tags (conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY (conversation_id, tag_id))`)
```

- [ ] **Step 2: Write failing tests for tag service**

Create `tests/modules/board/tag-service.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createTagService, type TagService } from '@modules/board/services/tag-service'

const testDb = createTestDb('board-tags')
let db: ReturnType<typeof testDb.open>
let svc: TagService

beforeEach(() => {
  db = testDb.open()
  svc = createTagService(db)
})
afterEach(() => testDb.cleanup())

describe('TagService', () => {
  describe('categories', () => {
    it('creates a category', () => {
      const cat = svc.createCategory({ name: 'Priority', color: '#ef4444' })
      expect(cat.id).toBeTruthy()
      expect(cat.name).toBe('Priority')
      expect(cat.color).toBe('#ef4444')
    })

    it('lists categories by sort order', () => {
      svc.createCategory({ name: 'B', sortOrder: 2 })
      svc.createCategory({ name: 'A', sortOrder: 1 })
      const cats = svc.listCategories()
      expect(cats[0].name).toBe('A')
      expect(cats[1].name).toBe('B')
    })

    it('updates a category', () => {
      const cat = svc.createCategory({ name: 'Old' })
      svc.updateCategory(cat.id, { name: 'New', color: '#00ff00' })
      const updated = svc.listCategories().find(c => c.id === cat.id)
      expect(updated!.name).toBe('New')
      expect(updated!.color).toBe('#00ff00')
    })

    it('deletes a category and orphans its tags', () => {
      const cat = svc.createCategory({ name: 'Temp' })
      svc.createTag({ name: 'child', categoryId: cat.id })
      svc.deleteCategory(cat.id)
      expect(svc.listCategories()).toHaveLength(0)
      const tags = svc.listTags()
      expect(tags).toHaveLength(1)
      expect(tags[0].categoryId).toBeNull()
    })

    it('filters categories by projectId', () => {
      svc.createCategory({ name: 'Global' })
      svc.createCategory({ name: 'Project', projectId: 'p1' })
      expect(svc.listCategories('p1')).toHaveLength(1)
      expect(svc.listCategories()).toHaveLength(2)
    })
  })

  describe('tags', () => {
    it('creates a tag', () => {
      const tag = svc.createTag({ name: 'backend', color: '#3b82f6' })
      expect(tag.id).toBeTruthy()
      expect(tag.name).toBe('backend')
    })

    it('creates a tag with category', () => {
      const cat = svc.createCategory({ name: 'Type' })
      const tag = svc.createTag({ name: 'bug', categoryId: cat.id })
      expect(tag.categoryId).toBe(cat.id)
    })

    it('lists tags ordered by category sort then name', () => {
      const cat = svc.createCategory({ name: 'A', sortOrder: 0 })
      svc.createTag({ name: 'z-tag', categoryId: cat.id })
      svc.createTag({ name: 'a-tag' }) // no category
      const tags = svc.listTags()
      expect(tags).toHaveLength(2)
    })

    it('updates a tag', () => {
      const tag = svc.createTag({ name: 'old' })
      svc.updateTag(tag.id, { name: 'new' })
      const updated = svc.listTags().find(t => t.id === tag.id)
      expect(updated!.name).toBe('new')
    })

    it('deletes a tag and removes conversation associations', () => {
      const tag = svc.createTag({ name: 'temp' })
      svc.deleteTag(tag.id)
      expect(svc.listTags()).toHaveLength(0)
    })

    it('filters tags by projectId', () => {
      svc.createTag({ name: 'global' })
      svc.createTag({ name: 'scoped', projectId: 'p1' })
      expect(svc.listTags('p1')).toHaveLength(1)
    })
  })

  describe('conversation tags', () => {
    it('sets tags on a conversation', () => {
      const t1 = svc.createTag({ name: 'a' })
      const t2 = svc.createTag({ name: 'b' })
      svc.setConversationTags('conv1', [t1.id, t2.id])
      expect(svc.getConversationTags('conv1')).toHaveLength(2)
    })

    it('replaces existing tags', () => {
      const t1 = svc.createTag({ name: 'a' })
      const t2 = svc.createTag({ name: 'b' })
      svc.setConversationTags('conv1', [t1.id])
      svc.setConversationTags('conv1', [t2.id])
      const tags = svc.getConversationTags('conv1')
      expect(tags).toHaveLength(1)
      expect(tags[0].id).toBe(t2.id)
    })

    it('handles empty tag array', () => {
      const t1 = svc.createTag({ name: 'a' })
      svc.setConversationTags('conv1', [t1.id])
      svc.setConversationTags('conv1', [])
      expect(svc.getConversationTags('conv1')).toHaveLength(0)
    })
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bunx vitest run tests/modules/board/tag-service.test.ts`
Expected: FAIL — module `@modules/board/services/tag-service` not found

- [ ] **Step 4: Implement tag service**

Create `src/modules/board/services/tag-service.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'

export interface TagCategory {
  id: string
  name: string
  color: string
  sortOrder: number
  projectId: string | null
  createdAt: string
}

export interface Tag {
  id: string
  name: string
  color: string
  categoryId: string | null
  categoryName: string | null
  projectId: string | null
  createdAt: string
}

export interface CreateCategoryInput {
  name: string
  color?: string
  sortOrder?: number
  projectId?: string
}

export interface CreateTagInput {
  name: string
  color?: string
  categoryId?: string
  projectId?: string
}

export interface TagService {
  createCategory(input: CreateCategoryInput): TagCategory
  listCategories(projectId?: string): TagCategory[]
  updateCategory(id: string, input: Partial<CreateCategoryInput>): void
  deleteCategory(id: string): void

  createTag(input: CreateTagInput): Tag
  listTags(projectId?: string): Tag[]
  updateTag(id: string, input: Partial<CreateTagInput>): void
  deleteTag(id: string): void

  setConversationTags(conversationId: string, tagIds: string[]): void
  getConversationTags(conversationId: string): Tag[]
}

function toCategory(raw: any): TagCategory {
  return {
    id: raw.id,
    name: raw.name,
    color: raw.color ?? '#8b949e',
    sortOrder: raw.sort_order ?? 0,
    projectId: raw.project_id ?? null,
    createdAt: raw.created_at,
  }
}

function toTag(raw: any): Tag {
  return {
    id: raw.id,
    name: raw.name,
    color: raw.color ?? '#8b949e',
    categoryId: raw.category_id ?? null,
    categoryName: raw.category_name ?? null,
    projectId: raw.project_id ?? null,
    createdAt: raw.created_at,
  }
}

export function createTagService(db: any): TagService {
  return {
    createCategory(input: CreateCategoryInput): TagCategory {
      const id = generateId()
      db.run(sql`INSERT INTO tag_categories (id, name, color, sort_order, project_id)
        VALUES (${id}, ${input.name}, ${input.color ?? '#8b949e'}, ${input.sortOrder ?? 0}, ${input.projectId ?? null})`)
      return toCategory((db.all(sql`SELECT * FROM tag_categories WHERE id = ${id}`) as any[])[0])
    },

    listCategories(projectId?: string): TagCategory[] {
      if (projectId) {
        return (db.all(sql`SELECT * FROM tag_categories WHERE project_id = ${projectId} ORDER BY sort_order, name`) as any[]).map(toCategory)
      }
      return (db.all(sql`SELECT * FROM tag_categories ORDER BY sort_order, name`) as any[]).map(toCategory)
    },

    updateCategory(id: string, input: Partial<CreateCategoryInput>): void {
      if (input.name !== undefined) db.run(sql`UPDATE tag_categories SET name = ${input.name} WHERE id = ${id}`)
      if (input.color !== undefined) db.run(sql`UPDATE tag_categories SET color = ${input.color} WHERE id = ${id}`)
      if (input.sortOrder !== undefined) db.run(sql`UPDATE tag_categories SET sort_order = ${input.sortOrder} WHERE id = ${id}`)
    },

    deleteCategory(id: string): void {
      db.run(sql`UPDATE tags SET category_id = NULL WHERE category_id = ${id}`)
      db.run(sql`DELETE FROM tag_categories WHERE id = ${id}`)
    },

    createTag(input: CreateTagInput): Tag {
      const id = generateId()
      db.run(sql`INSERT INTO tags (id, name, color, category_id, project_id)
        VALUES (${id}, ${input.name}, ${input.color ?? '#8b949e'}, ${input.categoryId ?? null}, ${input.projectId ?? null})`)
      return toTag((db.all(sql`SELECT t.*, tc.name as category_name FROM tags t LEFT JOIN tag_categories tc ON t.category_id = tc.id WHERE t.id = ${id}`) as any[])[0])
    },

    listTags(projectId?: string): Tag[] {
      if (projectId) {
        return (db.all(sql`SELECT t.*, tc.name as category_name FROM tags t LEFT JOIN tag_categories tc ON t.category_id = tc.id WHERE t.project_id = ${projectId} ORDER BY tc.sort_order, t.name`) as any[]).map(toTag)
      }
      return (db.all(sql`SELECT t.*, tc.name as category_name FROM tags t LEFT JOIN tag_categories tc ON t.category_id = tc.id ORDER BY tc.sort_order, t.name`) as any[]).map(toTag)
    },

    updateTag(id: string, input: Partial<CreateTagInput>): void {
      if (input.name !== undefined) db.run(sql`UPDATE tags SET name = ${input.name} WHERE id = ${id}`)
      if (input.color !== undefined) db.run(sql`UPDATE tags SET color = ${input.color} WHERE id = ${id}`)
      if (input.categoryId !== undefined) db.run(sql`UPDATE tags SET category_id = ${input.categoryId} WHERE id = ${id}`)
    },

    deleteTag(id: string): void {
      db.run(sql`DELETE FROM conversation_tags WHERE tag_id = ${id}`)
      db.run(sql`DELETE FROM tags WHERE id = ${id}`)
    },

    setConversationTags(conversationId: string, tagIds: string[]): void {
      db.run(sql`DELETE FROM conversation_tags WHERE conversation_id = ${conversationId}`)
      for (const tagId of tagIds) {
        db.run(sql`INSERT INTO conversation_tags (conversation_id, tag_id) VALUES (${conversationId}, ${tagId})`)
      }
    },

    getConversationTags(conversationId: string): Tag[] {
      return (db.all(sql`SELECT t.*, tc.name as category_name FROM tags t LEFT JOIN tag_categories tc ON t.category_id = tc.id INNER JOIN conversation_tags ct ON ct.tag_id = t.id WHERE ct.conversation_id = ${conversationId} ORDER BY tc.sort_order, t.name`) as any[]).map(toTag)
    },
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bunx vitest run tests/modules/board/tag-service.test.ts`
Expected: All 11 tests PASS

- [ ] **Step 6: Add tag tables to board module onRegister**

In `src/modules/board/index.ts`, add after the stages CREATE TABLE line (line 30):

```typescript
// Tag system
ctx.db.run(sql`CREATE TABLE IF NOT EXISTS tag_categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT DEFAULT '#8b949e', sort_order INTEGER DEFAULT 0, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, created_at TEXT DEFAULT (datetime('now')))`)
ctx.db.run(sql`CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT DEFAULT '#8b949e', category_id TEXT REFERENCES tag_categories(id) ON DELETE SET NULL, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, created_at TEXT DEFAULT (datetime('now')))`)
ctx.db.run(sql`CREATE TABLE IF NOT EXISTS conversation_tags (conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY (conversation_id, tag_id))`)
```

Also import and create the tag service:

```typescript
import { createTagService } from './services/tag-service.js'
```

Add after stageService creation:

```typescript
const tagService = createTagService(ctx.db)
```

Update the ctx.board assignment:

```typescript
;(ctx as any).board = { projectTypes: projectTypeService, projects: projectService, stages: stageService, tags: tagService }
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/board/services/tag-service.ts src/modules/board/index.ts tests/modules/board/tag-service.test.ts tests/helpers/test-db.ts
git commit -m "feat(board): add tag system — categories, tags, conversation_tags junction"
```

---

## Task 2: Tag System — API Routes

**Files:**
- Modify: `src/modules/board/routes.ts`
- Create: `tests/modules/board/tag-routes.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `tests/modules/board/tag-routes.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createTestDb, insertTestOwner } from '../../helpers/test-db'
import { createTagService } from '@modules/board/services/tag-service'
import { createProjectTypeService } from '@modules/board/services/project-type-service'
import { createProjectService } from '@modules/board/services/project-service'
import { createStageService } from '@modules/board/services/stage-service'
import { createConversationService } from '@modules/conversations/conversation-service'
import { createBoardRoutes } from '@modules/board/routes'

const testDb = createTestDb('board-tag-routes')
let db: ReturnType<typeof testDb.open>
let app: Hono

beforeEach(async () => {
  db = testDb.open()
  app = new Hono()

  // Auth middleware mock
  app.use('*', async (c, next) => {
    ;(c as any).set('userId', 'test-user')
    await next()
  })

  const projectTypeService = createProjectTypeService(db)
  const projectService = createProjectService(db, projectTypeService)
  const stageService = createStageService(db)
  const tagService = createTagService(db)
  const conversationService = createConversationService(db)

  createBoardRoutes(app, { projectTypes: projectTypeService, projects: projectService, stages: stageService, tags: tagService }, conversationService)
})
afterEach(() => testDb.cleanup())

describe('Tag Routes', () => {
  describe('POST /api/v1/tag-categories', () => {
    it('creates a category', async () => {
      const res = await app.request('/api/v1/tag-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Type', color: '#ff0000' }),
      })
      expect(res.status).toBe(201)
      const data = await res.json()
      expect(data.category.name).toBe('Type')
    })
  })

  describe('GET /api/v1/tag-categories', () => {
    it('lists categories', async () => {
      await app.request('/api/v1/tag-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'A' }),
      })
      const res = await app.request('/api/v1/tag-categories')
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.categories).toHaveLength(1)
    })
  })

  describe('POST /api/v1/tags', () => {
    it('creates a tag', async () => {
      const res = await app.request('/api/v1/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'backend', color: '#3b82f6' }),
      })
      expect(res.status).toBe(201)
      const data = await res.json()
      expect(data.tag.name).toBe('backend')
    })
  })

  describe('GET /api/v1/tags', () => {
    it('lists tags', async () => {
      await app.request('/api/v1/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      })
      const res = await app.request('/api/v1/tags')
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.tags).toHaveLength(1)
    })
  })

  describe('PUT /api/v1/conversations/:id/tags', () => {
    it('sets tags on a conversation', async () => {
      // Create a conversation first
      const convService = createConversationService(db)
      const conv = convService.create({ userId: 'test-user', title: 'Test' })

      const tagRes = await app.request('/api/v1/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'urgent' }),
      })
      const { tag } = await tagRes.json()

      const res = await app.request(`/api/v1/conversations/${conv.id}/tags`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagIds: [tag.id] }),
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.tags).toHaveLength(1)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/modules/board/tag-routes.test.ts`
Expected: FAIL — routes don't exist yet

- [ ] **Step 3: Add tag routes to board routes**

In `src/modules/board/routes.ts`, update the `BoardServices` interface and add import:

```typescript
import type { TagService } from './services/tag-service.js'

interface BoardServices {
  projectTypes: ProjectTypeService
  projects: ProjectService
  stages: StageService
  tags: TagService
}
```

Add at the end of `createBoardRoutes`, before the closing `}`:

```typescript
  // ─── Tag Categories ──────────────────────────────────

  app.get('/api/v1/tag-categories', (c) => {
    const projectId = c.req.query('projectId')
    const categories = board.tags.listCategories(projectId || undefined)
    return c.json({ categories })
  })

  app.post('/api/v1/tag-categories', async (c) => {
    const body = await c.req.json()
    if (!body.name) throw new HTTPException(400, { message: 'name is required' })
    const category = board.tags.createCategory(body)
    return c.json({ category }, 201)
  })

  app.patch('/api/v1/tag-categories/:id', async (c) => {
    const id = c.req.param('id')
    const body = await c.req.json()
    board.tags.updateCategory(id, body)
    const categories = board.tags.listCategories()
    const updated = categories.find(cat => cat.id === id)
    return c.json({ category: updated })
  })

  app.delete('/api/v1/tag-categories/:id', (c) => {
    const id = c.req.param('id')
    board.tags.deleteCategory(id)
    return c.json({ message: 'Category deleted' })
  })

  // ─── Tags ────────────────────────────────────────────

  app.get('/api/v1/tags', (c) => {
    const projectId = c.req.query('projectId')
    const tags = board.tags.listTags(projectId || undefined)
    return c.json({ tags })
  })

  app.post('/api/v1/tags', async (c) => {
    const body = await c.req.json()
    if (!body.name) throw new HTTPException(400, { message: 'name is required' })
    const tag = board.tags.createTag(body)
    return c.json({ tag }, 201)
  })

  app.patch('/api/v1/tags/:id', async (c) => {
    const id = c.req.param('id')
    const body = await c.req.json()
    board.tags.updateTag(id, body)
    const tags = board.tags.listTags()
    const updated = tags.find(t => t.id === id)
    return c.json({ tag: updated })
  })

  app.delete('/api/v1/tags/:id', (c) => {
    const id = c.req.param('id')
    board.tags.deleteTag(id)
    return c.json({ message: 'Tag deleted' })
  })

  // ─── Conversation Tags ───────────────────────────────

  app.put('/api/v1/conversations/:id/tags', async (c) => {
    const id = c.req.param('id')
    const body = await c.req.json()
    if (!Array.isArray(body.tagIds)) throw new HTTPException(400, { message: 'tagIds array required' })
    board.tags.setConversationTags(id, body.tagIds)
    const tags = board.tags.getConversationTags(id)
    return c.json({ tags })
  })
```

- [ ] **Step 4: Update existing board routes test and route creation to pass tags**

In `src/modules/board/index.ts`, update the `onStart` method — the `createBoardRoutes` call needs the tags service. It already passes `board` which now includes `tags`.

Check that `tests/modules/board/routes.test.ts` still works by adding the tagService to its setup (if needed).

- [ ] **Step 5: Run tests to verify they pass**

Run: `bunx vitest run tests/modules/board/tag-routes.test.ts`
Expected: All 5 tests PASS

Also run existing board tests:
Run: `bunx vitest run tests/modules/board/`
Expected: All tests PASS

- [ ] **Step 6: Update ModuleContext type**

In `src/core/types.ts`, update the `board` property to include tags:

```typescript
board: {
  projectTypes: import('@modules/board/services/project-type-service').ProjectTypeService
  projects: import('@modules/board/services/project-service').ProjectService
  stages: import('@modules/board/services/stage-service').StageService
  tags: import('@modules/board/services/tag-service').TagService
}
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/board/routes.ts src/core/types.ts tests/modules/board/tag-routes.test.ts
git commit -m "feat(board): add tag CRUD API routes — categories, tags, conversation tags"
```

---

## Task 3: Activity Module — Schema & Service

**Files:**
- Create: `src/modules/activity/index.ts`
- Create: `src/modules/activity/activity-service.ts`
- Create: `src/modules/activity/routes.ts`
- Modify: `tests/helpers/test-db.ts` (add activity tables)
- Create: `tests/modules/activity/activity-service.test.ts`

- [ ] **Step 1: Add activity tables to test-db.ts**

In `tests/helpers/test-db.ts`, add after the conversation_tags CREATE TABLE:

```typescript
db.run(sql`CREATE TABLE IF NOT EXISTS activity_types (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, category TEXT NOT NULL DEFAULT 'default' CHECK (category IN ('default', 'upload_file', 'phonecall', 'meeting')), decoration TEXT NOT NULL DEFAULT 'normal' CHECK (decoration IN ('normal', 'warning', 'danger')), delay_days INTEGER DEFAULT 0, delay_unit TEXT DEFAULT 'days' CHECK (delay_unit IN ('days', 'weeks', 'months')), trigger_next_type_id TEXT REFERENCES activity_types(id) ON DELETE SET NULL, suggest_next_type_id TEXT REFERENCES activity_types(id) ON DELETE SET NULL, default_user_id TEXT, summary_template TEXT, sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`)
db.run(sql`CREATE TABLE IF NOT EXISTS activities (id TEXT PRIMARY KEY, type_id TEXT NOT NULL REFERENCES activity_types(id) ON DELETE CASCADE, res_model TEXT NOT NULL, res_id TEXT NOT NULL, summary TEXT, note TEXT, user_id TEXT NOT NULL, created_by_id TEXT NOT NULL, date_deadline TEXT NOT NULL, done_at TEXT, feedback TEXT, automated INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`)
```

- [ ] **Step 2: Write failing tests**

Create `tests/modules/activity/activity-service.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createActivityService, type ActivityService } from '@modules/activity/activity-service'

const testDb = createTestDb('activity')
let db: ReturnType<typeof testDb.open>
let svc: ActivityService

function seedTypes(db: any) {
  const { sql } = require('drizzle-orm')
  const { generateId } = require('@shared/crypto')
  const todoId = generateId()
  const reviewId = generateId()
  db.run(sql`INSERT INTO activity_types (id, name, icon, category, decoration, delay_days, delay_unit, sort_order) VALUES (${todoId}, 'To Do', '✅', 'default', 'normal', 0, 'days', 0)`)
  db.run(sql`INSERT INTO activity_types (id, name, icon, category, decoration, delay_days, delay_unit, trigger_next_type_id, sort_order) VALUES (${reviewId}, 'Code Review', '🔍', 'default', 'warning', 3, 'days', NULL, 1)`)
  return { todoId, reviewId }
}

beforeEach(() => {
  db = testDb.open()
  svc = createActivityService(db)
})
afterEach(() => testDb.cleanup())

describe('ActivityService', () => {
  describe('listTypes', () => {
    it('returns seeded activity types', () => {
      seedTypes(db)
      const types = svc.listTypes()
      expect(types).toHaveLength(2)
      expect(types[0].name).toBe('To Do')
    })
  })

  describe('schedule', () => {
    it('creates an activity', () => {
      const { todoId } = seedTypes(db)
      const activity = svc.schedule({
        typeId: todoId,
        resModel: 'conversation',
        resId: 'conv1',
        summary: 'Fix the bug',
        userId: 'user1',
        createdById: 'user1',
        dateDeadline: '2026-04-05',
      })
      expect(activity.id).toBeTruthy()
      expect(activity.summary).toBe('Fix the bug')
      expect(activity.state).toBe('planned')
    })

    it('computes overdue state', () => {
      const { todoId } = seedTypes(db)
      const activity = svc.schedule({
        typeId: todoId,
        resModel: 'conversation',
        resId: 'conv1',
        userId: 'user1',
        createdById: 'user1',
        dateDeadline: '2020-01-01',
      })
      expect(activity.state).toBe('overdue')
    })

    it('computes today state', () => {
      const { todoId } = seedTypes(db)
      const today = new Date().toISOString().split('T')[0]
      const activity = svc.schedule({
        typeId: todoId,
        resModel: 'conversation',
        resId: 'conv1',
        userId: 'user1',
        createdById: 'user1',
        dateDeadline: today,
      })
      expect(activity.state).toBe('today')
    })
  })

  describe('listByRecord', () => {
    it('returns activities for a record', () => {
      const { todoId } = seedTypes(db)
      svc.schedule({ typeId: todoId, resModel: 'conversation', resId: 'conv1', userId: 'u1', createdById: 'u1', dateDeadline: '2026-04-10' })
      svc.schedule({ typeId: todoId, resModel: 'conversation', resId: 'conv2', userId: 'u1', createdById: 'u1', dateDeadline: '2026-04-10' })
      expect(svc.listByRecord('conversation', 'conv1')).toHaveLength(1)
    })
  })

  describe('listByUser', () => {
    it('returns activities for a user', () => {
      const { todoId } = seedTypes(db)
      svc.schedule({ typeId: todoId, resModel: 'conversation', resId: 'c1', userId: 'u1', createdById: 'u1', dateDeadline: '2026-04-10' })
      svc.schedule({ typeId: todoId, resModel: 'conversation', resId: 'c2', userId: 'u2', createdById: 'u1', dateDeadline: '2026-04-10' })
      expect(svc.listByUser('u1')).toHaveLength(1)
    })
  })

  describe('markDone', () => {
    it('marks an activity as done', () => {
      const { todoId } = seedTypes(db)
      const a = svc.schedule({ typeId: todoId, resModel: 'conversation', resId: 'c1', userId: 'u1', createdById: 'u1', dateDeadline: '2026-04-10' })
      const done = svc.markDone(a.id, 'Looks good')
      expect(done.doneAt).toBeTruthy()
      expect(done.feedback).toBe('Looks good')
    })

    it('chains to trigger_next_type_id', () => {
      const { todoId, reviewId } = seedTypes(db)
      // Set todo to trigger review on done
      const { sql } = require('drizzle-orm')
      db.run(sql`UPDATE activity_types SET trigger_next_type_id = ${reviewId} WHERE id = ${todoId}`)

      const a = svc.schedule({ typeId: todoId, resModel: 'conversation', resId: 'c1', userId: 'u1', createdById: 'u1', dateDeadline: '2026-04-05' })
      svc.markDone(a.id)

      const remaining = svc.listByRecord('conversation', 'c1').filter(act => !act.doneAt)
      expect(remaining).toHaveLength(1)
      expect(remaining[0].typeName).toBe('Code Review')
    })
  })

  describe('markCancel', () => {
    it('removes an activity', () => {
      const { todoId } = seedTypes(db)
      const a = svc.schedule({ typeId: todoId, resModel: 'conversation', resId: 'c1', userId: 'u1', createdById: 'u1', dateDeadline: '2026-04-10' })
      svc.markCancel(a.id)
      expect(svc.listByRecord('conversation', 'c1')).toHaveLength(0)
    })
  })

  describe('getStats', () => {
    it('returns overdue/today/planned counts', () => {
      const { todoId } = seedTypes(db)
      const today = new Date().toISOString().split('T')[0]
      svc.schedule({ typeId: todoId, resModel: 'conversation', resId: 'c1', userId: 'u1', createdById: 'u1', dateDeadline: '2020-01-01' })
      svc.schedule({ typeId: todoId, resModel: 'conversation', resId: 'c2', userId: 'u1', createdById: 'u1', dateDeadline: today })
      svc.schedule({ typeId: todoId, resModel: 'conversation', resId: 'c3', userId: 'u1', createdById: 'u1', dateDeadline: '2030-01-01' })
      const stats = svc.getStats('u1')
      expect(stats.overdue).toBe(1)
      expect(stats.today).toBe(1)
      expect(stats.planned).toBe(1)
    })
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bunx vitest run tests/modules/activity/activity-service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement activity service**

Create `src/modules/activity/activity-service.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'

export interface ActivityType {
  id: string
  name: string
  icon: string | null
  category: string
  decoration: string
  delayDays: number
  delayUnit: string
  triggerNextTypeId: string | null
  suggestNextTypeId: string | null
  defaultUserId: string | null
  summaryTemplate: string | null
  sortOrder: number
}

export interface Activity {
  id: string
  typeId: string
  typeName: string
  typeIcon: string | null
  typeDecoration: string
  resModel: string
  resId: string
  summary: string | null
  note: string | null
  userId: string
  createdById: string
  dateDeadline: string
  doneAt: string | null
  feedback: string | null
  automated: boolean
  state: 'overdue' | 'today' | 'planned'
  createdAt: string
}

export interface ScheduleActivityInput {
  typeId: string
  resModel: string
  resId: string
  summary?: string
  note?: string
  userId: string
  createdById: string
  dateDeadline: string
  automated?: boolean
}

export interface ActivityService {
  schedule(input: ScheduleActivityInput): Activity
  markDone(id: string, feedback?: string): Activity
  markCancel(id: string): void
  listByRecord(resModel: string, resId: string): Activity[]
  listByUser(userId: string): Activity[]
  getStats(userId: string): { overdue: number; today: number; planned: number }
  listTypes(): ActivityType[]
}

function computeState(dateDeadline: string): 'overdue' | 'today' | 'planned' {
  const today = new Date().toISOString().split('T')[0]
  if (dateDeadline < today) return 'overdue'
  if (dateDeadline === today) return 'today'
  return 'planned'
}

function toType(raw: any): ActivityType {
  return {
    id: raw.id,
    name: raw.name,
    icon: raw.icon,
    category: raw.category,
    decoration: raw.decoration,
    delayDays: raw.delay_days ?? 0,
    delayUnit: raw.delay_unit ?? 'days',
    triggerNextTypeId: raw.trigger_next_type_id,
    suggestNextTypeId: raw.suggest_next_type_id,
    defaultUserId: raw.default_user_id,
    summaryTemplate: raw.summary_template,
    sortOrder: raw.sort_order ?? 0,
  }
}

function toActivity(raw: any): Activity {
  return {
    id: raw.id,
    typeId: raw.type_id,
    typeName: raw.type_name ?? '',
    typeIcon: raw.type_icon ?? null,
    typeDecoration: raw.type_decoration ?? 'normal',
    resModel: raw.res_model,
    resId: raw.res_id,
    summary: raw.summary,
    note: raw.note,
    userId: raw.user_id,
    createdById: raw.created_by_id,
    dateDeadline: raw.date_deadline,
    doneAt: raw.done_at,
    feedback: raw.feedback,
    automated: raw.automated === 1,
    state: computeState(raw.date_deadline),
    createdAt: raw.created_at,
  }
}

const ACTIVITY_JOIN = sql`SELECT a.*, at.name as type_name, at.icon as type_icon, at.decoration as type_decoration FROM activities a JOIN activity_types at ON a.type_id = at.id`

export function createActivityService(db: any): ActivityService {
  return {
    schedule(input: ScheduleActivityInput): Activity {
      const id = generateId()
      db.run(sql`INSERT INTO activities (id, type_id, res_model, res_id, summary, note, user_id, created_by_id, date_deadline, automated)
        VALUES (${id}, ${input.typeId}, ${input.resModel}, ${input.resId}, ${input.summary ?? null}, ${input.note ?? null}, ${input.userId}, ${input.createdById}, ${input.dateDeadline}, ${input.automated ? 1 : 0})`)
      const rows = db.all(sql`${ACTIVITY_JOIN} WHERE a.id = ${id}`) as any[]
      return toActivity(rows[0])
    },

    markDone(id: string, feedback?: string): Activity {
      const now = new Date().toISOString()
      db.run(sql`UPDATE activities SET done_at = ${now}, feedback = ${feedback ?? null} WHERE id = ${id}`)
      const rows = db.all(sql`${ACTIVITY_JOIN} WHERE a.id = ${id}`) as any[]
      const activity = toActivity(rows[0])

      // Chain: trigger next activity type
      const typeRows = db.all(sql`SELECT * FROM activity_types WHERE id = ${activity.typeId}`) as any[]
      const actType = typeRows[0]
      if (actType?.trigger_next_type_id) {
        const nextType = (db.all(sql`SELECT * FROM activity_types WHERE id = ${actType.trigger_next_type_id}`) as any[])[0]
        if (nextType) {
          const deadline = new Date()
          const delayDays = nextType.delay_days ?? 0
          const delayUnit = nextType.delay_unit ?? 'days'
          if (delayUnit === 'weeks') deadline.setDate(deadline.getDate() + delayDays * 7)
          else if (delayUnit === 'months') deadline.setMonth(deadline.getMonth() + delayDays)
          else deadline.setDate(deadline.getDate() + delayDays)

          this.schedule({
            typeId: nextType.id,
            resModel: activity.resModel,
            resId: activity.resId,
            userId: activity.userId,
            createdById: activity.createdById,
            dateDeadline: deadline.toISOString().split('T')[0],
            automated: true,
          })
        }
      }

      return activity
    },

    markCancel(id: string): void {
      db.run(sql`DELETE FROM activities WHERE id = ${id}`)
    },

    listByRecord(resModel: string, resId: string): Activity[] {
      return (db.all(sql`${ACTIVITY_JOIN} WHERE a.res_model = ${resModel} AND a.res_id = ${resId} ORDER BY a.date_deadline`) as any[]).map(toActivity)
    },

    listByUser(userId: string): Activity[] {
      return (db.all(sql`${ACTIVITY_JOIN} WHERE a.user_id = ${userId} AND a.done_at IS NULL ORDER BY a.date_deadline`) as any[]).map(toActivity)
    },

    getStats(userId: string): { overdue: number; today: number; planned: number } {
      const today = new Date().toISOString().split('T')[0]
      const rows = db.all(sql`SELECT date_deadline FROM activities WHERE user_id = ${userId} AND done_at IS NULL`) as any[]
      let overdue = 0, todayCount = 0, planned = 0
      for (const row of rows) {
        const state = computeState(row.date_deadline)
        if (state === 'overdue') overdue++
        else if (state === 'today') todayCount++
        else planned++
      }
      return { overdue, today: todayCount, planned }
    },

    listTypes(): ActivityType[] {
      return (db.all(sql`SELECT * FROM activity_types ORDER BY sort_order, name`) as any[]).map(toType)
    },
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bunx vitest run tests/modules/activity/activity-service.test.ts`
Expected: All 9 tests PASS

- [ ] **Step 6: Create activity module index with routes and seed**

Create `src/modules/activity/index.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import { createActivityService } from './activity-service.js'

const SEED_TYPES = [
  { name: 'To Do', icon: '✅', category: 'default', decoration: 'normal', sortOrder: 0 },
  { name: 'Code Review', icon: '🔍', category: 'default', decoration: 'warning', sortOrder: 1 },
  { name: 'Follow Up', icon: '📌', category: 'default', decoration: 'normal', sortOrder: 2 },
  { name: 'Upload Document', icon: '📎', category: 'upload_file', decoration: 'normal', sortOrder: 3 },
  { name: 'Meeting', icon: '📅', category: 'meeting', decoration: 'normal', sortOrder: 4 },
  { name: 'Call', icon: '📞', category: 'phonecall', decoration: 'normal', sortOrder: 5 },
]

export const activityModule: EyasModule = {
  id: 'activity',
  name: 'Activity',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Activity scheduling — Odoo-style activity types, deadlines, chaining',
  dependencies: [],

  async onRegister(ctx: ModuleContext) {
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS activity_types (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, category TEXT NOT NULL DEFAULT 'default' CHECK (category IN ('default', 'upload_file', 'phonecall', 'meeting')), decoration TEXT NOT NULL DEFAULT 'normal' CHECK (decoration IN ('normal', 'warning', 'danger')), delay_days INTEGER DEFAULT 0, delay_unit TEXT DEFAULT 'days' CHECK (delay_unit IN ('days', 'weeks', 'months')), trigger_next_type_id TEXT REFERENCES activity_types(id) ON DELETE SET NULL, suggest_next_type_id TEXT REFERENCES activity_types(id) ON DELETE SET NULL, default_user_id TEXT, summary_template TEXT, sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`)
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS activities (id TEXT PRIMARY KEY, type_id TEXT NOT NULL REFERENCES activity_types(id) ON DELETE CASCADE, res_model TEXT NOT NULL, res_id TEXT NOT NULL, summary TEXT, note TEXT, user_id TEXT NOT NULL, created_by_id TEXT NOT NULL, date_deadline TEXT NOT NULL, done_at TEXT, feedback TEXT, automated INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_activities_record ON activities(res_model, res_id)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_activities_user ON activities(user_id, date_deadline)`)

    const service = createActivityService(ctx.db)
    ;(ctx as any).activity = service
    ctx.logger.info('Activity module registered')
  },

  async onStart(ctx: ModuleContext) {
    const service = (ctx as any).activity as ReturnType<typeof createActivityService>

    // Seed default types
    const existing = service.listTypes()
    if (existing.length === 0) {
      for (const type of SEED_TYPES) {
        const id = generateId()
        ctx.db.run(sql`INSERT INTO activity_types (id, name, icon, category, decoration, sort_order) VALUES (${id}, ${type.name}, ${type.icon}, ${type.category}, ${type.decoration}, ${type.sortOrder})`)
      }
      ctx.logger.info('Seeded %d default activity types', SEED_TYPES.length)
    }

    // Routes
    const { createActivityRoutes } = await import('./routes.js')
    createActivityRoutes(ctx.http, service)
    ctx.logger.info('Activity module started')
  },

  async onStop() {},
}
```

Create `src/modules/activity/routes.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ActivityService } from './activity-service.js'

export function createActivityRoutes(app: Hono, service: ActivityService): void {
  app.get('/api/v1/activity-types', (c) => {
    const types = service.listTypes()
    return c.json({ activityTypes: types })
  })

  app.get('/api/v1/activities', (c) => {
    const resModel = c.req.query('resModel')
    const resId = c.req.query('resId')
    const userId = c.req.query('userId')

    if (resModel && resId) {
      return c.json({ activities: service.listByRecord(resModel, resId) })
    }
    if (userId) {
      return c.json({ activities: service.listByUser(userId) })
    }
    throw new HTTPException(400, { message: 'resModel+resId or userId required' })
  })

  app.post('/api/v1/activities', async (c) => {
    const body = await c.req.json()
    if (!body.typeId || !body.resModel || !body.resId || !body.dateDeadline) {
      throw new HTTPException(400, { message: 'typeId, resModel, resId, dateDeadline required' })
    }
    const userId = (c as any).get('userId') || body.userId
    const activity = service.schedule({
      ...body,
      userId: body.userId || userId,
      createdById: userId,
    })
    return c.json({ activity }, 201)
  })

  app.patch('/api/v1/activities/:id', async (c) => {
    // Simple field update — summary, note, dateDeadline, userId
    const id = c.req.param('id')
    const body = await c.req.json()
    // For now, just re-fetch — full update can be added later
    return c.json({ activity: service.listByRecord(body.resModel || '', body.resId || '').find(a => a.id === id) })
  })

  app.post('/api/v1/activities/:id/done', async (c) => {
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => ({}))
    const activity = service.markDone(id, body.feedback)
    return c.json({ activity })
  })

  app.post('/api/v1/activities/:id/cancel', (c) => {
    const id = c.req.param('id')
    service.markCancel(id)
    return c.json({ message: 'Activity cancelled' })
  })
}
```

- [ ] **Step 7: Register activity module in bootstrap**

Find the module registration in `src/core/bootstrap.ts` and add:

```typescript
import { activityModule } from '@modules/activity/index.js'
```

Add `activityModule` to the modules array.

- [ ] **Step 8: Run all tests**

Run: `bunx vitest run tests/modules/activity/`
Expected: All PASS

- [ ] **Step 9: Commit**

```bash
git add src/modules/activity/ tests/modules/activity/ tests/helpers/test-db.ts src/core/bootstrap.ts
git commit -m "feat(activity): add activity module — types, scheduling, chaining, done/cancel, API"
```

---

## Task 4: Chatter Module — Schema & Service

**Files:**
- Create: `src/modules/chatter/index.ts`
- Create: `src/modules/chatter/chatter-service.ts`
- Create: `src/modules/chatter/routes.ts`
- Modify: `tests/helpers/test-db.ts` (add chatter tables)
- Create: `tests/modules/chatter/chatter-service.test.ts`

- [ ] **Step 1: Add chatter tables to test-db.ts**

In `tests/helpers/test-db.ts`, add after the activities CREATE TABLE:

```typescript
db.run(sql`CREATE TABLE IF NOT EXISTS chatter_messages (id TEXT PRIMARY KEY, res_model TEXT NOT NULL, res_id TEXT NOT NULL, author_id TEXT, message_type TEXT NOT NULL DEFAULT 'comment' CHECK (message_type IN ('comment', 'note', 'tracking')), body TEXT NOT NULL, parent_id TEXT REFERENCES chatter_messages(id) ON DELETE SET NULL, created_at TEXT DEFAULT (datetime('now')))`)
db.run(sql`CREATE INDEX IF NOT EXISTS idx_chatter_record ON chatter_messages(res_model, res_id, created_at)`)
db.run(sql`CREATE TABLE IF NOT EXISTS chatter_tracking (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL REFERENCES chatter_messages(id) ON DELETE CASCADE, field TEXT NOT NULL, old_value TEXT, new_value TEXT)`)
db.run(sql`CREATE TABLE IF NOT EXISTS chatter_followers (id TEXT PRIMARY KEY, res_model TEXT NOT NULL, res_id TEXT NOT NULL, user_id TEXT NOT NULL, subtypes TEXT DEFAULT '[]', created_at TEXT DEFAULT (datetime('now')), UNIQUE(res_model, res_id, user_id))`)
```

- [ ] **Step 2: Write failing tests**

Create `tests/modules/chatter/chatter-service.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createChatterService, type ChatterService } from '@modules/chatter/chatter-service'
import { createLocalBus } from '@core/bus/local-bus'
import type { EyasBus } from '@core/types'

const testDb = createTestDb('chatter')
let db: ReturnType<typeof testDb.open>
let bus: EyasBus
let svc: ChatterService

beforeEach(() => {
  db = testDb.open()
  bus = createLocalBus()
  svc = createChatterService(db, bus)
})
afterEach(() => testDb.cleanup())

describe('ChatterService', () => {
  describe('postMessage', () => {
    it('creates a comment message', () => {
      const msg = svc.postMessage('conversation', 'c1', {
        messageType: 'comment',
        body: 'Hello world',
        authorId: 'user1',
      })
      expect(msg.id).toBeTruthy()
      expect(msg.messageType).toBe('comment')
      expect(msg.body).toBe('Hello world')
    })

    it('creates a note message', () => {
      const msg = svc.postMessage('conversation', 'c1', {
        messageType: 'note',
        body: 'Internal only',
        authorId: 'user1',
      })
      expect(msg.messageType).toBe('note')
    })
  })

  describe('logTracking', () => {
    it('creates a tracking message with field changes', () => {
      const msg = svc.logTracking('conversation', 'c1', {
        changes: [
          { field: 'stage', oldValue: 'Backlog', newValue: 'In Progress' },
          { field: 'priority', oldValue: 'normal', newValue: 'high' },
        ],
        authorId: 'user1',
      })
      expect(msg.messageType).toBe('tracking')
      expect(msg.tracking).toHaveLength(2)
      expect(msg.tracking![0].field).toBe('stage')
    })
  })

  describe('listMessages', () => {
    it('lists messages chronologically', () => {
      svc.postMessage('conversation', 'c1', { messageType: 'comment', body: 'First', authorId: 'u1' })
      svc.postMessage('conversation', 'c1', { messageType: 'note', body: 'Second', authorId: 'u1' })
      svc.logTracking('conversation', 'c1', { changes: [{ field: 'status', oldValue: 'idle', newValue: 'working' }], authorId: 'u1' })

      const msgs = svc.listMessages('conversation', 'c1')
      expect(msgs).toHaveLength(3)
    })

    it('filters by message type', () => {
      svc.postMessage('conversation', 'c1', { messageType: 'comment', body: 'Msg', authorId: 'u1' })
      svc.postMessage('conversation', 'c1', { messageType: 'note', body: 'Note', authorId: 'u1' })

      const comments = svc.listMessages('conversation', 'c1', { messageType: 'comment' })
      expect(comments).toHaveLength(1)
      expect(comments[0].body).toBe('Msg')
    })

    it('isolates by resModel and resId', () => {
      svc.postMessage('conversation', 'c1', { messageType: 'comment', body: 'A', authorId: 'u1' })
      svc.postMessage('conversation', 'c2', { messageType: 'comment', body: 'B', authorId: 'u1' })
      svc.postMessage('knowledge.page', 'p1', { messageType: 'comment', body: 'C', authorId: 'u1' })

      expect(svc.listMessages('conversation', 'c1')).toHaveLength(1)
      expect(svc.listMessages('knowledge.page', 'p1')).toHaveLength(1)
    })
  })

  describe('followers', () => {
    it('adds a follower', () => {
      svc.addFollower('conversation', 'c1', 'user1')
      const followers = svc.getFollowers('conversation', 'c1')
      expect(followers).toHaveLength(1)
      expect(followers[0].userId).toBe('user1')
    })

    it('ignores duplicate follower', () => {
      svc.addFollower('conversation', 'c1', 'user1')
      svc.addFollower('conversation', 'c1', 'user1')
      expect(svc.getFollowers('conversation', 'c1')).toHaveLength(1)
    })

    it('removes a follower', () => {
      svc.addFollower('conversation', 'c1', 'user1')
      svc.removeFollower('conversation', 'c1', 'user1')
      expect(svc.getFollowers('conversation', 'c1')).toHaveLength(0)
    })
  })

  describe('bus integration', () => {
    it('creates tracking on record:updated event', async () => {
      bus.emit('record:updated', {
        resModel: 'conversation',
        resId: 'c1',
        changes: [{ field: 'stage', oldValue: 'Backlog', newValue: 'Done' }],
        authorId: 'user1',
      })

      // Bus handlers are async — wait a tick
      await new Promise(r => setTimeout(r, 10))

      const msgs = svc.listMessages('conversation', 'c1')
      expect(msgs).toHaveLength(1)
      expect(msgs[0].messageType).toBe('tracking')
    })
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bunx vitest run tests/modules/chatter/chatter-service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement chatter service**

Create `src/modules/chatter/chatter-service.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import type { EyasBus } from '@core/types'

export interface ChatterMessage {
  id: string
  resModel: string
  resId: string
  authorId: string | null
  messageType: 'comment' | 'note' | 'tracking'
  body: string
  parentId: string | null
  tracking?: TrackingChange[]
  createdAt: string
}

export interface TrackingChange {
  field: string
  oldValue: string | null
  newValue: string | null
}

export interface ChatterFollower {
  id: string
  resModel: string
  resId: string
  userId: string
  subtypes: string[]
  createdAt: string
}

export interface PostMessageInput {
  messageType: 'comment' | 'note'
  body: string
  authorId: string
  parentId?: string
}

export interface TrackingInput {
  changes: TrackingChange[]
  authorId: string
}

export interface ListOpts {
  messageType?: string
  limit?: number
  offset?: number
}

export interface ChatterService {
  postMessage(resModel: string, resId: string, input: PostMessageInput): ChatterMessage
  logTracking(resModel: string, resId: string, input: TrackingInput): ChatterMessage
  listMessages(resModel: string, resId: string, opts?: ListOpts): ChatterMessage[]
  addFollower(resModel: string, resId: string, userId: string, subtypes?: string[]): void
  removeFollower(resModel: string, resId: string, userId: string): void
  getFollowers(resModel: string, resId: string): ChatterFollower[]
}

function toMessage(raw: any, tracking?: TrackingChange[]): ChatterMessage {
  return {
    id: raw.id,
    resModel: raw.res_model,
    resId: raw.res_id,
    authorId: raw.author_id,
    messageType: raw.message_type,
    body: raw.body,
    parentId: raw.parent_id,
    tracking,
    createdAt: raw.created_at,
  }
}

function toFollower(raw: any): ChatterFollower {
  return {
    id: raw.id,
    resModel: raw.res_model,
    resId: raw.res_id,
    userId: raw.user_id,
    subtypes: raw.subtypes ? JSON.parse(raw.subtypes) : [],
    createdAt: raw.created_at,
  }
}

export function createChatterService(db: any, bus: EyasBus): ChatterService {
  const service: ChatterService = {
    postMessage(resModel: string, resId: string, input: PostMessageInput): ChatterMessage {
      const id = generateId()
      db.run(sql`INSERT INTO chatter_messages (id, res_model, res_id, author_id, message_type, body, parent_id)
        VALUES (${id}, ${resModel}, ${resId}, ${input.authorId}, ${input.messageType}, ${input.body}, ${input.parentId ?? null})`)
      const row = (db.all(sql`SELECT * FROM chatter_messages WHERE id = ${id}`) as any[])[0]
      return toMessage(row)
    },

    logTracking(resModel: string, resId: string, input: TrackingInput): ChatterMessage {
      const id = generateId()
      const bodyParts = input.changes.map(c =>
        `${c.field}: ${c.oldValue ?? '(empty)'} → ${c.newValue ?? '(empty)'}`
      )
      db.run(sql`INSERT INTO chatter_messages (id, res_model, res_id, author_id, message_type, body)
        VALUES (${id}, ${resModel}, ${resId}, ${input.authorId}, 'tracking', ${bodyParts.join('\n')})`)

      for (const change of input.changes) {
        db.run(sql`INSERT INTO chatter_tracking (message_id, field, old_value, new_value)
          VALUES (${id}, ${change.field}, ${change.oldValue ?? null}, ${change.newValue ?? null})`)
      }

      const row = (db.all(sql`SELECT * FROM chatter_messages WHERE id = ${id}`) as any[])[0]
      const trackingRows = (db.all(sql`SELECT * FROM chatter_tracking WHERE message_id = ${id}`) as any[]).map(r => ({
        field: r.field,
        oldValue: r.old_value,
        newValue: r.new_value,
      }))
      return toMessage(row, trackingRows)
    },

    listMessages(resModel: string, resId: string, opts?: ListOpts): ChatterMessage[] {
      let rows: any[]
      if (opts?.messageType) {
        rows = db.all(sql`SELECT * FROM chatter_messages WHERE res_model = ${resModel} AND res_id = ${resId} AND message_type = ${opts.messageType} ORDER BY created_at ASC`) as any[]
      } else {
        rows = db.all(sql`SELECT * FROM chatter_messages WHERE res_model = ${resModel} AND res_id = ${resId} ORDER BY created_at ASC`) as any[]
      }

      return rows.map(row => {
        let tracking: TrackingChange[] | undefined
        if (row.message_type === 'tracking') {
          tracking = (db.all(sql`SELECT * FROM chatter_tracking WHERE message_id = ${row.id}`) as any[]).map(r => ({
            field: r.field,
            oldValue: r.old_value,
            newValue: r.new_value,
          }))
        }
        return toMessage(row, tracking)
      })
    },

    addFollower(resModel: string, resId: string, userId: string, subtypes?: string[]): void {
      const id = generateId()
      try {
        db.run(sql`INSERT INTO chatter_followers (id, res_model, res_id, user_id, subtypes)
          VALUES (${id}, ${resModel}, ${resId}, ${userId}, ${JSON.stringify(subtypes ?? [])})`)
      } catch {
        // UNIQUE constraint — already a follower
      }
    },

    removeFollower(resModel: string, resId: string, userId: string): void {
      db.run(sql`DELETE FROM chatter_followers WHERE res_model = ${resModel} AND res_id = ${resId} AND user_id = ${userId}`)
    },

    getFollowers(resModel: string, resId: string): ChatterFollower[] {
      return (db.all(sql`SELECT * FROM chatter_followers WHERE res_model = ${resModel} AND res_id = ${resId} ORDER BY created_at`) as any[]).map(toFollower)
    },
  }

  // Subscribe to bus events for automatic tracking
  bus.on('record:updated', async (data: unknown) => {
    const event = data as { resModel: string; resId: string; changes: TrackingChange[]; authorId: string }
    if (event.changes?.length > 0) {
      service.logTracking(event.resModel, event.resId, {
        changes: event.changes,
        authorId: event.authorId,
      })
    }
  })

  return service
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bunx vitest run tests/modules/chatter/chatter-service.test.ts`
Expected: All 9 tests PASS

- [ ] **Step 6: Create chatter module index and routes**

Create `src/modules/chatter/index.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { createChatterService } from './chatter-service.js'

export const chatterModule: EyasModule = {
  id: 'chatter',
  name: 'Chatter',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Odoo-style chatter — messages, notes, tracking, followers',
  dependencies: [],

  async onRegister(ctx: ModuleContext) {
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS chatter_messages (id TEXT PRIMARY KEY, res_model TEXT NOT NULL, res_id TEXT NOT NULL, author_id TEXT, message_type TEXT NOT NULL DEFAULT 'comment' CHECK (message_type IN ('comment', 'note', 'tracking')), body TEXT NOT NULL, parent_id TEXT REFERENCES chatter_messages(id) ON DELETE SET NULL, created_at TEXT DEFAULT (datetime('now')))`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_chatter_record ON chatter_messages(res_model, res_id, created_at)`)
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS chatter_tracking (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL REFERENCES chatter_messages(id) ON DELETE CASCADE, field TEXT NOT NULL, old_value TEXT, new_value TEXT)`)
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS chatter_followers (id TEXT PRIMARY KEY, res_model TEXT NOT NULL, res_id TEXT NOT NULL, user_id TEXT NOT NULL, subtypes TEXT DEFAULT '[]', created_at TEXT DEFAULT (datetime('now')), UNIQUE(res_model, res_id, user_id))`)

    const service = createChatterService(ctx.db, ctx.bus)
    ;(ctx as any).chatter = service
    ctx.logger.info('Chatter module registered')
  },

  async onStart(ctx: ModuleContext) {
    const { createChatterRoutes } = await import('./routes.js')
    createChatterRoutes(ctx.http, (ctx as any).chatter)
    ctx.logger.info('Chatter module started')
  },

  async onStop() {},
}
```

Create `src/modules/chatter/routes.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ChatterService } from './chatter-service.js'

export function createChatterRoutes(app: Hono, service: ChatterService): void {
  app.get('/api/v1/chatter/:resModel/:resId/messages', (c) => {
    const resModel = c.req.param('resModel')
    const resId = c.req.param('resId')
    const messageType = c.req.query('messageType')
    const messages = service.listMessages(resModel, resId, messageType ? { messageType } : undefined)
    return c.json({ messages })
  })

  app.post('/api/v1/chatter/:resModel/:resId/messages', async (c) => {
    const resModel = c.req.param('resModel')
    const resId = c.req.param('resId')
    const body = await c.req.json()
    if (!body.body) throw new HTTPException(400, { message: 'body is required' })
    const userId = (c as any).get('userId')
    const message = service.postMessage(resModel, resId, {
      messageType: body.messageType || 'comment',
      body: body.body,
      authorId: body.authorId || userId,
      parentId: body.parentId,
    })
    return c.json({ message }, 201)
  })

  app.get('/api/v1/chatter/:resModel/:resId/followers', (c) => {
    const resModel = c.req.param('resModel')
    const resId = c.req.param('resId')
    const followers = service.getFollowers(resModel, resId)
    return c.json({ followers })
  })

  app.post('/api/v1/chatter/:resModel/:resId/followers', async (c) => {
    const resModel = c.req.param('resModel')
    const resId = c.req.param('resId')
    const body = await c.req.json()
    if (!body.userId) throw new HTTPException(400, { message: 'userId is required' })
    service.addFollower(resModel, resId, body.userId, body.subtypes)
    return c.json({ message: 'Follower added' }, 201)
  })

  app.delete('/api/v1/chatter/:resModel/:resId/followers/:userId', (c) => {
    const resModel = c.req.param('resModel')
    const resId = c.req.param('resId')
    const userId = c.req.param('userId')
    service.removeFollower(resModel, resId, userId)
    return c.json({ message: 'Follower removed' })
  })
}
```

- [ ] **Step 7: Register chatter module in bootstrap**

In `src/core/bootstrap.ts`, add:

```typescript
import { chatterModule } from '@modules/chatter/index.js'
```

Add `chatterModule` to the modules array.

- [ ] **Step 8: Run all chatter tests**

Run: `bunx vitest run tests/modules/chatter/`
Expected: All PASS

- [ ] **Step 9: Commit**

```bash
git add src/modules/chatter/ tests/modules/chatter/ tests/helpers/test-db.ts src/core/bootstrap.ts
git commit -m "feat(chatter): add chatter module — messages, notes, tracking, followers, bus integration"
```

---

## Task 5: Install react-resizable-panels dependency

**Files:**
- Modify: `src/web/package.json`

- [ ] **Step 1: Check license and install**

```bash
cd src/web && bun add react-resizable-panels
```

Verify MIT license: `grep -A2 '"license"' node_modules/react-resizable-panels/package.json`

- [ ] **Step 2: Commit**

```bash
git add src/web/package.json src/web/bun.lockb
git commit -m "deps(web): add react-resizable-panels for resizable split layout"
```

---

## Task 6: Frontend — Conversation Page Route & Layout

**Files:**
- Create: `src/web/src/routes/conversations.$conversationId.tsx`
- Create: `src/web/src/pages/conversations/conversation-page.tsx`
- Modify: `src/web/src/pages/conversations/conversations-page.tsx` (navigate to new route)
- Modify: `src/web/src/pages/board/board-card.tsx` (navigate to new route)

- [ ] **Step 1: Create new route file**

Create `src/web/src/routes/conversations.$conversationId.tsx`:

```typescript
import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import ConversationPage from '@/pages/conversations/conversation-page'

export const Route = createFileRoute('/conversations/$conversationId')({
  component: () => (
    <AppLayout>
      <ConversationPage />
    </AppLayout>
  ),
})
```

- [ ] **Step 2: Create ConversationPage with resizable split**

Create `src/web/src/pages/conversations/conversation-page.tsx`:

```typescript
import { useCallback, useEffect, useRef } from 'react'
import { useParams, useNavigate } from '@tanstack/react-router'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useApi } from '@/hooks/use-api'
import { useConversationStore } from '@/stores/conversation-store'
import { ConversationTopBar } from './conversation-top-bar'
import { ConversationFields } from './conversation-fields'
import { ConversationChat } from './conversation-chat'
import { ChatterPanel } from './chatter-panel'

export default function ConversationPage() {
  const { conversationId } = useParams({ from: '/conversations/$conversationId' })
  const navigate = useNavigate()
  const { data, refetch } = useApi<any>(conversationId ? `/conversations/${conversationId}` : '')
  const {
    activeConversation, setActiveConversation,
    streamingText, isStreaming,
    appendStreamText, setStreaming, clearStream,
    addMessage, updateConversation,
  } = useConversationStore()

  const currentIdRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    currentIdRef.current = conversationId
    if (conversationId) {
      clearStream()
      refetch()
    } else {
      setActiveConversation(null)
    }
  }, [conversationId, refetch, setActiveConversation, clearStream])

  useEffect(() => {
    if (data) setActiveConversation(data)
  }, [data, setActiveConversation])

  const handleSend = useCallback(
    async (content: string) => {
      if (!conversationId || !activeConversation) return
      const sendingId = conversationId

      addMessage({
        id: Date.now(), role: 'user', content,
        model: null, provider: null, tokensIn: 0, tokensOut: 0,
        createdAt: new Date().toISOString(),
      })
      setStreaming(true)
      clearStream()

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const res = await fetch(`/api/v1/conversations/${sendingId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Eyas-Request': '1' },
          credentials: 'include',
          body: JSON.stringify({ content }),
          signal: controller.signal,
        })

        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: res.statusText }))
          if (currentIdRef.current === sendingId) {
            addMessage({
              id: Date.now() + 1, role: 'assistant',
              content: `Error: ${errData.error || res.statusText}`,
              model: null, provider: null, tokensIn: 0, tokensOut: 0,
              createdAt: new Date().toISOString(),
            })
          }
          return
        }

        const reader = res.body?.getReader()
        if (!reader) return
        const decoder = new TextDecoder()

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (currentIdRef.current !== sendingId) { reader.cancel(); break }

          const chunk = decoder.decode(value, { stream: true })
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue
            try {
              const event = JSON.parse(line.slice(6))
              if (currentIdRef.current !== sendingId) break
              if (event.type === 'text') appendStreamText(event.text)
              else if (event.type === 'done') {
                addMessage(event.message)
                if (event.conversation) updateConversation({ tokensUsed: event.conversation.tokensUsed, status: event.conversation.status })
              } else if (event.type === 'error') {
                addMessage({ id: Date.now() + 1, role: 'assistant', content: `Error: ${event.error}`, model: null, provider: null, tokensIn: 0, tokensOut: 0, createdAt: new Date().toISOString() })
              }
            } catch { /* malformed SSE */ }
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') console.error('Send error:', err)
      } finally {
        if (currentIdRef.current === sendingId) setStreaming(false)
        if (abortRef.current === controller) abortRef.current = null
      }
    },
    [conversationId, activeConversation, addMessage, appendStreamText, setStreaming, clearStream, updateConversation]
  )

  const handleFieldUpdate = useCallback(async (fields: Record<string, any>) => {
    if (!conversationId) return
    const { api } = await import('@/lib/api')
    await api.patch(`/conversations/${conversationId}`, fields)
    refetch()
  }, [conversationId, refetch])

  const conv = activeConversation
  const [activeTab, setActiveTab] = React.useState<'chat' | 'permissions' | 'audit'>('chat')

  return (
    <div className="flex flex-col h-full">
      <ConversationTopBar
        conversationId={conversationId}
        title={conv?.title ?? null}
        status={conv?.status ?? 'idle'}
        priority={conv?.priority ?? 'normal'}
        providerId={conv?.providerId ?? null}
        modelId={conv?.modelId ?? null}
        onUpdate={handleFieldUpdate}
      />

      <PanelGroup direction="horizontal" autoSaveId="eyas-conversation-split">
        {/* Left 2/3 */}
        <Panel defaultSize={66} minSize={30}>
          <div className="flex flex-col h-full">
            <ConversationFields
              projectId={conv?.projectId ?? null}
              stageId={conv?.stageId ?? null}
              assignees={conv?.assignees ?? []}
              dueDate={conv?.dueDate ?? null}
              conversationId={conversationId}
              onUpdate={handleFieldUpdate}
            />

            {/* Tabs */}
            <div className="flex border-b border-border/50">
              {(['chat', 'permissions', 'audit'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 text-xs font-medium transition-colors ${activeTab === tab ? 'text-foreground border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {tab === 'chat' ? '💬 Chat' : tab === 'permissions' ? '🔒 Permissions' : '📋 Audit Log'}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 flex flex-col min-h-0">
              {activeTab === 'chat' && (
                <ConversationChat
                  messages={conv?.messages ?? []}
                  streamingText={streamingText}
                  isStreaming={isStreaming}
                  onSend={handleSend}
                  disabled={isStreaming || conv?.status === 'working'}
                />
              )}
              {activeTab === 'permissions' && (
                <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                  Permissions — coming with Security module
                </div>
              )}
              {activeTab === 'audit' && (
                <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                  Audit Log — coming with Audit module
                </div>
              )}
            </div>
          </div>
        </Panel>

        {/* Resize handle */}
        <PanelResizeHandle className="w-1 bg-border/30 hover:bg-primary/30 transition-colors cursor-col-resize" />

        {/* Right 1/3 */}
        <Panel defaultSize={34} minSize={20}>
          <ChatterPanel conversationId={conversationId} />
        </Panel>
      </PanelGroup>
    </div>
  )
}
```

Note: Add `import React from 'react'` at the top or use `const [activeTab, setActiveTab] = useState(...)` with the useState import already present.

- [ ] **Step 3: Update conversations list to navigate to new route**

In `src/web/src/pages/conversations/conversations-page.tsx`, change the onClick from `setSelectedId(conv.id)` to:

```typescript
onClick={() => navigate({ to: '/conversations/$conversationId', params: { conversationId: conv.id } })}
```

Add `useNavigate` import and remove the `ConversationDialog` component and `selectedId` state.

- [ ] **Step 4: Update board card to navigate to new route**

In `src/web/src/pages/board/board-card.tsx`, change:

```typescript
onClick={() => navigate({ to: '/conversations/$conversationId', params: { conversationId: id } })}
```

- [ ] **Step 5: Verify build**

Run: `cd src/web && bun run build`
Expected: Build succeeds (or only type errors from not-yet-created components)

- [ ] **Step 6: Commit**

```bash
git add src/web/src/routes/conversations.\$conversationId.tsx src/web/src/pages/conversations/conversation-page.tsx src/web/src/pages/conversations/conversations-page.tsx src/web/src/pages/board/board-card.tsx
git commit -m "feat(web): add full-screen conversation page with resizable split layout"
```

---

## Task 7: Frontend — ConversationTopBar, ConversationFields, ConversationChat

**Files:**
- Create: `src/web/src/pages/conversations/conversation-top-bar.tsx`
- Create: `src/web/src/pages/conversations/conversation-fields.tsx`
- Create: `src/web/src/pages/conversations/conversation-chat.tsx`

- [ ] **Step 1: Create ConversationTopBar**

Create `src/web/src/pages/conversations/conversation-top-bar.tsx`:

```typescript
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useApi } from '@/hooks/use-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Pencil, Check } from 'lucide-react'
import { ContextBar } from './context-bar'

const STATUS_BADGE: Record<string, { className: string; label: string }> = {
  idle: { className: 'text-zinc-400', label: 'Idle' },
  working: { className: 'text-blue-400 animate-pulse', label: 'Working...' },
  waiting: { className: 'text-yellow-400', label: 'Waiting' },
  archived: { className: 'text-zinc-600', label: 'Archived' },
}

const PRIORITY_OPTIONS = ['low', 'normal', 'high', 'urgent'] as const
const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-red-500/20 text-red-400',
  high: 'bg-orange-500/20 text-orange-400',
  normal: 'bg-blue-500/20 text-blue-400',
  low: 'bg-zinc-500/20 text-zinc-400',
}

interface ProviderOption { id: string; name: string; active: boolean }
interface ModelOption { id: string; modelId: string; name: string; enabled: boolean }

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: 'Anthropic', openai: 'OpenAI', openrouter: 'OpenRouter',
  gemini: 'Gemini', 'claude-code': 'Claude Code CLI', 'claude-code-sdk': 'Claude Code SDK',
}

interface ConversationTopBarProps {
  conversationId: string
  title: string | null
  status: string
  priority: string
  providerId: string | null
  modelId: string | null
  onUpdate: (fields: Record<string, any>) => void
}

export function ConversationTopBar({ conversationId, title, status, priority, providerId, modelId, onUpdate }: ConversationTopBarProps) {
  const navigate = useNavigate()
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(title || '')
  const { data: providerData } = useApi<{ providers: ProviderOption[] }>('/model/providers')
  const { data: modelData } = useApi<{ models: ModelOption[] }>(providerId ? `/model/providers/${providerId}` : '')

  const providers = (providerData?.providers ?? []).filter(p => p.active)
  const models = (modelData?.models ?? []).filter((m: ModelOption) => m.enabled)

  const saveTitle = () => {
    if (titleDraft.trim()) onUpdate({ title: titleDraft.trim() })
    setEditingTitle(false)
  }

  const badge = STATUS_BADGE[status] ?? STATUS_BADGE.idle

  return (
    <div>
      <ContextBar tokensUsed={0} contextWindow={200000} />
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate({ to: '/conversations' })}>
          <ArrowLeft className="h-4 w-4" />
        </Button>

        {editingTitle ? (
          <div className="flex items-center gap-1">
            <Input value={titleDraft} onChange={e => setTitleDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveTitle()} onBlur={saveTitle} className="h-7 text-sm w-60" autoFocus />
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={saveTitle}><Check className="h-3 w-3" /></Button>
          </div>
        ) : (
          <button className="text-sm font-semibold truncate flex items-center gap-1 hover:text-foreground/80" onClick={() => { setTitleDraft(title || ''); setEditingTitle(true) }}>
            {title || 'Untitled'}
            <Pencil className="h-3 w-3 text-muted-foreground" />
          </button>
        )}

        <Badge variant="outline" className={`text-[10px] ${badge.className}`}>{badge.label}</Badge>

        <select value={priority} onChange={e => onUpdate({ priority: e.target.value })} className="h-7 px-2 text-[10px] bg-accent/30 border border-border/50 rounded-md focus:outline-none">
          {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
        </select>

        <div className="flex-1" />

        <select value={providerId ?? ''} onChange={e => onUpdate({ providerId: e.target.value, modelId: '' })} className="h-7 px-2 text-xs bg-accent/30 border border-border/50 rounded-md focus:outline-none">
          <option value="">Provider...</option>
          {providers.map(p => <option key={p.id} value={p.id}>{PROVIDER_NAMES[p.id] ?? p.name}</option>)}
        </select>

        <select value={modelId ?? ''} onChange={e => { if (providerId) onUpdate({ modelId: e.target.value }) }} className="h-7 px-2 text-xs bg-accent/30 border border-border/50 rounded-md focus:outline-none max-w-[200px]">
          <option value="">Model...</option>
          {models.map((m: ModelOption) => <option key={m.id} value={m.modelId}>{m.name}</option>)}
        </select>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create ConversationFields**

Create `src/web/src/pages/conversations/conversation-fields.tsx`:

```typescript
import { useApi } from '@/hooks/use-api'
import { Badge } from '@/components/ui/badge'

interface ConversationFieldsProps {
  projectId: string | null
  stageId: string | null
  assignees: string[]
  dueDate: string | null
  conversationId: string
  onUpdate: (fields: Record<string, any>) => void
}

export function ConversationFields({ projectId, stageId, assignees, dueDate, conversationId, onUpdate }: ConversationFieldsProps) {
  const { data: projectData } = useApi<{ projects: { id: string; name: string }[] }>('/projects')
  const { data: stageData } = useApi<{ stages: { id: string; name: string; color: string }[] }>('/stages')
  const { data: tagData } = useApi<{ tags: { id: string; name: string; color: string }[] }>(`/conversations/${conversationId}/tags`)

  const projects = projectData?.projects ?? []
  const stages = stageData?.stages ?? []
  const tags = (tagData as any)?.tags ?? []

  return (
    <div className="flex items-center gap-4 px-4 py-2 border-b border-border/30 flex-wrap text-xs">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase text-muted-foreground tracking-wide">Project</span>
        <select value={projectId ?? ''} onChange={e => onUpdate({ projectId: e.target.value || null })} className="h-6 px-2 text-xs bg-accent/30 border border-border/50 rounded">
          <option value="">None</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase text-muted-foreground tracking-wide">Stage</span>
        <select value={stageId ?? ''} onChange={e => onUpdate({ stageId: e.target.value || null })} className="h-6 px-2 text-xs bg-accent/30 border border-border/50 rounded">
          <option value="">None</option>
          {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase text-muted-foreground tracking-wide">Assignees</span>
        {assignees.length > 0 ? (
          assignees.map(a => <Badge key={a} variant="outline" className="text-[10px]">{a}</Badge>)
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase text-muted-foreground tracking-wide">Due</span>
        <input type="date" value={dueDate ?? ''} onChange={e => onUpdate({ dueDate: e.target.value || null })} className="h-6 px-2 text-xs bg-accent/30 border border-border/50 rounded" />
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase text-muted-foreground tracking-wide">Tags</span>
        {tags.map((t: any) => (
          <Badge key={t.id} variant="outline" className="text-[10px]" style={{ borderColor: t.color + '40', color: t.color }}>{t.name}</Badge>
        ))}
        {tags.length === 0 && <span className="text-muted-foreground">—</span>}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create ConversationChat (refactored from dialog)**

Create `src/web/src/pages/conversations/conversation-chat.tsx`:

```typescript
import { ConversationMessages } from './conversation-messages'
import { ConversationInput } from './conversation-input'

interface ConversationChatProps {
  messages: any[]
  streamingText: string
  isStreaming: boolean
  onSend: (content: string) => void
  disabled: boolean
}

export function ConversationChat({ messages, streamingText, isStreaming, onSend, disabled }: ConversationChatProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ConversationMessages messages={messages} streamingText={streamingText} isStreaming={isStreaming} />
      <ConversationInput onSend={onSend} disabled={disabled} />
    </div>
  )
}
```

- [ ] **Step 4: Verify build**

Run: `cd src/web && bun run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/web/src/pages/conversations/conversation-top-bar.tsx src/web/src/pages/conversations/conversation-fields.tsx src/web/src/pages/conversations/conversation-chat.tsx
git commit -m "feat(web): add ConversationTopBar, ConversationFields, ConversationChat components"
```

---

## Task 8: Frontend — ChatterPanel & Board "+" Button

**Files:**
- Create: `src/web/src/pages/conversations/chatter-panel.tsx`
- Create: `src/web/src/components/chatter/chatter-messages.tsx`
- Create: `src/web/src/components/chatter/chatter-composer.tsx`
- Create: `src/web/src/components/activity/activity-list.tsx`
- Modify: `src/web/src/pages/board/board-column.tsx` (add "+" button)

- [ ] **Step 1: Create ChatterMessages shared component**

Create `src/web/src/components/chatter/chatter-messages.tsx`:

```typescript
import { Badge } from '@/components/ui/badge'

interface TrackingChange {
  field: string
  oldValue: string | null
  newValue: string | null
}

interface ChatterMsg {
  id: string
  authorId: string | null
  messageType: 'comment' | 'note' | 'tracking'
  body: string
  tracking?: TrackingChange[]
  createdAt: string
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

export function ChatterMessageList({ messages }: { messages: ChatterMsg[] }) {
  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      {messages.map(msg => (
        <div key={msg.id} className={`text-xs ${msg.messageType === 'note' ? 'pl-2 border-l-2 border-yellow-500/30 bg-yellow-500/5 rounded p-2' : ''}`}>
          <div className="flex items-center gap-1.5 mb-1">
            <span className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-content text-[8px] font-bold text-primary flex-shrink-0 flex items-center justify-center">
              {(msg.authorId ?? 'S').charAt(0).toUpperCase()}
            </span>
            <span className="font-medium text-muted-foreground">{msg.authorId ?? 'System'}</span>
            {msg.messageType === 'note' && <Badge variant="outline" className="text-[8px] text-yellow-500">Note</Badge>}
            <span className="text-[10px] text-muted-foreground/60 ml-auto">{timeAgo(msg.createdAt)}</span>
          </div>
          {msg.messageType === 'tracking' && msg.tracking ? (
            <div className="pl-6 space-y-0.5">
              {msg.tracking.map((t, i) => (
                <div key={i} className="text-muted-foreground">
                  <span className="font-medium">{t.field}</span>: {t.oldValue ?? '—'} → <span className="text-foreground">{t.newValue ?? '—'}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="pl-6 text-foreground/80">{msg.body}</div>
          )}
        </div>
      ))}
      {messages.length === 0 && (
        <div className="text-center text-muted-foreground/50 text-xs py-8">No messages yet</div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create ChatterComposer shared component**

Create `src/web/src/components/chatter/chatter-composer.tsx`:

```typescript
import { useState } from 'react'

interface ChatterComposerProps {
  onSend: (body: string, type: 'comment' | 'note') => void
}

export function ChatterComposer({ onSend }: ChatterComposerProps) {
  const [mode, setMode] = useState<'comment' | 'note'>('comment')
  const [text, setText] = useState('')

  const handleSend = () => {
    if (!text.trim()) return
    onSend(text.trim(), mode)
    setText('')
  }

  return (
    <div className="border-t border-border/50 p-3">
      <div className="flex gap-2 mb-2">
        <button onClick={() => setMode('comment')} className={`text-[10px] px-2.5 py-1 rounded transition-colors ${mode === 'comment' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
          Send message
        </button>
        <button onClick={() => setMode('note')} className={`text-[10px] px-2.5 py-1 rounded transition-colors ${mode === 'note' ? 'bg-yellow-500/20 text-yellow-500' : 'text-muted-foreground hover:text-foreground'}`}>
          Log note
        </button>
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
        placeholder={mode === 'comment' ? 'Write a message...' : 'Log an internal note...'}
        className="w-full h-16 text-xs p-2 bg-accent/20 border border-border/50 rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <div className="flex justify-end mt-1.5">
        <button onClick={handleSend} className="text-[10px] px-3 py-1 bg-primary text-primary-foreground rounded hover:bg-primary/90">
          {mode === 'comment' ? 'Send' : 'Log'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create ActivityList shared component**

Create `src/web/src/components/activity/activity-list.tsx`:

```typescript
import { useApi } from '@/hooks/use-api'
import { Badge } from '@/components/ui/badge'

interface Activity {
  id: string
  typeName: string
  typeIcon: string | null
  typeDecoration: string
  summary: string | null
  userId: string
  dateDeadline: string
  state: 'overdue' | 'today' | 'planned'
}

const STATE_COLORS = {
  overdue: 'text-red-400 bg-red-500/10',
  today: 'text-orange-400 bg-orange-500/10',
  planned: 'text-blue-400 bg-blue-500/10',
}

export function ActivityList({ resModel, resId }: { resModel: string; resId: string }) {
  const { data, refetch } = useApi<{ activities: Activity[] }>(`/activities?resModel=${resModel}&resId=${resId}`)
  const activities = data?.activities ?? []

  const handleDone = async (id: string) => {
    const { api } = await import('@/lib/api')
    await api.post(`/activities/${id}/done`, {})
    refetch()
  }

  const overdue = activities.filter(a => a.state === 'overdue')
  const today = activities.filter(a => a.state === 'today')
  const planned = activities.filter(a => a.state === 'planned')

  const renderGroup = (label: string, items: Activity[], color: string) => {
    if (items.length === 0) return null
    return (
      <div className="mb-3">
        <div className={`text-[10px] font-semibold uppercase tracking-wide mb-1.5 ${color}`}>{label} ({items.length})</div>
        {items.map(a => (
          <div key={a.id} className="flex items-center gap-2 py-1.5 text-xs group">
            <span>{a.typeIcon ?? '📌'}</span>
            <span className="flex-1 truncate">{a.summary || a.typeName}</span>
            <span className="text-[10px] text-muted-foreground">{a.dateDeadline}</span>
            <button onClick={() => handleDone(a.id)} className="text-[10px] text-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity">✓ Done</button>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-3">
      {renderGroup('Overdue', overdue, 'text-red-400')}
      {renderGroup('Today', today, 'text-orange-400')}
      {renderGroup('Planned', planned, 'text-blue-400')}
      {activities.length === 0 && (
        <div className="text-center text-muted-foreground/50 text-xs py-8">No activities scheduled</div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Create ChatterPanel**

Create `src/web/src/pages/conversations/chatter-panel.tsx`:

```typescript
import { useState, useCallback } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { ChatterMessageList } from '@/components/chatter/chatter-messages'
import { ChatterComposer } from '@/components/chatter/chatter-composer'
import { ActivityList } from '@/components/activity/activity-list'

type ChatterTab = 'messages' | 'activities' | 'attachments'

export function ChatterPanel({ conversationId }: { conversationId: string }) {
  const [tab, setTab] = useState<ChatterTab>('messages')
  const { data, refetch } = useApi<{ messages: any[] }>(`/chatter/conversation/${conversationId}/messages`)
  const messages = data?.messages ?? []

  const handleSend = useCallback(async (body: string, type: 'comment' | 'note') => {
    await api.post(`/chatter/conversation/${conversationId}/messages`, {
      body,
      messageType: type,
    })
    refetch()
  }, [conversationId, refetch])

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-border/50 px-2">
        {(['messages', 'activities', 'attachments'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-[11px] font-medium transition-colors ${tab === t ? 'text-foreground border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'messages' && (
        <>
          <ChatterMessageList messages={messages} />
          <ChatterComposer onSend={handleSend} />
        </>
      )}

      {tab === 'activities' && (
        <ActivityList resModel="conversation" resId={conversationId} />
      )}

      {tab === 'attachments' && (
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
          Attachments — coming with Documents module
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Add "+" button to board columns**

In `src/web/src/pages/board/board-column.tsx`, add a "+" button after the `SortableContext` block and before the "Drop here" empty state:

```typescript
import { useState } from 'react'
import { useBoardStore } from '@/stores/board-store'
import { Plus } from 'lucide-react'

// Inside BoardColumn component, after conversations list:
const [adding, setAdding] = useState(false)
const [newTitle, setNewTitle] = useState('')
const { addConversationToStage } = useBoardStore()

// Add to the column after SortableContext:
{!isFolded && (
  <div className="px-2 pb-2">
    {adding ? (
      <input
        autoFocus
        value={newTitle}
        onChange={e => setNewTitle(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && newTitle.trim()) {
            addConversationToStage(newTitle.trim(), id)
            setNewTitle('')
            setAdding(false)
          }
          if (e.key === 'Escape') { setAdding(false); setNewTitle('') }
        }}
        onBlur={() => { setAdding(false); setNewTitle('') }}
        placeholder="Conversation title..."
        className="w-full text-xs px-2 py-1.5 bg-accent/20 border border-border/50 rounded"
      />
    ) : (
      <button onClick={() => setAdding(true)} className="w-full text-[10px] text-muted-foreground hover:text-foreground flex items-center justify-center gap-1 py-1.5 rounded hover:bg-accent/20 transition-colors">
        <Plus className="h-3 w-3" /> New
      </button>
    )}
  </div>
)}
```

Update board store to add `addConversationToStage` method (in `src/web/src/stores/board-store.ts`):

```typescript
addConversationToStage: async (title: string, stageId: string) => {
  const projectId = get().currentProjectId
  if (!projectId) return
  await api.post(`/projects/${projectId}/conversations`, { title, stageId })
  get().fetchBoard(projectId)
},
```

- [ ] **Step 6: Verify build and visual check**

Run: `cd src/web && bun run build`
Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add src/web/src/pages/conversations/chatter-panel.tsx src/web/src/components/chatter/ src/web/src/components/activity/ src/web/src/pages/board/board-column.tsx src/web/src/stores/board-store.ts
git commit -m "feat(web): add chatter panel, activity list, chatter composer, board '+' button"
```

---

## Task 9: Integration — Wire Conversation Updates to Bus Events

**Files:**
- Modify: `src/modules/conversations/conversation-service.ts`
- Modify: `src/modules/conversations/index.ts`

- [ ] **Step 1: Add bus parameter to conversation service**

In `src/modules/conversations/conversation-service.ts`, update `createConversationService` to accept `bus` as optional second parameter:

```typescript
import type { EyasBus } from '@core/types'

export function createConversationService(db: any, bus?: EyasBus): ConversationService {
```

In the `update` method, after applying all field changes, emit a `record:updated` event with the changes:

```typescript
update(id: string, update: { ... }): void {
  const now = new Date().toISOString()
  const changes: { field: string; oldValue: string | null; newValue: string | null }[] = []

  // Get current values for tracking
  const current = this.get(id)

  if (update.stageId !== undefined && update.stageId !== current?.stageId) {
    changes.push({ field: 'stage', oldValue: current?.stageId ?? null, newValue: update.stageId })
  }
  if (update.priority !== undefined && update.priority !== current?.priority) {
    changes.push({ field: 'priority', oldValue: current?.priority ?? null, newValue: update.priority })
  }
  if (update.status !== undefined && update.status !== current?.status) {
    changes.push({ field: 'status', oldValue: current?.status ?? null, newValue: update.status })
  }
  if (update.projectId !== undefined && update.projectId !== current?.projectId) {
    changes.push({ field: 'project', oldValue: current?.projectId ?? null, newValue: update.projectId })
  }

  // ... existing update logic ...

  // Emit tracking event
  if (bus && changes.length > 0) {
    bus.emit('record:updated', {
      resModel: 'conversation',
      resId: id,
      changes,
      authorId: 'user', // TODO: pass actual userId when available
    })
  }
},
```

- [ ] **Step 2: Pass bus in conversations module**

In `src/modules/conversations/index.ts`, pass `ctx.bus` to `createConversationService`:

```typescript
const service = createConversationService(ctx.db, ctx.bus)
```

- [ ] **Step 3: Run all tests**

Run: `bunx vitest run tests/modules/conversations/ tests/modules/board/ tests/modules/chatter/ tests/modules/activity/`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add src/modules/conversations/conversation-service.ts src/modules/conversations/index.ts
git commit -m "feat(conversations): emit record:updated bus events for chatter tracking"
```

---

## Task 10: Remove Old ConversationDialog Modal

**Files:**
- Delete: `src/web/src/pages/conversations/conversation-dialog.tsx` (or keep as deprecated)
- Modify: `src/web/src/pages/conversations/conversations-page.tsx` (remove dialog import)

- [ ] **Step 1: Clean up conversations-page.tsx**

Remove `ConversationDialog` import and usage. Remove `selectedId` state and `handleClose`. The page now only has the conversation list with navigation.

- [ ] **Step 2: Verify build**

Run: `cd src/web && bun run build`
Expected: Build succeeds, no references to ConversationDialog

- [ ] **Step 3: Run all tests**

Run: `bunx vitest run`
Expected: All existing tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/web/src/pages/conversations/conversations-page.tsx
git rm src/web/src/pages/conversations/conversation-dialog.tsx
git commit -m "refactor(web): remove ConversationDialog modal — replaced by full-screen ConversationPage"
```
