// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Thin HTTP wrapper around gmail.googleapis.com for the EYAS Gmail provider.
 *
 * Responsibilities:
 *   - Enforce the hardcoded base URL (SSRF defense)
 *   - Add Authorization: Bearer <token> and a 30s timeout
 *   - On 401, force a single token refresh and retry once
 *   - On 429 / 5xx, apply exponential backoff with jitter (bounded retries)
 *   - Surface parsed JSON responses
 */

import type { Logger } from 'pino'
import type { TokenManager } from './oauth2-flow.js'
import {
  ATTACHMENT_SIZE_CAP_BYTES,
  GMAIL_BASE_URL,
  HTTP_TIMEOUT_MS,
  type FetchLike,
  type GmailAttachmentResponse,
  type GmailHistoryListResponse,
  type GmailMessageResource,
  type GmailMessagesListResponse,
  type GmailSendResponse,
} from './types.js'

export class GmailHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: string,
  ) {
    super(message)
    this.name = 'GmailHttpError'
  }
}

export interface GmailClientOptions {
  tokens: TokenManager
  fetchImpl?: FetchLike
  logger?: Logger
  /** Deterministic sleep/jitter hooks for tests */
  sleep?: (ms: number) => Promise<void>
  jitter?: () => number
  maxRetries?: number
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function assertSafeUrl(url: string): void {
  if (!url.startsWith(GMAIL_BASE_URL + '/') && url !== GMAIL_BASE_URL) {
    throw new Error(`Gmail client: refused URL outside base (${GMAIL_BASE_URL}): ${url}`)
  }
}

export class GmailClient {
  private readonly tokens: TokenManager
  private readonly fetchImpl: FetchLike
  private readonly logger?: Logger
  private readonly sleep: (ms: number) => Promise<void>
  private readonly jitter: () => number
  private readonly maxRetries: number

  constructor(opts: GmailClientOptions) {
    this.tokens = opts.tokens
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.logger = opts.logger
    this.sleep = opts.sleep ?? defaultSleep
    this.jitter = opts.jitter ?? Math.random
    this.maxRetries = opts.maxRetries ?? 4
  }

  private async request<T>(
    path: string,
    init: RequestInit & { expectJson?: boolean } = {},
  ): Promise<T> {
    const url = `${GMAIL_BASE_URL}${path}`
    assertSafeUrl(url)

    let attempt = 0
    let refreshed = false
    // Bounded loop to satisfy the linter; attempts are capped by maxRetries.
    for (;;) {
      const token = await this.tokens.getAccessToken()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
      let res: Response
      try {
        res = await this.fetchImpl(url, {
          ...init,
          headers: {
            ...(init.headers ?? {}),
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }

      if (res.ok) {
        if (init.expectJson === false) {
          // Drain the body to free the socket but return nothing typed.
          await res.text().catch(() => '')
          return undefined as unknown as T
        }
        return (await res.json()) as T
      }

      if (res.status === 401 && !refreshed) {
        refreshed = true
        this.logger?.debug('Gmail: 401 received, forcing token refresh')
        await this.tokens.forceRefresh()
        continue
      }

      if ((res.status === 429 || (res.status >= 500 && res.status < 600)) && attempt < this.maxRetries) {
        const retryAfterHeader = res.headers.get('Retry-After')
        const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : NaN
        const base = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(30_000, 500 * 2 ** attempt)
        const delay = Math.max(0, Math.floor(base + base * 0.25 * this.jitter()))
        this.logger?.debug({ status: res.status, attempt, delay }, 'Gmail: retrying')
        await this.sleep(delay)
        attempt += 1
        continue
      }

      const body = await res.text().catch(() => '')
      throw new GmailHttpError(res.status, `Gmail API ${res.status} on ${path}`, body)
    }
  }

  async listUnread(params: { maxResults?: number; pageToken?: string } = {}): Promise<GmailMessagesListResponse> {
    const q = new URLSearchParams({ q: 'is:unread' })
    if (params.maxResults) q.set('maxResults', String(params.maxResults))
    if (params.pageToken) q.set('pageToken', params.pageToken)
    return this.request<GmailMessagesListResponse>(`/messages?${q.toString()}`)
  }

  async listByQuery(q: string, opts: { maxResults?: number; pageToken?: string } = {}): Promise<GmailMessagesListResponse> {
    const qs = new URLSearchParams({ q })
    if (opts.maxResults) qs.set('maxResults', String(opts.maxResults))
    if (opts.pageToken) qs.set('pageToken', opts.pageToken)
    return this.request<GmailMessagesListResponse>(`/messages?${qs.toString()}`)
  }

  async getMessage(id: string, format: 'full' | 'metadata' | 'raw' = 'full'): Promise<GmailMessageResource> {
    // Validate id to prevent path injection/SSRF-adjacent abuse.
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Gmail: invalid message id')
    return this.request<GmailMessageResource>(`/messages/${id}?format=${format}`)
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<GmailAttachmentResponse> {
    if (!/^[A-Za-z0-9_-]+$/.test(messageId)) throw new Error('Gmail: invalid message id')
    if (!/^[A-Za-z0-9_-]+$/.test(attachmentId)) throw new Error('Gmail: invalid attachment id')
    const res = await this.request<GmailAttachmentResponse>(`/messages/${messageId}/attachments/${attachmentId}`)
    if (res.size && res.size > ATTACHMENT_SIZE_CAP_BYTES) {
      throw new Error(`Gmail: attachment ${attachmentId} exceeds ${ATTACHMENT_SIZE_CAP_BYTES} byte cap (size=${res.size})`)
    }
    return res
  }

  async sendRaw(rawBase64Url: string): Promise<GmailSendResponse> {
    return this.request<GmailSendResponse>('/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: rawBase64Url }),
    })
  }

  async modifyLabels(id: string, params: { addLabelIds?: string[]; removeLabelIds?: string[] }): Promise<GmailMessageResource> {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Gmail: invalid message id')
    return this.request<GmailMessageResource>(`/messages/${id}/modify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
  }

  async listHistory(params: { startHistoryId: string; pageToken?: string; historyTypes?: string[] }): Promise<GmailHistoryListResponse> {
    const qs = new URLSearchParams({ startHistoryId: params.startHistoryId })
    if (params.pageToken) qs.set('pageToken', params.pageToken)
    for (const t of params.historyTypes ?? ['messageAdded']) qs.append('historyTypes', t)
    return this.request<GmailHistoryListResponse>(`/history?${qs.toString()}`)
  }

  async getProfile(): Promise<{ emailAddress: string; messagesTotal?: number; threadsTotal?: number; historyId?: string }> {
    return this.request('/profile')
  }
}
