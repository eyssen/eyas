// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Task 51c — Soul forge proposal → applier → cache-prefix-hash change test.
// Verifies: proposal inserted, applier updates SOUL, assembler prefix hash changes.

import { describe, it, expect, afterEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { sql } from 'drizzle-orm'
import { setupTestEyas } from '../helpers/test-eyas.js'
import { createForgeProposeSoulTool } from '@modules/forge/tools/forge-propose-soul-tool.js'
import { createForgeTables } from '@modules/forge/schema.js'
import { createSoulProposalApplier } from '@modules/forge/soul-proposal-applier.js'
import { createSoulPipeline } from '@modules/prompt-wizard/soul-pipeline.js'
import type { EyasDb } from '@core/types'

describe('soul forge proposal + applier', () => {
  let harness: ReturnType<typeof setupTestEyas>

  afterEach(async () => {
    await harness?.shutdown()
  })

  function makeForgeDb(): EyasDb {
    // Re-use the harness DB but also create the forge tables.
    // We create a fresh in-memory DB because the harness db doesn't have forge tables.
    const sqlite = new Database(':memory:')
    const db = drizzle(sqlite)
    db.run(sql`CREATE TABLE IF NOT EXISTS agent_definitions (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, tier TEXT NOT NULL DEFAULT 'specialist',
      workspace_path TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`)
    createForgeTables(db as unknown as EyasDb)
    return db as unknown as EyasDb
  }

  it('proposes a soul change, applies it, and confirms prefix hash changes', async () => {
    harness = setupTestEyas()
    const agentId = await harness.api.createAgent({ template: 'primary-assistant', name: 'Jarvis' })

    // Get baseline prefix hash
    const promptBefore = await harness.assembler.buildForPrimary({
      agentId,
      agentName: 'Jarvis',
      conversationId: null,
      projectId: null,
      channelContext: null,
    })
    const hashBefore = promptBefore.prefixHash

    // Create a forge DB + tool
    const forgeDb = makeForgeDb()
    const propTool = createForgeProposeSoulTool({ db: forgeDb })

    const { proposalId } = await propTool.invoke(agentId, {
      scope: 'internal',
      field: 'tone',
      currentValue: 'baráti',
      proposedValue: 'komoly',
      reasoning: 'The agent has been asked to be more serious in internal conversations based on 5 feedback samples collected over 2 weeks.',
      evidenceCount: 5,
    })

    expect(proposalId).toBeTruthy()

    // Confirm the proposal row was inserted
    const rows = forgeDb.all<{ status: string }>(
      sql`SELECT status FROM forge_proposals WHERE id = ${proposalId}`,
    )
    expect(rows[0]?.status).toBe('pending')

    // Create the soul pipeline + applier (using the harness writer/loader)
    const soulPipeline = createSoulPipeline({ writer: harness.workspaceWriter })
    const applier = createSoulProposalApplier({
      db: forgeDb,
      workspaceLoader: harness.workspaceLoader,
      soulPipeline,
      agentName: async () => 'Jarvis',
    })

    const applyResult = await applier.apply(proposalId)
    expect(applyResult.ok).toBe(true)

    // Proposal status updated to 'applied'
    const afterRows = forgeDb.all<{ status: string }>(
      sql`SELECT status FROM forge_proposals WHERE id = ${proposalId}`,
    )
    expect(afterRows[0]?.status).toBe('applied')

    // SOUL.style.json should reflect the new tone
    harness.workspaceLoader.invalidate(agentId)
    const ws = await harness.workspaceLoader.load(agentId)
    const style = JSON.parse(ws.soulStyleJson.body)
    expect(style.internal.tone).toBe('komoly')

    // Prefix hash must change because SOUL.md has been re-rendered
    const promptAfter = await harness.assembler.buildForPrimary({
      agentId,
      agentName: 'Jarvis',
      conversationId: null,
      projectId: null,
      channelContext: null,
    })
    expect(promptAfter.prefixHash).not.toBe(hashBefore)
  })

  it('applier rejects non-existent proposal', async () => {
    harness = setupTestEyas()
    const forgeDb = makeForgeDb()
    const soulPipeline = createSoulPipeline({ writer: harness.workspaceWriter })
    const applier = createSoulProposalApplier({
      db: forgeDb,
      workspaceLoader: harness.workspaceLoader,
      soulPipeline,
      agentName: async () => 'Unknown',
    })

    const result = await applier.apply('nonexistent-id')
    expect(result.ok).toBe(false)
  })
})
