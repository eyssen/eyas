// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Phase 1 acceptance (spec §15): replaying a conversation through the real
// L0 ingest and then runExtraction yields raw + fact + gist + tag + run
// rows with ZERO model calls — runExtraction has no model dependency at
// all (its deps are a logger and a config reader), and the run row proves it.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { initZstd } from '@shared/zstd'
import { createMemoryIngest, type MemoryIngest } from '@modules/memory/v2/ingest'
import { runExtraction, extractionWatermark } from '@modules/memory/v2/extractor'
import { makeV2Db, makeUnit, silentLogger, testIngestConfig } from './helpers'
import { count } from './extract-helpers'
import { EXTRACTION_FIXTURE } from './fixtures/extraction-conversation'

let db: any
let ingest: MemoryIngest
const t0 = Date.UTC(2026, 8, 3, 9)
const deps = (engine: 'legacy' | 'v2' = 'v2', extractInLegacy = true) => ({ logger: silentLogger, config: () => ({ engine, extractInLegacy }) })

beforeAll(async () => { await initZstd() })

beforeEach(() => {
  const v2 = makeV2Db()
  db = v2.db
  ingest = createMemoryIngest({ db, caps: v2.caps, config: () => testIngestConfig, instanceId: 'inst-test', logger: silentLogger })
  db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT, status TEXT NOT NULL DEFAULT 'active', stage_id TEXT, pinned INTEGER DEFAULT 0,
    project_id TEXT, user_id TEXT, agent_id TEXT, god_mode INTEGER DEFAULT 0, parent_conversation_id TEXT)`)
  db.run(sql`CREATE TABLE projects (id TEXT PRIMARY KEY, type_id TEXT)`)
  db.run(sql`CREATE TABLE stages (id TEXT PRIMARY KEY, is_closed INTEGER NOT NULL DEFAULT 0)`)
  db.run(sql`INSERT INTO projects VALUES ('p1', 'pt1')`)
  db.run(sql`INSERT INTO stages VALUES ('open', 0), ('done', 1)`)
  db.run(sql`INSERT INTO conversations (id, title, project_id, stage_id, agent_id) VALUES ('conv-30', 'Invoice rollout for Werth', 'p1', 'open', 'agent-1')`)
})

function replay(conversationId: string, messages: typeof EXTRACTION_FIXTURE, startMs: number): void {
  messages.forEach((m, i) => ingest.enqueue(makeUnit({
    conversationId, projectId: 'p1', projectTypeId: 'pt1',
    sourceType: m.role === 'user' ? 'user_message' : 'assistant_message',
    actor: m.role === 'user' ? 'owner-1' : 'agent-1',
    // Mirrors the committed hooks since 22d78116: model-authored text is
    // `derived`, only the owner's own turns are `owner`. makeUnit defaults every
    // unit to 'owner', which production can no longer produce.
    trustTier: m.role === 'user' ? 'owner' : 'derived',
    content: m.content, occurredAtMs: startMs + i * 60_000,
  })))
  ingest.flushConversation(conversationId, 'manual')
}
const runRow = (id: string) => (db.all(sql`SELECT * FROM memory_run WHERE id = ${id}`) as any[])[0]
const gists = () => db.all(sql`SELECT id, rid, text, is_current, superseded_by_gist_id, gist_source FROM memory_gist ORDER BY rid`) as any[]
const tagsOf = (rid: number) => (db.all(sql`SELECT tag_type, tag_value FROM memory_tag WHERE memory_rid = ${rid}`) as any[]).map((t) => `${t.tag_type}=${t.tag_value}`)

describe('runExtraction', () => {
  it('replays 30 messages with zero model calls into raw, fact, gist, tag and run rows', () => {
    replay('conv-30', EXTRACTION_FIXTURE, t0)
    expect(count(db, 'memory_raw')).toBe(30)
    const r = runExtraction(db, 'conv-30', 'close', deps())
    expect(r.status).toBe('ok')
    const [g] = gists()
    expect(gists()).toHaveLength(1)
    expect(g).toMatchObject({ is_current: 1, gist_source: 'heuristic' })
    expect(g.text.length).toBeLessThanOrEqual(280)
    expect(g.text.startsWith('Please plan the invoice module rollout for Werth Kft.')).toBe(true)
    // trust = min(sources): the conversation mixes `owner` user turns with
    // `derived` assistant turns, so the task gist is `derived`.
    expect(tagsOf(g.rid)).toEqual(expect.arrayContaining(['task=conv-30', 'layer=gist', 'project=p1', 'project_type=pt1', 'language=en', 'trust_tier=derived']))
    const facts = db.all(sql`SELECT subject, predicate, object_text FROM memory_fact`) as any[]
    for (const subject of ['customer', 'ticket', 'deadline', 'environment', 'reviewer']) expect(facts.some((f) => f.subject === subject && f.predicate === 'is')).toBe(true)
    expect(facts).toEqual(expect.arrayContaining([
      { subject: 'conv-30', predicate: 'title', object_text: 'Invoice rollout for Werth' },
      { subject: 'conv-30', predicate: 'project', object_text: 'p1' },
    ]))
    const run = runRow(r.runId)
    expect(run).toMatchObject({ run_type: 'extraction', status: 'ok', conversation_id: 'conv-30', model_used: null, model_calls_used: 0, rejected_candidate_count: 0, quarantined_candidate_count: 0 })
    expect(run.finished_at).not.toBeNull()
    expect(JSON.parse(run.stats_json)).toMatchObject({ trigger: 'close', units: 30, gist_id: g.id, gist_source: 'heuristic', facts_pending: true, watermark_from: 0, watermark_to: t0 + 29 * 60_000 })
    expect(extractionWatermark(db, 'conv-30')).toBe(t0 + 29 * 60_000)
    expect(count(db, 'memory_idf')).toBeGreaterThan(0)
    expect((db.all(sql`SELECT value FROM memory_meta WHERE key = 'idf_docs'`) as any[])[0].value).toBe('1')
  })

  it('a second run with nothing new is skipped, still records a run row, and leaves the watermark alone', () => {
    replay('conv-30', EXTRACTION_FIXTURE, t0)
    runExtraction(db, 'conv-30', 'close', deps())
    const again = runExtraction(db, 'conv-30', 'idle', deps())
    expect(again.status).toBe('skipped')
    expect(runRow(again.runId)).toMatchObject({ status: 'skipped', conversation_id: 'conv-30' })
    expect(JSON.parse(runRow(again.runId).stats_json)).toMatchObject({ reason: 'nothing_new', trigger: 'idle' })
    expect(gists()).toHaveLength(1)
    expect(count(db, 'memory_run')).toBe(2)
    expect(extractionWatermark(db, 'conv-30')).toBe(t0 + 29 * 60_000)
  })

  it('new rows above the watermark produce a new current gist that supersedes the old one', () => {
    replay('conv-30', EXTRACTION_FIXTURE, t0)
    runExtraction(db, 'conv-30', 'chunk', deps())
    replay('conv-30', [{ role: 'user', content: 'Update: the go-live moved to Sunday.\nGo-live: Sunday' }], t0 + 40 * 60_000)
    const r = runExtraction(db, 'conv-30', 'close', deps())
    expect(r.status).toBe('ok')
    const rows = gists()
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ is_current: 0, superseded_by_gist_id: rows[1].id })
    expect(rows[1]).toMatchObject({ is_current: 1 })
    expect(count(db, 'memory_fact', `subject = 'go-live'`)).toBe(1)
    expect(extractionWatermark(db, 'conv-30')).toBe(t0 + 40 * 60_000)
  })

  it('reason=rebuild ignores the watermark so p1d can re-derive after truncating the derived layers', () => {
    replay('conv-30', EXTRACTION_FIXTURE, t0)
    runExtraction(db, 'conv-30', 'close', deps())
    db.run(sql`DELETE FROM memory_item WHERE item_type IN ('fact', 'gist', 'entity')`)   // cascades to the typed rows and their tags
    expect(count(db, 'memory_gist')).toBe(0)
    expect(runExtraction(db, 'conv-30', 'idle', deps()).status).toBe('skipped')
    const r = runExtraction(db, 'conv-30', 'rebuild', deps())
    expect(r.status).toBe('ok')
    expect(gists()).toHaveLength(1)
    expect(count(db, 'memory_fact')).toBeGreaterThanOrEqual(5)
    expect(count(db, 'memory_raw')).toBe(30)
  })

  it('engine=legacy without extractInLegacy is skipped with a run row; with the flag it runs', () => {
    replay('conv-30', EXTRACTION_FIXTURE, t0)
    const off = runExtraction(db, 'conv-30', 'close', deps('legacy', false))
    expect(off.status).toBe('skipped')
    expect(JSON.parse(runRow(off.runId).stats_json)).toMatchObject({ reason: 'engine_legacy' })
    expect(count(db, 'memory_gist')).toBe(0)
    expect(runExtraction(db, 'conv-30', 'close', deps('legacy', true)).status).toBe('ok')
    expect(count(db, 'memory_gist')).toBe(1)
  })

  it('a conversation with no L0 rows is skipped', () => {
    const r = runExtraction(db, 'nope', 'idle', deps())
    expect(r.status).toBe('skipped')
    expect(JSON.parse(runRow(r.runId).stats_json)).toMatchObject({ reason: 'nothing_new', watermark: 0 })
  })

  it('drops the concatenated executeAgent message when every byte is already in the per-turn rows', () => {
    // The I3 shape: agent-runner appends one LlmResponse per turn, then
    // executeAgent persists all turns concatenated through addMessage. The two
    // survive p1b's cross-origin dedup because their content differs.
    const turns = ['First I inspect the staging certificate. ', 'Then I renew it before the rehearsal.']
    turns.forEach((text, i) => ingest.enqueue(makeUnit({
      conversationId: 'conv-i3', projectId: 'p1', projectTypeId: 'pt1',
      sourceType: 'assistant_message', actor: 'agent-1', trustTier: 'derived',
      content: text, occurredAtMs: t0 + i * 60_000,
      meta: { origin: 'agent_events', sessionId: 'sess-1', seq: i + 1 },
    })))
    ingest.enqueue(makeUnit({
      conversationId: 'conv-i3', projectId: 'p1', projectTypeId: 'pt1',
      sourceType: 'assistant_message', actor: 'agent-1', trustTier: 'derived',
      content: turns.join(''), occurredAtMs: t0 + 2 * 60_000,
      meta: { origin: 'conversation_messages', messageId: 'm1' },
    }))
    ingest.flushConversation('conv-i3', 'manual')
    expect(count(db, 'memory_raw', `conversation_id = 'conv-i3'`)).toBe(3)

    const r = runExtraction(db, 'conv-i3', 'close', deps())
    expect(r.status).toBe('ok')
    // L0 keeps all three; extraction saw two.
    expect(count(db, 'memory_raw', `conversation_id = 'conv-i3'`)).toBe(3)
    const stats = JSON.parse(runRow(r.runId).stats_json)
    expect(stats).toMatchObject({ units: 2, rows: 3 })
    const g = gists().find((x: any) => x.text.length > 0)
    expect(g.text.endsWith('Then I renew it before the rehearsal.')).toBe(true)
    // The watermark still passes the dropped row, or it would re-trigger forever.
    expect(extractionWatermark(db, 'conv-i3')).toBe(t0 + 2 * 60_000)
    expect(runExtraction(db, 'conv-i3', 'idle', deps()).status).toBe('skipped')
  })

  it('keeps the un-evented tail when a turn failed and only its partial text reached addMessage', () => {
    const evented = 'The first turn finished cleanly. '
    const tail = 'The second turn died halfway through the renew'
    ingest.enqueue(makeUnit({
      conversationId: 'conv-tail', projectId: 'p1', projectTypeId: 'pt1',
      sourceType: 'assistant_message', actor: 'agent-1', trustTier: 'derived',
      content: evented, occurredAtMs: t0,
      meta: { origin: 'agent_events', sessionId: 'sess-2', seq: 1 },
    }))
    ingest.enqueue(makeUnit({
      conversationId: 'conv-tail', projectId: 'p1', projectTypeId: 'pt1',
      sourceType: 'assistant_message', actor: 'agent-1', trustTier: 'derived',
      content: evented + tail, occurredAtMs: t0 + 60_000,
      meta: { origin: 'conversation_messages', messageId: 'm2' },
    }))
    ingest.flushConversation('conv-tail', 'manual')
    const r = runExtraction(db, 'conv-tail', 'close', deps())
    expect(r.status).toBe('ok')
    // Both rows are extracted; the second contributes only its tail, which is
    // the ONLY copy of the failing turn's answer anywhere.
    expect(JSON.parse(runRow(r.runId).stats_json)).toMatchObject({ units: 2, rows: 2 })
    const g = gists().find((x: any) => x.text.length > 0)
    expect(g.text).toContain('died halfway through')
    expect(g.text.indexOf('The first turn finished cleanly')).toBe(g.text.lastIndexOf('The first turn finished cleanly'))
  })

  it('a same-millisecond straggler arriving in a later flush is still extracted', () => {
    // `occurred_at >` plus a bare-number watermark would strand it silently and
    // permanently: executeAgent's closing addMessage can share a millisecond
    // with the last LlmResponse, and a chunk flush can split them.
    const at = t0 + 5 * 60_000
    ingest.enqueue(makeUnit({ conversationId: 'conv-tie', projectId: 'p1', projectTypeId: 'pt1', content: 'Deadline: 2026-10-01', occurredAtMs: at }))
    ingest.flushConversation('conv-tie', 'manual')
    expect(runExtraction(db, 'conv-tie', 'chunk', deps()).status).toBe('ok')

    ingest.enqueue(makeUnit({ conversationId: 'conv-tie', projectId: 'p1', projectTypeId: 'pt1', content: 'Environment: staging', occurredAtMs: at }))
    ingest.flushConversation('conv-tie', 'manual')
    expect(count(db, 'memory_raw', `conversation_id = 'conv-tie'`)).toBe(2)

    const r = runExtraction(db, 'conv-tie', 'close', deps())
    expect(r.status).toBe('ok')
    expect(JSON.parse(runRow(r.runId).stats_json)).toMatchObject({ units: 1 })
    expect(count(db, 'memory_fact', `subject = 'environment'`)).toBe(1)
  })

  it('both arbitration arrays come from units, so a dropped row cannot shift the trust zip', () => {
    // arbitrate zips sourceRawIds and sourceTrustTiers BY INDEX. Once
    // preferGranularTurns drops a row, `units` is no longer 1:1 with `rows`, and
    // taking the tiers from `rows` pairs each id with the NEXT row's tier. Here
    // that silently ESCALATES the board facts from `ingested` to `derived` — a
    // spec §3 invariant broken with no error, which is why the source comment
    // calls the rule load-bearing and why it needs an assertion rather than a note.
    const turns = ['First I check the certificate. ', 'Then I renew it.']
    turns.forEach((text, i) => ingest.enqueue(makeUnit({
      conversationId: 'conv-30', projectId: 'p1', projectTypeId: 'pt1',
      sourceType: 'assistant_message', actor: 'agent-1', trustTier: 'derived',
      content: text, occurredAtMs: t0 + i * 60_000,
      meta: { origin: 'agent_events', sessionId: 'sess-z', seq: i + 1 },
    })))
    ingest.enqueue(makeUnit({
      conversationId: 'conv-30', projectId: 'p1', projectTypeId: 'pt1',
      sourceType: 'assistant_message', actor: 'agent-1', trustTier: 'derived',
      content: turns.join(''), occurredAtMs: t0 + 2 * 60_000,
      meta: { origin: 'conversation_messages', messageId: 'm-z' },
    }))
    ingest.enqueue(makeUnit({
      conversationId: 'conv-30', projectId: 'p1', projectTypeId: 'pt1',
      sourceType: 'tool_result', actor: 'tool', trustTier: 'ingested',
      content: 'certificate renewed', occurredAtMs: t0 + 3 * 60_000,
      meta: { origin: 'tool_executor' },
    }))
    ingest.flushConversation('conv-30', 'manual')

    const r = runExtraction(db, 'conv-30', 'close', deps())
    expect(r.status).toBe('ok')
    // The board facts draw on every unit, so their trust is the minimum over the
    // batch — and the batch contains an `ingested` tool result.
    const title = (db.all(sql`SELECT id, trust_tier FROM memory_fact WHERE subject = 'conv-30' AND predicate = 'title'`) as Array<{ id: string; trust_tier: string }>)[0]
    expect(title.trust_tier).toBe('ingested')
    // And the gist's provenance follows `units` too: four raw rows were flushed,
    // three survived the drop, so the gist cites three raw children — not the row
    // the rule removed. Taking the ids from `rows` instead would cite the dropped
    // row as evidence for text that was never read. (A fact carries its own
    // sourceRawIds from the candidate, so only the gist sees the scope array.)
    expect(count(db, 'memory_raw', `conversation_id = 'conv-30'`)).toBe(4)
    const gistId = (db.all(sql`SELECT id FROM memory_gist WHERE scope_id = 'conv-30' AND is_current = 1`) as Array<{ id: string }>)[0].id
    expect(count(db, 'memory_gist_source', `gist_id = '${gistId}' AND child_type = 'raw'`)).toBe(3)
  })

  it('counts the rows stranded below the watermark instead of dropping them silently', () => {
    // occurred_at is the SOURCE's timestamp, not capture time, so a row can arrive
    // in a later flush already below the watermark. Those rows are never extracted;
    // L0 keeps them and a rebuild re-derives them, so this is recoverable — but it
    // must be visible in the run ledger rather than silent.
    replay('conv-30', EXTRACTION_FIXTURE, t0)
    runExtraction(db, 'conv-30', 'close', deps())
    ingest.enqueue(makeUnit({
      conversationId: 'conv-30', projectId: 'p1', projectTypeId: 'pt1',
      content: 'Backdated: yes', occurredAtMs: t0 - 60_000,
    }))
    ingest.flushConversation('conv-30', 'manual')
    ingest.enqueue(makeUnit({
      conversationId: 'conv-30', projectId: 'p1', projectTypeId: 'pt1',
      content: 'Forward: yes', occurredAtMs: t0 + 99 * 60_000,
    }))
    ingest.flushConversation('conv-30', 'manual')
    const r = runExtraction(db, 'conv-30', 'close', deps())
    expect(r.status).toBe('ok')
    expect(JSON.parse(runRow(r.runId).stats_json).rows_below_watermark).toBeGreaterThan(0)
    expect(count(db, 'memory_fact', `subject = 'backdated'`)).toBe(0)
    expect(count(db, 'memory_fact', `subject = 'forward'`)).toBe(1)
  })

  it('participates in a caller-owned transaction instead of throwing into it', () => {
    // p1d's rebuildFromL0 is the named caller, and a rebuild that truncates the
    // derived layers and re-derives is exactly the code that wraps the lot in one
    // transaction. BEGIN IMMEDIATE throws inside one, which would break the
    // "never throws" contract this function's header, wire.ts and the brief all
    // state. It must join the caller's transaction, not open or close its own.
    replay('conv-30', EXTRACTION_FIXTURE, t0)
    db.run(sql`BEGIN IMMEDIATE`)
    let outcome: { status: string } | null = null
    expect(() => { outcome = runExtraction(db, 'conv-30', 'close', deps()) }).not.toThrow()
    expect(outcome!.status).toBe('ok')
    // The caller still owns the transaction and can finish it.
    expect(() => db.run(sql`COMMIT`)).not.toThrow()
    expect(count(db, 'memory_gist', `scope_id = 'conv-30'`)).toBe(1)
  })

  it('a nested failure undoes only its own work and leaves the caller\'s intact', () => {
    // Without a savepoint of its own, a nested failure left every derived row it
    // had already written sitting in the caller's transaction — measured, ten
    // facts, a gist, fourteen entities and a hundred-plus IDF rows persisted once
    // the caller committed. The savepoint is what makes "a failure undoes only
    // this function's work" true on the nested path as well as the owned one.
    replay('conv-30', EXTRACTION_FIXTURE, t0)
    db.run(sql`BEGIN IMMEDIATE`)
    // The caller's own row, which must survive.
    db.run(sql`INSERT INTO memory_meta (key, value) VALUES ('caller_marker', 'kept')`)
    db.run(sql`DROP TABLE memory_gist`)
    const outcome = runExtraction(db, 'conv-30', 'close', deps())
    expect(outcome.status).toBe('failed')
    expect(() => db.run(sql`COMMIT`)).not.toThrow()
    expect(count(db, 'memory_meta', `key = 'caller_marker'`)).toBe(1)
    expect(count(db, 'memory_fact')).toBe(0)
    expect(count(db, 'memory_entity')).toBe(0)
    expect(count(db, 'memory_idf')).toBe(0)
    expect(extractionWatermark(db, 'conv-30')).toBe(0)
  })

  it('fails closed when BEGIN fails for any reason other than the caller\'s transaction', () => {
    // BEGIN IMMEDIATE fails for SQLITE_BUSY exactly as it fails for nesting, and a
    // bare catch cannot tell them apart. Carrying on would run the whole function
    // UN-TRANSACTED: measured on a locked database, an abort partway left facts, a
    // gist, entities and IDF rows behind with nothing to roll back. Only the
    // caller's own transaction is a reason to continue.
    replay('conv-30', EXTRACTION_FIXTURE, t0)
    const realRun = db.run.bind(db)
    let first = true
    db.run = (q: any) => {
      const text = String(q?.queryChunks?.map((c: any) => c?.value ?? '').join('') ?? q)
      if (first && text.includes('BEGIN IMMEDIATE')) {
        first = false
        const wrapped = new Error("Failed to run the query 'BEGIN IMMEDIATE'")
        ;(wrapped as any).cause = new Error('database is locked')
        throw wrapped
      }
      return realRun(q)
    }
    let outcome: { runId: string; status: string } | null = null
    try {
      expect(() => { outcome = runExtraction(db, 'conv-30', 'close', deps()) }).not.toThrow()
    } finally {
      db.run = realRun
    }
    expect(outcome!.status).toBe('failed')
    expect(JSON.parse(runRow(outcome!.runId).stats_json)).toMatchObject({ reason: 'no_transaction' })
    // Nothing derived was written, and the watermark did not move.
    expect(count(db, 'memory_fact')).toBe(0)
    expect(count(db, 'memory_gist')).toBe(0)
    expect(count(db, 'memory_entity')).toBe(0)
    expect(count(db, 'memory_idf')).toBe(0)
    expect(extractionWatermark(db, 'conv-30')).toBe(0)
  })

  it('a failure rolls back, records a failed run and leaves the watermark untouched', () => {
    replay('conv-30', EXTRACTION_FIXTURE, t0)
    db.run(sql`DROP TABLE memory_fact`)
    const r = runExtraction(db, 'conv-30', 'close', deps())
    expect(r.status).toBe('failed')
    expect(runRow(r.runId)).toMatchObject({ status: 'failed', conversation_id: 'conv-30' })
    expect(count(db, 'memory_run')).toBe(1)
    expect(count(db, 'memory_gist')).toBe(0)
    expect(extractionWatermark(db, 'conv-30')).toBe(0)
  })
})
