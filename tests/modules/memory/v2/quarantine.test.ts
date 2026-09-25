// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B10 (EMP-6) — the owner's quarantine of memory one provider wrote. A
// provider's replies and tool output, the facts and summaries derived from
// them and its conversations' capture notes leave recall together (retrieve,
// memory_expand, the standing index, KNN); release restores the exact prior
// tiers and puts the notes back. Every case checks both directions: the
// owner's own messages, other providers and other conversations are
// untouched. Fictive content throughout.

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { initZstd } from '@shared/zstd'
import { probeSqliteCapabilities } from '@core/db/sqlite-capabilities'
import { createWikilinkService } from '@shared/wikilinks'
import { createVaultService } from '@modules/memory/vault/vault-service'
import { createVaultIndexer } from '@modules/memory/vault/vault-indexer'
import { buildMemoryIndex } from '@modules/memory/memory-index'
import { createHashEmbedder } from '@modules/memory/embeddings/hash-embedder'
import { createMemoryIngest, type MemoryIngest } from '@modules/memory/v2/ingest'
import { runExtraction } from '@modules/memory/v2/extractor'
import { migrateImportedIntoL0, vaultConversationId } from '@modules/memory/v2/migrate-imported'
import { retrieve } from '@modules/memory/v2/retrieve'
import { expandMemoryId } from '@modules/memory/v2/expand'
import { embedLayeredBatch } from '@modules/memory/v2/l3-embed'
import {
  applyQuarantine,
  listQuarantineProviders,
  listQuarantines,
  previewQuarantine,
  QUARANTINE_DIR,
  QuarantineError,
  QuarantineSelectionSchema,
  releaseQuarantine,
  type QuarantineDeps,
} from '@modules/memory/v2/quarantine'
import type { VaultFrontmatter } from '@modules/memory/types'
import { makeD1Db, factRow } from './d1-fixtures'
import { makeUnit, silentLogger, testIngestConfig } from './helpers'

beforeAll(async () => { await initZstd() })

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const QUERY = 'borealis ledger reconciliation'
const DAY = 86_400_000
const T0 = Date.UTC(2026, 8, 10)

const CAPTURE_NOTE = 'semantic/borealis-capture.md'
const OWNER_NOTE = 'semantic/borealis-owner.md'
const CLAUDE_NOTE = 'semantic/borealis-claude.md'

const fm = (over: Partial<VaultFrontmatter> = {}): VaultFrontmatter => ({
  title: 'Note', tags: [], tier: 'semantic', links: [], created: '2026-09-10', updated: '2026-09-10', ...over,
})

interface World {
  db: any
  raw: any
  vec0: boolean
  ingest: MemoryIngest
  vault: ReturnType<typeof createVaultService>
  indexer: ReturnType<typeof createVaultIndexer>
  root: string
  deps: QuarantineDeps
}

function makeWorld(): World {
  const { db, raw, vec0 } = makeD1Db()
  db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, provider_id TEXT, title TEXT, status TEXT, stage_id TEXT, pinned INTEGER, project_id TEXT)`)
  const ingest = createMemoryIngest({
    db, caps: probeSqliteCapabilities(raw), config: () => testIngestConfig, instanceId: 'inst-test', logger: silentLogger,
  })
  ingest.onFlushed((conversationId, reason) => {
    runExtraction(db, conversationId, reason, { logger: silentLogger, config: () => ({ engine: 'legacy', extractInLegacy: true }) })
  })
  const root = mkdtempSync(join(tmpdir(), 'eyas-quarantine-'))
  roots.push(root)
  const vault = createVaultService(root)
  const wikilinks = createWikilinkService(db)
  wikilinks.init()
  const indexer = createVaultIndexer(db, vault, wikilinks)
  const deps: QuarantineDeps = {
    db, vaultRoot: root, indexer, logger: silentLogger, flushPending: () => { ingest.flushAll('manual') },
  }
  return { db, raw, vec0, ingest, vault, indexer, root, deps }
}

function conversation(db: any, id: string, providerId: string | null): void {
  db.run(sql`INSERT INTO conversations (id, provider_id, title) VALUES (${id}, ${providerId}, ${id})`)
}

/** Row ids the scene names, for the assertions. */
interface Scene {
  grokReply: string
  grokTool: string
  grokUser: string
  oldReply: string
  claudeReply: string
  mixedReply: string
}

function unit(conversationId: string, sourceType: 'user_message' | 'assistant_message' | 'tool_result', content: string, meta: Record<string, unknown>, at = T0) {
  return makeUnit({
    conversationId,
    sourceType,
    content,
    actor: sourceType === 'user_message' ? 'owner-1' : 'assistant',
    trustTier: sourceType === 'user_message' ? 'owner' : sourceType === 'tool_result' ? 'ingested' : 'derived',
    occurredAtMs: at,
    meta,
  })
}

/**
 * conv-grok: grok-cli answered (meta), a grok tool result, the owner's question.
 * conv-old: an older reply with no provider in its meta; the conversation is pinned to grok-cli.
 * conv-claude: claude-code answered. conv-mixed: pinned to grok-cli, but its row says claude-code.
 * Capture notes: one of conv-grok, one of conv-claude; one owner note linked to nothing.
 */
async function seedScene(w: World): Promise<Scene> {
  conversation(w.db, 'conv-grok', 'grok-cli')
  conversation(w.db, 'conv-old', 'grok-cli')
  conversation(w.db, 'conv-claude', 'claude-code')
  conversation(w.db, 'conv-mixed', 'grok-cli')
  const units = {
    grokUser: unit('conv-grok', 'user_message', 'Please look into the quarterly numbers for me.', { origin: 'conversation_messages' }),
    grokReply: unit('conv-grok', 'assistant_message',
      'The borealis ledger reconciliation closes on the ninth, and the borealis auditors signed the reconciliation.',
      { origin: 'conversation_messages', provider: 'grok-cli', model: 'grok-x' }, T0 + 1_000),
    grokTool: unit('conv-grok', 'tool_result', 'borealis ledger export: reconciliation rows forty two',
      { origin: 'agent_run', provider: 'grok-cli', model: 'grok-x' }, T0 + 2_000),
    oldReply: unit('conv-old', 'assistant_message', 'Earlier: the borealis ledger reconciliation moved to the ninth of each month.',
      { origin: 'conversation_messages' }, T0 - DAY),
    claudeReply: unit('conv-claude', 'assistant_message', 'Per the owner, the borealis ledger reconciliation is reviewed by finance.',
      { origin: 'conversation_messages', provider: 'claude-code' }, T0 + 3_000),
    mixedReply: unit('conv-mixed', 'assistant_message', 'Mixed: the borealis ledger reconciliation answered by the other provider.',
      { origin: 'agent_events', provider: 'claude-code' }, T0 + 4_000),
  }
  for (const u of Object.values(units)) w.ingest.enqueue(u)
  w.ingest.flushAll('manual')

  // A model extractor would source facts on the reply itself (tagged as arbitration tags them).
  for (const [id, object, source] of [
    ['f-grok', 'closes on the ninth per grok', units.grokReply.id],
    ['f-claude', 'reviewed by finance per claude', units.claudeReply.id],
  ] as const) {
    const rid = factRow(w.db, id, 'borealis ledger reconciliation', object)
    w.db.run(sql`INSERT INTO memory_tag (memory_rid, memory_type, tag_type, tag_value) VALUES (${rid}, 'fact', 'trust_tier', 'derived')`)
    w.db.run(sql`INSERT INTO memory_fact_source (fact_id, episode_id) VALUES (${id}, ${source})`)
  }

  w.vault.write(CAPTURE_NOTE, fm({ title: 'Borealis capture', summary: 'Borealis ledger reconciliation closes on the ninth' }),
    'The borealis ledger reconciliation closes on the ninth.\n')
  w.vault.write(CLAUDE_NOTE, fm({ title: 'Borealis claude', summary: 'Borealis ledger reconciliation reviewed by finance' }),
    'The borealis ledger reconciliation is reviewed by finance.\n')
  w.vault.write(OWNER_NOTE, fm({ title: 'Borealis owner', summary: 'Borealis ledger reconciliation checklist of the owner' }),
    'The borealis ledger reconciliation checklist the owner keeps.\n')
  w.db.run(sql`INSERT INTO memory_note_links (note_path, owner_module, owner_id, source) VALUES
    (${CAPTURE_NOTE}, 'conversations', 'conv-grok', 'capture'),
    (${CLAUDE_NOTE}, 'conversations', 'conv-claude', 'capture')`)
  w.indexer.indexAll()
  await migrateImportedIntoL0({ db: w.db, ingest: w.ingest, vault: w.vault, logger: silentLogger })
  return {
    grokReply: units.grokReply.id,
    grokTool: units.grokTool.id,
    grokUser: units.grokUser.id,
    oldReply: units.oldReply.id,
    claudeReply: units.claudeReply.id,
    mixedReply: units.mixedReply.id,
  }
}

/** Every trust tier of raw, fact and gist rows, by id. */
function tiers(db: any): Map<string, string> {
  const out = new Map<string, string>()
  for (const table of ['memory_raw', 'memory_fact', 'memory_gist']) {
    for (const r of db.all(sql.raw(`SELECT id, trust_tier FROM ${table}`)) as Array<{ id: string; trust_tier: string }>) out.set(r.id, r.trust_tier)
  }
  return out
}

function tierTags(db: any): Map<number, string> {
  const out = new Map<number, string>()
  for (const r of db.all(sql`SELECT memory_rid, tag_value FROM memory_tag WHERE tag_type = 'trust_tier'`) as Array<{ memory_rid: number; tag_value: string }>) {
    out.set(r.memory_rid, r.tag_value)
  }
  return out
}

function tierOf(db: any, table: string, id: string): string {
  return (db.all(sql.raw(`SELECT trust_tier AS t FROM ${table} WHERE id = '${id}'`)) as Array<{ t: string }>)[0]!.t
}

function taskGist(db: any, conversationId: string): string {
  const row = (db.all(sql`SELECT id FROM memory_gist WHERE scope_type = 'task' AND scope_id = ${conversationId} AND is_current = 1`) as Array<{ id: string }>)[0]
  expect(row, `gist of ${conversationId}`).toBeDefined()
  return row!.id
}

function noteRows(db: any, path: string): Array<{ id: string; rid: number }> {
  return db.all(sql`SELECT id, rid FROM memory_raw WHERE conversation_id = ${vaultConversationId(path)}`) as Array<{ id: string; rid: number }>
}

/** Facts with at least one source among the given raw rows. */
function factsOf(db: any, rawIds: string[]): string[] {
  return (db.all(sql`SELECT DISTINCT fact_id AS id FROM memory_fact_source
    WHERE episode_id IN (SELECT value FROM json_each(${JSON.stringify(rawIds)}))`) as Array<{ id: string }>).map((r) => r.id)
}

function noteFacts(db: any, path: string): string[] {
  return (db.all(sql`SELECT DISTINCT s.fact_id AS id FROM memory_fact_source s
    JOIN memory_raw r ON r.id = s.episode_id WHERE r.conversation_id = ${vaultConversationId(path)}`) as Array<{ id: string }>).map((r) => r.id)
}

async function recallIds(w: World, bridge?: ReturnType<typeof createHashEmbedder>): Promise<string[]> {
  return (await retrieve({ db: w.db, rawDb: w.raw, bridge, logger: silentLogger }, { query: QUERY, projectId: null, language: 'en', limit: 50 }))
    .map((h) => h.id)
}

const GROK = { providers: ['grok-cli'] }

describe('selection schema', () => {
  it('(+) accepts providers with an optional range and conversations', () => {
    expect(QuarantineSelectionSchema.safeParse({ providers: ['grok-cli'], from: 1, to: 2, conversationIds: ['c'] }).success).toBe(true)
    expect(QuarantineSelectionSchema.safeParse({ providers: ['grok-cli'], from: null, to: null }).success).toBe(true)
  })

  it('(−) refuses no provider, an inverted range, a negative time and unknown keys', () => {
    expect(QuarantineSelectionSchema.safeParse({ providers: [] }).success).toBe(false)
    expect(QuarantineSelectionSchema.safeParse({ providers: ['x'], from: 5, to: 4 }).success).toBe(false)
    expect(QuarantineSelectionSchema.safeParse({ providers: ['x'], from: -1 }).success).toBe(false)
    expect(QuarantineSelectionSchema.safeParse({ providers: ['x'], everything: true }).success).toBe(false)
  })
})

describe('preview', () => {
  it('counts the raw rows, facts, gists and notes an apply would quarantine, and changes nothing', async () => {
    const w = makeWorld()
    const s = await seedScene(w)
    const before = tiers(w.db)
    const counts = previewQuarantine(w.deps, GROK)
    // grok reply + grok tool result + the old reply (conversation fallback) + the capture note's L0 row(s)
    const selected = [s.grokReply, s.grokTool, s.oldReply, ...noteRows(w.db, CAPTURE_NOTE).map((r) => r.id)]
    expect(counts.raw).toBe(selected.length)
    // Every fact with a source among them: f-grok, the note's 'states' fact, the board facts of both tasks.
    const facts = factsOf(w.db, selected)
    expect(facts).toContain('f-grok')
    expect(facts).not.toContain('f-claude')
    expect(counts.facts).toBe(facts.length)
    // conv-grok's and conv-old's task gists and the capture note's gist at least
    expect(counts.gists).toBeGreaterThanOrEqual(3)
    expect(counts.notes).toBe(1)
    expect(counts.conversations).toBe(2)
    expect(tiers(w.db)).toEqual(before)
    expect(existsSync(join(w.root, CAPTURE_NOTE))).toBe(true)
  })

  it('(−) an unknown provider selects nothing', async () => {
    const w = makeWorld()
    await seedScene(w)
    expect(previewQuarantine(w.deps, { providers: ['kimi-cli'] })).toEqual({ raw: 0, facts: 0, gists: 0, notes: 0, conversations: 0 })
  })
})

describe('apply', () => {
  it('takes the provider\'s rows, derived facts, gists and capture notes out of every recall path', async () => {
    const w = makeWorld()
    const s = await seedScene(w)
    const grokGist = taskGist(w.db, 'conv-grok')
    const oldGist = taskGist(w.db, 'conv-old')
    const noteGist = taskGist(w.db, vaultConversationId(CAPTURE_NOTE))
    const hidden = [`rw:${s.grokReply}`, `rw:${s.grokTool}`, `rw:${s.oldReply}`, `vt:${CAPTURE_NOTE}`, `gs:${grokGist}`, `gs:${oldGist}`, 'ft:f-grok']

    const seen = await recallIds(w)
    expect(seen).toContain(`rw:${s.grokReply}`)
    expect(seen).toContain(`vt:${CAPTURE_NOTE}`)
    expect(buildMemoryIndex(w.db, { projectId: null, conversationId: 'c-now' })!.ids).toContain(`vt:${CAPTURE_NOTE}`)

    const result = applyQuarantine(w.deps, GROK, 'owner-1')
    expect(result.id).toMatch(/^[0-9A-Z]{26}$/)

    const after = await recallIds(w)
    for (const id of hidden) expect(after, id).not.toContain(id)
    // Other providers, the conversation fallback's limits and the owner's notes stay.
    expect(after).toContain(`rw:${s.claudeReply}`)
    expect(after).toContain(`rw:${s.mixedReply}`)
    expect(after).toContain(`vt:${OWNER_NOTE}`)
    expect(after).toContain(`vt:${CLAUDE_NOTE}`)

    const none = { projectId: null, projectTypeId: null }
    for (const id of hidden) expect(expandMemoryId(w.db, id, none), id).toBeNull()
    expect(expandMemoryId(w.db, `gs:${noteGist}`, none)).toBeNull()
    for (const f of noteFacts(w.db, CAPTURE_NOTE)) expect(expandMemoryId(w.db, `ft:${f}`, none), f).toBeNull()
    expect(expandMemoryId(w.db, `rw:${s.claudeReply}`, none)).not.toBeNull()
    expect(expandMemoryId(w.db, 'ft:f-claude', none)).not.toBeNull()

    const index = buildMemoryIndex(w.db, { projectId: null, conversationId: 'c-now' })!
    expect(index.ids).not.toContain(`vt:${CAPTURE_NOTE}`)
    expect(index.ids).not.toContain(`gs:${grokGist}`)
    expect(index.ids).not.toContain(`gs:${oldGist}`)
    expect(index.ids).toContain(`vt:${OWNER_NOTE}`)
    expect(index.ids).toContain(`gs:${taskGist(w.db, 'conv-claude')}`)

    // The note is moved, never deleted.
    expect(existsSync(join(w.root, CAPTURE_NOTE))).toBe(false)
    expect(existsSync(join(w.root, QUARANTINE_DIR, result.id!, CAPTURE_NOTE))).toBe(true)
    expect(w.vault.listFiles()).not.toContain(CAPTURE_NOTE)
    // Rows and their trust_tier tags agree.
    const tags = tierTags(w.db)
    for (const r of w.db.all(sql`SELECT rid FROM memory_raw WHERE id IN (${s.grokReply}, ${s.grokTool}, ${s.oldReply})`) as Array<{ rid: number }>) {
      expect(tags.get(r.rid)).toBe('quarantined')
    }
  })

  it('(−) leaves the owner\'s messages, other providers and other conversations exactly as they were', async () => {
    const w = makeWorld()
    const s = await seedScene(w)
    const before = tiers(w.db)
    applyQuarantine(w.deps, GROK, 'owner-1')
    const after = tiers(w.db)
    for (const id of [s.grokUser, s.claudeReply, s.mixedReply, 'f-claude', taskGist(w.db, 'conv-claude'), taskGist(w.db, 'conv-mixed'),
      ...noteRows(w.db, OWNER_NOTE).map((r) => r.id), ...noteRows(w.db, CLAUDE_NOTE).map((r) => r.id)]) {
      expect(after.get(id), id).toBe(before.get(id))
    }
    expect(after.get(s.grokUser)).toBe('owner')
    expect(existsSync(join(w.root, CLAUDE_NOTE))).toBe(true)
    expect(existsSync(join(w.root, OWNER_NOTE))).toBe(true)
  })

  it('re-applying the same selection changes nothing and writes no second log row', async () => {
    const w = makeWorld()
    await seedScene(w)
    const first = applyQuarantine(w.deps, GROK, 'owner-1')
    const snapshot = tiers(w.db)
    const again = applyQuarantine(w.deps, GROK, 'owner-1')
    expect(again).toEqual({ id: null, counts: { raw: 0, facts: 0, gists: 0, notes: 0, conversations: 2 } })
    expect(tiers(w.db)).toEqual(snapshot)
    expect(listQuarantines(w.db).map((e) => e.id)).toEqual([first.id])
    expect(previewQuarantine(w.deps, GROK)).toMatchObject({ raw: 0, facts: 0, gists: 0, notes: 0 })
  })

  it('narrows by conversation and by time range', async () => {
    const w = makeWorld()
    const s = await seedScene(w)
    const onlyOld = applyQuarantine(w.deps, { providers: ['grok-cli'], conversationIds: ['conv-old'] }, 'owner-1')
    expect(onlyOld.counts.conversations).toBe(1)
    expect(tierOf(w.db, 'memory_raw', s.oldReply)).toBe('quarantined')
    expect(tierOf(w.db, 'memory_raw', s.grokReply)).toBe('derived')
    expect(existsSync(join(w.root, CAPTURE_NOTE))).toBe(true)

    // [T0 + 1.5 s, ∞) holds the grok tool result, not the grok reply.
    applyQuarantine(w.deps, { providers: ['grok-cli'], from: T0 + 1_500 }, 'owner-1')
    expect(tierOf(w.db, 'memory_raw', s.grokTool)).toBe('quarantined')
    expect(tierOf(w.db, 'memory_raw', s.grokReply)).toBe('derived')
    // (−) a range with no rows selects nothing.
    expect(previewQuarantine(w.deps, { providers: ['grok-cli'], to: T0 - 2 * DAY })).toMatchObject({ raw: 0, notes: 0 })
  })

  it('a row\'s own provider wins over its conversation\'s pinned provider', async () => {
    const w = makeWorld()
    const s = await seedScene(w)
    applyQuarantine(w.deps, { providers: ['claude-code'] }, 'owner-1')
    expect(tierOf(w.db, 'memory_raw', s.mixedReply)).toBe('quarantined')
    expect(tierOf(w.db, 'memory_raw', s.claudeReply)).toBe('quarantined')
    expect(tierOf(w.db, 'memory_raw', s.grokReply)).toBe('derived')
    expect(tierOf(w.db, 'memory_raw', s.oldReply)).toBe('derived')
  })

  it('(−) a note that cannot be moved aborts the whole apply: no tier changes, no log row, notes in place', async () => {
    const w = makeWorld()
    await seedScene(w)
    // A file where the quarantine folder should be: mkdir fails.
    writeFileSync(join(w.root, QUARANTINE_DIR), 'not a folder')
    const before = tiers(w.db)
    expect(() => applyQuarantine(w.deps, GROK, 'owner-1')).toThrow(QuarantineError)
    expect(tiers(w.db)).toEqual(before)
    expect(listQuarantines(w.db)).toEqual([])
    expect(existsSync(join(w.root, CAPTURE_NOTE))).toBe(true)
  })
})

describe('release', () => {
  it('restores the exact prior tiers and tags, moves the notes back and makes them recallable again', async () => {
    const w = makeWorld()
    const s = await seedScene(w)
    const before = tiers(w.db)
    const beforeTags = tierTags(w.db)
    const { id } = applyQuarantine(w.deps, GROK, 'owner-1')
    const released = releaseQuarantine(w.deps, id!, 'owner-1')
    expect(released.counts.notes).toBe(1)
    expect(released.renamed).toEqual([])
    expect(released.missing).toEqual([])
    expect(tiers(w.db)).toEqual(before)
    expect(tierTags(w.db)).toEqual(beforeTags)
    expect(existsSync(join(w.root, CAPTURE_NOTE))).toBe(true)
    expect(existsSync(join(w.root, QUARANTINE_DIR, id!))).toBe(false)

    const again = await recallIds(w)
    expect(again).toContain(`rw:${s.grokReply}`)
    expect(again).toContain(`vt:${CAPTURE_NOTE}`)
    expect(expandMemoryId(w.db, `gs:${taskGist(w.db, 'conv-grok')}`, { projectId: null })).not.toBeNull()
    expect(expandMemoryId(w.db, 'ft:f-grok', { projectId: null })).not.toBeNull()
    expect(buildMemoryIndex(w.db, { projectId: null, conversationId: 'c-now' })!.ids).toContain(`vt:${CAPTURE_NOTE}`)
    // The re-indexed capture note is still model-written, never the owner's.
    expect((w.db.all(sql`SELECT trust_tier AS t FROM vault_index WHERE path = ${CAPTURE_NOTE}`) as Array<{ t: string }>)[0]!.t).toBe('derived')

    const [entry] = listQuarantines(w.db)
    expect(entry).toMatchObject({ id, providers: ['grok-cli'], createdBy: 'owner-1', releasedBy: 'owner-1' })
    expect(entry!.releasedAt).toBeGreaterThan(0)
  })

  it('(−) a row that was quarantined before (the poisoning gate) stays quarantined after release', async () => {
    const w = makeWorld()
    await seedScene(w)
    w.db.run(sql`UPDATE memory_fact SET trust_tier = 'quarantined' WHERE id = 'f-grok'`)
    const { id } = applyQuarantine(w.deps, GROK, 'owner-1')
    releaseQuarantine(w.deps, id!, 'owner-1')
    expect(tierOf(w.db, 'memory_fact', 'f-grok')).toBe('quarantined')
  })

  it('overlapping quarantines release independently', async () => {
    const w = makeWorld()
    const s = await seedScene(w)
    const narrow = applyQuarantine(w.deps, { providers: ['grok-cli'], conversationIds: ['conv-old'] }, 'owner-1')
    const wide = applyQuarantine(w.deps, GROK, 'owner-1')
    releaseQuarantine(w.deps, wide.id!, 'owner-1')
    expect(tierOf(w.db, 'memory_raw', s.grokReply)).toBe('derived')
    expect(tierOf(w.db, 'memory_raw', s.oldReply)).toBe('quarantined')
    releaseQuarantine(w.deps, narrow.id!, 'owner-1')
    expect(tierOf(w.db, 'memory_raw', s.oldReply)).toBe('derived')
  })

  it('restores a note beside a new note that took its path, carrying the capture link', async () => {
    const w = makeWorld()
    await seedScene(w)
    const { id } = applyQuarantine(w.deps, GROK, 'owner-1')
    w.vault.write(CAPTURE_NOTE, fm({ title: 'Newer note' }), 'A newer note at the same path.\n')
    const released = releaseQuarantine(w.deps, id!, 'owner-1')
    const restoredAs = 'semantic/borealis-capture-restored.md'
    expect(released.renamed).toEqual([{ path: CAPTURE_NOTE, restoredAs }])
    expect(w.vault.read(CAPTURE_NOTE)!.frontmatter.title).toBe('Newer note')
    expect(w.vault.read(restoredAs)!.frontmatter.title).toBe('Borealis capture')
    expect((w.db.all(sql`SELECT trust_tier AS t FROM vault_index WHERE path = ${restoredAs}`) as Array<{ t: string }>)[0]!.t).toBe('derived')
  })

  it('(−) a note deleted from the quarantine folder by hand is reported missing; the tiers are still restored', async () => {
    const w = makeWorld()
    const s = await seedScene(w)
    const { id } = applyQuarantine(w.deps, GROK, 'owner-1')
    rmSync(join(w.root, QUARANTINE_DIR, id!, CAPTURE_NOTE))
    const released = releaseQuarantine(w.deps, id!, 'owner-1')
    expect(released.missing).toEqual([CAPTURE_NOTE])
    expect(released.counts.notes).toBe(0)
    expect(tierOf(w.db, 'memory_raw', s.grokReply)).toBe('derived')
    expect(existsSync(join(w.root, CAPTURE_NOTE))).toBe(false)
  })

  it('(−) a record whose note points outside its own quarantine folder moves nothing', async () => {
    const w = makeWorld()
    await seedScene(w)
    const { id } = applyQuarantine(w.deps, GROK, 'owner-1')
    const row = (w.db.all(sql`SELECT details_json AS d FROM memory_purge_log WHERE id = ${id}`) as Array<{ d: string }>)[0]!
    const details = JSON.parse(row.d)
    details.notes = [{ path: OWNER_NOTE, stored: CLAUDE_NOTE }]
    w.db.run(sql`UPDATE memory_purge_log SET details_json = ${JSON.stringify(details)} WHERE id = ${id}`)
    const released = releaseQuarantine(w.deps, id!, 'owner-1')
    expect(released.missing).toEqual([OWNER_NOTE])
    expect(existsSync(join(w.root, CLAUDE_NOTE))).toBe(true)
    expect(w.vault.read(OWNER_NOTE)!.frontmatter.title).toBe('Borealis owner')
  })

  it('(−) refuses an unknown id and a second release, changing nothing', async () => {
    const w = makeWorld()
    await seedScene(w)
    expect(() => releaseQuarantine(w.deps, '01ZZZZZZZZZZZZZZZZZZZZZZZZ', 'owner-1')).toThrow(expect.objectContaining({ code: 'not_found' }))
    const { id } = applyQuarantine(w.deps, GROK, 'owner-1')
    releaseQuarantine(w.deps, id!, 'owner-1')
    const snapshot = tiers(w.db)
    expect(() => releaseQuarantine(w.deps, id!, 'owner-1')).toThrow(expect.objectContaining({ code: 'already_released' }))
    expect(tiers(w.db)).toEqual(snapshot)
  })
})

describe('providers list', () => {
  it('lists every provider with the rows recall can still return', async () => {
    const w = makeWorld()
    await seedScene(w)
    expect(listQuarantineProviders(w.db)).toEqual([
      { provider: 'claude-code', rows: 2 },
      { provider: 'grok-cli', rows: 3 },
    ])
    applyQuarantine(w.deps, GROK, 'owner-1')
    expect(listQuarantineProviders(w.db)).toEqual([
      { provider: 'claude-code', rows: 2 },
      { provider: 'grok-cli', rows: 0 },
    ])
  })
})

describe.skipIf(!makeD1Db().vec0)('KNN on sqlite-vec', () => {
  it('a quarantined gist or fact never comes back through vectors; after release it does', async () => {
    const w = makeWorld()
    await seedScene(w)
    const bridge = createHashEmbedder()
    while (true) {
      const b = await embedLayeredBatch({ db: w.db, rawDb: w.raw, bridge, logger: silentLogger })
      if (b.gists + b.facts === 0) break
    }
    const quarantinedOwners = [`gs:${taskGist(w.db, 'conv-grok')}`, `gs:${taskGist(w.db, 'conv-old')}`, 'ft:f-grok']
    const before = await recallIds(w, bridge)
    expect(before.some((id) => quarantinedOwners.includes(id))).toBe(true)

    const { id } = applyQuarantine(w.deps, GROK, 'owner-1')
    const hidden = await recallIds(w, bridge)
    for (const owner of quarantinedOwners) expect(hidden).not.toContain(owner)

    releaseQuarantine(w.deps, id!, 'owner-1')
    const back = await recallIds(w, bridge)
    expect(back.some((id) => quarantinedOwners.includes(id))).toBe(true)
  })
})
