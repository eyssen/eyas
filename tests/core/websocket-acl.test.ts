// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createWSConnectionRegistry } from '@core/http/websocket'
import { createTopicAcl } from '@core/http/ws-acl'
import { WS_TOPICS, WS_SUBSCRIBE_DENIED_EVENT } from '@shared/ws-topics'

function createMockWS(): { send: ReturnType<typeof vi.fn>; readyState: number; close: ReturnType<typeof vi.fn> } {
  return { send: vi.fn(), readyState: 1, close: vi.fn() }
}

describe('WS topic ACL (D14) — registry + createTopicAcl wired together', () => {
  let registry: ReturnType<typeof createWSConnectionRegistry>
  let acl: ReturnType<typeof createTopicAcl>

  beforeEach(() => {
    registry = createWSConnectionRegistry()
    acl = createTopicAcl()
    registry.setTopicAcl(acl)
    // Default: every userId is a plain 'user' unless a test overrides it.
    acl.setRoleLookup((userId) => (userId === 'nobody' ? undefined : 'user'))
  })

  function subscribeAndGetFrame(userId: string, topic: string) {
    const ws = createMockWS()
    registry.add(userId, ws as any)
    registry.subscribe(userId, ws as any, topic)
    return ws
  }

  describe('globals', () => {
    it('allows a plain authenticated user onto every global topic', () => {
      for (const topic of [WS_TOPICS.system, WS_TOPICS.agentRuns, WS_TOPICS.autonomy, WS_TOPICS.missionControl]) {
        const ws = subscribeAndGetFrame('u1', topic)
        registry.broadcast(topic, { event: 'x', data: {} })
        expect(ws.send).toHaveBeenCalledTimes(1)
      }
    })
  })

  describe('agent: and board: — deferred membership, any authenticated user', () => {
    it('allows agent:<id>', () => {
      const ws = subscribeAndGetFrame('u1', WS_TOPICS.agent('a-1'))
      registry.broadcast(WS_TOPICS.agent('a-1'), { event: 'x', data: {} })
      expect(ws.send).toHaveBeenCalledTimes(1)
    })

    it('allows board:<id>', () => {
      const ws = subscribeAndGetFrame('u1', WS_TOPICS.board('p-1'))
      registry.broadcast(WS_TOPICS.board('p-1'), { event: 'x', data: {} })
      expect(ws.send).toHaveBeenCalledTimes(1)
    })
  })

  describe('notifications:<userId>', () => {
    it('allows a user to subscribe to their own notifications topic', () => {
      const ws = subscribeAndGetFrame('u1', WS_TOPICS.notifications('u1'))
      registry.broadcast(WS_TOPICS.notifications('u1'), { event: 'x', data: {} })
      expect(ws.send).toHaveBeenCalledTimes(1)
    })

    it('denies a user subscribing to a DIFFERENT user\'s notifications topic', () => {
      const ws = subscribeAndGetFrame('u1', WS_TOPICS.notifications('u2'))
      expect(JSON.parse(ws.send.mock.calls[0][0])).toEqual({
        event: WS_SUBSCRIBE_DENIED_EVENT,
        data: { topic: WS_TOPICS.notifications('u2') },
      })
    })

    it('allows admin onto ANY user\'s notifications topic', () => {
      acl.setRoleLookup(() => 'admin')
      const ws = subscribeAndGetFrame('admin-1', WS_TOPICS.notifications('u2'))
      registry.broadcast(WS_TOPICS.notifications('u2'), { event: 'x', data: {} })
      expect(ws.send).toHaveBeenCalledTimes(1)
    })
  })

  describe('per-id content topics — delegated to registered resolvers', () => {
    it('denies a foreign team:<id>:event topic (no resolver registered): NACK sent, not registered', () => {
      const ws = subscribeAndGetFrame('u1', WS_TOPICS.teamEvent('team-1'))
      expect(JSON.parse(ws.send.mock.calls[0][0])).toEqual({
        event: WS_SUBSCRIBE_DENIED_EVENT,
        data: { topic: WS_TOPICS.teamEvent('team-1') },
      })
      ws.send.mockClear()
      registry.broadcast(WS_TOPICS.teamEvent('team-1'), { event: 'team', data: {} })
      expect(ws.send).not.toHaveBeenCalled()
    })

    it('denies a foreign team:<id>:event topic with a resolver registered', () => {
      acl.registerResolver('teamEvent', (userId, id) => userId === 'owner-of-' + id)
      const ws = subscribeAndGetFrame('u1', WS_TOPICS.teamEvent('team-1'))
      expect(JSON.parse(ws.send.mock.calls[0][0]).event).toBe(WS_SUBSCRIBE_DENIED_EVENT)
    })

    it('allows an owned team:<id>:event topic', () => {
      acl.registerResolver('teamEvent', (userId, id) => userId === 'owner-of-' + id)
      const ws = subscribeAndGetFrame('owner-of-team-1', WS_TOPICS.teamEvent('team-1'))
      registry.broadcast(WS_TOPICS.teamEvent('team-1'), { event: 'team', data: {} })
      expect(ws.send).toHaveBeenCalledTimes(1)
    })

    it('admin bypasses the resolver entirely (sees all)', () => {
      acl.registerResolver('teamEvent', () => false)
      acl.setRoleLookup(() => 'admin')
      const ws = subscribeAndGetFrame('admin-1', WS_TOPICS.teamEvent('team-1'))
      registry.broadcast(WS_TOPICS.teamEvent('team-1'), { event: 'team', data: {} })
      expect(ws.send).toHaveBeenCalledTimes(1)
    })

    it('denies when the resolver throws (deny, not crash)', () => {
      acl.registerResolver('chat', () => { throw new Error('db exploded') })
      const ws = subscribeAndGetFrame('u1', WS_TOPICS.chat('c1'))
      expect(JSON.parse(ws.send.mock.calls[0][0]).event).toBe(WS_SUBSCRIBE_DENIED_EVENT)
    })

    it('disambiguates team:proposed:<convId> from team:<id>:event', () => {
      const proposedCalls: Array<[string, string]> = []
      const eventCalls: Array<[string, string]> = []
      acl.registerResolver('teamProposed', (userId, id) => { proposedCalls.push([userId, id]); return true })
      acl.registerResolver('teamEvent', (userId, id) => { eventCalls.push([userId, id]); return true })

      subscribeAndGetFrame('u1', WS_TOPICS.teamProposed('conv-1'))
      subscribeAndGetFrame('u1', WS_TOPICS.teamEvent('team-1'))

      expect(proposedCalls).toEqual([['u1', 'conv-1']])
      expect(eventCalls).toEqual([['u1', 'team-1']])
    })

    it('resolves orchestration:<runId> via its registered resolver', () => {
      acl.registerResolver('orchestration', (userId, runId) => runId === 'run-owned-by-' + userId)
      const owned = subscribeAndGetFrame('u1', WS_TOPICS.orchestration('run-owned-by-u1'))
      registry.broadcast(WS_TOPICS.orchestration('run-owned-by-u1'), { event: 'orchestration', data: {} })
      expect(owned.send).toHaveBeenCalledTimes(1)
    })

    it('denies an unresolvable orchestration:<runId>', () => {
      acl.registerResolver('orchestration', () => false)
      const ws = subscribeAndGetFrame('u1', WS_TOPICS.orchestration('does-not-exist'))
      expect(JSON.parse(ws.send.mock.calls[0][0]).event).toBe(WS_SUBSCRIBE_DENIED_EVENT)
    })
  })

  describe('unknown per-id-looking topics', () => {
    it('denies a colon-containing topic that matches no known shape', () => {
      const ws = subscribeAndGetFrame('u1', 'mystery:123')
      expect(JSON.parse(ws.send.mock.calls[0][0])).toEqual({
        event: WS_SUBSCRIBE_DENIED_EVENT,
        data: { topic: 'mystery:123' },
      })
    })
  })

  describe('role lookup — fresh per subscribe', () => {
    it('denies a suspended/missing user, including globals', () => {
      const ws = subscribeAndGetFrame('nobody', WS_TOPICS.system)
      expect(JSON.parse(ws.send.mock.calls[0][0]).event).toBe(WS_SUBSCRIBE_DENIED_EVENT)
    })

    it('re-checks the role on every subscribe (no caching)', () => {
      let role = 'user'
      acl.setRoleLookup(() => role)
      acl.registerResolver('chat', () => false)

      const ws1 = subscribeAndGetFrame('u1', WS_TOPICS.chat('c1'))
      expect(JSON.parse(ws1.send.mock.calls[0][0]).event).toBe(WS_SUBSCRIBE_DENIED_EVENT)

      role = 'admin'
      const ws2 = subscribeAndGetFrame('u1', WS_TOPICS.chat('c1'))
      registry.broadcast(WS_TOPICS.chat('c1'), { event: 'x', data: {} })
      expect(ws2.send).toHaveBeenCalledTimes(1)
    })
  })
})
