// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Thin HTTP client for the OpenCode server OpenAPI. We do not import the
// private `opencode` package (not published, pulls its own AI SDKs). Official
// embed path is this HTTP surface: https://opencode.ai/docs/sdk
//
// Endpoints follow the 1.18.29 fixture (tests/fixtures/cli/opencode/1.18.29/
// reply-endpoint.json, openapi-permission.json). The server picks the project
// instance of a request from `?directory=` (else its own cwd), and POST
// /session accepts no `directory` field, so a session's folder travels as the
// query parameter of every call — a client scoped with forDirectory().
//
// Models and reasoning variants follow the 1.18.29 fixture
// config-providers.json: GET /config/providers lists the providers the
// server can use (each with its API key in `key`, which never leaves this
// file) and each model's `limit` (its window, which sizes a task's recalled
// memory), and session.prompt takes a `variant` next to `model`; the reply's
// `info` names the model and variant that actually ran.

import { z } from 'zod'
import { isEffortLevel } from '@modules/model/reasoning/ladder.js'
import { parseSSEBuffer } from '@shared/sse-parser.js'
import {
  OPENCODE_ID_PATTERN,
  OPENCODE_MODEL_ID_MAX,
  OPENCODE_VARIANT_MAX,
  type FileDiff,
  type OpencodeEvent,
  type OpencodeHttpSession,
  type OpencodeModelCatalog,
  type OpencodeModelInfo,
  type OpencodeModelRef,
  type OpencodePromptPart,
  type OpencodeProviderInfo,
} from './types.js'

export class OpencodeHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'OpencodeHttpError'
  }
}

/** Reply to a permission request: allow this one call, or refuse it. */
export type OpencodePermissionReply = 'once' | 'reject'

export interface OpencodeClient {
  baseUrl: string
  /** The project folder every request is routed to (null: the server's cwd). */
  directory: string | null
  /** The same client, routed to the project instance of `directory`. */
  forDirectory(directory: string): OpencodeClient
  health(): Promise<{ healthy: boolean; version: string }>
  createSession(body?: { title?: string }): Promise<OpencodeHttpSession>
  prompt(sessionId: string, body: {
    parts: OpencodePromptPart[]
    noReply?: boolean
    model?: OpencodeModelRef
    /** Reasoning variant of `model` (session.prompt `variant`, a name from its `variants`). */
    variant?: string
    /**
     * Extra system text for this message (session.prompt `system`, 1.18.29
     * openapi fixture): EYAS sends the task's recalled memory here.
     */
    system?: string
  }): Promise<OpencodePromptResult>
  /** The models the server can use and their reasoning variants — never the providers' credentials. */
  listProviders(): Promise<OpencodeModelCatalog>
  abort(sessionId: string): Promise<void>
  diff(sessionId: string): Promise<FileDiff[]>
  /**
   * Answer a `permission.asked` request. EYAS only ever sends 'once' or
   * 'reject' — never 'always', so no standing grant outlives the call.
   */
  replyPermission(sessionId: string, requestId: string, reply: OpencodePermissionReply): Promise<void>
  deleteSession(sessionId: string): Promise<void>
  subscribeEvents(signal: AbortSignal, onEvent: (event: OpencodeEvent) => void): Promise<void>
}

export interface OpencodePromptResult {
  text: string
  /** The model that answered, when the reply's `info` names it. */
  model?: OpencodeModelRef
  /** The variant it ran with; absent when the reply names none. */
  variant?: string
}

export interface OpencodeClientOptions {
  fetchImpl?: typeof fetch
  /** Basic-auth password of the server (OPENCODE_SERVER_PASSWORD); username 'opencode'. */
  password?: string
  /** Project folder the requests are routed to. */
  directory?: string | null
}

function unwrapSession(data: unknown): OpencodeHttpSession {
  if (!data || typeof data !== 'object') throw new OpencodeHttpError('invalid session payload', 500)
  const rec = data as Record<string, unknown>
  const inner = (rec.info && typeof rec.info === 'object' ? rec.info : rec) as Record<string, unknown>
  const id = inner.id
  if (typeof id !== 'string' || !id) throw new OpencodeHttpError('session id missing', 500)
  return {
    id,
    title: typeof inner.title === 'string' ? inner.title : undefined,
    directory: typeof inner.directory === 'string' ? inner.directory : undefined,
  }
}

function textFromPromptResult(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const rec = data as Record<string, unknown>
  const parts = Array.isArray(rec.parts) ? rec.parts : []
  const bits: string[] = []
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue
    const p = part as Record<string, unknown>
    if (p.type === 'text' && typeof p.text === 'string') bits.push(p.text)
  }
  return bits.join('\n').trim()
}

const modelIdSchema = z.string().trim().min(1).max(OPENCODE_MODEL_ID_MAX).regex(OPENCODE_ID_PATTERN)
const variantIdSchema = z.string().trim().min(1).max(OPENCODE_VARIANT_MAX).regex(OPENCODE_ID_PATTERN)
const displayNameSchema = z.string().trim().min(1).max(OPENCODE_MODEL_ID_MAX)

/** Upper bounds of what one catalog may hold (a hostile or broken server cannot flood the UI). */
const MAX_PROVIDERS = 200
const MAX_MODELS_PER_PROVIDER = 2_000
const MAX_VARIANTS_PER_MODEL = 32

/** The reply's AssistantMessage fields that name what actually ran (fixture promptReplyInfo). */
const PromptReplyInfoSchema = z.object({
  providerID: modelIdSchema,
  modelID: modelIdSchema,
  variant: variantIdSchema.optional(),
})

function promptResultFrom(data: unknown): OpencodePromptResult {
  const text = textFromPromptResult(data)
  const info = data && typeof data === 'object' ? (data as Record<string, unknown>).info : undefined
  const parsed = PromptReplyInfoSchema.safeParse(info)
  if (!parsed.success) return { text }
  const { providerID, modelID, variant } = parsed.data
  return { text, model: { providerID, modelID }, ...(variant ? { variant } : {}) }
}

/** A window beyond this is not a real model's (a broken or hostile catalog entry). */
const MAX_CONTEXT_WINDOW = 100_000_000
const limitTokensSchema = z.number().int().positive().max(MAX_CONTEXT_WINDOW).optional().catch(undefined)
/** A model's `limit` (fixture config-providers.json): context, sometimes input, and output. */
const ModelLimitSchema = z.object({ context: limitTokensSchema, input: limitTokensSchema })

/**
 * The tokens a model takes in, from OpenCode's own `limit`: the input limit
 * when OpenCode lists one (some models keep part of the context for output),
 * else the context window — the smaller when both are there. null when
 * neither is a usable token count.
 */
function contextWindowFrom(raw: unknown): number | null {
  const limit = ModelLimitSchema.safeParse(raw)
  if (!limit.success) return null
  const { context, input } = limit.data
  if (context && input) return Math.min(context, input)
  return input ?? context ?? null
}

function modelFrom(key: string, raw: unknown): OpencodeModelInfo | null {
  const id = modelIdSchema.safeParse(key)
  if (!id.success || !raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const name = displayNameSchema.safeParse(rec.name)
  const variants: OpencodeModelInfo['variants'] = []
  if (rec.variants && typeof rec.variants === 'object' && !Array.isArray(rec.variants)) {
    for (const variantKey of Object.keys(rec.variants)) {
      if (variants.length >= MAX_VARIANTS_PER_MODEL) break
      const variant = variantIdSchema.safeParse(variantKey)
      if (!variant.success) continue
      // Provider-specific names stay as they are; a name on the canonical
      // ladder also carries its rung, so the UI can label it like every
      // other effort select.
      variants.push({ id: variant.data, level: isEffortLevel(variant.data) ? variant.data : null })
    }
  }
  const contextWindow = contextWindowFrom(rec.limit)
  return { id: id.data, name: name.success ? name.data : id.data, variants, ...(contextWindow ? { contextWindow } : {}) }
}

function providerFrom(raw: unknown): OpencodeProviderInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const id = modelIdSchema.safeParse(rec.id)
  if (!id.success || !rec.models || typeof rec.models !== 'object' || Array.isArray(rec.models)) return null
  const name = displayNameSchema.safeParse(rec.name)
  const models: OpencodeModelInfo[] = []
  for (const [key, value] of Object.entries(rec.models as Record<string, unknown>)) {
    if (models.length >= MAX_MODELS_PER_PROVIDER) break
    const model = modelFrom(key, value)
    if (model) models.push(model)
  }
  models.sort((a, b) => a.name.localeCompare(b.name))
  // Only id, name and models are copied: `key` (the API key), `options` and
  // `env` are credentials or configuration and never leave the sidecar.
  return { id: id.data, name: name.success ? name.data : id.data, models }
}

/**
 * GET /config/providers → the catalog, parsed tolerantly: an entry that does
 * not have the expected shape is skipped, not fatal, so one odd provider or
 * model does not hide the rest. A body without a providers array is an error.
 */
export function parseProviderCatalog(data: unknown): OpencodeModelCatalog {
  const rec = data && typeof data === 'object' ? (data as Record<string, unknown>) : null
  if (!rec || !Array.isArray(rec.providers)) {
    throw new OpencodeHttpError('invalid /config/providers payload', 502)
  }
  const providers: OpencodeProviderInfo[] = []
  for (const raw of rec.providers.slice(0, MAX_PROVIDERS)) {
    const provider = providerFrom(raw)
    if (provider && !providers.some((p) => p.id === provider.id)) providers.push(provider)
  }
  providers.sort((a, b) => a.name.localeCompare(b.name))
  const defaults: Record<string, string> = {}
  if (rec.default && typeof rec.default === 'object' && !Array.isArray(rec.default)) {
    for (const [providerId, modelId] of Object.entries(rec.default as Record<string, unknown>)) {
      const p = modelIdSchema.safeParse(providerId)
      const m = modelIdSchema.safeParse(modelId)
      if (p.success && m.success && providers.some((x) => x.id === p.data)) defaults[p.data] = m.data
    }
  }
  return { providers, defaults }
}

function diffsFrom(data: unknown): FileDiff[] {
  const list = Array.isArray(data) ? data : []
  const out: FileDiff[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    if (typeof rec.path !== 'string') continue
    out.push({
      path: rec.path,
      additions: typeof rec.additions === 'number' ? rec.additions : 0,
      deletions: typeof rec.deletions === 'number' ? rec.deletions : 0,
      patch: typeof rec.patch === 'string' ? rec.patch : typeof rec.diff === 'string' ? rec.diff : undefined,
    })
  }
  return out
}

export function createOpencodeHttpClient(baseUrl: string, options: OpencodeClientOptions = {}): OpencodeClient {
  const root = baseUrl.replace(/\/+$/, '')
  const fetchImpl = options.fetchImpl ?? fetch
  const directory = options.directory ?? null
  const authorization = options.password
    ? `Basic ${Buffer.from(`opencode:${options.password}`).toString('base64')}`
    : null

  function url(path: string): string {
    if (!directory) return `${root}${path}`
    const sep = path.includes('?') ? '&' : '?'
    return `${root}${path}${sep}directory=${encodeURIComponent(directory)}`
  }

  function baseHeaders(): Record<string, string> {
    return authorization ? { Authorization: authorization } : {}
  }

  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const res = await fetchImpl(url(path), {
      ...init,
      headers: {
        Accept: 'application/json',
        ...baseHeaders(),
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new OpencodeHttpError(`OpenCode ${path} failed (${res.status}): ${body.slice(0, 400)}`, res.status)
    }
    if (res.status === 204) return null
    const text = await res.text()
    if (!text) return null
    try {
      return JSON.parse(text) as unknown
    } catch {
      return text
    }
  }

  const sid = (id: string) => encodeURIComponent(id)

  return {
    baseUrl: root,
    directory,

    forDirectory(dir) {
      return createOpencodeHttpClient(root, { ...options, fetchImpl, directory: dir })
    },

    async health() {
      const data = await request('/global/health')
      const rec = data && typeof data === 'object' ? data as Record<string, unknown> : {}
      return {
        healthy: rec.healthy === true || rec.healthy === undefined,
        version: typeof rec.version === 'string' ? rec.version : 'unknown',
      }
    },

    async createSession(body = {}) {
      const payload = typeof body.title === 'string' ? { title: body.title } : {}
      const data = await request('/session', { method: 'POST', body: JSON.stringify(payload) })
      return unwrapSession(data)
    },

    async prompt(sessionId, body) {
      const data = await request(`/session/${sid(sessionId)}/message`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      return promptResultFrom(data)
    },

    async listProviders() {
      return parseProviderCatalog(await request('/config/providers'))
    },

    async abort(sessionId) {
      await request(`/session/${sid(sessionId)}/abort`, { method: 'POST' })
    },

    async diff(sessionId) {
      const data = await request(`/session/${sid(sessionId)}/diff`)
      return diffsFrom(data)
    },

    async replyPermission(sessionId, requestId, reply) {
      try {
        await request(`/permission/${sid(requestId)}/reply`, {
          method: 'POST',
          body: JSON.stringify({ reply }),
        })
      } catch (err) {
        // Servers older than the fixture only have the per-session route.
        if (!(err instanceof OpencodeHttpError) || err.status !== 404) throw err
        await request(`/session/${sid(sessionId)}/permissions/${sid(requestId)}`, {
          method: 'POST',
          body: JSON.stringify({ response: reply }),
        })
      }
    },

    async deleteSession(sessionId) {
      await request(`/session/${sid(sessionId)}`, { method: 'DELETE' })
    },

    async subscribeEvents(signal, onEvent) {
      const res = await fetchImpl(url('/event'), {
        headers: { Accept: 'text/event-stream', ...baseHeaders() },
        signal,
      })
      if (!res.ok || !res.body) {
        throw new OpencodeHttpError(`OpenCode /event failed (${res.status})`, res.status)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (!signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const [events, rest] = parseSSEBuffer<OpencodeEvent>(buffer)
        buffer = rest
        for (const event of events) {
          if (event && typeof event.type === 'string') onEvent(event)
        }
      }
    },
  }
}
