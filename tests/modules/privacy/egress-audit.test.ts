// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D7 — post-privacy attribution. Every model call (and every memory tool
// result sent past the gateway) that had a detection produces ONE aggregated
// 'eyas.privacy.egress' event with its conversation, run, composition,
// provider, sections and tools — never a value — which the audit module keeps
// as 'privacy.egress' with the conversation as its target. The per-match
// 'eyas.privacy.detected' event is gone. What the egress did per section is
// attached to the turn's composition for the context inspector.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createLocalBus } from '@core/bus/local-bus'
import { privacyModule } from '@modules/privacy/index'
import { auditModule } from '@modules/audit/index'
import { createModelGateway } from '@modules/model/gateway'
import { createEgressSlot } from '@modules/model/egress'
import { createContextTables } from '@modules/observability/context-schema'
import { createContextRecorder } from '@modules/observability/context-recorder'
import { egressEventOf, toolOutputEventOf } from '@modules/privacy/egress-audit'
import type { AIProvider, ModelRequest, ModelResponse, StreamEvent } from '@modules/model/types'
import type { ContextSection } from '@modules/prompt-wizard/types'
import { createMemoryDb } from '../../helpers/test-db'

const EMAIL = 'billing@example.com'
const IBAN = 'HU42 1177 3016 1111 1018 0000 0000'

const flush = () => new Promise((r) => setTimeout(r, 0))

function providerAt(id: string, host: string) {
  const received: ModelRequest[] = []
  const provider: AIProvider = {
    id,
    name: id,
    listModels: async () => [],
    egressHost: () => host,
    async complete(req): Promise<ModelResponse> {
      received.push(req)
      return { id: 'r', provider: id, model: 'm', content: [], stopReason: 'end', usage: { inputTokens: 0, outputTokens: 0 } }
    },
    async *stream(req): AsyncIterable<StreamEvent> {
      received.push(req)
    },
  }
  return { provider, received }
}

const MEMORY_TOOLS = new Set(['memory_search', 'memory_expand'])

function section(key: string, content: string, zone: ContextSection['zone'] = 'append'): ContextSection {
  return { zone, key, content, chars: content.length, estimatedTokens: 1, truncated: false, droppedChars: 0 }
}

const CORE_RULES = '<core-rules>\nBe brief.\n</core-rules>\n\n'
const MEMORY = `<memory-context>\n- invoice contact ${EMAIL}\n</memory-context>`

let started: { ctx: any } | null = null
afterEach(async () => {
  if (started) await privacyModule.onStop(started.ctx)
  started = null
})

async function start(opts: { audit?: boolean } = {}) {
  const egress = createEgressSlot()
  const gateway = createModelGateway(undefined, { egress })
  const remote = providerAt('remote', 'api.example-vendor.com')
  const local = providerAt('local', '127.0.0.1')
  gateway.registerProvider(remote.provider)
  gateway.registerProvider(local.provider)
  const db = createMemoryDb()
  createContextTables(db)
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }
  const recorder = createContextRecorder(db, logger)
  const bus = createLocalBus()
  const events: Array<{ subject: string; data: any }> = []
  bus.on('eyas.privacy.*', async (data, subject) => { events.push({ subject: subject ?? '', data }) })
  const ctx = {
    model: gateway,
    modelEgress: egress,
    http: new Hono(),
    bus,
    db,
    logger,
    contextRecorder: recorder,
    tools: { registry: { get: (name: string) => ({ memoryBearing: MEMORY_TOOLS.has(name) }) } },
  } as any
  await auditModule.onRegister(ctx)
  await auditModule.onStart(ctx)
  await privacyModule.onRegister(ctx)
  await privacyModule.onStart(ctx)
  if (opts.audit === false) ctx.privacy.update({ audit: false })
  started = { ctx }

  const compositionId = recorder.record({
    sections: [section('core-rules', CORE_RULES, 'prefix'), section('memory-context', MEMORY)],
    entryPoint: 'conversation',
    conversationId: 'conv-1',
  })!
  const request = (provider: string, over: Partial<ModelRequest> = {}): ModelRequest => ({
    provider,
    system: `${CORE_RULES.trimEnd()}\n\n${MEMORY}`,
    messages: [
      { role: 'user', content: 'what was the invoice contact?' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu-1', name: 'memory_search', input: { query: 'invoice' } }] },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 'tu-1', content: JSON.stringify({ hits: [{ id: 'gs:1', text: `IBAN ${IBAN}` }] }) }] },
    ],
    metadata: { compositionId, conversationId: 'conv-1', runId: 'run-1', agentId: 'agent-1' },
    ...over,
  })
  const egressEvents = () => events.filter((e) => e.subject === 'eyas.privacy.egress').map((e) => e.data)
  const sectionRows = () =>
    db.all(sql`SELECT section_key, content, egress_masked, egress_spans, egress_skipped FROM context_sections
      WHERE composition_id = ${compositionId} ORDER BY ord`) as any[]
  const compositionEgress = () => {
    const raw = (db.all(sql`SELECT egress_json FROM context_compositions WHERE id = ${compositionId}`) as any[])[0]?.egress_json
    return raw ? JSON.parse(raw) : null
  }
  return { ctx, gateway, remote, local, db, events, egressEvents, compositionId, request, sectionRows, compositionEgress }
}

describe('privacy egress audit — gateway calls', () => {
  it('(+) a masked call emits exactly ONE egress event with its identity, sections, tools and types', async () => {
    const t = await start()
    await t.gateway.complete(t.request('remote'))
    await flush()
    const events = t.egressEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      targetId: 'conv-1',
      conversationId: 'conv-1',
      runId: 'run-1',
      agentId: 'agent-1',
      compositionId: t.compositionId,
      providerId: 'remote',
      locality: 'remote',
      transport: 'gateway',
      rulesetVersion: t.ctx.privacy.rulesetVersion(),
      sectionKeys: ['memory-context'],
      toolNames: ['memory_search'],
      byType: { email: 1, iban: 1 },
      masked: 2,
      warned: 0,
    })
  })

  it('(−) the event never carries a detected value', async () => {
    const t = await start()
    await t.gateway.complete(t.request('remote'))
    await flush()
    const serialized = JSON.stringify(t.events)
    expect(serialized).not.toContain(EMAIL)
    expect(serialized).not.toContain('HU42')
  })

  it('(−) an unmasked call emits nothing', async () => {
    const t = await start()
    await t.gateway.complete({ provider: 'remote', messages: [{ role: 'user', content: 'Release on 2026-09-08 at 14:05' }] })
    await flush()
    expect(t.egressEvents()).toEqual([])
  })

  it("(−) 'eyas.privacy.detected' is never emitted", async () => {
    const t = await start()
    await t.gateway.complete(t.request('remote'))
    await flush()
    expect(t.events.map((e) => e.subject)).not.toContain('eyas.privacy.detected')
  })

  it("(+) the audit module keeps it as action 'privacy.egress' with the conversation as target", async () => {
    const t = await start()
    await t.gateway.complete(t.request('remote'))
    await flush()
    const { entries } = t.ctx.audit.query({ action: 'privacy.egress' })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ action: 'privacy.egress', module: 'privacy', target: 'conv-1' })
    expect(JSON.stringify(entries[0].details)).not.toContain(EMAIL)
    expect(t.ctx.audit.query({ action: 'privacy.detected' }).entries).toEqual([])
  })

  it('(−) with audit off no event is emitted, but the inspector still gets the masks', async () => {
    const t = await start({ audit: false })
    await t.gateway.complete(t.request('remote'))
    await flush()
    expect(t.egressEvents()).toEqual([])
    expect(t.compositionEgress()).toMatchObject({ locality: 'remote', calls: 1 })
  })

  it('(−) a local destination emits nothing and is recorded as local', async () => {
    const t = await start()
    await t.gateway.complete(t.request('local'))
    await flush()
    expect(t.egressEvents()).toEqual([])
    expect(t.local.received[0].system).toContain(EMAIL)
    expect(t.compositionEgress()).toMatchObject({ locality: 'local', providerId: 'local', calls: 1 })
    expect(t.sectionRows().every((r) => r.egress_masked === null && r.egress_skipped === null)).toBe(true)
  })
})

describe('privacy egress — attribution to the composition (context inspector)', () => {
  it('(+) the recorded spans reproduce exactly the section text the model received', async () => {
    const t = await start()
    await t.gateway.complete(t.request('remote'))
    await flush()
    const rows = t.sectionRows()
    expect(rows[0]).toMatchObject({ section_key: 'core-rules', egress_skipped: 1, egress_masked: null })
    expect(rows[1]).toMatchObject({ section_key: 'memory-context', egress_skipped: 0, egress_masked: 1 })
    const spans = JSON.parse(rows[1].egress_spans) as Array<[number, number, string]>
    expect(rows[1].content.slice(spans[0][0], spans[0][1])).toBe(EMAIL)
    const asSent = spans.reduceRight((text, [s, e, type]) => text.slice(0, s) + `[${type.toUpperCase()}]` + text.slice(e), rows[1].content as string)
    expect(t.remote.received[0].system).toContain(asSent)
    expect(t.compositionEgress()).toMatchObject({
      providerId: 'remote',
      toolResults: [{ toolName: 'memory_search', transport: 'gateway', masked: 1 }],
      byType: { email: 1, iban: 1 },
    })
  })

  it('(+) a memory tool result masked on a CLI bridge emits one event and lands on the turn', async () => {
    const t = await start()
    t.ctx.privacy.redactToolOutput('memory_expand', { text: `mail ${EMAIL}` }, {
      transport: 'mcp-bridge',
      conversationId: 'conv-1',
      runId: 'run-1',
      agentId: 'agent-1',
      turnId: t.compositionId,
    })
    await flush()
    const events = t.egressEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      targetId: 'conv-1',
      transport: 'mcp-bridge',
      locality: 'remote',
      providerId: null,
      turnId: t.compositionId,
      toolNames: ['memory_expand'],
      sectionKeys: [],
      byType: { email: 1 },
    })
    expect(JSON.stringify(events)).not.toContain(EMAIL)
    expect(t.compositionEgress().toolResults).toEqual([
      { toolName: 'memory_expand', transport: 'mcp-bridge', masked: 1, warned: 0, calls: 1 },
    ])
  })

  it('(−) a failing recorder never fails the model call', async () => {
    const t = await start()
    t.ctx.contextRecorder.attachEgress = () => { throw new Error('db gone') }
    await expect(t.gateway.complete(t.request('remote'))).resolves.toBeDefined()
    await flush()
    expect(t.egressEvents()).toHaveLength(1)
  })
})

describe('egress event builders', () => {
  const base = {
    transport: 'gateway' as const,
    locality: 'remote' as const,
    providerId: 'p',
    rulesetVersion: 'regex@2/policy@1',
    sections: [
      { ord: 0, key: 'memory-context', located: true, skipped: false, spans: [], warned: 1 },
      { ord: 1, key: 'project-context', located: true, skipped: false, spans: [], warned: 0 },
    ],
    unattributed: { masked: 1, warned: 0 },
    messages: { masked: 0, warned: 0 },
    toolResults: [],
    skippedKeys: [],
    byType: { taj_number: 1, email: 1 },
    matches: [
      { type: 'taj_number', action: 'warn' as const, scanner: 'regex', confidence: 0.75 },
      { type: 'email', action: 'mask' as const, scanner: 'regex', confidence: 0.95 },
    ],
  }

  it('(+) names warn-only sections and the unattributed text; counts masked and warned apart', () => {
    expect(egressEventOf(base)).toMatchObject({ sectionKeys: ['memory-context', 'unattributed'], masked: 1, warned: 1, targetId: null })
  })

  it('(−) no event without a detection or for a local destination', () => {
    expect(egressEventOf({ ...base, matches: [] })).toBeNull()
    expect(egressEventOf({ ...base, locality: 'local' })).toBeNull()
    expect(toolOutputEventOf({ transport: 'mcp-external', toolName: 't', rulesetVersion: 'r', masked: 0, warned: 0, byType: {}, matches: [] })).toBeNull()
  })
})

describe('PrivacyService.redactToolOutput — audit and attribution', () => {
  it('(−) with audit off, a masked tool result emits no event', async () => {
    const t = await start({ audit: false })
    t.ctx.privacy.redactToolOutput('memory_search', `mail ${EMAIL}`, { transport: 'mcp-external', conversationId: 'conv-1' })
    await flush()
    expect(t.egressEvents()).toEqual([])
  })

  it('(−) without a turn id nothing is attached; an unmasked result emits nothing', async () => {
    const t = await start()
    t.ctx.privacy.redactToolOutput('memory_search', `mail ${EMAIL}`, { transport: 'mcp-external' })
    t.ctx.privacy.redactToolOutput('memory_search', 'Release 2026-09-08', { transport: 'mcp-bridge', turnId: t.compositionId })
    await flush()
    expect(t.egressEvents()).toHaveLength(1)
    expect(t.egressEvents()[0]).toMatchObject({ transport: 'mcp-external', targetId: null, turnId: null })
    expect(t.compositionEgress()).toBeNull()
  })
})
