// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// captureRunEnd — the one run-end entry to the durable-fact pass. Every run
// path calls it; it hands the exchange to ctx.memoryCapture unchanged, and
// nothing about the capture can reach back into the run.

import { describe, it, expect, vi } from 'vitest'
import { captureRunEnd } from '@modules/memory/capture/run-end'
import type { CaptureInput } from '@modules/memory/capture/index'

const INPUT: CaptureInput = {
  conversationId: 'c1',
  projectId: 'p1',
  userMessage: 'Please always answer me in Hungarian, that is how I work.',
  assistantMessage: 'Rendben.',
  author: 'agent',
  entryPath: 'delegation',
}

describe('captureRunEnd', () => {
  it('hands the exchange to the capture unchanged, once', () => {
    const capture = vi.fn().mockResolvedValue(undefined)
    captureRunEnd(capture, INPUT)
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledWith(INPUT)
  })

  it('hands on a short instruction too: the capture\'s gate records that skip, not the caller', () => {
    const capture = vi.fn().mockResolvedValue(undefined)
    captureRunEnd(capture, { ...INPUT, userMessage: 'ok' })
    expect(capture).toHaveBeenCalledTimes(1)
  })

  it('does not call the capture when the run answered nothing (negative)', () => {
    const capture = vi.fn().mockResolvedValue(undefined)
    captureRunEnd(capture, { ...INPUT, assistantMessage: '' })
    captureRunEnd(capture, { ...INPUT, assistantMessage: '   \n' })
    expect(capture).not.toHaveBeenCalled()
  })

  it('is a no-op when no capture is wired (negative)', () => {
    expect(() => captureRunEnd(undefined, INPUT)).not.toThrow()
    expect(() => captureRunEnd(null, INPUT)).not.toThrow()
  })

  it('swallows a capture that throws synchronously', () => {
    const capture = vi.fn(() => { throw new Error('vault on fire') })
    expect(() => captureRunEnd(capture, INPUT)).not.toThrow()
  })

  it('swallows a capture that rejects (no unhandled rejection)', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      captureRunEnd(vi.fn().mockRejectedValue(new Error('model on fire')), INPUT)
      await new Promise((r) => setTimeout(r, 10))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('accepts a capture that returns nothing', () => {
    const capture = vi.fn(() => undefined)
    expect(() => captureRunEnd(capture, INPUT)).not.toThrow()
    expect(capture).toHaveBeenCalledTimes(1)
  })
})
