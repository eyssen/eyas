// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/shared/net-guard.ts
//
// One definition of "an address this process should not be talked into
// fetching". Originally written for the browser tools; it lives here because
// the headless browser applies it to EVERY sub-resource a probed page asks
// for, not just to the URL a caller handed in. A page is perfectly capable of
// linking a stylesheet at 169.254.169.254.

/** Wave 2 — block SSRF to private/link-local/metadata addresses. */
export function isPrivateOrLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h === '0.0.0.0' || h === '::1' || h === '::') return true
  if (h.endsWith('.local') || h.endsWith('.internal')) return true
  // IPv4 private / loopback / link-local / CGNAT
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (a === 10) return true
    if (a === 127) return true
    if (a === 0) return true
    if (a === 169 && b === 254) return true // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  }
  // IPv6 ULA / link-local
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true
  return false
}

export function assertSafeBrowserUrl(url: string, allowPrivate = false): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid URL: ${url}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`URL scheme not allowed: ${parsed.protocol}`)
  }
  if (!allowPrivate && isPrivateOrLocalHost(parsed.hostname)) {
    throw new Error(`SSRF blocked: private/local host not allowed (${parsed.hostname})`)
  }
}
