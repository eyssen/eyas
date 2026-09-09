# Board Module Phase 1 — Design Spec

**Date:** 2026-04-01
**Branch:** feat/enhanced-providers
**Prerequisites:** Chat → Conversations rename (Part A), then Board module (Part B)

## Approach

Sequential: (A) rename chat→conversations everywhere, then (B) build board module on top.

---

## Part A: Chat → Conversations Rename

Pure refactor — no functional changes.

### Backend

- `src/modules/chat/` → `src/modules/conversations/`
- Module ID: `chat` → `conversations`
- `chatModule` → `conversationsModule`
- `ctx.chat` → `ctx.conversations` (ModuleContext type updated)
- Bootstrap import updated
- `createChatRoutes` → `createConversationRoutes`
- `createConversationService` — already correct name, no change

### API Routes

| Before | After |
|--------|-------|
| `GET /api/v1/chat/conversations` | `GET /api/v1/conversations` |
| `POST /api/v1/chat/conversations` | `POST /api/v1/conversations` |
| `GET /api/v1/chat/conversations/:id` | `GET /api/v1/conversations/:id` |
| `PATCH /api/v1/chat/conversations/:id` | `PATCH /api/v1/conversations/:id` |
| `DELETE /api/v1/chat/conversations/:id` | `DELETE /api/v1/conversations/:id` |
| `POST /api/v1/chat/conversations/:id/messages` | `POST /api/v1/conversations/:id/messages` |

DB tables unchanged (conversations, conversation_messages — already correct names).

### Frontend

- `src/web/src/pages/chats/` → `src/web/src/pages/conversations/`
- File renames: `chat-dialog.tsx` → `conversation-dialog.tsx`, etc.
- `src/web/src/stores/chat-store.ts` → `conversation-store.ts`
- `useChatStore` → `useConversationStore`
- Route: `/chats` → `/conversations`
- `src/web/src/routes/chats.tsx` → `conversations.tsx`
- Sidebar labels: "New Chat" → "New Conversation", "Chats" → "Conversations"
- API calls: `/chat/conversations` → `/conversations`

### Tests

- `tests/modules/chat/` → `tests/modules/conversations/`
- Update import paths and route paths in test files

---

## Part B: Board Module

### Entity Hierarchy

```
ProjectType → Project → Stage → Conversation
```

A conversation with `projectId` + `stageId` appears on the kanban board.
A conversation without those fields remains a plain chat.

### Data Model

#### project_types

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | nanoid |
| name | TEXT NOT NULL | e.g. "Bug Tracker", "Feature Dev" |
| prompt | TEXT DEFAULT '' | system prompt template |
| default_stages | TEXT (JSON) | `["Backlog","In Progress","Done"]` |
| default_priority | TEXT DEFAULT 'normal' | low/normal/high/urgent |
| color | TEXT | hex color |
| icon | TEXT | lucide icon name |
| indexed_sources | TEXT (JSON) | source code paths |
| skills | TEXT (JSON) | skill names |
| permissions | TEXT (JSON) | CASL rules |
| created_at | TEXT NOT NULL | ISO timestamp |

#### projects

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | nanoid |
| name | TEXT NOT NULL | |
| description | TEXT | |
| type_id | TEXT REFERENCES project_types(id) | nullable (standalone project) |
| prompt | TEXT | "+" prefix = extend parent |
| indexed_sources | TEXT (JSON) | override |
| skills | TEXT (JSON) | override |
| permissions | TEXT (JSON) | override |
| color | TEXT | |
| sort_order | INTEGER DEFAULT 0 | |
| created_at | TEXT NOT NULL | |
| updated_at | TEXT NOT NULL | |

#### stages

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | nanoid |
| project_id | TEXT NOT NULL REFERENCES projects(id) | |
| name | TEXT NOT NULL | |
| color | TEXT | |
| sort_order | INTEGER DEFAULT 0 | |
| is_closed | INTEGER DEFAULT 0 | closed stage (e.g. "Done") |
| is_hidden | INTEGER DEFAULT 0 | hidden from board |
| is_folded | INTEGER DEFAULT 0 | collapsed |
| bot_listen | INTEGER DEFAULT 0 | Phase 2 |
| auto_assignee_id | TEXT | Phase 2 |
| created_at | TEXT NOT NULL | |

#### conversations table extension (ALTER TABLE)

New columns added to existing `conversations` table:

| Column | Type | Notes |
|--------|------|-------|
| project_id | TEXT REFERENCES projects(id) | NULL = plain chat |
| stage_id | TEXT REFERENCES stages(id) | NULL = plain chat |
| priority | TEXT DEFAULT 'normal' | low/normal/high/urgent |
| pinned | INTEGER DEFAULT 0 | |
| position | REAL DEFAULT 0 | fractional indexing for ordering |
| due_date | TEXT | ISO date |
| prompt | TEXT | lowest level of inheritance chain |
| assignees | TEXT (JSON) | `["userId1","userId2"]` |
| tags | TEXT (JSON) | `["bug","frontend"]` |

#### Indexes

- `conversations(project_id, stage_id)` — kanban query
- `conversations(project_id, position)` — ordering
- `stages(project_id, sort_order)` — stage ordering

### Prompt Inheritance

```
ProjectType.prompt → Project.prompt → Conversation.prompt
```

- Empty/null = inherits parent
- `"+"` prefix = extends (`parent + "\n" + child`)
- Other = overrides

Pure function from v0.5: `resolvePromptChain(typePrompt, projectPrompt, convPrompt)`

### Module Structure

```
src/modules/board/
  index.ts                        — EyasModule (id: 'board', depends: ['conversations'])
  schema.ts                       — Drizzle: project_types, projects, stages
  services/
    project-type-service.ts       — CRUD + default stages validation
    project-service.ts            — CRUD + auto-stage creation from type
    stage-service.ts              — CRUD + reorder
    prompt-service.ts             — resolvePromptChain()
  routes.ts                       — all board endpoints
```

The conversations module does NOT depend on board. Board knows about conversations and decorates it.

### API Endpoints

#### Project Types

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/project-types` | List all |
| POST | `/api/v1/project-types` | Create |
| PATCH | `/api/v1/project-types/:id` | Update |
| DELETE | `/api/v1/project-types/:id` | Delete (if no projects reference it) |

#### Projects

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/projects` | List all |
| POST | `/api/v1/projects` | Create (auto-stages from type) |
| GET | `/api/v1/projects/:id` | Get with stages |
| PATCH | `/api/v1/projects/:id` | Update |
| DELETE | `/api/v1/projects/:id` | Delete (cascade stages, unlink conversations) |

#### Board View (nested)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/projects/:id/board` | Stages + conversations (full kanban data, 1 request) |
| POST | `/api/v1/projects/:id/conversations` | New conversation in project (auto stageId = first stage) |

#### Stages

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/projects/:id/stages` | Add stage |
| PATCH | `/api/v1/stages/:id` | Update (name, color, sortOrder, flags) |
| DELETE | `/api/v1/stages/:id` | Delete (conversations unlinked) |
| PATCH | `/api/v1/projects/:id/stages/reorder` | Bulk reorder `{ids: [...]}` |

#### Conversation Board Actions

| Method | Path | Description |
|--------|------|-------------|
| PATCH | `/api/v1/conversations/:id` | Extended with stageId, priority, position, pinned, dueDate, tags, assignees |
| PATCH | `/api/v1/conversations/:id/move` | Drag & drop: `{stageId, position}` — optimized endpoint |

#### Board View Response

```typescript
// GET /api/v1/projects/:id/board
{
  project: { id, name, color, prompt, typeId },
  stages: [
    {
      id, name, color, sortOrder, isClosed, isFolded,
      conversations: [
        { id, title, priority, pinned, position, dueDate, assignees, tags, tokensUsed, status }
      ]
    }
  ]
}
```

### ModuleContext Extension

```typescript
ctx.board: {
  projectTypes: ProjectTypeService
  projects: ProjectService
  stages: StageService
  promptService: PromptService
}
```

### Frontend

#### New Files

```
src/web/src/pages/board/
  board-page.tsx              — main page: project selector + kanban
  board-column.tsx            — stage column (droppable)
  board-card.tsx              — conversation card (draggable)
  board-header.tsx            — project name, filters, "+ New Conversation" button
  board-card-detail.tsx       — conversation detail panel (slide-over or dialog)
  project-settings.tsx        — project/stage settings dialog

src/web/src/stores/board-store.ts   — Zustand store
src/web/src/routes/board.tsx        — TanStack route
```

#### Sidebar

```
Navigation
  ├─ Dashboard
  ├─ Conversations       (renamed from Chats)
  ├─ Board               NEW (KanbanSquare icon)
  ├─ Providers
  ├─ Secrets
  └─ Users
```

"Pinned" section placeholder replaced with project quick-nav list when projects exist.

#### Kanban Board

- @dnd-kit/core + @dnd-kit/sortable for drag & drop
- Columns = stages (by sortOrder)
- Cards = conversations (by position, REAL fractional indexing)
- `isFolded` stage → collapsed column (header + count only)
- `isClosed` stage → grey background
- `isHidden` stage → not rendered
- Drag & drop → `PATCH /conversations/:id/move` `{stageId, position}`
- Fractional indexing: first card = 1.0, between cards = (prev + next) / 2, end = last + 1.0

#### Card Display

- Title, priority badge (color-coded), assignee avatar(s), due date, tag badges
- Priority colors: red (urgent), orange (high), blue (normal), grey (low)

#### Card Click Behavior

Click → navigate to `/conversations?id=<convId>` — existing conversation dialog opens. Board fields (stage, priority, tags) shown in an extra bar above chat header.

#### Board Store (Zustand)

```typescript
interface BoardState {
  currentProjectId: string | null
  stages: StageWithConversations[]
  isLoading: boolean

  setProject: (id: string) => void
  fetchBoard: (projectId: string) => Promise<void>
  moveConversation: (convId: string, stageId: string, position: number) => void  // optimistic
  addConversation: (stageId: string, title: string) => Promise<void>
}
```

#### macOS Vibrancy Style

- Columns: `vibrancy` background, rounded corners
- Cards: `card` style (shadow, border), hover glow
- Drag overlay: slightly transparent, elevated shadow
- Priority colors: red (urgent), orange (high), blue (normal), grey (low)

### Migration Strategy

No formal migration framework. Board module `onRegister`:

1. `CREATE TABLE IF NOT EXISTS project_types (...)`
2. `CREATE TABLE IF NOT EXISTS projects (...)`
3. `CREATE TABLE IF NOT EXISTS stages (...)`
4. ALTER TABLE conversations — add new columns (try/catch per column, SQLite has no IF NOT EXISTS for ALTER):

```typescript
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
  try { ctx.db.run(sql`ALTER TABLE conversations ADD COLUMN ${sql.raw(col.name)} ${sql.raw(col.def)}`) }
  catch { /* column already exists */ }
}
```

5. `CREATE INDEX IF NOT EXISTS ...`

### Tests

```
tests/modules/board/
  project-type-service.test.ts    — CRUD, default stages validation
  project-service.test.ts         — CRUD, auto-stage creation from type
  stage-service.test.ts           — CRUD, reorder, cascade behavior
  prompt-service.test.ts          — resolvePromptChain (pure function, edge cases)
  routes.test.ts                  — API endpoints, board view, move endpoint
```

Test strategy:
- Service tests: in-memory SQLite (existing `test-db.ts` helper)
- Route tests: Hono test client, auth mock
- Prompt service: pure unit test, no DB dependency
- Fractional indexing edge cases for drag & drop position

### Out of Scope (Phase 2)

- botListen / autoAssigneeId logic (fields exist but unused)
- WebSocket sync (kanban board uses polling in Phase 1)
- Automation / rule engine
- Advanced filters / archive view
- Conversation ↔ board title auto-sync
