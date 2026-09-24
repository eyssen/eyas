// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createOpencodeHttpClient, OpencodeHttpError, parseProviderCatalog } from '@modules/opencode/opencode-client'

/** GET /config/providers of opencode 1.18.29 (W2 spike, trimmed; API keys redacted). */
const FIXTURE = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/cli/opencode/1.18.29/config-providers.json'), 'utf8')) as {
  request: { path: string }
  response: unknown
  promptBodyVariant: { type: string }
  promptReplyInfo: Record<string, { type: string }>
}

interface Call { url: string; method: string; headers: Record<string, string>; body: unknown }

function recordingFetch(respond: (call: Call) => Response = () => new Response('{}', { status: 200 })) {
  const calls: Call[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    calls.push(call)
    return respond(call)
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

describe('OpenCode HTTP client', () => {
  it('routes a scoped client to its folder with ?directory= and sends no directory in the session body', async () => {
    const { calls, fetchImpl } = recordingFetch(() => new Response(JSON.stringify({ id: 'ses_1' }), { status: 200 }))
    const client = createOpencodeHttpClient('http://127.0.0.1:9/', { fetchImpl }).forDirectory('/work/my project')
    const session = await client.createSession({ title: 't' })
    expect(session.id).toBe('ses_1')
    expect(calls[0]!.url).toBe('http://127.0.0.1:9/session?directory=%2Fwork%2Fmy%20project')
    // POST /session has additionalProperties:false and no `directory` field (fixture).
    expect(calls[0]!.body).toEqual({ title: 't' })
  })

  it('sends basic auth (username opencode) when the server has a password, and none otherwise', async () => {
    const { calls, fetchImpl } = recordingFetch()
    await createOpencodeHttpClient('http://h', { fetchImpl, password: 'pw' }).health()
    expect(calls[0]!.headers.Authorization).toBe(`Basic ${Buffer.from('opencode:pw').toString('base64')}`)
    await createOpencodeHttpClient('http://h', { fetchImpl }).health()
    expect(calls[1]!.headers.Authorization).toBeUndefined()
  })

  it('replies to a permission on POST /permission/{id}/reply', async () => {
    const { calls, fetchImpl } = recordingFetch()
    await createOpencodeHttpClient('http://h', { fetchImpl }).replyPermission('ses_1', 'per_1', 'once')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ url: 'http://h/permission/per_1/reply', method: 'POST', body: { reply: 'once' } })
  })

  it('falls back to the per-session route only on 404, and surfaces other errors', async () => {
    const { calls, fetchImpl } = recordingFetch((call) =>
      call.url.includes('/permission/per_1/reply') ? new Response('not found', { status: 404 }) : new Response('{}', { status: 200 }),
    )
    await createOpencodeHttpClient('http://h', { fetchImpl }).replyPermission('ses_1', 'per_1', 'reject')
    expect(calls[1]).toMatchObject({ url: 'http://h/session/ses_1/permissions/per_1', body: { response: 'reject' } })

    const failing = recordingFetch(() => new Response('boom', { status: 500 }))
    await expect(createOpencodeHttpClient('http://h', { fetchImpl: failing.fetchImpl }).replyPermission('ses_1', 'per_1', 'once'))
      .rejects.toThrow(/500/)
    expect(failing.calls).toHaveLength(1)
  })

  it('deletes a session with DELETE /session/{id}', async () => {
    const { calls, fetchImpl } = recordingFetch()
    await createOpencodeHttpClient('http://h', { fetchImpl }).forDirectory('/w').deleteSession('ses_9')
    expect(calls[0]).toMatchObject({ url: 'http://h/session/ses_9?directory=%2Fw', method: 'DELETE' })
  })

  it('subscribes to the scoped event stream with the auth header', async () => {
    const { calls, fetchImpl } = recordingFetch(() => new Response('data: {"type":"server.connected","properties":{}}\n\n', { status: 200 }))
    const events: string[] = []
    await createOpencodeHttpClient('http://h', { fetchImpl, password: 'pw' })
      .forDirectory('/w')
      .subscribeEvents(new AbortController().signal, (e) => events.push(e.type))
    expect(calls[0]!.url).toBe('http://h/event?directory=%2Fw')
    expect(calls[0]!.headers.Authorization).toMatch(/^Basic /)
    expect(events).toEqual(['server.connected'])
  })

  it('(+) lists the models and reasoning variants from GET /config/providers (1.18.29 fixture)', async () => {
    const { calls, fetchImpl } = recordingFetch(() => new Response(JSON.stringify(FIXTURE.response), { status: 200 }))
    const catalog = await createOpencodeHttpClient('http://h', { fetchImpl, password: 'pw' }).forDirectory('/w').listProviders()
    expect(calls[0]).toMatchObject({ url: `http://h${FIXTURE.request.path}?directory=%2Fw`, method: 'GET' })
    expect(catalog.providers.map((p) => p.id)).toEqual(['anthropic', 'openai', 'opencode'])
    const anthropic = catalog.providers.find((p) => p.id === 'anthropic')!
    const opus = anthropic.models.find((m) => m.id === 'claude-opus-5-5')!
    expect(opus.name).toBe('Claude Opus 5.5')
    expect(opus.variants.map((v) => v.id)).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    // Names on the canonical ladder carry their rung.
    expect(opus.variants.every((v) => v.level === v.id)).toBe(true)
    // gpt-5.6 offers 'none' (reasoning off) as a variant.
    const gpt = catalog.providers.find((p) => p.id === 'openai')!.models.find((m) => m.id === 'gpt-5.6')!
    expect(gpt.variants[0]).toEqual({ id: 'none', level: 'none' })
    // Defaults are kept for listed providers.
    expect(catalog.defaults).toMatchObject({ anthropic: 'claude-sonnet-4-6', opencode: 'big-pickle' })
  })

  it('(+) a model without variants parses with an empty list', () => {
    const catalog = parseProviderCatalog(FIXTURE.response)
    const gpt4o = catalog.providers.find((p) => p.id === 'openai')!.models.find((m) => m.id === 'gpt-4o')!
    const pickle = catalog.providers.find((p) => p.id === 'opencode')!.models.find((m) => m.id === 'big-pickle')!
    expect(gpt4o.variants).toEqual([])
    expect(pickle.variants).toEqual([])
  })

  it('(−) never copies provider credentials or options out of the payload', () => {
    const catalog = parseProviderCatalog(FIXTURE.response)
    const json = JSON.stringify(catalog)
    expect(json).not.toContain('REDACTED-API-KEY')
    expect(json).not.toContain('anthropic-beta')
    for (const provider of catalog.providers) expect(Object.keys(provider).sort()).toEqual(['id', 'models', 'name'])
  })

  it('(−) skips malformed providers, models and variant names instead of failing the list', () => {
    const catalog = parseProviderCatalog({
      providers: [
        null,
        { id: '', models: {} },
        { id: 'no-models' },
        { id: 'p', name: 'P', key: 'sk-secret', models: {
          ok: { name: 'OK', variants: { high: {}, 'vendor-turbo': {}, 'bad\u0000name': {} } },
          broken: 'not-an-object',
          ['x'.repeat(500)]: { name: 'too long' },
        } },
      ],
      default: { p: 'ok', ghost: 'missing-provider', q: 42 },
    })
    expect(catalog.providers).toHaveLength(1)
    expect(catalog.providers[0]!.models).toEqual([
      { id: 'ok', name: 'OK', variants: [{ id: 'high', level: 'high' }, { id: 'vendor-turbo', level: null }] },
    ])
    expect(catalog.defaults).toEqual({ p: 'ok' })
    expect(JSON.stringify(catalog)).not.toContain('sk-secret')
  })

  it('(+) each model carries the window OpenCode lists for it: the input limit when there is one, else the context (K10)', () => {
    const catalog = parseProviderCatalog(FIXTURE.response)
    const model = (provider: string, id: string) => catalog.providers.find((p) => p.id === provider)!.models.find((m) => m.id === id)!
    expect(model('anthropic', 'claude-opus-5-5').contextWindow).toBe(1_000_000)
    expect(model('anthropic', 'claude-haiku-4-5').contextWindow).toBe(200_000)
    expect(model('openai', 'gpt-4o').contextWindow).toBe(128_000)
    // context 1,050,000 but input 922,000: the prompt must fit the input limit.
    expect(model('openai', 'gpt-5.6').contextWindow).toBe(922_000)
    expect(model('opencode', 'big-pickle').contextWindow).toBe(160_000)
  })

  it('(−) a missing or unusable limit leaves the window out; one bad field does not hide the other (K10)', () => {
    const catalog = parseProviderCatalog({
      providers: [{ id: 'p', name: 'P', models: {
        none: { name: 'none' },
        text: { name: 'text', limit: 'big' },
        negative: { name: 'negative', limit: { context: -5 } },
        fraction: { name: 'fraction', limit: { context: 1000.5 } },
        huge: { name: 'huge', limit: { context: 1e12 } },
        zero: { name: 'zero', limit: { context: 0, output: 4096 } },
        badInput: { name: 'badInput', limit: { context: 64_000, input: 'lots' } },
        inputOnly: { name: 'inputOnly', limit: { input: 30_000 } },
        inputAboveContext: { name: 'inputAboveContext', limit: { context: 50_000, input: 90_000 } },
      } }],
    })
    const byId = Object.fromEntries(catalog.providers[0]!.models.map((m) => [m.id, m]))
    for (const id of ['none', 'text', 'negative', 'fraction', 'huge', 'zero']) expect(byId[id], id).not.toHaveProperty('contextWindow')
    expect(byId.badInput!.contextWindow).toBe(64_000)
    expect(byId.inputOnly!.contextWindow).toBe(30_000)
    expect(byId.inputAboveContext!.contextWindow).toBe(50_000)
  })

  it('(−) a payload without a providers array is an error', () => {
    expect(() => parseProviderCatalog({ all: [] })).toThrow(OpencodeHttpError)
    expect(() => parseProviderCatalog('nope')).toThrow(/invalid \/config\/providers payload/)
  })

  it('(+) the prompt body carries the variant next to the model, as the 1.18.29 schema allows', async () => {
    expect(FIXTURE.promptBodyVariant).toEqual({ type: 'string' })
    const { calls, fetchImpl } = recordingFetch(() => new Response(JSON.stringify({
      info: { role: 'assistant', providerID: 'anthropic', modelID: 'claude-opus-5-5', variant: 'xhigh' },
      parts: [{ type: 'text', text: 'ok' }],
    }), { status: 200 }))
    const result = await createOpencodeHttpClient('http://h', { fetchImpl }).prompt('ses_1', {
      parts: [{ type: 'text', text: 'go' }],
      model: { providerID: 'anthropic', modelID: 'claude-opus-5-5' },
      variant: 'xhigh',
    })
    expect(calls[0]).toMatchObject({ url: 'http://h/session/ses_1/message', method: 'POST' })
    expect(calls[0]!.body).toMatchObject({ model: { providerID: 'anthropic', modelID: 'claude-opus-5-5' }, variant: 'xhigh' })
    // The reply's AssistantMessage names what ran (fixture promptReplyInfo).
    expect(Object.keys(FIXTURE.promptReplyInfo).sort()).toEqual(['modelID', 'providerID', 'variant'])
    expect(result).toEqual({ text: 'ok', model: { providerID: 'anthropic', modelID: 'claude-opus-5-5' }, variant: 'xhigh' })
  })

  it('(−) a reply without a usable info names no model', async () => {
    const { fetchImpl } = recordingFetch(() => new Response(JSON.stringify({ info: { modelID: 'm' }, parts: [{ type: 'text', text: 'ok' }] }), { status: 200 }))
    const result = await createOpencodeHttpClient('http://h', { fetchImpl }).prompt('ses_1', { parts: [{ type: 'text', text: 'go' }] })
    expect(result).toEqual({ text: 'ok' })
  })
})
