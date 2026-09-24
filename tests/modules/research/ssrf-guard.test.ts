// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  checkUrlForSsrf,
  isIpLiteral,
  isForbiddenIp,
  buildRevalidatingLookup,
} from '@modules/research/ssrf-guard'

/**
 * SSRF guard tests.
 *
 * Pinning down the forbidden ranges means the next time IANA (or a
 * reviewer) revises the list, breaking a range here trips a test — the
 * guard is the thin line between "research fetched a public site" and
 * "research leaked cloud credentials from the metadata service".
 */

describe('isIpLiteral', () => {
  it('recognises IPv4 dotted quads', () => {
    expect(isIpLiteral('8.8.8.8')).toBe(true)
    expect(isIpLiteral('127.0.0.1')).toBe(true)
    expect(isIpLiteral('256.0.0.0')).toBe(false) // octet out of range
    expect(isIpLiteral('1.2.3')).toBe(false)     // missing octet
  })

  it('recognises IPv6 literals (roughly)', () => {
    expect(isIpLiteral('::1')).toBe(true)
    expect(isIpLiteral('fe80::1')).toBe(true)
    expect(isIpLiteral('example.com')).toBe(false)
  })
})

describe('isForbiddenIp — IPv4', () => {
  it('blocks loopback 127.0.0.0/8', () => {
    expect(isForbiddenIp('127.0.0.1')).toBe(true)
    expect(isForbiddenIp('127.1.2.3')).toBe(true)
  })

  it('blocks "this network" 0.0.0.0/8', () => {
    expect(isForbiddenIp('0.0.0.0')).toBe(true)
    expect(isForbiddenIp('0.1.2.3')).toBe(true)
  })

  it('blocks RFC 1918 private ranges', () => {
    expect(isForbiddenIp('10.0.0.1')).toBe(true)
    expect(isForbiddenIp('172.16.0.1')).toBe(true)
    expect(isForbiddenIp('172.31.255.255')).toBe(true)
    expect(isForbiddenIp('172.32.0.0')).toBe(false) // just outside /12
    expect(isForbiddenIp('192.168.1.1')).toBe(true)
  })

  it('blocks link-local / cloud metadata 169.254.0.0/16', () => {
    // Critical — this range includes the AWS/GCP/Azure metadata endpoint.
    expect(isForbiddenIp('169.254.169.254')).toBe(true)
    expect(isForbiddenIp('169.254.0.1')).toBe(true)
  })

  it('blocks carrier-grade NAT 100.64.0.0/10', () => {
    expect(isForbiddenIp('100.64.0.1')).toBe(true)
    expect(isForbiddenIp('100.127.255.255')).toBe(true)
    expect(isForbiddenIp('100.63.255.255')).toBe(false)
    expect(isForbiddenIp('100.128.0.0')).toBe(false)
  })

  it('blocks multicast 224.0.0.0/4', () => {
    expect(isForbiddenIp('224.0.0.1')).toBe(true)
    expect(isForbiddenIp('239.255.255.255')).toBe(true)
  })

  it('blocks reserved 240.0.0.0/4 incl. broadcast', () => {
    expect(isForbiddenIp('240.0.0.1')).toBe(true)
    expect(isForbiddenIp('255.255.255.255')).toBe(true)
  })

  it('allows ordinary public IPs', () => {
    expect(isForbiddenIp('8.8.8.8')).toBe(false)
    expect(isForbiddenIp('1.1.1.1')).toBe(false)
    expect(isForbiddenIp('93.184.216.34')).toBe(false) // example.com
  })
})

describe('isForbiddenIp — IPv6', () => {
  it('blocks loopback', () => {
    expect(isForbiddenIp('::1')).toBe(true)
    expect(isForbiddenIp('::')).toBe(true)
  })

  it('blocks unique-local fc00::/7', () => {
    expect(isForbiddenIp('fc00::1')).toBe(true)
    expect(isForbiddenIp('fd12:3456:789a::1')).toBe(true)
  })

  it('blocks link-local fe80::/10', () => {
    expect(isForbiddenIp('fe80::1')).toBe(true)
  })

  it('blocks multicast ff00::/8', () => {
    expect(isForbiddenIp('ff02::1')).toBe(true)
  })

  it('blocks IPv4-mapped private addresses', () => {
    // Classic trick: ::ffff:169.254.169.254 must still be rejected.
    expect(isForbiddenIp('::ffff:169.254.169.254')).toBe(true)
    expect(isForbiddenIp('::ffff:127.0.0.1')).toBe(true)
    expect(isForbiddenIp('::ffff:10.0.0.1')).toBe(true)
  })

  it('allows ordinary public v6 addresses', () => {
    expect(isForbiddenIp('2001:4860:4860::8888')).toBe(false) // Google DNS
  })

  it('blocks BRACKETED IPv6 literals (url.hostname keeps the brackets)', () => {
    // Regression: url.hostname yields '[::1]' with brackets; the guard must
    // strip them before classifying or every bracketed literal bypasses it.
    expect(isForbiddenIp('[::1]')).toBe(true)
    expect(isForbiddenIp('[::]')).toBe(true)
    expect(isForbiddenIp('[fc00::1]')).toBe(true)
    expect(isForbiddenIp('[fe80::1]')).toBe(true)
    expect(isForbiddenIp('[ff02::1]')).toBe(true)
    expect(isForbiddenIp('[::ffff:169.254.169.254]')).toBe(true)
    expect(isForbiddenIp('[2001:4860:4860::8888]')).toBe(false) // public stays public
  })

  it('blocks IPv4-mapped IPv6 in COMPRESSED HEX form (::ffff:7f00:1)', () => {
    expect(isForbiddenIp('::ffff:7f00:1')).toBe(true)        // 127.0.0.1
    expect(isForbiddenIp('::ffff:a9fe:a9fe')).toBe(true)     // 169.254.169.254
    expect(isForbiddenIp('[::ffff:7f00:1]')).toBe(true)      // + brackets
    expect(isForbiddenIp('::ffff:0808:0808')).toBe(false)    // 8.8.8.8 public
  })
})

describe('checkUrlForSsrf', () => {
  const fakeResolve = (map: Record<string, string[]>) =>
    async (host: string): Promise<string[]> => {
      const ips = map[host]
      if (!ips) throw new Error(`no mock for ${host}`)
      return ips
    }

  it('rejects non-HTTP(S) schemes', async () => {
    const r = await checkUrlForSsrf('file:///etc/passwd')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/scheme/)
  })

  it('rejects http:// by default (allows only https://)', async () => {
    const r = await checkUrlForSsrf('http://example.com/', {
      resolve: fakeResolve({ 'example.com': ['93.184.216.34'] }),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/scheme/)
  })

  it('allows http:// when allowHttp is set and the IP is public', async () => {
    const r = await checkUrlForSsrf('http://example.com/', {
      allowHttp: true,
      resolve: fakeResolve({ 'example.com': ['93.184.216.34'] }),
    })
    expect(r.ok).toBe(true)
  })

  it('blocks direct IP literal if in a forbidden range', async () => {
    const r = await checkUrlForSsrf('https://169.254.169.254/latest/meta-data/')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/forbidden range/)
  })

  it('blocks bracketed IPv6 literal URLs (loopback / link-local / metadata)', async () => {
    // These parse to url.hostname === '[::1]' etc.; without bracket-stripping
    // the guard returned ok:true and EYAS would fetch the internal target.
    for (const u of [
      'https://[::1]:8080/',
      'https://[fc00::1]/',
      'https://[fe80::1]/',
      'https://[::ffff:169.254.169.254]/latest/meta-data/',
      'https://[::ffff:7f00:1]/',
    ]) {
      const r = await checkUrlForSsrf(u)
      expect(r.ok, `expected block for ${u}`).toBe(false)
      if (!r.ok) expect(r.reason).toMatch(/forbidden range/)
    }
  })

  it('allows a bracketed PUBLIC IPv6 literal and reports it un-bracketed', async () => {
    const r = await checkUrlForSsrf('https://[2001:4860:4860::8888]/')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.resolvedIps).toEqual(['2001:4860:4860::8888'])
  })

  it('blocks hostnames that resolve to a forbidden IP', async () => {
    const r = await checkUrlForSsrf('https://evil.internal/', {
      resolve: fakeResolve({ 'evil.internal': ['10.0.0.5'] }),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('10.0.0.5')
  })

  it('rejects multi-A-record tricks (any bad IP → reject whole request)', async () => {
    // First A is public, second is private. Must reject — otherwise a
    // TOCTOU between resolve and connect lets the private IP through.
    const r = await checkUrlForSsrf('https://sneaky.example.com/', {
      resolve: fakeResolve({ 'sneaky.example.com': ['93.184.216.34', '127.0.0.1'] }),
    })
    expect(r.ok).toBe(false)
  })

  it('respects hostnameBlocklist independent of IP resolution', async () => {
    const r = await checkUrlForSsrf('https://internal-api/', {
      hostnameBlocklist: ['internal-api'],
      resolve: fakeResolve({ 'internal-api': ['93.184.216.34'] }),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/explicitly blocked/)
  })

  it('returns ok + resolved IPs for a clean HTTPS URL', async () => {
    const r = await checkUrlForSsrf('https://example.com/articles/1', {
      resolve: fakeResolve({ 'example.com': ['93.184.216.34'] }),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.resolvedIps).toEqual(['93.184.216.34'])
      expect(r.url.hostname).toBe('example.com')
    }
  })

  it('surfaces DNS failures as a clear rejection', async () => {
    const r = await checkUrlForSsrf('https://nonexistent.invalid/', {
      resolve: async () => { throw new Error('ENOTFOUND') },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/DNS/)
  })

  it('rejects invalid URL strings', async () => {
    const r = await checkUrlForSsrf('not a url')
    expect(r.ok).toBe(false)
  })

  it('times out a hanging resolver (dnsTimeoutMs)', async () => {
    const r = await checkUrlForSsrf('https://slow.example.com/', {
      dnsTimeoutMs: 20,
      resolve: () => new Promise(() => {}), // never resolves
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/DNS|timeout/i)
  })
})

describe('buildRevalidatingLookup — connect-time DNS-rebinding pin', () => {
  // The undici connect.lookup runs at ACTUAL socket-connect time, so the IP it
  // validates is the IP the socket uses — the rebinding TOCTOU is gone. These
  // exercise the Node-style dns.lookup contract the dispatcher relies on.
  const run = (
    lookup: ReturnType<typeof buildRevalidatingLookup>,
    hostname: string,
    options: unknown,
  ) =>
    new Promise<{ err: Error | null; address?: unknown; family?: number }>((resolve) => {
      lookup(hostname, options, (err, address, family) =>
        resolve({ err, address, family }),
      )
    })

  it('rejects at connect time when the (re)resolved address is forbidden', async () => {
    // Attacker DNS flips to loopback on the connection lookup — must be refused.
    const lookup = buildRevalidatingLookup(async () => ['127.0.0.1'])
    const { err } = await run(lookup, 'rebind.example.com', { family: 0 })
    expect(err).toBeInstanceOf(Error)
    expect(err?.message).toMatch(/forbidden IP 127\.0\.0\.1/)
  })

  it('rejects when ANY of the resolved addresses is forbidden', async () => {
    const lookup = buildRevalidatingLookup(async () => ['93.184.216.34', '169.254.169.254'])
    const { err } = await run(lookup, 'mixed.example.com', {})
    expect(err).toBeInstanceOf(Error)
    expect(err?.message).toMatch(/169\.254\.169\.254/)
  })

  it('passes the validated public address through (single form)', async () => {
    const lookup = buildRevalidatingLookup(async () => ['93.184.216.34'])
    const { err, address, family } = await run(lookup, 'ok.example.com', { all: false })
    expect(err).toBeNull()
    expect(address).toBe('93.184.216.34')
    expect(family).toBe(4)
  })

  it('honours the all:true contract (returns {address,family} entries)', async () => {
    const lookup = buildRevalidatingLookup(async () => ['93.184.216.34', '2606:2800::1'])
    const { err, address } = await run(lookup, 'ok.example.com', { all: true })
    expect(err).toBeNull()
    expect(address).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800::1', family: 6 },
    ])
  })

  it('errors when resolution yields nothing', async () => {
    const lookup = buildRevalidatingLookup(async () => [])
    const { err } = await run(lookup, 'empty.example.com', {})
    expect(err).toBeInstanceOf(Error)
    expect(err?.message).toMatch(/no addresses/)
  })
})
