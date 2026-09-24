import { describe, it, expect } from 'vitest'
import * as utils from '../../src/web/src/pages/conversations/conversation-fields-utils'
import {
  workspaceChipLabel,
  pinWorkspacePrimary,
  toNamedWorkingDirectories,
} from '../../src/web/src/pages/conversations/conversation-fields-utils'

// E5: the effort select is the shared EffortSelect (tests/web/effort-select.test.tsx);
// the static-list helpers are gone from the conversation field utils.
describe('conversation field utils — effort helpers removed', () => {
  it('no longer exports the static effort list helpers', () => {
    expect(utils).not.toHaveProperty('EFFORT_AUTO')
    expect(utils).not.toHaveProperty('resolveEffortValue')
    expect(utils).not.toHaveProperty('effortUpdate')
    expect(utils).not.toHaveProperty('EFFORT_BUDGETS')
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
