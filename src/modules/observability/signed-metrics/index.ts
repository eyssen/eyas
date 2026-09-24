// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { KeyStore } from './key-store.js'
import { createSigner } from './signer.js'
import { createVerifier } from './verifier.js'
import type {
  KeyInfo,
  SignatureAlgorithm,
  SignedMetricsOptions,
  SignedMetricsService,
  SignedRecord,
  VerificationResult,
} from './types.js'

export type {
  KeyInfo,
  SignatureAlgorithm,
  SignedMetricsOptions,
  SignedMetricsService,
  SignedRecord,
  VerificationResult,
}

export { KeyStore } from './key-store.js'
export { canonicalize, canonicalSignedBytes } from './canonicalize.js'

/**
 * Construct a SignedMetricsService backed by an in-memory KeyStore.
 *
 * Intended integration points:
 *  - Pass `now` from the core clock abstraction so tests stay deterministic.
 *  - In production, persist `KeyStore` state encrypted via the master key
 *    from the secrets module; this factory deliberately does not depend on
 *    the secrets module (see README.md, section "Persistence").
 */
export function createSignedMetrics(
  deps: { now?: () => number; options?: SignedMetricsOptions } = {},
): SignedMetricsService {
  const now = deps.now ?? Date.now
  const opts = deps.options ?? {}
  const defaultAlg: SignatureAlgorithm = opts.algorithm ?? 'ed25519'
  const store = new KeyStore({
    retentionMs: opts.retentionMs,
    now,
  })
  const sign = createSigner(store, now)
  const verify = createVerifier(store, {
    maxClockSkewMs: opts.maxClockSkewMs,
    now,
  })

  return {
    sign<T>(payload: T): SignedRecord<T> {
      if (!store.getActive()) {
        // Lazily generate a key on first sign — callers that prefer explicit
        // setup can call generateKey() / rotateKey() before sign.
        store.generate(defaultAlg)
      }
      return sign(payload)
    },

    verify<T>(record: SignedRecord<T>): VerificationResult {
      return verify(record)
    },

    async generateKey(algorithm?: SignatureAlgorithm): Promise<KeyInfo> {
      return store.generate(algorithm ?? defaultAlg)
    },

    async rotateKey(algorithm?: SignatureAlgorithm) {
      return store.rotate(algorithm ?? defaultAlg)
    },

    listActiveKeys(): KeyInfo[] {
      return store.listActive()
    },
  }
}
