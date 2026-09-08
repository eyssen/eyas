// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Operator SaaS/subscription cost ledger — fixed monthly costs + budgets.
// No LLM, no provider API pricing (token cost lives in observability).

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export interface FixedCost {
  sourceId: string
  name: string
  provider: string
  sourceType: string
  amount: number
  currency?: string
  confidence?: string
}

export interface Budget {
  id: string
  name: string
  amount: number
  warningThreshold: number
  hardThreshold: number
}

export interface CostopsConfig {
  currency: string
  fixedCosts: FixedCost[]
  budgets: Budget[]
}

export interface CostopsService {
  getConfig(): CostopsConfig
  saveConfig(cfg: CostopsConfig): void
  recordLineItem(input: {
    sourceId: string
    period: string
    amount: number
    currency?: string
    note?: string
    dedupKey?: string
  }): { id: string; created: boolean }
  listLineItems(opts?: { period?: string; limit?: number }): any[]
  monthlySummary(period?: string): {
    period: string
    currency: string
    fixedTotal: number
    lineItemsTotal: number
    total: number
    budgets: Array<Budget & { spent: number; ratio: number; status: 'ok' | 'warning' | 'hard' }>
  }
}

const DEFAULT_CONFIG: CostopsConfig = {
  currency: 'HUF',
  fixedCosts: [],
  budgets: [],
}

export function createCostopsTables(db: EyasDb): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS cost_line_items (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    period TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'HUF',
    note TEXT,
    dedup_key TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_cost_line_period ON cost_line_items(period)`)
}

function currentPeriod(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function createCostopsService(opts: {
  db: EyasDb
  configPath: string
}): CostopsService {
  const { db, configPath } = opts

  function loadConfig(): CostopsConfig {
    try {
      if (!existsSync(configPath)) {
        mkdirSync(dirname(configPath), { recursive: true })
        const example = { ...DEFAULT_CONFIG, fixedCosts: [], budgets: [] }
        writeFileSync(configPath, JSON.stringify(example, null, 2), 'utf-8')
        return example
      }
      const raw = JSON.parse(readFileSync(configPath, 'utf-8'))
      return {
        currency: raw.currency ?? 'HUF',
        fixedCosts: Array.isArray(raw.fixedCosts) ? raw.fixedCosts : (raw.fixed_costs ?? []),
        budgets: Array.isArray(raw.budgets) ? raw.budgets : [],
      }
    } catch {
      return { ...DEFAULT_CONFIG }
    }
  }

  return {
    getConfig: loadConfig,

    saveConfig(cfg) {
      mkdirSync(dirname(configPath), { recursive: true })
      writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8')
    },

    recordLineItem(input) {
      if (input.dedupKey) {
        const existing = db.all(sql`SELECT id FROM cost_line_items WHERE dedup_key = ${input.dedupKey} LIMIT 1`) as any[]
        if (existing[0]) {
          db.run(sql`
            UPDATE cost_line_items SET amount = ${input.amount}, note = ${input.note ?? null}
            WHERE id = ${existing[0].id}
          `)
          return { id: existing[0].id, created: false }
        }
      }
      const id = randomUUID()
      db.run(sql`
        INSERT INTO cost_line_items (id, source_id, period, amount, currency, note, dedup_key)
        VALUES (
          ${id},
          ${input.sourceId},
          ${input.period},
          ${input.amount},
          ${input.currency ?? 'HUF'},
          ${input.note ?? null},
          ${input.dedupKey ?? null}
        )
      `)
      return { id, created: true }
    },

    listLineItems(opts = {}) {
      const limit = opts.limit ?? 200
      if (opts.period) {
        return db.all(sql`SELECT * FROM cost_line_items WHERE period = ${opts.period} ORDER BY created_at DESC LIMIT ${limit}`)
      }
      return db.all(sql`SELECT * FROM cost_line_items ORDER BY created_at DESC LIMIT ${limit}`)
    },

    monthlySummary(period) {
      const p = period ?? currentPeriod()
      const cfg = loadConfig()
      const fixedTotal = cfg.fixedCosts.reduce((s, c) => s + (Number(c.amount) || 0), 0)
      const rows = db.all(sql`SELECT amount FROM cost_line_items WHERE period = ${p}`) as Array<{ amount: number }>
      const lineItemsTotal = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)
      const total = fixedTotal + lineItemsTotal
      const budgets = cfg.budgets.map((b) => {
        const ratio = b.amount > 0 ? total / b.amount : 0
        let status: 'ok' | 'warning' | 'hard' = 'ok'
        if (ratio >= (b.hardThreshold ?? 1)) status = 'hard'
        else if (ratio >= (b.warningThreshold ?? 0.8)) status = 'warning'
        return { ...b, spent: total, ratio, status }
      })
      return {
        period: p,
        currency: cfg.currency,
        fixedTotal,
        lineItemsTotal,
        total,
        budgets,
      }
    },
  }
}

export function defaultCostopsConfigPath(dataDir = 'data'): string {
  return join(dataDir, 'costops-config.json')
}
