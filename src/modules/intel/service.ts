// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { createHash, randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export type FactStatus = 'new' | 'evolving' | 'stable' | 'closed'

export interface AddFactInput {
  title: string
  content: string
  domain?: string
  source?: string
  tier?: number
  priority?: number
  expiresAt?: string
}

export interface IntelService {
  addFact(input: AddFactInput): { id: string; created: boolean }
  listFacts(opts?: { domain?: string; status?: string; sinceDays?: number; limit?: number }): any[]
  addWatch(input: { title: string; domain?: string; reason?: string }): string
  listWatch(opts?: { status?: string }): any[]
  addDecision(input: {
    recommendation: string
    reasoning?: string
    assumption?: string
    evidence?: string
    whatWouldFalsify?: string
  }): string
  listDecisions(limit?: number): any[]
  setFocus(topic: string, mode?: 'deep' | 'transient', expiresAt?: string): string
  listFocus(): any[]
  buildDailyBrief(sinceDays?: number): {
    topSignals: any[]
    byDomain: Record<string, any[]>
    watchlist: any[]
    decisions: any[]
    generatedAt: string
  }
}

function factHash(title: string, content: string, domain: string): string {
  return createHash('sha256').update(`${domain}|${title.trim().toLowerCase()}|${content.trim()}`).digest('hex').slice(0, 32)
}

export function createIntelService(db: EyasDb): IntelService {
  return {
    addFact(input) {
      const domain = input.domain ?? 'general'
      const hash = factHash(input.title, input.content, domain)
      const existing = db.all(sql`SELECT id, status FROM intel_facts WHERE fact_hash = ${hash} LIMIT 1`) as Array<{ id: string; status: string }>
      if (existing[0]) {
        const nextStatus = existing[0].status === 'new' ? 'evolving' : existing[0].status
        db.run(sql`
          UPDATE intel_facts SET
            content = ${input.content},
            priority_score = ${input.priority ?? 0.5},
            source = COALESCE(${input.source ?? null}, source),
            status = ${nextStatus},
            updated_at = datetime('now')
          WHERE id = ${existing[0].id}
        `)
        return { id: existing[0].id, created: false }
      }
      const id = randomUUID()
      db.run(sql`
        INSERT INTO intel_facts (id, title, domain, source, source_tier, status, priority_score, content, fact_hash, expires_at)
        VALUES (
          ${id},
          ${input.title},
          ${domain},
          ${input.source ?? null},
          ${input.tier ?? 2},
          'new',
          ${input.priority ?? 0.5},
          ${input.content},
          ${hash},
          ${input.expiresAt ?? null}
        )
      `)
      return { id, created: true }
    },

    listFacts(opts = {}) {
      const sinceDays = opts.sinceDays ?? 14
      const limit = opts.limit ?? 100
      // Parameterized filter pieces — status/domain optional
      if (opts.domain && opts.status) {
        return db.all(sql`
          SELECT * FROM intel_facts
          WHERE domain = ${opts.domain} AND status = ${opts.status}
            AND updated_at >= datetime('now', ${`-${sinceDays} days`})
            AND status != 'closed'
          ORDER BY priority_score DESC, updated_at DESC
          LIMIT ${limit}
        `)
      }
      if (opts.domain) {
        return db.all(sql`
          SELECT * FROM intel_facts
          WHERE domain = ${opts.domain}
            AND updated_at >= datetime('now', ${`-${sinceDays} days`})
            AND status != 'closed'
          ORDER BY priority_score DESC, updated_at DESC
          LIMIT ${limit}
        `)
      }
      return db.all(sql`
        SELECT * FROM intel_facts
        WHERE updated_at >= datetime('now', ${`-${sinceDays} days`})
          AND status != 'closed'
        ORDER BY priority_score DESC, updated_at DESC
        LIMIT ${limit}
      `)
    },

    addWatch(input) {
      const id = randomUUID()
      db.run(sql`
        INSERT INTO intel_watchlist (id, title, domain, reason)
        VALUES (${id}, ${input.title}, ${input.domain ?? 'general'}, ${input.reason ?? null})
      `)
      return id
    },

    listWatch(opts = {}) {
      if (opts.status) {
        return db.all(sql`SELECT * FROM intel_watchlist WHERE status = ${opts.status} ORDER BY updated_at DESC`)
      }
      return db.all(sql`SELECT * FROM intel_watchlist WHERE status = 'open' ORDER BY updated_at DESC`)
    },

    addDecision(input) {
      const id = randomUUID()
      db.run(sql`
        INSERT INTO intel_decisions (id, recommendation, reasoning, assumption, evidence, what_would_falsify)
        VALUES (
          ${id},
          ${input.recommendation},
          ${input.reasoning ?? null},
          ${input.assumption ?? null},
          ${input.evidence ?? null},
          ${input.whatWouldFalsify ?? null}
        )
      `)
      return id
    },

    listDecisions(limit = 20) {
      return db.all(sql`SELECT * FROM intel_decisions ORDER BY created_at DESC LIMIT ${limit}`)
    },

    setFocus(topic, mode = 'transient', expiresAt) {
      const id = randomUUID()
      db.run(sql`
        INSERT INTO intel_focus (id, topic, mode, expires_at)
        VALUES (${id}, ${topic}, ${mode}, ${expiresAt ?? null})
      `)
      return id
    },

    listFocus() {
      return db.all(sql`
        SELECT * FROM intel_focus
        WHERE expires_at IS NULL OR expires_at > datetime('now')
        ORDER BY created_at DESC
      `)
    },

    buildDailyBrief(sinceDays = 14) {
      const facts = this.listFacts({ sinceDays, limit: 50 }) as any[]
      const topSignals = [...facts].sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0)).slice(0, 3)
      const byDomain: Record<string, any[]> = {}
      for (const f of facts) {
        const d = f.domain ?? 'general'
        if (!byDomain[d]) byDomain[d] = []
        byDomain[d]!.push(f)
      }
      return {
        topSignals,
        byDomain,
        watchlist: this.listWatch({ status: 'open' }),
        decisions: this.listDecisions(10),
        generatedAt: new Date().toISOString(),
      }
    },
  }
}
