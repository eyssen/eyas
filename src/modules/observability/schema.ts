// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

/**
 * Creates the ai_traces table and indexes for observability.
 */
export function createObservabilityTables(db: EyasDb): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS ai_traces (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    request_id TEXT NOT NULL,
    conversation_id TEXT,
    agent_session_id TEXT,
    model TEXT NOT NULL,
    provider TEXT NOT NULL,
    memory_tiers_used TEXT,
    context_tokens INTEGER NOT NULL DEFAULT 0,
    system_prompt_tokens INTEGER NOT NULL DEFAULT 0,
    tool_definitions TEXT,
    tool_calls TEXT,
    tool_call_count INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    quality_score_auto REAL,
    quality_score_user TEXT,
    evaluator_model TEXT,
    error TEXT
  )`)

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_traces_timestamp ON ai_traces(timestamp)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_traces_model ON ai_traces(model)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_traces_conversation ON ai_traces(conversation_id)`)

  try { db.run(sql`ALTER TABLE ai_traces ADD COLUMN composition_id TEXT`) } catch { /* already exists */ }
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_traces_composition ON ai_traces(composition_id)`)

  // ai_traces additive columns (sovereignty plan) — the ONE block for this
  // table; later tasks append their ALTERs here (fresh installs get them the
  // same way).
  // resolved_model: the concrete model the backend reported answering
  // (ModelResponse.resolvedModelId); NULL when it named none.
  try { db.run(sql`ALTER TABLE ai_traces ADD COLUMN resolved_model TEXT`) } catch { /* already exists */ }
  // effort_*: the reasoning effort the call asked for, the one it ran with
  // (after clamping to the model, or as the runtime read it back) and where
  // the request came from (ModelResponse.effortOutcome); NULL when absent.
  try { db.run(sql`ALTER TABLE ai_traces ADD COLUMN effort_requested TEXT`) } catch { /* already exists */ }
  try { db.run(sql`ALTER TABLE ai_traces ADD COLUMN effort_effective TEXT`) } catch { /* already exists */ }
  try { db.run(sql`ALTER TABLE ai_traces ADD COLUMN effort_source TEXT`) } catch { /* already exists */ }
  // purpose / aux_route: a background call's purpose (capture, title, triage…)
  // and the auxiliary-ladder rung that answered it (tier, default, api,
  // isolated-cli), from request.metadata; NULL for conversation turns.
  try { db.run(sql`ALTER TABLE ai_traces ADD COLUMN purpose TEXT`) } catch { /* already exists */ }
  try { db.run(sql`ALTER TABLE ai_traces ADD COLUMN aux_route TEXT`) } catch { /* already exists */ }
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_traces_purpose ON ai_traces(purpose)`)
}
