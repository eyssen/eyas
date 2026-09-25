// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// J13 — GET /api/v1/memory/engine: what the recall engine is doing, for the
// Memory page's "Recall engine" card. The embedder recall runs on, how many
// recallable gists and facts already have a vector under it, when the L3
// worker last ran, the D1 partitions holding live vectors, the effective L0
// capture switches and the recall settings. `read` on MemoryEntry; counts and
// flags only.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createWorkingMemoryService } from '@modules/memory/tiers/working-memory'
import { createEpisodicMemoryService } from '@modules/memory/tiers/episodic-memory'
import { createArchiveMemoryService } from '@modules/memory/tiers/archive-memory'
import { createVaultService } from '@modules/memory/vault/vault-service'
import { createVaultIndexer } from '@modules/memory/vault/vault-indexer'
import { createWikilinkService } from '@shared/wikilinks'
import { createMemoryService } from '@modules/memory/memory-service'
import { createMemoryRoutes, type MemoryEngineHooks } from '@modules/memory/routes'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createHashEmbedder, HASH_EMBED_MODEL_ID } from '@modules/memory/embeddings/hash-embedder'
import { E5_MODEL_ID } from '@modules/memory/embeddings/local-embedder'
import { createL3EmbedWorker } from '@modules/memory/v2/l3-worker'
import { markSecrets } from '@modules/memory/v2/d1'
import { readMemoryEngineStatus, type MemoryEngineStatus } from '@modules/memory/v2/engine-status'
import { makeD1Db, gistRow, factRow } from './v2/d1-fixtures'

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: vi.fn() } as any

let db: any
let raw: any
let vaultPath: string
let memory: ReturnType<typeof createMemoryService>
let wikilinks: ReturnType<typeof createWikilinkService>

beforeEach(() => {
  ;({ db, raw } = makeD1Db())
  vaultPath = mkdtempSync(join(tmpdir(), 'eyas-engine-routes-'))
  wikilinks = createWikilinkService(db)
  wikilinks.init()
  const vault = createVaultService(vaultPath)
  memory = createMemoryService({
    working: createWorkingMemoryService(db, { ttlHours: 24, maxTokensPerBlock: 500 }),
    episodic: createEpisodicMemoryService(db),
    archive: createArchiveMemoryService(db),
    vault, indexer: createVaultIndexer(db, vault, wikilinks), wikilinks, db,
  })
})

afterEach(() => {
  rmSync(vaultPath, { recursive: true, force: true })
})

function hooks(over: Partial<MemoryEngineHooks> = {}): MemoryEngineHooks {
  return {
    bridge: () => createHashEmbedder(),
    worker: () => undefined,
    config: () => ({}),
    captureActive: () => true,
    ...over,
  }
}

type Role = 'owner' | 'admin' | 'user' | 'agent' | 'guest'

/** Mounts the memory routes with the real CASL ability of `role` (`null` = unauthenticated); `engine` null = no hooks. */
function mount(role: Role | null, engine: MemoryEngineHooks | null = hooks()): Hono {
  const a = new Hono()
  if (role) {
    const ability = buildAbilityForRole(role, createPermissionRegistry())
    a.use('*', async (c: any, next: any) => { c.set('ability', ability); c.set('userId', `${role}-1`); await next() })
  }
  createMemoryRoutes(a, memory, logger, { db, wikilinks, engine: engine ?? undefined })
  return a
}

async function status(app: Hono): Promise<MemoryEngineStatus> {
  const res = await app.request('/api/v1/memory/engine')
  expect(res.status).toBe(200)
  return await res.json() as MemoryEngineStatus
}

describe('GET /api/v1/memory/engine — the status', () => {
  it('(+) reports the embedder, L3 coverage after a worker drain, partitions and capture flags', async () => {
    gistRow(db, 'g-home', 'Invoices are approved by the finance lead', { project: 'P' })
    gistRow(db, 'g-type', 'Releases ship on Fridays', { projectType: 'T' })
    gistRow(db, 'g-global', 'The owner prefers short answers')
    factRow(db, 'f-1', 'finance lead', 'approves invoices', { project: 'P' })
    const bridge = createHashEmbedder()
    const worker = createL3EmbedWorker({ db, getRawDb: () => raw, bridge, includeSecrets: () => false })
    await worker.drain()
    // Extracted after the drain: not embedded yet.
    gistRow(db, 'g-new', 'The warehouse moves to the north site')
    factRow(db, 'f-new', 'warehouse', 'moves north')

    const app = mount('owner', hooks({
      bridge: () => bridge,
      worker: () => worker,
      config: () => ({ memory: { l0: { enabled: true, captureToolResults: true, captureThinking: false }, index: { budgetChars: 3_000 } } }),
    }))
    const body = await status(app)
    expect(body.embedder).toEqual({ modelId: HASH_EMBED_MODEL_ID, kind: 'hash' })
    expect(body.l3.gists).toEqual({ embedded: 3, total: 4 })
    expect(body.l3.facts).toEqual({ embedded: 1, total: 2 })
    expect(typeof body.l3.lastRunAt).toBe('number')
    expect(body.partitions).toEqual({ projects: 1, projectTypes: 1 })
    expect(body.capture).toEqual({ l0Enabled: true, toolResults: true, thinking: false })
    expect(body.recall).toEqual({ includeSecrets: false, indexBudgetChars: 3_000 })
    await worker.stop()
  })

  it('(+) the multilingual e5 embedder reads as e5; a worker that never ran reads as null', async () => {
    const e5 = { ...createHashEmbedder(), modelId: () => E5_MODEL_ID }
    const body = await status(mount('owner', hooks({ bridge: () => e5, worker: () => ({ status: () => ({ lastRunAt: null }) }) })))
    expect(body.embedder).toEqual({ modelId: E5_MODEL_ID, kind: 'e5' })
    expect(body.l3.lastRunAt).toBeNull()
  })

  it('(+) a vector from another embedder does not count as covered', async () => {
    gistRow(db, 'g-1', 'Invoices are approved by the finance lead')
    const old = { ...createHashEmbedder(), modelId: () => 'old-model' }
    await createL3EmbedWorker({ db, getRawDb: () => raw, bridge: old, includeSecrets: () => false }).drain()
    const body = await status(mount('owner'))
    expect(body.l3.gists).toEqual({ embedded: 0, total: 1 })
  })

  it('(+) totals are what recall can return: quarantined, superseded and (by default) secret rows are left out', async () => {
    gistRow(db, 'g-live', 'The owner prefers short answers')
    gistRow(db, 'g-quarantined', 'A quarantined summary')
    db.run(sql`UPDATE memory_gist SET trust_tier = 'quarantined' WHERE id = 'g-quarantined'`)
    gistRow(db, 'g-old', 'A superseded summary')
    db.run(sql`UPDATE memory_gist SET is_current = 0 WHERE id = 'g-old'`)
    const secretRid = gistRow(db, 'g-secret', 'The staging password lives in the vault')
    markSecrets(db, secretRid, 'gist')
    factRow(db, 'f-live', 'release', 'ships on Fridays')
    factRow(db, 'f-superseded', 'release', 'shipped on Mondays')
    db.run(sql`UPDATE memory_fact SET valid_until = 1 WHERE id = 'f-superseded'`)

    const off = await status(mount('owner'))
    expect(off.l3.gists.total).toBe(1)
    expect(off.l3.facts.total).toBe(1)
    expect(off.recall.includeSecrets).toBe(false)

    const on = await status(mount('owner', hooks({ config: () => ({ memory: { recall: { includeSecrets: true } } }) })))
    expect(on.l3.gists.total).toBe(2)
    expect(on.recall.includeSecrets).toBe(true)
  })

  it('(−) a capture that did not start reads as off, whatever its switches say', async () => {
    const config = () => ({ memory: { l0: { enabled: true, captureToolResults: true, captureThinking: true } } })
    const body = await status(mount('owner', hooks({ config, captureActive: () => false })))
    expect(body.capture).toEqual({ l0Enabled: false, toolResults: false, thinking: false })
  })

  it('(−) memory.l0.enabled false reads as off; the switches default to off', async () => {
    const disabled = await status(mount('owner', hooks({ config: () => ({ memory: { l0: { enabled: false, captureToolResults: true } } }) })))
    expect(disabled.capture).toEqual({ l0Enabled: false, toolResults: false, thinking: false })
    const defaults = await status(mount('owner'))
    expect(defaults.capture).toEqual({ l0Enabled: true, toolResults: false, thinking: false })
  })

  it('(−) no index budget configured (or a bad one) reports the shipped default', async () => {
    expect((await status(mount('owner'))).recall.indexBudgetChars).toBe(2_400)
    const bad = await status(mount('owner', hooks({ config: () => ({ memory: { index: { budgetChars: -5 } } }) })))
    expect(bad.recall.indexBudgetChars).toBe(2_400)
  })

  it('(−) no embedder: dense recall is off, nothing counts as embedded, totals still show', async () => {
    gistRow(db, 'g-1', 'The owner prefers short answers')
    const body = await status(mount('owner', hooks({ bridge: () => undefined })))
    expect(body.embedder).toBeNull()
    expect(body.l3.gists).toEqual({ embedded: 0, total: 1 })
  })

  it('(−) a demoted-only partition does not count; no v2 tables reads as empty rather than failing', async () => {
    gistRow(db, 'g-home', 'Invoices are approved by the finance lead', { project: 'P' })
    await createL3EmbedWorker({ db, getRawDb: () => raw, bridge: createHashEmbedder(), includeSecrets: () => false }).drain()
    db.run(sql`UPDATE memory_embedding SET live_in_index = 0`)
    expect((await status(mount('owner'))).partitions).toEqual({ projects: 0, projectTypes: 0 })

    const bare = readMemoryEngineStatus({
      db: { all: () => { throw new Error('no such table: memory_gist') } } as any,
      ...hooks(),
    })
    expect(bare.l3.gists).toEqual({ embedded: 0, total: 0 })
    expect(bare.partitions).toEqual({ projects: 0, projectTypes: 0 })
  })

  it('(−) the payload carries no memory content', async () => {
    gistRow(db, 'g-1', 'The staging password is hunter2')
    const res = await mount('owner').request('/api/v1/memory/engine')
    expect(await res.text()).not.toContain('hunter2')
  })
})

describe('GET /api/v1/memory/engine — access', () => {
  it('(+) every role that reads memory gets it (owner, admin, user, agent)', async () => {
    for (const role of ['owner', 'admin', 'user', 'agent'] as const) {
      const res = await mount(role).request('/api/v1/memory/engine')
      expect(res.status, role).toBe(200)
    }
  })

  it('(−) 401 without authentication', async () => {
    const res = await mount(null).request('/api/v1/memory/engine')
    expect(res.status).toBe(401)
  })

  it('(−) 403 without read on MemoryEntry (guest)', async () => {
    const res = await mount('guest').request('/api/v1/memory/engine')
    expect(res.status).toBe(403)
  })

  it('(−) not mounted when the module passes no engine hooks', async () => {
    const res = await mount('owner', null).request('/api/v1/memory/engine')
    expect(res.status).toBe(404)
  })
})
