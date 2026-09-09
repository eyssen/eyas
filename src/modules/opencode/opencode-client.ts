// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Thin HTTP client for the OpenCode server OpenAPI. We do not import the
// private `opencode` package (not published, pulls its own AI SDKs). Official
// embed path is this HTTP surface: https://opencode.ai/docs/sdk

import { parseSSEBuffer } from '@shared/sse-parser.js'
import type { FileDiff, OpencodeEvent, OpencodeHttpSession, OpencodePromptPart } from './types.js'

export class OpencodeHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'OpencodeHttpError'
  }
}

export interface OpencodeClient {
  baseUrl: string
  health(): Promise<{ healthy: boolean; version: string }>
  createSession(body?: { title?: string; directory?: string }): Promise<OpencodeHttpSession>
  prompt(sessionId: string, body: {
    parts: OpencodePromptPart[]
    noReply?: boolean
    model?: { providerID: string; modelID: string }
  }): Promise<{ text: string }>
  abort(sessionId: string): Promise<void>
  diff(sessionId: string): Promise<FileDiff[]>
  subscribeEvents(signal: AbortSignal, onEvent: (event: OpencodeEvent) => void): Promise<void>
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

export function createOpencodeHttpClient(baseUrl: string, fetchImpl: typeof fetch = fetch): OpencodeClient {
  const root = baseUrl.replace(/\/+$/, '')

  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const res = await fetchImpl(`${root}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
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

  return {
    baseUrl: root,

    async health() {
      const data = await request('/global/health')
      const rec = data && typeof data === 'object' ? data as Record<string, unknown> : {}
      return {
        healthy: rec.healthy === true || rec.healthy === undefined,
        version: typeof rec.version === 'string' ? rec.version : 'unknown',
      }
    },

    async createSession(body = {}) {
      const data = await request('/session', { method: 'POST', body: JSON.stringify(body) })
      return unwrapSession(data)
    },

    async prompt(sessionId, body) {
      const data = await request(`/session/${encodeURIComponent(sessionId)}/message`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      return { text: textFromPromptResult(data) }
    },

    async abort(sessionId) {
      await request(`/session/${encodeURIComponent(sessionId)}/abort`, { method: 'POST' })
    },

    async diff(sessionId) {
      const data = await request(`/session/${encodeURIComponent(sessionId)}/diff`)
      return diffsFrom(data)
    },

    async subscribeEvents(signal, onEvent) {
      const res = await fetchImpl(`${root}/event`, {
        headers: { Accept: 'text/event-stream' },
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
