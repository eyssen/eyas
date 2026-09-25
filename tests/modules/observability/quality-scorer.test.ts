// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import * as scorer from '@modules/observability/quality-scorer'
import type { TraceCollector } from '@modules/observability/trace-collector'

describe('quality-scorer', () => {
  it('records user feedback on the trace', () => {
    const updateFeedback = vi.fn()
    scorer.recordUserFeedback('trace-1', 'bad', { updateFeedback } as unknown as TraceCollector)
    expect(updateFeedback).toHaveBeenCalledWith('trace-1', 'bad')
  })

  it('has no automatic model scorer (C12: it pinned a vendor model id and had no caller)', () => {
    expect(Object.keys(scorer)).toEqual(['recordUserFeedback'])
  })
})
