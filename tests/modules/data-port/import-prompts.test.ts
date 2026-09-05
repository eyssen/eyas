// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { buildClassifySystemPrompt } from '@modules/data-port/prompts/classify'
import { buildMemoryTransformSystemPrompt } from '@modules/data-port/prompts/transform-memory'

describe('data-port import prompts — messy trees', () => {
  it('tells the classifier the user may point at a home directory', () => {
    const p = buildClassifySystemPrompt()
    expect(p).toMatch(/home directory|too wide|entire machine/i)
    expect(p).toMatch(/MEMORY\.md/)
    expect(p).toMatch(/skip/i)
    expect(p).toMatch(/robots\.txt|user-guide|third-party/i)
    expect(p).toMatch(/claude-sessions|session transcript/i)
    expect(p).not.toMatch(/\buser\b.*default/i)
  })

  it('tells the memory normalizer never to promote undeclared notes to kind user', () => {
    const p = buildMemoryTransformSystemPrompt()
    expect(p).toMatch(/"kind"/)
    expect(p).toMatch(/reference/)
    expect(p).toMatch(/never.*user|not kind user|kind is not user/i)
    expect(p).toMatch(/index|MEMORY\.md|wikilink/i)
    expect(p).toMatch(/skip/i)
  })
})
