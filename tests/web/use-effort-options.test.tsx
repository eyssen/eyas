// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// E5 — useEffortOptions: which endpoint each key reads, a refetch when the
// conversation's model / Deep / stored level changes, and a colleague's
// options only once its model is known.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, api: { get: h.get } }
})

import { useEffortOptions, type EffortOptionsKey } from '@/hooks/use-effort-options'

beforeEach(() => {
  h.get.mockReset()
  h.get.mockImplementation(async (path: string) => {
    if (path.startsWith('/agents/')) return { agent: { provider: 'anthropic', model: 'claude-opus-4-8' } }
    return { mode: 'pinned', levels: ['low'], path }
  })
})
afterEach(() => cleanup())

describe('useEffortOptions', () => {
  it('a conversation reads its own endpoint and refetches when the refresh key changes', async () => {
    const { result, rerender } = renderHook((key: EffortOptionsKey) => useEffortOptions(key), {
      initialProps: { conversationId: 'c1', refreshKey: 'a' },
    })
    await waitFor(() => expect(result.current.options).not.toBeNull())
    expect(h.get).toHaveBeenCalledWith('/conversations/c1/effort-options')
    expect(h.get).toHaveBeenCalledTimes(1)
    rerender({ conversationId: 'c1', refreshKey: 'a' })
    expect(h.get).toHaveBeenCalledTimes(1)
    rerender({ conversationId: 'c1', refreshKey: 'b' })
    await waitFor(() => expect(h.get).toHaveBeenCalledTimes(2))
  })

  it('a model pair, and no model (the tier union)', async () => {
    const pair = renderHook(() => useEffortOptions({ providerId: 'openai', modelId: 'gpt-5.5' }))
    await waitFor(() => expect(pair.result.current.options).not.toBeNull())
    expect(h.get).toHaveBeenCalledWith('/model/effort-options?providerId=openai&modelId=gpt-5.5')
    const none = renderHook(() => useEffortOptions({ providerId: null, modelId: null }))
    await waitFor(() => expect(none.result.current.options).not.toBeNull())
    expect(h.get).toHaveBeenCalledWith('/model/effort-options')
  })

  it("a colleague: its model first, then that model's options", async () => {
    const { result } = renderHook(() => useEffortOptions({ agentId: 'a1' }))
    await waitFor(() => expect(result.current.options).not.toBeNull())
    expect(h.get.mock.calls.map((c) => c[0])).toEqual([
      '/agents/a1',
      '/model/effort-options?providerId=anthropic&modelId=claude-opus-4-8',
    ])
  })

  it('no colleague chosen yet → nothing is fetched (negative)', async () => {
    const { result } = renderHook(() => useEffortOptions({ agentId: null }))
    await new Promise((r) => setTimeout(r, 10))
    expect(h.get).not.toHaveBeenCalled()
    expect(result.current.options).toBeNull()
  })
})
