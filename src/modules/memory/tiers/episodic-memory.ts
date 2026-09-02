// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import type { EyasDb } from '@core/types'
import type { EpisodicMemory, CreateEpisodicInput } from '../types.js'

function rowToMemory(r: any): EpisodicMemory {
  return {
    id: r.id, content: r.content, sourceType: r.source_type,
    sourceId: r.source_id, salience: r.salience, accessCount: r.access_count,
    conversationCount: r.conversation_count ?? 1,
    validFrom: r.valid_from, validUntil: r.valid_until,
    tags: r.tags ? JSON.parse(r.tags) : [],
    embeddingHash: r.embedding_hash, agentId: r.agent_id ?? null,
    conversationId: r.conversation_id ?? null, projectId: r.project_id ?? null,
    createdAt: r.created_at, lastAccessedAt: r.last_accessed_at,
  }
}

export interface EpisodicServiceHooks {
  /** Fired after a new episodic row is committed. Safe to invoke async work here. */
  onCreated?: (memory: EpisodicMemory) => void
  /** Fired after invalidate/delete so downstream indices can drop the row. */
  onRemoved?: (id: string) => void
}

export function createEpisodicMemoryService(db: EyasDb, hooks: EpisodicServiceHooks = {}) {
  return {
    create(input: CreateEpisodicInput): EpisodicMemory {
      const id = generateId()
      const now = new Date().toISOString()
      const tags = input.tags ? JSON.stringify(input.tags) : null
      const validFrom = input.validFrom ?? now

      db.run(sql`INSERT INTO episodic_memories
        (id, content, source_type, source_id, salience, access_count, valid_from, valid_until, tags, agent_id, conversation_id, project_id, created_at, last_accessed_at)
        VALUES (${id}, ${input.content}, ${input.sourceType}, ${input.sourceId ?? null},
                1.0, 0, ${validFrom}, ${null}, ${tags}, ${input.agentId ?? null},
                ${input.conversationId ?? null}, ${input.projectId ?? null}, ${now}, ${now})`)

      const memory = this.get(id)!
      try { hooks.onCreated?.(memory) } catch { /* hooks are best-effort */ }
      return memory
    },

    get(id: string): EpisodicMemory | null {
      const rows = (db as any).all(sql`SELECT * FROM episodic_memories WHERE id = ${id}`) as any[]
      return rows.length > 0 ? rowToMemory(rows[0]) : null
    },

    list(opts: { validOnly?: boolean; limit?: number; agentId?: string; includeShared?: boolean } = {}): EpisodicMemory[] {
      const limit = Math.max(1, Math.min(10000, Math.floor(opts.limit ?? 50)))
      const validOnly = opts.validOnly ?? false
      const agentId = opts.agentId ?? null
      const includeShared = opts.includeShared ?? false

      // Build a single parameterized query — no string interpolation of user input.
      if (agentId && validOnly && includeShared) {
        return ((db as any).all(sql`SELECT * FROM episodic_memories
          WHERE valid_until IS NULL AND (agent_id = ${agentId} OR agent_id IS NULL)
          ORDER BY salience DESC LIMIT ${sql.raw(String(limit))}`) as any[]).map(rowToMemory)
      }
      if (agentId && validOnly) {
        return ((db as any).all(sql`SELECT * FROM episodic_memories
          WHERE valid_until IS NULL AND agent_id = ${agentId}
          ORDER BY salience DESC LIMIT ${sql.raw(String(limit))}`) as any[]).map(rowToMemory)
      }
      if (agentId && includeShared) {
        return ((db as any).all(sql`SELECT * FROM episodic_memories
          WHERE (agent_id = ${agentId} OR agent_id IS NULL)
          ORDER BY salience DESC LIMIT ${sql.raw(String(limit))}`) as any[]).map(rowToMemory)
      }
      if (agentId) {
        return ((db as any).all(sql`SELECT * FROM episodic_memories
          WHERE agent_id = ${agentId}
          ORDER BY salience DESC LIMIT ${sql.raw(String(limit))}`) as any[]).map(rowToMemory)
      }
      if (validOnly) {
        return ((db as any).all(sql`SELECT * FROM episodic_memories
          WHERE valid_until IS NULL
          ORDER BY salience DESC LIMIT ${sql.raw(String(limit))}`) as any[]).map(rowToMemory)
      }
      return ((db as any).all(sql`SELECT * FROM episodic_memories
        ORDER BY salience DESC LIMIT ${sql.raw(String(limit))}`) as any[]).map(rowToMemory)
    },

    touch(id: string) {
      const now = new Date().toISOString()
      db.run(sql`UPDATE episodic_memories SET access_count = access_count + 1, last_accessed_at = ${now} WHERE id = ${id}`)
    },

    /** Increment conversation_count — called when a memory is accessed from a new conversation */
    touchConversation(id: string) {
      db.run(sql`UPDATE episodic_memories SET conversation_count = conversation_count + 1 WHERE id = ${id}`)
    },

    invalidate(id: string) {
      db.run(sql`UPDATE episodic_memories SET valid_until = ${new Date().toISOString()} WHERE id = ${id}`)
      try { hooks.onRemoved?.(id) } catch { /* best-effort */ }
    },

    /**
     * Apply time-based decay. Conversation-aware: memories used across multiple
     * conversations decay slower. Effective exponent = daysSince / conversationCount.
     *
     * Single SQL expression instead of per-row UPDATE (N+1). SQLite supports
     * julianday/strftime for date math and POW() via math functions; to stay
     * portable we compute effectiveDays using julianday() and use exp(log(rate)*exp)
     * which SQLite's built-in math (sqlite >= 3.35 with -DSQLITE_ENABLE_MATH_FUNCTIONS)
     * supports. When the runtime lacks math functions we fall back to per-row JS.
     */
    applyDecay(decayRate: number) {
      const nowIso = new Date().toISOString()
      // Try the fast path: single UPDATE with SQL-side arithmetic.
      try {
        db.run(sql`
          UPDATE episodic_memories
          SET salience = MAX(
            0.01,
            salience * POW(
              ${decayRate},
              MAX(0, (julianday(${nowIso}) - julianday(COALESCE(last_accessed_at, created_at))))
                / MAX(1, COALESCE(conversation_count, 1))
            )
          )
          WHERE valid_until IS NULL
        `)
        return
      } catch {
        // Fallback for sqlite builds without POW() — do per-row JS arithmetic.
      }
      const now = Date.now()
      const rows = (db as any).all(
        sql`SELECT id, salience, last_accessed_at, conversation_count FROM episodic_memories WHERE valid_until IS NULL`
      ) as any[]
      for (const row of rows) {
        const lastAccess = row.last_accessed_at ? new Date(row.last_accessed_at).getTime() : now
        const daysSince = Math.max(0, (now - lastAccess) / 86400000)
        const convCount = Math.max(1, row.conversation_count ?? 1)
        const effectiveDays = daysSince / convCount
        const newSalience = Math.max(0.01, row.salience * Math.pow(decayRate, effectiveDays))
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
      try { hooks.onRemoved?.(id) } catch { /* best-effort */ }
    },
  }
}

export type EpisodicMemoryService = ReturnType<typeof createEpisodicMemoryService>
