import { describe, expect, it } from 'vitest'
import { parseFrontmatter, stripFrontmatter, injectFrontmatter } from '../../../src/modules/prompt-wizard/frontmatter.js'

describe('frontmatter', () => {
  const sample = `---
schema: eyas.workspace.v1
agentId: jarvis-uuid
generatedAt: 2026-04-26T14:00:00Z
---

# IDENTITY

Body content here.
`

  it('parses frontmatter into object', () => {
    const fm = parseFrontmatter(sample)
    expect(fm).toMatchObject({
      schema: 'eyas.workspace.v1',
      agentId: 'jarvis-uuid',
      generatedAt: '2026-04-26T14:00:00Z',
    })
  })

  it('strips frontmatter from content', () => {
    expect(stripFrontmatter(sample)).toBe('# IDENTITY\n\nBody content here.\n')
  })

  it('returns null on missing frontmatter', () => {
    expect(parseFrontmatter('# Plain markdown\n')).toBeNull()
    expect(stripFrontmatter('# Plain markdown\n')).toBe('# Plain markdown\n')
  })

  it('injects frontmatter into plain body', () => {
    const out = injectFrontmatter('# IDENTITY\n', {
      schema: 'eyas.workspace.v1',
      agentId: 'jarvis-uuid',
      generatedAt: '2026-04-26T14:00:00Z',
    })
    expect(out).toContain('---\nschema: eyas.workspace.v1\n')
    expect(out).toContain('# IDENTITY')
  })

  it('replaces existing frontmatter on inject', () => {
    const out = injectFrontmatter(sample, { schema: 'eyas.workspace.v1', agentId: 'jarvis-uuid', generatedAt: '2026-05-01T00:00:00Z' })
    expect(out).toContain('2026-05-01T00:00:00Z')
    expect(out).not.toContain('2026-04-26T14:00:00Z')
    expect(out).toContain('# IDENTITY')
  })
})
