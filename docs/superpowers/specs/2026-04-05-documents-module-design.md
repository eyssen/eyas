# Documents Module Design

> File management with pluggable storage providers, polymorphic entity binding, lifecycle-based retention, and full frontend integration.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Provider pattern | Internal registry (not submodules) | Providers cooperate (primary+secondary), don't alternate |
| Entity binding | Polymorphic (`owner_module` + `owner_id`) | Any module can attach files |
| Thumbnails | Interface defined, implementation deferred | YAGNI — add when needed |
| Retention | Automatic, lifecycle + time-based, Settings UI | Configurable per stage/event |
| Upload limits | Global default + per-module override | Knowledge needs larger files than conversations |
| Frontend | Standalone Documents page + inline attachment | Full experience from day one |
| S3 client (Bun) | `Bun.S3Client` (built-in) | Zero dep, native, 5x faster |
| S3 client (Node) | `s3mini` | MIT, 14kB, zero dep, B2 tested |
| Backblaze B2 API | S3-compatible (not native) | Portable across AWS/R2/MinIO/B2 |

## 1. Storage Provider Interface

```typescript
interface StorageProvider {
  id: string                          // 'local' | 's3'
  type: 'primary' | 'secondary'

  put(key: string, data: Buffer | ReadableStream, meta: FileMeta): Promise<void>
  get(key: string): Promise<{ data: ReadableStream; meta: FileMeta } | null>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  getUrl(key: string, expiresIn?: number): Promise<string | null>
}

interface FileMeta {
  filename: string
  mimeType: string
  sizeBytes: number
}

interface ThumbnailProvider {
  supports(mimeType: string): boolean
  generate(data: Buffer, options: ThumbnailOptions): Promise<Buffer>
}

interface ThumbnailOptions {
  maxWidth: number
  maxHeight: number
  format: 'webp' | 'jpeg'
}
```

### Providers

| Provider | Type | Backend | Key format |
|---|---|---|---|
| `local` | primary | `node:fs` / `Bun.file()` | Hash-sharded: `V1/St/V1StGXR8_Z5jdHi6B-myT.pdf` |
| `s3` | secondary | `Bun.S3Client` / `s3mini` | Flat: `documents/{nanoid}.{ext}` |

### Data Flow

```
Upload:   File → validate → primary.put() → DB record → bus.emit('uploaded') → sync worker → secondary.put()
Download: primary.get() → found? return : secondary.get() → primary.put() (cache) → return
Delete:   DB soft-delete → primary.delete() → secondary.delete() → bus.emit('deleted')
```

## 2. Database Schema

```sql
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,                          -- nanoid
  
  -- Polymorphic binding
  owner_module TEXT,                            -- 'conversations' | 'knowledge' | 'memory' | null
  owner_id TEXT,                                -- entity ID or null (standalone)
  
  -- File data
  filename TEXT NOT NULL,                       -- original filename
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  checksum_sha256 TEXT NOT NULL,                -- integrity + deduplication
  
  -- Storage state
  storage_key TEXT NOT NULL UNIQUE,             -- nanoid.ext — same key for all providers
  local_path TEXT,                              -- null if retention cleaned
  remote_provider TEXT,                         -- 's3' | null
  remote_status TEXT DEFAULT 'pending',         -- 'pending' | 'synced' | 'error' | 'not_configured'
  
  -- Thumbnail (interface ready, implementation deferred)
  thumbnail_key TEXT,
  
  -- Retention
  retain_local_until TEXT,                      -- ISO datetime, null = forever
  
  -- Metadata
  metadata TEXT DEFAULT '{}',                   -- JSON — module-specific extra data
  
  -- Audit
  created_by TEXT REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  deleted_at TEXT                               -- soft delete
);

CREATE INDEX idx_documents_owner ON documents(owner_module, owner_id);
CREATE INDEX idx_documents_remote_status ON documents(remote_status);
CREATE INDEX idx_documents_retention ON documents(retain_local_until) WHERE local_path IS NOT NULL;

-- Retention rules (configurable from Settings UI)
CREATE TABLE IF NOT EXISTS document_retention_rules (
  id TEXT PRIMARY KEY,                          -- nanoid
  trigger_type TEXT NOT NULL,                   -- 'time' | 'lifecycle'
  event TEXT,                                   -- 'conversation.closed' | 'conversation.stage_changed' | null
  stage TEXT,                                   -- stage name for stage_changed events | null
  condition TEXT,                               -- 'no_owner' | null
  local_days INTEGER NOT NULL,                  -- days to keep locally after trigger
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
```

## 3. REST API

```
POST   /api/v1/documents/upload          — File upload (multipart/form-data)
GET    /api/v1/documents/:id             — Get metadata
GET    /api/v1/documents/:id/download    — Download file (stream)
DELETE /api/v1/documents/:id             — Soft delete
GET    /api/v1/documents                 — List (filters: owner_module, owner_id, mime_type)

POST   /api/v1/documents/:id/attach      — Attach existing file to entity
POST   /api/v1/documents/:id/detach      — Remove binding (becomes standalone)
```

### Upload body

```
multipart/form-data:
  file: <binary>
  owner_module?: string
  owner_id?: string
  metadata?: string (JSON)
```

### Validation (every upload)

1. Size limit check (global default, module override)
2. MIME type detection (`file-type` magic number + `mime-types` extension)
3. Allowed types list (glob patterns: `image/*`, `application/pdf`, etc.)

## 4. Event Bus

```
eyas.documents.uploaded      — { documentId, ownerModule, ownerId, mimeType, sizeBytes }
eyas.documents.synced        — { documentId, remoteProvider }
eyas.documents.sync.failed   — { documentId, error }
eyas.documents.deleted       — { documentId, ownerModule, ownerId }
eyas.documents.local.cleaned — { documentId }
```

### Internal consumers

- `eyas.documents.uploaded` → sync worker starts (secondary provider upload)
- Activity module → logs upload/delete
- Search module → indexes file metadata (optional)

### External events consumed

- `eyas.conversations.stage_changed` → retention engine evaluates lifecycle rules
- `eyas.conversations.closed` → retention engine evaluates lifecycle rules

## 5. Configuration

```yaml
documents:
  storage:
    local_dir: data/documents

  limits:
    default:
      max_file_size_mb: 50
      allowed_types: ["image/*", "application/pdf", "text/*", "application/zip"]
    overrides:
      knowledge:
        max_file_size_mb: 100
        allowed_types: ["*/*"]
      conversations:
        max_file_size_mb: 25

  remote:
    enabled: false
    provider: s3
    bucket: ""
    region: ""
    endpoint: ""
    # access_key and secret_key → secrets module, NOT here

  retention:
    rules:
      - trigger: time
        local_days: 30
        condition: no_owner

      - trigger: lifecycle
        event: conversation.closed
        local_days: 14

      - trigger: lifecycle
        event: conversation.stage_changed
        stage: done
        local_days: 7

      - trigger: lifecycle
        event: conversation.stage_changed
        stage: archived
        local_days: 1

    # Safety: local file NEVER deleted if remote_status != 'synced'
    # If remote not configured: local retention does NOT apply — everything stays local

  sync:
    retry_attempts: 3
    retry_delay_seconds: 60
    batch_size: 10
```

All configurable from Settings UI (Storage, Limits, Retention tabs).

## 6. Retention Engine

### Two trigger types

**Event-based:** Bus listener watches lifecycle events.

```
eyas.conversations.stage_changed → { conversationId, newStage }
  → Match against retention rules
  → UPDATE documents SET retain_local_until = now() + rule.local_days
    WHERE owner_module = 'conversations' AND owner_id = :conversationId
```

**Time-based:** Periodic cleanup job.

```
Every N minutes:
  SELECT WHERE retain_local_until < now() AND local_path IS NOT NULL
  → Check: remote_status = 'synced'?
    → yes: delete local file, set local_path = null
    → no: SKIP (never delete without remote backup!)
  → bus.emit('eyas.documents.local.cleaned')
```

### Safety rule

Local file is NEVER deleted if `remote_status != 'synced'`. If remote is not configured (`remote.enabled: false`), local retention does not apply — everything stays local indefinitely.

## 7. Frontend

### Standalone Documents Page (`/documents`)

- Grid (cards) and List (table) view toggle
- Filters: MIME type, owner_module, date range, sync status
- Search: filename-based
- Bulk operations: multi-select → delete, download, attach
- Drag & drop upload (standalone files)
- File card click → detail panel (meta, preview, owner link, sync status)

### Inline Attachment (conversation, knowledge editor)

- Compact attachment list below entity content
- Drag & drop / file picker → auto-fills `owner_module` + `owner_id`
- Sync status icon (synced, pending, error)
- Click → download, [x] → detach (becomes standalone, does not delete)

### Components

| Component | Location | Purpose |
|---|---|---|
| `DocumentsPage` | `/documents` route | Standalone file manager |
| `DocumentGrid` | Shared | Grid/List view with filters |
| `DocumentCard` | Shared | Single file card |
| `AttachmentList` | Shared | Inline compact attachment list |
| `UploadZone` | Shared | Drag & drop + file picker + progress |
| `DocumentDetail` | Sheet/Panel | Metadata, preview, owner link |

### UI Registry

```typescript
uiRegistry.registerPage('documents', '/documents', DocumentsPage)
uiRegistry.registerSidebarItem('documents', { icon: FileIcon, label: 'Documents' })
uiRegistry.registerSettingsSection('documents', DocumentsSettings)
```

## 8. Module Structure

```
src/modules/documents/
  ├── index.ts                      # EyasModule manifest + lifecycle
  ├── schema.ts                     # DB tables
  ├── types.ts                      # StorageProvider, DocumentRecord, RetentionRule
  ├── document-service.ts           # CRUD, upload/download, validation, attach/detach
  ├── sync-service.ts               # Secondary provider sync (async worker)
  ├── retention-service.ts          # Lifecycle listener + periodic cleanup
  ├── routes.ts                     # REST API endpoints
  ├── providers/
  │   ├── local-provider.ts         # node:fs / Bun.file() — hash-sharded
  │   └── s3-provider.ts            # Bun.S3Client / s3mini
  └── tests/
      ├── document-service.test.ts
      ├── local-provider.test.ts
      ├── s3-provider.test.ts
      └── retention-service.test.ts

packages/web/src/modules/documents/
  ├── index.ts                      # UI registry registration
  ├── pages/
  │   └── DocumentsPage.tsx
  ├── components/
  │   ├── DocumentGrid.tsx
  │   ├── DocumentCard.tsx
  │   ├── AttachmentList.tsx
  │   ├── UploadZone.tsx
  │   └── DocumentDetail.tsx
  ├── hooks/
  │   ├── use-documents.ts          # TanStack Query
  │   └── use-upload.ts             # Upload state + progress
  └── stores/
      └── documents-store.ts        # Zustand
```

## 9. Dependencies

### New npm packages (backend)

| Package | Version | License | Purpose |
|---|---|---|---|
| `s3mini` | latest | MIT | S3 client (Node.js fallback) |
| `file-type` | ^22.0 | MIT | Magic number file type detection |
| `mime-types` | ^3.0 | MIT | Extension → MIME mapping |
| `nanoid` | ^5.0 | MIT | File ID + storage key generation |

### Already available

- `node:fs/promises` / `Bun.file()` — local storage
- `node:crypto` — SHA-256 checksum
- `Bun.S3Client` — native S3 client (Bun runtime)

### Frontend

No new dependencies — shadcn/ui + TanStack Query + Zustand already present.

### Module dependencies

```typescript
dependencies: ['auth', 'secrets']     // auth: user context, secrets: S3 credentials
optional: ['search', 'activity']      // search: FTS indexing, activity: audit log
```

## 10. Error Handling

| Scenario | Behavior |
|---|---|
| Upload exceeds size limit | 413 Payload Too Large, file rejected |
| MIME type not allowed | 415 Unsupported Media Type, file rejected |
| Magic number mismatch (extension says .pdf, content is .exe) | 415, file rejected |
| Primary provider write fails | 500, upload fails, no DB record created |
| Secondary sync fails | DB `remote_status = 'error'`, retry queue, bus event |
| Download — file not in primary | Fetch from secondary, cache locally, return |
| Download — file in neither provider | 404 Not Found |
| Retention cleanup — remote not synced | SKIP, do not delete local |
| S3 credentials missing | Secondary provider disabled, warning logged |
