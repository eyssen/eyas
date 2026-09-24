import { describe, it, expect } from 'vitest'
import { assertTunnelToken, sanitizeTunnelToken } from '@modules/ingress/tunnel-token.js'

const JWT =
  'eyJhIjoiYWFhIiwiVCI6InRlc3QiLCJTI6InMzIn0.eyJ0IjoidHVubmVsIn0.signature'

/** Real Cloudflare tokens are one base64 JSON blob, not header.payload.sig */
const COMPACT = Buffer.from(
  JSON.stringify({ a: 'acct', t: '0d3b7f61-fd5f-44c3-9222-6d7043f03703', s: 'secret' }),
).toString('base64')

describe('sanitizeTunnelToken', () => {
  it('extracts --token from an install command', () => {
    expect(
      sanitizeTunnelToken(`sudo cloudflared service install ${JWT}`),
    ).toBe(JWT)
    expect(
      sanitizeTunnelToken(`cloudflared tunnel --no-autoupdate run --token ${COMPACT}`),
    ).toBe(COMPACT)
  })

  it('strips quotes and zero-width characters', () => {
    expect(sanitizeTunnelToken(`"${COMPACT}"`)).toBe(COMPACT)
    expect(sanitizeTunnelToken(`\u200B${COMPACT}\u200B`)).toBe(COMPACT)
  })
})

describe('assertTunnelToken', () => {
  it('accepts a compact Cloudflare token (eyJ JSON, no dots)', () => {
    expect(COMPACT.startsWith('eyJ')).toBe(true)
    expect(COMPACT.includes('.')).toBe(false)
    expect(assertTunnelToken(COMPACT)).toBe(COMPACT)
  })

  it('accepts a three-part JWT', () => {
    expect(assertTunnelToken(JWT)).toBe(JWT)
  })

  it('rejects a tunnel name', () => {
    expect(() => assertTunnelToken('eyas')).toThrow(/not a Cloudflare tunnel token/)
  })

  it('rejects a tunnel UUID', () => {
    expect(() => assertTunnelToken('0d3b7f61-fd5f-44c3-9222-6d7043f03703')).toThrow(/tunnel ID/)
  })
})

