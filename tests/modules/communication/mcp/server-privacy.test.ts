// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D5 — an external MCP client is a remote destination. Its tools/call answer
// is written by the executor's renderForModel, so a memory-bearing tool's
// result is masked by the privacy policy exactly as on the CLI bridges, and a
// workspace tool's result is untouched.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { createMcpServer } from '@modules/communication/submodules/mcp-server/server'
import { createToolRegistry } from '@modules/tools/tool-registry'
import { createToolExecutor, type ModelOutputRedactor } from '@modules/tools/tool-executor'
import type { ToolImplementation } from '@modules/tools/types'
import { createPrivacyFixture, type PrivacyFixture } from '../../../helpers/privacy-service'

const silentLogger: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {} }
silentLogger.child = () => silentLogger

const EMAIL = 'billing@example.com'
const IBAN = 'HU42 1177 3016 1111 1018 0000 0000'
const HIT = { results: [{ id: 'gs:9', text: `2026-09-08 invoice contact ${EMAIL}, account ${IBAN}`, score: 0.7 }] }

function tool(name: string, category: ToolImplementation['category'], output: Record<string, unknown>, memoryBearing?: boolean): ToolImplementation {
  return {
    name,
    description: name,
    category,
    riskTier: 'green',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => output,
    ...(memoryBearing ? { memoryBearing: true } : {}),
  }
}

async function server(redact?: ModelOutputRedactor) {
  const registry = createToolRegistry()
  registry.register(tool('memory_search', 'memory', HIT, true))
  registry.register(tool('read_file', 'documents', { content: `pay ${IBAN} via ${EMAIL}` }))
  // The real executor (CASL gate off for this test) with the privacy redactor
  // wired exactly as the tools module wires it.
  const executor = createToolExecutor(registry, {
    authorization: 'disabled',
    ...(redact ? { getModelOutputRedactor: () => redact } : {}),
  })
  const app = new Hono()
  app.use('*', async (c, next) => {
    ;(c as any).set('ability', { can: () => true })
    ;(c as any).set('role', 'admin')
    ;(c as any).set('userId', 'operator-1')
    await next()
  })
  const mcp = createMcpServer({ toolRegistry: registry, toolExecutor: executor, logger: silentLogger, http: app as any })
  await mcp.connect()
  return async (name: string) => {
    const res = await app.request('/api/v1/mcp/tools/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 1, params: { name, arguments: { query: 'invoice' } } }),
    })
    return (await res.json()) as { result: { content: Array<{ text: string }>; isError?: boolean } }
  }
}

let fx: PrivacyFixture | undefined
afterEach(() => {
  fx?.cleanup()
  fx = undefined
})

describe('external MCP server — memory masking', () => {
  it('(+) an external memory_search result is masked, date and structure intact', async () => {
    fx = createPrivacyFixture({})
    const call = await server(fx.service.redactToolOutput)
    const body = await call('memory_search')
    expect(body.result.isError).toBeUndefined()
    expect(body.result.content[0].text).not.toContain(IBAN)
    expect(JSON.parse(body.result.content[0].text)).toEqual({
      results: [{ id: 'gs:9', text: '2026-09-08 invoice contact [EMAIL], account [IBAN]', score: 0.7 }],
    })
  })

  it('(+) the digest names the mcp-external transport and carries no conversation', async () => {
    fx = createPrivacyFixture({})
    const redact = vi.fn(fx.service.redactToolOutput)
    await (await server(redact))('memory_search')
    expect(redact.mock.calls[0][2]).toEqual({ transport: 'mcp-external' })
    expect(redact.mock.results[0].value.digest).toMatchObject({ transport: 'mcp-external', toolName: 'memory_search', byType: { email: 1, iban: 1 } })
  })

  it('(−) a workspace tool (read_file) goes out byte-identical', async () => {
    fx = createPrivacyFixture({})
    const body = await (await server(fx.service.redactToolOutput))('read_file')
    expect(body.result.content[0].text).toBe(JSON.stringify({ content: `pay ${IBAN} via ${EMAIL}` }))
  })

  it('(−) without the privacy module the memory result goes out raw', async () => {
    const body = await (await server())('memory_search')
    expect(body.result.content[0].text).toBe(JSON.stringify(HIT))
  })
})
