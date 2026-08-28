// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Shared recovery/backoff primitive. ONE place that decides retry-vs-dead-letter
// and the next delay, so every durable queue (channel inbound, agent-run
// supervision, channel-health) backs off identically instead of each module
// re-deriving the math. Pure + deterministic (randomness is injected).

export interface RecoveryOptions {
  /** Failures so far, BEFORE counting the current one. */
  attempts: number
  /** Total failures tolerated; once the new attempt count reaches this, dead-letter. */
  maxAttempts: number
  /** Delay of the first retry, in ms. Doubles each subsequent attempt. */
  baseMs: number
  /** Optional ceiling on the (pre-jitter) delay, in ms. */
  capMs?: number
  /** Fraction (0..1) of the delay that may be shaved off as jitter. Default 0. */
  jitter?: number
  /** Injectable randomness in [0,1) for deterministic tests. Default Math.random. */
  rand?: () => number
}

export type RecoveryDecision =
  | { action: 'retry'; attempts: number; delayMs: number }
  | { action: 'dead'; attempts: number }

/**
 * Capped exponential backoff with optional jitter, plus a dead-letter verdict.
 *
 * Schedule (baseMs=B): retry#1 → B, retry#2 → 2B, retry#3 → 4B, … capped at capMs.
 * Jitter subtracts up to `jitter * delay` (full-jitter style), never below 0.
 */
export function decideRecovery(opts: RecoveryOptions): RecoveryDecision {
  const { attempts, maxAttempts, baseMs, capMs, jitter = 0, rand = Math.random } = opts
  const next = attempts + 1

  if (next >= maxAttempts) {
    return { action: 'dead', attempts: next }
  }

  let delayMs = baseMs * Math.pow(2, next - 1)
  if (capMs !== undefined) delayMs = Math.min(delayMs, capMs)
  if (jitter > 0) {
    delayMs = delayMs - jitter * delayMs * rand()
    if (delayMs < 0) delayMs = 0
  }

  return { action: 'retry', attempts: next, delayMs }
}
