// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D5 — renderForModel: the executor's one model-facing serialisation for the
// transports outside the model gateway (Claude Code's MCP bridge, the
// Grok/Kimi ACP bridge, external MCP). A memory-bearing tool's text is masked
// by the privacy policy (remote); every other tool's text is exactly
// JSON.stringify of its output, as before.

import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createToolExecutor, MEMORY_RESULT_WITHHELD, type ModelOutputRedactor } from '@modules/tools/tool-executor'
import { createToolRegistry } from '@modules/tools/tool-registry'
import type { ToolImplementation } from '@modules/tools/types'
import type { ToolOutputContext } from '@modules/privacy/service'
import { createPrivacyFixture, type PrivacyFixture } from '../../helpers/privacy-service'

const EMAIL = 'billing@example.com'
const IBAN = 'HU42 1177 3016 1111 1018 0000 0000'
const CTX: ToolOutputContext = { transport: 'mcp-bridge', conversationId: 'conv-1', runId: 'run-1', agentId: 'agent-1', turnId: 'turn-1' }

function tool(name: string, overrides: Partial<ToolImplementation> = {}): ToolImplementation {
  return {
    name,
    description: name,
    category: 'memory',
    riskTier: 'green',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({}),
    ...overrides,
  }
}

function executor(opts: {
  redact?: ModelOutputRedactor
  getRedactor?: () => ModelOutputRedactor | undefined
  logger?: { error: Mock }
} = {}) {
  const registry = createToolRegistry()
  registry.register(tool('memory_search', { memoryBearing: true }))
  registry.register(tool('read_file', { category: 'documents' }))
  const getModelOutputRedactor = opts.getRedactor ?? (opts.redact ? () => opts.redact : undefined)
  return createToolExecutor(registry, {
    authorization: 'disabled',
    ...(getModelOutputRedactor ? { getModelOutputRedactor } : {}),
    ...(opts.logger ? { logger: opts.logger } : {}),
  })
}

let fx: PrivacyFixture | undefined
afterEach(() => {
  fx?.cleanup()
  fx = undefined
})

describe('renderForModel', () => {
  const MEMORY = { hits: [{ id: 'vt:1', text: `2026-09-08 invoice contact ${EMAIL}, account ${IBAN}`, score: 0.5 }], total: 1 }

  it('(+) memory-bearing output has its JSON string leaves masked; keys, numbers and the date intact', () => {
    fx = createPrivacyFixture({})
    const out = executor({ redact: fx.service.redactToolOutput }).renderForModel('memory_search', { success: true, output: MEMORY }, CTX)
    expect(out.isError).toBe(false)
    expect(JSON.parse(out.text)).toEqual({
      hits: [{ id: 'vt:1', text: '2026-09-08 invoice contact [EMAIL], account [IBAN]', score: 0.5 }],
      total: 1,
    })
    expect(out.text).not.toContain(EMAIL)
  })

  it('(+) the redactor gets the tool name, the output and the caller\'s context', () => {
    const redact = vi.fn((_n: string, output: unknown) => ({ value: output }))
    executor({ redact }).renderForModel('memory_search', { success: true, output: MEMORY }, CTX)
    expect(redact).toHaveBeenCalledWith('memory_search', MEMORY, CTX)
  })

  it('(+) a memory tool\'s error text is masked too (the gateway masks it the same way)', () => {
    fx = createPrivacyFixture({})
    const out = executor({ redact: fx.service.redactToolOutput }).renderForModel('memory_search', { success: false, error: `no note for ${EMAIL}` }, CTX)
    expect(out).toEqual({ text: 'Error: no note for [EMAIL]', isError: true })
  })

  it('(−) non-memory output is byte-identical to JSON.stringify (regression)', () => {
    fx = createPrivacyFixture({})
    const output = { path: '/w/a.txt', content: `pay ${IBAN} via ${EMAIL}`, nested: { n: 1, list: ['x', EMAIL] } }
    const redact = vi.fn(fx.service.redactToolOutput)
    const out = executor({ redact }).renderForModel('read_file', { success: true, output }, CTX)
    expect(out).toEqual({ text: JSON.stringify(output), isError: false })
    expect(redact).not.toHaveBeenCalled()
  })

  it('(−) an unknown tool is not treated as memory-bearing', () => {
    const redact = vi.fn((_n: string, output: unknown) => ({ value: output }))
    const out = executor({ redact }).renderForModel('no_such_tool', { success: false, error: 'Tool not found: no_such_tool' }, CTX)
    expect(out).toEqual({ text: 'Error: Tool not found: no_such_tool', isError: true })
    expect(redact).not.toHaveBeenCalled()
  })

  it('(−) a failure is "Error: …" with isError true', () => {
    const out = executor().renderForModel('read_file', { success: false, error: 'Tool call denied: security gate: blocked' }, CTX)
    expect(out).toEqual({ text: 'Error: Tool call denied: security gate: blocked', isError: true })
  })

  it('(−) an empty success is "{}"', () => {
    expect(executor().renderForModel('read_file', { success: true }, CTX)).toEqual({ text: '{}', isError: false })
  })

  it('(−) no redactor (privacy off) or a disabled policy leaves memory output raw', () => {
    expect(executor().renderForModel('memory_search', { success: true, output: MEMORY }, CTX).text).toBe(JSON.stringify(MEMORY))
    expect(executor({ getRedactor: () => undefined }).renderForModel('memory_search', { success: true, output: MEMORY }, CTX).text).toBe(JSON.stringify(MEMORY))
    fx = createPrivacyFixture({ enabled: false })
    expect(executor({ redact: fx.service.redactToolOutput }).renderForModel('memory_search', { success: true, output: MEMORY }, CTX).text).toBe(JSON.stringify(MEMORY))
  })

  it('(−) a redactor that throws withholds the memory result (fail closed) and logs no value', () => {
    const logger = { error: vi.fn() }
    const redact: ModelOutputRedactor = () => { throw new Error('policy store gone') }
    const out = executor({ redact, logger }).renderForModel('memory_search', { success: true, output: MEMORY }, CTX)
    expect(out).toEqual({ text: MEMORY_RESULT_WITHHELD, isError: true })
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(EMAIL)
    expect(logger.error.mock.calls[0][0]).toMatchObject({ tool: 'memory_search', transport: 'mcp-bridge', conversationId: 'conv-1' })
  })
})
