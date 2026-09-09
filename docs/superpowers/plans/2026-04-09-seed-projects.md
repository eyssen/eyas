# Seed Project Types & Projects — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add seed (system-protected) project types and projects, update global stage defaults, and auto-assign conversations to projects.

**Architecture:** Add `source` column to project_types and projects tables. Seed data created on first boot via board module onStart. Protection enforced in service layer (delete/update throw for seed). Conversation create defaults to `general-general` project.

**Tech Stack:** SQLite + Drizzle ORM, Hono routes, TypeScript

---

### Task 1: Add `source` column to schema and services

**Files:**
- Modify: `src/modules/board/schema.ts`
- Modify: `src/modules/board/services/project-type-service.ts`
- Modify: `src/modules/board/services/project-service.ts`
- Modify: `src/modules/board/index.ts` (table creation SQL)

- [ ] **Step 1: Add `source` to schema.ts**

In `src/modules/board/schema.ts`, add `source` column to both tables.

In `projectTypes` table (after `icon`):
```ts
  source: text('source').notNull().default('user'),
```

In `projects` table (after `color`):
```ts
  source: text('source').notNull().default('user'),
```

- [ ] **Step 2: Add `source` to ProjectType interface and mapping in project-type-service.ts**

Add to `ProjectType` interface (after `icon`):
```ts
  source: 'seed' | 'user'
```

Add to `toProjectType` function (after `icon: raw.icon,`):
```ts
    source: raw.source ?? 'user',
```

- [ ] **Step 3: Add source-based protection to ProjectTypeService**

In `update` method, add at the top:
```ts
      const existing = this.get(id)
      if (existing?.source === 'seed') throw new Error('Cannot modify system resource')
```

In `delete` method, replace the body:
```ts
      const existing = this.get(id)
      if (existing?.source === 'seed') throw new Error('Cannot delete system resource')
      db.run(sql`DELETE FROM project_types WHERE id = ${id}`)
```

Note: the `update` method doesn't currently call `this.get()` so you need to bind it. Actually, the service is an object literal with methods, so use the module-level `get` approach. Look at the actual file — the methods are in an object literal returned by `createProjectTypeService`. Each method can reference other methods on the same object. But since `this` in arrow functions doesn't work, you need to query the DB directly:

In `update` method, add at the very start:
```ts
      const check = db.all(sql`SELECT source FROM project_types WHERE id = ${id}`) as any[]
      if (check.length > 0 && check[0].source === 'seed') throw new Error('Cannot modify system resource')
```

In `delete` method, add before the DELETE:
```ts
      const check = db.all(sql`SELECT source FROM project_types WHERE id = ${id}`) as any[]
      if (check.length > 0 && check[0].source === 'seed') throw new Error('Cannot delete system resource')
```

- [ ] **Step 4: Add `source` to Project interface and mapping in project-service.ts**

Add to `Project` interface (after `color`):
```ts
  source: 'seed' | 'user'
```

Add to `toProject` function (after `color: raw.color,`):
```ts
    source: raw.source ?? 'user',
```

- [ ] **Step 5: Add source-based protection to ProjectService**

In `update` method, add at the very start:
```ts
      const check = db.all(sql`SELECT source FROM projects WHERE id = ${id}`) as any[]
      if (check.length > 0 && check[0].source === 'seed') throw new Error('Cannot modify system resource')
```

In `delete` method, add at the very start (before the cascade deletes):
```ts
      const check = db.all(sql`SELECT source FROM projects WHERE id = ${id}`) as any[]
      if (check.length > 0 && check[0].source === 'seed') throw new Error('Cannot delete system resource')
```

- [ ] **Step 6: Update CREATE TABLE SQL in board/index.ts**

In `src/modules/board/index.ts`, find the `CREATE TABLE IF NOT EXISTS project_types` SQL and add `source TEXT NOT NULL DEFAULT 'user'` after `icon TEXT`.

Find the `CREATE TABLE IF NOT EXISTS projects` SQL and add `source TEXT NOT NULL DEFAULT 'user'` after `color TEXT`.

Also add ALTER TABLE for existing DBs (after the CREATE TABLE statements):
```ts
    try { ctx.db.run(sql`ALTER TABLE project_types ADD COLUMN source TEXT NOT NULL DEFAULT 'user'`) } catch {}
    try { ctx.db.run(sql`ALTER TABLE projects ADD COLUMN source TEXT NOT NULL DEFAULT 'user'`) } catch {}
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/board/schema.ts src/modules/board/services/project-type-service.ts src/modules/board/services/project-service.ts src/modules/board/index.ts
git commit -m "feat(board): add source column to project types and projects with seed protection"
```

---

### Task 2: Update global stage seeds and replace project type seeds

**Files:**
- Modify: `src/modules/board/index.ts`

- [ ] **Step 1: Update the global stage seed defaults**

In `src/modules/board/index.ts`, find the stage seed block (around line 80-86) and replace the defaults array:

Find:
```ts
        const defaults = [
          { name: 'Backlog', color: '#94a3b8', sortOrder: 0 },
          { name: 'To Do', color: '#60a5fa', sortOrder: 1 },
          { name: 'In Progress', color: '#fbbf24', sortOrder: 2 },
          { name: 'Review', color: '#a78bfa', sortOrder: 3 },
          { name: 'Done', color: '#34d399', sortOrder: 4, isClosed: true },
        ]
```

Replace with:
```ts
        const defaults = [
          { name: 'Backlog', color: '#aaaaaa', sortOrder: 0 },
          { name: 'To Do', color: '#0061ff', sortOrder: 1, botListen: true },
          { name: 'In Progress', color: '#ff9300', sortOrder: 2 },
          { name: 'Review', color: '#be38f3', sortOrder: 3 },
          { name: 'Done', color: '#77bb41', sortOrder: 4, isClosed: true, isFolded: true },
        ]
```

- [ ] **Step 2: Replace the project type seeds**

Replace the entire `seedTypes` array (around line 99-193) with just two seed types:

```ts
      const seedTypes = [
        {
          id: 'general',
          name: 'General',
          prompt: 'General-purpose project for quick conversations and tasks.',
          icon: 'folder',
          stages: '["Backlog","To Do","In Progress","Review","Done"]',
          agentId: 'jarvis',
        },
        {
          id: 'eyas',
          name: 'EYAS',
          prompt: 'EYAS platform internal operations — agents, skills, prompts, system maintenance.',
          icon: 'settings',
          stages: '["Backlog","To Do","In Progress","Review","Done"]',
          agentId: 'r2d2',
        },
      ]
```

Also update the INSERT SQL to include the `source` column. Replace:
```ts
      for (const t of seedTypes) {
        ctx.db.run(sql`INSERT OR IGNORE INTO project_types (id, name, prompt, icon, default_stages, default_priority, default_agent_id, created_at)
          VALUES (${t.id}, ${t.name}, ${t.prompt}, ${t.icon}, ${t.stages}, 'normal', ${t.agentId}, ${now})`)
      }
```

With:
```ts
      for (const t of seedTypes) {
        ctx.db.run(sql`INSERT OR IGNORE INTO project_types (id, name, prompt, icon, default_stages, default_priority, default_agent_id, source, created_at)
          VALUES (${t.id}, ${t.name}, ${t.prompt}, ${t.icon}, ${t.stages}, 'normal', ${t.agentId}, 'seed', ${now})`)
      }
```

- [ ] **Step 3: Add seed projects**

After the project type seeding block (after the `ctx.logger.info('Seeded %d default project types', seedTypes.length)` line), add a new block to seed projects:

```ts
    // Seed default projects
    try {
      const now = new Date().toISOString()
      const seedProjects = [
        { id: 'general-general', name: 'General', typeId: 'general', description: 'Default project for all conversations' },
        { id: 'eyas-agents', name: 'Agents', typeId: 'eyas', description: 'Agent design, wizard conversations, agent configuration' },
        { id: 'eyas-skills', name: 'Skills', typeId: 'eyas', description: 'Skill development and testing' },
        { id: 'eyas-prompts', name: 'Prompts', typeId: 'eyas', description: 'Prompt template editing and refinement' },
        { id: 'eyas-system', name: 'System', typeId: 'eyas', description: 'Platform maintenance, system engineer tasks' },
      ]
      for (const p of seedProjects) {
        ctx.db.run(sql`INSERT OR IGNORE INTO projects (id, name, description, type_id, source, sort_order, created_at, updated_at)
          VALUES (${p.id}, ${p.name}, ${p.description}, ${p.typeId}, 'seed', 0, ${now}, ${now})`)
      }
      ctx.logger.info('Seeded %d default projects', seedProjects.length)
    } catch (err) {
      ctx.logger.warn('Could not seed default projects: %s', err)
    }
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/board/index.ts
git commit -m "feat(board): update stage seeds and add seed project types + projects"
```

---

### Task 3: Add protection to route handlers

**Files:**
- Modify: `src/modules/board/routes.ts`

- [ ] **Step 1: Add seed protection to project type PATCH handler**

In `src/modules/board/routes.ts`, find the PATCH `/api/v1/project-types/:id` handler (line 36-46). After the 404 check, add:

```ts
    if ((existing as any).source === 'seed') {
      throw new HTTPException(400, { message: 'Cannot modify system resource' })
    }
```

- [ ] **Step 2: Add seed protection to project type DELETE handler**

Find the DELETE `/api/v1/project-types/:id` handler (line 48-56). After the 404 check, add:

```ts
    if ((existing as any).source === 'seed') {
      throw new HTTPException(400, { message: 'Cannot delete system resource' })
    }
```

- [ ] **Step 3: Add seed protection to project PATCH handler**

Find the PATCH `/api/v1/projects/:id` handler (line 83-93). After the 404 check, add:

```ts
    if ((existing as any).source === 'seed') {
      throw new HTTPException(400, { message: 'Cannot modify system resource' })
    }
```

- [ ] **Step 4: Add seed protection to project DELETE handler**

Find the DELETE `/api/v1/projects/:id` handler (line 95-103). After the 404 check, add:

```ts
    if ((existing as any).source === 'seed') {
      throw new HTTPException(400, { message: 'Cannot delete system resource' })
    }
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/board/routes.ts
git commit -m "feat(board): protect seed project types and projects from modification/deletion"
```

---

### Task 4: Auto-assign conversations to default project

**Files:**
- Modify: `src/modules/conversations/routes.ts`
- Modify: `src/web/src/pages/agents/agents-page.tsx`

- [ ] **Step 1: Add default projectId in conversation create route**

In `src/modules/conversations/routes.ts`, find the create conversation handler (line 55-81). After the conversation is created (line 79: `const conversation = chatService.create(...)`) and before the return, add project assignment:

```ts
    // Auto-assign to project (default: general-general)
    const projectId = body.projectId || 'general-general'
    chatService.update(conversation.id, { projectId })
```

- [ ] **Step 2: Update agents-page.tsx to assign wizard conversations to eyas-agents**

In `src/web/src/pages/agents/agents-page.tsx`, update the handleCreate to include projectId:

Find:
```ts
    const conv = await api.post<{ id: string }>('/conversations', {
      title: 'Agent Wizard',
    })
```

Replace with:
```ts
    const conv = await api.post<{ id: string }>('/conversations', {
      title: 'Agent Wizard',
      projectId: 'eyas-agents',
    })
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/conversations/routes.ts src/web/src/pages/agents/agents-page.tsx
git commit -m "feat: auto-assign conversations to default project, wizard to eyas-agents"
```

---

### Task 5: Write tests for seed protection

**Files:**
- Modify: `tests/modules/board/project-type-service.test.ts`
- Modify: `tests/modules/board/project-service.test.ts`

- [ ] **Step 1: Add seed protection tests to project-type-service.test.ts**

Add these tests at the end of the describe block (before the closing `})`):

```ts
  describe('seed protection', () => {
    it('prevents deleting a seed project type', () => {
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO project_types (id, name, prompt, default_stages, default_priority, source, created_at)
        VALUES ('test-seed', 'Seed Type', '', '["Done"]', 'normal', 'seed', ${now})`)
      expect(() => svc.delete('test-seed')).toThrow('Cannot delete system resource')
      expect(svc.get('test-seed')).not.toBeNull()
    })

    it('prevents updating a seed project type', () => {
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO project_types (id, name, prompt, default_stages, default_priority, source, created_at)
        VALUES ('test-seed-upd', 'Seed Type', '', '["Done"]', 'normal', 'seed', ${now})`)
      expect(() => svc.update('test-seed-upd', { name: 'Changed' })).toThrow('Cannot modify system resource')
      expect(svc.get('test-seed-upd')!.name).toBe('Seed Type')
    })

    it('allows deleting a user project type', () => {
      const pt = svc.create({ name: 'User Type' })
      svc.delete(pt.id)
      expect(svc.get(pt.id)).toBeNull()
    })
  })
```

Add `import { sql } from 'drizzle-orm'` at the top of the file if not already present.

- [ ] **Step 2: Add seed protection tests to project-service.test.ts**

Add these tests at the end of the describe block (before the closing `})`):

```ts
  describe('seed protection', () => {
    it('prevents deleting a seed project', () => {
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO projects (id, name, type_id, source, sort_order, created_at, updated_at)
        VALUES ('test-seed', 'Seed Project', null, 'seed', 0, ${now}, ${now})`)
      expect(() => svc.delete('test-seed')).toThrow('Cannot delete system resource')
      expect(svc.get('test-seed')).not.toBeNull()
    })

    it('prevents updating a seed project', () => {
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO projects (id, name, type_id, source, sort_order, created_at, updated_at)
        VALUES ('test-seed-upd', 'Seed Project', null, 'seed', 0, ${now}, ${now})`)
      expect(() => svc.update('test-seed-upd', { name: 'Changed' })).toThrow('Cannot modify system resource')
      expect(svc.get('test-seed-upd')!.name).toBe('Seed Project')
    })

    it('allows deleting a user project', () => {
      const p = svc.create({ name: 'User Project' })
      svc.delete(p.id)
      expect(svc.get(p.id)).toBeNull()
    })
  })
```

Add `import { sql } from 'drizzle-orm'` at the top of the file if not already present.

- [ ] **Step 3: Run tests**

Run: `bun test tests/modules/board/`
Expected: All tests pass including the new seed protection tests

- [ ] **Step 4: Commit**

```bash
git add tests/modules/board/project-type-service.test.ts tests/modules/board/project-service.test.ts
git commit -m "test(board): add seed protection tests for project types and projects"
```

---

### Task 6: Full verification

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: All tests pass, no regressions

- [ ] **Step 2: TypeScript check**

Run: `bunx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Verify seed data loads**

Start EYAS: `bun run src/main.ts serve`

Check logs for:
- "Seeded 5 default global stages"
- "Seeded 2 default project types"
- "Seeded 5 default projects"

Query DB:
```bash
sqlite3 data/sqlite/eyas.db "SELECT id, name, source FROM project_types ORDER BY name"
sqlite3 data/sqlite/eyas.db "SELECT id, name, type_id, source FROM projects ORDER BY name"
```

Expected: Both seed types and 5 seed projects visible with `source=seed`.
