import { describe, it, expect, beforeEach } from 'vitest'
import { createDatabase } from '@core/db/connection'
import { createMemoryBlockService } from '@modules/memory/blocks/memory-blocks'

describe('F4 memory blocks', () => {
  let blocks: ReturnType<typeof createMemoryBlockService>

  beforeEach(() => {
    const db = createDatabase(':memory:')
    blocks = createMemoryBlockService(db)
    blocks.ensureTables()
  })

  it('upserts and reads company blocks', () => {
    blocks.upsert({ scope: 'company', scopeId: 'default', key: 'policies', content: 'No auto-send money emails' })
    const b = blocks.get('company', 'default', 'policies')
    expect(b?.content).toContain('money')
    expect(b?.version).toBe(1)
  })

  it('appends and bumps version', () => {
    blocks.upsert({ scope: 'agent', scopeId: 'a1', key: 'notes', content: 'line1' })
    blocks.append({ scope: 'agent', scopeId: 'a1', key: 'notes', content: 'line2' })
    const b = blocks.get('agent', 'a1', 'notes')
    expect(b?.content).toContain('line1')
    expect(b?.content).toContain('line2')
    expect(b?.version).toBe(2)
  })

  it('formats for prompt with budget', () => {
    blocks.upsert({ scope: 'team', scopeId: 't1', key: 'goal', content: 'Ship F4' })
    const text = blocks.formatForPrompt('team', 't1')
    expect(text).toContain('Ship F4')
    expect(text).toContain('goal')
  })
})
