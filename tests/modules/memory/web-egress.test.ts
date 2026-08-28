// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Cap 6 — the 5th digest bucket (External) is filled by an OFF-by-default,
// SSRF-guarded web-egress step. fetchExternalDigest fetches each configured URL
// via the injected safeFetch, extracts a title, and is fail-open per URL.

import { describe, it, expect, vi } from 'vitest'
import { fetchExternalDigest } from '@modules/memory/web-egress'

describe('fetchExternalDigest', () => {
  it('fetches each URL via safeFetch and extracts a title + host', async () => {
    const safeFetch = vi.fn(async () => new Response('<html><head><title>Daily News</title></head><body>x</body></html>', { status: 200 }))
    const items = await fetchExternalDigest({ urls: ['https://example.com/feed'], safeFetch })
    expect(items).toHaveLength(1)
    expect(items[0]).toContain('Daily News')
    expect(items[0]).toContain('example.com')
    expect(safeFetch).toHaveBeenCalledWith('https://example.com/feed')
  })

  it('is fail-open per URL: an SSRF / fetch error is skipped, not thrown', async () => {
    const safeFetch = vi.fn(async () => { throw new Error('SSRF guard blocked request: forbidden IP') })
    const items = await fetchExternalDigest({ urls: ['https://blocked.internal'], safeFetch, logger: { warn: vi.fn() } })
    expect(items).toEqual([])
  })

  it('skips non-2xx responses', async () => {
    const safeFetch = vi.fn(async () => new Response('nope', { status: 500 }))
    const items = await fetchExternalDigest({ urls: ['https://example.com'], safeFetch })
    expect(items).toEqual([])
  })

  it('falls back to the host when there is no <title>', async () => {
    const safeFetch = vi.fn(async () => new Response('{"data":1}', { status: 200 }))
    const items = await fetchExternalDigest({ urls: ['https://api.example.org/v1'], safeFetch })
    expect(items[0]).toContain('api.example.org')
  })

  it('bounds memory on a headerless huge body: stops reading once maxBytes is hit', async () => {
    // A streamed response with NO content-length header (declared-length check
    // is skipped). Without a streaming cap the whole body would be buffered.
    let pulls = 0
    const chunk = new TextEncoder().encode('<title>Huge Feed</title>' + 'a'.repeat(2000))
    const safeFetch = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls++
          if (pulls > 5000) { controller.close(); return }
          controller.enqueue(chunk)
        },
      })
      const res = new Response(stream, { status: 200 })
      // Ensure no content-length is advertised for this streamed body.
      expect(res.headers.get('content-length')).toBeNull()
      return res
    })

    const items = await fetchExternalDigest({
      urls: ['https://firehose.example.com'],
      safeFetch,
      maxBytes: 500,
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toContain('Huge Feed')
    // The reader must have been cancelled early — far fewer than the 5000 chunks
    // the (effectively unbounded) stream would otherwise emit.
    expect(pulls).toBeLessThan(10)
  })

  it('returns [] for no URLs and caps at maxItems', async () => {
    const okFetch = vi.fn(async () => new Response('<title>t</title>', { status: 200 }))
    expect(await fetchExternalDigest({ urls: [], safeFetch: okFetch })).toEqual([])
    const urls = Array.from({ length: 10 }, (_, i) => `https://h${i}.example.com`)
    const items = await fetchExternalDigest({ urls, safeFetch: okFetch, maxItems: 3 })
    expect(items).toHaveLength(3)
  })
})
