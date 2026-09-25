// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// J10 / K4 — OpenCode's memory routes. The plugin inside OpenCode calls
// POST /api/v1/opencode/memory/search|expand with a one-time proof for the
// OpenCode session the tool runs in, made with its process's key. EYAS runs
// the registered memory_search / memory_expand through the one executor with
// a ToolContext from that session's server-side binding: the bound
// conversation's project, the calling turn's drill budget, the same
// access-log rows as the EYAS tool, and the privacy mask for a remote model.
// A call that claims another session is refused; anything unbound reads
// global memory only. The retired /memory/query and /memory/save are gone.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import pino from 'pino'
import { createMemoryDb, getRawFromDrizzle } from '../../helpers/test-db'
import { createPrivacyFixture, type PrivacyFixture } from '../../helpers/privacy-service'
import { probeSqliteCapabilities } from '@core/db/sqlite-capabilities'
import { createMemoryV2Tables } from '@modules/memory/v2/schema'
import { createToolRegistry } from '@modules/tools/tool-registry'
import { createToolExecutor, MEMORY_RESULT_WITHHELD, type ModelOutputRedactor } from '@modules/tools/tool-executor'
import { createMemoryTools, MEMORY_DRILL_LIMIT } from '@modules/tools/builtin/memory-tools'
import type { ToolContext } from '@modules/tools/types'
import { createOpencodeRoutes } from '@modules/opencode/routes'
import { createSessionBindings } from '@modules/opencode/memory-bridge'
import { createPluginTokenRegistry, makeSessionProof, type MintedPluginKey } from '@modules/opencode/plugin-tokens'
import { normalizeOpencodeSettings } from '@modules/opencode/settings-store'
import type { PtyManager } from '@modules/opencode/pty-manager'
import type { OpencodeRunner } from '@modules/opencode/opencode-runner'

const logger = pino({ level: 'silent' })
const EMAIL = 'billing@example.com'
const IBAN = 'HU42 1177 3016 1111 1018 0000 0000'

/** A hit of project P, and a global one. */
const PROJECT_HIT = { id: 'gs:proj', source: 'gist', text: `Project P ledger: contact ${EMAIL}, account ${IBAN}`, score: 0.9 }
const GLOBAL_HIT = { id: 'gs:glob', source: 'gist', text: 'A global preference', score: 0.5 }

let db: any
let service: { db: any; retrieve: ReturnType<typeof vi.fn>; expand: ReturnType<typeof vi.fn> }
let registry: ReturnType<typeof createToolRegistry>
let redactor: ModelOutputRedactor | undefined
let tokens: ReturnType<typeof createPluginTokenRegistry>
let sessions: ReturnType<typeof createSessionBindings>
let fx: PrivacyFixture | undefined

beforeEach(() => {
  db = createMemoryDb()
  createMemoryV2Tables(db, probeSqliteCapabilities(getRawFromDrizzle(db)))
  db.run(sql`CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, type_id TEXT)`)
  db.run(sql`INSERT INTO projects (id, name, type_id) VALUES ('P', 'Harbor', 'T'), ('Q', 'Elsewhere', 'T')`)
  db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT, user_id TEXT)`)
  db.run(sql`INSERT INTO conversations (id, project_id, user_id) VALUES ('conv-p', 'P', 'u1'), ('conv-q', 'Q', 'u2')`)
  service = {
    db,
    retrieve: vi.fn(async (opts: { projectId: string | null }) => (opts.projectId === 'P' ? [PROJECT_HIT, GLOBAL_HIT] : [GLOBAL_HIT])),
    expand: vi.fn((id: string, opts: { projectId: string | null }) => (opts.projectId === 'P' || id === GLOBAL_HIT.id
      ? { id, source: 'gist', content: id === GLOBAL_HIT.id ? GLOBAL_HIT.text : PROJECT_HIT.text, metadata: {} }
      : null)),
  }
  registry = createToolRegistry()
  for (const tool of createMemoryTools(() => service)) registry.register(tool)
  redactor = undefined
  tokens = createPluginTokenRegistry()
  sessions = createSessionBindings()
})

afterEach(() => {
  fx?.cleanup()
  fx = undefined
})

function executor() {
  return createToolExecutor(registry, {
    authorization: {
      getSecurityGate: () => ({ validateToolCall: async () => ({ decision: 'allow', reason: 'read-only memory', riskTier: 'green' }) }) as never,
      getAbilityForRole: () => ({ can: () => true }),
    },
    getModelOutputRedactor: () => redactor,
    logger,
  })
}

/** The routes behind an optional signed-in user (ability built from `canCreate`). */
function app(user?: { id: string; canCreate: boolean }) {
  const hono = new Hono()
  if (user) {
    hono.use('*', async (c, next) => {
      const set = c.set as (k: string, v: unknown) => void
      set('userId', user.id)
      set('role', 'user')
      set('ability', { can: (action: string, subject: string) => subject !== 'OpenCode' || user.canCreate || action !== 'create' })
      await next()
    })
  }
  const exec = executor()
  createOpencodeRoutes(hono, {
    runner: { which: async () => null, run: async () => ({ code: 0, stdout: '', stderr: '' }) },
    load: () => normalizeOpencodeSettings({}),
    save: () => undefined,
    pty: {} as PtyManager,
    opencode: {} as OpencodeRunner,
    getTools: () => ({ registry, executor: exec }),
    pluginTokens: tokens,
    sessions,
    getConversations: () => undefined,
    resolveTuiCommand: () => ({ file: 'opencode', args: [], env: {} }),
    resolveShellCommand: () => ({ file: '/bin/sh', args: ['-l'], env: {} }),
    logger,
  })
  return hono
}

async function post(hono: Hono, path: string, body: Record<string, unknown>, bearer?: string) {
  const res = await hono.request(`/api/v1/opencode/memory/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json: { text?: string; isError?: boolean } = {}
  try { json = JSON.parse(text) } catch { /* an HTTP error page */ }
  return { status: res.status, json, raw: text }
}

/** A fresh one-time proof for `sessionId`, made with a minted key (what the plugin sends). */
function proof(minted: MintedPluginKey, sessionId: string): string {
  return makeSessionProof(minted.key, sessionId)
}

/** The hits a memory_search answer carries (the text is the executor's JSON). */
function hitIds(answer: { text?: string }): string[] {
  const parsed = JSON.parse(answer.text ?? '{}') as { results?: Array<{ id: string }> }
  return (parsed.results ?? []).map((r) => r.id)
}

function accessRows() {
  return db.all(sql`SELECT memory_type, memory_id, context_task_id, rank_detail_json FROM memory_access_log ORDER BY id`)
}

describe('OpenCode memory routes — who may call', () => {
  it('(−) no Authorization header and no session → 401', async () => {
    expect((await post(app(), 'search', { query: 'ledger' })).status).toBe(401)
  })

  it('(−) a forged proof, or a key used as a bearer → 401', async () => {
    const serve = tokens.mint('serve', 'x')
    const hono = app()
    expect((await post(hono, 'search', { query: 'ledger' }, 'eyas-ocs.not-a-proof.x')).status).toBe(401)
    expect((await post(hono, 'search', { query: 'ledger' }, makeSessionProof('some-other-key', 'ses_1'))).status).toBe(401)
    expect((await post(hono, 'search', { query: 'ledger' }, serve.key)).status).toBe(401)
    expect(service.retrieve).not.toHaveBeenCalled()
  })

  it('(−) a proof made with the revoked key of a previous serve start → 401; the new key works', async () => {
    const old = tokens.mint('serve', 'start-1')
    tokens.revoke(old.tokenId)
    const fresh = tokens.mint('serve', 'start-2')
    const hono = app()
    expect((await post(hono, 'search', { query: 'ledger' }, proof(old, 'ses_1'))).status).toBe(401)
    expect((await post(hono, 'search', { query: 'ledger' }, proof(fresh, 'ses_1'))).status).toBe(200)
  })

  it('(−) a proof works once: a replayed one → 401', async () => {
    const serve = tokens.mint('serve', 'x')
    const hono = app()
    const bearer = proof(serve, 'ses_1')
    expect((await post(hono, 'search', { query: 'ledger' }, bearer)).status).toBe(200)
    expect((await post(hono, 'search', { query: 'ledger' }, bearer)).status).toBe(401)
    expect(service.retrieve).toHaveBeenCalledTimes(1)
  })

  it('(−) a signed-in user without create OpenCode → 403; with it → 200', async () => {
    expect((await post(app({ id: 'u1', canCreate: false }), 'search', { query: 'ledger' })).status).toBe(403)
    expect((await post(app({ id: 'u1', canCreate: true }), 'search', { query: 'ledger' })).status).toBe(200)
  })

  it('(−) the retired /memory/query and /memory/save are 404', async () => {
    const serve = tokens.mint('serve', 'x')
    expect((await post(app(), 'query', { query: 'ledger' }, proof(serve, 'ses_1'))).status).toBe(404)
    expect((await post(app(), 'save', { content: 'remember this' }, proof(serve, 'ses_1'))).status).toBe(404)
  })

  it('(−) a malformed body is a 400', async () => {
    const serve = tokens.mint('serve', 'x')
    expect((await post(app(), 'search', { query: '' }, proof(serve, 'ses_1'))).status).toBe(400)
    expect((await post(app(), 'expand', {}, proof(serve, 'ses_1'))).status).toBe(400)
    expect((await post(app(), 'search', { query: 'q', limit: 'all' }, proof(serve, 'ses_1'))).status).toBe(400)
  })

  it('(+) an out-of-range limit is clamped, not refused', async () => {
    const serve = tokens.mint('serve', 'x')
    expect((await post(app(), 'search', { query: 'q', limit: 500 }, proof(serve, 'ses_1'))).status).toBe(200)
    expect(service.retrieve).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 20 }))
    await post(app(), 'search', { query: 'q', limit: 0 }, proof(serve, 'ses_1'))
    expect(service.retrieve).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 1 }))
  })
})

describe('OpenCode memory routes — one session per proof', () => {
  it('(+) the legitimate session: its own proof reads its conversation\'s project', async () => {
    const serve = tokens.mint('serve', 'x')
    sessions.bind(serve.tokenId, 'ses_A', { conversationId: 'conv-p', userId: 'u1', turnId: 't' })
    const answer = await post(app(), 'search', { query: 'ledger' }, proof(serve, 'ses_A'))
    expect(answer.status).toBe(200)
    expect(hitIds(answer.json)).toEqual(['gs:proj', 'gs:glob'])
  })

  it('(−) a call claiming another session\'s id (its own proof, another session in the body) is refused, and nothing is read', async () => {
    const serve = tokens.mint('serve', 'x')
    sessions.bind(serve.tokenId, 'ses_A', { conversationId: 'conv-q', userId: 'u2', turnId: 't' })
    sessions.bind(serve.tokenId, 'ses_B', { conversationId: 'conv-p', userId: 'u1', turnId: 't' })
    const claimed = await post(app(), 'search', { query: 'ledger', sessionId: 'ses_B' }, proof(serve, 'ses_A'))
    expect(claimed.status).toBe(403)
    expect(claimed.json.text).toMatch(/only for its own session/)
    const expand = await post(app(), 'expand', { id: 'gs:proj', sessionId: 'ses_B' }, proof(serve, 'ses_A'))
    expect(expand.status).toBe(403)
    expect(service.retrieve).not.toHaveBeenCalled()
    expect(service.expand).not.toHaveBeenCalled()
    expect(accessRows()).toEqual([])
  })

  it('(−) a proof re-labelled with another session\'s id is refused (401): the proof binds its session', async () => {
    const serve = tokens.mint('serve', 'x')
    sessions.bind(serve.tokenId, 'ses_B', { conversationId: 'conv-p', userId: 'u1', turnId: 't' })
    const forA = proof(serve, 'ses_A')
    const [payload, mac] = forA.slice('eyas-ocs.'.length).split('.') as [string, string]
    const relabelled = { ...JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')), s: 'ses_B' }
    const forged = `eyas-ocs.${Buffer.from(JSON.stringify(relabelled)).toString('base64url')}.${mac}`
    expect((await post(app(), 'search', { query: 'ledger' }, forged)).status).toBe(401)
    expect(service.retrieve).not.toHaveBeenCalled()
  })

  it('(+) a body naming the proof\'s own session is accepted', async () => {
    const serve = tokens.mint('serve', 'x')
    sessions.bind(serve.tokenId, 'ses_A', { conversationId: 'conv-p', userId: 'u1', turnId: 't' })
    const answer = await post(app(), 'search', { query: 'ledger', sessionId: 'ses_A' }, proof(serve, 'ses_A'))
    expect(answer.status).toBe(200)
    expect(hitIds(answer.json)).toEqual(['gs:proj', 'gs:glob'])
  })
})

describe('OpenCode memory routes — what a call may read', () => {
  it('(+) a bound session gets the same hits and access-log rows as the EYAS tool for that conversation', async () => {
    const serve = tokens.mint('serve', 'x')
    sessions.bind(serve.tokenId, 'ses_1', { conversationId: 'conv-p', userId: 'u1', turnId: 'turn-oc' })
    const answer = await post(app(), 'search', { query: 'ledger' }, proof(serve, 'ses_1'))
    expect(answer.status).toBe(200)
    expect(answer.json.isError).toBe(false)
    expect(hitIds(answer.json)).toEqual(['gs:proj', 'gs:glob'])
    expect(service.retrieve).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: 'P', projectTypeId: 'T', excludeConversationId: 'conv-p' }))
    const viaPlugin = accessRows()

    // The EYAS tool itself, for the same conversation and turn.
    db.run(sql`DELETE FROM memory_access_log`)
    const ctx: ToolContext = { conversationId: 'conv-p', userId: 'u1', turnId: 'turn-eyas', logger, actor: { kind: 'agent', role: 'agent' } }
    const direct = await registry.get('memory_search')!.execute({ query: 'ledger' }, ctx) as { results: Array<{ id: string }> }
    expect(direct.results.map((r) => r.id)).toEqual(hitIds(answer.json))
    const viaEyas = accessRows()
    const strip = (rows: any[]) => rows.map((r) => ({ ...r, rank_detail_json: JSON.parse(r.rank_detail_json).call }))
    expect(strip(viaPlugin)).toEqual(strip(viaEyas))
    expect(viaPlugin.map((r: any) => r.context_task_id)).toEqual(['conv-p', 'conv-p'])
    expect(JSON.parse(viaPlugin[0].rank_detail_json)).toEqual({ turnId: 'turn-oc', call: 1 })
  })

  it('(+) a bound session shares the calling turn\'s drill budget', async () => {
    const serve = tokens.mint('serve', 'x')
    sessions.bind(serve.tokenId, 'ses_1', { conversationId: 'conv-p', userId: 'u1', turnId: 'turn-1' })
    const ctx: ToolContext = { conversationId: 'conv-p', userId: 'u1', turnId: 'turn-1', logger, actor: { kind: 'agent', role: 'agent' } }
    for (let i = 0; i < MEMORY_DRILL_LIMIT - 1; i++) await registry.get('memory_search')!.execute({ query: 'q' }, ctx)
    const last = await post(app(), 'expand', { id: 'gs:proj' }, proof(serve, 'ses_1'))
    expect(last.json.isError).toBe(false)
    expect(service.expand).toHaveBeenLastCalledWith('gs:proj', { projectId: 'P', projectTypeId: 'T' })
    const refused = await post(app(), 'search', { query: 'q' }, proof(serve, 'ses_1'))
    expect(refused.json.text).toMatch(/limited to 3 memory tool calls per turn/)
  })

  it('(−) a session EYAS did not bind (an OpenCode terminal\'s) gets global-only results (project items absent)', async () => {
    const serve = tokens.mint('serve', 'x')
    const answer = await post(app(), 'search', { query: 'ledger' }, proof(serve, 'ses_unknown'))
    expect(hitIds(answer.json)).toEqual(['gs:glob'])
    expect(service.retrieve).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: null }))
    const expand = await post(app(), 'expand', { id: 'gs:proj' }, proof(serve, 'ses_unknown'))
    expect(expand.json.text).toMatch(/not found or out of project scope/)
  })

  it('(−) a proof for a bound session made with another process\'s key gets global-only results', async () => {
    const serve = tokens.mint('serve', 'x')
    const pty = tokens.mint('pty', 'pty-1')
    sessions.bind(serve.tokenId, 'ses_1', { conversationId: 'conv-p', userId: 'u1', turnId: 't' })
    const answer = await post(app(), 'search', { query: 'ledger' }, proof(pty, 'ses_1'))
    expect(hitIds(answer.json)).toEqual(['gs:glob'])
    expect(JSON.stringify(accessRows())).not.toContain('conv-p')
  })

  it('(−) a signed-in caller gets global-only results for a session bound to another user (CASL path)', async () => {
    const serve = tokens.mint('serve', 'x')
    sessions.bind(serve.tokenId, 'ses_1', { conversationId: 'conv-p', userId: 'u1', turnId: 't' })
    const other = await post(app({ id: 'u2', canCreate: true }), 'search', { query: 'ledger', sessionId: 'ses_1' })
    expect(hitIds(other.json)).toEqual(['gs:glob'])
    const own = await post(app({ id: 'u1', canCreate: true }), 'search', { query: 'ledger', sessionId: 'ses_1' })
    expect(hitIds(own.json)).toEqual(['gs:proj', 'gs:glob'])
  })

  it('(−) a body cannot name its own conversation or project', async () => {
    const serve = tokens.mint('serve', 'x')
    sessions.bind(serve.tokenId, 'ses_1', { conversationId: 'conv-p', userId: 'u1', turnId: 't' })
    await post(app(), 'search', { query: 'ledger', conversationId: 'conv-q', projectId: 'Q' }, proof(serve, 'ses_1'))
    expect(service.retrieve).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: 'P', excludeConversationId: 'conv-p' }))
    await post(app(), 'search', { query: 'ledger', conversationId: 'conv-p', projectId: 'P' }, proof(serve, 'ses_unbound'))
    expect(service.retrieve).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: null }))
  })

  it('(−) the plugin can run nothing but the two memory tools', async () => {
    const serve = tokens.mint('serve', 'x')
    const hono = app()
    for (const path of ['call', 'run', 'tools/call']) {
      expect((await post(hono, path, { name: 'save_memory', arguments: { content: 'x' } }, proof(serve, 'ses_1'))).status).toBe(404)
    }
  })
})

describe('OpenCode memory routes — privacy (remote model)', () => {
  it('(+) a bound answer is masked, with the binding\'s identity in the digest', async () => {
    fx = createPrivacyFixture({})
    const redact = vi.fn(fx.service.redactToolOutput)
    redactor = redact
    const serve = tokens.mint('serve', 'x')
    sessions.bind(serve.tokenId, 'ses_1', { conversationId: 'conv-p', userId: 'u1', turnId: 'turn-1', runId: 'run-1' })
    const answer = await post(app(), 'search', { query: 'ledger' }, proof(serve, 'ses_1'))
    expect(answer.json.text).toContain('[EMAIL]')
    expect(answer.json.text).toContain('[IBAN]')
    expect(answer.raw).not.toContain(IBAN)
    expect(redact.mock.calls[0][2]).toEqual({ transport: 'opencode', conversationId: 'conv-p', runId: 'run-1', turnId: 'turn-1' })
  })

  it('(−) an unbound call\'s digest names no conversation', async () => {
    fx = createPrivacyFixture({})
    const redact = vi.fn(fx.service.redactToolOutput)
    redactor = redact
    const serve = tokens.mint('serve', 'x')
    await post(app(), 'search', { query: 'ledger' }, proof(serve, 'ses_claimed'))
    expect(redact.mock.calls[0][2]).toEqual({ transport: 'opencode' })
  })

  it('(−) a privacy scan that throws withholds the answer (fail closed)', async () => {
    redactor = () => { throw new Error('policy store gone') }
    const serve = tokens.mint('serve', 'x')
    sessions.bind(serve.tokenId, 'ses_1', { conversationId: 'conv-p', userId: 'u1' })
    const answer = await post(app(), 'search', { query: 'ledger' }, proof(serve, 'ses_1'))
    expect(answer.json).toEqual({ text: MEMORY_RESULT_WITHHELD, isError: true })
    expect(answer.raw).not.toContain(IBAN)
  })

  it('(−) without the privacy module the answer is unchanged', async () => {
    const serve = tokens.mint('serve', 'x')
    sessions.bind(serve.tokenId, 'ses_1', { conversationId: 'conv-p', userId: 'u1' })
    const answer = await post(app(), 'search', { query: 'ledger' }, proof(serve, 'ses_1'))
    expect(answer.json.text).toContain(IBAN)
  })
})
