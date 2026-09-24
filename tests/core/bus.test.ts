import { describe, it, expect, vi } from 'vitest'
import { createLocalBus } from '@core/bus/local-bus'

describe('LocalBus', () => {
  it('emits and receives events', async () => {
    const bus = createLocalBus()
    const handler = vi.fn()
    bus.on('test.event', handler)
    bus.emit('test.event', { message: 'hello' })
    await new Promise((r) => setTimeout(r, 10))
    expect(handler).toHaveBeenCalledWith({ message: 'hello' }, 'test.event')
  })

  it('unsubscribes correctly', async () => {
    const bus = createLocalBus()
    const handler = vi.fn()
    const sub = bus.on('test.event', handler)
    bus.off(sub)
    bus.emit('test.event', { data: 1 })
    await new Promise((r) => setTimeout(r, 10))
    expect(handler).not.toHaveBeenCalled()
  })

  it('supports multiple handlers on same subject', async () => {
    const bus = createLocalBus()
    const h1 = vi.fn(), h2 = vi.fn()
    bus.on('multi.event', h1)
    bus.on('multi.event', h2)
    bus.emit('multi.event', 'data')
    await new Promise((r) => setTimeout(r, 10))
    expect(h1).toHaveBeenCalledWith('data', 'multi.event')
    expect(h2).toHaveBeenCalledWith('data', 'multi.event')
  })

  it('does not throw when emitting with no listeners', () => {
    const bus = createLocalBus()
    expect(() => bus.emit('no.listeners', {})).not.toThrow()
  })

  it('fires wildcard handlers for concrete subjects (ws-bridge pattern)', async () => {
    const bus = createLocalBus()
    const handler = vi.fn()
    bus.on('eyas.board.*', handler)
    bus.emit('eyas.board.card_moved', { projectId: 'p1' })
    await new Promise((r) => setTimeout(r, 10))
    expect(handler).toHaveBeenCalledWith({ projectId: 'p1' }, 'eyas.board.card_moved')
  })

  it('does not fire wildcard handlers for non-matching prefixes', async () => {
    const bus = createLocalBus()
    const board = vi.fn(), agent = vi.fn()
    bus.on('eyas.board.*', board)
    bus.on('eyas.agent.*', agent)
    bus.emit('eyas.agent.run.started', { sessionId: 's1' })
    await new Promise((r) => setTimeout(r, 10))
    expect(agent).toHaveBeenCalledWith({ sessionId: 's1' }, 'eyas.agent.run.started')
    expect(board).not.toHaveBeenCalled()
  })

  it('invokes both exact and wildcard handlers exactly once each', async () => {
    const bus = createLocalBus()
    const exact = vi.fn(), wild = vi.fn()
    bus.on('eyas.board.card_moved', exact)
    bus.on('eyas.board.*', wild)
    bus.emit('eyas.board.card_moved', { projectId: 'p1' })
    await new Promise((r) => setTimeout(r, 10))
    expect(exact).toHaveBeenCalledTimes(1)
    expect(wild).toHaveBeenCalledTimes(1)
  })

  it('passes the concrete emitted subject to wildcard handlers', async () => {
    const bus = createLocalBus()
    const handler = vi.fn()
    bus.on('eyas.*', handler)
    bus.emit('eyas.secrets.denied', { userId: 'u1' })
    await new Promise((r) => setTimeout(r, 10))
    expect(handler).toHaveBeenCalledWith({ userId: 'u1' }, 'eyas.secrets.denied')
  })
})
