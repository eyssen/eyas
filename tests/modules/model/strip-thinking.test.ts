// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { stripThinkingBlocks } from '@modules/model/helpers'
import type { ModelMessage, ThinkingBlock } from '@modules/model/types'

const thinking: ThinkingBlock = {
  type: 'thinking', thinking: 'why', signature: 'sig', origin: 'anthropic', providerId: 'anthropic', modelId: 'm',
}

describe('stripThinkingBlocks', () => {
  it('removes thinking blocks and drops a message left empty (positive)', () => {
    const out = stripThinkingBlocks([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [thinking, { type: 'tool_use', id: 't', name: 'fn', input: {} }] },
      { role: 'assistant', content: [thinking] },
    ])
    expect(out).toEqual([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'fn', input: {} }] },
    ])
  })

  it('does not mutate its input (positive)', () => {
    const msgs: ModelMessage[] = [{ role: 'assistant', content: [thinking, { type: 'text', text: 'a' }] }]
    stripThinkingBlocks(msgs)
    expect((msgs[0]!.content as unknown[]).length).toBe(2)
  })

  it('returns the same array when there is nothing to strip, empty messages included (negative)', () => {
    const msgs: ModelMessage[] = [
      { role: 'user', content: '' },
      { role: 'assistant', content: [] },
      { role: 'assistant', content: [{ type: 'text', text: 'a' }] },
    ]
    expect(stripThinkingBlocks(msgs)).toBe(msgs)
  })
})
