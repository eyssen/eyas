// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// E4 — loadEffortIntent: the one loader every run path asks for its effort
// intent. conversation > deep > the agent the run speaks as > the nearest
// delegating parent (inherited); at most five conversations read; stored
// values are untrusted. Fictive agents and conversations.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db.js'
import { createConversationService, type ConversationService } from '@modules/conversations/conversation-service.js'
import { EFFORT_CHAIN_MAX_DEPTH, loadEffortIntent, type EffortIntentDb } from '@modules/conversations/effort-intent.js'

const testDb = createTestDb('effort-intent')

describe('loadEffortIntent — stored conversations and agents', () => {
  let db: any
  let svc: ConversationService
  const agents: Record<string, { effort?: unknown }> = {}
  const getAgent = (id: string) => agents[id]

  beforeEach(() => {
    db = testDb.open()
    svc = createConversationService(db)
    for (const k of Object.keys(agents)) delete agents[k]
  })
  afterEach(() => testDb.cleanup())

  /** A stored conversation with the given effort columns (parent first). */
  function conv(fields: { effort?: string | null; orchestration?: string; agentId?: string | null; parent?: string } = {}): string {
    const id = svc.create({ userId: 'u1' }).id
    svc.update(id, {
      ...(fields.effort !== undefined ? { effort: fields.effort as any } : {}),
      ...(fields.orchestration ? { orchestration: fields.orchestration as any } : {}),
      ...(fields.agentId !== undefined ? { agentId: fields.agentId } : {}),
      ...(fields.parent ? { parentConversationId: fields.parent } : {}),
    } as any)
    return id
  }

  it('(+) a colleague home thread with no level of its own runs at the agent\'s effort', () => {
    agents.helper = { effort: 'high' }
    expect(loadEffortIntent({ db, getAgent }, conv({ agentId: 'helper' }))).toEqual({ level: 'high', source: 'agent' })
  })

  it('(+) the conversation\'s own level beats its agent\'s', () => {
    agents.helper = { effort: 'high' }
    expect(loadEffortIntent({ db, getAgent }, conv({ agentId: 'helper', effort: 'low' }))).toEqual({ level: 'low', source: 'conversation' })
  })

  it('(+) Deep with no level of its own is Max (source deep), above the agent', () => {
    agents.helper = { effort: 'low' }
    expect(loadEffortIntent({ db, getAgent }, conv({ agentId: 'helper', orchestration: 'deep' }))).toEqual({ level: 'max', source: 'deep' })
  })

  it('(+) a delegation child with an agent-less specialist inherits the parent\'s xhigh', () => {
    agents.specialist = {}
    const parent = conv({ effort: 'xhigh' })
    const child = conv({ agentId: 'specialist', parent })
    expect(loadEffortIntent({ db, getAgent }, child)).toEqual({ level: 'xhigh', source: 'inherited' })
  })

  it('(+) a parent that is Deep hands Max down; a parent colleague\'s own effort is inherited too', () => {
    const deep = conv({ orchestration: 'deep' })
    expect(loadEffortIntent({ db, getAgent }, conv({ parent: deep }))).toEqual({ level: 'max', source: 'inherited' })
    agents.lead = { effort: 'medium' }
    const colleague = conv({ agentId: 'lead' })
    expect(loadEffortIntent({ db, getAgent }, conv({ parent: colleague }))).toEqual({ level: 'medium', source: 'inherited' })
  })

  it('(−) the child agent\'s own effort beats the parent\'s level', () => {
    agents.specialist = { effort: 'low' }
    const parent = conv({ effort: 'xhigh' })
    expect(loadEffortIntent({ db, getAgent }, conv({ agentId: 'specialist', parent }))).toEqual({ level: 'low', source: 'agent' })
  })

  it('(+) the nearest parent with a level wins over one further up', () => {
    const root = conv({ effort: 'max' })
    const middle = conv({ effort: 'minimal', parent: root })
    const leaf = conv({ parent: middle })
    expect(loadEffortIntent({ db, getAgent }, leaf)).toEqual({ level: 'minimal', source: 'inherited' })
  })

  it('(−) depth cap 5: a level six conversations up is not reached; five is', () => {
    let id = conv({ effort: 'high' })
    for (let i = 0; i < EFFORT_CHAIN_MAX_DEPTH; i++) id = conv({ parent: id })
    // The run's own + four parents are read; the level sits on the sixth.
    expect(loadEffortIntent({ db, getAgent }, id)).toBeUndefined()

    let near = conv({ effort: 'high' })
    for (let i = 0; i < EFFORT_CHAIN_MAX_DEPTH - 1; i++) near = conv({ parent: near })
    expect(loadEffortIntent({ db, getAgent }, near)).toEqual({ level: 'high', source: 'inherited' })
    // A smaller cap is honoured; a nonsense cap falls back to the default.
    expect(loadEffortIntent({ db, getAgent }, near, { maxDepth: 2 })).toBeUndefined()
    expect(loadEffortIntent({ db, getAgent }, near, { maxDepth: 0 })).toEqual({ level: 'high', source: 'inherited' })
  })

  it('(−) a missing agent row falls through to the parent', () => {
    const parent = conv({ effort: 'medium' })
    expect(loadEffortIntent({ db, getAgent }, conv({ agentId: 'deleted-agent', parent }))).toEqual({ level: 'medium', source: 'inherited' })
    // Without an agent lookup at all, agents add nothing.
    agents.helper = { effort: 'high' }
    expect(loadEffortIntent({ db }, conv({ agentId: 'helper' }))).toBeUndefined()
  })

  it('(−) corrupted stored values are skipped, never guessed into a level', () => {
    agents.broken = { effort: 'ultra' }
    const parent = conv({ effort: 'low' })
    const child = conv({ agentId: 'broken', parent })
    db.run(sql`UPDATE conversations SET effort = 'turbo', orchestration = 'warp' WHERE id = ${child}`)
    expect(loadEffortIntent({ db, getAgent }, child)).toEqual({ level: 'low', source: 'inherited' })
    // 'auto' stored anywhere means "not set here".
    db.run(sql`UPDATE conversations SET effort = 'auto' WHERE id = ${parent}`)
    expect(loadEffortIntent({ db, getAgent }, child)).toBeUndefined()
  })

  it('(+) the agent the run speaks as overrides the row\'s agent; null means none', () => {
    agents.rowAgent = { effort: 'low' }
    agents.projectDefault = { effort: 'xhigh' }
    const id = conv({ agentId: 'rowAgent' })
    expect(loadEffortIntent({ db, getAgent }, id, { agentId: 'projectDefault' })).toEqual({ level: 'xhigh', source: 'agent' })
    expect(loadEffortIntent({ db, getAgent }, id, { agentId: null })).toBeUndefined()
    expect(loadEffortIntent({ db, getAgent }, id)).toEqual({ level: 'low', source: 'agent' })
  })

  it('(+) a conversation that decides by itself costs one read; unknown ids read nothing further', () => {
    const spy = { all: vi.fn((q: any) => db.all(q)) }
    const parent = conv({ effort: 'max' })
    loadEffortIntent({ db: spy, getAgent }, conv({ effort: 'low', parent }))
    expect(spy.all).toHaveBeenCalledTimes(1)

    spy.all.mockClear()
    expect(loadEffortIntent({ db: spy, getAgent }, 'no-such-conversation')).toBeUndefined()
    expect(spy.all).toHaveBeenCalledTimes(1)
  })

  it('(+) a caller-supplied self row saves the read and still walks the parents', () => {
    const spy = { all: vi.fn((q: any) => db.all(q)) }
    const parent = conv({ effort: 'high' })
    const child = conv({ parent })
    expect(loadEffortIntent({ db: spy, getAgent }, child, { self: { effort: null, orchestration: 'auto', parentConversationId: parent } }))
      .toEqual({ level: 'high', source: 'inherited' })
    expect(spy.all).toHaveBeenCalledTimes(1)
  })
})

describe('loadEffortIntent — without a readable database', () => {
  it('(+) no db: the self row and the agent still decide; the parent walk is skipped', () => {
    const getAgent = (id: string) => (id === 'helper' ? { effort: 'high' } : undefined)
    expect(loadEffortIntent({ getAgent }, 'c1', { self: { effort: 'minimal' } })).toEqual({ level: 'minimal', source: 'conversation' })
    expect(loadEffortIntent({ getAgent }, 'c1', { agentId: 'helper' })).toEqual({ level: 'high', source: 'agent' })
    expect(loadEffortIntent({ getAgent }, 'c1', { self: { parentConversationId: 'p1' } })).toBeUndefined()
    expect(loadEffortIntent({}, 'c1')).toBeUndefined()
  })

  it('(−) a failing database or agent lookup never throws; it sets nothing', () => {
    const broken: EffortIntentDb = { all: () => { throw new Error('disk I/O error') } }
    const getAgent = () => { throw new Error('registry down') }
    expect(loadEffortIntent({ db: broken, getAgent }, 'c1', { agentId: 'a1' })).toBeUndefined()
  })

  it('(−) a parent cycle ends the walk instead of looping', () => {
    const rows: Record<string, Record<string, unknown>> = {
      a: { effort: null, orchestration: 'auto', agent_id: null, parent_conversation_id: 'b' },
      b: { effort: null, orchestration: 'auto', agent_id: null, parent_conversation_id: 'a' },
    }
    const reads: string[] = []
    const fake: EffortIntentDb = {
      all: (query: any) => {
        const id = (query.queryChunks ?? []).find((c: unknown) => typeof c === 'string' && c in rows) as string | undefined
        if (id) reads.push(id)
        return id ? [rows[id]] : []
      },
    }
    expect(loadEffortIntent({ db: fake }, 'a')).toBeUndefined()
    expect(reads).toEqual(['a', 'b'])
  })
})
