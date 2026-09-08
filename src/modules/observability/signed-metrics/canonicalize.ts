// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Deterministic JSON canonicalization.
 *
 * Produces the same string for equivalent objects across platforms and
 * Node/Bun versions. Object keys are sorted lexicographically at every
 * level; arrays preserve order; primitives are JSON.stringified.
 *
 * Notes:
 * - undefined values are dropped (matches JSON.stringify)
 * - functions / symbols throw (they are never valid signed payloads)
 * - NaN / Infinity throw (not representable in JSON)
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null'

  const type = typeof value
  if (type === 'string') return JSON.stringify(value)
  if (type === 'boolean') return value ? 'true' : 'false'
  if (type === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new Error('canonicalize: non-finite number is not JSON-safe')
    }
    return JSON.stringify(value)
  }
  if (type === 'bigint') {
    // Represent bigint as decimal string (JSON has no bigint literal).
    return JSON.stringify((value as bigint).toString())
  }
  if (type === 'undefined') return 'null'

  if (Array.isArray(value)) {
    const parts = value.map((item) => canonicalize(item))
    return `[${parts.join(',')}]`
  }

  if (type === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    const parts: string[] = []
    for (const key of keys) {
      const v = obj[key]
      if (v === undefined) continue
      parts.push(`${JSON.stringify(key)}:${canonicalize(v)}`)
    }
    return `{${parts.join(',')}}`
  }

  throw new Error(`canonicalize: unsupported value type: ${type}`)
}

/**
 * Produce the exact byte sequence that a signer/verifier covers for a record.
 * This binds payload + kid + ts together so that a signature cannot be
 * replayed under a different key or shifted in time.
 */
export function canonicalSignedBytes(params: {
  payload: unknown
  kid: string
  ts: number
  alg: string
}): Buffer {
  const canonical = canonicalize({
    alg: params.alg,
    kid: params.kid,
    payload: params.payload,
    ts: params.ts,
  })
  return Buffer.from(canonical, 'utf8')
}
