import { describe, expect, it } from 'vitest'
import {
  workspaceFrontmatterSchema,
  identityMdSchema,
  agentsMdSchema,
  soulMdSchema,
} from '../../../src/modules/prompt-wizard/workspace-schemas.js'

describe('workspace schemas', () => {
  it('validates good frontmatter', () => {
    expect(workspaceFrontmatterSchema.safeParse({
      schema: 'eyas.workspace.v1', agentId: 'jarvis', generatedAt: '2026-04-26T00:00:00Z',
    }).success).toBe(true)
  })

  it('rejects bad frontmatter (wrong schema literal)', () => {
    expect(workspaceFrontmatterSchema.safeParse({
      schema: 'wrong', agentId: 'x', generatedAt: '2026-04-26T00:00:00Z',
    }).success).toBe(false)
  })

  it('accepts well-formed IDENTITY.md', () => {
    const valid = '## Who I am\nx\n## My mission\ny\n## Ongoing proactive duties\n- z\n'
    expect(identityMdSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects IDENTITY.md missing required sections', () => {
    expect(identityMdSchema.safeParse('## Who I am\nx').success).toBe(false)
  })

  it('accepts free-form AGENTS.md', () => {
    expect(agentsMdSchema.safeParse('').success).toBe(true)
    expect(agentsMdSchema.safeParse('# anything').success).toBe(true)
  })

  it('requires both voice sections in SOUL.md', () => {
    expect(soulMdSchema.safeParse('## [Internal Voice]\n## [External Voice]').success).toBe(true)
    expect(soulMdSchema.safeParse('## [Internal Voice] only').success).toBe(false)
  })
})
