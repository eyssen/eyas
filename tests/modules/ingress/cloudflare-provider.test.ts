import { describe, it, expect } from 'vitest'
import {
  createCloudflareProvider,
  hostnameToUrl,
  resolveCloudflaredBinary,
} from '@modules/ingress/providers/cloudflare.js'
import { publicIngressStatus } from '@modules/ingress/types.js'
import { unwrapIngressStatus } from '@/pages/ingress/status'

describe('hostnameToUrl', () => {
  it('prefixes https when scheme is missing', () => {
    expect(hostnameToUrl('eyas.example.com')).toBe('https://eyas.example.com')
  })

  it('keeps an existing scheme', () => {
    expect(hostnameToUrl('https://eyas.example.com/')).toBe('https://eyas.example.com')
  })

  it('returns undefined for empty hostname', () => {
    expect(hostnameToUrl('')).toBeUndefined()
    expect(hostnameToUrl(undefined)).toBeUndefined()
  })

  it('rejects an email mistaken for a hostname', () => {
    expect(() => hostnameToUrl('jarvis-krisz@eyssen.ai')).toThrow(/email/)
  })
})

describe('resolveCloudflaredBinary', () => {
  it('throws when CLOUDFLARED_PATH points at a missing file', () => {
    const prev = process.env.CLOUDFLARED_PATH
    process.env.CLOUDFLARED_PATH = '/tmp/eyas-no-such-cloudflared'
    try {
      expect(() => resolveCloudflaredBinary()).toThrow(/CLOUDFLARED_PATH/)
    } finally {
      if (prev === undefined) delete process.env.CLOUDFLARED_PATH
      else process.env.CLOUDFLARED_PATH = prev
    }
  })
})

describe('createCloudflareProvider', () => {
  it('rejects start without a token', async () => {
    const provider = createCloudflareProvider()
    await expect(provider.start({})).rejects.toThrow(/token is required/i)
    expect(provider.getStatus().running).toBe(false)
    expect(provider.getStatus().active).toBe(false)
  })

  it('rejects start when CLOUDFLARED_PATH is invalid', async () => {
    const prev = process.env.CLOUDFLARED_PATH
    process.env.CLOUDFLARED_PATH = '/tmp/eyas-no-such-cloudflared'
    const provider = createCloudflareProvider()
    try {
      const compact = Buffer.from(
        JSON.stringify({ a: 'acct', t: '0d3b7f61-fd5f-44c3-9222-6d7043f03703', s: 'x' }),
      ).toString('base64')
      await expect(provider.start({ token: compact })).rejects.toThrow(/CLOUDFLARED_PATH/)
    } finally {
      if (prev === undefined) delete process.env.CLOUDFLARED_PATH
      else process.env.CLOUDFLARED_PATH = prev
    }
  })
})

describe('publicIngressStatus', () => {
  it('exposes running both at the top level and under status', () => {
    const out = publicIngressStatus({
      running: true,
      active: true,
      url: 'https://eyas.example.com',
    })
    expect(out.running).toBe(true)
    expect(out.active).toBe(true)
    expect(out.status.running).toBe(true)
  })
})

describe('unwrapIngressStatus', () => {
  it('reads nested status.running from the old API shape', () => {
    expect(unwrapIngressStatus({ status: { running: true, url: 'https://x' } })).toEqual({
      active: true,
      running: true,
      url: 'https://x',
      hostname: undefined,
      tokenConfigured: false,
      connectedAt: undefined,
      lastError: undefined,
    })
  })

  it('reads flat active from the new API shape', () => {
    expect(unwrapIngressStatus({ active: true, running: true, url: 'https://x' }).active).toBe(true)
  })

  it('treats missing payload as disconnected', () => {
    expect(unwrapIngressStatus(null)).toEqual({
      active: false,
      running: false,
      tokenConfigured: false,
    })
  })

  it('surfaces tokenConfigured from the settings/status payload', () => {
    expect(unwrapIngressStatus({ tokenConfigured: true, hostname: 'eyas.example.com' }).tokenConfigured).toBe(true)
  })
})
