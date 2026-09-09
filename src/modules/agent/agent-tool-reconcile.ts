// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/agent/agent-tool-reconcile.ts
//
// New tools do not reach agents that already exist.
//
// An agent definition carries an explicit tool allow-list, written from a
// template at first-run setup. Templates materialise once; the row then never
// changes. So every tool shipped afterwards is invisible to every agent on
// every existing install — silently, because an allow-list that omits a tool
// looks exactly like an allow-list that never wanted it.
//
// That is how the design tools reached nobody: they were registered, the
// bridge would have served them, and the one agent that gets asked to make
// things had a thirty-entry list written before the design module existed.
//
// The fix is the seed-migration pattern the design prompt already uses: keep
// the tool set every previously shipped template had, and upgrade ONLY rows
// that still match one exactly. An operator who edited an agent's tools has
// made a decision, and it is not this function's business to overrule it.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export interface ToolsetUpgrade {
  /** A tool set exactly as some earlier version of EYAS shipped it. */
  prior: readonly string[]
  /** What that template grants now. */
  current: readonly string[]
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const seen = new Set(a)
  return b.every((x) => seen.has(x))
}

function parseTools(raw: unknown): string[] | null {
  if (typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.every((t) => typeof t === 'string') ? parsed : null
  } catch {
    return null
  }
}

/**
 * Bring seeded agents up to the tool set their template grants today.
 * Returns how many rows were upgraded. Never throws: a failed reconcile must
 * not stop the module starting.
 */
export function reconcileAgentTools(
  db: EyasDb,
  upgrades: readonly ToolsetUpgrade[],
  logger?: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void },
): number {
  let upgraded = 0
  try {
    const rows = db.all(sql`SELECT id, name, tools FROM agent_definitions WHERE source = 'seed'`) as Array<{
      id: string
      name: string
      tools: string
    }>

    for (const row of rows) {
      const tools = parseTools(row.tools)
      if (!tools) continue
      const match = upgrades.find((u) => sameSet(tools, u.prior))
      if (!match) continue

      db.run(sql`UPDATE agent_definitions SET tools = ${JSON.stringify([...match.current])}, updated_at = datetime('now') WHERE id = ${row.id}`)
      upgraded++
      logger?.info(
        { agent: row.name, added: match.current.filter((t) => !tools.includes(t)) },
        'Agent tool allow-list brought up to its template',
      )
    }
  } catch (err) {
    logger?.warn({ err: String(err) }, 'Agent tool reconcile skipped')
  }
  return upgraded
}
