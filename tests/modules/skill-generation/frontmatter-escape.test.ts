// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  renderFrontmatter,
  parseFrontmatter,
  SkillFrontmatterSchema,
} from '../../../src/modules/skill-generation/skill-generator.js'
import type { SkillFrontmatter } from '../../../src/modules/skill-generation/types.js'

function baseFrontmatter(): SkillFrontmatter {
  return {
    name: 'read-grep-write',
    description: 'Read a file, grep a pattern, write a result',
    whenToInvoke: ['find the X in file Y'],
    tools: ['read', 'grep', 'write'],
    license: 'MIT',
    version: '0.1.0',
  }
}

describe('renderFrontmatter — newline/control-char injection hardening', () => {
  it('does not let a newline in name inject a new frontmatter key', () => {
    const fm = baseFrontmatter()
    fm.name = 'foo\nlicense: GPL'
    const rendered = renderFrontmatter(fm)
    const parsed = parseFrontmatter(rendered) as Record<string, unknown>
    // The real license line must still say MIT — no injected/overridden key.
    expect(parsed.license).toBe('MIT')
    // The name value collapses to one physical line (no literal newline).
    expect((parsed.name as string).includes('\n')).toBe(false)
    const reValidated = SkillFrontmatterSchema.parse(parsed)
    expect(reValidated.license).toBe('MIT')
  })

  it('does not let a newline in description inject a new frontmatter key', () => {
    const fm = baseFrontmatter()
    fm.description = 'desc\nlicense: GPL\ntools:\n  - "evil"'
    const rendered = renderFrontmatter(fm)
    const parsed = parseFrontmatter(rendered) as Record<string, unknown>
    expect(parsed.license).toBe('MIT')
    expect(parsed.tools).toEqual(['read', 'grep', 'write'])
    expect((parsed.description as string).includes('\n')).toBe(false)
  })

  it('does not let a newline in a whenToInvoke element inject a new key', () => {
    const fm = baseFrontmatter()
    fm.whenToInvoke = ['trigger one\nlicense: GPL']
    const rendered = renderFrontmatter(fm)
    const parsed = parseFrontmatter(rendered) as Record<string, unknown>
    expect(parsed.license).toBe('MIT')
    const whenToInvoke = parsed.whenToInvoke as string[]
    expect(whenToInvoke.some((t) => t.includes('\n'))).toBe(false)
  })

  it('strips other C0 control chars (CR, tab) without touching quote escaping', () => {
    const fm = baseFrontmatter()
    fm.name = 'foo\r\tbar "baz"'
    const rendered = renderFrontmatter(fm)
    const parsed = parseFrontmatter(rendered) as Record<string, unknown>
    expect(parsed.name).not.toMatch(/[\r\t]/)
    expect(parsed.name).toContain('baz')
  })

  it('leaves single-line fields with quotes unchanged in behaviour', () => {
    const fm = baseFrontmatter()
    fm.description = 'Says "hi"'
    const rendered = renderFrontmatter(fm)
    expect(rendered).toContain('Says \\"hi\\"')
    const parsed = parseFrontmatter(rendered) as Record<string, unknown>
    expect(parsed.description).toBe('Says "hi"')
  })
})

describe('SkillFrontmatterSchema — rejects embedded newlines (defense in depth)', () => {
  it('rejects a multiline name', () => {
    const fm = { ...baseFrontmatter(), name: 'foo\nlicense: GPL' }
    expect(SkillFrontmatterSchema.safeParse(fm).success).toBe(false)
  })

  it('rejects a multiline description', () => {
    const fm = { ...baseFrontmatter(), description: 'foo\nlicense: GPL' }
    expect(SkillFrontmatterSchema.safeParse(fm).success).toBe(false)
  })

  it('rejects a multiline version', () => {
    const fm = { ...baseFrontmatter(), version: '0.1.0\nlicense: GPL' }
    expect(SkillFrontmatterSchema.safeParse(fm).success).toBe(false)
  })

  it('rejects a multiline whenToInvoke element', () => {
    const fm = { ...baseFrontmatter(), whenToInvoke: ['trigger\nlicense: GPL'] }
    expect(SkillFrontmatterSchema.safeParse(fm).success).toBe(false)
  })

  it('accepts well-formed single-line fields', () => {
    expect(SkillFrontmatterSchema.safeParse(baseFrontmatter()).success).toBe(true)
  })
})
