import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createWSConnectionRegistry } from '@core/http/websocket'
import { createWSBridge } from '@core/http/ws-bridge'
import type { EyasBus, BusSubscription } from '@core/types'
import { WS_SUBSCRIBE_DENIED_EVENT } from '@shared/ws-topics'

// Minimal WS mock
function createMockWS(): { send: ReturnType<typeof vi.fn>; readyState: number; close: ReturnType<typeof vi.fn> } {
  return { send: vi.fn(), readyState: 1 /* OPEN */, close: vi.fn() }
}

describe('WSConnectionRegistry', () => {
  let registry: ReturnType<typeof createWSConnectionRegistry>

  beforeEach(() => {
    registry = createWSConnectionRegistry()
  })

  it('adds and retrieves connections for a user', () => {
    const ws = createMockWS()
    registry.add('user1', ws as any)
    expect(registry.getConnections('user1')).toHaveLength(1)
  })

  it('removes connections', () => {
    const ws = createMockWS()
    registry.add('user1', ws as any)
    registry.remove('user1', ws as any)
    expect(registry.getConnections('user1')).toHaveLength(0)
  })

  it('returns empty array for unknown user', () => {
    expect(registry.getConnections('nobody')).toEqual([])
  })

  it('broadcastToUser sends to all user connections', () => {
    const ws1 = createMockWS()
    const ws2 = createMockWS()
    registry.add('user1', ws1 as any)
    registry.add('user1', ws2 as any)

    registry.broadcastToUser('user1', { event: 'test', data: { foo: 1 } })

    const expected = JSON.stringify({ event: 'test', data: { foo: 1 } })
    expect(ws1.send).toHaveBeenCalledWith(expected)
    expect(ws2.send).toHaveBeenCalledWith(expected)
  })

  it('does not send to closed connections', () => {
    const ws = createMockWS()
    ws.readyState = 3 // CLOSED
    registry.add('user1', ws as any)

    registry.broadcastToUser('user1', { event: 'test', data: {} })
    expect(ws.send).not.toHaveBeenCalled()
  })

  it('subscribe and broadcast by topic', () => {
    const ws1 = createMockWS()
    const ws2 = createMockWS()
    registry.add('user1', ws1 as any)
    registry.add('user2', ws2 as any)

    registry.subscribe('user1', ws1 as any, 'board:project-1')
    // ws2 is NOT subscribed to this topic

    registry.broadcast('board:project-1', { event: 'task.updated', data: { id: '1' } })

    expect(ws1.send).toHaveBeenCalledTimes(1)
    expect(ws2.send).not.toHaveBeenCalled()
  })

  it('broadcast frames carry the topic so clients can dispatch by it', () => {
    const ws = createMockWS()
    registry.add('user1', ws as any)
    registry.subscribe('user1', ws as any, 'orchestration:r1')

    registry.broadcast('orchestration:r1', { event: 'orchestration', data: { seq: 1 } })

    const frame = JSON.parse(ws.send.mock.calls[0][0])
    expect(frame).toEqual({ event: 'orchestration', data: { seq: 1 }, topic: 'orchestration:r1' })
  })

  it('unsubscribe stops receiving topic broadcasts', () => {
    const ws = createMockWS()
    registry.add('user1', ws as any)
    registry.subscribe('user1', ws as any, 'board:project-1')
    registry.unsubscribe('user1', ws as any, 'board:project-1')

    registry.broadcast('board:project-1', { event: 'test', data: {} })
    expect(ws.send).not.toHaveBeenCalled()
  })

  it('remove cleans up subscriptions', () => {
    const ws = createMockWS()
    registry.add('user1', ws as any)
    registry.subscribe('user1', ws as any, 'board:project-1')
    registry.remove('user1', ws as any)

    registry.broadcast('board:project-1', { event: 'test', data: {} })
    expect(ws.send).not.toHaveBeenCalled()
  })

  it('multiple topics per connection', () => {
    const ws = createMockWS()
    registry.add('user1', ws as any)
    registry.subscribe('user1', ws as any, 'board:p1')
    registry.subscribe('user1', ws as any, 'agent:s1')

    registry.broadcast('board:p1', { event: 'a', data: {} })
    registry.broadcast('agent:s1', { event: 'b', data: {} })

    expect(ws.send).toHaveBeenCalledTimes(2)
  })

  // D14 — topic ACL + NACK
  describe('setTopicAcl', () => {
    it('subscribes normally when no ACL is wired (backward compatible)', () => {
      const ws = createMockWS()
      registry.add('user1', ws as any)
      registry.subscribe('user1', ws as any, 'chat:c1')

      registry.broadcast('chat:c1', { event: 'x', data: {} })
      expect(ws.send).toHaveBeenCalledTimes(1)
    })

    it('denies a subscribe the ACL rejects: sends a NACK and does not register', () => {
      const ws = createMockWS()
      registry.add('user1', ws as any)
      registry.setTopicAcl({ canSubscribe: () => false })

      registry.subscribe('user1', ws as any, 'chat:foreign')

      expect(ws.send).toHaveBeenCalledTimes(1)
      expect(JSON.parse(ws.send.mock.calls[0][0])).toEqual({
        event: WS_SUBSCRIBE_DENIED_EVENT,
        data: { topic: 'chat:foreign' },
      })

      // Not registered: a broadcast on that topic reaches nobody.
      ws.send.mockClear()
      registry.broadcast('chat:foreign', { event: 'y', data: {} })
      expect(ws.send).not.toHaveBeenCalled()
    })

    it('allows a subscribe the ACL approves', () => {
      const ws = createMockWS()
      registry.add('user1', ws as any)
      registry.setTopicAcl({ canSubscribe: () => true })

      registry.subscribe('user1', ws as any, 'chat:mine')
      registry.broadcast('chat:mine', { event: 'y', data: {} })

      expect(ws.send).toHaveBeenCalledTimes(1)
    })

    it('passes the subscribing userId and topic to the ACL', () => {
      const ws = createMockWS()
      registry.add('user1', ws as any)
      const canSubscribe = vi.fn(() => true)
      registry.setTopicAcl({ canSubscribe })

      registry.subscribe('user1', ws as any, 'board:p1')

      expect(canSubscribe).toHaveBeenCalledWith('user1', 'board:p1')
    })

    it('does not NACK a closed connection', () => {
      const ws = createMockWS()
      ws.readyState = 3 // CLOSED
      registry.add('user1', ws as any)
      registry.setTopicAcl({ canSubscribe: () => false })

      registry.subscribe('user1', ws as any, 'chat:foreign')
      expect(ws.send).not.toHaveBeenCalled()
    })
  })

  describe('closeUser', () => {
    it('closes every socket for a user', () => {
      const ws1 = createMockWS()
      const ws2 = createMockWS()
      registry.add('user1', ws1 as any)
      registry.add('user1', ws2 as any)

      registry.closeUser('user1')

      expect(ws1.close).toHaveBeenCalledTimes(1)
      expect(ws2.close).toHaveBeenCalledTimes(1)
    })

    it('does not touch another user\'s sockets', () => {
      const ws1 = createMockWS()
      const ws2 = createMockWS()
      registry.add('user1', ws1 as any)
      registry.add('user2', ws2 as any)

      registry.closeUser('user1')

      expect(ws1.close).toHaveBeenCalledTimes(1)
      expect(ws2.close).not.toHaveBeenCalled()
    })

    it('is a no-op for a user with no connections', () => {
      expect(() => registry.closeUser('nobody')).not.toThrow()
    })

    it('does not throw when a socket\'s close() throws', () => {
      const ws = createMockWS()
      ws.close.mockImplementation(() => { throw new Error('boom') })
      registry.add('user1', ws as any)

      expect(() => registry.closeUser('user1')).not.toThrow()
    })
  })
})

describe('WSBridge', () => {
  type Handler = (data: unknown, emittedSubject?: string) => Promise<void>

  /**
   * Several mappings share one wildcard subject (eyas.agent.run.* fans out to
   * both the list topic and the per-agent topic), so handlers are keyed as an
   * ARRAY per subject — a Map<string, Handler> would silently drop all but the
   * last registration and hide the fan-out.
   */
  function createMockBus(): EyasBus & {
    handlers: Map<string, Handler[]>
    fire(subject: string, data: unknown, emittedSubject?: string): Promise<void>
  } {
    const handlers = new Map<string, Handler[]>()
    return {
      handlers,
      emit: vi.fn(),
      on(subject: string, handler: Handler): BusSubscription {
        const list = handlers.get(subject) ?? []
        list.push(handler)
        handlers.set(subject, list)
        return { subject, id: String(list.length), unsubscribe: vi.fn() }
      },
      off: vi.fn(),
      async fire(subject: string, data: unknown, emittedSubject?: string) {
        const list = handlers.get(subject)
        if (!list) throw new Error(`no bridge mapping registered for ${subject}`)
        for (const h of list) await h(data, emittedSubject ?? subject)
      },
    }
  }

  function setupBridge(topics: string[]) {
    const bus = createMockBus()
    const registry = createWSConnectionRegistry()
    const ws = createMockWS()
    registry.add('user1', ws as any)
    for (const t of topics) registry.subscribe('user1', ws as any, t)
    createWSBridge(bus, registry)
    return { bus, registry, ws }
  }

  const frames = (ws: ReturnType<typeof createMockWS>) =>
    ws.send.mock.calls.map((c) => JSON.parse(c[0] as string))

  it('routes eyas.board.* events to board:<projectId> topic', async () => {
    const { bus, ws } = setupBridge(['board:proj-42'])

    await bus.fire('eyas.board.*', { projectId: 'proj-42', type: 'task.moved' }, 'eyas.board.card_moved')

    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'eyas.board.card_moved',
        data: { projectId: 'proj-42', type: 'task.moved' },
        topic: 'board:proj-42',
      })
    )
  })

  it('frames carry the CONCRETE emitted subject, not the wildcard mapping', async () => {
    const { bus, ws } = setupBridge(['chat:conv-7'])

    await bus.fire('eyas.conversation.*', { conversationId: 'conv-7' }, 'eyas.conversation.sub_created')

    expect(frames(ws)[0].event).toBe('eyas.conversation.sub_created')
  })

  it('skips the broadcast when the topic cannot be resolved', async () => {
    const { bus, ws } = setupBridge(['board:proj-42', 'board:undefined'])

    await bus.fire('eyas.board.*', { type: 'task.moved' }, 'eyas.board.card_moved')

    expect(ws.send).not.toHaveBeenCalled()
  })

  it('routes eyas.notify to notifications:<userId> topic', async () => {
    const { bus, ws } = setupBridge(['notifications:user1'])

    await bus.fire('eyas.notify', { userId: 'user1', message: 'hello' })

    expect(ws.send).toHaveBeenCalledTimes(1)
  })

  it('fans eyas.agent.run.* out to the agent-runs list topic AND agent:<agentId>', async () => {
    const { bus, ws } = setupBridge(['agent-runs', 'agent:a-1'])

    await bus.fire(
      'eyas.agent.run.*',
      { runId: 'r-1', agentId: 'a-1', conversationId: 'c-1' },
      'eyas.agent.run.started',
    )

    const sent = frames(ws)
    expect(sent.map((f) => f.topic).sort()).toEqual(['agent-runs', 'agent:a-1'])
    expect(sent.every((f) => f.event === 'eyas.agent.run.started')).toBe(true)
  })

  it('routes a run event with no agentId to the list topic only', async () => {
    const { bus, ws } = setupBridge(['agent-runs', 'agent:undefined'])

    await bus.fire('eyas.agent.run.*', { runId: 'r-1' }, 'eyas.agent.run.progress')

    const sent = frames(ws)
    expect(sent).toHaveLength(1)
    expect(sent[0].topic).toBe('agent-runs')
  })

  // `agent-runs` is a global topic and subscription is authenticated but NOT
  // permission-scoped, so anything free-text in a run payload would be readable
  // by every logged-in user.
  it('never puts run error text on the wire', async () => {
    const { bus, ws } = setupBridge(['agent-runs', 'agent:a-1'])

    await bus.fire(
      'eyas.agent.run.*',
      { runId: 'r-1', agentId: 'a-1', conversationId: 'c-1', error: 'ENOENT /Users/alice/.ssh/id_rsa' },
      'eyas.agent.run.failed',
    )

    const sent = frames(ws)
    expect(sent).toHaveLength(2)
    for (const frame of sent) {
      expect(frame.data).toEqual({ runId: 'r-1', agentId: 'a-1', conversationId: 'c-1' })
      expect(JSON.stringify(frame)).not.toContain('id_rsa')
    }
    // The subject alone still tells the client what happened.
    expect(sent[0].event).toBe('eyas.agent.run.failed')
  })

  it('keeps the thin run fields and drops anything not on the allow-list', async () => {
    const { bus, ws } = setupBridge(['agent-runs'])

    await bus.fire(
      'eyas.agent.run.*',
      { runId: 'r-1', agentId: 'a-1', conversationId: 'c-1', kind: 'background', seq: 4, stalledMs: 900, recovered: true, somethingAddedLater: 'raw text' },
      'eyas.agent.run.stuck',
    )

    expect(frames(ws)[0].data).toEqual({
      runId: 'r-1', agentId: 'a-1', conversationId: 'c-1', kind: 'background', seq: 4, stalledMs: 900, recovered: true,
    })
  })

  // F2 T5/S10: the park frame carries the approval id on the BUS (in-process
  // listeners need it), but `agent-runs` is global — an approval id is a
  // handle onto someone else's queued action, so it must not reach the wire.
  it('drops approvalId from the waiting_approval frame (bus-only field)', async () => {
    const { bus, ws } = setupBridge(['agent-runs', 'agent:a-1'])

    await bus.fire(
      'eyas.agent.run.*',
      { runId: 'r-1', agentId: 'a-1', conversationId: 'c-1', approvalId: 42 },
      'eyas.agent.run.waiting_approval',
    )

    const sent = frames(ws)
    expect(sent).toHaveLength(2)
    for (const frame of sent) {
      expect(frame.data).toEqual({ runId: 'r-1', agentId: 'a-1', conversationId: 'c-1' })
    }
    expect(sent[0].event).toBe('eyas.agent.run.waiting_approval')
  })

  it('routes eyas.agent.budget.* to agent:<agentId>, dropping the rendered message', async () => {
    const { bus, ws } = setupBridge(['agent:a-9'])

    await bus.fire(
      'eyas.agent.budget.*',
      { agentId: 'a-9', level: 'warning', percentage: 82, message: 'Agent "Alice\'s Assistant" has used 82% of monthly token budget', timestamp: 'now' },
      'eyas.agent.budget.alert',
    )
    expect(frames(ws).map((f) => f.topic)).toEqual(['agent:a-9'])
    expect(frames(ws)[0].data).toEqual({ agentId: 'a-9', level: 'warning', percentage: 82 })

    ws.send.mockClear()
    await bus.fire('eyas.agent.budget.*', { level: 'warning' }, 'eyas.agent.budget.alert')
    expect(ws.send).not.toHaveBeenCalled()
  })

  it('routes eyas.conversation.* to chat:<conversationId> topic', async () => {
    const { bus, ws } = setupBridge(['chat:conv-7'])

    await bus.fire('eyas.conversation.*', { conversationId: 'conv-7', chunk: 'hi' })

    expect(ws.send).toHaveBeenCalledTimes(1)
  })

  it('routes the legacy PLURAL eyas.conversations.* subjects to chat:<conversationId>', async () => {
    const { bus, ws } = setupBridge(['chat:conv-8'])

    await bus.fire(
      'eyas.conversations.*',
      { conversationId: 'conv-8', stageId: 'st-1' },
      'eyas.conversations.stage_changed',
    )

    const sent = frames(ws)
    expect(sent).toHaveLength(1)
    expect(sent[0].event).toBe('eyas.conversations.stage_changed')
    expect(sent[0].topic).toBe('chat:conv-8')
  })

  it('routes eyas.module.* to system topic', async () => {
    const { bus, ws } = setupBridge(['system'])

    await bus.fire('eyas.module.*', { module: 'auth', action: 'reload' })

    expect(ws.send).toHaveBeenCalledTimes(1)
  })

  it('routes eyas.budget.* to system topic', async () => {
    const { bus, ws } = setupBridge(['system'])

    await bus.fire('eyas.budget.*', { remaining: 100 })

    expect(ws.send).toHaveBeenCalledTimes(1)
  })

  it('routes eyas.communication.* to system topic', async () => {
    const { bus, ws } = setupBridge(['system'])

    await bus.fire('eyas.communication.*', { channel: 'telegram' })

    expect(ws.send).toHaveBeenCalledTimes(1)
  })
})
