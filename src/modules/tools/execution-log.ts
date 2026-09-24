// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// tool_executions: one row per tool call the EYAS executor saw, on every
// provider path, plus one per tool a CLI runtime ran itself (the executor's
// recordExternal). run_id ties a row to its supervised run (agent_sessions.id),
// so a run's tool evidence (the critic's retrieval check, observability) is
// read by run rather than guessed from conversation and time.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import type { ExecutionLogEntry } from './tool-executor.js'

export function ensureToolExecutionsTable(db: EyasDb): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS tool_executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT,
    agent_id TEXT,
    tool_name TEXT NOT NULL,
    input TEXT,
    output TEXT,
    error TEXT,
    success INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    run_id TEXT
  )`)
  // Additive for a table created before run_id existed; a no-op error otherwise.
  try { db.run(sql`ALTER TABLE tool_executions ADD COLUMN run_id TEXT`) } catch { /* already exists */ }
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_tool_exec_conv ON tool_executions(conversation_id)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_tool_exec_agent ON tool_executions(agent_id)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_tool_exec_name ON tool_executions(tool_name)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_tool_exec_run ON tool_executions(run_id)`)
}

export function recordToolExecution(db: EyasDb, entry: ExecutionLogEntry): void {
  db.run(sql`INSERT INTO tool_executions (conversation_id, agent_id, tool_name, input, output, error, success, duration_ms, created_at, run_id)
    VALUES (${entry.conversationId ?? null}, ${entry.agentId ?? null}, ${entry.toolName},
            ${JSON.stringify(entry.input)}, ${entry.output ? JSON.stringify(entry.output) : null},
            ${entry.error ?? null}, ${entry.success ? 1 : 0}, ${entry.durationMs}, ${entry.timestamp},
            ${entry.runId ?? null})`)
}

/**
 * The distinct tool names the executor logged for these runs (run_id). The
 * names are EYAS's own, whichever provider path called the tool — including a
 * bridged call a CLI reported only under a display title — so a run's tool
 * evidence is read here rather than from the provider's event names. Fail
 * soft: no table (a store that never ran a tool) or a read error yields [].
 */
export function toolNamesOfRuns(db: EyasDb, runIds: readonly string[]): string[] {
  const ids = [...new Set(runIds.filter((id) => typeof id === 'string' && id !== ''))]
  if (ids.length === 0) return []
  try {
    const rows = db.all<{ tool_name: string }>(sql`SELECT DISTINCT tool_name FROM tool_executions
      WHERE run_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`)
    return rows.map((r) => r.tool_name).filter((n): n is string => typeof n === 'string' && n !== '')
  } catch {
    return []
  }
}
