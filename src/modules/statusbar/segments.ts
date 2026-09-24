// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { getVersion } from '@core/version.js'
import type { EyasConfig, EyasDb } from '@core/types'

export interface StatusbarSnapshot {
  tasks: { open: number; overdue: number; running: number }
  agents: { running: number }
  version: string
  env: string
  /** Optional — filled when system-update last check cached (UI may poll /system/update). */
  updateAvailable?: boolean
  latestVersion?: string | null
}

function count(db: EyasDb, query: unknown): number {
  const rows = db.all(query) as Array<{ n: number }>
  return rows[0]?.n ?? 0
}

// v1 segment providers. Extend by adding fields here + a frontend segment.
//
// conversations.status has no 'done'/'running' literal (verified against
// conversation-service.ts): the real values are 'idle' (at rest), 'working'
// (the only in-flight state), and 'archived'/'deleted' (closed — these two
// trigger the 'eyas.conversations.closed' bus event and are excluded from
// list() by default). agent_sessions.status = 'running' is a real literal
// (see run-supervisor.ts).
export function buildSnapshot(db: EyasDb, config: EyasConfig): StatusbarSnapshot {
  void config
  const nowIso = new Date().toISOString()
  const open = count(db, sql`SELECT COUNT(*) AS n FROM conversations WHERE status NOT IN ('archived', 'deleted')`)
  const overdue = count(db, sql`SELECT COUNT(*) AS n FROM conversations WHERE status NOT IN ('archived', 'deleted') AND due_date IS NOT NULL AND due_date < ${nowIso}`)
  const running = count(db, sql`SELECT COUNT(*) AS n FROM conversations WHERE status = 'working'`)
  const agentsRunning = count(db, sql`SELECT COUNT(*) AS n FROM agent_sessions WHERE status = 'running'`)
  return {
    tasks: { open, overdue, running },
    agents: { running: agentsRunning },
    // Same source as /api/v1/health — version.json via getVersion()
    // (npm_package_version is often unset under bun / eyas start).
    version: getVersion(),
    env: process.env.NODE_ENV ?? 'development',
  }
}
