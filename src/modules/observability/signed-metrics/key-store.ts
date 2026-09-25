// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto'
import type { KeyInfo, SignatureAlgorithm, SigningKey } from './types.js'

const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/**
 * Generate a short stable key id.
 * Based on a hash of the public key (or HMAC secret) so two parties can
 * independently compute the same kid for the same material.
 */
function deriveKid(algorithm: SignatureAlgorithm, material: Buffer): string {
  const hash = createHash('sha256').update(algorithm).update(material).digest()
  // base64url, truncated — 10 bytes (~80 bits) is plenty for uniqueness.
  return hash
    .subarray(0, 10)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Create a fresh key of the given algorithm. Never logs the secret.
 */
export function createKey(
  algorithm: SignatureAlgorithm,
  now: () => number = Date.now,
): SigningKey {
  if (algorithm === 'ed25519') {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const pubDer = publicKey.export({ type: 'spki', format: 'der' })
    const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
    const pubPem = publicKey.export({ type: 'spki', format: 'pem' }) as string
    return {
      kid: deriveKid(algorithm, pubDer),
      algorithm,
      secret: Buffer.from(privPem, 'utf8'),
      publicKey: Buffer.from(pubPem, 'utf8'),
      createdAt: now(),
    }
  }
  // HMAC: 32 random bytes of shared secret.
  const secret = randomBytes(32)
  return {
    kid: deriveKid(algorithm, secret),
    algorithm,
    secret,
    createdAt: now(),
  }
}

/**
 * In-memory key store with rotation lifecycle.
 *
 * Semantics:
 *   - exactly one active key at a time (the signer uses this)
 *   - retired keys still validate signatures until `retentionMs` elapsed
 *   - after retention, the key is expired and no longer accepted
 *
 * Production integrations should persist keys encrypted via the master key
 * from the secrets module. This implementation is intentionally pure so it
 * can be unit-tested without touching disk.
 */
export class KeyStore {
  private readonly keys = new Map<string, SigningKey>()
  private activeKid: string | null = null
  private readonly retentionMs: number
  private readonly now: () => number

  constructor(options: { retentionMs?: number; now?: () => number } = {}) {
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS
    this.now = options.now ?? Date.now
  }

  /** Add a pre-built key. Returns public metadata. */
  add(key: SigningKey, makeActive = true): KeyInfo {
    this.keys.set(key.kid, key)
    if (makeActive) {
      this.activeKid = key.kid
    }
    return { kid: key.kid, algorithm: key.algorithm, createdAt: key.createdAt }
  }

  /** Create a new key of the given algorithm and make it the active signer. */
  generate(algorithm: SignatureAlgorithm): KeyInfo {
    const key = createKey(algorithm, this.now)
    return this.add(key, true)
  }

  /**
   * Rotate: retire the current active key and generate a new one.
   * Returns both the new active kid and the kid of the key that was retired.
   */
  rotate(algorithm: SignatureAlgorithm): { newKid: string; retiredKid?: string } {
    const retiredKid = this.activeKid ?? undefined
    if (retiredKid) {
      const prev = this.keys.get(retiredKid)
      if (prev) {
        prev.retiredAt = this.now()
        prev.expiresAt = prev.retiredAt + this.retentionMs
      }
    }
    const info = this.generate(algorithm)
    return { newKid: info.kid, retiredKid }
  }

  /** Explicitly retire a key (it stays verifiable until retention elapses). */
  retire(kid: string): void {
    const key = this.keys.get(kid)
    if (!key || key.retiredAt) return
    key.retiredAt = this.now()
    key.expiresAt = key.retiredAt + this.retentionMs
    if (this.activeKid === kid) {
      this.activeKid = null
    }
  }

  /** Currently active signing key (used by signer). Returns null if none. */
  getActive(): SigningKey | null {
    if (!this.activeKid) return null
    const key = this.keys.get(this.activeKid)
    return key ?? null
  }

  /** Look up any key (active, retired, expired) by kid. Never returns secret to callers outside module. */
  get(kid: string): SigningKey | undefined {
    return this.keys.get(kid)
  }

  /**
   * True iff the key exists and is accepted for verification right now.
   * - Active keys: yes
   * - Retired but within retention: yes
   * - Expired or unknown: no
   */
  isAcceptable(kid: string): boolean {
    const key = this.keys.get(kid)
    if (!key) return false
    if (key.expiresAt !== undefined && this.now() >= key.expiresAt) return false
    return true
  }

  /** Public metadata for keys that are still acceptable (active + retired-but-valid). */
  listActive(): KeyInfo[] {
    const now = this.now()
    const out: KeyInfo[] = []
    for (const key of this.keys.values()) {
      if (key.expiresAt !== undefined && now >= key.expiresAt) continue
      out.push({ kid: key.kid, algorithm: key.algorithm, createdAt: key.createdAt })
    }
    // Sort by createdAt desc so the active key is first.
    out.sort((a, b) => b.createdAt - a.createdAt)
    return out
  }

  /** Drop fully-expired keys. Returns the number of keys removed. */
  purgeExpired(): number {
    const now = this.now()
    let removed = 0
    for (const [kid, key] of this.keys) {
      if (key.expiresAt !== undefined && now >= key.expiresAt) {
        this.keys.delete(kid)
        removed++
      }
    }
    return removed
  }
}
