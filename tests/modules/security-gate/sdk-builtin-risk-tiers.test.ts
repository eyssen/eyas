// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The Claude Code provider routes SDK builtin tools (PascalCase names) through
// the same security gate as EYAS tools. Those names must be classified — an
// unclassified tool defaults to 'green' (allowed), which would let Claude's
// arbitrary-shell `Bash` run ungoverned. This locks the intended tiers.

import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG } from '@modules/security-gate/types.js'

describe('SDK builtin risk tiers (Claude Code path)', () => {
  it('classifies arbitrary shell (Bash) as red', () => {
    expect(DEFAULT_CONFIG.riskTiers.red).toContain('Bash')
  })

  it('classifies file mutation (Write/Edit/NotebookEdit) as yellow', () => {
    for (const t of ['Write', 'Edit', 'NotebookEdit']) {
      expect(DEFAULT_CONFIG.riskTiers.yellow).toContain(t)
    }
  })

  it('classifies read-only builtins (Read/Grep/Glob/Task) as green — explicit membership, not a default', () => {
    for (const t of ['Read', 'Grep', 'Glob', 'Task']) {
      expect(DEFAULT_CONFIG.riskTiers.green).toContain(t)
    }
  })

  it('classifies network-egress builtins (WebFetch/WebSearch) as yellow', () => {
    for (const t of ['WebFetch', 'WebSearch']) {
      expect(DEFAULT_CONFIG.riskTiers.yellow).toContain(t)
    }
  })
})
