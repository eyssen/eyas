// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMemoryDb } from '../../helpers/test-db'
import { createToolContractHarness, type ToolContractHarness } from '../../helpers/tool-contract'
import { createMemoryTables } from '@modules/memory/schema'
import { createWorkingMemoryService } from '@modules/memory/tiers/working-memory'
import { createEpisodicMemoryService } from '@modules/memory/tiers/episodic-memory'
import { createArchiveMemoryService } from '@modules/memory/tiers/archive-memory'
import { createVaultService } from '@modules/memory/vault/vault-service'
import { createVaultIndexer } from '@modules/memory/vault/vault-indexer'
import { createWikilinkService } from '@shared/wikilinks'
import { createMemoryService } from '@modules/memory/memory-service'
import { createMemoryTools } from '@modules/tools/builtin/memory-tools'

/**
 * Contract test: the memory tools against the REAL memory service, through
 * the REAL executor. Guards the seam that made both tools dead — the tools
 * called `service.search(query, opts)` while the service only exposes the
 * one-object `search({ query, tiers, limit })`.
 */

let db: ReturnType<typeof createMemoryDb>
let vaultPath: string
let memory: ReturnType<typeof createMemoryService>
let harness: ToolContractHarness

beforeEach(() => {
  db = createMemoryDb()
  createMemoryTables(db)
  vaultPath = mkdtempSync(join(tmpdir(), 'eyas-memtools-'))

  const wikilinks = createWikilinkService(db)
  wikilinks.init()
  const working = createWorkingMemoryService(db, { ttlHours: 24, maxTokensPerBlock: 500 })
  const episodic = createEpisodicMemoryService(db)
  const archive = createArchiveMemoryService(db)
  const vault = createVaultService(vaultPath)
  const indexer = createVaultIndexer(db, vault, wikilinks)

  memory = createMemoryService({ working, episodic, archive, vault, indexer, wikilinks, db })
  harness = createToolContractHarness(createMemoryTools(() => memory))
})

afterEach(() => {
  rmSync(vaultPath, { recursive: true, force: true })
})

describe('memory tools ↔ memory service contract', () => {
  it('save_memory persists an episodic entry through the real executor', async () => {
    const r = await harness.run('save_memory', {
      content: 'OKE node pool upgrade needs cordon first',
      tags: ['k8s'],
    })

    expect(r.success).toBe(true)
    const output = r.output as any
    expect(output.error).toBeUndefined()
    expect(output.saved).toBe(true)

    const stored = memory.episodic.get(output.id)
    expect(stored).not.toBeNull()
    expect(stored!.content).toContain('cordon')
    expect(stored!.tags).toEqual(['k8s'])
  })

  it('search_memory finds what save_memory wrote (tier filter honoured)', async () => {
    await harness.run('save_memory', { content: 'Kubernetes deployment guide for OKE' })

    const r = await harness.run('search_memory', { query: 'kubernetes', tier: 'episodic' })

    expect(r.success).toBe(true)
    const output = r.output as any
    expect(output.error).toBeUndefined()
    expect(Array.isArray(output.results)).toBe(true)
    expect(output.results.length).toBeGreaterThan(0)
    expect(output.results[0].content).toContain('Kubernetes')
  })

  it('search_memory honours the limit and returns hydrated results', async () => {
    await harness.run('save_memory', { content: 'Cloudflare tunnel setup for the ingress node' })
    await harness.run('save_memory', { content: 'Cloudflare WAF rule for the ingress node' })

    const r = await harness.run('search_memory', { query: 'cloudflare ingress', limit: 1 })

    expect(r.success).toBe(true)
    expect((r.output as any).results).toHaveLength(1)
  })

  it('does not advertise the unsearchable "working" tier in its input schema', () => {
    const tool = harness.registry.get('search_memory')!
    const tierEnum = (tool.inputSchema as any).properties.tier.enum as string[]

    expect(tierEnum).not.toContain('working')
    expect(tierEnum).toEqual(['episodic', 'semantic', 'procedural', 'archive', 'conversation'])
  })

  it('search_memory forwards excludeConversationId from toolCtx.conversationId', async () => {
    const spy = vi.spyOn(memory, 'search')

    await harness.run('search_memory', { query: 'x' }, { conversationId: 'conv-xyz' })

    expect(spy).toHaveBeenCalled()
    expect(spy.mock.calls[0][0].excludeConversationId).toBe('conv-xyz')
  })

  it('fails soft (structured error, not throw) when the module is not started yet', async () => {
    const h = createToolContractHarness(createMemoryTools(() => undefined))

    const search = await h.run('search_memory', { query: 'x' })
    expect(search.success).toBe(true)
    expect((search.output as any).error).toMatch(/not ready/i)

    const save = await h.run('save_memory', { content: 'x' })
    expect(save.success).toBe(true)
    expect((save.output as any).error).toMatch(/not ready/i)
  })
})
