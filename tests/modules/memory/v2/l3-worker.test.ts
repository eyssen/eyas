// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// J3 — incremental L3. A flush that extracts a gist and a fact gets both
// vectors seconds later, without a restart; vectors of owners recall can no
// longer return are retired; recall embeds locally even when an embedding
// tier is configured.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { probeSqliteCapabilities } from '@core/db/sqlite-capabilities'
import { wireL0Capture, type L0WireConfig } from '@modules/memory/v2/wire'
import { captureUnit, resetIngestBridge } from '@modules/memory/v2/ingest-bridge'
import { createL3EmbedWorker } from '@modules/memory/v2/l3-worker'
import { markSecrets } from '@modules/memory/v2/d1'
import { retrieve } from '@modules/memory/v2/retrieve'
import { createHashEmbedder, HASH_EMBED_MODEL_ID } from '@modules/memory/embeddings/hash-embedder'
import { selectEmbeddingBridges } from '@modules/memory/embeddings/select-bridges'
import type { EmbeddingProvider } from '@modules/memory/embeddings/types'
import type { EmbedRequest } from '@modules/model/types'
import { makeD1Db, gistRow, factRow } from './d1-fixtures'
import { makeUnit, silentLogger } from './helpers'

const config = (): L0WireConfig => ({
  enabled: true, toolResultMaxBytes: 8_192, idleFlushMinutes: 30, chunkTokens: 8_000,
  captureToolResults: false, engine: 'v2', extractInLegacy: true,
})

const vec0 = makeD1Db().vec0

function world() {
  const { db, raw } = makeD1Db()
  return { db, raw, caps: probeSqliteCapabilities(raw) }
}

function embeddedOwners(db: any): Map<string, string> {
  const rows = db.all(sql`SELECT owner_id AS id, model_id AS model FROM memory_embedding`) as Array<{ id: string; model: string }>
  return new Map(rows.map((r) => [r.id, r.model]))
}

function vecRows(raw: any, rid: number): number {
  return (raw.prepare('SELECT COUNT(*) AS n FROM memory_embedding_vec WHERE rowid = ?').get(rid) as { n: number }).n
}

function embeddingRid(db: any, ownerId: string): number | undefined {
  return (db.all(sql`SELECT rid FROM memory_embedding WHERE owner_id = ${ownerId}`) as Array<{ rid: number }>)[0]?.rid
}

function currentGist(db: any, conversationId: string): string {
  return (db.all(sql`SELECT id FROM memory_gist WHERE scope_id = ${conversationId} AND is_current = 1`) as Array<{ id: string }>)[0]!.id
}

function liveFact(db: any, subject: string): string {
  return (db.all(sql`SELECT id FROM memory_fact WHERE subject = ${subject} AND valid_until IS NULL AND tombstoned = 0`) as Array<{ id: string }>)[0]!.id
}

beforeEach(() => resetIngestBridge())

describe('L3 worker — embed after every flush', () => {
  it('a flush that extracts a gist and a fact gets both vectors without a restart', async () => {
    const { db, raw, caps } = world()
    const ingest = (await wireL0Capture({ db, caps, logger: silentLogger, instanceId: 'inst-test', config }))!
    const worker = createL3EmbedWorker({
      db, getRawDb: () => raw, bridge: createHashEmbedder(), logger: silentLogger, includeSecrets: () => false, debounceMs: 5,
    })
    ingest.onFlushed(() => worker.kick())

    captureUnit(makeUnit({ conversationId: 'conv-w', content: 'Customer: Contoso Kft\nWe decided to ship the invoice module on Friday.' }))
    ingest.flushConversation('conv-w', 'manual')
    const gistId = currentGist(db, 'conv-w')
    const factId = liveFact(db, 'customer')
    // Extraction ran on the flush; the vectors come from the worker, a moment later.
    expect(embeddedOwners(db).size).toBe(0)

    await vi.waitFor(() => expect(worker.status().runs).toBeGreaterThan(0))
    const owners = embeddedOwners(db)
    expect(owners.get(gistId)).toBe(HASH_EMBED_MODEL_ID)
    expect(owners.get(factId)).toBe(HASH_EMBED_MODEL_ID)
    expect(worker.status().totals.gists).toBe(1)
    expect(worker.status().totals.facts).toBeGreaterThanOrEqual(1)
  })

  it.skipIf(!vec0)('KNN finds the fresh fact, and a superseded gist and fact leave the live index', async () => {
    const { db, raw, caps } = world()
    const ingest = (await wireL0Capture({ db, caps, logger: silentLogger, instanceId: 'inst-test', config }))!
    const bridge = createHashEmbedder()
    const worker = createL3EmbedWorker({ db, getRawDb: () => raw, bridge, logger: silentLogger, includeSecrets: () => false, debounceMs: 5 })
    ingest.onFlushed(() => worker.kick())

    captureUnit(makeUnit({ conversationId: 'conv-s', content: 'Customer: Contoso Kft\nWe decided to ship the invoice module on Friday.' }))
    ingest.flushConversation('conv-s', 'manual')
    await vi.waitFor(() => expect(worker.status().runs).toBe(1))
    const oldGist = currentGist(db, 'conv-s')
    const oldFact = liveFact(db, 'customer')
    const oldGistRid = embeddingRid(db, oldGist)!
    const oldFactRid = embeddingRid(db, oldFact)!
    expect(vecRows(raw, oldFactRid)).toBe(1)
    const found = await retrieve({ db, rawDb: raw, bridge, logger: silentLogger }, { query: 'customer Contoso Kft', language: 'en', projectId: null })
    expect(found.map((h) => h.id)).toContain(`ft:${oldFact}`)

    // The same conversation flushes again: a new gist supersedes the old one,
    // and the customer fact is superseded by the new value.
    captureUnit(makeUnit({ conversationId: 'conv-s', content: 'Customer: Fabrikam Ltd\nThe invoice module moves to Monday instead.' }))
    ingest.flushConversation('conv-s', 'manual')
    await vi.waitFor(() => expect(worker.status().runs).toBe(2))
    const newGist = currentGist(db, 'conv-s')
    const newFact = liveFact(db, 'customer')
    expect(newGist).not.toBe(oldGist)
    expect(newFact).not.toBe(oldFact)

    const owners = embeddedOwners(db)
    expect(owners.has(newGist)).toBe(true)
    expect(owners.has(newFact)).toBe(true)
    expect(owners.has(oldGist)).toBe(false)
    expect(owners.has(oldFact)).toBe(false)
    expect(vecRows(raw, oldGistRid)).toBe(0)
    expect(vecRows(raw, oldFactRid)).toBe(0)
    expect(db.all(sql`SELECT rid FROM memory_item WHERE rid IN (${oldGistRid}, ${oldFactRid})`)).toEqual([])
    expect(worker.status().totals.retired).toBeGreaterThanOrEqual(2)

    const after = (await retrieve({ db, rawDb: raw, bridge, logger: silentLogger }, { query: 'customer Contoso Kft', language: 'en', projectId: null })).map((h) => h.id)
    expect(after).not.toContain(`gs:${oldGist}`)
    expect(after).not.toContain(`ft:${oldFact}`)
  })
})

describe('L3 worker — retiring dead vectors', () => {
  async function seeded() {
    const { db, raw } = world()
    let secrets = false
    const worker = createL3EmbedWorker({
      db, getRawDb: () => raw, bridge: createHashEmbedder(), logger: silentLogger, includeSecrets: () => secrets, debounceMs: 5,
    })
    gistRow(db, 'g-live', 'Invoices are approved by the finance lead')
    gistRow(db, 'g-tomb', 'An old gist about the warehouse move')
    gistRow(db, 'g-secret', 'The staging password rotates weekly')
    factRow(db, 'f-live', 'finance lead', 'approves invoices')
    factRow(db, 'f-quar', 'warehouse', 'moves to the north site')
    await worker.drain()
    return { db, raw, worker, setSecrets: (v: boolean) => { secrets = v } }
  }

  it('drops tombstoned, quarantined and secret-marked owners, keeps live ones', async () => {
    const { db, worker } = await seeded()
    expect([...embeddedOwners(db).keys()].sort()).toEqual(['f-live', 'f-quar', 'g-live', 'g-secret', 'g-tomb'])
    db.run(sql`UPDATE memory_gist SET tombstoned = 1 WHERE id = 'g-tomb'`)
    db.run(sql`UPDATE memory_fact SET trust_tier = 'quarantined' WHERE id = 'f-quar'`)
    const secretRid = (db.all(sql`SELECT rid FROM memory_gist WHERE id = 'g-secret'`) as Array<{ rid: number }>)[0]!.rid
    markSecrets(db, secretRid, 'gist')

    const result = await worker.drain()
    expect(result.retired).toBe(3)
    expect([...embeddedOwners(db).keys()].sort()).toEqual(['f-live', 'g-live'])
  })

  it('with includeSecrets a secret-marked owner keeps (or regains) its vector', async () => {
    const { db, worker, setSecrets } = await seeded()
    const secretRid = (db.all(sql`SELECT rid FROM memory_gist WHERE id = 'g-secret'`) as Array<{ rid: number }>)[0]!.rid
    markSecrets(db, secretRid, 'gist')
    setSecrets(true)
    expect((await worker.drain()).retired).toBe(0)
    expect(embeddedOwners(db).has('g-secret')).toBe(true)

    setSecrets(false)
    await worker.drain()
    expect(embeddedOwners(db).has('g-secret')).toBe(false)
    setSecrets(true)
    await worker.drain()
    expect(embeddedOwners(db).has('g-secret')).toBe(true)
  })

  it('a live owner is never retired, even across repeated drains', async () => {
    const { db, worker } = await seeded()
    for (let i = 0; i < 3; i++) expect((await worker.drain()).retired).toBe(0)
    expect(embeddedOwners(db).size).toBe(5)
  })
})

describe('L3 worker — scheduling', () => {
  function slowBridge(delayMs = 20) {
    const inner = createHashEmbedder()
    let active = 0
    const seen = { maxConcurrent: 0, calls: 0 }
    const bridge: EmbeddingProvider = {
      ...inner,
      async embed(texts) {
        active++
        seen.calls++
        seen.maxConcurrent = Math.max(seen.maxConcurrent, active)
        await new Promise((r) => setTimeout(r, delayMs))
        active--
        return inner.embed(texts)
      },
    }
    return { bridge, seen }
  }

  it('coalesces a burst of kicks into one drain', async () => {
    const { db, raw } = world()
    gistRow(db, 'g-1', 'Invoices are approved by the finance lead')
    const worker = createL3EmbedWorker({ db, getRawDb: () => raw, bridge: createHashEmbedder(), logger: silentLogger, includeSecrets: () => false, debounceMs: 20 })
    worker.kick(); worker.kick(); worker.kick()
    expect(worker.status().scheduled).toBe(true)
    await vi.waitFor(() => expect(worker.status().runs).toBe(1))
    await new Promise((r) => setTimeout(r, 60))
    expect(worker.status().runs).toBe(1)
  })

  it('never runs two drains at once; a drain requested mid-run gets one more pass', async () => {
    const { db, raw } = world()
    gistRow(db, 'g-1', 'Invoices are approved by the finance lead')
    const { bridge, seen } = slowBridge()
    const worker = createL3EmbedWorker({ db, getRawDb: () => raw, bridge, logger: silentLogger, includeSecrets: () => false })
    const first = worker.drain()
    gistRow(db, 'g-2', 'The warehouse moves to the north site')
    const second = worker.drain()
    expect(second).toBe(first)
    const result = await first
    expect(seen.maxConcurrent).toBe(1)
    expect(result.gists).toBe(2)
    expect(worker.status().runs).toBe(2)
    expect(worker.status().running).toBe(false)
  })

  it('a failing embedder ends the pass without throwing and is reported', async () => {
    const { db, raw } = world()
    gistRow(db, 'g-1', 'Invoices are approved by the finance lead')
    const warn = vi.fn()
    const broken: EmbeddingProvider = { ...createHashEmbedder(), embed: async () => { throw new Error('onnx exploded') } }
    const worker = createL3EmbedWorker({ db, getRawDb: () => raw, bridge: broken, logger: { ...silentLogger, warn }, includeSecrets: () => false })
    await expect(worker.drain()).resolves.toMatchObject({ gists: 0 })
    expect(worker.status().lastError).toContain('onnx exploded')
    expect(warn).toHaveBeenCalled()
    expect(embeddedOwners(db).size).toBe(0)
  })

  it('after stop() a kick does nothing and a drain is a no-op', async () => {
    const { db, raw } = world()
    gistRow(db, 'g-1', 'Invoices are approved by the finance lead')
    const worker = createL3EmbedWorker({ db, getRawDb: () => raw, bridge: createHashEmbedder(), logger: silentLogger, includeSecrets: () => false, debounceMs: 5 })
    worker.kick()
    await worker.stop()
    worker.kick()
    await new Promise((r) => setTimeout(r, 30))
    expect(worker.status().runs).toBe(0)
    expect(worker.status().scheduled).toBe(false)
    expect(await worker.drain()).toEqual({ gists: 0, facts: 0, entities: 0, retired: 0, demoted: 0 })
    expect(embeddedOwners(db).size).toBe(0)
  })
})

describe('recall embeds locally even with an embedding tier configured', () => {
  function fakeGateway() {
    const embed = vi.fn(async (req: EmbedRequest) => ({
      provider: 'acme', model: 'embed-1', embeddings: req.texts.map(() => new Array(1_536).fill(0.01)), dimensions: 1_536,
    }))
    const gateway: any = {
      listProviders: () => [
        { id: 'acme', name: 'Acme', embed: vi.fn() },
        { id: 'cli', name: 'CLI only' },
      ],
      embed,
    }
    return { gateway, embed }
  }

  it('L3 vectors carry the local model id and retrieve() never calls gateway.embed', async () => {
    const { db, raw } = world()
    const { gateway, embed } = fakeGateway()
    const bridges = await selectEmbeddingBridges({
      gateway, embeddingTier: { provider: 'acme', model: 'embed-1' }, createLocal: async () => createHashEmbedder(),
    })
    expect(bridges.legacySource).toBe('gateway')

    gistRow(db, 'g-1', 'Invoices are approved by the finance lead')
    factRow(db, 'f-1', 'finance lead', 'approves invoices')
    const worker = createL3EmbedWorker({ db, getRawDb: () => raw, bridge: bridges.l3, logger: silentLogger, includeSecrets: () => false })
    await worker.drain()
    const models = new Set(embeddedOwners(db).values())
    expect([...models]).toEqual([HASH_EMBED_MODEL_ID])

    await retrieve({ db, rawDb: raw, bridge: bridges.l3, logger: silentLogger }, { query: 'who approves invoices', language: 'en', projectId: null })
    expect(embed).not.toHaveBeenCalled()

    // The tier still serves the legacy vault/episodic index.
    await bridges.legacy.embed(['a vault note'])
    expect(embed).toHaveBeenCalledTimes(1)
  })

  it('a tier naming a provider that cannot embed leaves the legacy index local too', async () => {
    const { gateway } = fakeGateway()
    const local = createHashEmbedder()
    const cli = await selectEmbeddingBridges({ gateway, embeddingTier: { provider: 'cli', model: 'x' }, createLocal: async () => local })
    expect(cli.legacySource).toBe('local')
    expect(cli.legacy).toBe(local)
    const none = await selectEmbeddingBridges({ gateway, embeddingTier: { provider: '', model: '' }, createLocal: async () => local })
    expect(none.legacySource).toBe('local')
    expect(none.l3).toBe(local)
  })
})

describe('memory/index.ts wiring (source contract)', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/modules/memory/index.ts'), 'utf-8')
  it('recall gets the local bridge; every flush kicks the worker; stop stops it', () => {
    expect(source).toMatch(/embeddingBridge = l3Bridge/)
    expect(source).toMatch(/ingest\.onFlushed\(\(\) => l3Worker\?\.kick\(\)\)/)
    expect(source).toMatch(/l3Worker\.stop\(\)/)
  })
  it('no boot-only embed loop is left', () => {
    expect(source).not.toMatch(/embedLayeredBatch\(/)
  })
})
