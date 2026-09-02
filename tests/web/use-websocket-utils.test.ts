// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { dispatchFrame, handleSubscribeDenied, type WSFrame, type WSMessageHandler } from '../../src/web/src/hooks/use-websocket-utils'
import { WS_SUBSCRIBE_DENIED_EVENT } from '../../src/web/src/lib/ws-topics'

function handlers(entries: Record<string, WSMessageHandler[]>): Map<string, Set<WSMessageHandler>> {
  const map = new Map<string, Set<WSMessageHandler>>()
  for (const [topic, list] of Object.entries(entries)) map.set(topic, new Set(list))
  return map
}

describe('dispatchFrame', () => {
  it('delivers a topic-tagged frame only to that topic handlers', () => {
    const chat = vi.fn()
    const orchestration = vi.fn()
    const map = handlers({ 'chat:c1': [chat], 'orchestration:c1': [orchestration] })
    const frame: WSFrame = { event: 'orchestration', data: { runId: 'c1' }, topic: 'orchestration:c1' }

    dispatchFrame(map, frame)

    expect(orchestration).toHaveBeenCalledWith(frame)
    expect(chat).not.toHaveBeenCalled()
  })

  it('delivers to every handler registered on the same topic', () => {
    const first = vi.fn()
    const second = vi.fn()
    const map = handlers({ 'chat:c1': [first, second] })

    dispatchFrame(map, { event: 'eyas.conversation.*', data: {}, topic: 'chat:c1' })

    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
  })

  it('drops a topic-tagged frame when nothing is subscribed to that topic', () => {
    const chat = vi.fn()
    const map = handlers({ 'chat:c1': [chat] })

    expect(() => dispatchFrame(map, { event: 'x', data: {}, topic: 'board:p1' })).not.toThrow()
    expect(chat).not.toHaveBeenCalled()
  })

  it('fans an untagged frame out to all handlers (broadcastToUser / legacy frames)', () => {
    const chat = vi.fn()
    const orchestration = vi.fn()
    const map = handlers({ 'chat:c1': [chat], 'orchestration:c1': [orchestration] })
    const frame: WSFrame = { event: 'eyas.notify', data: { userId: 'u1' } }

    dispatchFrame(map, frame)

    expect(chat).toHaveBeenCalledWith(frame)
    expect(orchestration).toHaveBeenCalledWith(frame)
  })

  it('treats a non-string topic as untagged', () => {
    const chat = vi.fn()
    const map = handlers({ 'chat:c1': [chat] })

    dispatchFrame(map, { event: 'x', data: {}, topic: 42 as unknown as string })

    expect(chat).toHaveBeenCalledOnce()
  })

  it('is a no-op when no handlers are registered', () => {
    expect(() => dispatchFrame(new Map(), { event: 'x', data: {}, topic: 'chat:c1' })).not.toThrow()
  })

  it('does not call a handler that unsubscribed while the frame was dispatching', () => {
    const late = vi.fn()
    const map = handlers({ 'chat:c1': [] })
    const first: WSMessageHandler = () => {
      map.get('chat:c1')!.delete(late)
    }
    map.get('chat:c1')!.add(first)
    map.get('chat:c1')!.add(late)

    dispatchFrame(map, { event: 'x', data: {}, topic: 'chat:c1' })

    expect(late).not.toHaveBeenCalled()
  })
})

describe('handleSubscribeDenied', () => {
  it('removes the denied topic from the handler map (the re-subscribe set)', () => {
    const chat = vi.fn()
    const map = handlers({ 'chat:foreign': [chat], 'chat:mine': [vi.fn()] })

    const handled = handleSubscribeDenied(map, {
      event: WS_SUBSCRIBE_DENIED_EVENT,
      data: { topic: 'chat:foreign' },
    })

    expect(handled).toBe(true)
    expect(map.has('chat:foreign')).toBe(false)
    expect(map.has('chat:mine')).toBe(true)
    expect(chat).not.toHaveBeenCalled()
  })

  it('returns false (and leaves the map untouched) for a non-denial frame', () => {
    const map = handlers({ 'chat:c1': [vi.fn()] })
    const handled = handleSubscribeDenied(map, { event: 'orchestration', data: {}, topic: 'chat:c1' })
    expect(handled).toBe(false)
    expect(map.has('chat:c1')).toBe(true)
  })

  it('is a no-op when the denied topic was never in the map', () => {
    const map = handlers({ 'chat:c1': [vi.fn()] })
    expect(() => handleSubscribeDenied(map, { event: WS_SUBSCRIBE_DENIED_EVENT, data: { topic: 'chat:never-subscribed' } })).not.toThrow()
    expect(map.has('chat:c1')).toBe(true)
  })

  it('does not throw when the denial frame has malformed data', () => {
    const map = handlers({ 'chat:c1': [vi.fn()] })
    expect(handleSubscribeDenied(map, { event: WS_SUBSCRIBE_DENIED_EVENT, data: null })).toBe(true)
    expect(map.has('chat:c1')).toBe(true)
  })
})
