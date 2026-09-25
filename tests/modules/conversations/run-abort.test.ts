// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  beginConversationRun,
  cancelConversationRun,
  endConversationRun,
  hasConversationRun,
  resetConversationRunsForTests,
} from '@modules/conversations/run-abort'

describe('conversation run abort registry', () => {
  beforeEach(() => {
    resetConversationRunsForTests()
  })

  it('aborting the returned signal stops the run', () => {
    const signal = beginConversationRun('alpha')
    expect(signal.aborted).toBe(false)
    expect(hasConversationRun('alpha')).toBe(true)

    expect(cancelConversationRun('alpha')).toBe(true)
    expect(signal.aborted).toBe(true)
    expect(hasConversationRun('alpha')).toBe(false)
  })

  it('returns false when nothing is running', () => {
    expect(cancelConversationRun('missing')).toBe(false)
  })

  it('a new begin aborts the previous controller for the same conversation', () => {
    const first = beginConversationRun('alpha')
    const second = beginConversationRun('alpha')
    expect(first.aborted).toBe(true)
    expect(second.aborted).toBe(false)
    expect(hasConversationRun('alpha')).toBe(true)
  })

  it('endConversationRun only clears the controller it owns', () => {
    const signal = beginConversationRun('alpha')
    const other = new AbortController().signal
    endConversationRun('alpha', other)
    expect(hasConversationRun('alpha')).toBe(true)
    endConversationRun('alpha', signal)
    expect(hasConversationRun('alpha')).toBe(false)
  })
})
