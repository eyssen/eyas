// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { createSignedMetrics } from '@modules/observability/signed-metrics'
import type { SignedRecord } from '@modules/observability/signed-metrics'

describe('signed-metrics: ed25519 roundtrip', () => {
  it('signs and verifies a payload', async () => {
    const svc = createSignedMetrics()
    await svc.generateKey('ed25519')

    const record = svc.sign({ metric: 'llm.tokens', value: 123 })
    expect(record.alg).toBe('ed25519')
    expect(record.kid).toHaveLength(14) // 10 bytes base64url = 14 chars
    expect(record.sig.length).toBeGreaterThan(0)

    const result = svc.verify(record)
    expect(result.valid).toBe(true)
  })

  it('verifies a record with nested payload', async () => {
    const svc = createSignedMetrics()
    await svc.generateKey('ed25519')
    const record = svc.sign({ a: { b: [1, 2, 3], c: 'x' }, d: null })
    expect(svc.verify(record).valid).toBe(true)
  })

  it('lazily generates a key on first sign', () => {
    const svc = createSignedMetrics()
    expect(svc.listActiveKeys()).toHaveLength(0)
    const record = svc.sign({ ok: 1 })
    expect(svc.listActiveKeys()).toHaveLength(1)
    expect(svc.verify(record).valid).toBe(true)
  })
})

describe('signed-metrics: hmac-sha256 roundtrip', () => {
  it('signs and verifies a payload', async () => {
    const svc = createSignedMetrics({ options: { algorithm: 'hmac-sha256' } })
    await svc.generateKey('hmac-sha256')
    const record = svc.sign({ log: 'hello', level: 'info' })
    expect(record.alg).toBe('hmac-sha256')
    expect(svc.verify(record).valid).toBe(true)
  })
})

describe('signed-metrics: tamper detection', () => {
  it('rejects a payload whose value was changed', async () => {
    const svc = createSignedMetrics()
    await svc.generateKey('ed25519')
    const record = svc.sign({ metric: 'cpu', value: 10 })
    const tampered = { ...record, payload: { metric: 'cpu', value: 11 } }
    const result = svc.verify(tampered as SignedRecord<unknown>)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toMatch(/signature/i)
    }
  })

  it('rejects when a single byte of the signature is flipped', async () => {
    const svc = createSignedMetrics()
    await svc.generateKey('ed25519')
    const record = svc.sign({ metric: 'cpu', value: 10 })
    const mangled = flipFirstChar(record.sig)
    const result = svc.verify({ ...record, sig: mangled })
    expect(result.valid).toBe(false)
  })

  it('rejects when the timestamp is altered', async () => {
    const svc = createSignedMetrics()
    await svc.generateKey('ed25519')
    const record = svc.sign({ metric: 'cpu', value: 10 })
    const result = svc.verify({ ...record, ts: record.ts - 1 })
    expect(result.valid).toBe(false)
  })

  it('rejects when kid is altered to a known-but-wrong key', async () => {
    const svc = createSignedMetrics()
    await svc.generateKey('ed25519')
    // Rotate to introduce a second, valid kid.
    const second = await svc.rotateKey('ed25519')
    // Sign with the new active key but swap kid back to the retired one.
    const record = svc.sign({ metric: 'cpu', value: 10 })
    expect(record.kid).toBe(second.newKid)
    const swapped = { ...record, kid: second.retiredKid as string }
    const result = svc.verify(swapped)
    expect(result.valid).toBe(false)
  })

  it('rejects when alg is swapped to an incompatible value', async () => {
    const svc = createSignedMetrics()
    await svc.generateKey('ed25519')
    const record = svc.sign({ x: 1 })
    const result = svc.verify({ ...record, alg: 'hmac-sha256' })
    expect(result.valid).toBe(false)
  })

  it('rejects hmac tampering (constant-time mismatch)', async () => {
    const svc = createSignedMetrics({ options: { algorithm: 'hmac-sha256' } })
    await svc.generateKey('hmac-sha256')
    const record = svc.sign({ log: 'foo' })
    const result = svc.verify({
      ...record,
      payload: { log: 'bar' },
    } as SignedRecord<unknown>)
    expect(result.valid).toBe(false)
  })
})

describe('signed-metrics: canonicalization parity', () => {
  it('produces the same verified result regardless of key order in payload', async () => {
    const svc = createSignedMetrics()
    await svc.generateKey('ed25519')
    const record = svc.sign({ a: 1, b: 2, c: 3 })
    // Replace payload with one whose keys are in a different order but same data.
    const reordered = { ...record, payload: { c: 3, a: 1, b: 2 } }
    const result = svc.verify(reordered as SignedRecord<unknown>)
    expect(result.valid).toBe(true)
  })

  it('nested object key order does not affect verification', async () => {
    const svc = createSignedMetrics()
    await svc.generateKey('ed25519')
    const record = svc.sign({ outer: { a: 1, b: 2 }, extra: 'x' })
    const reordered = {
      ...record,
      payload: { extra: 'x', outer: { b: 2, a: 1 } },
    }
    expect(svc.verify(reordered as SignedRecord<unknown>).valid).toBe(true)
  })
})

describe('signed-metrics: invalid kid', () => {
  it('fails fast with reason "unknown kid"', async () => {
    const svc = createSignedMetrics()
    await svc.generateKey('ed25519')
    const record = svc.sign({ ok: true })
    const result = svc.verify({ ...record, kid: 'does-not-exist' })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toBe('unknown kid')
    }
  })

  it('rejects missing kid', async () => {
    const svc = createSignedMetrics()
    await svc.generateKey('ed25519')
    const record = svc.sign({ ok: true })
    const result = svc.verify({ ...record, kid: '' })
    expect(result.valid).toBe(false)
  })

  it('rejects malformed base64url signature', async () => {
    const svc = createSignedMetrics()
    await svc.generateKey('ed25519')
    const record = svc.sign({ ok: true })
    const result = svc.verify({ ...record, sig: '***not-b64url***' })
    expect(result.valid).toBe(false)
  })

  it('rejects future timestamps beyond skew', async () => {
    let now = 1_000_000
    const svc = createSignedMetrics({ now: () => now })
    await svc.generateKey('ed25519')
    const record = svc.sign({ ok: true })
    // Shift record ts to far future without re-signing.
    const farFuture = { ...record, ts: now + 60 * 60 * 1000 }
    expect(svc.verify(farFuture).valid).toBe(false)
  })
})

describe('signed-metrics: key rotation', () => {
  it('old records still verify after rotation', async () => {
    const svc = createSignedMetrics()
    await svc.generateKey('ed25519')
    const oldRecord = svc.sign({ metric: 'before-rotation' })
    const { newKid, retiredKid } = await svc.rotateKey('ed25519')
    expect(retiredKid).toBeTruthy()
    expect(newKid).not.toBe(retiredKid)
    // Old record uses retiredKid and must still be valid.
    expect(oldRecord.kid).toBe(retiredKid)
    expect(svc.verify(oldRecord).valid).toBe(true)
    // New records use the new kid.
    const newRecord = svc.sign({ metric: 'after-rotation' })
    expect(newRecord.kid).toBe(newKid)
    expect(svc.verify(newRecord).valid).toBe(true)
  })

  it('listActiveKeys contains both keys after rotation (retired is still active for verify)', async () => {
    const svc = createSignedMetrics()
    await svc.generateKey('ed25519')
    await svc.rotateKey('ed25519')
    const keys = svc.listActiveKeys()
    expect(keys).toHaveLength(2)
  })

  it('expired keys are rejected on verify', async () => {
    let now = 1_000_000
    const svc = createSignedMetrics({
      now: () => now,
      options: { retentionMs: 1000 }, // 1 second retention
    })
    await svc.generateKey('ed25519')
    const record = svc.sign({ metric: 'will-expire' })
    // Rotate so current key becomes retired.
    await svc.rotateKey('ed25519')
    // Within retention: still valid.
    expect(svc.verify(record).valid).toBe(true)
    // Past retention: expired.
    now += 2000
    const result = svc.verify(record)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toBe('key expired')
    }
  })

  it('purging expired keys drops them from the store', async () => {
    let now = 1_000_000
    const svc = createSignedMetrics({
      now: () => now,
      options: { retentionMs: 1000 },
    })
    await svc.generateKey('ed25519')
    const record = svc.sign({ metric: 'gone' })
    await svc.rotateKey('ed25519')
    now += 2000
    // Verify marks the key as expired via isAcceptable; listActiveKeys reflects that.
    const keys = svc.listActiveKeys()
    // The retired+expired key should not be listed; only the new active.
    expect(keys).toHaveLength(1)
    expect(svc.verify(record).valid).toBe(false)
  })
})

describe('signed-metrics: shape validation', () => {
  it('rejects non-object records', async () => {
    const svc = createSignedMetrics()
    await svc.generateKey('ed25519')
    expect(svc.verify(null as unknown as SignedRecord).valid).toBe(false)
    expect(svc.verify('hello' as unknown as SignedRecord).valid).toBe(false)
  })

  it('rejects unsupported algorithm', async () => {
    const svc = createSignedMetrics()
    await svc.generateKey('ed25519')
    const record = svc.sign({ x: 1 })
    const result = svc.verify({
      ...record,
      alg: 'md5' as unknown as 'ed25519',
    })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toBe('unsupported algorithm')
  })

  it('rejects non-finite ts', async () => {
    const svc = createSignedMetrics()
    await svc.generateKey('ed25519')
    const record = svc.sign({ x: 1 })
    const result = svc.verify({ ...record, ts: Number.NaN })
    expect(result.valid).toBe(false)
  })
})

// ─── Helpers ─────────────────────────────

function flipFirstChar(s: string): string {
  const first = s.charCodeAt(0)
  // Pick a different base64url char to guarantee mutation.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  const replacement = alphabet.charCodeAt(0) === first ? alphabet[1] : alphabet[0]
  return replacement + s.slice(1)
}
