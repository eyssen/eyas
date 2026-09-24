// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D5 — PrivacyService.redactToolOutput: the remote-destination mask for a
// value an EYAS tool call carries out past the model gateway (CLI bridges,
// external MCP, OpenCode), plus a digest that never carries a value.

import { afterEach, describe, expect, it } from 'vitest'
import { createPrivacyFixture, type PrivacyFixture } from '../../helpers/privacy-service'

const EMAIL = 'billing@example.com'
const IBAN = 'HU42 1177 3016 1111 1018 0000 0000'
const CTX = { transport: 'mcp-bridge', conversationId: 'conv-1', runId: 'run-1', agentId: 'agent-1', turnId: 'turn-1' } as const

let fx: PrivacyFixture
afterEach(() => fx?.cleanup())

describe('PrivacyService.redactToolOutput', () => {
  it('(+) masks string leaves for a remote destination and returns a value-free digest', () => {
    fx = createPrivacyFixture({})
    const output = { hits: [{ id: 'gs:1', text: `2026-09-08 ${EMAIL} ${IBAN}`, score: 1 }] }
    const r = fx.service.redactToolOutput('memory_search', output, CTX)
    expect(r.value).toEqual({ hits: [{ id: 'gs:1', text: '2026-09-08 [EMAIL] [IBAN]', score: 1 }] })
    expect(r.digest).toMatchObject({
      transport: 'mcp-bridge',
      toolName: 'memory_search',
      conversationId: 'conv-1',
      runId: 'run-1',
      agentId: 'agent-1',
      turnId: 'turn-1',
      masked: 2,
      warned: 0,
      byType: { email: 1, iban: 1 },
      rulesetVersion: fx.service.rulesetVersion(),
    })
    expect(JSON.stringify(r.digest)).not.toContain(EMAIL)
    expect(JSON.stringify(r.digest)).not.toContain('HU42')
  })

  it('(+) is the same mask as redactValue(remote) and maskAtRest', () => {
    fx = createPrivacyFixture({})
    const text = `2026-09-08 invoice ${EMAIL}, ${IBAN}`
    expect(fx.service.redactToolOutput('memory_expand', text, CTX).value).toBe(fx.service.redactValue(text, { locality: 'remote' }).value)
    expect(fx.service.redactToolOutput('memory_expand', text, CTX).value).toBe(fx.service.maskAtRest(text))
  })

  it('(+) logs masked and warn-class detections with identity and types only', () => {
    fx = createPrivacyFixture({ actions: { email: 'warn', iban: 'block' } })
    fx.service.redactToolOutput('memory_search', `${EMAIL} ${IBAN}`, CTX)
    const warn = fx.logger.warn.mock.calls.find((c) => /warn-class values in a tool result/.test(String(c[1])))
    const info = fx.logger.info.mock.calls.find((c) => /masked values in a tool result/.test(String(c[1])))
    expect(warn?.[0]).toMatchObject({ toolName: 'memory_search', conversationId: 'conv-1', transport: 'mcp-bridge', byType: { email: 1, iban: 1 } })
    expect(info?.[0]).toMatchObject({ toolName: 'memory_search', masked: 1, warned: 1 })
    const logged = JSON.stringify([...fx.logger.warn.mock.calls, ...fx.logger.info.mock.calls])
    expect(logged).not.toContain(EMAIL)
    expect(logged).not.toContain('HU42')
  })

  it('(−) nothing detected: the same reference and no digest, nothing logged', () => {
    fx = createPrivacyFixture({})
    const output = { hits: [{ id: 'gs:2', text: 'Release on 2026-09-08 at 14:05, v1.2.3', score: 1 }] }
    fx.logger.info.mockClear()
    const r = fx.service.redactToolOutput('memory_search', output, CTX)
    expect(r.value).toBe(output)
    expect(r.digest).toBeNull()
    expect(fx.logger.info.mock.calls.filter((c) => /tool result/.test(String(c[1])))).toEqual([])
  })

  it('(−) a disabled policy masks nothing', () => {
    fx = createPrivacyFixture({ enabled: false })
    const output = { text: `${EMAIL} ${IBAN}` }
    const r = fx.service.redactToolOutput('memory_search', output, CTX)
    expect(r.value).toBe(output)
    expect(r.digest).toBeNull()
  })

  it('(−) the digest leaves out identity the caller did not give', () => {
    fx = createPrivacyFixture({})
    const r = fx.service.redactToolOutput('memory_search', EMAIL, { transport: 'mcp-external' })
    expect(r.digest).not.toHaveProperty('conversationId')
    expect(r.digest).not.toHaveProperty('runId')
    expect(r.digest?.transport).toBe('mcp-external')
  })
})
