// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

/**
 * God Mode storage — idempotent runtime DDL (no drizzle-kit), mirrored by the
 * Drizzle tables below and guarded by tests/contracts/god-mode-schema.contract.test.ts.
 *
 * `insights` is added via ALTER so existing `CREATE TABLE IF NOT EXISTS`
 * installs (which omit the column) pick it up without a drizzle-kit migration.
 */
export function ensureGodModeSchema(db: any): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS god_mode_config (
    id TEXT PRIMARY KEY,
    participants TEXT NOT NULL DEFAULT '[]',
    chair_participant_id TEXT,
    cost_ceiling_usd REAL,
    workspace_retention_hours INTEGER NOT NULL DEFAULT 72,
    updated_at TEXT NOT NULL
  )`)

  db.run(sql`CREATE TABLE IF NOT EXISTS god_mode_runs (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    user_message_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'preparing',
    winner_participant_id TEXT,
    tie_broken INTEGER NOT NULL DEFAULT 0,
    chair_participant_id TEXT,
    participants_snapshot TEXT NOT NULL DEFAULT '[]',
    isolation TEXT NOT NULL,
    source_working_directory TEXT,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    total_cost_usd REAL NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
  )`)

  db.run(sql`CREATE TABLE IF NOT EXISTS god_mode_participants (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    slot_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    workspace_path TEXT,
    child_run_id TEXT,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    vote_for TEXT,
    scores TEXT,
    unique_insights TEXT,
    risks TEXT,
    summary TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
  )`)

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_god_mode_runs_conv
    ON god_mode_runs(conversation_id, created_at)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_god_mode_participants_run
    ON god_mode_participants(run_id)`)

  try {
    db.run(sql`ALTER TABLE god_mode_runs ADD COLUMN insights TEXT`)
  } catch { /* column already exists */ }
  try {
    db.run(sql`ALTER TABLE god_mode_runs ADD COLUMN timeline TEXT`)
  } catch { /* column already exists */ }
  try {
    db.run(sql`ALTER TABLE god_mode_runs ADD COLUMN decision TEXT`)
  } catch { /* column already exists */ }
  try {
    db.run(sql`ALTER TABLE god_mode_participants ADD COLUMN review_summary TEXT`)
  } catch { /* column already exists */ }
}

export const godModeConfig = sqliteTable('god_mode_config', {
  id: text('id').primaryKey(),
  participants: text('participants').notNull().default('[]'),
  chairParticipantId: text('chair_participant_id'),
  costCeilingUsd: real('cost_ceiling_usd'),
  workspaceRetentionHours: integer('workspace_retention_hours').notNull().default(72),
  updatedAt: text('updated_at').notNull(),
})

export const godModeRuns = sqliteTable('god_mode_runs', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  userMessageId: integer('user_message_id').notNull(),
  status: text('status').notNull().default('preparing'),
  winnerParticipantId: text('winner_participant_id'),
  tieBroken: integer('tie_broken').notNull().default(0),
  chairParticipantId: text('chair_participant_id'),
  participantsSnapshot: text('participants_snapshot').notNull().default('[]'),
  isolation: text('isolation').notNull(),
  sourceWorkingDirectory: text('source_working_directory'),
  totalTokens: integer('total_tokens').notNull().default(0),
  totalCostUsd: real('total_cost_usd').notNull().default(0),
  durationMs: integer('duration_ms').notNull().default(0),
  error: text('error'),
  insights: text('insights'),
  timeline: text('timeline'),
  decision: text('decision'),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
})

export const godModeParticipants = sqliteTable('god_mode_participants', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  slotId: text('slot_id').notNull(),
  providerId: text('provider_id').notNull(),
  modelId: text('model_id').notNull(),
  status: text('status').notNull().default('pending'),
  workspacePath: text('workspace_path'),
  childRunId: text('child_run_id'),
  tokensIn: integer('tokens_in').notNull().default(0),
  tokensOut: integer('tokens_out').notNull().default(0),
  costUsd: real('cost_usd').notNull().default(0),
  durationMs: integer('duration_ms').notNull().default(0),
  voteFor: text('vote_for'),
  scores: text('scores'),
  uniqueInsights: text('unique_insights'),
  risks: text('risks'),
  summary: text('summary'),
  reviewSummary: text('review_summary'),
  error: text('error'),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
})
