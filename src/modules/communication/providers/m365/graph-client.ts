// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { OAuth2Flow } from './oauth2-flow.js'
import {
  DEFAULT_HTTP_TIMEOUT_MS,
  GRAPH_BASE_URL,
  LoggerLike,
} from './types.js'

/**
 * Hardcoded list of permitted hosts. SSRF protection — no configuration value
 * can redirect the client away from Microsoft Graph.
 */
const ALLOWED_HOSTS = new Set<string>(['graph.microsoft.com'])

/**
 * Base URL validator: only https://graph.microsoft.com/* is acceptable.
 */
export function validateBaseUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid Graph base URL: ${url}`)
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`Graph base URL must use https: got ${parsed.protocol}`)
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`Graph base URL host not allowed: ${parsed.hostname}`)
  }
  return url.replace(/\/+$/, '')
}

export interface GraphClientOptions {
  oauth: OAuth2Flow
  baseUrl?: string
  timeoutMs?: number
  logger?: LoggerLike
  fetch?: typeof fetch
  /** Maximum retry attempts for 5xx / 429. Default: 3. */
  maxRetries?: number
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  body?: unknown
  query?: Record<string, string | undefined>
  /** Override base URL (e.g. when following @odata.nextLink). Revalidated for SSRF. */
  absoluteUrl?: string
  headers?: Record<string, string>
  /** If true, return the raw Response (used by fetchAttachment for binary). */
  raw?: boolean
}

export class GraphClient {
  private readonly baseUrl: string
  private readonly oauth: OAuth2Flow
  private readonly timeoutMs: number
  private readonly logger: LoggerLike | undefined
  private readonly fetchImpl: typeof fetch
  private readonly maxRetries: number

  constructor(opts: GraphClientOptions) {
    this.baseUrl = validateBaseUrl(opts.baseUrl ?? GRAPH_BASE_URL)
    this.oauth = opts.oauth
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS
    this.logger = opts.logger
    this.fetchImpl = opts.fetch ?? globalThis.fetch
    this.maxRetries = opts.maxRetries ?? 3
  }

  /**
   * Make an authenticated Graph API request.
   *
   * Behaviors:
   *  - 401 → refresh token once, retry exactly one time
   *  - 429 → honor Retry-After header, up to `maxRetries` attempts
   *  - 5xx → exponential backoff, up to `maxRetries` attempts
   *  - 30s timeout enforced via AbortController
   *  - Bearer tokens never logged
   */
  async request<T = unknown>(opts: RequestOptions): Promise<T> {
    const url = this.buildUrl(opts)
    let attempt = 0
    let refreshed = false

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const token = await this.oauth.getAccessToken()
      const res = await this.doFetch(url, opts, token)

      if (res.status === 401 && !refreshed) {
        refreshed = true
        await this.oauth.refreshBundle()
        continue
      }

      if (res.status === 429) {
        if (attempt >= this.maxRetries) break
        const retryAfter = this.parseRetryAfter(res)
        await sleep(retryAfter)
        attempt++
        continue
      }

      if (res.status >= 500 && res.status < 600) {
        if (attempt >= this.maxRetries) break
        await sleep(expBackoff(attempt))
        attempt++
        continue
      }

      if (opts.raw) {
        if (!res.ok) throw await this.toError(res, opts)
        return res as unknown as T
      }

      if (!res.ok) throw await this.toError(res, opts)

      if (res.status === 204) return undefined as unknown as T
      const ct = res.headers.get('content-type') ?? ''
      if (ct.includes('application/json')) {
        return (await res.json()) as T
      }
      return (await res.text()) as unknown as T
    }
    throw new Error(`Graph request exhausted retries for ${opts.method ?? 'GET'} ${opts.path}`)
  }

  private buildUrl(opts: RequestOptions): string {
    const base = opts.absoluteUrl ? validateBaseUrl(new URL(opts.absoluteUrl).origin) : this.baseUrl
    const url = new URL(opts.absoluteUrl ?? `${base}${opts.path}`)
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined) url.searchParams.set(k, v)
      }
    }
    return url.toString()
  }

  private async doFetch(url: string, opts: RequestOptions, token: string): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(opts.headers ?? {}),
      }
      let body: string | undefined
      if (opts.body !== undefined) {
        body = JSON.stringify(opts.body)
        headers['Content-Type'] = headers['Content-Type'] ?? 'application/json'
      }
      // Log without bearer token.
      this.logger?.debug(
        { method: opts.method ?? 'GET', url: redactUrlToken(url) },
        'graph-client request',
      )
      return await this.fetchImpl(url, {
        method: opts.method ?? 'GET',
        headers,
        body,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  private parseRetryAfter(res: Response): number {
    const header = res.headers.get('retry-after')
    if (!header) return 2000
    const asInt = Number.parseInt(header, 10)
    if (Number.isFinite(asInt)) return asInt * 1000
    const asDate = Date.parse(header)
    if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now())
    return 2000
  }

  private async toError(res: Response, opts: RequestOptions): Promise<Error> {
    let body = ''
    try {
      body = await res.text()
    } catch {
      /* ignore */
    }
    const snippet = body.length > 500 ? `${body.slice(0, 500)}...` : body
    return new Error(
      `Graph request failed: ${opts.method ?? 'GET'} ${opts.path} — ${res.status} ${snippet}`,
    )
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function expBackoff(attempt: number): number {
  // 500ms, 1s, 2s, 4s...
  return Math.min(30_000, 500 * 2 ** attempt)
}

/**
 * Remove any access_token / code query parameters before logging a URL.
 * Bearer tokens live in headers, never in the URL itself, but OAuth redirects
 * sometimes contain them, so redact defensively.
 */
export function redactUrlToken(url: string): string {
  try {
    const u = new URL(url)
    const sensitive = ['access_token', 'refresh_token', 'code', 'id_token']
    let mutated = false
    for (const key of sensitive) {
      if (u.searchParams.has(key)) {
        u.searchParams.set(key, '[REDACTED]')
        mutated = true
      }
    }
    return mutated ? u.toString() : url
  } catch {
    return url
  }
}
