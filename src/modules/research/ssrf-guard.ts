// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { lookup } from 'node:dns/promises'
import { isBun } from '@shared/platform.js'

/**
 * SSRF guard for research fetches.
 *
 * The research module retrieves arbitrary user-supplied URLs (search-result
 * pages, cross-references). Without filtering, a prompt-injected result
 * pointing at http://169.254.169.254/ (cloud instance metadata) or
 * http://127.0.0.1:8080/admin would pull internal data straight back into
 * the model's context.
 *
 * This guard runs in two stages:
 *   1. URL parse + scheme + hostname/port shape check (cheap, sync)
 *   2. DNS lookup + per-IP blocklist match against loopback, private,
 *      link-local, multicast, reserved ranges (async, one resolve per
 *      unique hostname)
 *
 * DNS-rebinding defence: the up-front check alone is a TOCTOU — fetch would
 * re-resolve the hostname and a low-TTL attacker record could hand a public
 * IP to the guard and 127.0.0.1 to the connection. safeFetch closes this on
 * the Node runtime by installing an undici dispatcher whose connect-time
 * `lookup` re-classifies the address the socket is ACTUALLY about to use and
 * refuses forbidden ranges, so the validated IP and the connected IP are the
 * same one. (Bun's fetch does not honour a custom dispatcher; there the
 * up-front guard remains the boundary — a known runtime limitation.)
 *
 * Zero dependencies — the blocklist is a short table of CIDR prefixes
 * specific to "private / internal / never publicly routable" ranges per
 * IANA. Keeping it in-tree avoids pulling ssrf-req-filter (or similar)
 * which bring Node-version-sensitive transitive deps.
 */

export interface SsrfCheckOptions {
  /** Allow http:// (otherwise only https://). Default false. */
  allowHttp?: boolean
  /** Extra hostnames to block regardless of IP (e.g. internal DNS names). */
  hostnameBlocklist?: string[]
  /**
   * Override for tests — feed a synthetic DNS resolver that returns the
   * IPs you want the guard to see. Real code uses node:dns under the hood.
   */
  resolve?: (hostname: string) => Promise<string[]>
  /** Cap on DNS lookup in ms. Default 5000. */
  dnsTimeoutMs?: number
}

export type SsrfCheckResult =
  | { ok: true; url: URL; resolvedIps: string[] }
  | { ok: false; reason: string }

const DEFAULT_DNS_TIMEOUT_MS = 5000

/**
 * Validate a URL for SSRF safety. Returns ok:true with resolved IPs when
 * safe, ok:false with a reason otherwise.
 */
export async function checkUrlForSsrf(
  raw: string,
  opts: SsrfCheckOptions = {},
): Promise<SsrfCheckResult> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'invalid URL' }
  }

  // Scheme — only http(s); reject file://, ftp://, gopher://, data:, etc.
  if (url.protocol !== 'https:' && !(opts.allowHttp && url.protocol === 'http:')) {
    return { ok: false, reason: `scheme not allowed: ${url.protocol}` }
  }

  if (!url.hostname) return { ok: false, reason: 'missing hostname' }
  // WHATWG URL keeps the brackets on IPv6 literals (url.hostname === '[::1]').
  // Strip them before ANY classification — otherwise isForbiddenIp compares the
  // bracketed string against un-bracketed forms and every bracketed IPv6 literal
  // ([::1], [fc00::1], [fe80::1], [::ffff:169.254.169.254], …) sails through.
  const hostname = stripBrackets(url.hostname)

  if (opts.hostnameBlocklist?.includes(hostname) || opts.hostnameBlocklist?.includes(url.hostname)) {
    return { ok: false, reason: `hostname explicitly blocked: ${hostname}` }
  }

  // If the hostname is already a numeric IP literal, check it directly
  // without a DNS round-trip.
  if (isIpLiteral(hostname)) {
    if (isForbiddenIp(hostname)) {
      return { ok: false, reason: `IP literal in forbidden range: ${hostname}` }
    }
    return { ok: true, url, resolvedIps: [hostname] }
  }

  // Resolve. We race the lookup against a timeout so a hanging resolver
  // cannot stall the research loop.
  let resolved: string[]
  try {
    resolved = await raceWithTimeout(
      resolveAll(hostname, opts.resolve),
      opts.dnsTimeoutMs ?? DEFAULT_DNS_TIMEOUT_MS,
    )
  } catch (err: any) {
    return { ok: false, reason: `DNS resolution failed: ${err?.message ?? String(err)}` }
  }

  if (resolved.length === 0) {
    return { ok: false, reason: 'DNS returned no addresses' }
  }

  // All resolved IPs must be safe — a single private IP in the list is
  // enough to reject (defeats multi-A-record tricks).
  for (const ip of resolved) {
    if (isForbiddenIp(ip)) {
      return { ok: false, reason: `resolved to forbidden IP ${ip} (hostname: ${hostname})` }
    }
  }

  return { ok: true, url, resolvedIps: resolved }
}

/** Raised by safeFetch when a URL (or any redirect hop) fails the SSRF guard. */
export class SsrfError extends Error {
  constructor(reason: string) {
    super(`SSRF guard blocked request: ${reason}`)
    this.name = 'SsrfError'
  }
}

export interface SafeFetchOptions extends SsrfCheckOptions {
  /** Max redirect hops to follow (each re-validated). Default 5. */
  maxRedirects?: number
  /** Override fetch (tests). Defaults to the global fetch. */
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>
}

/**
 * SSRF-safe fetch. Validates the URL with checkUrlForSsrf, then fetches with
 * redirect:'manual' and RE-VALIDATES every redirect Location before following
 * it. This closes the TOCTOU/redirect-follow bypass where a public URL 302s to
 * an internal target (e.g. cloud metadata) that the initial check never saw.
 *
 * Throws SsrfError on any blocked hop or when the redirect budget is exceeded.
 * Use for any fetch of untrusted/externally-influenced URLs.
 */
export async function safeFetch(
  raw: string,
  init: RequestInit = {},
  opts: SafeFetchOptions = {},
): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? 5
  const usingRealFetch = !opts.fetchImpl
  const doFetch = opts.fetchImpl ?? fetch
  let currentUrl = raw

  // Pin against DNS rebinding: when using the real fetch, route it through an
  // undici dispatcher whose connect-time lookup re-classifies the address the
  // socket actually resolves to (see buildRevalidatingLookup). Only meaningful
  // on Node — Bun ignores the dispatcher, so it falls back to the up-front
  // guard. Passed only for real fetches; injected fetchImpl (tests) is untouched.
  const dispatcher = usingRealFetch ? await getRevalidatingDispatcher() : undefined

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = await checkUrlForSsrf(currentUrl, opts)
    if (!check.ok) throw new SsrfError(check.reason)

    const fetchInit = { ...init, redirect: 'manual' as const }
    if (dispatcher) (fetchInit as Record<string, unknown>).dispatcher = dispatcher
    const res = await doFetch(currentUrl, fetchInit)

    // Manual redirect handling: re-validate the Location before following.
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) return res // 3xx with no Location — hand back as-is
      currentUrl = new URL(location, currentUrl).toString()
      continue
    }
    return res
  }

  throw new SsrfError(`too many redirects (> ${maxRedirects})`)
}

// IP classification

/** Strip a single pair of surrounding brackets from an IPv6 literal. */
function stripBrackets(host: string): string {
  return host.length > 1 && host.startsWith('[') && host.endsWith(']')
    ? host.slice(1, -1)
    : host
}

/** True if the string is a bare IPv4 or IPv6 literal (not hostname). */
export function isIpLiteral(s: string): boolean {
  const h = stripBrackets(s)
  return isIpv4(h) || isIpv6(h)
}

function isIpv4(s: string): boolean {
  const parts = s.split('.')
  if (parts.length !== 4) return false
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return false
    const n = Number(p)
    if (n < 0 || n > 255) return false
  }
  return true
}

function isIpv6(s: string): boolean {
  // Rough check: anything with a colon that isn't 'ipv4:port'. Good enough
  // for classification — node:net would be exhaustive but needs an import.
  if (!s.includes(':')) return false
  if (isIpv4(s.split(':')[0]) && s.split(':').length === 2) return false // "1.2.3.4:80"
  return /^[0-9a-fA-F:]+$/.test(s) || s.startsWith('::') || /:[0-9a-fA-F]+/.test(s)
}

/**
 * True when the IP is in a range that should NEVER be reachable from
 * research fetches: loopback, private networks, link-local, multicast,
 * reserved. Conservative — if we cannot classify it, we don't call it
 * forbidden (scheme/hostname checks above catch most weird inputs first).
 */
export function isForbiddenIp(rawIp: string): boolean {
  const ip = stripBrackets(rawIp)
  if (isIpv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    // 0.0.0.0/8      "this network"
    if (a === 0) return true
    // 127.0.0.0/8    loopback
    if (a === 127) return true
    // 10.0.0.0/8     RFC 1918 private
    if (a === 10) return true
    // 172.16.0.0/12  RFC 1918 private
    if (a === 172 && b >= 16 && b <= 31) return true
    // 192.168.0.0/16 RFC 1918 private
    if (a === 192 && b === 168) return true
    // 169.254.0.0/16 link-local (cloud metadata!)
    if (a === 169 && b === 254) return true
    // 100.64.0.0/10  carrier-grade NAT
    if (a === 100 && b >= 64 && b <= 127) return true
    // 224.0.0.0/4    multicast
    if (a >= 224 && a <= 239) return true
    // 240.0.0.0/4    reserved / future use (incl. 255.255.255.255 broadcast)
    if (a >= 240) return true
    return false
  }

  // IPv6 — coarse but covers dangerous cases
  const lower = ip.toLowerCase()
  if (lower === '::' || lower === '::1') return true
  // ::ffff:A.B.C.D — IPv4-mapped, recurse on the embedded IPv4. The tail may be
  // dotted (::ffff:127.0.0.1) OR compressed hex (::ffff:7f00:1) — both denote
  // the same IPv4 and both must be classified, or the hex form is a bypass.
  const ipv4MappedPrefix = '::ffff:'
  if (lower.startsWith(ipv4MappedPrefix)) {
    const tail = lower.slice(ipv4MappedPrefix.length)
    if (isIpv4(tail)) return isForbiddenIp(tail)
    const groups = tail.split(':')
    if (groups.length === 2 && groups.every(g => /^[0-9a-f]{1,4}$/.test(g))) {
      const hi = parseInt(groups[0], 16)
      const lo = parseInt(groups[1], 16)
      const dotted = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
      return isForbiddenIp(dotted)
    }
  }
  // fc00::/7 — unique local (private)
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true
  // fe80::/10 — link-local
  if (lower.startsWith('fe8') || lower.startsWith('fe9') ||
      lower.startsWith('fea') || lower.startsWith('feb')) return true
  // ff00::/8 — multicast
  if (lower.startsWith('ff')) return true
  return false
}

// DNS-rebinding pin

/** Node-style dns.lookup callback: (err) | (err, address, family) | (err, entries[]). */
type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address?: string | Array<{ address: string; family: number }>,
  family?: number,
) => void

/**
 * Build a Node `dns.lookup`-compatible function for undici's `connect.lookup`.
 * It resolves the hostname (real DNS by default, or an injected resolver for
 * tests), REJECTS if any returned address is in a forbidden range, and only
 * then hands the address to the socket. Because net/tls.connect connects to
 * exactly the address this returns, the validated IP and the connected IP are
 * identical — the DNS-rebinding TOCTOU window is closed.
 */
export function buildRevalidatingLookup(
  resolve?: (hostname: string) => Promise<string[]>,
): (hostname: string, options: unknown, callback?: LookupCallback) => void {
  return (hostname, options, callback) => {
    const cb = (typeof options === 'function' ? options : callback) as LookupCallback
    const opts = (typeof options === 'function' ? {} : (options ?? {})) as { all?: boolean; family?: number }

    resolveAll(hostname, resolve)
      .then((ips) => {
        if (!ips || ips.length === 0) {
          cb(new Error(`no addresses for ${hostname}`) as NodeJS.ErrnoException)
          return
        }
        for (const ip of ips) {
          if (isForbiddenIp(ip)) {
            cb(new SsrfError(`connect-time resolution of ${hostname} hit forbidden IP ${ip}`) as NodeJS.ErrnoException)
            return
          }
        }
        let entries = ips.map((ip) => ({ address: ip, family: ip.includes(':') ? 6 : 4 }))
        if (opts.family === 4 || opts.family === 6) {
          entries = entries.filter((e) => e.family === opts.family)
        }
        if (entries.length === 0) {
          cb(new Error(`no address for ${hostname} in requested family`) as NodeJS.ErrnoException)
          return
        }
        if (opts.all) cb(null, entries)
        else cb(null, entries[0].address, entries[0].family)
      })
      .catch((err) => cb(err instanceof Error ? (err as NodeJS.ErrnoException) : new Error(String(err)) as NodeJS.ErrnoException))
  }
}

// Lazily-built shared dispatcher (Node/undici only). Stateless lookup → one
// instance is safe to reuse across every request. `null` once we know pinning
// is unavailable (Bun, or undici not importable) so we don't retry the import.
let dispatcherPromise: Promise<unknown> | undefined
async function getRevalidatingDispatcher(): Promise<unknown> {
  if (isBun) return undefined // Bun's fetch ignores a custom dispatcher
  if (!dispatcherPromise) {
    dispatcherPromise = (async () => {
      try {
        const { Agent } = await import('undici')
        return new Agent({ connect: { lookup: buildRevalidatingLookup() as never } })
      } catch {
        return undefined // undici not available — fall back to the up-front guard
      }
    })()
  }
  return dispatcherPromise
}

// Helpers

async function resolveAll(
  hostname: string,
  override?: (h: string) => Promise<string[]>,
): Promise<string[]> {
  if (override) return override(hostname)
  const records = await lookup(hostname, { all: true })
  return records.map(r => r.address)
}

function raceWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
    p.then(
      v => { clearTimeout(t); resolve(v) },
      e => { clearTimeout(t); reject(e) },
    )
  })
}
