# Documents Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** File management module with pluggable storage providers (local + S3/B2), polymorphic entity binding, lifecycle-based retention, and full frontend (standalone page + inline attachment).

**Architecture:** Internal provider registry pattern — `DocumentService` orchestrates a primary (local FS) and optional secondary (S3-compatible) provider through a shared `StorageProvider` interface. Retention engine listens to bus events (conversation lifecycle) and runs periodic cleanup. Frontend uses Zustand store + custom hooks for upload state, TanStack Router for the Documents page.

**Tech Stack:** Bun.S3Client (native S3), s3mini (Node fallback), file-type (magic number detection), mime-types (extension mapping), nanoid (file IDs). Frontend: React 19, shadcn/ui, Zustand, TanStack Router, lucide-react.

---

## File Structure

### Backend (`src/modules/documents/`)

| File | Responsibility |
|---|---|
| `types.ts` | StorageProvider interface, DocumentRecord, RetentionRule, event types |
| `schema.ts` | `documents` + `document_retention_rules` table creation |
| `providers/local-provider.ts` | Local filesystem storage with hash-sharded paths |
| `providers/s3-provider.ts` | S3-compatible storage (Bun.S3Client / s3mini) |
| `document-service.ts` | CRUD, upload/download, validation, attach/detach |
| `sync-service.ts` | Async sync worker for secondary provider |
| `retention-service.ts` | Lifecycle event listener + periodic local cleanup |
| `routes.ts` | REST API endpoints |
| `index.ts` | Module manifest + lifecycle |
| `tests/local-provider.test.ts` | Local provider unit tests |
| `tests/document-service.test.ts` | Service unit tests |
| `tests/retention-service.test.ts` | Retention logic tests |

### Frontend (`src/web/src/`)

| File | Responsibility |
|---|---|
| `stores/documents-store.ts` | Zustand store — document list, upload queue, filters |
| `pages/documents/documents-page.tsx` | Standalone /documents page |
| `pages/documents/document-grid.tsx` | Grid/List view with cards |
| `pages/documents/document-card.tsx` | Single file card component |
| `pages/documents/document-detail.tsx` | Detail sheet/panel |
| `pages/documents/upload-zone.tsx` | Drag & drop + file picker + progress |
| `components/attachments/attachment-list.tsx` | Inline compact attachment list (shared) |
| `routes/documents.tsx` | TanStack Router route |

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install npm packages**

```bash
cd /Users/eyssen/GitHub/eyas && bun add s3mini file-type mime-types nanoid
```

- [ ] **Step 2: Install type definitions**

```bash
cd /Users/eyssen/GitHub/eyas && bun add -d @types/mime-types
```

- [ ] **Step 3: Verify installation**

```bash
cd /Users/eyssen/GitHub/eyas && bun run build 2>&1 | head -5
```

Expected: No errors related to missing packages.

- [ ] **Step 4: Commit**

```bash
cd /Users/eyssen/GitHub/eyas && git add package.json bun.lockb && git commit -m "feat(documents): add s3mini, file-type, mime-types, nanoid dependencies"
```

---

### Task 2: Types and interfaces

**Files:**
- Create: `src/modules/documents/types.ts`

- [ ] **Step 1: Create types file with all interfaces**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

// ─── Storage Provider ─────────────────────────────────

export interface FileMeta {
  filename: string
  mimeType: string
  sizeBytes: number
}

export interface StorageProvider {
  id: string
  type: 'primary' | 'secondary'

  put(key: string, data: Buffer | ReadableStream, meta: FileMeta): Promise<void>
  get(key: string): Promise<{ data: ReadableStream; meta: FileMeta } | null>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  getUrl(key: string, expiresIn?: number): Promise<string | null>
}

export interface ThumbnailProvider {
  supports(mimeType: string): boolean
  generate(data: Buffer, options: ThumbnailOptions): Promise<Buffer>
}

export interface ThumbnailOptions {
  maxWidth: number
  maxHeight: number
  format: 'webp' | 'jpeg'
}

// ─── Document Record ──────────────────────────────────

export interface DocumentRecord {
  id: string
  ownerModule: string | null
  ownerId: string | null
  filename: string
  mimeType: string
  sizeBytes: number
  checksumSha256: string
  storageKey: string
  localPath: string | null
  remoteProvider: string | null
  remoteStatus: 'pending' | 'synced' | 'error' | 'not_configured'
  thumbnailKey: string | null
  retainLocalUntil: string | null
  metadata: Record<string, unknown>
  createdBy: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

// ─── Retention ────────────────────────────────────────

export type RetentionTrigger = 'time' | 'lifecycle'

export interface RetentionRule {
  id: string
  triggerType: RetentionTrigger
  event: string | null        // 'conversation.closed' | 'conversation.stage_changed'
  stage: string | null         // stage name for stage_changed
  condition: string | null     // 'no_owner'
  localDays: number
  enabled: boolean
  createdAt: string
}

// ─── Upload ───────────────────────────────────────────

export interface UploadInput {
  file: Buffer
  filename: string
  ownerModule?: string
  ownerId?: string
  metadata?: Record<string, unknown>
  createdBy?: string
}

export interface UploadLimits {
  maxFileSizeMb: number
  allowedTypes: string[]
}

// ─── Events ───────────────────────────────────────────

export interface DocumentUploadedEvent {
  documentId: string
  ownerModule: string | null
  ownerId: string | null
  mimeType: string
  sizeBytes: number
  storageKey: string
}

export interface DocumentSyncedEvent {
  documentId: string
  remoteProvider: string
}

export interface DocumentSyncFailedEvent {
  documentId: string
  error: string
}

export interface DocumentDeletedEvent {
  documentId: string
  ownerModule: string | null
  ownerId: string | null
}

export interface DocumentLocalCleanedEvent {
  documentId: string
}

// ─── Config ───────────────────────────────────────────

export interface DocumentsConfig {
  storage: { localDir: string }
  limits: {
    default: UploadLimits
    overrides: Record<string, Partial<UploadLimits>>
  }
  remote: {
    enabled: boolean
    provider: string
    bucket: string
    region: string
    endpoint: string
  }
  retention: {
    rules: Array<{
      trigger: RetentionTrigger
      event?: string
      stage?: string
      condition?: string
      localDays: number
    }>
  }
  sync: {
    retryAttempts: number
    retryDelaySeconds: number
    batchSize: number
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/eyssen/GitHub/eyas && git add src/modules/documents/types.ts && git commit -m "feat(documents): add type definitions — StorageProvider, DocumentRecord, RetentionRule, events"
```

---

### Task 3: Database schema

**Files:**
- Create: `src/modules/documents/schema.ts`
- Test: `src/modules/documents/tests/schema.test.ts`

- [ ] **Step 1: Write schema test**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb } from '@test/helpers'
import { createDocumentsTables } from '../schema.js'

describe('documents schema', () => {
  let db: any

  beforeEach(() => {
    db = createTestDb()
    createDocumentsTables(db)
  })

  it('creates documents table', () => {
    const result = db.get(sql`SELECT name FROM sqlite_master WHERE type='table' AND name='documents'`)
    expect(result).toBeTruthy()
    expect(result.name).toBe('documents')
  })

  it('creates document_retention_rules table', () => {
    const result = db.get(sql`SELECT name FROM sqlite_master WHERE type='table' AND name='document_retention_rules'`)
    expect(result).toBeTruthy()
  })

  it('allows inserting a document record', () => {
    db.run(sql`INSERT INTO documents (id, filename, mime_type, size_bytes, checksum_sha256, storage_key, created_by) VALUES ('doc1', 'test.pdf', 'application/pdf', 1024, 'abc123', 'doc1.pdf', 'user1')`)
    const doc = db.get(sql`SELECT * FROM documents WHERE id = 'doc1'`)
    expect(doc.filename).toBe('test.pdf')
    expect(doc.remote_status).toBe('pending')
  })

  it('enforces unique storage_key', () => {
    db.run(sql`INSERT INTO documents (id, filename, mime_type, size_bytes, checksum_sha256, storage_key) VALUES ('d1', 'a.pdf', 'application/pdf', 100, 'hash1', 'key1')`)
    expect(() => {
      db.run(sql`INSERT INTO documents (id, filename, mime_type, size_bytes, checksum_sha256, storage_key) VALUES ('d2', 'b.pdf', 'application/pdf', 100, 'hash2', 'key1')`)
    }).toThrow()
  })

  it('allows inserting a retention rule', () => {
    db.run(sql`INSERT INTO document_retention_rules (id, trigger_type, event, local_days) VALUES ('r1', 'lifecycle', 'conversation.closed', 14)`)
    const rule = db.get(sql`SELECT * FROM document_retention_rules WHERE id = 'r1'`)
    expect(rule.trigger_type).toBe('lifecycle')
    expect(rule.local_days).toBe(14)
    expect(rule.enabled).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/eyssen/GitHub/eyas && bunx vitest run src/modules/documents/tests/schema.test.ts 2>&1 | tail -10
```

Expected: FAIL — `createDocumentsTables` not found.

- [ ] **Step 3: Create schema.ts**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export function createDocumentsTables(db: EyasDb) {
  db.run(sql`CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    owner_module TEXT,
    owner_id TEXT,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    checksum_sha256 TEXT NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    local_path TEXT,
    remote_provider TEXT,
    remote_status TEXT DEFAULT 'pending',
    thumbnail_key TEXT,
    retain_local_until TEXT,
    metadata TEXT DEFAULT '{}',
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    deleted_at TEXT
  )`)

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_module, owner_id)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_documents_remote_status ON documents(remote_status)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_documents_retention ON documents(retain_local_until) WHERE local_path IS NOT NULL`)

  db.run(sql`CREATE TABLE IF NOT EXISTS document_retention_rules (
    id TEXT PRIMARY KEY,
    trigger_type TEXT NOT NULL,
    event TEXT,
    stage TEXT,
    condition_expr TEXT,
    local_days INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/eyssen/GitHub/eyas && bunx vitest run src/modules/documents/tests/schema.test.ts 2>&1 | tail -10
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/eyssen/GitHub/eyas && git add src/modules/documents/schema.ts src/modules/documents/tests/schema.test.ts && git commit -m "feat(documents): add database schema — documents + retention_rules tables"
```

---

### Task 4: Local storage provider

**Files:**
- Create: `src/modules/documents/providers/local-provider.ts`
- Test: `src/modules/documents/tests/local-provider.test.ts`

- [ ] **Step 1: Write local provider tests**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalProvider } from '../providers/local-provider.js'

describe('LocalProvider', () => {
  let baseDir: string
  let provider: ReturnType<typeof createLocalProvider>

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'eyas-docs-test-'))
    provider = createLocalProvider(baseDir)
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
  })

  it('has id "local" and type "primary"', () => {
    expect(provider.id).toBe('local')
    expect(provider.type).toBe('primary')
  })

  it('puts and gets a file', async () => {
    const data = Buffer.from('hello world')
    const meta = { filename: 'test.txt', mimeType: 'text/plain', sizeBytes: data.length }

    await provider.put('abc123.txt', data, meta)
    expect(await provider.exists('abc123.txt')).toBe(true)

    const result = await provider.get('abc123.txt')
    expect(result).not.toBeNull()

    const chunks: Buffer[] = []
    for await (const chunk of result!.data) chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks).toString()).toBe('hello world')
    expect(result!.meta.mimeType).toBe('text/plain')
  })

  it('returns null for non-existent file', async () => {
    expect(await provider.get('nonexistent.txt')).toBeNull()
    expect(await provider.exists('nonexistent.txt')).toBe(false)
  })

  it('deletes a file', async () => {
    const data = Buffer.from('delete me')
    await provider.put('del.txt', data, { filename: 'del.txt', mimeType: 'text/plain', sizeBytes: data.length })
    expect(await provider.exists('del.txt')).toBe(true)

    await provider.delete('del.txt')
    expect(await provider.exists('del.txt')).toBe(false)
  })

  it('uses hash-sharded directory structure', async () => {
    const data = Buffer.from('x')
    await provider.put('V1StGXR8.txt', data, { filename: 'f.txt', mimeType: 'text/plain', sizeBytes: 1 })

    const { stat } = await import('node:fs/promises')
    const shardedPath = join(baseDir, 'V1', 'St', 'V1StGXR8.txt')
    const s = await stat(shardedPath)
    expect(s.isFile()).toBe(true)
  })

  it('getUrl returns null (local provider has no URLs)', async () => {
    expect(await provider.getUrl('any.txt')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/eyssen/GitHub/eyas && bunx vitest run src/modules/documents/tests/local-provider.test.ts 2>&1 | tail -10
```

Expected: FAIL — `createLocalProvider` not found.

- [ ] **Step 3: Implement local provider**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { mkdir, writeFile, readFile, unlink, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { StorageProvider, FileMeta } from '../types.js'

function shardedPath(baseDir: string, key: string): string {
  const s1 = key.slice(0, 2)
  const s2 = key.slice(2, 4)
  return join(baseDir, s1, s2, key)
}

export function createLocalProvider(baseDir: string): StorageProvider {
  return {
    id: 'local',
    type: 'primary',

    async put(key: string, data: Buffer | ReadableStream, meta: FileMeta): Promise<void> {
      const filePath = shardedPath(baseDir, key)
      const dir = join(filePath, '..')
      await mkdir(dir, { recursive: true })

      if (data instanceof Buffer) {
        await writeFile(filePath, data)
      } else {
        const chunks: Uint8Array[] = []
        for await (const chunk of data) chunks.push(new Uint8Array(chunk))
        await writeFile(filePath, Buffer.concat(chunks))
      }

      // Store meta alongside the file
      await writeFile(`${filePath}.meta.json`, JSON.stringify(meta))
    },

    async get(key: string): Promise<{ data: ReadableStream; meta: FileMeta } | null> {
      const filePath = shardedPath(baseDir, key)
      try {
        await stat(filePath)
      } catch {
        return null
      }

      const buffer = await readFile(filePath)
      let meta: FileMeta = { filename: key, mimeType: 'application/octet-stream', sizeBytes: buffer.length }
      try {
        const metaRaw = await readFile(`${filePath}.meta.json`, 'utf-8')
        meta = JSON.parse(metaRaw)
      } catch {
        // meta file missing — use defaults
      }

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(buffer)
          controller.close()
        },
      })

      return { data: stream, meta }
    },

    async delete(key: string): Promise<void> {
      const filePath = shardedPath(baseDir, key)
      try {
        await unlink(filePath)
        await unlink(`${filePath}.meta.json`).catch(() => {})
      } catch {
        // File already gone
      }
    },

    async exists(key: string): Promise<boolean> {
      const filePath = shardedPath(baseDir, key)
      try {
        await stat(filePath)
        return true
      } catch {
        return false
      }
    },

    async getUrl(): Promise<string | null> {
      return null // Local provider does not serve URLs
    },
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/eyssen/GitHub/eyas && bunx vitest run src/modules/documents/tests/local-provider.test.ts 2>&1 | tail -10
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/eyssen/GitHub/eyas && git add src/modules/documents/providers/local-provider.ts src/modules/documents/tests/local-provider.test.ts && git commit -m "feat(documents): add local storage provider — hash-sharded fs with meta files"
```

---

### Task 5: S3 storage provider

**Files:**
- Create: `src/modules/documents/providers/s3-provider.ts`
- Test: `src/modules/documents/tests/s3-provider.test.ts`

- [ ] **Step 1: Write S3 provider tests (using mock)**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createS3Provider } from '../providers/s3-provider.js'

// We test the provider logic with a mock S3 client interface.
// Real S3 integration is validated via manual testing with B2.

describe('S3Provider', () => {
  let mockClient: any
  let provider: ReturnType<typeof createS3Provider>

  beforeEach(() => {
    const storage = new Map<string, { data: Buffer; meta: any }>()

    mockClient = {
      async putObject(key: string, data: Buffer, meta: any) {
        storage.set(key, { data, meta })
      },
      async getObject(key: string) {
        const entry = storage.get(key)
        if (!entry) return null
        return { data: entry.data, meta: entry.meta }
      },
      async deleteObject(key: string) {
        storage.delete(key)
      },
      async headObject(key: string) {
        return storage.has(key) ? { size: storage.get(key)!.data.length } : null
      },
      async getPresignedUrl(key: string, expiresIn: number) {
        return `https://mock-s3.example.com/${key}?expires=${expiresIn}`
      },
    }

    provider = createS3Provider({
      client: mockClient,
      bucket: 'test-bucket',
      prefix: 'documents/',
    })
  })

  it('has id "s3" and type "secondary"', () => {
    expect(provider.id).toBe('s3')
    expect(provider.type).toBe('secondary')
  })

  it('puts and gets a file', async () => {
    const data = Buffer.from('s3 content')
    const meta = { filename: 'test.pdf', mimeType: 'application/pdf', sizeBytes: data.length }

    await provider.put('abc.pdf', data, meta)
    expect(await provider.exists('abc.pdf')).toBe(true)

    const result = await provider.get('abc.pdf')
    expect(result).not.toBeNull()

    const chunks: Buffer[] = []
    for await (const chunk of result!.data) chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks).toString()).toBe('s3 content')
  })

  it('returns null for non-existent file', async () => {
    expect(await provider.get('missing.pdf')).toBeNull()
    expect(await provider.exists('missing.pdf')).toBe(false)
  })

  it('deletes a file', async () => {
    const data = Buffer.from('x')
    await provider.put('del.pdf', data, { filename: 'del.pdf', mimeType: 'application/pdf', sizeBytes: 1 })
    await provider.delete('del.pdf')
    expect(await provider.exists('del.pdf')).toBe(false)
  })

  it('getUrl returns presigned URL', async () => {
    const url = await provider.getUrl('test.pdf', 3600)
    expect(url).toContain('mock-s3.example.com')
    expect(url).toContain('expires=3600')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/eyssen/GitHub/eyas && bunx vitest run src/modules/documents/tests/s3-provider.test.ts 2>&1 | tail -10
```

Expected: FAIL — `createS3Provider` not found.

- [ ] **Step 3: Implement S3 provider**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { StorageProvider, FileMeta } from '../types.js'

export interface S3Client {
  putObject(key: string, data: Buffer, meta: Record<string, string>): Promise<void>
  getObject(key: string): Promise<{ data: Buffer; meta: Record<string, string> } | null>
  deleteObject(key: string): Promise<void>
  headObject(key: string): Promise<{ size: number } | null>
  getPresignedUrl(key: string, expiresIn: number): Promise<string>
}

export interface S3ProviderOptions {
  client: S3Client
  bucket: string
  prefix: string // e.g. 'documents/'
}

function prefixedKey(prefix: string, key: string): string {
  return `${prefix}${key}`
}

export function createS3Provider(options: S3ProviderOptions): StorageProvider {
  const { client, prefix } = options

  return {
    id: 's3',
    type: 'secondary',

    async put(key: string, data: Buffer | ReadableStream, meta: FileMeta): Promise<void> {
      let buffer: Buffer
      if (data instanceof Buffer) {
        buffer = data
      } else {
        const chunks: Uint8Array[] = []
        for await (const chunk of data) chunks.push(new Uint8Array(chunk))
        buffer = Buffer.concat(chunks)
      }

      await client.putObject(prefixedKey(prefix, key), buffer, {
        filename: meta.filename,
        mimeType: meta.mimeType,
        sizeBytes: String(meta.sizeBytes),
      })
    },

    async get(key: string): Promise<{ data: ReadableStream; meta: FileMeta } | null> {
      const result = await client.getObject(prefixedKey(prefix, key))
      if (!result) return null

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(result.data)
          controller.close()
        },
      })

      return {
        data: stream,
        meta: {
          filename: result.meta.filename || key,
          mimeType: result.meta.mimeType || 'application/octet-stream',
          sizeBytes: Number(result.meta.sizeBytes) || result.data.length,
        },
      }
    },

    async delete(key: string): Promise<void> {
      await client.deleteObject(prefixedKey(prefix, key))
    },

    async exists(key: string): Promise<boolean> {
      const head = await client.headObject(prefixedKey(prefix, key))
      return head !== null
    },

    async getUrl(key: string, expiresIn = 3600): Promise<string | null> {
      return client.getPresignedUrl(prefixedKey(prefix, key), expiresIn)
    },
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/eyssen/GitHub/eyas && bunx vitest run src/modules/documents/tests/s3-provider.test.ts 2>&1 | tail -10
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/eyssen/GitHub/eyas && git add src/modules/documents/providers/s3-provider.ts src/modules/documents/tests/s3-provider.test.ts && git commit -m "feat(documents): add S3 storage provider — Bun.S3Client/s3mini compatible"
```

---

### Task 6: S3 client factory (Bun native + s3mini fallback)

**Files:**
- Create: `src/modules/documents/providers/s3-client-factory.ts`

- [ ] **Step 1: Create the factory that wraps Bun.S3Client or s3mini into the S3Client interface**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { S3Client } from './s3-provider.js'

interface S3Credentials {
  accessKeyId: string
  secretAccessKey: string
  endpoint: string
  bucket: string
  region: string
}

export async function createS3Client(creds: S3Credentials): Promise<S3Client> {
  // Try Bun native S3 first
  if (typeof globalThis.Bun !== 'undefined') {
    return createBunS3Client(creds)
  }
  // Fallback to s3mini for Node.js
  return createS3MiniClient(creds)
}

function createBunS3Client(creds: S3Credentials): S3Client {
  const bunS3 = new Bun.S3Client({
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    endpoint: creds.endpoint,
    bucket: creds.bucket,
    region: creds.region,
  })

  return {
    async putObject(key, data, meta) {
      const file = bunS3.file(key)
      await file.write(data, { type: meta.mimeType })
    },
    async getObject(key) {
      const file = bunS3.file(key)
      try {
        const exists = await file.exists()
        if (!exists) return null
        const buf = Buffer.from(await file.arrayBuffer())
        return { data: buf, meta: {} }
      } catch {
        return null
      }
    },
    async deleteObject(key) {
      const file = bunS3.file(key)
      await file.delete()
    },
    async headObject(key) {
      const file = bunS3.file(key)
      try {
        const exists = await file.exists()
        if (!exists) return null
        const size = file.size
        return { size: typeof size === 'number' ? size : 0 }
      } catch {
        return null
      }
    },
    async getPresignedUrl(key, expiresIn) {
      const file = bunS3.file(key)
      return file.presign({ expiresIn })
    },
  }
}

async function createS3MiniClient(creds: S3Credentials): Promise<S3Client> {
  const { S3Client: MiniS3 } = await import('s3mini')
  const client = new MiniS3({
    accessKey: creds.accessKeyId,
    secretKey: creds.secretAccessKey,
    endPoint: creds.endpoint,
    bucket: creds.bucket,
    region: creds.region,
    pathStyle: false,
  })

  return {
    async putObject(key, data, meta) {
      await client.putObject(key, data, { 'Content-Type': meta.mimeType })
    },
    async getObject(key) {
      try {
        const response = await client.getObject(key)
        const buf = Buffer.from(await response.arrayBuffer())
        return { data: buf, meta: {} }
      } catch {
        return null
      }
    },
    async deleteObject(key) {
      await client.deleteObject(key)
    },
    async headObject(key) {
      try {
        const head = await client.headObject(key)
        return { size: Number(head.headers?.get('content-length') ?? 0) }
      } catch {
        return null
      }
    },
    async getPresignedUrl(key, expiresIn) {
      return client.getPresignedUrl('GET', key, expiresIn)
    },
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/eyssen/GitHub/eyas && git add src/modules/documents/providers/s3-client-factory.ts && git commit -m "feat(documents): add S3 client factory — Bun native + s3mini Node.js fallback"
```

---

### Task 7: Document service

**Files:**
- Create: `src/modules/documents/document-service.ts`
- Test: `src/modules/documents/tests/document-service.test.ts`

- [ ] **Step 1: Write document service tests**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestDb } from '@test/helpers'
import { createDocumentsTables } from '../schema.js'
import { createDocumentService } from '../document-service.js'
import { createLocalProvider } from '../providers/local-provider.js'

describe('DocumentService', () => {
  let db: any
  let service: ReturnType<typeof createDocumentService>
  let baseDir: string

  beforeEach(async () => {
    db = createTestDb()
    createDocumentsTables(db)
    baseDir = await mkdtemp(join(tmpdir(), 'eyas-docsvc-'))
    const localProvider = createLocalProvider(baseDir)
    service = createDocumentService(db, localProvider, null)
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
  })

  it('uploads a file and returns document record', async () => {
    const doc = await service.upload({
      file: Buffer.from('hello pdf'),
      filename: 'report.pdf',
      createdBy: 'user1',
    })

    expect(doc.id).toBeTruthy()
    expect(doc.filename).toBe('report.pdf')
    expect(doc.mimeType).toBe('application/pdf')
    expect(doc.sizeBytes).toBe(9)
    expect(doc.checksumSha256).toBeTruthy()
    expect(doc.localPath).toBeTruthy()
    expect(doc.remoteStatus).toBe('not_configured')
  })

  it('uploads with owner binding', async () => {
    const doc = await service.upload({
      file: Buffer.from('img data'),
      filename: 'screenshot.png',
      ownerModule: 'conversations',
      ownerId: 'conv1',
    })

    expect(doc.ownerModule).toBe('conversations')
    expect(doc.ownerId).toBe('conv1')
  })

  it('gets document by id', async () => {
    const doc = await service.upload({ file: Buffer.from('x'), filename: 'test.txt' })
    const found = service.getById(doc.id)
    expect(found).toBeTruthy()
    expect(found!.id).toBe(doc.id)
  })

  it('lists documents by owner', async () => {
    await service.upload({ file: Buffer.from('a'), filename: 'a.txt', ownerModule: 'knowledge', ownerId: 'page1' })
    await service.upload({ file: Buffer.from('b'), filename: 'b.txt', ownerModule: 'knowledge', ownerId: 'page1' })
    await service.upload({ file: Buffer.from('c'), filename: 'c.txt', ownerModule: 'conversations', ownerId: 'conv1' })

    const knowledgeDocs = service.listByOwner('knowledge', 'page1')
    expect(knowledgeDocs).toHaveLength(2)
  })

  it('soft deletes a document', async () => {
    const doc = await service.upload({ file: Buffer.from('del'), filename: 'del.txt' })
    await service.softDelete(doc.id)

    const found = service.getById(doc.id)
    expect(found).toBeNull() // getById excludes soft-deleted

    const raw = db.get(sql`SELECT deleted_at FROM documents WHERE id = ${doc.id}`)
    expect(raw.deleted_at).toBeTruthy()
  })

  it('attaches document to entity', async () => {
    const doc = await service.upload({ file: Buffer.from('x'), filename: 'orphan.txt' })
    expect(doc.ownerModule).toBeNull()

    service.attach(doc.id, 'conversations', 'conv1')
    const updated = service.getById(doc.id)
    expect(updated!.ownerModule).toBe('conversations')
    expect(updated!.ownerId).toBe('conv1')
  })

  it('detaches document from entity', async () => {
    const doc = await service.upload({ file: Buffer.from('x'), filename: 'f.txt', ownerModule: 'knowledge', ownerId: 'p1' })
    service.detach(doc.id)
    const updated = service.getById(doc.id)
    expect(updated!.ownerModule).toBeNull()
    expect(updated!.ownerId).toBeNull()
  })

  it('rejects file exceeding size limit', async () => {
    const bigBuffer = Buffer.alloc(60 * 1024 * 1024) // 60MB > default 50MB
    await expect(
      service.upload({ file: bigBuffer, filename: 'huge.bin' })
    ).rejects.toThrow(/size/)
  })

  it('downloads file as stream', async () => {
    const doc = await service.upload({ file: Buffer.from('stream content'), filename: 'stream.txt' })
    const result = await service.download(doc.id)
    expect(result).not.toBeNull()

    const chunks: Buffer[] = []
    for await (const chunk of result!.data) chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks).toString()).toBe('stream content')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/eyssen/GitHub/eyas && bunx vitest run src/modules/documents/tests/document-service.test.ts 2>&1 | tail -10
```

Expected: FAIL — `createDocumentService` not found.

- [ ] **Step 3: Implement document service**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { generateId } from '@shared/crypto'
import type { EyasDb } from '@core/types'
import type { StorageProvider, DocumentRecord, UploadInput, UploadLimits, FileMeta } from './types.js'

const DEFAULT_LIMITS: UploadLimits = {
  maxFileSizeMb: 50,
  allowedTypes: ['image/*', 'application/pdf', 'text/*', 'application/zip'],
}

function rowToDocument(r: any): DocumentRecord {
  return {
    id: r.id,
    ownerModule: r.owner_module,
    ownerId: r.owner_id,
    filename: r.filename,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    checksumSha256: r.checksum_sha256,
    storageKey: r.storage_key,
    localPath: r.local_path,
    remoteProvider: r.remote_provider,
    remoteStatus: r.remote_status,
    thumbnailKey: r.thumbnail_key,
    retainLocalUntil: r.retain_local_until,
    metadata: r.metadata ? JSON.parse(r.metadata) : {},
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  }
}

function computeSha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function mimeMatchesPattern(mime: string, pattern: string): boolean {
  if (pattern === '*/*') return true
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2)
    return mime.startsWith(prefix)
  }
  return mime === pattern
}

async function detectMimeType(buffer: Buffer, filename: string): Promise<string> {
  // Try magic number detection first
  try {
    const { fileTypeFromBuffer } = await import('file-type')
    const result = await fileTypeFromBuffer(buffer)
    if (result) return result.mime
  } catch {
    // file-type not available — fall through
  }

  // Fallback to extension-based detection
  try {
    const { lookup } = await import('mime-types')
    const mime = lookup(filename)
    if (mime) return mime
  } catch {
    // mime-types not available
  }

  return 'application/octet-stream'
}

function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(dot) : ''
}

export function createDocumentService(
  db: EyasDb,
  primary: StorageProvider,
  secondary: StorageProvider | null,
  limits?: UploadLimits,
  moduleOverrides?: Record<string, Partial<UploadLimits>>,
) {
  const defaultLimits = limits ?? DEFAULT_LIMITS

  function getLimitsForModule(ownerModule?: string): UploadLimits {
    if (!ownerModule || !moduleOverrides?.[ownerModule]) return defaultLimits
    return {
      maxFileSizeMb: moduleOverrides[ownerModule].maxFileSizeMb ?? defaultLimits.maxFileSizeMb,
      allowedTypes: moduleOverrides[ownerModule].allowedTypes ?? defaultLimits.allowedTypes,
    }
  }

  return {
    async upload(input: UploadInput): Promise<DocumentRecord> {
      const effectiveLimits = getLimitsForModule(input.ownerModule)

      // Validate size
      const maxBytes = effectiveLimits.maxFileSizeMb * 1024 * 1024
      if (input.file.length > maxBytes) {
        throw new Error(`File size ${input.file.length} exceeds limit of ${maxBytes} bytes`)
      }

      // Detect and validate MIME type
      const mimeType = await detectMimeType(input.file, input.filename)
      const allowed = effectiveLimits.allowedTypes.some((p) => mimeMatchesPattern(mimeType, p))
      if (!allowed) {
        throw new Error(`File type ${mimeType} is not allowed`)
      }

      const id = generateId()
      const ext = fileExtension(input.filename)
      const storageKey = `${id}${ext}`
      const checksum = computeSha256(input.file)
      const meta: FileMeta = { filename: input.filename, mimeType, sizeBytes: input.file.length }

      // Write to primary provider
      await primary.put(storageKey, input.file, meta)

      const remoteStatus = secondary ? 'pending' : 'not_configured'
      const now = new Date().toISOString()

      db.run(sql`INSERT INTO documents (id, owner_module, owner_id, filename, mime_type, size_bytes, checksum_sha256, storage_key, local_path, remote_provider, remote_status, metadata, created_by, created_at, updated_at)
        VALUES (${id}, ${input.ownerModule ?? null}, ${input.ownerId ?? null}, ${input.filename}, ${mimeType}, ${input.file.length}, ${checksum}, ${storageKey}, ${storageKey}, ${secondary?.id ?? null}, ${remoteStatus}, ${JSON.stringify(input.metadata ?? {})}, ${input.createdBy ?? null}, ${now}, ${now})`)

      return this.getById(id)!
    },

    getById(id: string): DocumentRecord | null {
      const row = (db as any).get(sql`SELECT * FROM documents WHERE id = ${id} AND deleted_at IS NULL`)
      return row ? rowToDocument(row) : null
    },

    listByOwner(ownerModule: string, ownerId: string): DocumentRecord[] {
      const rows = (db as any).all(sql`SELECT * FROM documents WHERE owner_module = ${ownerModule} AND owner_id = ${ownerId} AND deleted_at IS NULL ORDER BY created_at DESC`)
      return rows.map(rowToDocument)
    },

    listAll(filters?: { ownerModule?: string; mimeType?: string; limit?: number; offset?: number }): DocumentRecord[] {
      // Build dynamic query — simple approach for SQLite
      let query = 'SELECT * FROM documents WHERE deleted_at IS NULL'
      const params: any[] = []

      if (filters?.ownerModule) {
        query += ' AND owner_module = ?'
        params.push(filters.ownerModule)
      }
      if (filters?.mimeType) {
        query += ' AND mime_type LIKE ?'
        params.push(filters.mimeType.replace('*', '%'))
      }

      query += ' ORDER BY created_at DESC'
      query += ` LIMIT ${filters?.limit ?? 50} OFFSET ${filters?.offset ?? 0}`

      const stmt = (db as any).raw(query, ...params)
      return (stmt ?? []).map(rowToDocument)
    },

    async softDelete(id: string): Promise<void> {
      const doc = this.getById(id)
      if (!doc) return

      const now = new Date().toISOString()
      db.run(sql`UPDATE documents SET deleted_at = ${now}, updated_at = ${now} WHERE id = ${id}`)

      // Delete from providers
      if (doc.localPath) {
        await primary.delete(doc.storageKey).catch(() => {})
      }
      if (secondary && doc.remoteStatus === 'synced') {
        await secondary.delete(doc.storageKey).catch(() => {})
      }
    },

    attach(id: string, ownerModule: string, ownerId: string): void {
      const now = new Date().toISOString()
      db.run(sql`UPDATE documents SET owner_module = ${ownerModule}, owner_id = ${ownerId}, updated_at = ${now} WHERE id = ${id} AND deleted_at IS NULL`)
    },

    detach(id: string): void {
      const now = new Date().toISOString()
      db.run(sql`UPDATE documents SET owner_module = NULL, owner_id = NULL, updated_at = ${now} WHERE id = ${id} AND deleted_at IS NULL`)
    },

    async download(id: string): Promise<{ data: ReadableStream; meta: FileMeta } | null> {
      const doc = this.getById(id)
      if (!doc) return null

      // Try primary first
      if (doc.localPath) {
        const result = await primary.get(doc.storageKey)
        if (result) return result
      }

      // Fallback to secondary
      if (secondary && doc.remoteStatus === 'synced') {
        const result = await secondary.get(doc.storageKey)
        if (result) {
          // Cache locally
          const chunks: Uint8Array[] = []
          const [stream1, stream2] = result.data.tee()
          for await (const chunk of stream2) chunks.push(new Uint8Array(chunk))
          await primary.put(doc.storageKey, Buffer.concat(chunks), result.meta)
          db.run(sql`UPDATE documents SET local_path = ${doc.storageKey} WHERE id = ${id}`)
          return { data: stream1, meta: result.meta }
        }
      }

      return null
    },

    getPrimaryProvider(): StorageProvider { return primary },
    getSecondaryProvider(): StorageProvider | null { return secondary },
  }
}

export type DocumentService = ReturnType<typeof createDocumentService>
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/eyssen/GitHub/eyas && bunx vitest run src/modules/documents/tests/document-service.test.ts 2>&1 | tail -10
```

Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/eyssen/GitHub/eyas && git add src/modules/documents/document-service.ts src/modules/documents/tests/document-service.test.ts && git commit -m "feat(documents): add document service — upload, download, CRUD, attach/detach, validation"
```

---

### Task 8: Sync service

**Files:**
- Create: `src/modules/documents/sync-service.ts`

- [ ] **Step 1: Implement sync service**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb, EyasBus } from '@core/types'
import type { Logger } from 'pino'
import type { StorageProvider } from './types.js'

interface SyncConfig {
  retryAttempts: number
  retryDelaySeconds: number
  batchSize: number
}

const DEFAULT_SYNC_CONFIG: SyncConfig = {
  retryAttempts: 3,
  retryDelaySeconds: 60,
  batchSize: 10,
}

export function createSyncService(
  db: EyasDb,
  primary: StorageProvider,
  secondary: StorageProvider,
  bus: EyasBus,
  logger: Logger,
  config?: Partial<SyncConfig>,
) {
  const cfg = { ...DEFAULT_SYNC_CONFIG, ...config }
  let running = false

  async function syncOne(id: string, storageKey: string): Promise<boolean> {
    const result = await primary.get(storageKey)
    if (!result) {
      logger.warn({ id, storageKey }, 'Sync: primary file not found, skipping')
      return false
    }

    const chunks: Uint8Array[] = []
    for await (const chunk of result.data) chunks.push(new Uint8Array(chunk))
    const buffer = Buffer.concat(chunks)

    await secondary.put(storageKey, buffer, result.meta)

    const now = new Date().toISOString()
    db.run(sql`UPDATE documents SET remote_status = 'synced', updated_at = ${now} WHERE id = ${id}`)
    bus.emit('eyas.documents.synced', { documentId: id, remoteProvider: secondary.id })
    return true
  }

  return {
    async processPending(): Promise<number> {
      if (running) return 0
      running = true

      try {
        const rows = (db as any).all(
          sql`SELECT id, storage_key FROM documents WHERE remote_status = 'pending' AND deleted_at IS NULL LIMIT ${cfg.batchSize}`
        )

        let synced = 0
        for (const row of rows) {
          try {
            const ok = await syncOne(row.id, row.storage_key)
            if (ok) synced++
          } catch (err: any) {
            logger.error({ id: row.id, err: err.message }, 'Sync failed')
            const now = new Date().toISOString()
            db.run(sql`UPDATE documents SET remote_status = 'error', updated_at = ${now} WHERE id = ${row.id}`)
            bus.emit('eyas.documents.sync.failed', { documentId: row.id, error: err.message })
          }
        }

        if (synced > 0) logger.info({ synced, total: rows.length }, 'Sync batch completed')
        return synced
      } finally {
        running = false
      }
    },

    async retryErrors(): Promise<number> {
      const now = new Date().toISOString()
      // Reset error status to pending for retry
      db.run(sql`UPDATE documents SET remote_status = 'pending', updated_at = ${now} WHERE remote_status = 'error' AND deleted_at IS NULL`)
      return this.processPending()
    },
  }
}

export type SyncService = ReturnType<typeof createSyncService>
```

- [ ] **Step 2: Commit**

```bash
cd /Users/eyssen/GitHub/eyas && git add src/modules/documents/sync-service.ts && git commit -m "feat(documents): add sync service — async batch sync to secondary provider"
```

---

### Task 9: Retention service

**Files:**
- Create: `src/modules/documents/retention-service.ts`
- Test: `src/modules/documents/tests/retention-service.test.ts`

- [ ] **Step 1: Write retention tests**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestDb } from '@test/helpers'
import { createDocumentsTables } from '../schema.js'
import { createLocalProvider } from '../providers/local-provider.js'
import { createRetentionService } from '../retention-service.js'

describe('RetentionService', () => {
  let db: any
  let baseDir: string
  let primary: ReturnType<typeof createLocalProvider>

  beforeEach(async () => {
    db = createTestDb()
    createDocumentsTables(db)
    baseDir = await mkdtemp(join(tmpdir(), 'eyas-retention-'))
    primary = createLocalProvider(baseDir)
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
  })

  function insertDoc(id: string, overrides: Record<string, any> = {}) {
    const defaults = {
      filename: 'test.txt', mime_type: 'text/plain', size_bytes: 10,
      checksum_sha256: 'abc', storage_key: `${id}.txt`,
      local_path: `${id}.txt`, remote_status: 'synced',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }
    const d = { ...defaults, ...overrides }
    db.run(sql`INSERT INTO documents (id, filename, mime_type, size_bytes, checksum_sha256, storage_key, local_path, remote_provider, remote_status, owner_module, owner_id, retain_local_until, created_at, updated_at)
      VALUES (${id}, ${d.filename}, ${d.mime_type}, ${d.size_bytes}, ${d.checksum_sha256}, ${d.storage_key}, ${d.local_path}, ${d.remote_provider ?? 's3'}, ${d.remote_status}, ${d.owner_module ?? null}, ${d.owner_id ?? null}, ${d.retain_local_until ?? null}, ${d.created_at}, ${d.updated_at})`)
  }

  it('cleans up expired local files when remote is synced', async () => {
    const past = new Date(Date.now() - 86400000).toISOString() // yesterday
    insertDoc('d1', { retain_local_until: past, remote_status: 'synced' })

    // Put actual file
    await primary.put('d1.txt', Buffer.from('x'), { filename: 'test.txt', mimeType: 'text/plain', sizeBytes: 1 })

    const events: any[] = []
    const mockBus = { emit: (_s: string, d: any) => events.push(d), on: () => ({ subject: '', id: '', unsubscribe: () => {} }), off: () => {} }

    const retention = createRetentionService(db, primary, mockBus as any)
    const cleaned = await retention.cleanupExpired()

    expect(cleaned).toBe(1)
    expect(await primary.exists('d1.txt')).toBe(false)

    const row = db.get(sql`SELECT local_path FROM documents WHERE id = 'd1'`)
    expect(row.local_path).toBeNull()
  })

  it('skips cleanup when remote is not synced', async () => {
    const past = new Date(Date.now() - 86400000).toISOString()
    insertDoc('d2', { retain_local_until: past, remote_status: 'pending' })
    await primary.put('d2.txt', Buffer.from('x'), { filename: 'test.txt', mimeType: 'text/plain', sizeBytes: 1 })

    const mockBus = { emit: () => {}, on: () => ({ subject: '', id: '', unsubscribe: () => {} }), off: () => {} }
    const retention = createRetentionService(db, primary, mockBus as any)
    const cleaned = await retention.cleanupExpired()

    expect(cleaned).toBe(0)
    expect(await primary.exists('d2.txt')).toBe(true)
  })

  it('sets retain_local_until via applyLifecycleRule', () => {
    insertDoc('d3', { owner_module: 'conversations', owner_id: 'conv1' })

    const mockBus = { emit: () => {}, on: () => ({ subject: '', id: '', unsubscribe: () => {} }), off: () => {} }
    const retention = createRetentionService(db, primary, mockBus as any)
    retention.applyLifecycleRule('conversations', 'conv1', 14)

    const row = db.get(sql`SELECT retain_local_until FROM documents WHERE id = 'd3'`)
    expect(row.retain_local_until).toBeTruthy()

    const retainDate = new Date(row.retain_local_until)
    const expected = new Date(Date.now() + 14 * 86400000)
    expect(Math.abs(retainDate.getTime() - expected.getTime())).toBeLessThan(5000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/eyssen/GitHub/eyas && bunx vitest run src/modules/documents/tests/retention-service.test.ts 2>&1 | tail -10
```

Expected: FAIL — `createRetentionService` not found.

- [ ] **Step 3: Implement retention service**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb, EyasBus } from '@core/types'
import type { StorageProvider } from './types.js'

export function createRetentionService(
  db: EyasDb,
  primary: StorageProvider,
  bus: EyasBus,
) {
  return {
    applyLifecycleRule(ownerModule: string, ownerId: string, localDays: number): void {
      const retainUntil = new Date(Date.now() + localDays * 86400000).toISOString()
      const now = new Date().toISOString()
      db.run(sql`UPDATE documents SET retain_local_until = ${retainUntil}, updated_at = ${now}
        WHERE owner_module = ${ownerModule} AND owner_id = ${ownerId}
        AND deleted_at IS NULL AND local_path IS NOT NULL`)
    },

    async cleanupExpired(): Promise<number> {
      const now = new Date().toISOString()
      const rows = (db as any).all(
        sql`SELECT id, storage_key FROM documents
          WHERE retain_local_until < ${now}
          AND local_path IS NOT NULL
          AND remote_status = 'synced'
          AND deleted_at IS NULL`
      )

      let cleaned = 0
      for (const row of rows) {
        await primary.delete(row.storage_key).catch(() => {})
        db.run(sql`UPDATE documents SET local_path = NULL, updated_at = ${now} WHERE id = ${row.id}`)
        bus.emit('eyas.documents.local.cleaned', { documentId: row.id })
        cleaned++
      }

      return cleaned
    },
  }
}

export type RetentionService = ReturnType<typeof createRetentionService>
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/eyssen/GitHub/eyas && bunx vitest run src/modules/documents/tests/retention-service.test.ts 2>&1 | tail -10
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/eyssen/GitHub/eyas && git add src/modules/documents/retention-service.ts src/modules/documents/tests/retention-service.test.ts && git commit -m "feat(documents): add retention service — lifecycle rules + expired local cleanup"
```

---

### Task 10: REST API routes

**Files:**
- Create: `src/modules/documents/routes.ts`

- [ ] **Step 1: Implement routes**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import type { Logger } from 'pino'
import type { DocumentService } from './document-service.js'
import type { EyasBus } from '@core/types'

export function createDocumentRoutes(
  app: Hono, documents: DocumentService, bus: EyasBus, logger: Logger,
) {
  // Upload
  app.post('/api/v1/documents/upload', async (c) => {
    const body = await c.req.parseBody()
    const file = body.file

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'file is required (multipart/form-data)' }, 400)
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const ownerModule = typeof body.owner_module === 'string' ? body.owner_module : undefined
    const ownerId = typeof body.owner_id === 'string' ? body.owner_id : undefined
    const metadataRaw = typeof body.metadata === 'string' ? body.metadata : undefined

    let metadata: Record<string, unknown> | undefined
    if (metadataRaw) {
      try { metadata = JSON.parse(metadataRaw) } catch { return c.json({ error: 'Invalid metadata JSON' }, 400) }
    }

    try {
      const doc = await documents.upload({
        file: buffer,
        filename: file.name,
        ownerModule,
        ownerId,
        metadata,
        createdBy: (c as any).userId,
      })

      bus.emit('eyas.documents.uploaded', {
        documentId: doc.id,
        ownerModule: doc.ownerModule,
        ownerId: doc.ownerId,
        mimeType: doc.mimeType,
        sizeBytes: doc.sizeBytes,
        storageKey: doc.storageKey,
      })

      return c.json(doc, 201)
    } catch (err: any) {
      if (err.message.includes('size')) return c.json({ error: err.message }, 413)
      if (err.message.includes('type')) return c.json({ error: err.message }, 415)
      logger.error({ err: err.message }, 'Upload failed')
      return c.json({ error: 'Upload failed' }, 500)
    }
  })

  // Get metadata
  app.get('/api/v1/documents/:id', (c) => {
    const doc = documents.getById(c.req.param('id'))
    if (!doc) return c.json({ error: 'Document not found' }, 404)
    return c.json(doc)
  })

  // Download
  app.get('/api/v1/documents/:id/download', async (c) => {
    const doc = documents.getById(c.req.param('id'))
    if (!doc) return c.json({ error: 'Document not found' }, 404)

    const result = await documents.download(doc.id)
    if (!result) return c.json({ error: 'File not available' }, 404)

    c.header('Content-Type', result.meta.mimeType)
    c.header('Content-Disposition', `attachment; filename="${encodeURIComponent(result.meta.filename)}"`)
    c.header('Content-Length', String(result.meta.sizeBytes))
    return c.body(result.data as any)
  })

  // Delete
  app.delete('/api/v1/documents/:id', async (c) => {
    const doc = documents.getById(c.req.param('id'))
    if (!doc) return c.json({ error: 'Document not found' }, 404)

    await documents.softDelete(doc.id)
    bus.emit('eyas.documents.deleted', {
      documentId: doc.id,
      ownerModule: doc.ownerModule,
      ownerId: doc.ownerId,
    })
    return c.body(null, 204)
  })

  // List
  app.get('/api/v1/documents', (c) => {
    const ownerModule = c.req.query('owner_module')
    const ownerId = c.req.query('owner_id')

    if (ownerModule && ownerId) {
      return c.json(documents.listByOwner(ownerModule, ownerId))
    }

    return c.json(documents.listAll({
      ownerModule: ownerModule || undefined,
      mimeType: c.req.query('mime_type') || undefined,
      limit: Number(c.req.query('limit')) || 50,
      offset: Number(c.req.query('offset')) || 0,
    }))
  })

  // Attach
  app.post('/api/v1/documents/:id/attach', async (c) => {
    const doc = documents.getById(c.req.param('id'))
    if (!doc) return c.json({ error: 'Document not found' }, 404)

    const body = await c.req.json()
    if (!body.owner_module || !body.owner_id) {
      return c.json({ error: 'owner_module and owner_id required' }, 400)
    }

    documents.attach(doc.id, body.owner_module, body.owner_id)
    return c.json(documents.getById(doc.id))
  })

  // Detach
  app.post('/api/v1/documents/:id/detach', (c) => {
    const doc = documents.getById(c.req.param('id'))
    if (!doc) return c.json({ error: 'Document not found' }, 404)

    documents.detach(doc.id)
    return c.json(documents.getById(doc.id))
  })
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/eyssen/GitHub/eyas && git add src/modules/documents/routes.ts && git commit -m "feat(documents): add REST API routes — upload, download, CRUD, attach/detach"
```

---

### Task 11: Module manifest and lifecycle

**Files:**
- Create: `src/modules/documents/index.ts`
- Modify: `src/core/types.ts` — add `documents` to `ModuleContext`

- [ ] **Step 1: Create module manifest**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { createDocumentsTables } from './schema.js'
import { createDocumentService } from './document-service.js'
import { createLocalProvider } from './providers/local-provider.js'
import { createSyncService } from './sync-service.js'
import { createRetentionService } from './retention-service.js'
import { createS3Provider } from './providers/s3-provider.js'
import { createS3Client } from './providers/s3-client-factory.js'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'

export const documentsModule: EyasModule = {
  id: 'documents',
  name: 'Documents',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'File management with pluggable storage providers, polymorphic entity binding, lifecycle retention',
  dependencies: ['auth', 'secrets'],
  optional: ['search', 'activity'],

  frontend: {
    pages: [{ id: 'documents', path: '/documents', title: 'Documents', icon: 'FileText', order: 50 }],
    settings: [{ id: 'documents', title: 'Documents', order: 60 }],
  },

  async onRegister(ctx: ModuleContext) {
    createDocumentsTables(ctx.db)
    ctx.logger.info('Documents module registered')
  },

  async onStart(ctx: ModuleContext) {
    // Resolve local storage directory
    const localDir = join(process.cwd(), 'data', 'documents')
    await mkdir(localDir, { recursive: true })
    const primary = createLocalProvider(localDir)

    // Try to initialize secondary (S3) provider
    let secondary = null
    try {
      const accessKey = await ctx.secrets.get('s3-access-key', 'system')
      const secretKey = await ctx.secrets.get('s3-secret-key', 'system')
      const endpoint = await ctx.secrets.get('s3-endpoint', 'system')
      const bucket = await ctx.secrets.get('s3-bucket', 'system')
      const region = await ctx.secrets.get('s3-region', 'system')

      if (accessKey && secretKey && endpoint && bucket) {
        const s3Client = await createS3Client({
          accessKeyId: accessKey,
          secretAccessKey: secretKey,
          endpoint,
          bucket,
          region: region || 'auto',
        })
        secondary = createS3Provider({ client: s3Client, bucket, prefix: 'documents/' })
        ctx.logger.info('S3 secondary storage provider initialized')
      }
    } catch (err: any) {
      ctx.logger.warn({ err: err.message }, 'S3 provider not available — local only')
    }

    const documentService = createDocumentService(ctx.db, primary, secondary)
    ;(ctx as any).documents = documentService

    // Sync service (if secondary available)
    if (secondary) {
      const syncService = createSyncService(ctx.db, primary, secondary, ctx.bus, ctx.logger)

      // Listen for uploads → trigger sync
      ctx.bus.on('eyas.documents.uploaded', async () => {
        await syncService.processPending()
      })

      // Periodic sync retry (every 5 min)
      const syncInterval = setInterval(() => syncService.retryErrors(), 5 * 60 * 1000)
      ;(ctx as any)._documentsSyncInterval = syncInterval
    }

    // Retention service
    const retentionService = createRetentionService(ctx.db, primary, ctx.bus)

    // Listen for conversation lifecycle events
    ctx.bus.on('eyas.conversations.stage_changed', async (data: any) => {
      // Look up matching retention rules from DB
      const { sql } = await import('drizzle-orm')
      const rules = (ctx.db as any).all(
        sql`SELECT * FROM document_retention_rules WHERE trigger_type = 'lifecycle' AND event = 'conversation.stage_changed' AND enabled = 1`
      )
      for (const rule of rules) {
        if (!rule.stage || rule.stage === data.newStage) {
          retentionService.applyLifecycleRule('conversations', data.conversationId, rule.local_days)
        }
      }
    })

    ctx.bus.on('eyas.conversations.closed', async (data: any) => {
      const { sql } = await import('drizzle-orm')
      const rules = (ctx.db as any).all(
        sql`SELECT * FROM document_retention_rules WHERE trigger_type = 'lifecycle' AND event = 'conversation.closed' AND enabled = 1`
      )
      for (const rule of rules) {
        retentionService.applyLifecycleRule('conversations', data.conversationId, rule.local_days)
      }
    })

    // Periodic retention cleanup (every 15 min)
    const retentionInterval = setInterval(() => retentionService.cleanupExpired(), 15 * 60 * 1000)
    ;(ctx as any)._documentsRetentionInterval = retentionInterval

    // Routes
    const { createDocumentRoutes } = await import('./routes.js')
    createDocumentRoutes(ctx.http, documentService, ctx.bus, ctx.logger)

    ctx.logger.info({ secondary: !!secondary }, 'Documents module started')
  },

  async onStop(ctx: ModuleContext) {
    clearInterval((ctx as any)._documentsSyncInterval)
    clearInterval((ctx as any)._documentsRetentionInterval)
  },
}
```

- [ ] **Step 2: Add `documents` to ModuleContext in `src/core/types.ts`**

Add after the `knowledge` line in ModuleContext:

```typescript
  documents: import('@modules/documents/document-service').DocumentService
```

- [ ] **Step 3: Register module in the module loader**

Find where modules are imported and registered (likely `src/core/bootstrap.ts` or similar), and add:

```typescript
import { documentsModule } from '@modules/documents/index.js'
```

Add `documentsModule` to the modules array.

- [ ] **Step 4: Verify build compiles**

```bash
cd /Users/eyssen/GitHub/eyas && bun run build 2>&1 | tail -15
```

Expected: No compilation errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/eyssen/GitHub/eyas && git add src/modules/documents/index.ts src/core/types.ts && git add -u && git commit -m "feat(documents): add module manifest — lifecycle, sync intervals, retention listeners, route registration"
```

---

### Task 12: Frontend — Zustand store + API helpers

**Files:**
- Create: `src/web/src/stores/documents-store.ts`

- [ ] **Step 1: Create Zustand store**

```typescript
import { create } from 'zustand'
import { api } from '@/lib/api'

export interface DocumentRecord {
  id: string
  ownerModule: string | null
  ownerId: string | null
  filename: string
  mimeType: string
  sizeBytes: number
  storageKey: string
  remoteStatus: 'pending' | 'synced' | 'error' | 'not_configured'
  thumbnailKey: string | null
  createdBy: string | null
  createdAt: string
  deletedAt: string | null
}

interface UploadProgress {
  id: string
  filename: string
  progress: number // 0-100
  status: 'uploading' | 'done' | 'error'
  error?: string
}

interface DocumentsStore {
  documents: DocumentRecord[]
  isLoading: boolean
  uploads: UploadProgress[]
  viewMode: 'grid' | 'list'

  fetchDocuments: (filters?: { ownerModule?: string; ownerId?: string }) => Promise<void>
  uploadFile: (file: File, ownerModule?: string, ownerId?: string) => Promise<DocumentRecord | null>
  deleteDocument: (id: string) => Promise<void>
  attachDocument: (id: string, ownerModule: string, ownerId: string) => Promise<void>
  detachDocument: (id: string) => Promise<void>
  setViewMode: (mode: 'grid' | 'list') => void
  clearUploads: () => void
}

export const useDocumentsStore = create<DocumentsStore>((set, get) => ({
  documents: [],
  isLoading: false,
  uploads: [],
  viewMode: 'grid',

  fetchDocuments: async (filters) => {
    set({ isLoading: true })
    try {
      const params = new URLSearchParams()
      if (filters?.ownerModule) params.set('owner_module', filters.ownerModule)
      if (filters?.ownerId) params.set('owner_id', filters.ownerId)
      const query = params.toString() ? `?${params}` : ''
      const docs = await api.get<DocumentRecord[]>(`/documents${query}`)
      set({ documents: docs })
    } catch (err) {
      console.error('Failed to fetch documents:', err)
    } finally {
      set({ isLoading: false })
    }
  },

  uploadFile: async (file, ownerModule, ownerId) => {
    const uploadId = crypto.randomUUID()
    set((s) => ({
      uploads: [...s.uploads, { id: uploadId, filename: file.name, progress: 0, status: 'uploading' }],
    }))

    try {
      const formData = new FormData()
      formData.append('file', file)
      if (ownerModule) formData.append('owner_module', ownerModule)
      if (ownerId) formData.append('owner_id', ownerId)

      const res = await fetch('/api/v1/documents/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
        headers: { 'X-Eyas-Request': '1' },
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Upload failed')
      }

      const doc = await res.json() as DocumentRecord

      set((s) => ({
        uploads: s.uploads.map((u) => u.id === uploadId ? { ...u, progress: 100, status: 'done' as const } : u),
        documents: [doc, ...s.documents],
      }))

      return doc
    } catch (err: any) {
      set((s) => ({
        uploads: s.uploads.map((u) =>
          u.id === uploadId ? { ...u, status: 'error' as const, error: err.message } : u
        ),
      }))
      return null
    }
  },

  deleteDocument: async (id) => {
    await api.delete(`/documents/${id}`)
    set((s) => ({ documents: s.documents.filter((d) => d.id !== id) }))
  },

  attachDocument: async (id, ownerModule, ownerId) => {
    const doc = await api.post<DocumentRecord>(`/documents/${id}/attach`, { owner_module: ownerModule, owner_id: ownerId })
    set((s) => ({ documents: s.documents.map((d) => d.id === id ? doc : d) }))
  },

  detachDocument: async (id) => {
    const doc = await api.post<DocumentRecord>(`/documents/${id}/detach`)
    set((s) => ({ documents: s.documents.map((d) => d.id === id ? doc : d) }))
  },

  setViewMode: (mode) => set({ viewMode: mode }),
  clearUploads: () => set((s) => ({ uploads: s.uploads.filter((u) => u.status === 'uploading') })),
}))
```

- [ ] **Step 2: Commit**

```bash
cd /Users/eyssen/GitHub/eyas && git add src/web/src/stores/documents-store.ts && git commit -m "feat(documents): add Zustand store — document list, upload queue, CRUD operations"
```

---

### Task 13: Frontend — UploadZone component

**Files:**
- Create: `src/web/src/pages/documents/upload-zone.tsx`

- [ ] **Step 1: Create UploadZone with drag & drop**

```tsx
import { useCallback, useState } from 'react'
import { Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDocumentsStore } from '@/stores/documents-store'

interface UploadZoneProps {
  ownerModule?: string
  ownerId?: string
  compact?: boolean
  className?: string
}

export function UploadZone({ ownerModule, ownerId, compact, className }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const uploadFile = useDocumentsStore((s) => s.uploadFile)

  const handleFiles = useCallback(
    (files: FileList) => {
      Array.from(files).forEach((file) => uploadFile(file, ownerModule, ownerId))
    },
    [uploadFile, ownerModule, ownerId],
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files)
    },
    [handleFiles],
  )

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const onDragLeave = useCallback(() => setIsDragging(false), [])

  const onClickUpload = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.onchange = () => {
      if (input.files?.length) handleFiles(input.files)
    }
    input.click()
  }, [handleFiles])

  if (compact) {
    return (
      <button
        type="button"
        onClick={onClickUpload}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-accent/50 transition-colors',
          isDragging && 'bg-accent text-foreground',
          className,
        )}
      >
        <Upload className="h-3.5 w-3.5" />
        Attach
      </button>
    )
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClickUpload}
      onKeyDown={(e) => e.key === 'Enter' && onClickUpload()}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      className={cn(
        'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
        isDragging
          ? 'border-primary bg-primary/5 text-primary'
          : 'border-muted-foreground/25 text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground',
        className,
      )}
    >
      <Upload className="h-8 w-8 mx-auto mb-2" />
      <p className="text-sm font-medium">Drop files here or click to upload</p>
      <p className="text-xs mt-1 opacity-70">Max 50 MB per file</p>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/eyssen/GitHub/eyas && git add src/web/src/pages/documents/upload-zone.tsx && git commit -m "feat(documents): add UploadZone component — drag & drop + file picker"
```

---

### Task 14: Frontend — DocumentCard component

**Files:**
- Create: `src/web/src/pages/documents/document-card.tsx`

- [ ] **Step 1: Create DocumentCard**

```tsx
import { FileText, Image, FileArchive, FileCode, Film, File, Cloud, CloudOff, Clock, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DocumentRecord } from '@/stores/documents-store'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return Image
  if (mimeType.startsWith('video/')) return Film
  if (mimeType === 'application/pdf') return FileText
  if (mimeType.includes('zip') || mimeType.includes('archive') || mimeType.includes('compressed')) return FileArchive
  if (mimeType.includes('json') || mimeType.includes('javascript') || mimeType.includes('typescript') || mimeType.includes('xml')) return FileCode
  return File
}

function SyncBadge({ status }: { status: DocumentRecord['remoteStatus'] }) {
  switch (status) {
    case 'synced': return <Cloud className="h-3 w-3 text-green-500" />
    case 'pending': return <Clock className="h-3 w-3 text-yellow-500" />
    case 'error': return <AlertCircle className="h-3 w-3 text-red-500" />
    default: return <CloudOff className="h-3 w-3 text-muted-foreground/50" />
  }
}

interface DocumentCardProps {
  doc: DocumentRecord
  onClick?: () => void
  selected?: boolean
}

export function DocumentCard({ doc, onClick, selected }: DocumentCardProps) {
  const Icon = getFileIcon(doc.mimeType)
  const ext = doc.filename.includes('.') ? doc.filename.split('.').pop()?.toUpperCase() : ''

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex flex-col items-center gap-2 p-3 rounded-lg border transition-all text-left w-full',
        'hover:bg-accent/50 hover:border-muted-foreground/30',
        selected ? 'border-primary bg-primary/5' : 'border-transparent',
      )}
    >
      <div className="relative">
        <Icon className="h-10 w-10 text-muted-foreground group-hover:text-foreground transition-colors" />
        {ext && (
          <span className="absolute -bottom-1 -right-1 text-[9px] font-bold bg-muted px-1 rounded">
            {ext}
          </span>
        )}
      </div>
      <div className="w-full text-center min-w-0">
        <p className="text-xs font-medium truncate" title={doc.filename}>
          {doc.filename}
        </p>
        <div className="flex items-center justify-center gap-1.5 mt-0.5">
          <span className="text-[10px] text-muted-foreground">{formatBytes(doc.sizeBytes)}</span>
          <SyncBadge status={doc.remoteStatus} />
        </div>
      </div>
    </button>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/eyssen/GitHub/eyas && git add src/web/src/pages/documents/document-card.tsx && git commit -m "feat(documents): add DocumentCard component — file icon, size, sync badge"
```

---

### Task 15: Frontend — DocumentsPage + route

**Files:**
- Create: `src/web/src/pages/documents/documents-page.tsx`
- Create: `src/web/src/routes/documents.tsx`
- Modify: `src/web/src/components/layout/sidebar.tsx` — add Documents nav item

- [ ] **Step 1: Create DocumentsPage**

```tsx
import { useEffect } from 'react'
import { Grid3X3, List } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDocumentsStore } from '@/stores/documents-store'
import { DocumentCard } from './document-card'
import { UploadZone } from './upload-zone'

export default function DocumentsPage() {
  const { documents, isLoading, fetchDocuments, uploads, viewMode, setViewMode, deleteDocument } = useDocumentsStore()

  useEffect(() => { fetchDocuments() }, [fetchDocuments])

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 pb-2">
        <h1 className="text-lg font-semibold">Documents</h1>
        <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            className={cn('p-1.5 rounded-sm transition-colors', viewMode === 'grid' ? 'bg-background shadow-sm' : 'text-muted-foreground')}
          >
            <Grid3X3 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={cn('p-1.5 rounded-sm transition-colors', viewMode === 'list' ? 'bg-background shadow-sm' : 'text-muted-foreground')}
          >
            <List className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Upload progress */}
      {uploads.length > 0 && (
        <div className="px-4 py-2 space-y-1">
          {uploads.map((u) => (
            <div key={u.id} className="flex items-center gap-2 text-xs">
              <span className="truncate flex-1">{u.filename}</span>
              <span className={cn(
                u.status === 'done' && 'text-green-500',
                u.status === 'error' && 'text-red-500',
                u.status === 'uploading' && 'text-yellow-500',
              )}>
                {u.status === 'uploading' ? 'Uploading...' : u.status === 'done' ? 'Done' : u.error}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 pt-2">
        {isLoading ? (
          <div className="text-sm text-muted-foreground text-center py-8">Loading...</div>
        ) : documents.length === 0 ? (
          <UploadZone />
        ) : (
          <>
            <div className={cn(
              viewMode === 'grid'
                ? 'grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2'
                : 'flex flex-col gap-1',
            )}>
              {documents.map((doc) => (
                <DocumentCard
                  key={doc.id}
                  doc={doc}
                  onClick={() => {
                    // Download on click
                    window.open(`/api/v1/documents/${doc.id}/download`, '_blank')
                  }}
                />
              ))}
            </div>
            <div className="mt-4">
              <UploadZone compact />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create route file**

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import DocumentsPage from '@/pages/documents/documents-page'

export const Route = createFileRoute('/documents')({
  component: () => (
    <AppLayout>
      <DocumentsPage />
    </AppLayout>
  ),
})
```

- [ ] **Step 3: Add Documents to sidebar**

In `src/web/src/components/layout/sidebar.tsx`, add `FileText` to the lucide imports and add a nav link after the Conversations link:

```typescript
// Add to imports:
import { FileText } from 'lucide-react'

// Add after the Conversations renderNavLink:
{renderNavLink({ path: '/documents', label: 'Documents', icon: FileText })}
```

- [ ] **Step 4: Regenerate route tree**

```bash
cd /Users/eyssen/GitHub/eyas && bunx tsr generate
```

- [ ] **Step 5: Verify build**

```bash
cd /Users/eyssen/GitHub/eyas && bun run build 2>&1 | tail -10
```

Expected: Clean build.

- [ ] **Step 6: Commit**

```bash
cd /Users/eyssen/GitHub/eyas && git add src/web/src/pages/documents/ src/web/src/routes/documents.tsx src/web/src/components/layout/sidebar.tsx src/web/src/routes/routeTree.gen.ts && git commit -m "feat(documents): add Documents page — grid/list view, upload zone, sidebar nav"
```

---

### Task 16: Frontend — AttachmentList component (inline)

**Files:**
- Create: `src/web/src/components/attachments/attachment-list.tsx`

- [ ] **Step 1: Create inline AttachmentList**

```tsx
import { useEffect } from 'react'
import { Paperclip, X, Cloud, Clock, AlertCircle, CloudOff, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDocumentsStore, type DocumentRecord } from '@/stores/documents-store'
import { UploadZone } from '@/pages/documents/upload-zone'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function SyncIcon({ status }: { status: DocumentRecord['remoteStatus'] }) {
  switch (status) {
    case 'synced': return <Cloud className="h-3 w-3 text-green-500" />
    case 'pending': return <Clock className="h-3 w-3 text-yellow-500" />
    case 'error': return <AlertCircle className="h-3 w-3 text-red-500" />
    default: return <CloudOff className="h-3 w-3 text-muted-foreground/40" />
  }
}

interface AttachmentListProps {
  ownerModule: string
  ownerId: string
  className?: string
}

export function AttachmentList({ ownerModule, ownerId, className }: AttachmentListProps) {
  const { documents, fetchDocuments, detachDocument } = useDocumentsStore()

  useEffect(() => {
    fetchDocuments({ ownerModule, ownerId })
  }, [fetchDocuments, ownerModule, ownerId])

  const ownerDocs = documents.filter((d) => d.ownerModule === ownerModule && d.ownerId === ownerId)

  if (ownerDocs.length === 0) {
    return (
      <div className={cn('pt-2', className)}>
        <UploadZone ownerModule={ownerModule} ownerId={ownerId} compact />
      </div>
    )
  }

  return (
    <div className={cn('space-y-1 pt-2', className)}>
      <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
        <Paperclip className="h-3 w-3" />
        <span>Attachments ({ownerDocs.length})</span>
      </div>
      {ownerDocs.map((doc) => (
        <div key={doc.id} className="flex items-center gap-2 text-xs group">
          <a
            href={`/api/v1/documents/${doc.id}/download`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 min-w-0 flex-1 hover:text-foreground text-muted-foreground transition-colors"
          >
            <Paperclip className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{doc.filename}</span>
            <span className="text-[10px] opacity-60 flex-shrink-0">({formatBytes(doc.sizeBytes)})</span>
            <SyncIcon status={doc.remoteStatus} />
            <Download className="h-3 w-3 opacity-0 group-hover:opacity-50 flex-shrink-0" />
          </a>
          <button
            type="button"
            onClick={() => detachDocument(doc.id)}
            className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-500 transition-all"
            title="Detach file"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      <UploadZone ownerModule={ownerModule} ownerId={ownerId} compact />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/eyssen/GitHub/eyas && git add src/web/src/components/attachments/attachment-list.tsx && git commit -m "feat(documents): add AttachmentList component — inline compact attachment UI"
```

---

### Task 17: Run all tests and verify

**Files:** None (verification only)

- [ ] **Step 1: Run all document module tests**

```bash
cd /Users/eyssen/GitHub/eyas && bunx vitest run src/modules/documents/ 2>&1 | tail -20
```

Expected: All tests pass (schema: 5, local-provider: 6, document-service: 9, retention-service: 3).

- [ ] **Step 2: Run full project build**

```bash
cd /Users/eyssen/GitHub/eyas && bun run build 2>&1 | tail -10
```

Expected: Clean build, no errors.

- [ ] **Step 3: Run full test suite to check for regressions**

```bash
cd /Users/eyssen/GitHub/eyas && bunx vitest run 2>&1 | tail -20
```

Expected: All existing tests still pass.

- [ ] **Step 4: Commit any test fixes if needed**

---

### Task 18: Add i18n translations

**Files:**
- Modify: existing i18n files (en + hu)

- [ ] **Step 1: Add English translation keys**

Find the i18n locale files and add a `documents` namespace:

```json
{
  "documents": {
    "title": "Documents",
    "upload": "Upload",
    "dropzone": "Drop files here or click to upload",
    "maxSize": "Max {{size}} MB per file",
    "attachments": "Attachments",
    "attach": "Attach",
    "detach": "Detach",
    "noDocuments": "No documents yet",
    "syncStatus": {
      "synced": "Synced",
      "pending": "Syncing...",
      "error": "Sync error",
      "notConfigured": "Local only"
    },
    "viewMode": {
      "grid": "Grid",
      "list": "List"
    },
    "errors": {
      "tooLarge": "File exceeds size limit",
      "typeNotAllowed": "File type not allowed",
      "uploadFailed": "Upload failed"
    }
  }
}
```

- [ ] **Step 2: Add Hungarian translations**

```json
{
  "documents": {
    "title": "Dokumentumok",
    "upload": "Feltöltés",
    "dropzone": "Húzd ide a fájlokat vagy kattints a feltöltéshez",
    "maxSize": "Max {{size}} MB fájlonként",
    "attachments": "Mellékletek",
    "attach": "Csatolás",
    "detach": "Leválasztás",
    "noDocuments": "Még nincsenek dokumentumok",
    "syncStatus": {
      "synced": "Szinkronizálva",
      "pending": "Szinkronizálás...",
      "error": "Szinkronizálási hiba",
      "notConfigured": "Csak helyi"
    },
    "viewMode": {
      "grid": "Rács",
      "list": "Lista"
    },
    "errors": {
      "tooLarge": "A fájl meghaladja a méretkorlátot",
      "typeNotAllowed": "A fájltípus nem engedélyezett",
      "uploadFailed": "Feltöltés sikertelen"
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/eyssen/GitHub/eyas && git add -u && git commit -m "feat(documents): add i18n translations (en + hu)"
```
