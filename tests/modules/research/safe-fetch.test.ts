// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// safeFetch wraps checkUrlForSsrf with a manual-redirect loop that re-validates
// EVERY hop. This closes the TOCTOU/redirect-follow bypass: previously callers
// validated the initial URL then fetch(url, {redirect:'follow'}) would happily
// follow a 302 to an internal target without re-checking.

import { describe, it, expect, vi } from 'vitest'
import { safeFetch } from '@modules/research/ssrf-guard'

const resolver = (map: Record<string, string[]>) => async (h: string) => map[h] ?? []

describe('safeFetch — SSRF-guarded fetch with per-hop redirect re-validation', () => {
  it('rejects a URL whose hostname resolves to a forbidden IP', async () => {
    const fetchImpl = vi.fn()
    await expect(
      safeFetch('https://evil.test/', {}, { resolve: resolver({ 'evil.test': ['169.254.169.254'] }), fetchImpl }),
    ).rejects.toThrow(/forbidden|169\.254/i)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects a redirect that points at an internal target (re-validates the Location)', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/' } }),
    )
    await expect(
      safeFetch('https://good.test/', {}, { resolve: resolver({ 'good.test': ['1.2.3.4'] }), fetchImpl }),
    ).rejects.toThrow(/forbidden|169\.254/i)
    // The first hop was fetched, the forbidden redirect target was NOT.
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('follows a safe redirect and returns the final response', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://other.good/' } }))
      .mockResolvedValueOnce(new Response('hello', { status: 200 }))
    const res = await safeFetch('https://good.test/', {}, {
      resolve: resolver({ 'good.test': ['1.2.3.4'], 'other.good': ['5.6.7.8'] }),
      fetchImpl,
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('hello')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('returns the response for a safe direct URL', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }))
    const res = await safeFetch('https://good.test/', {}, {
      resolve: resolver({ 'good.test': ['1.2.3.4'] }),
      fetchImpl,
    })
    expect(res.status).toBe(200)
  })
})
