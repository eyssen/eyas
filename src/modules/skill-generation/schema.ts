// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

/**
 * Skill-generation schema.
 *
 *   generated_skills       — one row per distinct candidate that reached the
 *                            generation stage. `adoption_status` tracks the
 *                            full lifecycle; `skill_md_path` points at the
 *                            on-disk artifact.
 *
 *   skill_ab_experiments   — one row per A/B experiment run. Stores the
 *                            baseline/candidate success rates, p-value, and
 *                            the recommendation. Immutable after write.
 *
 *   skill_adoption_events  — append-only audit log: every adoption decision
 *                            (adopt / reject / queued-more-data / rollback).
 */
export function createSkillGenerationTables(db: EyasDb) {
  db.run(sql`CREATE TABLE IF NOT EXISTS generated_skills (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    candidate_id TEXT NOT NULL,
    from_session_ids TEXT NOT NULL,
    pattern_json TEXT NOT NULL,
    observations_json TEXT NOT NULL,
    skill_md_path TEXT NOT NULL,
    metadata_path TEXT NOT NULL,
    adoption_status TEXT NOT NULL DEFAULT 'pending-experiment',
    version TEXT NOT NULL DEFAULT '0.1.0',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`)

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_generated_skills_status
    ON generated_skills(adoption_status)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_generated_skills_candidate
    ON generated_skills(candidate_id)`)

  db.run(sql`CREATE TABLE IF NOT EXISTS skill_ab_experiments (
    id TEXT PRIMARY KEY,
    candidate_skill_id TEXT NOT NULL,
    baseline_success_rate REAL NOT NULL,
    candidate_success_rate REAL NOT NULL,
    p_value REAL,
    significant_improvement INTEGER NOT NULL DEFAULT 0,
    tasks_run INTEGER NOT NULL,
    trials_per_arm INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    recommendation TEXT NOT NULL,
    method TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    started_at INTEGER NOT NULL,
    finished_at INTEGER NOT NULL
  )`)

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_ab_experiments_candidate
    ON skill_ab_experiments(candidate_skill_id)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_ab_experiments_recommendation
    ON skill_ab_experiments(recommendation)`)

  db.run(sql`CREATE TABLE IF NOT EXISTS skill_adoption_events (
    id TEXT PRIMARY KEY,
    candidate_skill_id TEXT NOT NULL,
    experiment_id TEXT NOT NULL,
    action TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    ts INTEGER NOT NULL
  )`)

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_adoption_events_candidate
    ON skill_adoption_events(candidate_skill_id, ts)`)
}
