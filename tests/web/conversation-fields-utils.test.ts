import { describe, it, expect } from 'vitest'
import {
  resolveEffortValue,
  effortUpdate,
} from '../../src/web/src/pages/conversations/conversation-fields-utils'

describe('resolveEffortValue', () => {
  it('prefers the stored effort column over the legacy thinking fields', () => {
    expect(resolveEffortValue('max', 'off', 5000)).toBe('max')
    expect(resolveEffortValue('low', 'on', 100000)).toBe('low')
  })

  it('falls back to the thinking budget for conversations without an effort', () => {
    expect(resolveEffortValue(null, 'on', 5000)).toBe('low')
    expect(resolveEffortValue(null, 'on', 10000)).toBe('medium')
    expect(resolveEffortValue(null, 'on', 25000)).toBe('high')
    expect(resolveEffortValue(null, 'on', 100000)).toBe('max')
  })

  it('treats a missing budget as medium and thinking-off as off', () => {
    expect(resolveEffortValue(null, 'on', null)).toBe('medium')
    expect(resolveEffortValue(null, 'off', 100000)).toBe('off')
  })
})

describe('effortUpdate', () => {
  it('writes effort, the thinking flag and the matching budget preset', () => {
    expect(effortUpdate('high')).toEqual({ effort: 'high', thinking: 'on', thinkingBudget: 25000 })
  })

  it('clears every reasoning field when switched off', () => {
    expect(effortUpdate('off')).toEqual({ effort: null, thinking: 'off', thinkingBudget: null })
  })
})
