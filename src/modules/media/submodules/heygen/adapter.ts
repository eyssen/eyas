// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import type { McpClient } from '@modules/communication/submodules/mcp-client/client.js'
import type { McpServerRecord } from '@modules/communication/submodules/mcp-client/types.js'
import type { SecretsRegistry } from '@modules/secrets/types.js'
import { generateId } from '@shared/crypto'
import {
  type MediaBalance,
  type MediaGenerateRequest,
  type MediaJob,
  type MediaJobStatus,
  type MediaKind,
  type MediaModel,
  type MediaProvider,
} from '../../types.js'

const PROVIDER_ID = 'heygen'
const SERVER_NAME = 'heygen'
export const HEYGEN_MCP_URL = 'https://mcp.heygen.com/mcp/v1/'
export const HEYGEN_KINDS: readonly MediaKind[] = ['video', 'audio'] as const
const OAUTH_REQUESTER = { userId: 'system', role: 'owner', trusted: true } as const

const COMPLETED = new Set(['completed', 'complete', 'success', 'succeeded', 'done', 'finished'])
const FAILED = new Set(['failed', 'fail', 'error', 'errored'])
const CANCELLED = new Set(['cancelled', 'canceled', 'stopped'])
const RUNNING = new Set([
  'running',
  'in_progress',
  'in-progress',
  'processing',
  'started',
  'generating',
  'thinking',
])
const QUEUED = new Set(['queued', 'created', 'pending', 'waiting', 'new'])

const VIDEO_AGENT_KEYS = [
  'mode',
  'avatar_id',
  'voice_id',
  'style_id',
  'brand_kit_id',
  'brand_glossary_id',
  'orientation',
  'callback_url',
  'callback_id',
  'incognito_mode',
] as const

const AVATAR_VIDEO_KEYS = [
  'voice_id',
  'title',
  'aspect_ratio',
  'resolution',
  'engine',
  'orientation',
  'callback_url',
  'callback_id',
] as const

export function createHeygenAdapter(deps: {
  mcp: Pick<McpClient, 'callTool' | 'list' | 'add' | 'connect' | 'disconnect' | 'get'>
  secrets: Pick<SecretsRegistry, 'get'>
  logger: Logger
}): MediaProvider {
  const { mcp, secrets, logger } = deps
  let oauthKnown = false

  function findServer(): McpServerRecord | null {
    return mcp.list().find((s) => s.name === SERVER_NAME) ?? null
  }

  function isConfigured(): boolean {
    const row = findServer()
    if (row?.status === 'connected') return true
    return oauthKnown
  }

  async function refreshOAuthFlag(serverId?: string): Promise<void> {
    const id = serverId ?? findServer()?.id
    if (!id) {
      oauthKnown = false
      return
    }
    try {
      const token = await secrets.get(`mcp-oauth-${id}-access`, 'system', OAUTH_REQUESTER)
      oauthKnown = typeof token === 'string' && token.length > 0
    } catch {
      oauthKnown = false
    }
  }

  async function ensureServer(): Promise<McpServerRecord> {
    const existing = findServer()
    if (existing) return existing
    try {
      return await mcp.add({
        name: SERVER_NAME,
        transport: 'sse',
        url: HEYGEN_MCP_URL,
        authType: 'oauth',
        ownedBy: 'media',
        autoStart: true,
      })
    } catch (err: any) {
      const again = findServer()
      if (again) return again
      throw err
    }
  }

  async function invoke(name: string, args: Record<string, unknown>) {
    const server = findServer() ?? await ensureServer()
    return mcp.callTool(server.id, name, args)
  }

  const adapter: MediaProvider = {
    id: PROVIDER_ID,
    name: 'HeyGen',
    capabilities: HEYGEN_KINDS,
    get configured() {
      return isConfigured()
    },

    async connect() {
      const rec = await ensureServer()
      await refreshOAuthFlag(rec.id)
      await mcp.connect(rec.id)
      await refreshOAuthFlag(rec.id)
    },

    async disconnect() {
      const rec = findServer()
      if (rec) {
        try { await mcp.disconnect(rec.id) } catch { /* already down */ }
      }
      oauthKnown = false
    },

    async catalog(kind?: MediaKind): Promise<MediaModel[]> {
      if (kind && !HEYGEN_KINDS.includes(kind)) return []
      const models: MediaModel[] = []
      if (!kind || kind === 'video') {
        models.push(...await catalogFromTool('list_avatar_looks', 'video'))
      }
      if (!kind || kind === 'audio') {
        models.push(...await catalogFromTool('list_voices', 'audio'))
      }
      return models
    },

    async generate(req: MediaGenerateRequest): Promise<MediaJob> {
      const ts = new Date().toISOString()
      if (req.kind !== 'video' && req.kind !== 'audio') {
        return failedJob(req, `HeyGen does not support kind ${req.kind}`, ts)
      }
      const { tool, args } = buildGenerateCall(req)
      try {
        const resp = await invoke(tool, args)
        const payload = parseMcpPayload(resp)
        if (payload.error) {
          return failedJob(req, String(payload.error), ts)
        }
        return jobFromPayload(req, payload, ts)
      } catch (err: any) {
        return failedJob(req, err?.message ?? String(err), ts)
      }
    },

    async status(providerJobId: string) {
      try {
        if (isSessionId(providerJobId)) {
          return await statusFromSession(providerJobId)
        }
        if (providerJobId.startsWith('http://') || providerJobId.startsWith('https://')) {
          return { status: 'completed' as const, resultUrls: [providerJobId], error: null, credits: null }
        }
        const resp = await invoke('get_video', { video_id: providerJobId, id: providerJobId })
        return statusFromPayloadRow(parseMcpPayload(resp))
      } catch (err: any) {
        return {
          status: 'failed' as const,
          resultUrls: [],
          error: err?.message ?? String(err),
          credits: null,
        }
      }
    },

    async cancel(jobId: string) {
      if (!isSessionId(jobId)) return
      try {
        await invoke('stop_video_agent_session', { session_id: jobId, id: jobId })
      } catch (err: any) {
        logger.warn({ err: err?.message, jobId }, 'HeyGen stop_video_agent_session failed')
      }
    },

    async balance(): Promise<MediaBalance | null> {
      try {
        const resp = await invoke('get_current_user', {})
        const payload = parseMcpPayload(resp)
        if (payload.error) {
          logger.warn({ error: payload.error }, 'HeyGen get_current_user failed')
          return null
        }
        return {
          providerId: PROVIDER_ID,
          credits: creditsFromPayload(payload),
          unit: typeof payload.unit === 'string' ? payload.unit : 'credits',
          raw: payload,
        }
      } catch (err: any) {
        logger.warn({ err: err?.message }, 'HeyGen get_current_user failed')
        return null
      }
    },
  }

  async function catalogFromTool(tool: string, kind: MediaKind): Promise<MediaModel[]> {
    try {
      const resp = await invoke(tool, {})
      const payload = parseMcpPayload(resp)
      if (payload.error) {
        logger.warn({ tool, error: payload.error }, 'HeyGen catalog tool failed')
        return []
      }
      return modelsFromPayload(payload, kind)
    } catch (err: any) {
      logger.warn({ tool, err: err?.message }, 'HeyGen catalog tool failed')
      return []
    }
  }

  async function statusFromSession(sessionId: string) {
    const sessResp = await invoke('get_video_agent_session', { session_id: sessionId, id: sessionId })
    const sess = parseMcpPayload(sessResp)
    if (sess.error) {
      return { status: 'failed' as const, resultUrls: [], error: String(sess.error), credits: null }
    }
    const videoId = stringOrNull(sess.video_id)
    if (!videoId) {
      return statusFromPayloadRow(sess)
    }
    try {
      const vidResp = await invoke('get_video', { video_id: videoId, id: videoId })
      const vid = parseMcpPayload(vidResp)
      if (vid.error) {
        // Session may already be "completed" while the MP4 is still rendering.
        return statusFromPayloadRow({ ...sess, status: sess.status === 'failed' ? 'failed' : 'running' })
      }
      return statusFromPayloadRow({ ...sess, ...vid })
    } catch {
      return statusFromPayloadRow({ ...sess, status: sess.status === 'failed' ? 'failed' : 'running' })
    }
  }

  return adapter
}

export function buildGenerateCall(req: MediaGenerateRequest): {
  tool: string
  args: Record<string, unknown>
} {
  const options = { ...(req.options ?? {}) }
  if (req.kind === 'audio') {
    const voiceId = stringOrNull(options.voice_id) ?? req.model ?? null
    const args: Record<string, unknown> = { text: req.prompt }
    if (voiceId) args.voice_id = voiceId
    const speed = options.speed
    if (typeof speed === 'number' && Number.isFinite(speed)) args.speed = speed
    return { tool: 'create_speech', args }
  }

  const avatarId = stringOrNull(options.avatar_id) ?? req.model ?? null
  if (avatarId) {
    const args: Record<string, unknown> = {
      type: 'avatar',
      avatar_id: avatarId,
      script: req.prompt,
    }
    copyKeys(options, args, AVATAR_VIDEO_KEYS)
    return { tool: 'create_video', args }
  }

  const args: Record<string, unknown> = { prompt: req.prompt }
  const mode = options.mode
  if (mode === 'generate' || mode === 'chat') args.mode = mode
  copyKeys(options, args, VIDEO_AGENT_KEYS.filter((k) => k !== 'mode'))
  const urls = (req.references ?? [])
    .map((r) => r.url)
    .filter((u): u is string => typeof u === 'string' && u.length > 0)
  if (urls.length > 0) {
    args.files = urls.map((url) => ({ type: 'url', url }))
  }
  return { tool: 'create_video_agent', args }
}

function copyKeys(
  source: Record<string, unknown>,
  dest: Record<string, unknown>,
  keys: readonly string[],
): void {
  for (const key of keys) {
    if (key === 'mode') continue
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
      dest[key] = source[key]
    }
  }
}

function failedJob(req: MediaGenerateRequest, error: string, ts: string): MediaJob {
  return {
    id: generateId(),
    providerId: PROVIDER_ID,
    providerJobId: generateId(),
    kind: req.kind,
    status: 'failed',
    prompt: req.prompt,
    model: req.model ?? null,
    error,
    resultUrls: [],
    documentIds: [],
    credits: null,
    conversationId: req.conversationId ?? null,
    batchId: null,
    agentId: req.agentId ?? null,
    userId: req.userId ?? null,
    createdAt: ts,
    updatedAt: ts,
    completedAt: ts,
  }
}

function jobFromPayload(req: MediaGenerateRequest, payload: Record<string, unknown>, ts: string): MediaJob {
  const providerJobId = String(
    payload.session_id
    ?? payload.video_id
    ?? payload.task_id
    ?? payload.taskId
    ?? payload.id
    ?? generateId(),
  )
  const status = statusFromPayload(payload)
  const urls = extractUrls(payload)
  const terminal = status === 'completed' || status === 'failed' || status === 'cancelled'
  return {
    id: generateId(),
    providerId: PROVIDER_ID,
    providerJobId,
    kind: req.kind,
    status,
    prompt: req.prompt,
    model: req.model ?? (typeof payload.model === 'string' ? payload.model : null),
    error: status === 'failed' ? errorFromPayload(payload) : null,
    resultUrls: urls,
    documentIds: [],
    credits: creditsFromPayload(payload),
    conversationId: req.conversationId ?? null,
    batchId: null,
    agentId: req.agentId ?? null,
    userId: req.userId ?? null,
    createdAt: ts,
    updatedAt: ts,
    completedAt: terminal ? ts : null,
  }
}

function statusFromPayloadRow(payload: Record<string, unknown>) {
  if (payload.error) {
    return {
      status: 'failed' as const,
      resultUrls: [],
      error: String(payload.error),
      credits: creditsFromPayload(payload),
    }
  }
  const status = statusFromPayload(payload)
  return {
    status,
    resultUrls: extractUrls(payload),
    error: status === 'failed' ? errorFromPayload(payload) : null,
    credits: creditsFromPayload(payload),
  }
}

function statusFromPayload(payload: Record<string, unknown>): MediaJobStatus {
  const raw = payload.status ?? payload.state ?? payload.task_status
  const s = String(raw ?? '').toLowerCase()
  if (COMPLETED.has(s)) return 'completed'
  if (FAILED.has(s)) return 'failed'
  if (CANCELLED.has(s)) return 'cancelled'
  if (RUNNING.has(s)) return 'running'
  if (QUEUED.has(s)) return 'queued'
  if (payload.error) return 'failed'
  if (extractUrls(payload).length > 0) return 'completed'
  return 'queued'
}

function errorFromPayload(payload: Record<string, unknown>): string {
  if (typeof payload.error === 'string') return payload.error
  if (payload.error && typeof payload.error === 'object' && 'message' in (payload.error as object)) {
    return String((payload.error as { message: unknown }).message)
  }
  if (typeof payload.failure_message === 'string') return payload.failure_message
  if (typeof payload.message === 'string') return payload.message
  return 'HeyGen job failed'
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function isSessionId(id: string): boolean {
  return id.startsWith('sess_')
}

function creditsFromPayload(payload: Record<string, unknown>): number | null {
  const nested = payload.credits
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const row = nested as Record<string, unknown>
    const fromNested = numberOrNull(row.remaining ?? row.balance ?? row.credits)
    if (fromNested != null) return fromNested
  }
  return numberOrNull(
    payload.remaining_credits
    ?? payload.remaining
    ?? payload.credits
    ?? payload.balance
    ?? payload.quota
    ?? payload.remaining_quota,
  )
}

function modelsFromPayload(payload: Record<string, unknown>, kind: MediaKind): MediaModel[] {
  const raw =
    payload.looks
    ?? payload.avatars
    ?? payload.voices
    ?? payload.models
    ?? payload.data
    ?? payload.items
    ?? payload.results
  const list = Array.isArray(raw) ? raw : Array.isArray(payload) ? (payload as unknown as unknown[]) : []
  const out: MediaModel[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const id = String(row.id ?? row.look_id ?? row.avatar_id ?? row.voice_id ?? row.slug ?? row.name ?? '')
    if (!id) continue
    const label = String(row.label ?? row.name ?? row.title ?? row.display_name ?? id)
    out.push({ id, label, kind, providerId: PROVIDER_ID })
  }
  return out
}

function extractUrls(value: unknown, depth = 0): string[] {
  const out: string[] = []
  collectUrls(value, out, depth)
  return [...new Set(out)]
}

function collectUrls(value: unknown, out: string[], depth: number): void {
  if (depth > 5 || value == null) return
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) out.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const v of value) collectUrls(v, out, depth + 1)
    return
  }
  if (typeof value !== 'object') return
  const o = value as Record<string, unknown>
  for (const key of ['url', 'image_url', 'video_url', 'audio_url', 'download_url', 'file_url', 'thumbnail_url', 'src']) {
    const v = o[key]
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) out.push(v)
  }
  for (const key of ['urls', 'images', 'videos', 'files', 'output', 'outputs', 'generated', 'data', 'result', 'content']) {
    if (key in o) collectUrls(o[key], out, depth + 1)
  }
}

/** Parse MCP tools/call payload: JSON-RPC error, JSON in text content, or structured result. */
export function parseMcpPayload(resp: unknown): Record<string, unknown> {
  if (!resp || typeof resp !== 'object') return {}
  const r = resp as Record<string, unknown>

  if (r.error != null) {
    const err = r.error
    if (typeof err === 'string') return { error: err }
    if (err && typeof err === 'object' && 'message' in err) {
      return { error: String((err as { message: unknown }).message) }
    }
    return { error: JSON.stringify(err) }
  }

  const result = r.result
  let payload: Record<string, unknown>
  if (result == null) {
    if ('session_id' in r || 'video_id' in r || 'task_id' in r || 'status' in r || 'url' in r || 'data' in r) {
      payload = r
    } else {
      return {}
    }
  } else if (typeof result === 'string') {
    payload = tryJsonObject(result) ?? { text: result }
  } else if (typeof result !== 'object') {
    return {}
  } else {
    const obj = result as Record<string, unknown>
    if (obj.isError) {
      const text = firstTextContent(obj)
      return { error: text ?? 'HeyGen tool error' }
    }
    if (obj.structuredContent && typeof obj.structuredContent === 'object') {
      payload = obj.structuredContent as Record<string, unknown>
    } else {
      const text = firstTextContent(obj)
      if (text) {
        const parsed = tryJsonObject(text)
        payload = parsed ?? obj
      } else {
        payload = obj
      }
    }
  }

  return unwrapData(payload)
}

function unwrapData(payload: Record<string, unknown>): Record<string, unknown> {
  const data = payload.data
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return { ...payload, ...(data as Record<string, unknown>) }
  }
  return payload
}

function firstTextContent(obj: Record<string, unknown>): string | null {
  if (!Array.isArray(obj.content)) return null
  for (const part of obj.content) {
    if (!part || typeof part !== 'object') continue
    const p = part as Record<string, unknown>
    if ((p.type === 'text' || p.type == null) && typeof p.text === 'string' && p.text.trim()) {
      return p.text
    }
  }
  return null
}

function tryJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    if (Array.isArray(parsed)) return { models: parsed }
  } catch {
    return null
  }
  return null
}
