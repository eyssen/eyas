// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import { createToolRegistry, type ToolRegistry } from '@modules/tools/tool-registry'
import { createToolExecutor } from '@modules/tools/tool-executor'
import type { ToolImplementation, ToolContext } from '@modules/tools/types'

/**
 * Phase-3M × tool-executor integration tests.
 *
 * Locks in the opt-in contract: tools without `aci` config keep the
 * pre-integration behaviour (full output stays verbatim), tools with
 * `aci.enabled` receive the formatted + meta-annotated output, and the
 * raw value is preserved under `_raw` for audit replay.
 */

function silentCtx(): ToolContext {
  const logger: any = {
    info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
    trace: () => {}, fatal: () => {}, child: () => logger,
  }
  return { conversationId: 'c1', userId: 'u1', logger }
}

const longLines = Array.from({ length: 500 }, (_, i) => `line-${i + 1}`).join('\n')

describe('Tool executor × ACI layer (Phase 3M integration)', () => {
  let registry: ToolRegistry
  beforeEach(() => {
    registry = createToolRegistry()
  })

  it('tools without aci config: output is unchanged', async () => {
    const tool: ToolImplementation = {
      name: 'read_log',
      description: 'read a log',
      category: 'custom',
      riskTier: 'green',
      inputSchema: { type: 'object', properties: {} },
      validator: z.object({}),
      async execute() {
        return { text: longLines }
      },
    }
    registry.register(tool)
    const executor = createToolExecutor(registry, { authorization: 'disabled' })
    const res = await executor.execute('read_log', {}, silentCtx())

    expect(res.success).toBe(true)
    expect(res.output?.text).toBe(longLines)
    expect(res.output?._raw).toBeUndefined()
    expect(res.output?._aci).toBeUndefined()
  })

  it('aci.enabled + long output: text is truncated, _raw preserves original, _aci reports strategy', async () => {
    const tool: ToolImplementation = {
      name: 'read_log',
      description: 'read a log',
      category: 'custom',
      riskTier: 'green',
      inputSchema: { type: 'object', properties: {} },
      validator: z.object({}),
      aci: {
        enabled: true,
        maxChars: 300,
        headLines: 3,
        tailLines: 2,
        followUpHint: 'search_logs --pattern=<needle>',
      },
      async execute() {
        return { text: longLines }
      },
    }
    registry.register(tool)
    const executor = createToolExecutor(registry, { authorization: 'disabled' })
    const res = await executor.execute('read_log', {}, silentCtx())

    expect(res.success).toBe(true)
    const out = res.output!
    expect(typeof out.text).toBe('string')
    expect((out.text as string).length).toBeLessThan(longLines.length)
    expect(out.text).toContain('lines truncated')
    expect(out.text).toContain('search_logs --pattern=<needle>')
    expect(out._raw).toBe(longLines)
    expect(out._aci).toMatchObject({ strategy: 'line-head-tail' })
    expect((out._aci as any).originalLines).toBe(500)
  })

  it('aci.enabled + short output: no truncation, _raw NOT added (nothing to preserve)', async () => {
    const tool: ToolImplementation = {
      name: 'small_read',
      description: 'read small output',
      category: 'custom',
      riskTier: 'green',
      inputSchema: { type: 'object', properties: {} },
      validator: z.object({}),
      aci: { enabled: true, maxChars: 1000 },
      async execute() {
        return { text: 'just a few chars' }
      },
    }
    registry.register(tool)
    const executor = createToolExecutor(registry, { authorization: 'disabled' })
    const res = await executor.execute('small_read', {}, silentCtx())

    expect(res.output?.text).toBe('just a few chars')
    expect(res.output?._raw).toBeUndefined()
    expect(res.output?._aci).toBeUndefined()
  })

  it('aci.field: formatter runs on a non-default field (e.g. "stdout")', async () => {
    const tool: ToolImplementation = {
      name: 'shell_run',
      description: 'shell',
      category: 'custom',
      riskTier: 'green',
      inputSchema: { type: 'object', properties: {} },
      validator: z.object({}),
      aci: { enabled: true, field: 'stdout', maxChars: 200 },
      async execute() {
        return { exitCode: 0, stdout: longLines, stderr: '' }
      },
    }
    registry.register(tool)
    const executor = createToolExecutor(registry, { authorization: 'disabled' })
    const res = await executor.execute('shell_run', {}, silentCtx())

    expect(res.output?.exitCode).toBe(0)
    expect(typeof res.output?.stdout).toBe('string')
    // Assert on ACI metadata rather than length — the JSON-encoded payload
    // size on the wire can differ from the raw string length for subtle
    // reasons (newline escaping, surrounding fields). The _aci meta is the
    // authoritative signal that truncation happened and on which strategy.
    expect(res.output?._aci).toMatchObject({ strategy: 'line-head-tail' })
    expect(res.output?.stderr).toBe('') // sibling field untouched
    expect(res.output?._raw).toBe(longLines)
  })

  it('aci.structured: JSON output takes the json-head strategy', async () => {
    const jsonOut = '[' + Array.from({ length: 500 }, (_, i) => `{"id":${i},"v":"x"}`).join(',') + ']'
    const tool: ToolImplementation = {
      name: 'json_query',
      description: 'json',
      category: 'custom',
      riskTier: 'green',
      inputSchema: { type: 'object', properties: {} },
      validator: z.object({}),
      aci: { enabled: true, structured: true, maxChars: 400 },
      async execute() {
        return { text: jsonOut }
      },
    }
    registry.register(tool)
    const executor = createToolExecutor(registry, { authorization: 'disabled' })
    const res = await executor.execute('json_query', {}, silentCtx())

    expect(res.output?._aci).toMatchObject({ strategy: 'json-head' })
    expect(res.output?._raw).toBe(jsonOut)
  })

  it('aci is skipped when the output field is missing or not a string', async () => {
    const tool: ToolImplementation = {
      name: 'weird',
      description: 'no text field',
      category: 'custom',
      riskTier: 'green',
      inputSchema: { type: 'object', properties: {} },
      validator: z.object({}),
      aci: { enabled: true, field: 'text' },
      async execute() {
        return { other: 'value', count: 42 } // no `text` field
      },
    }
    registry.register(tool)
    const executor = createToolExecutor(registry, { authorization: 'disabled' })
    const res = await executor.execute('weird', {}, silentCtx())

    expect(res.success).toBe(true)
    expect(res.output?.other).toBe('value')
    expect(res.output?._raw).toBeUndefined()
    expect(res.output?._aci).toBeUndefined()
  })
})
