// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  isParallelRoutingTool,
  orderToolUsesForTurn,
  agentHasWriterTools,
} from '@modules/agent/parallel-routing'

describe('orderToolUsesForTurn', () => {
  it('leaves a mixed turn unchanged when there is only one routing tool', () => {
    const blocks = [
      { name: 'read_file' },
      { name: 'run_specialist' },
      { name: 'grep' },
    ]
    expect(orderToolUsesForTurn(blocks)).toEqual(blocks)
  })

  it('pulls two routing tools to the front and keeps the rest in order', () => {
    const blocks = [
      { name: 'read_file' },
      { name: 'run_specialist' },
      { name: 'grep' },
      { name: 'delegate_to_agent' },
    ]
    expect(orderToolUsesForTurn(blocks).map((b) => b.name)).toEqual([
      'run_specialist',
      'delegate_to_agent',
      'read_file',
      'grep',
    ])
  })
})

describe('isParallelRoutingTool', () => {
  it('matches both names of the specialist spawn', () => {
    expect(isParallelRoutingTool('run_specialist')).toBe(true)
    expect(isParallelRoutingTool('delegate_to_agent')).toBe(true)
    expect(isParallelRoutingTool('handoff_to_colleague')).toBe(false)
    expect(isParallelRoutingTool('read_file')).toBe(false)
  })
})

describe('agentHasWriterTools', () => {
  it('detects builder grants', () => {
    expect(agentHasWriterTools(['read_file', 'write_file'])).toBe(true)
    expect(agentHasWriterTools(['read_file', 'grep'])).toBe(false)
    expect(agentHasWriterTools(undefined)).toBe(false)
  })
})
