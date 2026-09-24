// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// pickEffortIntent: conversation > deep > agent > inherited (first parent).

import { describe, it, expect } from 'vitest'
import { pickEffortIntent } from '@modules/model/reasoning/intent.js'

describe('pickEffortIntent — precedence', () => {
  it('the conversation\'s own level beats Deep, the agent and every parent', () => {
    expect(pickEffortIntent([
      { effort: 'low', orchestration: 'deep', agentEffort: 'high' },
      { effort: 'max' },
    ])).toEqual({ level: 'low', source: 'conversation' })
  })

  it('a Deep conversation without its own level → max, source deep (beats the agent)', () => {
    expect(pickEffortIntent([{ effort: null, orchestration: 'deep', agentEffort: 'low' }]))
      .toEqual({ level: 'max', source: 'deep' })
  })

  it('the agent\'s level applies when the conversation sets none and is not Deep', () => {
    expect(pickEffortIntent([{ effort: null, orchestration: 'auto', agentEffort: 'high' }, { effort: 'max' }]))
      .toEqual({ level: 'high', source: 'agent' })
  })

  it('otherwise the nearest parent that resolves a level is inherited', () => {
    expect(pickEffortIntent([{ effort: null }, { effort: null }, { effort: 'xhigh' }, { effort: 'low' }]))
      .toEqual({ level: 'xhigh', source: 'inherited' })
  })

  it('a parent\'s Deep and a parent\'s agent level are inherited the same way', () => {
    expect(pickEffortIntent([{}, { orchestration: 'deep' }])).toEqual({ level: 'max', source: 'inherited' })
    expect(pickEffortIntent([{}, { agentEffort: 'medium' }])).toEqual({ level: 'medium', source: 'inherited' })
  })

  it('a parent\'s explicit level is inherited only when the child has no agent effort of its own', () => {
    expect(pickEffortIntent([{ agentEffort: 'low' }, { effort: 'xhigh' }])).toEqual({ level: 'low', source: 'agent' })
    expect(pickEffortIntent([{ agentEffort: null }, { effort: 'xhigh' }])).toEqual({ level: 'xhigh', source: 'inherited' })
  })
})

describe('pickEffortIntent — untrusted values', () => {
  it('invalid strings are skipped, never guessed into a level', () => {
    expect(pickEffortIntent([{ effort: 'turbo', agentEffort: 'ultra' }, { effort: 'MAX ' }, { effort: 'high' }]))
      .toEqual({ level: 'high', source: 'inherited' })
    expect(pickEffortIntent([{ effort: 42, agentEffort: { level: 'max' } }])).toBeUndefined()
  })

  it("'auto' means \"not set here\" and falls through the chain", () => {
    expect(pickEffortIntent([{ effort: 'auto', agentEffort: 'auto' }, { effort: 'low' }])).toEqual({ level: 'low', source: 'inherited' })
  })

  it('an orchestration other than deep adds nothing', () => {
    expect(pickEffortIntent([{ orchestration: 'solo' }, { orchestration: 'auto' }])).toBeUndefined()
  })

  it('an empty chain, or one with nothing set, → undefined', () => {
    expect(pickEffortIntent([])).toBeUndefined()
    expect(pickEffortIntent([{}, null, undefined, { effort: null }])).toBeUndefined()
  })

  it('a missing self link still lets a parent be inherited', () => {
    expect(pickEffortIntent([null, { effort: 'minimal' }])).toEqual({ level: 'minimal', source: 'inherited' })
  })
})
