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

  function rowToBlock(r: any): WorkingMemoryBlock {
    return {
      key: r.key,
      content: r.content,
      maxTokens: r.max_tokens,
      accessCount: r.access_count ?? 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      expiresAt: r.expires_at,
    }
  }

  return {
    get(key: string): WorkingMemoryBlock | null {
      const rows = (db as any).all(
        sql`SELECT * FROM working_memory WHERE key = ${key} AND expires_at > ${new Date().toISOString()}`
      ) as any[]
      if (rows.length === 0) return null
      // Track access
      db.run(sql`UPDATE working_memory SET access_count = access_count + 1 WHERE key = ${key}`)
      return rowToBlock(rows[0])
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
      return rows.map(rowToBlock)
    },

    /** Find working memory blocks accessed more than `minAccess` times — candidates for episodic promotion */
    findPromotionCandidates(minAccess: number = 3): WorkingMemoryBlock[] {
      const now = new Date().toISOString()
      const rows = (db as any).all(
        sql`SELECT * FROM working_memory WHERE expires_at > ${now} AND access_count >= ${minAccess} ORDER BY access_count DESC`
      ) as any[]
      return rows.map(rowToBlock)
    },

    listByPrefix(prefix: string): WorkingMemoryBlock[] {
      const rows = (db as any).all(
        sql`SELECT * FROM working_memory WHERE key LIKE ${prefix + '%'} AND expires_at > ${new Date().toISOString()}`
      ) as any[]
      return rows.map(rowToBlock)
    },

    cleanupExpired() {
      db.run(sql`DELETE FROM working_memory WHERE expires_at <= ${new Date().toISOString()}`)
    },
  }
}

export type WorkingMemoryService = ReturnType<typeof createWorkingMemoryService>
