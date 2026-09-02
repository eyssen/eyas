// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Covers the four properties useWidgetData exists to guarantee: (1) reconnect
// refetch -- a topic ping alone can't fill the gap left by a dropped
// websocket, so a tile must refetch on every false->true `connected`
// transition, not just on pings; (2) stale-while-revalidate -- no empty
// flash on refresh; (3) gated polling -- tab-visibility and, once a tile
// element is attached, on-screen (IntersectionObserver) gates; (4) in-flight
// dedupe -- one path, one response, however many tiles ask for it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useWidgetData, __resetInflight } from '@/pages/home/use-widget-data'
import { api } from '@/lib/api'
import { WS_TOPICS } from '@/lib/ws-topics'

// The real useWebSocket hook does async token fetches and opens a live
// WebSocket -- irrelevant here and actively hostile to fake timers. This
// fake mirrors its shape (subscribe/connected) and lets tests drive both.
const wsState = vi.hoisted(() => ({
  connected: true,
  handlers: new Map<string, Set<() => void>>(),
}))

vi.mock('@/hooks/use-websocket', () => ({
  useWebSocket: () => ({
    connected: wsState.connected,
    subscribe: (topic: string, handler: () => void) => {
      if (!wsState.handlers.has(topic)) wsState.handlers.set(topic, new Set())
      wsState.handlers.get(topic)!.add(handler)
      return () => wsState.handlers.get(topic)?.delete(handler)
    },
  }),
}))

function emitTopic(topic: string) {
  wsState.handlers.get(topic)?.forEach((h) => h())
}

// jsdom has no IntersectionObserver. This fake captures the callback per
// instance so a test can fire it manually to simulate scroll/viewport
// changes.
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  callback: IntersectionObserverCallback
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
  constructor(cb: IntersectionObserverCallback) {
    this.callback = cb
    FakeIntersectionObserver.instances.push(this)
  }
  trigger(isIntersecting: boolean) {
    this.callback([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

beforeEach(() => {
  __resetInflight()
  wsState.connected = true
  wsState.handlers.clear()
  FakeIntersectionObserver.instances.length = 0
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('useWidgetData', () => {
  it('keeps the previous data visible while refetching (no empty flash)', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValueOnce({ n: 1 } as never)
      .mockImplementationOnce(() => new Promise(() => {}) as never) // never settles
    const { result } = renderHook(() => useWidgetData<{ n: number }>('/x', {}))
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }))

    act(() => {
      result.current.refetch()
    })
    expect(result.current.data).toEqual({ n: 1 }) // still the old value, NOT null
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('polls on the declared interval', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ n: 1 } as never)
    renderHook(() => useWidgetData('/x', { pollMs: 1000 }))
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('stops polling while the document is hidden', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ n: 1 } as never)
    renderHook(() => useWidgetData('/x', { pollMs: 1000 }))
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('shares one in-flight request between tiles on the same path', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ n: 1 } as never)
    renderHook(() => useWidgetData('/shared', {}))
    renderHook(() => useWidgetData('/shared', {}))
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
  })

  // Ruling 15: use-websocket.ts documents that frames broadcast while the
  // socket was down are gone -- a topic ping alone can't fill the gap. This
  // test would pass trivially (get called once) if reconnect refetch were
  // absent and the assertion only checked "at least one call" -- it
  // deliberately pins the count at each step so a missing reconnect handler
  // (still 1 after reconnect) or a double-counted first-connect (2 before
  // any disconnect) both fail it.
  it('refetches once on websocket reconnect, and not on first connect', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ n: 1 } as never)
    const { rerender } = renderHook(() => useWidgetData('/y', {}))
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    expect(get).toHaveBeenCalledTimes(1) // first connect (mount) did not trigger a second fetch

    wsState.connected = false
    rerender()
    expect(get).toHaveBeenCalledTimes(1) // disconnect alone never fetches

    wsState.connected = true
    rerender()
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2)) // reconnect: exactly one extra fetch
    expect(get).toHaveBeenCalledTimes(2)
  })

  // Fix round 1: `topics` entries must be resolved WS_TOPICS values
  // (`WS_TOPICS.missionControl === 'mission-control'`), never the bare
  // catalogue key (`'missionControl'`) -- those differ for 4 of 9 topics.
  // The negative ping (a real, different topic) proves the subscription is
  // scoped to the exact resolved name, not "any ping refetches".
  it('subscribes to a static resolved topic name, and refetches only on its own ping', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ n: 1 } as never)
    renderHook(() => useWidgetData('/z', { topics: [WS_TOPICS.missionControl] }))
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))

    act(() => {
      emitTopic(WS_TOPICS.autonomy) // a different real topic -- must not refetch this tile
    })
    expect(get).toHaveBeenCalledTimes(1)

    act(() => {
      emitTopic(WS_TOPICS.missionControl)
    })
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
  })

  // The Board tile's topic depends on which project it's configured for,
  // unknown at declaration time -- `topics` may be a function of the tile's
  // config, invoked with the hook's third argument. The negative ping (the
  // same topic shape but for a DIFFERENT project) proves the function's
  // return value was actually used, not just called for its side effect.
  it('resolves a config-derived topics function with the tile config, and subscribes to what it returns', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ n: 1 } as never)
    const topicsFn = vi.fn((cfg: { projectId: string }) => [WS_TOPICS.board(cfg.projectId)])
    renderHook(() => useWidgetData('/board', { topics: topicsFn }, { projectId: 'p1' }))
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    expect(topicsFn).toHaveBeenCalledWith({ projectId: 'p1' })

    act(() => {
      emitTopic(WS_TOPICS.board('other-project')) // a different tile's board -- must not refetch this one
    })
    expect(get).toHaveBeenCalledTimes(1)

    act(() => {
      emitTopic(WS_TOPICS.board('p1'))
    })
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
  })

  // Silently dropping an unresolvable topic (the previous key-lookup rescue)
  // is exactly the failure mode this plan exists to hunt down: a tile that
  // never refreshes and never says why. Failing loud instead means it's
  // caught in development rather than shipped as a dead tile.
  it('throws on an unresolved topic (a bare key) instead of silently dropping the subscription', () => {
    expect(() => {
      renderHook(() => useWidgetData('/bad', { topics: ['missionControl'] }))
    }).toThrow(/not a resolved WS_TOPICS value/)
  })

  it('stops polling once the attached tile element leaves the viewport, resumes when it returns', async () => {
    const originalIO = globalThis.IntersectionObserver
    ;(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIntersectionObserver
    try {
      const get = vi.spyOn(api, 'get').mockResolvedValue({ n: 1 } as never)
      const { result } = renderHook(() => useWidgetData('/w', { pollMs: 1000 }))
      await waitFor(() => expect(get).toHaveBeenCalledTimes(1))

      act(() => {
        result.current.tileRef(document.createElement('div'))
      })
      const observer = FakeIntersectionObserver.instances.at(-1)
      expect(observer).toBeDefined()

      act(() => {
        observer!.trigger(false) // scrolled off screen
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000) // three ticks would fire without the gate
      })
      expect(get).toHaveBeenCalledTimes(1)

      act(() => {
        observer!.trigger(true) // back on screen
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(get).toHaveBeenCalledTimes(2)
    } finally {
      ;(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = originalIO
    }
  })
})
