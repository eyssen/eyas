// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Task 53.1 — Migration roundtrip test.
// Seeds v1 agent rows → runs workspace bootstrap (mimics migration) → asserts
// IDENTITY.md + SOUL.md exist per tier → runs rollback → asserts v1 data restored.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { sql } from 'drizzle-orm'
import { seedV1Agents, simulateMigration } from './helpers/seed-v1.js'
import { bootstrapAgentWorkspaceFromSeed } from '@modules/agent/workspace-bootstrap.js'
import { snapshotV1AgentRows } from '../../scripts/lib/snapshot-v1-agent-rows.js'
import { restoreFromSnapshot } from '../../scripts/migrate-prompts-v2-rollback.js'
import { ALL_TEMPLATES } from '@modules/agent/agent-templates.js'

type Db = ReturnType<typeof drizzle>

let dataDir: string
let db: Db

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'eyas-migrate-test-'))
  const sqlite = new Database(':memory:')
  db = drizzle(sqlite)
  seedV1Agents(db)
})

afterEach(() => {
  try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
})

describe('v1 → v2 migration roundtrip', () => {
  it('seeds 16 agent rows into v1 table', () => {
    const rows = db.all<{ id: string }>(sql`SELECT id FROM agent_definitions`)
    expect(rows.length).toBe(ALL_TEMPLATES.length)
  })

  it('snapshot captures v1 rows before migration', async () => {
    const count = await snapshotV1AgentRows(db as never)
    expect(count).toBe(ALL_TEMPLATES.length)

    const snapRows = db.all<{ id: string }>(sql`SELECT id FROM agent_definitions_v1_snapshot`)
    expect(snapRows.length).toBe(ALL_TEMPLATES.length)
  })

  it('writes workspace files for primary/team agents after bootstrap', async () => {
    await snapshotV1AgentRows(db as never)

    // Bootstrap workspace for each agent that has a workspaceSeed
    for (const tpl of ALL_TEMPLATES) {
      if (!tpl.workspaceSeed) continue
      await bootstrapAgentWorkspaceFromSeed({
        dataDir,
        agentId: tpl.id,
        agentName: tpl.name,
        tier: tpl.tier,
        seed: tpl.workspaceSeed,
      })
    }

    // All agents with workspaceSeed must have IDENTITY.md
    for (const tpl of ALL_TEMPLATES) {
      if (!tpl.workspaceSeed) continue
      const root = join(dataDir, 'agents', tpl.id)
      expect(existsSync(join(root, 'IDENTITY.md')), `IDENTITY.md missing for ${tpl.id}`).toBe(true)
    }

    // Primary and team agents must have SOUL.md + SOUL.style.json
    for (const tpl of ALL_TEMPLATES) {
      if (!tpl.workspaceSeed?.soulStylePreset) continue
      const root = join(dataDir, 'agents', tpl.id)
      expect(existsSync(join(root, 'SOUL.md')), `SOUL.md missing for ${tpl.id}`).toBe(true)
      expect(existsSync(join(root, 'SOUL.style.json')), `SOUL.style.json missing for ${tpl.id}`).toBe(true)
    }

    // Specialist agents (no soulStylePreset) should NOT have SOUL.md
    for (const tpl of ALL_TEMPLATES) {
      if (!tpl.workspaceSeed || tpl.workspaceSeed.soulStylePreset) continue
      const root = join(dataDir, 'agents', tpl.id)
      expect(existsSync(join(root, 'SOUL.md')), `SOUL.md should not exist for specialist ${tpl.id}`).toBe(false)
    }
  })

  it('rollback restores v1 columns and clears workspace_path', async () => {
    await snapshotV1AgentRows(db as never)
    simulateMigration(db, dataDir)

    // Confirm migration state
    const migratedRows = db.all<{ id: string; workspace_path: string; system_prompt: string | null }>(
      sql`SELECT id, workspace_path, system_prompt FROM agent_definitions LIMIT 1`,
    )
    expect(migratedRows[0].workspace_path).toBeTruthy()
    expect(migratedRows[0].system_prompt).toBeNull()

    // Rollback
    const restored = await restoreFromSnapshot(db as never)
    expect(restored).toBe(ALL_TEMPLATES.length)

    // All rows should have workspace_path cleared + v1 data back
    const rows = db.all<{ id: string; workspace_path: string | null; role: string | null }>(
      sql`SELECT id, workspace_path, role FROM agent_definitions`,
    )
    for (const row of rows) {
      expect(row.workspace_path).toBeNull()
      // role was set in v1 for all templates
      const tpl = ALL_TEMPLATES.find((t) => t.id === row.id)
      if (tpl) {
        expect(row.role).toBe(tpl.role)
      }
    }
  })
})
