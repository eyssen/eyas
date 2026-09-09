# Chat Module — Phase 1 Design

> EYAS 1.0 — Persistent chat with AI providers, SSE streaming, context tracking

## Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Sync mechanism | Polling (5s) in Phase 1 | Simple, reliable; WebSocket in Phase 2 |
| File attachments | Phase 2 | Needs separate storage module (local + S3 archival) |
| Assignees + deadline | Phase 2 | Needs kanban board integration |
| Message persistence | Every message saved to DB | Survives restarts, multi-device ready |
| Streaming | SSE (Server-Sent Events) | Same pattern as existing `/model/stream` |
| Default provider/model | `is_default` flag on `provider_config` + `default_model` column | One default provider, one default model per provider |
| Context tracking | Sum of `tokens_in + tokens_out` from conversation messages vs model `contextWindow` | Accurate, no extra tokenization needed |
| Chat display | Central dialog (like Provider panel) opened from Chats list | Consistent with existing UI patterns |
| Title generation | Auto-generated from first user message via AI, editable | User can override anytime |

## Database

### conversations table

```sql
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'idle',  -- idle | working | waiting | archived | deleted
  provider_id TEXT,                      -- selected provider for this conversation
  model_id TEXT,                         -- selected model for this conversation
  user_id TEXT NOT NULL,
  tokens_used INTEGER NOT NULL DEFAULT 0, -- running total of tokens consumed
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Status values:
- `idle` — no active processing
- `working` — AI is currently generating a response
- `waiting` — AI asked a question / needs user input
- `archived` — hidden from active list but accessible
- `deleted` — soft-deleted, not visible anywhere (permanent delete later)

### conversation_messages table

```sql
CREATE TABLE IF NOT EXISTS conversation_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL,          -- 'user' | 'assistant' | 'system'
  content TEXT NOT NULL,
  model TEXT,                  -- which model generated this (NULL for user messages)
  provider TEXT,               -- which provider was used
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
```

### provider_config additions

Add two columns to existing `provider_config` table:

```sql
ALTER TABLE provider_config ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_config ADD COLUMN default_model TEXT;
```

- `is_default` — only one provider can be default (enforced in code)
- `default_model` — the model ID to use by default for this provider (e.g. `claude-sonnet-4-5-20250514`)

## Backend API

### Conversation CRUD

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/chat/conversations` | List conversations (excludes `deleted`, query param `?status=` for filtering) |
| POST | `/api/v1/chat/conversations` | Create new conversation (optional: `title`, `provider_id`, `model_id`) |
| GET | `/api/v1/chat/conversations/:id` | Get conversation with messages |
| PATCH | `/api/v1/chat/conversations/:id` | Update title, status, provider_id, model_id |
| DELETE | `/api/v1/chat/conversations/:id` | Soft-delete (sets status to `deleted`) |

### Messaging + Streaming

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/chat/conversations/:id/messages` | Send message + stream AI response via SSE |

#### POST /conversations/:id/messages

Request body:
```json
{
  "content": "Hello, help me with...",
  "provider": "openrouter",     // optional, overrides conversation default
  "model": "anthropic/claude-sonnet-4-5"  // optional, overrides conversation default
}
```

Response: SSE stream with these event types:
```
data: {"type":"text","text":"Hello! I'd be happy"}
data: {"type":"text","text":" to help you with..."}
data: {"type":"done","message":{"id":42,"role":"assistant","content":"Hello! I'd be happy to help you with...","tokens_in":15,"tokens_out":23,"model":"anthropic/claude-sonnet-4-5","provider":"openrouter"},"conversation":{"tokens_used":38,"status":"idle"}}
data: {"type":"error","error":"Provider returned an error"}
data: {"type":"title","title":"Help with project setup"}
```

Flow:
1. Save user message to `conversation_messages`
2. Set conversation status to `working`
3. Build message history from `conversation_messages` table
4. Call `gateway.stream()` with provider/model
5. Stream text chunks to client via SSE
6. On stream complete:
   - Save assistant message to `conversation_messages`
   - Update `conversations.tokens_used` (cumulative)
   - Set status back to `idle`
   - If no title yet, generate one in background (small model call)
7. On error: set status to `idle`, send error event

### Default Provider/Model

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/model/defaults` | Get default provider + model |
| PUT | `/api/v1/model/defaults` | Set default provider + model |

PUT body:
```json
{
  "providerId": "openrouter",
  "modelId": "anthropic/claude-sonnet-4-5"
}
```

## Frontend

### Sidebar Changes

Add to the left sidebar navigation:

```
NAVIGATION
  Dashboard
  + New Chat        ← button, creates conversation + opens it
  Chats             ← link to /chats list page
  Providers
  Secrets
  Users
PINNED
  Tasks later...
```

"New Chat" is a **button** (not a link) — it immediately:
1. POST `/chat/conversations` to create
2. Opens the chat dialog with the new conversation

### Chats List Page (`/chats`)

Shows all non-deleted conversations as a list:

| Column | Content |
|--------|---------|
| Status dot | Color-coded: grey (idle), blue pulsing (working), yellow (waiting), muted (archived) |
| Title | Conversation title (or "Untitled" if none) |
| Provider/Model | Small badge showing which model |
| Last message | Preview of last message (truncated) |
| Updated | Relative time (e.g. "2 minutes ago") |

Filters: All / Active / Archived
Click opens the chat dialog.

### Chat Dialog

Central modal dialog (like Provider panel), but **larger** — 70% width, 90% height.

Layout (top to bottom):

```
┌──────────────────────────────────────────────────────┐
│ [Context Bar ████████████░░░░░░░░░░░ 45%]            │ ← progress bar
│                                                       │
│ Title (editable)                    [Provider ▾][Model ▾] │
│ Status: idle                                    [X]  │
├──────────────────────────────────────────────────────┤
│                                                       │
│  User: Hello, can you help me...                     │
│                                                       │
│  Assistant: Of course! I'd be happy to help.         │
│  Here's what I suggest...                            │
│                                                       │
│  User: That sounds good, let's proceed.              │
│                                                       │
│  Assistant: Great! Let me start by...                │
│  ████ (streaming...)                                  │
│                                                       │
├──────────────────────────────────────────────────────┤
│ [📎] [                                        ] [↑]  │
│      [  Multi-line input area                 ]      │
│      [  Shift+Enter for newline               ]      │
│      [  Enter to send                         ]      │
└──────────────────────────────────────────────────────┘
```

#### Context Bar (top)

Thin progress bar showing token usage:
- **Width** = `tokens_used / contextWindow * 100`%
- **Color**: Green (0–50%), Yellow (50–75%), Red (75–100%)
- **Tooltip**: "12,450 / 200,000 tokens (6.2%)"

#### Header

- **Title**: Editable inline (click to edit, blur to save via PATCH)
- **Provider dropdown**: Lists all active providers
- **Model dropdown**: Lists enabled models for selected provider
- **Status**: Badge showing current status
- **Close button**: X

#### Message List

- User messages: right-aligned, slightly different background
- Assistant messages: left-aligned, with markdown rendering
- System messages: centered, muted
- Streaming indicator: pulsing cursor at end of assistant message
- Auto-scroll to bottom on new messages

#### Input Area

- **Multi-line textarea** (3 rows default, max 10 rows auto-expand)
- **Enter** sends message
- **Shift+Enter** adds newline
- **File attach button** (📎) — disabled in Phase 1, shows tooltip "Coming soon"
- **Send button** (↑ arrow) — disabled when empty or when status is `working`

### Provider Panel Addition

In the provider slideout/dialog panel, add a "Set as Default" button and a "Default Model" dropdown:

```
┌─ Provider Panel ─────────────────────┐
│ OpenRouter                  [On] [X] │
│                                      │
│ API Key: ●●●●●●●●        [Key saved]│
│ [Save] [Remove Key]                  │
│                                      │
│ ─── Default Settings ────────────    │
│ [★ Set as Default Provider]          │
│ Default Model: [claude-sonnet-4-5 ▾] │
│                                      │
│ ─── Models (350) ────────────        │
│ ...                                  │
└──────────────────────────────────────┘
```

## New Dependencies

None — uses existing Hono SSE streaming, Drizzle ORM, React, shadcn/ui.

## Module Structure

```
src/modules/chat/
  index.ts              ← Module manifest, table creation
  schema.ts             ← Drizzle schema
  conversation-service.ts ← CRUD + business logic
  routes.ts             ← API endpoints
  stream-handler.ts     ← SSE streaming logic

src/web/src/pages/
  chats/
    chats-page.tsx       ← Conversation list
    chat-dialog.tsx      ← Main chat dialog
    chat-header.tsx      ← Title, provider/model selectors, status
    chat-messages.tsx    ← Message list with auto-scroll
    chat-input.tsx       ← Multi-line input with send
    context-bar.tsx      ← Token usage progress bar
```

## Not In Scope (Phase 2)

- WebSocket real-time sync (polling for now)
- File attachments + storage module
- Assignees + deadline fields
- Kanban board integration
- Tool use display in chat
- Message editing / deletion
- Conversation branching / forking
- Export conversation
