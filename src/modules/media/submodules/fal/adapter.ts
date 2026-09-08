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

const PROVIDER_ID = 'fal'
const SERVER_NAME = 'fal'
const MCP_URL = 'https://mcp.fal.ai/mcp'
const SECRET_NAME = 'fal-api-key'
const DEFAULT_IMAGE_ENDPOINT = 'fal-ai/flux/dev'
const REQUESTER = { userId: 'system', role: 'owner', trusted: true } as const

const SYNC_KINDS = new Set<MediaKind>(['image', 'upscale', 'edit', 'audio'])

const COMPLETED = new Set(['completed', 'complete', 'success', 'succeeded', 'done', 'finished'])
const FAILED = new Set(['failed', 'fail', 'error', 'errored'])
const CANCELLED = new Set(['cancelled', 'canceled'])
const RUNNING = new Set(['running', 'in_progress', 'in-progress', 'processing', 'started'])
const QUEUED = new Set(['queued', 'created', 'pending', 'waiting', 'new', 'in_queue'])

export function createFalAdapter(deps: {
  mcp: Pick<McpClient, 'callTool' | 'list' | 'add' | 'connect' | 'disconnect' | 'get' | 'update'>
  secrets: Pick<SecretsRegistry, 'get'>
  logger: Logger
}): MediaProvider {
  const { mcp, secrets, logger } = deps
  let keyKnown = false

  function findServer(): McpServerRecord | null {
    return mcp.list().find((s) => s.name === SERVER_NAME) ?? null
  }

  function isConfigured(): boolean {
    const row = findServer()
    if (row?.status === 'connected') return true
    return keyKnown
  }

  async function readApiKey(): Promise<string | null> {
    try {
      const key = await secrets.get(SECRET_NAME, 'system', REQUESTER)
      keyKnown = typeof key === 'string' && key.length > 0
      return keyKnown ? key : null
    } catch {
      keyKnown = false
      return null
    }
  }

  async function ensureServer(): Promise<McpServerRecord> {
    const apiKey = await readApiKey()
    const fields = {
      name: SERVER_NAME,
      transport: 'sse' as const,
      url: MCP_URL,
      authType: 'bearer' as const,
      ownedBy: 'media',
      autoStart: true,
      ...(apiKey ? { apiKey } : {}),
    }

    const existing = findServer()
    if (existing) {
      await mcp.update(existing.id, fields)
      return mcp.get(existing.id) ?? existing
    }

    try {
      return await mcp.add(fields)
    } catch (err: any) {
      const again = findServer()
      if (again) {
        await mcp.update(again.id, fields)
        return mcp.get(again.id) ?? again
      }
      throw err
    }
  }

  async function invoke(name: string, args: Record<string, unknown>) {
    const server = findServer() ?? await ensureServer()
    return mcp.callTool(server.id, name, args)
  }

  const adapter: MediaProvider = {
    id: PROVIDER_ID,
    name: 'fal',
    capabilities: MEDIA_KINDS,
    get configured() {
      return isConfigured()
    },

    async connect() {
      const key = await readApiKey()
      if (!key) {
        throw new Error('fal API key is not configured')
      }
      const rec = await ensureServer()
      await mcp.connect(rec.id)
      await readApiKey()
    },

    async disconnect() {
      const rec = findServer()
      if (rec) {
        try { await mcp.disconnect(rec.id) } catch { /* already down */ }
      }
      keyKnown = false
    },

    async catalog(kind?: MediaKind): Promise<MediaModel[]> {
      const args: Record<string, unknown> = kind ? { query: kind } : {}
      try {
        const resp = await invoke('search_models', args)
        const payload = parseMcpPayload(resp)
        if (payload.error) {
          logger.warn({ error: payload.error }, 'fal search_models failed')
          return []
        }
        const models = modelsFromPayload(payload, kind ?? 'image')
        return kind ? models.filter((m) => m.kind === kind) : models
      } catch (err: any) {
        logger.warn({ err: err?.message }, 'fal search_models failed')
        return []
      }
    },

    async generate(req: MediaGenerateRequest): Promise<MediaJob> {
      const ts = new Date().toISOString()
      const tool = SYNC_KINDS.has(req.kind) ? 'run_model' : 'submit_job'
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
        const checkResp = await invoke('check_job', {
          request_id: providerJobId,
          id: providerJobId,
        })
        const checkPayload = parseMcpPayload(checkResp)
        if (checkPayload.error) {
          return { status: 'failed' as const, resultUrls: [], error: String(checkPayload.error), credits: null }
        }
        const status = statusFromPayload(checkPayload)
        let urls = extractUrls(checkPayload)
        let error = status === 'failed' ? errorFromPayload(checkPayload) : null
        let credits = numberOrNull(checkPayload.credits ?? checkPayload.credit ?? checkPayload.cost)

        if (status === 'completed') {
          const resultResp = await invoke('get_job_result', {
            request_id: providerJobId,
            id: providerJobId,
          })
          const resultPayload = parseMcpPayload(resultResp)
          if (resultPayload.error) {
            return { status: 'failed' as const, resultUrls: [], error: String(resultPayload.error), credits: null }
          }
          const resultUrls = extractUrls(resultPayload)
          if (resultUrls.length > 0) urls = resultUrls
          credits = numberOrNull(resultPayload.credits ?? resultPayload.credit ?? resultPayload.cost) ?? credits
        }

        return { status, resultUrls: urls, error, credits }
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
      try {
        await invoke('cancel_job', { request_id: jobId, id: jobId })
      } catch (err: any) {
        logger.warn({ err: err?.message, jobId }, 'fal cancel_job failed')
      }
    },

    async balance(): Promise<MediaBalance | null> {
      return null
    },
  }

  return adapter
}

function endpointId(req: MediaGenerateRequest): string {
  if (req.model) return req.model
  return DEFAULT_IMAGE_ENDPOINT
}

function buildGenerateArgs(req: MediaGenerateRequest): Record<string, unknown> {
  const options = { ...(req.options ?? {}) }
  const urls = (req.references ?? [])
    .map((r) => r.url)
    .filter((u): u is string => typeof u === 'string' && u.length > 0)
  const documentIds = (req.references ?? [])
    .map((r) => r.documentId)
    .filter((u): u is string => typeof u === 'string' && u.length > 0)

  const input: Record<string, unknown> = {
    prompt: req.prompt,
    ...options,
  }
  if (req.kind === 'audio') input.text = req.prompt
  if (urls.length > 0) {
    input.image_url = urls[0]
    input.references = urls
  }
  if (documentIds.length > 0) input.document_ids = documentIds

  return {
    endpoint_id: endpointId(req),
    input,
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
    payload.request_id ?? payload.requestId ?? payload.task_id ?? payload.taskId ?? payload.id ?? generateId(),
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
    model: req.model ?? (typeof payload.model === 'string' ? payload.model : typeof payload.endpoint_id === 'string' ? payload.endpoint_id : null),
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
  return 'fal job failed'
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

function kindFromRow(row: Record<string, unknown>, fallback: MediaKind): MediaKind {
  const raw = String(row.kind ?? row.category ?? row.task ?? row.task_type ?? '')
  if ((MEDIA_KINDS as readonly string[]).includes(raw)) return raw as MediaKind
  const s = raw.toLowerCase()
  if (s.includes('video')) return 'video'
  if (s.includes('audio')) return 'audio'
  if (s.includes('upscale')) return 'upscale'
  if (s.includes('3d') || s.includes('mesh')) return '3d'
  if (s.includes('edit')) return 'edit'
  if (s.includes('image')) return 'image'
  return fallback
}

function modelsFromPayload(payload: Record<string, unknown>, kind: MediaKind): MediaModel[] {
  const raw = payload.models ?? payload.data ?? payload.items ?? payload.results
  const list = Array.isArray(raw) ? raw : Array.isArray(payload) ? (payload as unknown as unknown[]) : []
  const out: MediaModel[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const id = String(row.id ?? row.endpoint_id ?? row.model ?? row.slug ?? row.name ?? '')
    if (!id) continue
    const label = String(row.label ?? row.name ?? row.title ?? id)
    out.push({ id, label, kind: kindFromRow(row, kind), providerId: PROVIDER_ID })
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
    if ('request_id' in r || 'task_id' in r || 'status' in r || 'url' in r) return r
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
    return { error: text ?? 'fal tool error' }
  }

  if (obj.structuredContent && typeof obj.structuredContent === 'object') {
    return obj.structuredContent as Record<string, unknown>
  }

  const text = firstTextContent(obj)
  if (text) {
    const parsed = tryJsonObject(text)
    if (parsed) return parsed
  }

  if (
    'request_id' in obj || 'task_id' in obj || 'status' in obj || 'url' in obj
    || 'credits' in obj || 'models' in obj || 'images' in obj
  ) {
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
