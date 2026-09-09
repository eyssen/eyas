// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import type { McpClient } from '@modules/communication/submodules/mcp-client/client.js'
import type { McpServerRecord } from '@modules/communication/submodules/mcp-client/types.js'
import type { SecretsRegistry } from '@modules/secrets/types.js'
import { generateId } from '@shared/crypto'
import {
  MEDIA_KINDS,
  type MediaBalance,
  type MediaGenerateRequest,
  type MediaJob,
  type MediaJobStatus,
  type MediaKind,
  type MediaModel,
  type MediaProvider,
} from '../../types.js'

const PROVIDER_ID = 'magnific'
const SERVER_NAME = 'magnific'
const MCP_URL = 'https://mcp.magnific.com'
const OAUTH_REQUESTER = { userId: 'system', role: 'owner', trusted: true } as const

const GENERATE_TOOLS: Record<MediaKind, string> = {
  image: 'images_generate',
  upscale: 'images_upscale',
  edit: 'images_generate',
  video: 'video_generate',
  audio: 'audio_tts',
  '3d': 'models3d_generate',
}

const COMPLETED = new Set(['completed', 'complete', 'success', 'succeeded', 'done', 'finished'])
const FAILED = new Set(['failed', 'fail', 'error', 'errored'])
const CANCELLED = new Set(['cancelled', 'canceled'])
const RUNNING = new Set(['running', 'in_progress', 'in-progress', 'processing', 'started'])
const QUEUED = new Set(['queued', 'created', 'pending', 'waiting', 'new'])

export function createMagnificAdapter(deps: {
  mcp: Pick<McpClient, 'callTool' | 'list' | 'add' | 'connect' | 'disconnect' | 'get'>
  secrets: Pick<SecretsRegistry, 'get'>
  logger: Logger
}): MediaProvider {
  const { mcp, secrets, logger } = deps
  let oauthKnown = false

  function findServer(): McpServerRecord | null {
    const listed = mcp.list().find((s) => s.name === SERVER_NAME)
    if (listed) return listed
    return null
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
        url: MCP_URL,
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
    name: 'Magnific',
    capabilities: MEDIA_KINDS,
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
      const tools: string[] = []
      if (!kind || kind === 'image' || kind === 'upscale' || kind === 'edit') {
        tools.push('images_models_list')
      }
      if (!kind || kind === 'video') {
        tools.push('video_models_list')
      }
      const models: MediaModel[] = []
      for (const tool of tools) {
        const resp = await invoke(tool, {})
        const payload = parseMcpPayload(resp)
        if (payload.error) {
          logger.warn({ tool, error: payload.error }, 'Magnific catalog tool failed')
          continue
        }
        const inferred: MediaKind = tool === 'video_models_list' ? 'video' : 'image'
        models.push(...modelsFromPayload(payload, inferred))
      }
      return kind ? models.filter((m) => m.kind === kind) : models
    },

    async generate(req: MediaGenerateRequest): Promise<MediaJob> {
      const ts = new Date().toISOString()
      const tool = GENERATE_TOOLS[req.kind]
      const args = buildGenerateArgs(req)
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
        const resp = await invoke('creation_status', { task_id: providerJobId, id: providerJobId })
        const payload = parseMcpPayload(resp)
        if (payload.error) {
          return { status: 'failed' as const, resultUrls: [], error: String(payload.error), credits: null }
        }
        const status = statusFromPayload(payload)
        return {
          status,
          resultUrls: extractUrls(payload),
          error: status === 'failed' ? errorFromPayload(payload) : null,
          credits: numberOrNull(payload.credits ?? payload.credit ?? payload.cost),
        }
      } catch (err: any) {
        return {
          status: 'failed' as const,
          resultUrls: [],
          error: err?.message ?? String(err),
          credits: null,
        }
      }
    },

    async cancel(_jobId: string) {
      // Magnific MCP has no cancel tool in the v1 unified map.
    },

    async balance(): Promise<MediaBalance | null> {
      try {
        const resp = await invoke('account_balance', {})
        const payload = parseMcpPayload(resp)
        if (payload.error) {
          logger.warn({ error: payload.error }, 'Magnific account_balance failed')
          return null
        }
        return {
          providerId: PROVIDER_ID,
          credits: numberOrNull(payload.credits ?? payload.balance ?? payload.remaining),
          unit: typeof payload.unit === 'string' ? payload.unit : 'credits',
          raw: payload,
        }
      } catch (err: any) {
        logger.warn({ err: err?.message }, 'Magnific account_balance failed')
        return null
      }
    },
  }

  return adapter
}

function buildGenerateArgs(req: MediaGenerateRequest): Record<string, unknown> {
  const options = { ...(req.options ?? {}) }
  const mode = options.mode
  delete options.mode

  const urls = (req.references ?? [])
    .map((r) => r.url)
    .filter((u): u is string => typeof u === 'string' && u.length > 0)
  const documentIds = (req.references ?? [])
    .map((r) => r.documentId)
    .filter((u): u is string => typeof u === 'string' && u.length > 0)

  const args: Record<string, unknown> = {
    prompt: req.prompt,
    ...options,
  }
  if (req.model) args.model = req.model
  if (req.kind === 'audio') args.text = req.prompt
  if (req.kind === 'upscale' && (mode === 'creative' || mode === 'precision')) {
    args.mode = mode
  }
  if (urls.length > 0) {
    args.references = urls
    if (req.kind === 'upscale' || req.kind === 'edit') args.image_url = urls[0]
  }
  if (documentIds.length > 0) args.document_ids = documentIds
  return args
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
    payload.task_id ?? payload.taskId ?? payload.creation_id ?? payload.id ?? generateId(),
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
    credits: numberOrNull(payload.credits ?? payload.credit ?? payload.cost),
    conversationId: req.conversationId ?? null,
    batchId: null,
    agentId: req.agentId ?? null,
    userId: req.userId ?? null,
    createdAt: ts,
    updatedAt: ts,
    completedAt: terminal ? ts : null,
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
  if (typeof payload.message === 'string') return payload.message
  return 'Magnific job failed'
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

function modelsFromPayload(payload: Record<string, unknown>, kind: MediaKind): MediaModel[] {
  const raw = payload.models ?? payload.data ?? payload.items ?? payload.results
  const list = Array.isArray(raw) ? raw : Array.isArray(payload) ? (payload as unknown as unknown[]) : []
  const out: MediaModel[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const id = String(row.id ?? row.model ?? row.slug ?? row.name ?? '')
    if (!id) continue
    const label = String(row.label ?? row.name ?? row.title ?? id)
    const itemKind = (MEDIA_KINDS as readonly string[]).includes(String(row.kind ?? ''))
      ? (row.kind as MediaKind)
      : kind
    out.push({ id, label, kind: itemKind, providerId: PROVIDER_ID })
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
  for (const key of ['url', 'image_url', 'video_url', 'audio_url', 'download_url', 'file_url', 'src']) {
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
  if (result == null) {
    if ('task_id' in r || 'status' in r || 'url' in r) return r
    return {}
  }

  if (typeof result === 'string') {
    const parsed = tryJsonObject(result)
    return parsed ?? { text: result }
  }

  if (typeof result !== 'object') return {}
  const obj = result as Record<string, unknown>

  if (obj.isError) {
    const text = firstTextContent(obj)
    return { error: text ?? 'Magnific tool error' }
  }

  if (obj.structuredContent && typeof obj.structuredContent === 'object') {
    return obj.structuredContent as Record<string, unknown>
  }

  const text = firstTextContent(obj)
  if (text) {
    const parsed = tryJsonObject(text)
    if (parsed) return parsed
  }

  if ('task_id' in obj || 'status' in obj || 'url' in obj || 'credits' in obj || 'models' in obj || 'balance' in obj) {
    return obj
  }

  return obj
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
