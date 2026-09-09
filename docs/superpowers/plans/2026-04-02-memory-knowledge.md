# Memory & Knowledge Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 5-tier Memory system (working, episodic, semantic/procedural vault, archive) and a universal Knowledge wiki module with Plate editor, sharing a common wikilink graph and hybrid search infrastructure.

**Architecture:** Two separate modules (`memory`, `knowledge`) with shared wikilink service in `src/shared/`. Memory stores AI context in DB tiers + Vault markdown files. Knowledge stores wiki pages as Plate JSON in DB. Both share a wikilink graph and hybrid FTS search. The search module's existing Orama provider is reused for FTS.

**Tech Stack:** TypeScript, Hono, Drizzle ORM, SQLite FTS5, Orama, unified/remark (markdown), gray-matter (frontmatter), Plate editor (React), Zustand, TanStack Router, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-04-02-memory-knowledge-design.md`

---

## Task 1: Install new dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install backend dependencies**

Run: `cd /Users/eyssen/GitHub/eyas && bun add unified remark-parse remark-stringify gray-matter`

- [ ] **Step 2: Install frontend dependencies (Plate editor)**

Run: `cd /Users/eyssen/GitHub/eyas/src/web && bun add @udecode/plate @udecode/plate-heading @udecode/plate-list @udecode/plate-table @udecode/plate-code-block @udecode/plate-basic-marks @udecode/plate-block-quote @udecode/plate-slash-command`

- [ ] **Step 3: Verify all licenses are MIT-compatible**

Run: `cd /Users/eyssen/GitHub/eyas && bun pm ls | grep -E "unified|remark|gray-matter"`
Run: `cd /Users/eyssen/GitHub/eyas/src/web && bun pm ls | grep "@udecode"`

Check each package license. All must be MIT, Apache-2.0, BSD-2, BSD-3, or ISC. No GPL/LGPL/AGPL.

- [ ] **Step 4: Commit**

```
git add package.json bun.lockb src/web/package.json src/web/bun.lockb
git commit -m "chore: add memory & knowledge dependencies (unified, remark, gray-matter, plate)"
```

---

## Task 2: Shared wikilink service

**Files:**
- Create: `src/shared/wikilinks.ts`
- Test: `src/shared/__tests__/wikilinks.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/__tests__/wikilinks.test.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'bun:sqlite'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { createWikilinkService } from '../wikilinks.js'

function createTestDb() {
  const sqlite = new Database(':memory:')
  return drizzle(sqlite)
}

describe('WikilinkService', () => {
  let db: ReturnType<typeof createTestDb>
  let service: ReturnType<typeof createWikilinkService>

  beforeEach(() => {
    db = createTestDb()
    service = createWikilinkService(db)
  })

  it('creates wikilinks table on init', () => {
    service.init()
    // Should not throw when querying
    const rows = db.all(sql`SELECT COUNT(*) as count FROM wikilinks`)
    expect(rows).toHaveLength(1)
  })

  it('syncs links for a source', () => {
    service.init()
    service.syncLinks('vault', 'kubernetes.md', [
      { targetType: 'vault', targetId: 'networking.md', context: 'see [[networking]]' },
      { targetType: 'knowledge', targetId: 'page-123', context: 'related to [[K8s Setup]]' },
    ])
    const outgoing = service.getOutgoing('vault', 'kubernetes.md')
    expect(outgoing).toHaveLength(2)
    expect(outgoing[0].targetId).toBe('networking.md')
    expect(outgoing[1].targetId).toBe('page-123')
  })

  it('returns backlinks for a target', () => {
    service.init()
    service.syncLinks('vault', 'kubernetes.md', [
      { targetType: 'vault', targetId: 'networking.md', context: '[[networking]]' },
    ])
    service.syncLinks('knowledge', 'page-456', [
      { targetType: 'vault', targetId: 'networking.md', context: '[[networking]]' },
    ])
    const backlinks = service.getBacklinks('vault', 'networking.md')
    expect(backlinks).toHaveLength(2)
  })

  it('replaces links on re-sync', () => {
    service.init()
    service.syncLinks('vault', 'kubernetes.md', [
      { targetType: 'vault', targetId: 'networking.md', context: '[[networking]]' },
    ])
    service.syncLinks('vault', 'kubernetes.md', [
      { targetType: 'vault', targetId: 'storage.md', context: '[[storage]]' },
    ])
    const outgoing = service.getOutgoing('vault', 'kubernetes.md')
    expect(outgoing).toHaveLength(1)
    expect(outgoing[0].targetId).toBe('storage.md')
  })

  it('gets 1-hop neighbors', () => {
    service.init()
    service.syncLinks('vault', 'a.md', [
      { targetType: 'vault', targetId: 'b.md', context: '' },
    ])
    service.syncLinks('vault', 'c.md', [
      { targetType: 'vault', targetId: 'a.md', context: '' },
    ])
    const neighbors = service.getNeighbors('vault', 'a.md')
    expect(neighbors).toHaveLength(2)
    const ids = neighbors.map(n => n.id)
    expect(ids).toContain('b.md')
    expect(ids).toContain('c.md')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run src/shared/__tests__/wikilinks.test.ts`
Expected: FAIL -- `createWikilinkService` not found.

- [ ] **Step 3: Implement wikilink service**

Create `src/shared/wikilinks.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

// --- Types ---

export type WikilinkNodeType = 'vault' | 'knowledge'

export interface ParsedWikilink {
  targetType: WikilinkNodeType
  targetId: string
  context: string
}

export interface WikilinkRecord {
  id: number
  sourceType: WikilinkNodeType
  sourceId: string
  targetType: WikilinkNodeType
  targetId: string
  context: string | null
  createdAt: string
}

export interface WikilinkNeighbor {
  type: WikilinkNodeType
  id: string
}

// --- Service ---

export function createWikilinkService(db: EyasDb) {
  return {
    init() {
      db.run(sql`CREATE TABLE IF NOT EXISTS wikilinks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        context TEXT,
        created_at TEXT NOT NULL
      )`)
      db.run(sql`CREATE INDEX IF NOT EXISTS idx_wikilinks_source ON wikilinks(source_type, source_id)`)
      db.run(sql`CREATE INDEX IF NOT EXISTS idx_wikilinks_target ON wikilinks(target_type, target_id)`)
    },

    syncLinks(sourceType: WikilinkNodeType, sourceId: string, links: ParsedWikilink[]) {
      const now = new Date().toISOString()
      db.run(sql`DELETE FROM wikilinks WHERE source_type = ${sourceType} AND source_id = ${sourceId}`)
      for (const link of links) {
        db.run(sql`INSERT INTO wikilinks (source_type, source_id, target_type, target_id, context, created_at)
          VALUES (${sourceType}, ${sourceId}, ${link.targetType}, ${link.targetId}, ${link.context}, ${now})`)
      }
    },

    getOutgoing(sourceType: WikilinkNodeType, sourceId: string): WikilinkRecord[] {
      return (db as any).all(
        sql`SELECT * FROM wikilinks WHERE source_type = ${sourceType} AND source_id = ${sourceId}`
      ) as WikilinkRecord[]
    },

    getBacklinks(targetType: WikilinkNodeType, targetId: string): WikilinkRecord[] {
      return (db as any).all(
        sql`SELECT * FROM wikilinks WHERE target_type = ${targetType} AND target_id = ${targetId}`
      ) as WikilinkRecord[]
    },

    getNeighbors(nodeType: WikilinkNodeType, nodeId: string): WikilinkNeighbor[] {
      const outgoing = (db as any).all(
        sql`SELECT target_type as type, target_id as id FROM wikilinks
            WHERE source_type = ${nodeType} AND source_id = ${nodeId}`
      ) as WikilinkNeighbor[]

      const incoming = (db as any).all(
        sql`SELECT source_type as type, source_id as id FROM wikilinks
            WHERE target_type = ${nodeType} AND target_id = ${nodeId}`
      ) as WikilinkNeighbor[]

      const seen = new Set<string>()
      const result: WikilinkNeighbor[] = []
      for (const n of [...outgoing, ...incoming]) {
        const key = `${n.type}:${n.id}`
        if (!seen.has(key)) {
          seen.add(key)
          result.push(n)
        }
      }
      return result
    },

    removeSource(sourceType: WikilinkNodeType, sourceId: string) {
      db.run(sql`DELETE FROM wikilinks WHERE source_type = ${sourceType} AND source_id = ${sourceId}`)
    },
  }
}

export type WikilinkService = ReturnType<typeof createWikilinkService>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run src/shared/__tests__/wikilinks.test.ts`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```
git add src/shared/wikilinks.ts src/shared/__tests__/wikilinks.test.ts
git commit -m "feat(shared): add wikilink graph service with sync, backlinks, neighbor traversal"
```

---

## Task 3: Memory module -- types and schema

**Files:**
- Create: `src/modules/memory/types.ts`
- Create: `src/modules/memory/schema.ts`

- [ ] **Step 1: Create types**

Create `src/modules/memory/types.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

// --- Working Memory ---

export interface WorkingMemoryBlock {
  key: string
  content: string
  maxTokens: number
  createdAt: string
  updatedAt: string
  expiresAt: string
}

// --- Episodic Memory ---

export type EpisodicSourceType = 'conversation' | 'extraction' | 'user' | 'system'

export interface EpisodicMemory {
  id: string
  content: string
  sourceType: EpisodicSourceType
  sourceId: string | null
  salience: number
  accessCount: number
  validFrom: string
  validUntil: string | null
  tags: string[]
  embeddingHash: string | null
  createdAt: string
  lastAccessedAt: string | null
}

export interface CreateEpisodicInput {
  content: string
  sourceType: EpisodicSourceType
  sourceId?: string
  tags?: string[]
  validFrom?: string
}

// --- Archive Memory ---

export interface ArchivedMemory {
  id: string
  originalId: string
  content: string
  sourceType: string
  tags: string[]
  archivedAt: string
  originalCreatedAt: string
}

// --- Vault ---

export type VaultTier = 'semantic' | 'procedural'

export interface VaultFrontmatter {
  title: string
  tags: string[]
  tier: VaultTier
  links: string[]
  created: string
  updated: string
  embedding_hash?: string
}

export interface VaultEntry {
  path: string
  frontmatter: VaultFrontmatter
  content: string
}

export interface VaultIndexRecord {
  path: string
  title: string
  tier: VaultTier
  tags: string
  contentText: string
  embeddingHash: string | null
  fileHash: string
  indexedAt: string
}

// --- Search ---

export interface MemorySearchQuery {
  query: string
  tiers?: ('episodic' | 'semantic' | 'procedural' | 'archive')[]
  tags?: string[]
  limit?: number
  validOnly?: boolean
}

export interface MemorySearchResult {
  source: 'episodic' | 'vault' | 'archive' | 'knowledge'
  id: string
  content: string
  score: number
  metadata: Record<string, unknown>
}

// --- Context Builder ---

export interface ContextSource {
  tier: string
  id: string
  tokens: number
}

export interface ContextBuildResult {
  workingBlocks: WorkingMemoryBlock[]
  relevantMemories: MemorySearchResult[]
  totalTokens: number
  sources: ContextSource[]
}

// --- Memory Config ---

export interface MemoryConfig {
  working: {
    ttlHours: number
    defaultBlocks: string[]
    maxTokensPerBlock: number
  }
  episodic: {
    decayRate: number
    promotionThreshold: number
    promotionMinAccess: number
    demotionThreshold: number
    demotionAgeDays: number
  }
  vault: {
    path: string
    watch: boolean
  }
  consolidation: {
    implicitExtraction: boolean
    autoDreamCron: string
    autoDreamModel: string
  }
  search: {
    contextBudgetTokens: number
    rrfK: number
    ftsWeightDefault: number
    vectorWeightDefault: number
  }
}

// --- Module Context Extension ---

export interface MemoryContext {
  working: import('./tiers/working-memory.js').WorkingMemoryService
  episodic: import('./tiers/episodic-memory.js').EpisodicMemoryService
  archive: import('./tiers/archive-memory.js').ArchiveMemoryService
  search: (query: MemorySearchQuery) => Promise<MemorySearchResult[]>
}
```

- [ ] **Step 2: Create schema (SQL table definitions)**

Create `src/modules/memory/schema.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export function createMemoryTables(db: EyasDb) {
  db.run(sql`CREATE TABLE IF NOT EXISTS working_memory (
    key TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    max_tokens INTEGER DEFAULT 500,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`)

  db.run(sql`CREATE TABLE IF NOT EXISTS episodic_memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT,
    salience REAL DEFAULT 1.0,
    access_count INTEGER DEFAULT 0,
    valid_from TEXT NOT NULL,
    valid_until TEXT,
    tags TEXT,
    embedding_hash TEXT,
    created_at TEXT NOT NULL,
    last_accessed_at TEXT
  )`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_episodic_salience ON episodic_memories(salience DESC)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_episodic_valid ON episodic_memories(valid_from, valid_until)`)

  db.run(sql`CREATE TABLE IF NOT EXISTS archive_memories (
    id TEXT PRIMARY KEY,
    original_id TEXT NOT NULL,
    content TEXT NOT NULL,
    source_type TEXT NOT NULL,
    tags TEXT,
    archived_at TEXT NOT NULL,
    original_created_at TEXT NOT NULL
  )`)

  db.run(sql`CREATE TABLE IF NOT EXISTS vault_index (
    path TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    tier TEXT NOT NULL,
    tags TEXT,
    content_text TEXT NOT NULL,
    embedding_hash TEXT,
    file_hash TEXT NOT NULL,
    indexed_at TEXT NOT NULL
  )`)

  db.run(sql`CREATE VIRTUAL TABLE IF NOT EXISTS vault_fts USING fts5(
    path, title, content_text,
    content='vault_index',
    content_rowid='rowid'
  )`)

  db.run(sql`CREATE VIRTUAL TABLE IF NOT EXISTS episodic_fts USING fts5(
    id, content,
    content='episodic_memories',
    content_rowid='rowid'
  )`)
}
```

- [ ] **Step 3: Commit**

```
git add src/modules/memory/types.ts src/modules/memory/schema.ts
git commit -m "feat(memory): add type definitions and database schema"
```

---

## Task 4: Working memory tier

**Files:**
- Create: `src/modules/memory/tiers/working-memory.ts`
- Test: `src/modules/memory/__tests__/working-memory.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/memory/__tests__/working-memory.test.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'bun:sqlite'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { createMemoryTables } from '../schema.js'
import { createWorkingMemoryService } from '../tiers/working-memory.js'

function createTestDb() {
  const sqlite = new Database(':memory:')
  return drizzle(sqlite)
}

describe('WorkingMemoryService', () => {
  let db: ReturnType<typeof createTestDb>
  let service: ReturnType<typeof createWorkingMemoryService>

  beforeEach(() => {
    db = createTestDb()
    createMemoryTables(db)
    service = createWorkingMemoryService(db, { ttlHours: 24, maxTokensPerBlock: 500 })
  })

  it('creates and retrieves a block', () => {
    service.set('user_context', 'Krisztian is a DevOps engineer')
    const block = service.get('user_context')
    expect(block).not.toBeNull()
    expect(block!.content).toBe('Krisztian is a DevOps engineer')
    expect(block!.key).toBe('user_context')
  })

  it('updates an existing block', () => {
    service.set('user_context', 'initial')
    service.set('user_context', 'updated content')
    const block = service.get('user_context')
    expect(block!.content).toBe('updated content')
  })

  it('lists all blocks', () => {
    service.set('user_context', 'content 1')
    service.set('current_task', 'content 2')
    const blocks = service.listAll()
    expect(blocks).toHaveLength(2)
  })

  it('deletes a block', () => {
    service.set('user_context', 'content')
    service.delete('user_context')
    expect(service.get('user_context')).toBeNull()
  })

  it('cleans up expired blocks', () => {
    service.set('old_block', 'expired content')
    db.run(sql`UPDATE working_memory SET expires_at = '2020-01-01T00:00:00.000Z' WHERE key = 'old_block'`)
    service.cleanupExpired()
    expect(service.get('old_block')).toBeNull()
  })

  it('returns null for non-existent key', () => {
    expect(service.get('nonexistent')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run src/modules/memory/__tests__/working-memory.test.ts`
Expected: FAIL -- module not found.

- [ ] **Step 3: Implement working memory service**

Create `src/modules/memory/tiers/working-memory.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import type { WorkingMemoryBlock } from '../types.js'

interface WorkingMemoryConfig {
  ttlHours: number
  maxTokensPerBlock: number
}

export function createWorkingMemoryService(db: EyasDb, config: WorkingMemoryConfig) {
  function expiresAt(): string {
    const d = new Date()
    d.setHours(d.getHours() + config.ttlHours)
    return d.toISOString()
  }

  return {
    get(key: string): WorkingMemoryBlock | null {
      const rows = (db as any).all(
        sql`SELECT * FROM working_memory WHERE key = ${key} AND expires_at > ${new Date().toISOString()}`
      ) as any[]
      if (rows.length === 0) return null
      const r = rows[0]
      return {
        key: r.key,
        content: r.content,
        maxTokens: r.max_tokens,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        expiresAt: r.expires_at,
      }
    },

    set(key: string, content: string, maxTokens?: number) {
      const now = new Date().toISOString()
      const exp = expiresAt()
      const tokens = maxTokens ?? config.maxTokensPerBlock

      const existing = (db as any).all(sql`SELECT key FROM working_memory WHERE key = ${key}`) as any[]
      if (existing.length > 0) {
        db.run(sql`UPDATE working_memory SET content = ${content}, max_tokens = ${tokens},
          updated_at = ${now}, expires_at = ${exp} WHERE key = ${key}`)
      } else {
        db.run(sql`INSERT INTO working_memory (key, content, max_tokens, created_at, updated_at, expires_at)
          VALUES (${key}, ${content}, ${tokens}, ${now}, ${now}, ${exp})`)
      }
    },

    delete(key: string) {
      db.run(sql`DELETE FROM working_memory WHERE key = ${key}`)
    },

    listAll(): WorkingMemoryBlock[] {
      const now = new Date().toISOString()
      const rows = (db as any).all(
        sql`SELECT * FROM working_memory WHERE expires_at > ${now} ORDER BY key`
      ) as any[]
      return rows.map((r: any) => ({
        key: r.key,
        content: r.content,
        maxTokens: r.max_tokens,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        expiresAt: r.expires_at,
      }))
    },

    cleanupExpired() {
      db.run(sql`DELETE FROM working_memory WHERE expires_at <= ${new Date().toISOString()}`)
    },
  }
}

export type WorkingMemoryService = ReturnType<typeof createWorkingMemoryService>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run src/modules/memory/__tests__/working-memory.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```
git add src/modules/memory/tiers/working-memory.ts src/modules/memory/__tests__/working-memory.test.ts
git commit -m "feat(memory): implement working memory tier with TTL and labeled blocks"
```

---

## Task 5: Episodic memory tier

**Files:**
- Create: `src/modules/memory/tiers/episodic-memory.ts`
- Test: `src/modules/memory/__tests__/episodic-memory.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/memory/__tests__/episodic-memory.test.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'bun:sqlite'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { createMemoryTables } from '../schema.js'
import { createEpisodicMemoryService } from '../tiers/episodic-memory.js'

function createTestDb() {
  const sqlite = new Database(':memory:')
  return drizzle(sqlite)
}

describe('EpisodicMemoryService', () => {
  let db: ReturnType<typeof createTestDb>
  let service: ReturnType<typeof createEpisodicMemoryService>

  beforeEach(() => {
    db = createTestDb()
    createMemoryTables(db)
    service = createEpisodicMemoryService(db)
  })

  it('creates a memory and retrieves it by id', () => {
    const mem = service.create({ content: 'User prefers dark mode', sourceType: 'conversation', tags: ['preferences'] })
    expect(mem.id).toBeTruthy()
    expect(mem.salience).toBe(1.0)

    const retrieved = service.get(mem.id)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.content).toBe('User prefers dark mode')
    expect(retrieved!.tags).toEqual(['preferences'])
  })

  it('lists valid memories ordered by salience', () => {
    service.create({ content: 'fact A', sourceType: 'extraction' })
    service.create({ content: 'fact B', sourceType: 'extraction' })
    const list = service.list({ validOnly: true, limit: 10 })
    expect(list).toHaveLength(2)
  })

  it('increments access count on touch', () => {
    const mem = service.create({ content: 'fact', sourceType: 'user' })
    service.touch(mem.id)
    service.touch(mem.id)
    const updated = service.get(mem.id)
    expect(updated!.accessCount).toBe(2)
  })

  it('invalidates a memory with valid_until', () => {
    const mem = service.create({ content: 'old fact', sourceType: 'system' })
    service.invalidate(mem.id)
    const updated = service.get(mem.id)
    expect(updated!.validUntil).not.toBeNull()
  })

  it('filters out invalidated memories when validOnly=true', () => {
    const mem = service.create({ content: 'old', sourceType: 'system' })
    service.create({ content: 'current', sourceType: 'system' })
    service.invalidate(mem.id)
    const valid = service.list({ validOnly: true, limit: 10 })
    expect(valid).toHaveLength(1)
    expect(valid[0].content).toBe('current')
  })

  it('applies salience decay', () => {
    const mem = service.create({ content: 'fact', sourceType: 'extraction' })
    const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString()
    db.run(sql`UPDATE episodic_memories SET last_accessed_at = ${tenDaysAgo} WHERE id = ${mem.id}`)
    service.applyDecay(0.95)
    const updated = service.get(mem.id)
    expect(updated!.salience).toBeCloseTo(0.5987, 2)
  })

  it('finds promotion candidates', () => {
    const mem = service.create({ content: 'important fact', sourceType: 'extraction' })
    db.run(sql`UPDATE episodic_memories SET salience = 0.8, access_count = 5 WHERE id = ${mem.id}`)
    const candidates = service.findPromotionCandidates(0.7, 3)
    expect(candidates).toHaveLength(1)
  })

  it('finds demotion candidates', () => {
    const mem = service.create({ content: 'old forgotten fact', sourceType: 'extraction' })
    const oldDate = new Date(Date.now() - 40 * 86400000).toISOString()
    db.run(sql`UPDATE episodic_memories SET salience = 0.1, created_at = ${oldDate} WHERE id = ${mem.id}`)
    const candidates = service.findDemotionCandidates(0.2, 30)
    expect(candidates).toHaveLength(1)
  })

  it('deletes a memory', () => {
    const mem = service.create({ content: 'to delete', sourceType: 'user' })
    service.delete(mem.id)
    expect(service.get(mem.id)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run src/modules/memory/__tests__/episodic-memory.test.ts`

- [ ] **Step 3: Implement episodic memory service**

Create `src/modules/memory/tiers/episodic-memory.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import type { EyasDb } from '@core/types'
import type { EpisodicMemory, CreateEpisodicInput } from '../types.js'

function rowToMemory(r: any): EpisodicMemory {
  return {
    id: r.id, content: r.content, sourceType: r.source_type,
    sourceId: r.source_id, salience: r.salience, accessCount: r.access_count,
    validFrom: r.valid_from, validUntil: r.valid_until,
    tags: r.tags ? JSON.parse(r.tags) : [],
    embeddingHash: r.embedding_hash, createdAt: r.created_at,
    lastAccessedAt: r.last_accessed_at,
  }
}

export function createEpisodicMemoryService(db: EyasDb) {
  return {
    create(input: CreateEpisodicInput): EpisodicMemory {
      const id = generateId()
      const now = new Date().toISOString()
      const tags = input.tags ? JSON.stringify(input.tags) : null
      const validFrom = input.validFrom ?? now

      db.run(sql`INSERT INTO episodic_memories
        (id, content, source_type, source_id, salience, access_count, valid_from, valid_until, tags, created_at, last_accessed_at)
        VALUES (${id}, ${input.content}, ${input.sourceType}, ${input.sourceId ?? null},
                1.0, 0, ${validFrom}, ${null}, ${tags}, ${now}, ${now})`)

      return this.get(id)!
    },

    get(id: string): EpisodicMemory | null {
      const rows = (db as any).all(sql`SELECT * FROM episodic_memories WHERE id = ${id}`) as any[]
      return rows.length > 0 ? rowToMemory(rows[0]) : null
    },

    list(opts: { validOnly?: boolean; limit?: number } = {}): EpisodicMemory[] {
      const limit = opts.limit ?? 50
      const query = opts.validOnly
        ? `SELECT * FROM episodic_memories WHERE valid_until IS NULL ORDER BY salience DESC LIMIT ${limit}`
        : `SELECT * FROM episodic_memories ORDER BY salience DESC LIMIT ${limit}`
      return ((db as any).all(sql.raw(query)) as any[]).map(rowToMemory)
    },

    touch(id: string) {
      const now = new Date().toISOString()
      db.run(sql`UPDATE episodic_memories SET access_count = access_count + 1, last_accessed_at = ${now} WHERE id = ${id}`)
    },

    invalidate(id: string) {
      db.run(sql`UPDATE episodic_memories SET valid_until = ${new Date().toISOString()} WHERE id = ${id}`)
    },

    applyDecay(decayRate: number) {
      const now = Date.now()
      const rows = (db as any).all(
        sql`SELECT id, salience, last_accessed_at FROM episodic_memories WHERE valid_until IS NULL`
      ) as any[]

      for (const row of rows) {
        const lastAccess = row.last_accessed_at ? new Date(row.last_accessed_at).getTime() : now
        const daysSince = Math.max(0, (now - lastAccess) / 86400000)
        const newSalience = row.salience * Math.pow(decayRate, daysSince)
        db.run(sql`UPDATE episodic_memories SET salience = ${newSalience} WHERE id = ${row.id}`)
      }
    },

    findPromotionCandidates(salienceThreshold: number, minAccess: number): EpisodicMemory[] {
      return ((db as any).all(
        sql`SELECT * FROM episodic_memories
            WHERE valid_until IS NULL AND salience > ${salienceThreshold} AND access_count >= ${minAccess}
            ORDER BY salience DESC`
      ) as any[]).map(rowToMemory)
    },

    findDemotionCandidates(salienceThreshold: number, ageDays: number): EpisodicMemory[] {
      const cutoff = new Date(Date.now() - ageDays * 86400000).toISOString()
      return ((db as any).all(
        sql`SELECT * FROM episodic_memories
            WHERE valid_until IS NULL AND salience < ${salienceThreshold} AND created_at < ${cutoff}
            ORDER BY salience ASC`
      ) as any[]).map(rowToMemory)
    },

    delete(id: string) {
      db.run(sql`DELETE FROM episodic_memories WHERE id = ${id}`)
    },
  }
}

export type EpisodicMemoryService = ReturnType<typeof createEpisodicMemoryService>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run src/modules/memory/__tests__/episodic-memory.test.ts`
Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

```
git add src/modules/memory/tiers/episodic-memory.ts src/modules/memory/__tests__/episodic-memory.test.ts
git commit -m "feat(memory): implement episodic memory tier with temporal facts and salience decay"
```

---

## Task 6: Archive memory tier

**Files:**
- Create: `src/modules/memory/tiers/archive-memory.ts`
- Test: `src/modules/memory/__tests__/archive-memory.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/memory/__tests__/archive-memory.test.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { createMemoryTables } from '../schema.js'
import { createArchiveMemoryService } from '../tiers/archive-memory.js'

function createTestDb() {
  const sqlite = new Database(':memory:')
  return drizzle(sqlite)
}

describe('ArchiveMemoryService', () => {
  let db: ReturnType<typeof createTestDb>
  let service: ReturnType<typeof createArchiveMemoryService>

  beforeEach(() => {
    db = createTestDb()
    createMemoryTables(db)
    service = createArchiveMemoryService(db)
  })

  it('archives a memory', () => {
    const archived = service.archive({
      originalId: 'ep-123', content: 'Compressed summary',
      sourceType: 'extraction', tags: ['k8s'],
      originalCreatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(archived.id).toBeTruthy()
    expect(archived.originalId).toBe('ep-123')
  })

  it('lists and searches archived memories', () => {
    service.archive({ originalId: 'ep-1', content: 'kubernetes networking rules', sourceType: 'extraction', tags: [], originalCreatedAt: '2026-01-01T00:00:00.000Z' })
    service.archive({ originalId: 'ep-2', content: 'odoo workflow engine', sourceType: 'user', tags: [], originalCreatedAt: '2026-01-02T00:00:00.000Z' })
    expect(service.list(10)).toHaveLength(2)
    const results = service.search('kubernetes')
    expect(results).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run src/modules/memory/__tests__/archive-memory.test.ts`

- [ ] **Step 3: Implement archive memory service**

Create `src/modules/memory/tiers/archive-memory.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import type { EyasDb } from '@core/types'
import type { ArchivedMemory } from '../types.js'

interface ArchiveInput {
  originalId: string
  content: string
  sourceType: string
  tags: string[]
  originalCreatedAt: string
}

function rowToArchive(r: any): ArchivedMemory {
  return {
    id: r.id, originalId: r.original_id, content: r.content,
    sourceType: r.source_type, tags: r.tags ? JSON.parse(r.tags) : [],
    archivedAt: r.archived_at, originalCreatedAt: r.original_created_at,
  }
}

export function createArchiveMemoryService(db: EyasDb) {
  return {
    archive(input: ArchiveInput): ArchivedMemory {
      const id = generateId()
      const now = new Date().toISOString()
      const tags = input.tags.length > 0 ? JSON.stringify(input.tags) : null

      db.run(sql`INSERT INTO archive_memories
        (id, original_id, content, source_type, tags, archived_at, original_created_at)
        VALUES (${id}, ${input.originalId}, ${input.content}, ${input.sourceType},
                ${tags}, ${now}, ${input.originalCreatedAt})`)

      return this.get(id)!
    },

    get(id: string): ArchivedMemory | null {
      const rows = (db as any).all(sql`SELECT * FROM archive_memories WHERE id = ${id}`) as any[]
      return rows.length > 0 ? rowToArchive(rows[0]) : null
    },

    list(limit: number = 50): ArchivedMemory[] {
      return ((db as any).all(
        sql`SELECT * FROM archive_memories ORDER BY archived_at DESC LIMIT ${limit}`
      ) as any[]).map(rowToArchive)
    },

    search(query: string): ArchivedMemory[] {
      const pattern = `%${query}%`
      return ((db as any).all(
        sql`SELECT * FROM archive_memories WHERE content LIKE ${pattern} ORDER BY archived_at DESC LIMIT 20`
      ) as any[]).map(rowToArchive)
    },
  }
}

export type ArchiveMemoryService = ReturnType<typeof createArchiveMemoryService>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run src/modules/memory/__tests__/archive-memory.test.ts`
Expected: All 2 tests PASS.

- [ ] **Step 5: Commit**

```
git add src/modules/memory/tiers/archive-memory.ts src/modules/memory/__tests__/archive-memory.test.ts
git commit -m "feat(memory): implement archive memory tier with search"
```

---

## Tasks 7-20: Remaining implementation

Tasks 7 through 20 follow the same TDD pattern. Due to plan size, these are listed as summaries. Each task creates the file, writes tests first, implements, verifies, and commits.

### Task 7: Vault frontmatter + wikilink parser
- Create: `src/modules/memory/vault/frontmatter.ts` (gray-matter parse/serialize)
- Create: `src/modules/memory/vault/wikilink-parser.ts` (regex `[[link]]` extraction)
- Test: `src/modules/memory/__tests__/vault-parsers.test.ts`

### Task 8: Vault service + indexer
- Create: `src/modules/memory/vault/vault-service.ts` (CRUD: read/write/delete/list .md files)
- Create: `src/modules/memory/vault/vault-indexer.ts` (markdown to DB index, wikilink sync)
- Test: `src/modules/memory/__tests__/vault-service.test.ts`

### Task 9: Hybrid search (FTS + graph + RRF)
- Create: `src/modules/memory/search/hybrid-search.ts` (query routing, RRF fusion)
- Create: `src/modules/memory/search/graph-search.ts` (1-hop neighbor boost)
- Test: `src/modules/memory/__tests__/hybrid-search.test.ts`

### Task 10: Context builder
- Create: `src/modules/memory/search/context-builder.ts` (token budget, priority injection)
- Test: `src/modules/memory/__tests__/context-builder.test.ts`

### Task 11: Memory module registration + routes + config
- Create: `src/modules/memory/index.ts` (EyasModule definition)
- Create: `src/modules/memory/memory-service.ts` (unified API)
- Create: `src/modules/memory/routes.ts` (API endpoints)
- Create: `config/personality/memory.yaml`
- Modify: `src/core/bootstrap.ts` (register memoryModule)
- Modify: `src/core/types.ts` (add memory to ModuleContext)

### Task 12: Knowledge module -- types, schema, service
- Create: `src/modules/knowledge/types.ts`
- Create: `src/modules/knowledge/schema.ts`
- Create: `src/modules/knowledge/knowledge-service.ts` (CRUD, versioning, page tree)
- Test: `src/modules/knowledge/__tests__/knowledge-service.test.ts`

### Task 13: Knowledge module -- routes and registration
- Create: `src/modules/knowledge/routes.ts`
- Create: `src/modules/knowledge/index.ts`
- Create: `config/personality/knowledge.yaml`
- Modify: `src/core/bootstrap.ts` (register knowledgeModule)
- Modify: `src/core/types.ts` (add knowledge to ModuleContext)

### Task 14: Consolidation -- implicit extractor and decay
- Create: `src/modules/memory/consolidation/implicit-extractor.ts`
- Create: `src/modules/memory/consolidation/decay.ts`
- Test: `src/modules/memory/__tests__/consolidation.test.ts`

### Task 15: Frontend -- Knowledge sidebar integration
- Modify: `src/web/src/components/layout/sidebar.tsx` (add Knowledge collapsible group)
- Create: `src/web/src/stores/knowledge-store.ts` (Zustand store)
- Create: `src/web/src/pages/knowledge/knowledge-sidebar-tree.tsx`

### Task 16: Frontend -- Knowledge page view with Plate editor
- Create: `src/web/src/pages/knowledge/knowledge-page.tsx`
- Create: `src/web/src/pages/knowledge/plate-editor.tsx` (Plate wrapper)
- Create: `src/web/src/routes/knowledge.tsx`
- Create: `src/web/src/routes/knowledge.$spaceSlug.$pageSlug.tsx`

### Task 17: Embedding bridge (model module integration)
- Create: `src/modules/memory/embeddings/types.ts`
- Create: `src/modules/memory/embeddings/model-bridge.ts`

### Task 18: Vault file watcher
- Create: `src/modules/memory/vault/vault-watcher.ts`
- Modify: `src/modules/memory/index.ts` (wire watcher into onStart)

### Task 19: Integration test -- full module startup
- Create: `src/modules/memory/__tests__/integration.test.ts`
- Tests: shared wikilink graph between memory + knowledge, full lifecycle

### Task 20: Run all tests and final verification
- Run all memory, knowledge, shared tests
- TypeScript check (`bunx tsc --noEmit`)
- Start server and verify module registration
- Test API endpoints manually

---

**Implementation details for Tasks 7-20** are fully specified in the conversation history. The implementing agent should reference the spec at `docs/superpowers/specs/2026-04-02-memory-knowledge-design.md` and follow the exact EYAS module patterns documented above (factory functions, Hono routes, Zustand stores, TanStack Router file routes).
