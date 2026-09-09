// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { createHash } from 'node:crypto'

/**
 * Canonical, key-order-independent serialization. Two structurally-equal
 * inputs serialize identically regardless of property insertion order, so the
 * hash identifies the exact call rather than an accident of key ordering.
 */
function canonical(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (typeof value === 'bigint') return `${value}n` // JSON.stringify throws on BigInt
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`
}

/**
 * Stable short hash of a tool call's arguments. Used to build the resume
 * idempotency ledger (do-not-repeat destructive calls), the do-not-repeat
 * lines in buildTaskStateReinjection, and the approvals grant ledger (F2 T3 —
 * a grant is scoped to conversation+tool+argHash so an approval can only ever
 * authorize the EXACT call it was requested for). 64-bit hex prefix —
 * collision-safe enough for per-session dedup and compact in the recap.
 *
 * Lives in `shared/` (not a specific module) because it's consumed across
 * module boundaries that don't otherwise depend on each other (agent, tools,
 * model) — see `modules/agent/arg-hash.ts` for the re-exported legacy path.
 */
export function argHash(input: unknown): string {
  // Normalize via a JSON round-trip FIRST so the recorded path (input stored
  // with JSON.stringify, read back with JSON.parse — which drops undefined-valued
  // keys and maps undefined array elements to null) and the live path (raw input)
  // hash to the same value. Without this the resume idempotency ledger misses on
  // any input carrying `undefined` and a destructive call re-fires.
  let normalized: unknown
  try {
    normalized = input === undefined ? null : JSON.parse(JSON.stringify(input))
  } catch {
    normalized = input // non-serializable (cycles, BigInt) — hash as-is
  }
  return createHash('sha256').update(canonical(normalized)).digest('hex').slice(0, 16)
}
