import { describe, it, expect } from 'vitest'
import {
  resolveEffortValue,
  effortUpdate,
  workspaceChipLabel,
  pinWorkspacePrimary,
  toNamedWorkingDirectories,
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

describe('named workspace pin', () => {
  it('labels the chip with the first workspace name and a +N suffix', () => {
    expect(workspaceChipLabel(null)).toEqual({ name: null, extra: 0 })
    expect(workspaceChipLabel([])).toEqual({ name: null, extra: 0 })
    expect(workspaceChipLabel(['/tmp/alpha'])).toEqual({ name: 'alpha', extra: 0 })
    expect(workspaceChipLabel([
      { name: 'alpha', path: '/tmp/alpha' },
      { name: 'bravo', path: '/tmp/bravo' },
    ])).toEqual({ name: 'alpha', extra: 1 })
  })

  it('pins a workspace as primary by moving it to the front', () => {
    const pinned = pinWorkspacePrimary(
      [
        { name: 'alpha', path: '/tmp/alpha' },
        { name: 'bravo', path: '/tmp/bravo' },
      ],
      '/tmp/bravo',
    )
    expect(pinned.map((e) => e.path)).toEqual(['/tmp/bravo', '/tmp/alpha'])
    expect(pinned[0].name).toBe('bravo')
  })

  it('normalizes mixed string and named entries', () => {
    expect(toNamedWorkingDirectories(['/tmp/alpha', { name: 'bravo', path: '/tmp/bravo' }])).toEqual([
      { name: 'alpha', path: '/tmp/alpha' },
      { name: 'bravo', path: '/tmp/bravo' },
    ])
  })
})
