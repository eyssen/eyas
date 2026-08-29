// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { applyLevel, mergeSections } from '../../../src/modules/prompt-wizard/section-merger.js'
import type { MergeInput } from '../../../src/modules/prompt-wizard/section-merger.js'

describe('applyLevel', () => {
  it('empty child inherits parent', () => {
    expect(applyLevel('parent text', undefined)).toBe('parent text')
    expect(applyLevel('parent text', '')).toBe('parent text')
    expect(applyLevel('parent text', '   ')).toBe('parent text')
  })

  it('non-empty child replaces parent', () => {
    expect(applyLevel('parent text', 'child text')).toBe('child text')
  })

  it('"+" prefix extends parent', () => {
    expect(applyLevel('parent text', '+ extra rules')).toBe('parent text\nextra rules')
  })

  it('"+" on empty parent returns extension only', () => {
    expect(applyLevel('', '+ extra rules')).toBe('extra rules')
  })

  it('trims whitespace', () => {
    expect(applyLevel('  parent  ', '  child  ')).toBe('child')
    expect(applyLevel('  parent  ', '  + extra  ')).toBe('parent\nextra')
  })
})

describe('mergeSections', () => {
  const baseMaster = {
    identity: 'I am EYAS',
    coreRules: 'Be helpful',
    personality: 'Friendly',
  }

  const emptyLevel = {}

  function makeInput(overrides: Partial<MergeInput> = {}): MergeInput {
    return {
      master: baseMaster,
      projectType: emptyLevel,
      project: emptyLevel,
      conversation: emptyLevel,
      lockedSections: [],
      ...overrides,
    }
  }

  it('passes through master when all levels are empty', () => {
    const result = mergeSections(makeInput())
    expect(result.identity).toBe('I am EYAS')
    expect(result.coreRules).toBe('Be helpful')
    expect(result.personality).toBe('Friendly')
    expect(result.resolvedFrom.identity).toBe('master')
    expect(result.resolvedFrom.coreRules).toBe('master')
    expect(result.resolvedFrom.personality).toBe('master')
  })

  it('locked sections cannot be overridden', () => {
    const result = mergeSections(makeInput({
      lockedSections: ['identity', 'coreRules'],
      projectType: { identity: 'Override attempt', coreRules: 'Bad rules' },
      project: { identity: 'Another attempt' },
    }))
    expect(result.identity).toBe('I am EYAS')
    expect(result.coreRules).toBe('Be helpful')
    expect(result.resolvedFrom.identity).toBe('master')
    expect(result.resolvedFrom.coreRules).toBe('master')
  })

  it('personality is overridable — lowest non-empty wins', () => {
    const result = mergeSections(makeInput({
      projectType: { personality: 'Formal' },
      project: { personality: 'Casual' },
    }))
    expect(result.personality).toBe('Casual')
    expect(result.resolvedFrom.personality).toBe('project')
  })

  it('personality from project_type wins when project is empty', () => {
    const result = mergeSections(makeInput({
      projectType: { personality: 'Formal' },
    }))
    expect(result.personality).toBe('Formal')
    expect(result.resolvedFrom.personality).toBe('project_type')
  })

  it('domainContext comes from projectType', () => {
    const result = mergeSections(makeInput({
      projectType: { domainContext: 'E-commerce domain' },
      project: { domainContext: 'Should be ignored for domain' },
    }))
    expect(result.domainContext).toBe('E-commerce domain')
    expect(result.resolvedFrom.domainContext).toBe('project_type')
  })

  it('projectContext comes from project', () => {
    const result = mergeSections(makeInput({
      projectType: { projectContext: 'Should be ignored' },
      project: { projectContext: 'Project Alpha context' },
    }))
    expect(result.projectContext).toBe('Project Alpha context')
    expect(result.resolvedFrom.projectContext).toBe('project')
  })

  it('taskInstructions comes from conversation', () => {
    const result = mergeSections(makeInput({
      project: { taskInstructions: 'Should be ignored' },
      conversation: { taskInstructions: 'Fix the login bug' },
    }))
    expect(result.taskInstructions).toBe('Fix the login bug')
    expect(result.resolvedFrom.taskInstructions).toBe('conversation')
  })

  it('resolvedFrom is null when section has no value', () => {
    const result = mergeSections(makeInput())
    expect(result.domainContext).toBeUndefined()
    expect(result.resolvedFrom.domainContext).toBeNull()
    expect(result.projectContext).toBeUndefined()
    expect(result.resolvedFrom.projectContext).toBeNull()
    expect(result.taskInstructions).toBeUndefined()
    expect(result.resolvedFrom.taskInstructions).toBeNull()
  })

  it('identity and coreRules cascade through levels via applyLevel', () => {
    const result = mergeSections(makeInput({
      projectType: { identity: '+ as a sales assistant' },
      project: { coreRules: '+ Always use metric units' },
    }))
    expect(result.identity).toBe('I am EYAS\nas a sales assistant')
    expect(result.coreRules).toBe('Be helpful\nAlways use metric units')
    expect(result.resolvedFrom.identity).toBe('project_type')
    expect(result.resolvedFrom.coreRules).toBe('project')
  })

  it('locked personality stays at master level', () => {
    const result = mergeSections(makeInput({
      lockedSections: ['personality'],
      projectType: { personality: 'Formal' },
      project: { personality: 'Casual' },
    }))
    expect(result.personality).toBe('Friendly')
    expect(result.resolvedFrom.personality).toBe('master')
  })
})
