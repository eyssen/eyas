// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { createHmac, createPrivateKey, sign as edSign } from 'node:crypto'
import { canonicalSignedBytes } from './canonicalize.js'
import type { KeyStore } from './key-store.js'
import type { SignedRecord, SigningKey } from './types.js'

/**
 * Encode binary to base64url (RFC 4648 §5) — same format used for JWTs.
 */
function toBase64Url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Produce a raw signature over canonical signed bytes for the given key.
 * Separated so the verifier can re-sign-and-compare for HMAC.
 */
export function rawSign(key: SigningKey, bytes: Buffer): Buffer {
  if (key.algorithm === 'ed25519') {
    const privateKey = createPrivateKey({ key: key.secret, format: 'pem' })
    return edSign(null, bytes, privateKey)
  }
  // hmac-sha256
  return createHmac('sha256', key.secret).update(bytes).digest()
}

/**
 * Factory that returns a `sign` function bound to a KeyStore.
 * The returned function always signs with the store's current active key.
 */
export function createSigner(store: KeyStore, now: () => number = Date.now) {
  return function sign<T>(payload: T): SignedRecord<T> {
    const key = store.getActive()
    if (!key) {
      throw new Error('signer: no active key — call generateKey() or rotateKey() first')
    }
    if (key.retiredAt) {
      // Defensive: a retired key should never be the store's active key, but
      // double-check so we never produce signatures from retired material.
      throw new Error('signer: active key is retired')
    }
    const ts = now()
    const bytes = canonicalSignedBytes({
      payload,
      kid: key.kid,
      ts,
      alg: key.algorithm,
    })
    const sig = toBase64Url(rawSign(key, bytes))
    return {
      payload,
      kid: key.kid,
      alg: key.algorithm,
      ts,
      sig,
    }
  }
}
