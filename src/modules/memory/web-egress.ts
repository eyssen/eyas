// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Cap 6 dream-engine — the OFF-by-default, SSRF-guarded web-egress step that
// fills the digest's "External" bucket. Every fetch goes through the injected
// safeFetch (research/ssrf-guard) which re-validates each redirect hop, so a
// public URL can't 302 into the metadata service / LAN. Fail-open per URL: one
// bad feed never breaks the briefing. The runtime gate is the config flag
// (memory.reflection.webEgress.enabled, OFF by default); the 'WebEgress' CASL
// subject exists for any future operator-facing toggle (the scheduled job runs
// as the system and is gated by config, not by an ability check).

export interface WebEgressOptions {
  urls: string[]
  /** SSRF-safe fetch (research/ssrf-guard safeFetch). Injected for testability. */
  safeFetch: (url: string, init?: RequestInit) => Promise<Response>
  /** Max URLs fetched (bounded egress). Default 5. */
  maxItems?: number
  /** Max bytes read per feed (bounds memory on a hostile/huge response). Default 512 KB. */
  maxBytes?: number
  logger?: { warn?: (m: string) => void }
}

function hostOf(url: string): string {
  try { return new URL(url).host } catch { return url }
}

function extractTitle(body: string, fallback: string): string {
  const m = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!m) return fallback
  const t = m[1].replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, 120) : fallback
}

/**
 * Read a response body but stop once maxBytes have been consumed, so a hostile
 * or huge response that omits Content-Length can't be buffered whole into
 * memory. Streams from res.body and cancels the reader as soon as the cap is
 * hit; falls back to a capped res.text() when no readable stream is available.
 */
async function readCappedText(res: Response, maxBytes: number): Promise<string> {
  const body: ReadableStream<Uint8Array> | null = (res as any).body ?? null
  if (!body || typeof body.getReader !== 'function') {
    return (await res.text()).slice(0, maxBytes)
  }
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let out = ''
  let total = 0
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        total += value.byteLength
        out += decoder.decode(value, { stream: true })
      }
    }
    out += decoder.decode()
  } finally {
    // Abort the underlying request once we have enough — bounds egress/memory.
    try { await reader.cancel() } catch { /* already closed */ }
  }
  return out.slice(0, maxBytes)
}

/**
 * Fetch a bounded set of external feeds and return one digest line per
 * reachable URL ("<title> — <host>"). Each URL is independent and fail-open.
 */
export async function fetchExternalDigest(opts: WebEgressOptions): Promise<string[]> {
  const max = opts.maxItems ?? 5
  const maxBytes = opts.maxBytes ?? 512_000
  const items: string[] = []
  for (const url of opts.urls.slice(0, max)) {
    try {
      const res = await opts.safeFetch(url)
      if (!res.ok) {
        opts.logger?.warn?.(`web-egress: ${url} returned ${res.status}`)
        continue
      }
      const declared = Number(res.headers.get('content-length') ?? '0')
      if (declared > maxBytes) {
        opts.logger?.warn?.(`web-egress: ${url} body too large (${declared} > ${maxBytes}), skipped`)
        continue
      }
      const host = hostOf(url)
      // Bound memory even when Content-Length is absent: stream the body and
      // stop reading once maxBytes are consumed instead of buffering it whole.
      const body = await readCappedText(res, maxBytes)
      items.push(`${extractTitle(body, host)} — ${host}`)
    } catch (err) {
      // SSRF block, network error, etc. — skip this feed, keep the rest.
      opts.logger?.warn?.(`web-egress: skipped ${url}: ${String(err)}`)
    }
  }
  return items
}
