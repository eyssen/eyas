// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D4 — the privacy egress filter in the gateway's egress slot. EYAS data is
// stored raw and masked on its way to a REMOTE destination: the system prompt
// section by section (EYAS-generated sections are sent as they are, text it
// cannot attribute is scanned), the history, and memory-bearing tool results
// (JSON leaves). Workspace tool results, tool_use inputs, images and thinking
// blocks are never touched. A local destination or a disabled policy gets the
// request unchanged, and nothing here ever throws on a match.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createEgressFilter, SYSTEM_GENERATED_SECTION_KEYS, type EgressDigest } from '@modules/privacy/egress-filter'
import type { AIProvider, ContentBlock, ModelRequest } from '@modules/model/types'
import { createPrivacyFixture, type PrivacyFixture } from '../../helpers/privacy-service'

const EMAIL = 'billing@example.com'
const IBAN = 'HU42 1177 3016 1111 1018 0000 0000'

let fx: PrivacyFixture
afterEach(() => fx?.cleanup())

function provider(id: string, host?: string): AIProvider {
  return {
    id,
    name: id,
    listModels: async () => [],
    complete: vi.fn() as any,
    stream: vi.fn() as any,
    ...(host !== undefined ? { egressHost: () => host } : {}),
  }
}

const REMOTE = provider('openai', 'api.openai.com')

const MEMORY_TOOLS = new Set(['memory_search', 'memory_expand', 'read_team_memory'])
const registry = { get: (name: string) => ({ memoryBearing: MEMORY_TOOLS.has(name) }) }

type Sections = Record<string, Array<{ ord: number; key: string; content: string }>>

function makeFilter(opts: { sections?: Sections; onDigest?: (d: EgressDigest) => void } = {}) {
  const digests: EgressDigest[] = []
  const filter = createEgressFilter({
    service: fx.service,
    getToolRegistry: () => registry,
    getRecorder: () => ({ sectionsFor: (id) => (id ? opts.sections?.[id] ?? null : null) }),
    onDigest: opts.onDigest ?? ((d) => digests.push(d)),
    logger: { debug: vi.fn() },
  })
  return { filter, digests }
}

// The shape the prompt assembler produces: every section ends with a blank
// line, the last one of a part loses it when the parts are joined, and
// per-turn sections (memory) are appended with '\n\n'.
const CORE_RULES = '<core-rules>\nNever mail owner@example.com without asking.\n</core-rules>\n\n'
const RUNTIME = '<runtime>\n- Current date: 2026-09-08\n- Current time: 14:05\n</runtime>\n\n'
const MEMORY = `<memory-context>\n- 2026-09-08 invoice contact ${EMAIL}, account ${IBAN}\n</memory-context>`
const SYSTEM = `${(CORE_RULES + RUNTIME).trimEnd()}\n\n\n${MEMORY}`
const SECTIONS: Sections = {
  'comp-1': [
    { ord: 0, key: 'core-rules', content: CORE_RULES },
    { ord: 1, key: 'runtime', content: RUNTIME },
    { ord: 2, key: 'memory-context', content: MEMORY },
  ],
}

const withSystem = (extra: Partial<ModelRequest> = {}): ModelRequest => ({
  system: SYSTEM,
  messages: [{ role: 'user', content: 'hi' }],
  metadata: { compositionId: 'comp-1', conversationId: 'conv-1' },
  ...extra,
})

describe('egress filter — system prompt by section', () => {
  it('sends EYAS-generated sections as they are and masks the memory section', () => {
    fx = createPrivacyFixture({})
    const { filter, digests } = makeFilter({ sections: SECTIONS })

    const out = filter.request(withSystem(), REMOTE)

    expect(out.system).toContain('Never mail owner@example.com without asking.') // core-rules: not scanned
    expect(out.system).toContain('- Current date: 2026-09-08') // runtime: not scanned
    expect(out.system).toContain('- 2026-09-08 invoice contact [EMAIL], account [IBAN]')
    expect(out.system).not.toContain(EMAIL)
    expect(out.system).not.toContain(IBAN)

    const d = digests[0]
    expect(d.skippedKeys).toEqual(['core-rules', 'runtime'])
    expect(d.sections.map((s) => [s.key, s.located, s.skipped])).toEqual([
      ['core-rules', true, true],
      ['runtime', true, true],
      ['memory-context', true, false],
    ])
    const spans = d.sections[2].spans
    expect(spans.map((s) => s[2])).toEqual(['email', 'iban'])
    expect(MEMORY.slice(spans[0][0], spans[0][1])).toBe(EMAIL)
    expect(d.unattributed).toEqual({ masked: 0, warned: 0 })
  })

  it('masks a block-class value in memory without refusing the request', () => {
    fx = createPrivacyFixture({})
    const { filter } = makeFilter({ sections: SECTIONS })
    expect(() => filter.request(withSystem(), REMOTE)).not.toThrow()
  })

  it('scans the whole prompt without a composition record — and still keeps dates', () => {
    fx = createPrivacyFixture({})
    const { filter, digests } = makeFilter()
    const out = filter.request(withSystem({ metadata: {} }), REMOTE)

    // Fail closed: nothing can be attributed, so the generated sections are scanned too.
    expect(out.system).toContain('Never mail [EMAIL] without asking.')
    expect(out.system).toContain('- Current date: 2026-09-08')
    expect(out.system).toContain('- Current time: 14:05')
    expect(out.system).toContain('- 2026-09-08 invoice contact [EMAIL], account [IBAN]')
    expect(digests[0].sections).toEqual([])
    expect(digests[0].unattributed.masked).toBe(3)
  })

  it('scans a section it cannot locate as unattributed text (fail closed)', () => {
    fx = createPrivacyFixture({})
    const { filter, digests } = makeFilter({
      sections: { 'comp-1': [{ ord: 0, key: 'core-rules', content: '<core-rules>\nsomething else\n</core-rules>\n\n' }] },
    })
    const out = filter.request(withSystem(), REMOTE)
    expect(out.system).toContain('Never mail [EMAIL] without asking.')
    expect(digests[0].sections[0]).toMatchObject({ key: 'core-rules', located: false, skipped: false })
    expect(digests[0].skippedKeys).toEqual([])
  })

  it('skips only the listed generated keys', () => {
    expect([...SYSTEM_GENERATED_SECTION_KEYS].sort()).toEqual([
      'available-agents', 'available-skills', 'available-tools', 'core-identity',
      'core-rules', 'orchestration-directive', 'runtime', 'working-directories',
    ])
    expect(SYSTEM_GENERATED_SECTION_KEYS.has('memory-context')).toBe(false)
    expect(SYSTEM_GENERATED_SECTION_KEYS.has('agent-notes')).toBe(false)
  })
})

describe('egress filter — history and tool results', () => {
  const toolTurn = (name: string, content: string, input: Record<string, unknown> = { query: 'invoice' }): ModelRequest => ({
    messages: [
      { role: 'user', content: 'find the invoice contact' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu-1', name, input }] },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 'tu-1', content }] },
    ],
  })

  it('masks the leaves of a memory tool JSON result, keeps keys and structure, stays valid JSON', () => {
    fx = createPrivacyFixture({})
    const { filter, digests } = makeFilter()
    const output = { results: [{ id: 'gs:1', source: 'gist', content: `2026-09-08 contact ${EMAIL}`, score: 0.92 }], note: 'quoted' }
    const raw = JSON.stringify(output)

    const out = filter.request(toolTurn('memory_search', raw), REMOTE)
    const block = (out.messages[2].content as ContentBlock[])[0] as { content: string }

    expect(block.content).toBe(raw.replace(EMAIL, '[EMAIL]'))
    expect(JSON.parse(block.content)).toEqual({
      results: [{ id: 'gs:1', source: 'gist', content: '2026-09-08 contact [EMAIL]', score: 0.92 }],
      note: 'quoted',
    })
    expect(digests[0].toolResults).toEqual([{ toolName: 'memory_search', masked: 1, warned: 0 }])
  })

  it('leaves a workspace tool result byte-identical (same block)', () => {
    fx = createPrivacyFixture({})
    const { filter } = makeFilter()
    const req = toolTurn('search_indexed', JSON.stringify({ hits: [{ path: 'a.ts', text: `mail ${EMAIL}` }] }))
    const out = filter.request(req, REMOTE)
    expect(out).toBe(req)
  })

  it('masks a memory tool error string', () => {
    fx = createPrivacyFixture({})
    const { filter } = makeFilter()
    const out = filter.request(toolTurn('memory_expand', `Error: no note for ${EMAIL}`), REMOTE)
    expect(((out.messages[2].content as ContentBlock[])[0] as { content: string }).content).toBe('Error: no note for [EMAIL]')
  })

  it('never touches tool_use inputs', () => {
    fx = createPrivacyFixture({})
    const { filter } = makeFilter()
    const req = toolTurn('memory_search', JSON.stringify({ results: [] }), { query: EMAIL })
    const out = filter.request(req, REMOTE)
    expect(out).toBe(req)
  })

  it('leaves a tool result raw when its tool_use is not in the request', () => {
    fx = createPrivacyFixture({})
    const { filter } = makeFilter()
    const req: ModelRequest = { messages: [{ role: 'user', content: [{ type: 'tool_result', toolUseId: 'gone', content: `x ${EMAIL}` }] }] }
    expect(filter.request(req, REMOTE)).toBe(req)
  })

  it('masks string messages and text blocks, leaves images and thinking blocks untouched', () => {
    fx = createPrivacyFixture({})
    const { filter } = makeFilter()
    const image = { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'AAAA' } }
    const thinking = { type: 'thinking', thinking: `I should mail ${EMAIL}`, signature: 'sig-abc' }
    const redacted = { type: 'redacted_thinking', data: `opaque ${EMAIL}` }
    const req: ModelRequest = {
      messages: [
        { role: 'user', content: `mail ${EMAIL}` },
        { role: 'assistant', content: [thinking, redacted, { type: 'text', text: `sent to ${EMAIL}` }] as unknown as ContentBlock[] },
        { role: 'user', content: [image as ContentBlock] },
      ],
    }
    const out = filter.request(req, REMOTE)
    expect(out.messages[0].content).toBe('mail [EMAIL]')
    const assistant = out.messages[1].content as unknown[]
    expect(assistant[0]).toBe(thinking)
    expect(assistant[1]).toBe(redacted)
    expect(assistant[2]).toEqual({ type: 'text', text: 'sent to [EMAIL]' })
    expect(out.messages[2]).toBe(req.messages[2])
  })
})

describe('egress filter — destination and identity', () => {
  const req = (): ModelRequest => ({ messages: [{ role: 'user', content: `mail ${EMAIL}` }] })

  it('decides locality by the provider host', () => {
    fx = createPrivacyFixture({ localHosts: ['lan-box'] })
    const { filter } = makeFilter()
    const local = req()
    expect(filter.request(local, provider('lmstudio', 'localhost'))).toBe(local)
    expect(filter.request(local, provider('ollama', '127.0.0.1'))).toBe(local)
    expect(filter.request(local, provider('box', 'lan-box'))).toBe(local)
    expect(filter.request(req(), provider('ollama', 'gpu.lan')).messages[0].content).toBe('mail [EMAIL]')
    expect(filter.request(req(), provider('grok-cli')).messages[0].content).toBe('mail [EMAIL]') // CLI: no host → remote
  })

  it('leaves everything untouched when the policy is disabled', () => {
    fx = createPrivacyFixture({ enabled: false })
    const { filter, digests } = makeFilter()
    const r = req()
    expect(filter.request(r, REMOTE)).toBe(r)
    expect(digests).toEqual([])
  })

  it('returns the same object when nothing matched', () => {
    fx = createPrivacyFixture({})
    const { filter } = makeFilter()
    const r: ModelRequest = { system: '- Current date: 2026-09-08', messages: [{ role: 'user', content: 'Meet on 22.09.2026 at 14:05' }] }
    expect(filter.request(r, REMOTE)).toBe(r)
  })

  it('keeps every field it does not touch by reference', () => {
    fx = createPrivacyFixture({})
    const { filter } = makeFilter()
    const metadata = { conversationId: 'c1' }
    const tools = [{ name: 'memory_search', description: 'd', inputSchema: {} }]
    const extra = { level: 'high' }
    const second = { role: 'user' as const, content: 'clean' }
    const r = { messages: [{ role: 'user' as const, content: `mail ${EMAIL}` }, second], metadata, tools, effortPlan: extra } as ModelRequest & { effortPlan: unknown }
    const out = filter.request(r, REMOTE) as typeof r
    expect(out).not.toBe(r)
    expect(out.metadata).toBe(metadata)
    expect(out.tools).toBe(tools)
    expect(out.effortPlan).toBe(extra)
    expect(out.messages[1]).toBe(second)
    expect(r.messages[0].content).toBe(`mail ${EMAIL}`) // the input is never mutated
  })

  it('reports digests without values, and a failing digest consumer never fails the call', () => {
    fx = createPrivacyFixture({})
    const { filter, digests } = makeFilter({ sections: SECTIONS })
    filter.request(withSystem(), REMOTE)
    expect(digests).toHaveLength(1)
    expect(digests[0]).toMatchObject({ transport: 'gateway', providerId: 'openai', compositionId: 'comp-1', conversationId: 'conv-1' })
    expect(digests[0].byType).toEqual({ email: 1, iban: 1 })
    const serialized = JSON.stringify(digests[0])
    expect(serialized).not.toContain(EMAIL)
    expect(serialized).not.toContain('1177')

    const throwing = makeFilter({ sections: SECTIONS, onDigest: () => { throw new Error('consumer down') } })
    expect(() => throwing.filter.request(withSystem(), REMOTE)).not.toThrow()
  })
})

describe('egress filter — one policy per turn', () => {
  it('keeps masking a turn with the policy it started with; the next turn uses the new one', () => {
    fx = createPrivacyFixture({})
    const { filter } = makeFilter()
    const turn = (compositionId: string): ModelRequest => ({
      messages: [{ role: 'user', content: `mail ${EMAIL}` }],
      metadata: { compositionId },
    })

    expect(filter.request(turn('turn-1'), REMOTE).messages[0].content).toBe('mail [EMAIL]')
    fx.service.update({ actions: { email: 'off' } })

    // Same turn (the next tool-loop iteration): the bytes sent earlier do not change.
    expect(filter.request(turn('turn-1'), REMOTE).messages[0].content).toBe('mail [EMAIL]')
    // A new turn, and a call with no turn at all, follow the new policy.
    expect(filter.request(turn('turn-2'), REMOTE).messages[0].content).toBe(`mail ${EMAIL}`)
    expect(filter.request({ messages: [{ role: 'user', content: `mail ${EMAIL}` }] }, REMOTE).messages[0].content).toBe(`mail ${EMAIL}`)
  })

  it('a pinned turn keeps its own custom patterns after a swap', () => {
    fx = createPrivacyFixture({ customPatterns: [{ name: 'p', regex: 'PROJ-\\d+', type: 'project', action: 'mask' }] })
    const { filter } = makeFilter()
    const turn = (id: string): ModelRequest => ({ messages: [{ role: 'user', content: 'see PROJ-42' }], metadata: { runId: id } })
    expect(filter.request(turn('run-1'), REMOTE).messages[0].content).toBe('see [PROJECT]')
    fx.service.update({ customPatterns: [] })
    expect(filter.request(turn('run-1'), REMOTE).messages[0].content).toBe('see [PROJECT]')
    expect(filter.request(turn('run-2'), REMOTE).messages[0].content).toBe('see PROJ-42')
  })
})

describe('egress filter — embeddings', () => {
  it('masks texts sent to a remote embedder and leaves a local one untouched', () => {
    fx = createPrivacyFixture({})
    const { filter, digests } = makeFilter()
    const r = { texts: [`gist ${EMAIL} 2026-09-08`, 'clean'] }
    expect(filter.embed(r, REMOTE).texts).toEqual(['gist [EMAIL] 2026-09-08', 'clean'])
    expect(digests[0]).toMatchObject({ transport: 'embed', providerId: 'openai' })
    expect(filter.embed(r, provider('ollama', 'localhost'))).toBe(r)
  })

  it('returns the same embed request when nothing matched or the policy is off', () => {
    fx = createPrivacyFixture({})
    const { filter } = makeFilter()
    const clean = { texts: ['nothing here'] }
    expect(filter.embed(clean, REMOTE)).toBe(clean)
    fx.cleanup()
    fx = createPrivacyFixture({ enabled: false })
    const off = makeFilter().filter
    const r = { texts: [`gist ${EMAIL}`] }
    expect(off.embed(r, REMOTE)).toBe(r)
  })
})

// D7 — the digest reaches the turn's composition (context inspector) off the
// call path, for remote scans and local pass-throughs alike.
describe('egress filter — attribution to the composition', () => {
  const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0))

  function withRecorder(attachEgress: (id: string, d: EgressDigest) => void) {
    return createEgressFilter({
      service: fx.service,
      getToolRegistry: () => registry,
      getRecorder: () => ({ sectionsFor: (id) => (id ? SECTIONS[id] ?? null : null), attachEgress }),
      logger: { debug: vi.fn() },
    })
  }

  it('(+) attaches a remote digest to the composition after the call, with locality and spans', async () => {
    fx = createPrivacyFixture({})
    const attached: Array<[string, EgressDigest]> = []
    const filter = withRecorder((id, d) => attached.push([id, d]))
    filter.request(withSystem(), REMOTE)
    expect(attached).toEqual([]) // not on the call path
    await flushMicrotasks()
    expect(attached).toHaveLength(1)
    const [id, d] = attached[0]
    expect(id).toBe('comp-1')
    expect(d.locality).toBe('remote')
    const memory = d.sections.find((s) => s.key === 'memory-context')!
    expect(memory.spans.map(([s, e]) => MEMORY.slice(s, e))).toEqual([EMAIL, IBAN])
  })

  it('(+) a local destination is attached as local, with nothing scanned', async () => {
    fx = createPrivacyFixture({})
    const attached: EgressDigest[] = []
    const filter = withRecorder((_id, d) => attached.push(d))
    const r = withSystem()
    expect(filter.request(r, provider('ollama', 'localhost'))).toBe(r)
    await flushMicrotasks()
    expect(attached).toHaveLength(1)
    expect(attached[0]).toMatchObject({ locality: 'local', providerId: 'ollama', sections: [], matches: [] })
  })

  it('(−) nothing is attached without a composition id or with the policy off', async () => {
    fx = createPrivacyFixture({ enabled: false })
    const attached: EgressDigest[] = []
    withRecorder((_id, d) => attached.push(d)).request(withSystem(), REMOTE)
    fx.cleanup()
    fx = createPrivacyFixture({})
    withRecorder((_id, d) => attached.push(d)).request({ messages: [{ role: 'user', content: `mail ${EMAIL}` }] }, REMOTE)
    await flushMicrotasks()
    expect(attached).toEqual([])
  })

  it('(−) a recorder that throws never fails the call', async () => {
    fx = createPrivacyFixture({})
    const filter = withRecorder(() => { throw new Error('db gone') })
    expect(() => filter.request(withSystem(), REMOTE)).not.toThrow()
    await flushMicrotasks()
  })
})
