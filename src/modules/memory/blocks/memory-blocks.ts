// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * F4 — Letta-style shared memory blocks.
 *
 * Scopes:
 * - company  — shared org knowledge every agent can read (write = yellow)
 * - agent    — per-agent long-lived identity/facts
 * - team     — per team_session_id (complements team_memory table)
 * - run      — ephemeral run-scoped notes (auto-expire)
 *
 * Guarded writes: agents may only append/update via tools; soul/identity
 * files stay on the workspace writer path.
 */

import { sql } from 'drizzle-orm'

export type MemoryBlockScope = 'company' | 'agent' | 'team' | 'run'

export interface MemoryBlock {
  id: string
  scope: MemoryBlockScope
  scopeId: string
  key: string
  content: string
  version: number
  updatedBy: string | null
  createdAt: string
  updatedAt: string
}

export interface MemoryBlockService {
  ensureTables(): void
  get(scope: MemoryBlockScope, scopeId: string, key: string): MemoryBlock | null
  list(scope: MemoryBlockScope, scopeId: string): MemoryBlock[]
  upsert(input: {
    scope: MemoryBlockScope
    scopeId: string
    key: string
    content: string
    updatedBy?: string
  }): MemoryBlock
  append(input: {
    scope: MemoryBlockScope
    scopeId: string
    key: string
    content: string
    updatedBy?: string
  }): MemoryBlock
  remove(scope: MemoryBlockScope, scopeId: string, key: string): boolean
  /** Compact view for prompt injection (token-bounded). */
  formatForPrompt(scope: MemoryBlockScope, scopeId: string, maxChars?: number): string
}

function rowToBlock(r: any): MemoryBlock {
  return {
    id: r.id,
    scope: r.scope,
    scopeId: r.scope_id,
    key: r.key,
    content: r.content,
    version: r.version,
    updatedBy: r.updated_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function blockId(scope: MemoryBlockScope, scopeId: string, key: string): string {
  return `${scope}:${scopeId}:${key}`
}

export function createMemoryBlockService(db: any): MemoryBlockService {
  const ensureTables = () => {
    db.run(sql`CREATE TABLE IF NOT EXISTS memory_blocks (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      key TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(scope, scope_id, key)
    )`)
    db.run(sql`CREATE INDEX IF NOT EXISTS idx_memory_blocks_scope ON memory_blocks(scope, scope_id)`)
  }

  return {
    ensureTables,

    get(scope, scopeId, key) {
      ensureTables()
      const rows = db.all(
        sql`SELECT * FROM memory_blocks WHERE scope = ${scope} AND scope_id = ${scopeId} AND key = ${key}`,
      ) as any[]
      return rows[0] ? rowToBlock(rows[0]) : null
    },

    list(scope, scopeId) {
      ensureTables()
      const rows = db.all(
        sql`SELECT * FROM memory_blocks WHERE scope = ${scope} AND scope_id = ${scopeId} ORDER BY key`,
      ) as any[]
      return rows.map(rowToBlock)
    },

    upsert(input) {
      ensureTables()
      const now = new Date().toISOString()
      const id = blockId(input.scope, input.scopeId, input.key)
      const existing = this.get(input.scope, input.scopeId, input.key)
      if (existing) {
        const version = existing.version + 1
        db.run(sql`UPDATE memory_blocks SET content = ${input.content}, version = ${version},
          updated_by = ${input.updatedBy ?? null}, updated_at = ${now} WHERE id = ${existing.id}`)
        return { ...existing, content: input.content, version, updatedBy: input.updatedBy ?? null, updatedAt: now }
      }
      db.run(sql`INSERT INTO memory_blocks (id, scope, scope_id, key, content, version, updated_by, created_at, updated_at)
        VALUES (${id}, ${input.scope}, ${input.scopeId}, ${input.key}, ${input.content}, 1,
                ${input.updatedBy ?? null}, ${now}, ${now})`)
      return {
        id,
        scope: input.scope,
        scopeId: input.scopeId,
        key: input.key,
        content: input.content,
        version: 1,
        updatedBy: input.updatedBy ?? null,
        createdAt: now,
        updatedAt: now,
      }
    },

    append(input) {
      const existing = this.get(input.scope, input.scopeId, input.key)
      const next = existing
        ? `${existing.content.trimEnd()}\n${input.content}`.trim()
        : input.content
      return this.upsert({ ...input, content: next })
    },

    remove(scope, scopeId, key) {
      ensureTables()
      const before = this.get(scope, scopeId, key)
      if (!before) return false
      db.run(sql`DELETE FROM memory_blocks WHERE id = ${before.id}`)
      return true
    },

    formatForPrompt(scope, scopeId, maxChars = 4000) {
      const blocks = this.list(scope, scopeId)
      if (!blocks.length) return ''
      const parts: string[] = [`## Memory blocks (${scope}/${scopeId})`]
      let used = parts[0].length
      for (const b of blocks) {
        const chunk = `### ${b.key} (v${b.version})\n${b.content}`
        if (used + chunk.length + 2 > maxChars) {
          parts.push(`…(+${blocks.length - parts.length + 1} more blocks truncated)`)
          break
        }
        parts.push(chunk)
        used += chunk.length + 2
      }
      return parts.join('\n\n')
    },
  }
}
