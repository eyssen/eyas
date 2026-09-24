// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import { createEventStoreTables } from '../../../src/modules/event-store/schema.js'
import {
  createEventStore,
  EventStoreError,
  type EventStore,
} from '../../../src/modules/event-store/event-store.js'
import { EventTypes } from '../../../src/modules/event-store/types.js'

describe('EventStore', () => {
  let db: ReturnType<typeof createMemoryDb>
  let store: EventStore

  beforeEach(() => {
    db = createMemoryDb()
    createEventStoreTables(db)
    store = createEventStore(db)
  })

  it('assigns monotonic seq starting at 0', async () => {
    const a = await store.append({
      sessionId: 's1',
      type: EventTypes.ToolCall,
      payload: { toolName: 'bash', input: { cmd: 'ls' }, toolUseId: 't-1' },
    })
    const b = await store.append({
      sessionId: 's1',
      type: EventTypes.ToolCall,
      payload: { toolName: 'bash', input: { cmd: 'pwd' }, toolUseId: 't-2' },
    })
    const c = await store.append({
      sessionId: 's1',
      type: EventTypes.StateTransition,
      payload: { from: 'idle', to: 'working' },
    })
    expect(a).toBe(0)
    expect(b).toBe(1)
    expect(c).toBe(2)
    expect(await store.latestSeq('s1')).toBe(2)
    expect(await store.countBySession('s1')).toBe(3)
  })

  it('per-session seq namespaces are independent', async () => {
    await store.append({
      sessionId: 'sA',
      type: EventTypes.ToolCall,
      payload: { toolName: 'bash', input: {}, toolUseId: 'a1' },
    })
    await store.append({
      sessionId: 'sB',
      type: EventTypes.ToolCall,
      payload: { toolName: 'bash', input: {}, toolUseId: 'b1' },
    })
    const seq2 = await store.append({
      sessionId: 'sA',
      type: EventTypes.ToolCall,
      payload: { toolName: 'bash', input: {}, toolUseId: 'a2' },
    })
    expect(seq2).toBe(1)
    expect(await store.latestSeq('sA')).toBe(1)
    expect(await store.latestSeq('sB')).toBe(0)
  })

  it('append + query roundtrip preserves payloads', async () => {
    const payload = {
      toolName: 'read_file',
      input: { path: '/tmp/x', encoding: 'utf8' },
      toolUseId: 'tu-xyz',
    }
    await store.append({ sessionId: 's1', type: EventTypes.ToolCall, actor: 'agent:claude', payload })
    const events = await store.queryArray('s1')
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe(EventTypes.ToolCall)
    expect(events[0]!.actor).toBe('agent:claude')
    expect(events[0]!.payload).toEqual(payload)
    expect(events[0]!.seq).toBe(0)
    expect(events[0]!.ts).toBeGreaterThan(0)
  })

  it('rejects duplicate (sessionId, seq) via appendWithSeq', async () => {
    await store.appendWithSeq({
      sessionId: 's1',
      seq: 0,
      ts: Date.now(),
      type: EventTypes.StateTransition,
      payload: { from: 'idle', to: 'working' },
    })
    await expect(
      store.appendWithSeq({
        sessionId: 's1',
        seq: 0,
        ts: Date.now(),
        type: EventTypes.StateTransition,
        payload: { from: 'idle', to: 'working' },
      }),
    ).rejects.toBeInstanceOf(EventStoreError)
  })

  it('type-filtered query returns only matching events', async () => {
    await store.append({
      sessionId: 's1',
      type: EventTypes.ToolCall,
      payload: { toolName: 'bash', input: {}, toolUseId: 't1' },
    })
    await store.append({
      sessionId: 's1',
      type: EventTypes.LlmCall,
      payload: { provider: 'anthropic', model: 'claude', messagesHash: 'h1' },
    })
    await store.append({
      sessionId: 's1',
      type: EventTypes.ToolResult,
      payload: { toolUseId: 't1', output: 'ok', durationMs: 5, success: true },
    })

    const calls = await store.queryArray('s1', { types: [EventTypes.ToolCall] })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.type).toBe(EventTypes.ToolCall)

    const both = await store.queryArray('s1', {
      types: [EventTypes.ToolCall, EventTypes.ToolResult],
    })
    expect(both).toHaveLength(2)
    expect(both.map((e) => e.type).sort()).toEqual(
      [EventTypes.ToolCall, EventTypes.ToolResult].sort(),
    )
  })

  it('respects fromSeq / toSeq bounds', async () => {
    for (let i = 0; i < 5; i++) {
      await store.append({
        sessionId: 's1',
        type: EventTypes.StateTransition,
        payload: { from: `s${i}`, to: `s${i + 1}` },
      })
    }
    const range = await store.queryArray('s1', { fromSeq: 1, toSeq: 3 })
    expect(range.map((e) => e.seq)).toEqual([1, 2, 3])

    const tail = await store.queryArray('s1', { fromSeq: 3 })
    expect(tail.map((e) => e.seq)).toEqual([3, 4])

    const limited = await store.queryArray('s1', { limit: 2 })
    expect(limited.map((e) => e.seq)).toEqual([0, 1])
  })

  it('async iterator yields events in seq order', async () => {
    for (let i = 0; i < 3; i++) {
      await store.append({
        sessionId: 's1',
        type: EventTypes.StateTransition,
        payload: { from: 'a', to: 'b' },
      })
    }
    const seen: number[] = []
    for await (const ev of store.query('s1')) {
      seen.push(ev.seq)
    }
    expect(seen).toEqual([0, 1, 2])
  })

  it('latestSeq returns -1 for an empty session', async () => {
    expect(await store.latestSeq('never-seen')).toBe(-1)
    expect(await store.countBySession('never-seen')).toBe(0)
  })

  it('rejects invalid payload via Zod on known types', async () => {
    // ToolCall requires toolName (min 1)
    await expect(
      store.append({
        sessionId: 's1',
        type: EventTypes.ToolCall,
        payload: { toolName: '', input: {} }, // empty toolName
      }),
    ).rejects.toBeTruthy()
  })

  it('passes through unknown event types without validation', async () => {
    const seq = await store.append({
      sessionId: 's1',
      type: 'CustomEvent',
      payload: { anything: { goes: true } },
    })
    expect(seq).toBe(0)
    const events = await store.queryArray('s1')
    expect(events[0]!.type).toBe('CustomEvent')
    expect(events[0]!.payload).toEqual({ anything: { goes: true } })
  })
})
