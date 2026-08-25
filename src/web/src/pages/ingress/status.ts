export interface IngressStatusPayload {
  active?: boolean
  running?: boolean
  url?: string
  hostname?: string
  tokenConfigured?: boolean
  connectedAt?: string | null
  lastError?: string | null
  status?: {
    active?: boolean
    running?: boolean
    url?: string
    hostname?: string
    connectedAt?: string | null
    lastError?: string | null
  }
}

export function unwrapIngressStatus(data: IngressStatusPayload | null): {
  active: boolean
  running: boolean
  url?: string
  hostname?: string
  tokenConfigured: boolean
  connectedAt?: string | null
  lastError?: string | null
} {
  if (!data) return { active: false, running: false, tokenConfigured: false }
  const inner = data.status && typeof data.status === 'object' ? data.status : data
  const running = Boolean(inner.running ?? data.running)
  const explicit = inner.active ?? data.active
  return {
    running,
    // Old payloads only had `running`; new ones set `active` only after Cloudflare registers.
    active: explicit === undefined ? running : Boolean(explicit),
    url: inner.url ?? data.url,
    hostname: inner.hostname ?? data.hostname,
    tokenConfigured: Boolean(data.tokenConfigured),
    connectedAt: inner.connectedAt ?? data.connectedAt,
    lastError: inner.lastError ?? data.lastError,
  }
}
