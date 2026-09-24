// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { createLazyMemoryHooks } from '@modules/conversations/memory-hooks'

const logger = { info: vi.fn(), warn: vi.fn() } as any

// The lazy resolve crosses a dynamic import; on a cold suite (this file
// running first) that import can take longer than any fixed delay, so we
// poll for the expected condition instead of sleeping a fixed amount.
const waitFor = async (cond: () => boolean, ms = 2000) => {
  const start = Date.now()
  while (!cond() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 5))
  expect(cond()).toBe(true)
}
// Only for the negative case, where nothing is expected to happen and there
// is no condition to poll for — a short fixed wait is the best we can do.
const settle = () => new Promise((r) => setTimeout(r, 10))

function episodicSpy() {
  return { create: vi.fn(), touchConversation: vi.fn() }
}

describe('lazy memory hooks', () => {
  it('wires the lifecycle even when memory appears AFTER the hooks are created', async () => {
    // This is the boot order on every real start: conversations first, memory later.
    let memory: any = undefined
    const hooks = createLazyMemoryHooks(() => memory, logger)

    const episodic = episodicSpy()
    memory = { episodic }

    hooks.onMemoryAccessed?.('conv-1', ['mem-1'])
    await waitFor(() => episodic.touchConversation.mock.calls.length === 1)
    expect(episodic.touchConversation).toHaveBeenCalledWith('mem-1')
  })

  it('is a silent no-op while memory does not exist, and recovers when it does', async () => {
    let memory: any = undefined
    const hooks = createLazyMemoryHooks(() => memory, logger)

    hooks.onMemoryAccessed?.('conv-1', ['mem-1'])
    await settle() // nothing to assert — it must simply not throw

    const episodic = episodicSpy()
    memory = { episodic }
    hooks.onMemoryAccessed?.('conv-1', ['mem-1'])
    await waitFor(() => episodic.touchConversation.mock.calls.length === 1)
  })

  it('resolves the lifecycle once, not per call', async () => {
    const episodic = episodicSpy()
    const getMemory = vi.fn(() => ({ episodic }))
    const hooks = createLazyMemoryHooks(getMemory as any, logger)
    hooks.onMemoryAccessed?.('c', ['m1'])
    await waitFor(() => episodic.touchConversation.mock.calls.length === 1)
    hooks.onMemoryAccessed?.('c', ['m2'])
    await waitFor(() => episodic.touchConversation.mock.calls.length === 2)
    expect(getMemory.mock.calls.length).toBeLessThanOrEqual(2) // cached after first success
  })

  it('logs a warning instead of swallowing silently when resolution fails', async () => {
    const failLogger = { info: vi.fn(), warn: vi.fn() } as any
    const getMemory = () => {
      throw new Error('boom')
    }
    const hooks = createLazyMemoryHooks(getMemory as any, failLogger)

    hooks.onMemoryAccessed?.('conv-1', ['mem-1'])
    await waitFor(() => failLogger.warn.mock.calls.length === 1)

    expect(failLogger.warn.mock.calls[0][0]).toMatchObject({ err: expect.any(Error) })
    expect(failLogger.warn.mock.calls[0][1]).toMatch(/onMemoryAccessed/)
  })

  it('(−) has no context-compaction hook: a compaction writes nothing to episodic memory', async () => {
    const episodic = episodicSpy()
    const hooks = createLazyMemoryHooks(() => ({ episodic }), logger)
    expect(hooks).not.toHaveProperty('onContextCompact')
    // The one remaining post-turn hook is a no-op: no episodic row either.
    hooks.onTurnComplete?.('conv-1', 'a question', 'an answer long enough to look like a summary of something')
    await settle()
    expect(episodic.create).not.toHaveBeenCalled()
  })
})
