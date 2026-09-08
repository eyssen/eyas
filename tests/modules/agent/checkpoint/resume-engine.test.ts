// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryDb } from '../../../helpers/test-db'
import { createCheckpointTables } from '../../../../src/modules/agent/checkpoint/schema.js'
import { createCheckpointStore } from '../../../../src/modules/agent/checkpoint/checkpoint-store.js'
import { createResumeEngine } from '../../../../src/modules/agent/checkpoint/resume-engine.js'
import { createEventStoreTables } from '../../../../src/modules/event-store/schema.js'
import { createEventStoreServices } from '../../../../src/modules/event-store/index.js'
import { EventTypes } from '../../../../src/modules/event-store/types.js'
import {
  CheckpointError,
  type CheckpointState,
} from '../../../../src/modules/agent/checkpoint/types.js'

function makeState(sessionId: string, overrides: Partial<CheckpointState> = {}): CheckpointState {
  return {
    sessionId,
    lastSeq: 0,
    eventCount: 1,
    currentState: 'working',
    messages: [],
    toolCalls: [],
    pendingApprovals: [],
    grantedApprovals: [],
    tokensUsed: { input: 0, output: 0 },
    lastCheckpointSeq: null,
    lastCheckpointRef: null,
    turn: 0,
    ...overrides,
  }
}

describe('ResumeEngine', () => {
  let db: ReturnType<typeof createMemoryDb>
  let store: ReturnType<typeof createCheckpointStore>

  beforeEach(() => {
    db = createMemoryDb()
    createCheckpointTables(db)
    store = createCheckpointStore(db)
  })

  it('load returns null for missing checkpoint', async () => {
    const resume = createResumeEngine(store)
    expect(await resume.load('nope')).toBeNull()
  })

  it('loadState throws typed error when missing', async () => {
    const resume = createResumeEngine(store)
    await expect(resume.loadState('nope')).rejects.toThrow(CheckpointError)
  })

  it('cold resume returns the stored state verbatim', async () => {
    const resume = createResumeEngine(store)
    const cp = await store.insert({
      sessionId: 's1',
      eventSeq: 3,
      label: 'x',
      kind: 'manual',
      actor: 'user',
      state: makeState('s1', {
        currentState: 'tool_call',
        tokensUsed: { input: 100, output: 50 },
        turn: 7,
      }),
    })
    const out = await resume.load(cp.id)
    expect(out).not.toBeNull()
    expect(out!.followUpEvents).toBe(0)
    expect(out!.state.currentState).toBe('tool_call')
    expect(out!.state.turn).toBe(7)
  })

  it('warm resume folds follow-up events on top of the stored state', async () => {
    // Seed the event-store with a transition, checkpoint at seq=0, then a
    // second transition arrives. Warm resume should reflect both.
    createEventStoreTables(db)
    const es = createEventStoreServices(db)
    const resume = createResumeEngine(store, { eventStore: es.events })

    await es.events.append({
      sessionId: 's1',
      type: EventTypes.StateTransition,
      payload: { from: 'idle', to: 'working' },
    })

    // Checkpoint captures state "working" at seq=0.
    const cp = await store.insert({
      sessionId: 's1',
      eventSeq: 0,
      label: 'mid-run',
      kind: 'auto',
      actor: 'agent',
      state: makeState('s1', { currentState: 'working', lastSeq: 0, eventCount: 1 }),
    })

    // Follow-up event arrives AFTER the checkpoint
    await es.events.append({
      sessionId: 's1',
      type: EventTypes.StateTransition,
      payload: { from: 'working', to: 'waiting_approval' },
    })

    const out = await resume.load(cp.id)
    expect(out).not.toBeNull()
    expect(out!.followUpEvents).toBe(1)
    expect(out!.state.currentState).toBe('waiting_approval')
  })

  it('warm resume with no follow-ups is equivalent to cold resume', async () => {
    createEventStoreTables(db)
    const es = createEventStoreServices(db)
    const resume = createResumeEngine(store, { eventStore: es.events })

    await es.events.append({
      sessionId: 's1',
      type: EventTypes.StateTransition,
      payload: { from: 'idle', to: 'done' },
    })

    const cp = await store.insert({
      sessionId: 's1',
      eventSeq: 0,
      label: 'done',
      kind: 'manual',
      actor: 'user',
      state: makeState('s1', { currentState: 'done' }),
    })

    const out = await resume.load(cp.id)
    expect(out!.followUpEvents).toBe(0)
    expect(out!.state.currentState).toBe('done')
  })

  it('replayFollowUp: false skips the fold even when event-store is present', async () => {
    createEventStoreTables(db)
    const es = createEventStoreServices(db)
    const resume = createResumeEngine(store, { eventStore: es.events })

    await es.events.append({
      sessionId: 's1',
      type: EventTypes.StateTransition,
      payload: { from: 'idle', to: 'working' },
    })
    const cp = await store.insert({
      sessionId: 's1',
      eventSeq: 0,
      label: 'x',
      kind: 'auto',
      actor: 'agent',
      state: makeState('s1', { currentState: 'working' }),
    })
    await es.events.append({
      sessionId: 's1',
      type: EventTypes.StateTransition,
      payload: { from: 'working', to: 'done' },
    })

    const out = await resume.load(cp.id, { replayFollowUp: false })
    expect(out!.followUpEvents).toBe(0)
    expect(out!.state.currentState).toBe('working') // not 'done'
  })

  it('deleting a checkpoint does not break event-store (no FK cascade)', async () => {
    createEventStoreTables(db)
    const es = createEventStoreServices(db)
    createResumeEngine(store, { eventStore: es.events })

    await es.events.append({
      sessionId: 's1',
      type: EventTypes.StateTransition,
      payload: { from: 'a', to: 'b' },
    })
    const cp = await store.insert({
      sessionId: 's1',
      eventSeq: 0,
      label: 'x',
      kind: 'manual',
      actor: 'u',
      state: makeState('s1'),
    })

    expect(await store.delete(cp.id)).toBe(true)
    // Event-store must still function
    const events = await es.events.queryArray('s1')
    expect(events).toHaveLength(1)
    expect(await es.events.latestSeq('s1')).toBe(0)
  })
})
