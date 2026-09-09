# Conversation Panel Redesign — Design Spec

> **Date:** 2026-04-02
> **Status:** Approved
> **Approach:** Modular, bottom-up (B)

## Overview

Redesign the conversation panel from a modal overlay to a full-screen view with resizable split layout. Add Odoo-inspired chatter, activity module, and proper tag system. Board fields (project, stage, assignees, due date, tags) become directly editable from the conversation view.

## Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Layout | Full-screen, not modal | Better workspace, room for chatter |
| Split | Resizable 2/3 + 1/3 | Adjustable, localStorage persisted |
| Tags | Real entities (tags + tag_categories tables) | v0.5 pattern, colors, categories, reusable |
| Activities | Full Odoo-style, own module | Foundation for scheduler, notifications, agents |
| Chatter | Own module, polymorphic | Reusable for knowledge, board, any entity |
| Tracking in chatter | Both human and AI actions | Single timeline for all changes |
| Attachments tab | Placeholder (Documents module later) | No point building twice |
| Permissions tab | Placeholder (Security module later) | CASL already handles project-level |
| Audit Log tab | Placeholder (Audit module later) | Needs proper design |
| Bus events for tracking | Loose coupling via event bus | Modules don't depend on chatter directly |

---

## 1. Tag System

**Location:** `src/modules/board/` (extends existing board module)

### Schema

```sql
CREATE TABLE tag_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#8b949e',
  sort_order INTEGER DEFAULT 0,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#8b949e',
  category_id TEXT REFERENCES tag_categories(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE conversation_tags (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (conversation_id, tag_id)
);
```

### Migration

Remove JSON `tags` field from `conversations` table. Migrate existing JSON string arrays into `tags` + `conversation_tags` rows (create tags on-the-fly with default color).

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/tags?projectId=` | List tags (optional project filter) |
| POST | `/api/v1/tags` | Create tag |
| PATCH | `/api/v1/tags/:id` | Update tag |
| DELETE | `/api/v1/tags/:id` | Delete tag |
| GET | `/api/v1/tag-categories?projectId=` | List categories |
| POST | `/api/v1/tag-categories` | Create category |
| PATCH | `/api/v1/tag-categories/:id` | Update category |
| DELETE | `/api/v1/tag-categories/:id` | Delete category |
| PUT | `/api/v1/conversations/:id/tags` | Set tags (array of tagIds) |

### Frontend

- **Project Settings → Tags panel:** Category CRUD (name, color, sort), Tag CRUD within categories (name, color), drag reorder
- **Conversation fields bar → Tag picker:** Autocomplete dropdown, shows category grouping, "Create new" inline option

---

## 2. Activity Module

**Location:** `src/modules/activity/` (standalone module)

### Schema

```sql
CREATE TABLE activity_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT,
  category TEXT NOT NULL DEFAULT 'default'
    CHECK (category IN ('default', 'upload_file', 'phonecall', 'meeting')),
  decoration TEXT NOT NULL DEFAULT 'normal'
    CHECK (decoration IN ('normal', 'warning', 'danger')),
  delay_days INTEGER DEFAULT 0,
  delay_unit TEXT DEFAULT 'days'
    CHECK (delay_unit IN ('days', 'weeks', 'months')),
  trigger_next_type_id TEXT REFERENCES activity_types(id) ON DELETE SET NULL,
  suggest_next_type_id TEXT REFERENCES activity_types(id) ON DELETE SET NULL,
  default_user_id TEXT,
  summary_template TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  type_id TEXT NOT NULL REFERENCES activity_types(id) ON DELETE CASCADE,
  res_model TEXT NOT NULL,
  res_id TEXT NOT NULL,
  summary TEXT,
  note TEXT,
  user_id TEXT NOT NULL,
  created_by_id TEXT NOT NULL,
  date_deadline TEXT NOT NULL,
  done_at TEXT,
  feedback TEXT,
  automated INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_activities_record ON activities(res_model, res_id);
CREATE INDEX idx_activities_user ON activities(user_id, date_deadline);
```

### Seed Activity Types

| Name | Icon | Category | Decoration |
|------|------|----------|------------|
| To Do | ✅ | default | normal |
| Code Review | 🔍 | default | warning |
| Follow Up | 📌 | default | normal |
| Upload Document | 📎 | upload_file | normal |
| Meeting | 📅 | meeting | normal |
| Call | 📞 | phonecall | normal |

### Service: `createActivityService(db)`

```typescript
interface ActivityService {
  schedule(input: ScheduleActivityInput): Activity
  markDone(id: string, feedback?: string): Activity       // + chain trigger_next
  markCancel(id: string): void
  listByRecord(resModel: string, resId: string): Activity[]
  listByUser(userId: string, filter?: ActivityFilter): Activity[]
  getStats(userId: string): { overdue: number; today: number; planned: number }
  listTypes(): ActivityType[]
}
```

**State computation:** `overdue` if deadline < today, `today` if deadline = today, `planned` if deadline > today. Computed at query time, not stored.

**Chaining:** When `markDone()` is called and the activity type has `triggerNextTypeId`, a new activity is automatically created with the deadline calculated from the next type's `delayDays` + `delayUnit`.

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/activities?resModel=&resId=&userId=` | List with filters |
| POST | `/api/v1/activities` | Schedule activity |
| PATCH | `/api/v1/activities/:id` | Update activity |
| POST | `/api/v1/activities/:id/done` | Mark done + optional feedback |
| POST | `/api/v1/activities/:id/cancel` | Cancel activity |
| GET | `/api/v1/activity-types` | List all types |

---

## 3. Chatter Module

**Location:** `src/modules/chatter/` (standalone module)

### Schema

```sql
CREATE TABLE chatter_messages (
  id TEXT PRIMARY KEY,
  res_model TEXT NOT NULL,
  res_id TEXT NOT NULL,
  author_id TEXT,
  message_type TEXT NOT NULL DEFAULT 'comment'
    CHECK (message_type IN ('comment', 'note', 'tracking')),
  body TEXT NOT NULL,
  parent_id TEXT REFERENCES chatter_messages(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_chatter_record ON chatter_messages(res_model, res_id, created_at);

CREATE TABLE chatter_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL REFERENCES chatter_messages(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT
);

CREATE TABLE chatter_followers (
  id TEXT PRIMARY KEY,
  res_model TEXT NOT NULL,
  res_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  subtypes TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(res_model, res_id, user_id)
);
```

### Service: `createChatterService(db, bus)`

```typescript
interface ChatterService {
  postMessage(resModel: string, resId: string, input: PostMessageInput): ChatterMessage
  logTracking(resModel: string, resId: string, input: TrackingInput): ChatterMessage
  listMessages(resModel: string, resId: string, opts?: ListOpts): ChatterMessage[]
  addFollower(resModel: string, resId: string, userId: string, subtypes?: string[]): void
  removeFollower(resModel: string, resId: string, userId: string): void
  getFollowers(resModel: string, resId: string): ChatterFollower[]
}
```

### Bus Event Integration

The chatter module listens for tracking events on the event bus:

```typescript
// Any module emits:
bus.emit('record:updated', {
  resModel: 'conversation',
  resId: 'abc123',
  changes: [
    { field: 'stage', oldValue: 'Backlog', newValue: 'In Progress' },
    { field: 'priority', oldValue: 'normal', newValue: 'high' },
  ],
  authorId: 'user-1',  // or 'ai' for AI actions
})

// Chatter module subscribes and creates tracking messages automatically
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/chatter/:resModel/:resId/messages` | List messages |
| POST | `/api/v1/chatter/:resModel/:resId/messages` | Post message or note |
| GET | `/api/v1/chatter/:resModel/:resId/followers` | List followers |
| POST | `/api/v1/chatter/:resModel/:resId/followers` | Add follower |
| DELETE | `/api/v1/chatter/:resModel/:resId/followers/:userId` | Remove follower |

---

## 4. Conversation Panel Frontend

### Route Change

- Remove: modal-based `ConversationDialog`
- Add: `/conversations/:id` route → `ConversationPage` component
- `/conversations` list: click navigates to `/conversations/:id`
- Board card click: navigates to `/conversations/:id`

### Layout

```
┌──────────────────────────────────────────────────────────┐
│ ConversationTopBar                                        │
│ [Title editable] [Status] [Priority] ···· [Provider] [Model] │
├──────────────────────────────────┬──┬─────────────────────┤
│ ConversationFields               │  │ ChatterPanel        │
│ Project│Stage│Assignees│Due│Tags  │  │ [Msgs│Activities│   │
├──────────────────────────────────┤  │  Attachments]       │
│ [Chat] [Permissions] [Audit Log] │◂▸│─────────────────────│
├──────────────────────────────────┤  │ [Send msg / Log note]│
│                                  │  │─────────────────────│
│ Active tab content               │  │ Chatter timeline    │
│ (Chat: messages + streaming)     │  │ (msgs + notes +     │
│ (Permissions: placeholder)       │  │  tracking mixed)    │
│ (Audit Log: placeholder)         │  │                     │
├──────────────────────────────────┤  │─────────────────────│
│ Chat input (Chat tab only)       │  │ Chatter input       │
└──────────────────────────────────┴──┴─────────────────────┘
```

### Resizable Split

- Library: `react-resizable-panels` (MIT, ~3KB gzipped)
- Default ratio: 66% / 34%
- Min sizes: left 30%, right 20%
- Persist to localStorage key: `eyas-conversation-split`

### Components

| Component | Location | Description |
|-----------|----------|-------------|
| `ConversationPage` | `pages/conversations/conversation-page.tsx` | Main container with PanelGroup |
| `ConversationTopBar` | `pages/conversations/conversation-top-bar.tsx` | Title, status, priority, provider, model |
| `ConversationFields` | `pages/conversations/conversation-fields.tsx` | Board fields bar: project, stage, assignees, due, tags |
| `ConversationTabs` | `pages/conversations/conversation-tabs.tsx` | Tab switcher + content routing |
| `ConversationChat` | `pages/conversations/conversation-chat.tsx` | Existing chat (refactored from dialog) |
| `ChatterPanel` | `pages/conversations/chatter-panel.tsx` | Right panel wrapper |
| `ChatterMessages` | `components/chatter/chatter-messages.tsx` | Timeline (shared component) |
| `ChatterComposer` | `components/chatter/chatter-composer.tsx` | Send/Note toggle + input (shared) |
| `ActivityList` | `components/activity/activity-list.tsx` | Grouped activities (shared component) |
| `TagPicker` | `components/tags/tag-picker.tsx` | Autocomplete tag selector (shared) |
| `TagEditor` | `components/tags/tag-editor.tsx` | Tag CRUD in project settings (shared) |

**Shared components** (`components/chatter/`, `components/activity/`, `components/tags/`) are reusable — knowledge pages or any future entity can embed them via `resModel` + `resId`.

### Board Column Enhancement

- "+" button at bottom of each board column
- Creates new conversation with pre-set `projectId` + `stageId`
- Opens inline title input, Enter navigates to `/conversations/:id`

---

## 5. Implementation Order

1. **Tag system** — schema, migration, service, API, tag editor UI, tag picker component
2. **Activity module** — schema, service, API, seed types
3. **Chatter module** — schema, service, bus integration, API
4. **Conversation panel frontend** — route change, layout, resizable split, fields bar, tabs, chatter panel, activity list, placeholder tabs, board "+" button

Each step is independently testable and deployable.

---

## 6. Dependencies

- `react-resizable-panels` — MIT, resizable split layout
- No other new dependencies needed

## 7. Out of Scope

- Attachments upload/storage (Documents module)
- Permissions tab content (Security module)
- Audit log tab content (Audit module)
- Email sending from chatter messages
- Activity reminder notifications (Notifications module)
- Chatter subtype-based notification filtering
