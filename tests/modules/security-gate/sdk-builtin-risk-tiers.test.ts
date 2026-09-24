// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The Claude Code provider routes SDK builtin tools (PascalCase names) through
// the same security gate as EYAS tools. Those names must be classified
// deliberately — an unclassified tool is treated as yellow and escalated, which
// would put every file read in front of the judge. This locks the intended
// tiers.

import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG } from '@modules/security-gate/types.js'
import { createDeterministicGate } from '@modules/security-gate/deterministic-gate.js'

describe('SDK builtin risk tiers (Claude Code path)', () => {
  it('classifies arbitrary shell (Bash) as red', () => {
    expect(DEFAULT_CONFIG.riskTiers.red).toContain('Bash')
  })

  it('classifies file mutation (Write/Edit/NotebookEdit) as yellow', () => {
    for (const t of ['Write', 'Edit', 'NotebookEdit']) {
      expect(DEFAULT_CONFIG.riskTiers.yellow).toContain(t)
    }
  })

  it('classifies read-only builtins (Read/Grep/Glob) as green — explicit membership, not a default', () => {
    for (const t of ['Read', 'Grep', 'Glob']) {
      expect(DEFAULT_CONFIG.riskTiers.green).toContain(t)
    }
  })

  it('leaves the SDK subagent spawner (Agent, alias Task) unclassified — it is never offered, so a stray call escalates', () => {
    const { red, yellow, green } = DEFAULT_CONFIG.riskTiers
    const gate = createDeterministicGate(DEFAULT_CONFIG)
    for (const t of ['Agent', 'Task']) {
      expect([...red, ...yellow, ...green]).not.toContain(t)
      const result = gate.check(t, { prompt: 'do it', description: 'x' })
      expect(result.decision).toBe('escalate')
      expect(result.reason).toContain('unclassified')
    }
  })

  it('classifies network-egress builtins (WebFetch/WebSearch) as yellow', () => {
    for (const t of ['WebFetch', 'WebSearch']) {
      expect(DEFAULT_CONFIG.riskTiers.yellow).toContain(t)
    }
  })
})
