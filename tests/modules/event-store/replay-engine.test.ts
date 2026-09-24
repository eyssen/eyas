// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import { createEventStoreServices } from '../../../src/modules/event-store/index.js'
import { createEventStoreTables } from '../../../src/modules/event-store/schema.js'
import {
  applyEvent,
  initialAgentState,
} from '../../../src/modules/event-store/replay-engine.js'
import { EventTypes } from '../../../src/modules/event-store/types.js'

describe('ReplayEngine', () => {
  let db: ReturnType<typeof createMemoryDb>
  let services: ReturnType<typeof createEventStoreServices>

  beforeEach(() => {
    db = createMemoryDb()
    createEventStoreTables(db)
    services = createEventStoreServices(db, { every: 5 })
  })

  it('reconstructs state from empty session', async () => {
    const state = await services.replay.replay('empty')
    expect(state.sessionId).toBe('empty')
    expect(state.lastSeq).toBe(-1)
    expect(state.eventCount).toBe(0)
    expect(state.messages).toEqual([])
    expect(state.toolCalls).toEqual([])
    expect(state.pendingApprovals).toEqual([])
  })

  it('folds ToolCall + ToolResult pairs into completed tool calls', async () => {
    await services.events.append({
      sessionId: 's1',
      type: EventTypes.ToolCall,
      payload: { toolName: 'bash', input: { cmd: 'ls' }, toolUseId: 't-1' },
    })
    await services.events.append({
      sessionId: 's1',
      type: EventTypes.ToolResult,
      payload: { toolUseId: 't-1', output: 'file1\nfile2\n', durationMs: 12, success: true },
    })

    const state = await services.replay.replay('s1')
    expect(state.toolCalls).toHaveLength(1)
    expect(state.toolCalls[0]!.toolName).toBe('bash')
    expect(state.toolCalls[0]!.result).toMatchObject({
      output: 'file1\nfile2\n',
      durationMs: 12,
      success: true,
    })
    expect(state.lastSeq).toBe(1)
    expect(state.eventCount).toBe(2)
  })

  it('tool results are recorded verbatim — replay never re-executes', async () => {
    // We simulate a tool that would have different output on re-run, e.g. Date.now(),
    // by pinning a result value. Replay must return exactly this value.
    await services.events.append({
      sessionId: 's1',
      type: EventTypes.ToolCall,
      payload: { toolName: 'now', input: {}, toolUseId: 'n-1' },
    })
    await services.events.append({
      sessionId: 's1',
      type: EventTypes.ToolResult,
      payload: { toolUseId: 'n-1', output: 1710000000000, durationMs: 1, success: true },
    })

    const first = await services.replay.replay('s1')
    const second = await services.replay.replay('s1')
    expect(first.toolCalls[0]!.result!.output).toBe(1710000000000)
    expect(second.toolCalls[0]!.result!.output).toBe(1710000000000)
    expect(first).toEqual(second)
  })

  it('tracks state transitions and token usage', async () => {
    await services.events.append({
      sessionId: 's1',
      type: EventTypes.StateTransition,
      payload: { from: 'idle', to: 'working' },
    })
    await services.events.append({
      sessionId: 's1',
      type: EventTypes.LlmCall,
      payload: {
        provider: 'anthropic',
        model: 'claude',
        messagesHash: 'h1',
        usage: { inputTokens: 100, outputTokens: 0 },
      },
    })
    await services.events.append({
      sessionId: 's1',
      type: EventTypes.LlmResponse,
      payload: {
        response: {
          content: 'Hello there',
          stopReason: 'end_turn',
          usage: { outputTokens: 50 },
        },
      },
    })
    await services.events.append({
      sessionId: 's1',
      type: EventTypes.StateTransition,
      payload: { from: 'working', to: 'idle' },
    })

    const state = await services.replay.replay('s1')
    expect(state.currentState).toBe('idle')
    expect(state.tokensUsed.input).toBe(100)
    expect(state.tokensUsed.output).toBe(50)
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0]!.content).toBe('Hello there')
  })

  it('tracks pending and granted approvals', async () => {
    await services.events.append({
      sessionId: 's1',
      type: EventTypes.ApprovalRequested,
      payload: { kind: 'dangerous-bash', payload: { cmd: 'rm -rf /' }, approvalId: 'a-1' },
    })
    await services.events.append({
      sessionId: 's1',
      type: EventTypes.ApprovalRequested,
      payload: { kind: 'write-file', payload: { path: '/etc/hosts' }, approvalId: 'a-2' },
    })

    let state = await services.replay.replay('s1')
    expect(state.pendingApprovals).toHaveLength(2)

    await services.events.append({
      sessionId: 's1',
      type: EventTypes.ApprovalGranted,
      payload: { approvalId: 'a-1', grantedBy: 'user:root' },
    })

    state = await services.replay.replay('s1')
    expect(state.pendingApprovals).toHaveLength(1)
    expect(state.pendingApprovals[0]!.approvalId).toBe('a-2')
    expect(state.grantedApprovals).toEqual(['a-1'])
  })

  it('replay with toSeq returns state as of that point in history', async () => {
    await services.events.append({
      sessionId: 's1',
      type: EventTypes.StateTransition,
      payload: { from: 'idle', to: 'planning' },
    })
    await services.events.append({
      sessionId: 's1',
      type: EventTypes.StateTransition,
      payload: { from: 'planning', to: 'working' },
    })
    await services.events.append({
      sessionId: 's1',
      type: EventTypes.StateTransition,
      payload: { from: 'working', to: 'done' },
    })

    const atSeq0 = await services.replay.replay('s1', { toSeq: 0, fromSnapshot: false })
    expect(atSeq0.currentState).toBe('planning')

    const atSeq1 = await services.replay.replay('s1', { toSeq: 1, fromSnapshot: false })
    expect(atSeq1.currentState).toBe('working')

    const full = await services.replay.replay('s1')
    expect(full.currentState).toBe('done')
  })

  it('replay resumes from latest snapshot (fast-forward)', async () => {
    // Write 6 events, snapshot after event 2 (seq=2), then verify replay uses it.
    for (let i = 0; i < 3; i++) {
      await services.events.append({
        sessionId: 's1',
        type: EventTypes.StateTransition,
        payload: { from: `s${i}`, to: `s${i + 1}` },
      })
    }
    await services.snapshots.createSnapshot('s1')

    for (let i = 3; i < 6; i++) {
      await services.events.append({
        sessionId: 's1',
        type: EventTypes.StateTransition,
        payload: { from: `s${i}`, to: `s${i + 1}` },
      })
    }

    const snap = await services.snapshots.loadLatest('s1')
    expect(snap).not.toBeNull()
    expect(snap!.seq).toBe(2)

    // Replay with snapshot — state should equal full replay without snapshot.
    const withSnap = await services.replay.replay('s1')
    const withoutSnap = await services.replay.replay('s1', { fromSnapshot: false })
    expect(withSnap.currentState).toBe(withoutSnap.currentState)
    expect(withSnap.currentState).toBe('s6')
    expect(withSnap.lastSeq).toBe(5)
  })

  it('applyEvent is pure and deterministic', () => {
    const seed = initialAgentState('p')
    const ev = {
      sessionId: 'p',
      seq: 0,
      ts: 1000,
      type: EventTypes.StateTransition,
      payload: { from: 'idle', to: 'x' },
    }
    const a = applyEvent(seed, ev)
    const b = applyEvent(seed, ev)
    expect(a).toEqual(b)
    // Original state untouched
    expect(seed.currentState).toBe('idle')
    expect(a.currentState).toBe('x')
  })

  it('unknown event types do not corrupt state but advance counters', async () => {
    await services.events.append({
      sessionId: 's1',
      type: 'CustomTelemetryEvent',
      payload: { foo: 'bar' },
    })
    const state = await services.replay.replay('s1')
    expect(state.lastSeq).toBe(0)
    expect(state.eventCount).toBe(1)
    expect(state.currentState).toBe('idle')
    expect(state.messages).toEqual([])
  })
})
