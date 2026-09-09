// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import type { ToolContext } from '@modules/tools/types'

/**
 * Type-level guard. `projectId` is what lets a tool resolve the active brand
 * without a conversation round-trip; if the field is dropped from ToolContext
 * this file stops compiling under `bun run lint`.
 */
const logger = { warn() {}, info() {}, error() {}, debug() {} } as any

describe('ToolContext', () => {
  it('carries an optional projectId', () => {
    const ctx: ToolContext = { conversationId: 'c1', userId: 'u1', projectId: 'p1', logger }
    expect(ctx.projectId).toBe('p1')
  })

  it('permits a null projectId for conversations with no project', () => {
    const ctx: ToolContext = { conversationId: 'c1', userId: 'u1', projectId: null, logger }
    expect(ctx.projectId).toBeNull()
  })

  it('permits omitting projectId entirely', () => {
    const ctx: ToolContext = { conversationId: 'c1', userId: 'u1', logger }
    expect(ctx.projectId).toBeUndefined()
  })
})
