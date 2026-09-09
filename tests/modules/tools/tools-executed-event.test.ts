// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createToolRegistry, type ToolRegistry } from '@modules/tools/tool-registry'
import { createToolExecutor } from '@modules/tools/tool-executor'
import type { ToolImplementation, ToolContext } from '@modules/tools/types'

/**
 * Phase-3 (3B.1) — forge's feedback auto-scrape listens for `tools:executed`
 * on the bus, but nothing emitted it in production. These tests lock in
 * that the executor now emits it, in the exact shape forge's handler reads
 * (`src/modules/forge/index.ts`): `{ toolName, success, error?,
 * conversationId, agentId }`.
 */

function silentCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  const logger: any = {
    info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
    trace: () => {}, fatal: () => {}, child: () => logger,
  }
  return { conversationId: 'c1', userId: 'u1', agentId: 'a1', logger, ...overrides }
}

describe('Tool executor — tools:executed bus event (3B.1)', () => {
  let registry: ToolRegistry

  beforeEach(() => {
    registry = createToolRegistry()
  })

  it('emits tools:executed with success:true on a successful run', async () => {
    const tool: ToolImplementation = {
      name: 'echo',
      description: 'echo input',
      category: 'custom',
      riskTier: 'green',
      inputSchema: {},
      execute: async (i) => ({ echoed: i.text }),
    }
    registry.register(tool)
    const emit = vi.fn()
    const executor = createToolExecutor(registry, { bus: { emit }, authorization: 'disabled' })

    const result = await executor.execute('echo', { text: 'hi' }, silentCtx())

    expect(result.success).toBe(true)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('tools:executed', {
      toolName: 'echo',
      success: true,
      error: undefined,
      conversationId: 'c1',
      agentId: 'a1',
    })
  })

  it('emits tools:executed with success:false and the error on a thrown run', async () => {
    const tool: ToolImplementation = {
      name: 'boom',
      description: 'always throws',
      category: 'custom',
      riskTier: 'green',
      inputSchema: {},
      execute: async () => {
        throw new Error('kaboom')
      },
    }
    registry.register(tool)
    const emit = vi.fn()
    const executor = createToolExecutor(registry, { bus: { emit }, authorization: 'disabled' })

    const result = await executor.execute('boom', {}, silentCtx())

    expect(result.success).toBe(false)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('tools:executed', {
      toolName: 'boom',
      success: false,
      error: 'kaboom',
      conversationId: 'c1',
      agentId: 'a1',
    })
  })

  it('does not throw and leaves the tool result unaffected when no bus is configured', async () => {
    const tool: ToolImplementation = {
      name: 'echo',
      description: 'echo input',
      category: 'custom',
      riskTier: 'green',
      inputSchema: {},
      execute: async (i) => ({ echoed: i.text }),
    }
    registry.register(tool)
    const executor = createToolExecutor(registry, { authorization: 'disabled' }) // no bus option

    const result = await executor.execute('echo', { text: 'hi' }, silentCtx())

    expect(result.success).toBe(true)
    expect(result.output).toEqual({ echoed: 'hi' })
  })

  it('does not throw and does not affect the tool result when bus.emit itself throws', async () => {
    const tool: ToolImplementation = {
      name: 'echo',
      description: 'echo input',
      category: 'custom',
      riskTier: 'green',
      inputSchema: {},
      execute: async (i) => ({ echoed: i.text }),
    }
    registry.register(tool)
    const emit = vi.fn(() => { throw new Error('listener exploded') })
    const executor = createToolExecutor(registry, { bus: { emit }, authorization: 'disabled' })

    const result = await executor.execute('echo', { text: 'hi' }, silentCtx())

    expect(result.success).toBe(true)
    expect(result.output).toEqual({ echoed: 'hi' })
    expect(emit).toHaveBeenCalledTimes(1)
  })
})
