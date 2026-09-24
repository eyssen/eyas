// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// K4 — the OpenCode memory plugin's keys and per-session proofs. One key per
// OpenCode process, handed over on fd 3, alive only while that process runs.
// A call carries a one-time, fresh proof for exactly one session; a proof for
// session A never stands for session B, and the key itself is never a bearer.

import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  createPluginTokenRegistry,
  deliverPluginKey,
  isSessionProof,
  makeSessionProof,
  OPENCODE_KEY_FD,
  SESSION_PROOF_MAX_AGE_MS,
  SESSION_PROOF_PREFIX,
} from '@modules/opencode/plugin-tokens'
import { isApiKeyFormat } from '@modules/auth/api-key'

/** Re-encode a proof's payload with other fields, keeping its MAC. */
function tamper(proof: string, patch: Record<string, unknown>): string {
  const [payload, mac] = proof.slice(SESSION_PROOF_PREFIX.length).split('.') as [string, string]
  const body = { ...JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')), ...patch }
  return `${SESSION_PROOF_PREFIX}${Buffer.from(JSON.stringify(body)).toString('base64url')}.${mac}`
}

describe('OpenCode plugin keys', () => {
  it('(+) a minted key is 32 random bytes; a proof made with it names its tokenId and its session', () => {
    const tokens = createPluginTokenRegistry()
    const a = tokens.mint('serve', 'http://127.0.0.1:4100')
    const b = tokens.mint('pty', 'pty-1')
    expect(Buffer.from(a.key, 'base64url')).toHaveLength(32)
    expect(a.key).not.toBe(b.key)
    expect(a.tokenId).not.toBe(a.key)
    expect(tokens.check(makeSessionProof(a.key, 'ses_A'))).toEqual({ tokenId: a.tokenId, sessionId: 'ses_A' })
    expect(tokens.check(makeSessionProof(b.key, 'ses_B'))).toEqual({ tokenId: b.tokenId, sessionId: 'ses_B' })
    expect(tokens.size()).toBe(2)
  })

  it('(−) the key itself is not a bearer, and a proof is never mistaken for an EYAS API key', () => {
    const tokens = createPluginTokenRegistry()
    const { key } = tokens.mint('serve', 'x')
    expect(tokens.check(key)).toBeNull()
    expect(tokens.redeem(`${SESSION_PROOF_PREFIX}${key}`)).toBeNull()
    const proof = makeSessionProof(key, 'ses_A')
    expect(isSessionProof(proof)).toBe(true)
    expect(isApiKeyFormat(proof)).toBe(false)
    expect(proof).not.toContain(key)
  })

  it('(+) check does not use a proof up; (−) redeem does — a replay is refused', () => {
    const tokens = createPluginTokenRegistry()
    const { key, tokenId } = tokens.mint('serve', 'x')
    const proof = makeSessionProof(key, 'ses_A')
    expect(tokens.check(proof)).toEqual({ tokenId, sessionId: 'ses_A' })
    expect(tokens.check(proof)).not.toBeNull()
    expect(tokens.redeem(proof)).toEqual({ tokenId, sessionId: 'ses_A' })
    expect(tokens.redeem(proof)).toBeNull()
    expect(tokens.check(proof)).toBeNull()
    // A fresh proof for the same session works again.
    expect(tokens.redeem(makeSessionProof(key, 'ses_A'))).toEqual({ tokenId, sessionId: 'ses_A' })
  })

  it('(−) a proof for session A cannot be made to name session B', () => {
    const tokens = createPluginTokenRegistry()
    const { key } = tokens.mint('serve', 'x')
    const forA = makeSessionProof(key, 'ses_A')
    expect(tokens.check(tamper(forA, { s: 'ses_B' }))).toBeNull()
    // A's MAC on B's payload, and B's payload with a MAC made under another key.
    const forB = makeSessionProof(randomBytes(32).toString('base64url'), 'ses_B')
    const [payloadB] = forB.slice(SESSION_PROOF_PREFIX.length).split('.')
    const macA = forA.split('.').at(-1)
    expect(tokens.check(`${SESSION_PROOF_PREFIX}${payloadB}.${macA}`)).toBeNull()
    expect(tokens.check(forB)).toBeNull()
  })

  it('(−) a revoked key\'s proofs fail — a previous serve start\'s key is worthless', () => {
    const tokens = createPluginTokenRegistry()
    const first = tokens.mint('serve', 'start-1')
    tokens.revoke(first.tokenId)
    const second = tokens.mint('serve', 'start-2')
    expect(tokens.check(makeSessionProof(first.key, 'ses_A'))).toBeNull()
    expect(tokens.check(makeSessionProof(second.key, 'ses_A'))).toEqual({ tokenId: second.tokenId, sessionId: 'ses_A' })
    tokens.revoke(first.tokenId)
    tokens.revoke('no-such-id')
    expect(tokens.size()).toBe(1)
  })

  it('(−) a stale or future-dated proof fails; one inside the window works', () => {
    let clock = 1_000_000_000
    const tokens = createPluginTokenRegistry({ now: () => clock })
    const { key } = tokens.mint('serve', 'x')
    expect(tokens.check(makeSessionProof(key, 'ses_A', { issuedAtMs: clock - SESSION_PROOF_MAX_AGE_MS - 1 }))).toBeNull()
    expect(tokens.check(makeSessionProof(key, 'ses_A', { issuedAtMs: clock + SESSION_PROOF_MAX_AGE_MS + 1 }))).toBeNull()
    const recent = makeSessionProof(key, 'ses_A', { issuedAtMs: clock - 1_000 })
    expect(tokens.check(recent)).not.toBeNull()
    clock += SESSION_PROOF_MAX_AGE_MS
    expect(tokens.redeem(recent)).toBeNull()
  })

  it('(−) empty, foreign-format, malformed and truncated bearers fail', () => {
    const tokens = createPluginTokenRegistry()
    const { key } = tokens.mint('serve', 'x')
    const good = makeSessionProof(key, 'ses_A')
    const mac = good.split('.').at(-1)!
    const nonCanonicalMac = `${mac.slice(0, -1)}${mac.at(-1) === 'A' ? 'B' : 'A'}`
    const bad: unknown[] = [
      '', null, undefined, 42,
      'eyas_k1_abcdef1234567890abcdef1234567890',
      `eyas-oc-${key}`,
      SESSION_PROOF_PREFIX,
      good.slice(0, -2),
      `${good}x`,
      `${good}.extra`,
      `${good.slice(0, good.lastIndexOf('.'))}.${nonCanonicalMac}`,
      `${SESSION_PROOF_PREFIX}${Buffer.from('not json').toString('base64url')}.${mac}`,
      tamper(good, { extra: 1 }),
      makeSessionProof(key, 'ses_A', { nonce: 'short' }),
      makeSessionProof(key, ''),
      makeSessionProof(key, 'x'.repeat(201)),
    ]
    for (const bearer of bad) expect(tokens.check(bearer as string), String(bearer)).toBeNull()
  })

  it('(−) a key from the environment is never accepted: only minted keys verify', () => {
    const tokens = createPluginTokenRegistry()
    tokens.mint('serve', 'x')
    const operatorKey = 'eyas-oc-static-operator-key-0123456789abcdef0123456789'
    expect(tokens.check(makeSessionProof(operatorKey, 'ses_A'))).toBeNull()
  })
})

describe('handing a key to an OpenCode process (fd 3)', () => {
  function pipe() {
    const written: string[] = []
    const stream = Object.assign(new EventEmitter(), {
      ended: false,
      end(chunk: string) {
        written.push(chunk)
        this.ended = true
      },
    })
    return { stream, written }
  }

  it('(+) writes the key into the child\'s fd 3 and ends it', () => {
    const { stream, written } = pipe()
    const stdio: unknown[] = [null, null, null]
    stdio[OPENCODE_KEY_FD] = stream
    expect(deliverPluginKey({ stdio }, 'the-key')).toBe(true)
    expect(written).toEqual(['the-key'])
    expect(stream.ended).toBe(true)
    // A child that exited before reading (EPIPE) is not an EYAS error.
    expect(() => stream.emit('error', new Error('EPIPE'))).not.toThrow()
  })

  it('(−) a child without an fd-3 pipe gets nothing', () => {
    expect(deliverPluginKey({ stdio: [null, null, null] }, 'the-key')).toBe(false)
    expect(deliverPluginKey({ stdio: null }, 'the-key')).toBe(false)
    expect(deliverPluginKey({}, 'the-key')).toBe(false)
  })
})
