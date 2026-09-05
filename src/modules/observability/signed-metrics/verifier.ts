// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { createPublicKey, timingSafeEqual, verify as edVerify } from 'node:crypto'
import { canonicalSignedBytes } from './canonicalize.js'
import type { KeyStore } from './key-store.js'
import { rawSign } from './signer.js'
import type { SignedRecord, VerificationResult } from './types.js'

const DEFAULT_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000 // 5 minutes

/** Decode base64url back to bytes. Returns null on malformed input. */
function fromBase64Url(input: string): Buffer | null {
  if (typeof input !== 'string') return null
  // Only the base64url alphabet is allowed.
  if (!/^[A-Za-z0-9_-]*$/.test(input)) return null
  const padLen = (4 - (input.length % 4)) % 4
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen)
  try {
    return Buffer.from(b64, 'base64')
  } catch {
    return null
  }
}

/**
 * Factory that returns a `verify` function bound to a KeyStore.
 *
 * The verifier never throws: any failure path returns `{ valid: false, reason }`
 * so callers can uniformly treat tampered or malformed input as "not trusted".
 */
export function createVerifier(
  store: KeyStore,
  options: { maxClockSkewMs?: number; now?: () => number } = {},
) {
  const maxClockSkewMs = options.maxClockSkewMs ?? DEFAULT_MAX_CLOCK_SKEW_MS
  const now = options.now ?? Date.now

  return function verify<T>(record: SignedRecord<T>): VerificationResult {
    // ─── Shape checks ──
    if (!record || typeof record !== 'object') {
      return { valid: false, reason: 'record is not an object' }
    }
    if (typeof record.kid !== 'string' || record.kid.length === 0) {
      return { valid: false, reason: 'missing kid' }
    }
    if (record.alg !== 'ed25519' && record.alg !== 'hmac-sha256') {
      return { valid: false, reason: 'unsupported algorithm' }
    }
    if (typeof record.ts !== 'number' || !Number.isFinite(record.ts)) {
      return { valid: false, reason: 'invalid ts' }
    }
    if (typeof record.sig !== 'string' || record.sig.length === 0) {
      return { valid: false, reason: 'missing sig' }
    }

    // ─── Clock skew: future timestamps must stay within bounds ──
    const nowMs = now()
    if (record.ts - nowMs > maxClockSkewMs) {
      return { valid: false, reason: 'timestamp too far in the future' }
    }

    // ─── Look up key ──
    const key = store.get(record.kid)
    if (!key) {
      return { valid: false, reason: 'unknown kid' }
    }
    if (key.algorithm !== record.alg) {
      return { valid: false, reason: 'algorithm mismatch with key' }
    }
    if (!store.isAcceptable(record.kid)) {
      return { valid: false, reason: 'key expired' }
    }

    // ─── Decode signature ──
    const sigBytes = fromBase64Url(record.sig)
    if (!sigBytes) {
      return { valid: false, reason: 'signature not base64url' }
    }

    // ─── Reconstruct signed bytes ──
    let bytes: Buffer
    try {
      bytes = canonicalSignedBytes({
        payload: record.payload,
        kid: record.kid,
        ts: record.ts,
        alg: record.alg,
      })
    } catch (err) {
      return {
        valid: false,
        reason: `cannot canonicalize payload: ${(err as Error).message}`,
      }
    }

    // ─── Verify ──
    if (record.alg === 'ed25519') {
      if (!key.publicKey) {
        return { valid: false, reason: 'key has no public component' }
      }
      try {
        const pub = createPublicKey({ key: key.publicKey, format: 'pem' })
        const ok = edVerify(null, bytes, pub, sigBytes)
        return ok
          ? { valid: true }
          : { valid: false, reason: 'signature does not match' }
      } catch (err) {
        return {
          valid: false,
          reason: `ed25519 verify failed: ${(err as Error).message}`,
        }
      }
    }

    // hmac-sha256 — constant-time compare
    const expected = rawSign(key, bytes)
    if (expected.length !== sigBytes.length) {
      return { valid: false, reason: 'signature does not match' }
    }
    const equal = timingSafeEqual(expected, sigBytes)
    return equal
      ? { valid: true }
      : { valid: false, reason: 'signature does not match' }
  }
}
