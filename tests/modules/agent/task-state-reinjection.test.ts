// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// When an agent run is resumed or its session refreshed, the model loses the
// prior context. buildTaskStateReinjection produces a compact, bounded reminder
// that re-states the goal and — critically — tells the model NOT to repeat
// tool calls it already executed or resend messages it already delivered, so a
// resume cannot double-execute side effects.

import { describe, it, expect } from 'vitest'
import { buildTaskStateReinjection } from '@modules/agent/task-state-reinjection.js'

describe('buildTaskStateReinjection', () => {
  it('restates the goal', () => {
    const out = buildTaskStateReinjection({ goal: 'Ship the release' })
    expect(out).toContain('Ship the release')
  })

  it('lists completed steps and the open sub-task', () => {
    const out = buildTaskStateReinjection({
      goal: 'G',
      completedSteps: ['cloned repo', 'ran tests'],
      openSubTask: 'write changelog',
    })
    expect(out).toContain('cloned repo')
    expect(out).toContain('ran tests')
    expect(out).toContain('write changelog')
  })

  it('emits a do-not-repeat section for already-executed tool calls', () => {
    const out = buildTaskStateReinjection({
      goal: 'G',
      doneToolCalls: [
        { tool: 'run_command', argHash: 'abc123' },
        { tool: 'write_file', argHash: 'def456' },
      ],
    })
    expect(out.toLowerCase()).toContain('do not repeat')
    expect(out).toContain('run_command')
    expect(out).toContain('abc123')
    expect(out).toContain('write_file')
  })

  it('emits a do-not-resend section for already-delivered messages', () => {
    const out = buildTaskStateReinjection({ goal: 'G', sentMessageIds: ['m1', 'm2'] })
    expect(out.toLowerCase()).toContain('do not resend')
    expect(out).toContain('m1')
    expect(out).toContain('m2')
  })

  it('omits empty sections', () => {
    const out = buildTaskStateReinjection({ goal: 'G' })
    expect(out.toLowerCase()).not.toContain('do not repeat')
    expect(out.toLowerCase()).not.toContain('do not resend')
  })

  it('returns an empty string when there is no goal and nothing to restate', () => {
    expect(buildTaskStateReinjection({ goal: '' })).toBe('')
  })

  it('bounds the output to maxChars with a truncation marker', () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({ tool: 'x', argHash: `hash-${i}` }))
    const out = buildTaskStateReinjection({ goal: 'G', doneToolCalls: many }, { maxChars: 2000 })
    expect(out.length).toBeLessThanOrEqual(2000)
    expect(out.toLowerCase()).toContain('truncated')
  })
})
