// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { sql } from 'drizzle-orm'
import { createContextTables } from '@modules/observability/context-schema'
import {
  createContextRecorder,
  observeRunEvents,
  parseCompositionDelivery,
  parseCompositionObservation,
  RECENT_COMPOSITIONS,
  type CompositionDeliveryInput,
} from '@modules/observability/context-recorder'
import type { ContextSection } from '@modules/prompt-wizard/types'

const logger = { debug() {}, info() {}, warn() {}, error() {} } as any

function section(over: Partial<ContextSection> = {}): ContextSection {
  return {
    zone: 'prefix', key: 'core-identity', content: 'body', chars: 4,
    estimatedTokens: 1, truncated: false, droppedChars: 0, ...over,
  }
}

describe('createContextRecorder', () => {
  let db: any, recorder: any
  beforeEach(() => {
    db = drizzle(new Database(':memory:'))
    createContextTables(db)
    db.run(sql`CREATE TABLE skills (id TEXT PRIMARY KEY, use_count INTEGER DEFAULT 0, last_used_at TEXT)`)
    db.run(sql`CREATE TABLE skill_usage_daily (day TEXT, skill_id TEXT, injected_count INTEGER DEFAULT 0, PRIMARY KEY (day, skill_id))`)
    recorder = createContextRecorder(db, logger)
  })

  it('writes one composition and one row per section, in order', () => {
    const id = recorder.record({
      sections: [section(), section({ key: 'runtime', zone: 'suffix' })],
      entryPoint: 'conversation', conversationId: 'c1',
    })
    expect(id).toBeTruthy()
    const comp = (db.all(sql`SELECT * FROM context_compositions`) as any[])[0]
    expect(comp).toMatchObject({ entry_point: 'conversation', conversation_id: 'c1', section_count: 2 })
    const rows = db.all(sql`SELECT ord, section_key FROM context_sections ORDER BY ord`) as any[]
    expect(rows).toEqual([{ ord: 0, section_key: 'core-identity' }, { ord: 1, section_key: 'runtime' }])
  })

  it('sums estimated tokens onto the composition', () => {
    recorder.record({ sections: [section({ estimatedTokens: 10 }), section({ estimatedTokens: 5 })], entryPoint: 'conversation' })
    const comp = (db.all(sql`SELECT estimated_tokens FROM context_compositions`) as any[])[0]
    expect(comp.estimated_tokens).toBe(15)
  })

  it('updates the daily rollup', () => {
    recorder.record({ sections: [section({ estimatedTokens: 7, truncated: true, droppedChars: 20 })], entryPoint: 'conversation' })
    recorder.record({ sections: [section({ estimatedTokens: 3 })], entryPoint: 'conversation' })
    const r = (db.all(sql`SELECT * FROM context_section_daily WHERE section_key = 'core-identity'`) as any[])[0]
    expect(r).toMatchObject({ count: 2, sum_tokens: 10, max_tokens: 7, truncated_count: 1, sum_dropped_chars: 20 })
  })

  it('bumps skill counters for injected skills only', () => {
    db.run(sql`INSERT INTO skills (id, use_count) VALUES ('s1', 0)`)
    recorder.record({
      sections: [
        section({ key: 'available-skills' }),            // listing — NOT usage
        section({ zone: 'append', key: 'skill', sourceRef: 's1' }),
      ],
      entryPoint: 'conversation',
    })
    const s = (db.all(sql`SELECT use_count, last_used_at FROM skills WHERE id = 's1'`) as any[])[0]
    expect(s.use_count).toBe(1)
    expect(s.last_used_at).toBeTruthy()
    const usage = db.all(sql`SELECT * FROM skill_usage_daily`) as any[]
    expect(usage).toHaveLength(1)
    expect(usage[0]).toMatchObject({ skill_id: 's1', injected_count: 1 })
  })

  it('records the composition even when skills / skill_usage_daily are absent (own try/catch)', () => {
    const bareDb = drizzle(new Database(':memory:'))
    createContextTables(bareDb)
    // Deliberately NOT creating `skills` / `skill_usage_daily` — those are
    // created by a later task's migration. A database that has not migrated
    // yet must still get its composition + section rows recorded.
    const bareRecorder = createContextRecorder(bareDb, logger)
    const id = bareRecorder.record({
      sections: [section({ zone: 'append', key: 'skill', sourceRef: 's1' })],
      entryPoint: 'conversation',
    })
    expect(id).toBeTruthy()
    const comp = (bareDb.all(sql`SELECT * FROM context_compositions`) as any[])[0]
    expect(comp).toMatchObject({ section_count: 1 })
    const rows = bareDb.all(sql`SELECT section_key FROM context_sections`) as any[]
    expect(rows).toEqual([{ section_key: 'skill' }])
  })

  it('fails open and returns null when the write throws', () => {
    const broken = { run() { throw new Error('db gone') }, all() { throw new Error('db gone') } } as any
    const brokenRecorder = createContextRecorder(broken, logger)
    expect(brokenRecorder.record({ sections: [section()], entryPoint: 'conversation' })).toBeNull()
    // A composition that was not recorded is not remembered either.
    expect(brokenRecorder.sectionsFor('anything')).toBeNull()
  })
})

describe('createContextRecorder — recent sections (privacy egress)', () => {
  let recorder: ReturnType<typeof createContextRecorder>
  beforeEach(() => {
    const db = drizzle(new Database(':memory:'))
    createContextTables(db)
    recorder = createContextRecorder(db, logger)
  })

  it('answers the sections of a recorded composition, in prompt order', () => {
    const id = recorder.record({
      sections: [section({ content: '<core-rules>\nr\n</core-rules>\n\n', key: 'core-rules' }), section({ key: 'memory-context', zone: 'append', content: 'm' })],
      entryPoint: 'conversation',
    })!
    expect(recorder.sectionsFor(id)).toEqual([
      { ord: 0, key: 'core-rules', content: '<core-rules>\nr\n</core-rules>\n\n' },
      { ord: 1, key: 'memory-context', content: 'm' },
    ])
  })

  it('leaves the turn block\'s sections out: they ride in the user message, not the system prompt (I4)', () => {
    const id = recorder.record({
      sections: [
        section({ key: 'core-rules', content: 'r' }),
        section({ key: 'turn-time', zone: 'turn', content: 'Current date and time: …' }),
        section({ key: 'memory-recall', zone: 'turn', content: '<eyas-memory>…</eyas-memory>' }),
      ],
      entryPoint: 'conversation',
    })!
    // Only the system-prompt section is located; its ord still matches the stored row.
    expect(recorder.sectionsFor(id)).toEqual([{ ord: 0, key: 'core-rules', content: 'r' }])
  })

  it('still records the turn sections themselves, with their zone', () => {
    const db = drizzle(new Database(':memory:'))
    createContextTables(db)
    const r = createContextRecorder(db, logger)
    r.record({ sections: [section(), section({ key: 'memory-recall', zone: 'turn', content: 'm' })], entryPoint: 'conversation' })
    const rows = db.all(sql`SELECT ord, zone, section_key FROM context_sections ORDER BY ord`) as any[]
    expect(rows).toEqual([
      { ord: 0, zone: 'prefix', section_key: 'core-identity' },
      { ord: 1, zone: 'turn', section_key: 'memory-recall' },
    ])
  })

  it('returns null for an unknown or missing id', () => {
    expect(recorder.sectionsFor('nope')).toBeNull()
    expect(recorder.sectionsFor(undefined)).toBeNull()
    expect(recorder.sectionsFor(null)).toBeNull()
  })

  it('forgets the least recently used composition beyond the cap', () => {
    const first = recorder.record({ sections: [section()], entryPoint: 'conversation' })!
    const kept = recorder.record({ sections: [section()], entryPoint: 'conversation' })!
    for (let i = 0; i < RECENT_COMPOSITIONS - 2; i++) recorder.record({ sections: [section()], entryPoint: 'conversation' })
    // Reading `kept` makes it the most recent; the next record evicts `first`.
    expect(recorder.sectionsFor(kept)).not.toBeNull()
    recorder.record({ sections: [section()], entryPoint: 'conversation' })
    expect(recorder.sectionsFor(first)).toBeNull()
    expect(recorder.sectionsFor(kept)).not.toBeNull()
  })
})

// D7 — post-privacy attribution: what the egress did to each recorded section
// and to the turn, so the inspector shows what the model actually received.
describe('createContextRecorder — privacy egress (attachEgress)', () => {
  let db: any
  let recorder: ReturnType<typeof createContextRecorder>
  beforeEach(() => {
    db = drizzle(new Database(':memory:'))
    createContextTables(db)
    recorder = createContextRecorder(db, logger)
  })

  const MEMORY = 'contact billing@example.com today'

  function recordTurn(): string {
    return recorder.record({
      sections: [
        section({ key: 'core-rules', content: 'rules' }),
        section({ key: 'memory-context', zone: 'append', content: MEMORY }),
        section({ key: 'project-context', zone: 'append', content: 'p' }),
        section({ key: 'memory-recall', zone: 'turn', content: 'recall' }),
      ],
      entryPoint: 'conversation',
      conversationId: 'conv-1',
    })!
  }

  function remoteDigest(over: Record<string, unknown> = {}) {
    return {
      locality: 'remote' as const,
      transport: 'gateway',
      providerId: 'openai',
      rulesetVersion: 'regex@2/policy@1',
      sections: [
        { ord: 0, located: true, skipped: true, spans: [] },
        { ord: 1, located: true, skipped: false, spans: [[8, 27, 'email'] as const] },
        { ord: 2, located: false, skipped: false, spans: [] },
      ],
      unattributed: { masked: 0, warned: 0 },
      messages: { masked: 1, warned: 0 },
      toolResults: [{ toolName: 'memory_search', masked: 2, warned: 0 }],
      byType: { email: 4 },
      ...over,
    }
  }

  const sectionRows = () =>
    db.all(sql`SELECT ord, egress_masked, egress_spans, egress_skipped FROM context_sections ORDER BY ord`) as any[]
  const egressOf = () => JSON.parse((db.all(sql`SELECT egress_json FROM context_compositions`) as any[])[0].egress_json)

  it('(+) writes the per-section masked/spans/skipped columns and the composition digest', () => {
    const id = recordTurn()
    recorder.attachEgress(id, remoteDigest())
    expect(sectionRows()).toEqual([
      { ord: 0, egress_masked: null, egress_spans: null, egress_skipped: 1 },
      { ord: 1, egress_masked: 1, egress_spans: JSON.stringify([[8, 27, 'email']]), egress_skipped: 0 },
      // Not located: scanned with the unattributed text, no spans of its own.
      { ord: 2, egress_masked: null, egress_spans: null, egress_skipped: null },
      // The turn section rides in the user message: never attributed.
      { ord: 3, egress_masked: null, egress_spans: null, egress_skipped: null },
    ])
    expect(egressOf()).toMatchObject({
      locality: 'remote',
      transport: 'gateway',
      providerId: 'openai',
      rulesetVersion: 'regex@2/policy@1',
      calls: 1,
      messages: { masked: 1, warned: 0 },
      toolResults: [{ toolName: 'memory_search', transport: 'gateway', masked: 2, warned: 0, calls: 1 }],
      byType: { email: 4 },
    })
    // Offsets are relative to the recorded content: the span IS the value.
    expect(MEMORY.slice(8, 27)).toBe('billing@example.com')
    expect(JSON.stringify(egressOf())).not.toContain('billing@example.com')
  })

  it('(+) the last call wins and the calls are counted; a local fallback clears the masks', () => {
    const id = recordTurn()
    recorder.attachEgress(id, remoteDigest())
    recorder.attachEgress(id, remoteDigest({ toolResults: [] }))
    expect(egressOf()).toMatchObject({ calls: 2, toolResults: [] })

    recorder.attachEgress(id, remoteDigest({ locality: 'local', providerId: 'ollama', sections: [], messages: { masked: 0, warned: 0 }, byType: {} }))
    expect(egressOf()).toMatchObject({ calls: 3, locality: 'local', providerId: 'ollama' })
    expect(sectionRows().every((r) => r.egress_masked === null && r.egress_spans === null && r.egress_skipped === null)).toBe(true)
  })

  it('(+) keeps memory tool results masked on a CLI bridge across later gateway calls, accumulated per tool', () => {
    const id = recordTurn()
    recorder.attachEgress(id, remoteDigest({ toolResults: [] }))
    const bridged = { transport: 'mcp-bridge', toolName: 'memory_expand', rulesetVersion: 'regex@2/policy@1', masked: 1, warned: 1 }
    recorder.attachToolEgress(id, bridged)
    recorder.attachToolEgress(id, bridged)
    recorder.attachEgress(id, remoteDigest())
    expect(egressOf().toolResults).toEqual([
      { toolName: 'memory_search', transport: 'gateway', masked: 2, warned: 0, calls: 1 },
      { toolName: 'memory_expand', transport: 'mcp-bridge', masked: 2, warned: 2, calls: 2 },
    ])
    expect(egressOf().calls).toBe(2)
  })

  it('(+) a bridged tool result before any gateway call starts a remote digest with no calls', () => {
    const id = recordTurn()
    recorder.attachToolEgress(id, { transport: 'mcp-bridge', toolName: 'memory_search', rulesetVersion: 'regex@2/policy@1', masked: 1, warned: 0 })
    expect(egressOf()).toMatchObject({ locality: 'remote', providerId: null, calls: 0, toolResults: [{ toolName: 'memory_search', masked: 1 }] })
  })

  it('(−) an unknown or missing composition id is a no-op', () => {
    recordTurn()
    recorder.attachEgress('nope', remoteDigest())
    recorder.attachEgress(undefined, remoteDigest())
    recorder.attachToolEgress('nope', { transport: 'mcp-bridge', toolName: 'memory_search', rulesetVersion: 'r', masked: 1, warned: 0 })
    expect((db.all(sql`SELECT egress_json FROM context_compositions`) as any[])[0].egress_json).toBeNull()
    expect(sectionRows().every((r) => r.egress_masked === null)).toBe(true)
  })

  it('(−) still attaches after the composition left the in-memory LRU (the write is by id in the DB)', () => {
    const id = recordTurn()
    for (let i = 0; i < RECENT_COMPOSITIONS + 1; i++) recorder.record({ sections: [section()], entryPoint: 'conversation' })
    expect(recorder.sectionsFor(id)).toBeNull()
    recorder.attachEgress(id, remoteDigest())
    const row = (db.all(sql`SELECT egress_json FROM context_compositions WHERE id = ${id}`) as any[])[0]
    expect(JSON.parse(row.egress_json).calls).toBe(1)
  })

  it('(−) fails open: a broken database never throws out of attachEgress / attachToolEgress', () => {
    const broken = { run() { throw new Error('db gone') }, all() { throw new Error('db gone') } } as any
    const r = createContextRecorder(broken, logger)
    expect(() => r.attachEgress('x', remoteDigest())).not.toThrow()
    expect(() => r.attachToolEgress('x', { transport: 'mcp-bridge', toolName: 't', rulesetVersion: 'r', masked: 1, warned: 0 })).not.toThrow()
  })

  it('(−) a corrupt stored egress_json is replaced, not trusted', () => {
    const id = recordTurn()
    db.run(sql`UPDATE context_compositions SET egress_json = '{"calls":"lots"}' WHERE id = ${id}`)
    recorder.attachEgress(id, remoteDigest())
    expect(egressOf()).toMatchObject({ calls: 1, providerId: 'openai' })
  })
})

// G11 — context occupancy: the history estimate at record time and what the
// provider measured on the composition's last model call.
describe('createContextRecorder — occupancy (history estimate, observe)', () => {
  let db: any, recorder: ReturnType<typeof createContextRecorder>
  beforeEach(() => {
    db = drizzle(new Database(':memory:'))
    createContextTables(db)
    recorder = createContextRecorder(db, logger)
  })
  const row = (id: string) => (db.all(sql`SELECT history_estimated_tokens, observed_prompt_tokens, observed_context_window
    FROM context_compositions WHERE id = ${id}`) as any[])[0]

  it('(+) stores the history estimate with the composition', () => {
    const id = recorder.record({ sections: [section()], entryPoint: 'conversation', historyEstimatedTokens: 1234 })!
    expect(row(id)).toEqual({ history_estimated_tokens: 1234, observed_prompt_tokens: null, observed_context_window: null })
  })

  it('(−) no history estimate, or a nonsensical one, stores NULL', () => {
    const a = recorder.record({ sections: [section()], entryPoint: 'conversation' })!
    const b = recorder.record({ sections: [section()], entryPoint: 'conversation', historyEstimatedTokens: -5 })!
    expect(row(a).history_estimated_tokens).toBeNull()
    expect(row(b).history_estimated_tokens).toBeNull()
  })

  it('(+) observe() records the measured prompt size and the runtime window; a later partial one keeps the other field', () => {
    const id = recorder.record({ sections: [section()], entryPoint: 'conversation' })!
    recorder.observe!(id, { promptTokens: 4200, contextWindow: 1_000_000 })
    expect(row(id)).toMatchObject({ observed_prompt_tokens: 4200, observed_context_window: 1_000_000 })
    recorder.observe!(id, { promptTokens: 5000 })
    expect(row(id)).toMatchObject({ observed_prompt_tokens: 5000, observed_context_window: 1_000_000 })
  })

  it('(−) an unknown id, a missing id or an empty/invalid observation writes nothing and never throws', () => {
    const id = recorder.record({ sections: [section()], entryPoint: 'conversation' })!
    expect(() => recorder.observe!('nope', { promptTokens: 10 })).not.toThrow()
    recorder.observe!(null, { promptTokens: 10 })
    recorder.observe!(id, {})
    recorder.observe!(id, { promptTokens: -3, contextWindow: Number.NaN })
    recorder.observe!(id, null)
    expect(row(id)).toMatchObject({ observed_prompt_tokens: null, observed_context_window: null })
  })

  it('(−) fails open on a broken database', () => {
    const broken = { run() { throw new Error('db gone') }, all() { throw new Error('db gone') } } as any
    expect(() => createContextRecorder(broken, logger).observe!('x', { promptTokens: 1 })).not.toThrow()
  })
})

describe('parseCompositionObservation', () => {
  it('(+) keeps the valid fields', () => {
    expect(parseCompositionObservation({ promptTokens: 12, contextWindow: 200_000 })).toEqual({ promptTokens: 12, contextWindow: 200_000 })
    expect(parseCompositionObservation({ promptTokens: 12, contextWindow: 'big' })).toEqual({ promptTokens: 12 })
    expect(parseCompositionObservation({ systemPromptChannel: 'prompt' })).toEqual({ systemPromptChannel: 'prompt' })
  })

  it('(−) nothing valid is null', () => {
    expect(parseCompositionObservation({ promptTokens: 0 })).toBeNull()
    expect(parseCompositionObservation({ promptTokens: 1.5 })).toBeNull()
    expect(parseCompositionObservation({ systemPromptChannel: 'telepathy' })).toBeNull()
    expect(parseCompositionObservation('x')).toBeNull()
  })
})

// I12 — the memory delivery record: who the prompt was sized for, what
// recall delivered, the turn id the access log carries, and the prompt channel.
describe('createContextRecorder — memory delivery (delivery_json)', () => {
  let db: any, recorder: ReturnType<typeof createContextRecorder>
  beforeEach(() => {
    db = drizzle(new Database(':memory:'))
    createContextTables(db)
    recorder = createContextRecorder(db, logger)
  })
  const stored = (id: string) => parseCompositionDelivery(
    (db.all(sql`SELECT delivery_json FROM context_compositions WHERE id = ${id}`) as any[])[0]?.delivery_json,
  )

  function delivery(over: Partial<NonNullable<CompositionDeliveryInput['recall']>> | null = {}): CompositionDeliveryInput {
    return {
      profile: {
        providerId: 'grok-cli', modelId: 'grok-4', contextWindow: 256_000, resolved: true, windowSource: 'catalog',
        supportsTools: true, drillDown: true, toolAddressing: { kind: 'meta-tool' },
      },
      budgetTotalTokens: 12_000,
      ...(over === null ? {} : {
        recall: {
          ids: ['vt:a.md', 'gs:g1', 'ft:f1'], retrieved: ['gs:g1', 'ft:f1'], expanded: ['gs:g1'],
          chars: 1_800, budgetChars: 6_000, turnId: '01K5TURNAAAAAAAAAAAAAAAAAA', ...over,
        },
      }),
    }
  }

  it('(+) persists the delivery and takes the recall turn id as the composition id', () => {
    const id = recorder.record({ sections: [section()], entryPoint: 'conversation', delivery: delivery() })!
    expect(id).toBe('01K5TURNAAAAAAAAAAAAAAAAAA')
    expect(stored(id)).toEqual({
      turnId: id,
      profile: {
        providerId: 'grok-cli', modelId: 'grok-4', contextWindow: 256_000, resolved: true, windowSource: 'catalog',
        supportsTools: true, drillDown: true, toolAddressing: 'meta-tool',
      },
      budgetTotalTokens: 12_000,
      recall: { ids: ['vt:a.md', 'gs:g1', 'ft:f1'], retrieved: ['gs:g1', 'ft:f1'], expanded: ['gs:g1'], chars: 1_800, budgetChars: 6_000 },
    })
  })

  it('(+) records why recall was withheld', () => {
    const id = recorder.record({
      sections: [section()], entryPoint: 'channel',
      delivery: delivery({ ids: [], retrieved: [], expanded: [], chars: 0, withheld: 'external', turnId: '01K5TURNBBBBBBBBBBBBBBBBBB' }),
    })!
    expect(stored(id)?.recall).toMatchObject({ ids: [], withheld: 'external' })
  })

  it('(+) a delivery without a recall part is stored with recall null', () => {
    const id = recorder.record({ sections: [section()], entryPoint: 'conversation', delivery: delivery(null) })!
    expect(id).toHaveLength(26)
    expect(stored(id)).toMatchObject({ turnId: id, recall: null, budgetTotalTokens: 12_000 })
  })

  it('(−) a turn id already taken gets a fresh composition id; the inject rows\' id is kept beside it', () => {
    const first = recorder.record({ sections: [section()], entryPoint: 'conversation', delivery: delivery() })!
    const second = recorder.record({ sections: [section()], entryPoint: 'conversation', delivery: delivery() })!
    expect(second).not.toBe(first)
    expect(stored(second)).toMatchObject({ turnId: second, recall: { injectTurnId: first } })
  })

  it('(−) no delivery, or an unusable one, stores NULL — the composition itself is still recorded', () => {
    const a = recorder.record({ sections: [section()], entryPoint: 'unassembled' })!
    const b = recorder.record({ sections: [section()], entryPoint: 'unassembled', delivery: { budgetTotalTokens: 1 } as any })!
    const c = recorder.record({ sections: [section()], entryPoint: 'unassembled', delivery: delivery({ turnId: 'not a ulid!' }) })!
    expect(stored(a)).toBeNull()
    expect(stored(b)).toBeNull()
    expect(c).not.toBe('not a ulid!')
    expect(stored(c)?.turnId).toBe(c)
  })

  it('(−) a composition recorded before the column existed reads null', () => {
    db.run(sql`INSERT INTO context_compositions (id, created_at, entry_point) VALUES ('old', '2026-09-01', 'conversation')`)
    expect(stored('old')).toBeNull()
    expect(parseCompositionDelivery('{"turnId":')).toBeNull()
    expect(parseCompositionDelivery(JSON.stringify({ turnId: 'x' }))).toBeNull()
  })

  it('(+) observe() adds an ACP CLI\'s system-prompt channel to the delivery record; the last call wins', () => {
    const id = recorder.record({ sections: [section()], entryPoint: 'conversation', delivery: delivery() })!
    recorder.observe!(id, { systemPromptChannel: 'meta-unverified' })
    expect(stored(id)).toMatchObject({ systemPromptChannel: 'meta-unverified', recall: { expanded: ['gs:g1'] } })
    recorder.observe!(id, { promptTokens: 900, systemPromptChannel: 'prompt' })
    expect(stored(id)?.systemPromptChannel).toBe('prompt')
  })

  it('(+) a composition recorded without a delivery gets a record carrying the channel alone', () => {
    const id = recorder.record({ sections: [section()], entryPoint: 'unassembled' })!
    recorder.observe!(id, { systemPromptChannel: 'prompt' })
    expect(stored(id)).toEqual({ turnId: id, profile: null, budgetTotalTokens: null, recall: null, systemPromptChannel: 'prompt' })
  })

  it('(−) an invalid channel or an unknown id writes nothing', () => {
    const id = recorder.record({ sections: [section()], entryPoint: 'conversation', delivery: delivery() })!
    recorder.observe!(id, { systemPromptChannel: 'smoke-signals' } as any)
    recorder.observe!('nope', { systemPromptChannel: 'prompt' })
    expect(stored(id)?.systemPromptChannel).toBeUndefined()
    expect(db.all(sql`SELECT id FROM context_compositions WHERE id = 'nope'`)).toEqual([])
  })

  it('(+) observeRunEvents carries the done response\'s channel to the record', async () => {
    const id = recorder.record({ sections: [section()], entryPoint: 'background', delivery: delivery() })!
    async function* run(): AsyncGenerator<any> {
      yield { type: 'done', response: { usage: { inputTokens: 1, outputTokens: 1 }, systemPromptChannel: 'meta-verified' } }
    }
    for await (const _ of observeRunEvents(run(), recorder, id)) { /* drain */ }
    expect(stored(id)?.systemPromptChannel).toBe('meta-verified')
  })
})

describe('observeRunEvents', () => {
  async function* events(list: any[], fail?: Error): AsyncGenerator<any> {
    for (const e of list) yield e
    if (fail) throw fail
  }
  async function drain(it: AsyncIterable<any>): Promise<any[]> {
    const out: any[] = []
    for await (const e of it) out.push(e)
    return out
  }

  it('(+) passes every event through and reports the LAST call\'s prompt size and the done window', async () => {
    const observe = vi.fn()
    const list = [
      { type: 'turn_complete', usage: { inputTokens: 1, outputTokens: 1, promptTokensLastCall: 1000 } },
      { type: 'turn_complete', usage: { inputTokens: 1, outputTokens: 1, promptTokensLastCall: 1800 } },
      { type: 'done', response: { usage: { inputTokens: 2, outputTokens: 2 }, contextWindow: 200_000 } },
    ]
    expect(await drain(observeRunEvents(events(list), { observe }, 'comp-1'))).toEqual(list)
    expect(observe).toHaveBeenCalledTimes(1)
    expect(observe).toHaveBeenCalledWith('comp-1', { promptTokens: 1800, contextWindow: 200_000 })
  })

  it('(+) a run that throws still reports what was measured before it failed', async () => {
    const observe = vi.fn()
    const run = observeRunEvents(events([{ type: 'turn_complete', usage: { promptTokensLastCall: 700 } }], new Error('boom')), { observe }, 'comp-2')
    await expect(drain(run)).rejects.toThrow('boom')
    expect(observe).toHaveBeenCalledWith('comp-2', { promptTokens: 700, contextWindow: undefined })
  })

  it('(−) without a composition id or a recorder nothing is observed, and the events still flow', async () => {
    const observe = vi.fn()
    const list = [{ type: 'text', text: 'hi' }]
    expect(await drain(observeRunEvents(events(list), { observe }, null))).toEqual(list)
    expect(await drain(observeRunEvents(events(list), undefined, 'comp-3'))).toEqual(list)
    expect(observe).not.toHaveBeenCalled()
  })

  it('(−) a recorder whose observe throws never breaks the run', async () => {
    const observe = () => { throw new Error('recorder down') }
    await expect(drain(observeRunEvents(events([{ type: 'text', text: 'x' }]), { observe }, 'comp-4'))).resolves.toHaveLength(1)
  })

  it('(+) end to end with the real recorder: the measured size lands on the composition', async () => {
    const db = drizzle(new Database(':memory:'))
    createContextTables(db)
    const recorder = createContextRecorder(db, logger)
    const id = recorder.record({ sections: [section()], entryPoint: 'background', conversationId: 'c9' })!
    await drain(observeRunEvents(events([{ type: 'turn_complete', usage: { promptTokensLastCall: 3210 } }]), recorder, id))
    expect((db.all(sql`SELECT observed_prompt_tokens FROM context_compositions WHERE id = ${id}`) as any[])[0])
      .toEqual({ observed_prompt_tokens: 3210 })
  })
})
