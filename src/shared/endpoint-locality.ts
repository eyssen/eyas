// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Endpoint locality facts: which host a URL points at, and whether that host
// is this machine. Pure string logic — no DNS, no network — so the answer is
// deterministic and fails closed: anything not provably loopback is remote.

/**
 * The lower-case host of an absolute URL, IPv6 without brackets ('::1'), or
 * undefined for a malformed URL or one without a host (a scheme-less
 * 'gpu:11434' parses as scheme 'gpu:' with no host). WHATWG URL parsing
 * canonicalizes the host first, so '127.1' and '0x7f000001' read '127.0.0.1'
 * and '[0:0:0:0:0:0:0:1]' reads '::1'.
 */
export function hostOf(url: string | null | undefined): string | undefined {
  if (typeof url !== 'string' || url.trim() === '') return undefined
  let hostname: string
  try {
    hostname = new URL(url.trim()).hostname
  } catch {
    return undefined
  }
  if (!hostname) return undefined
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  return bare.toLowerCase()
}

const IPV4_LOOPBACK = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/**
 * True only for this machine's loopback: 'localhost', 127.0.0.0/8 as a
 * dotted-quad literal, and '::1' (bracketed or not). 0.0.0.0, private ranges
 * (10/8, 172.16/12, 192.168/16), '*.localhost' and every name that would need
 * DNS are NOT loopback — they may be another machine.
 */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (typeof host !== 'string') return false
  let h = host.trim().toLowerCase()
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
  if (h === 'localhost' || h === '::1') return true
  const quad = IPV4_LOOPBACK.exec(h)
  return quad !== null && quad.slice(1).every((octet) => Number(octet) <= 255)
}
