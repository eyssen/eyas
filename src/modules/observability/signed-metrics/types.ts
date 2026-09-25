// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Supported signature algorithms.
 * - ed25519: Primary algorithm, asymmetric, preferred for tamper-evident logs
 * - hmac-sha256: Fallback, symmetric, for constrained environments
 */
export type SignatureAlgorithm = 'ed25519' | 'hmac-sha256'

/**
 * A signed record wraps an arbitrary payload with a detached signature.
 * The signed bytes cover payload + kid + ts (canonicalized) to prevent
 * replay across different keys and to bind timestamp to signature.
 */
export interface SignedRecord<T = unknown> {
  /** Original payload (not mutated by the signer) */
  payload: T
  /** Key id used to produce the signature */
  kid: string
  /** Signature algorithm */
  alg: SignatureAlgorithm
  /** Timestamp (ms since epoch) — included in signed bytes */
  ts: number
  /** base64url-encoded signature */
  sig: string
}

/**
 * Result of verifying a SignedRecord.
 */
export type VerificationResult =
  | { valid: true }
  | { valid: false; reason: string }

/**
 * Internal representation of a key in the store.
 * The secret/private material is never exposed to callers.
 */
export interface SigningKey {
  kid: string
  algorithm: SignatureAlgorithm
  /** For ed25519: private key (PEM). For hmac: raw secret (bytes). */
  secret: Buffer
  /** For ed25519: public key (PEM). For hmac: undefined (secret = verifier). */
  publicKey?: Buffer
  createdAt: number
  /** If set, key is retired at this timestamp — still used for verify, never for sign. */
  retiredAt?: number
  /**
   * If set, key is expired: neither sign nor verify are allowed.
   * Expiration happens `retentionMs` after retirement.
   */
  expiresAt?: number
}

/**
 * Public metadata describing an active key. Safe to expose.
 */
export interface KeyInfo {
  kid: string
  algorithm: SignatureAlgorithm
  createdAt: number
}

/**
 * Options controlling a signer/verifier.
 */
export interface SignedMetricsOptions {
  /** Default algorithm for new keys. Defaults to 'ed25519'. */
  algorithm?: SignatureAlgorithm
  /**
   * How long (ms) a retired key is still accepted for verify before full expiry.
   * Defaults to 7 days.
   */
  retentionMs?: number
  /** Max clock skew accepted for the `ts` field during verify, in ms. Defaults to 5 minutes. */
  maxClockSkewMs?: number
}

/**
 * Public service surface for signing and verifying metric/log records.
 */
export interface SignedMetricsService {
  /** Sign a payload using the currently active key. */
  sign<T>(payload: T): SignedRecord<T>
  /** Verify a signed record. Never throws — always returns a result. */
  verify<T>(record: SignedRecord<T>): VerificationResult
  /** Generate a fresh key and make it active. Returns public metadata only. */
  generateKey(algorithm?: SignatureAlgorithm): Promise<KeyInfo>
  /** Rotate: mark current active as retired, create new active. */
  rotateKey(algorithm?: SignatureAlgorithm): Promise<{ newKid: string; retiredKid?: string }>
  /** List public metadata for active (non-expired) keys. */
  listActiveKeys(): KeyInfo[]
}
