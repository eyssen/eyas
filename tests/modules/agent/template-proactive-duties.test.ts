// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it } from 'vitest'
import { ALL_TEMPLATES } from '../../../src/modules/agent/agent-templates.js'

describe('seed template proactive duties + self-improvement', () => {
  it('no template still ships the placeholder "(none — invoked on-demand" duty', () => {
    for (const t of ALL_TEMPLATES) {
      const id = t.workspaceSeed?.identityMd ?? ''
      expect(id, t.id).not.toContain('(none — invoked on-demand by parent agent)')
    }
  })
  it('every template with a workspace seed has a self-improvement line', () => {
    for (const t of ALL_TEMPLATES) {
      if (!t.workspaceSeed) continue
      expect(t.workspaceSeed.identityMd.toLowerCase(), t.id).toMatch(/what would make the next run|reflect|get better/)
    }
  })
})
