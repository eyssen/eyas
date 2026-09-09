// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { formatMemoryForPrompt, queryEyasMemory } from '@modules/opencode/memory-bridge'

describe('opencode memory bridge', () => {
  it('returns not-ready without a service', async () => {
    const r = await queryEyasMemory(undefined, { query: 'x' })
    expect('error' in r).toBe(true)
  })

  it('queries wrapped retrieve', async () => {
    const r = await queryEyasMemory({
      retrieve: async () => [{
        id: 'gs:1', source: 'gist', text: 'deadline is Friday', score: 0.9,
        trust: 'owner', importance: 1, createdAt: 0,
      }],
    }, { query: 'deadline' })
    expect('error' in r).toBe(false)
    if ('note' in r) {
      expect(r.results[0]?.id).toBe('gs:1')
      expect(r.note).toMatch(/Quoted/)
    }
  })

  it('formats quoted lines for the prompt', () => {
    const text = formatMemoryForPrompt([{ id: 'gs:1', source: 'gist', content: 'keep secrets in keychain', score: 1 }])
    expect(text).toContain('gs:1')
    expect(text).toContain('quoted')
  })
})
