// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Isolation status of the CLI providers: what EYAS last verified about each
// one (a preflight, a session-start check or an init tripwire), and the error
// a violation raises. Fail closed: a provider nobody verified is
// 'unverified', never assumed isolated.

import { CodedModelError } from '@shared/classify-model-error.js'
import type { ExecutableSource } from './executables.js'

export type IsolationState = 'verified' | 'violation' | 'unverified' | 'auth-required'

/** One failed check: a stable id (localized by the UI) plus raw detail. */
export interface CliIsolationViolation {
  check: string
  detail: string
}

/** What a CLI reported about itself at start (init message, inspect output). */
export interface CliIsolationSnapshot {
  providerId: string
  version?: string
  cwd?: string
  mcpServers?: string[]
  plugins?: string[]
  permissionMode?: string
  /** Provider-specific facts a check needs (hooks, rules, memory, …). */
  facts?: Record<string, unknown>
}

/** Which binary the status was established on. */
export interface CliRuntimeInfo {
  path: string | null
  version: string | null
  source: ExecutableSource | null
}

export interface IsolationStatus {
  status: IsolationState
  checks: CliIsolationViolation[]
  runtime: CliRuntimeInfo | null
  /** ISO timestamp of the last verification; null when never verified. */
  checkedAt: string | null
}

/**
 * A CLI run was stopped because it is not isolated as EYAS requires. The
 * 'isolation' kind is terminal: the gateway never retries it or silently
 * fails over, and the UI shows the localized `cliIsolation` message with the
 * failed checks.
 */
export class CliIsolationError extends CodedModelError {
  readonly providerId: string
  readonly violations: CliIsolationViolation[]

  constructor(providerId: string, violations: CliIsolationViolation[], options?: { cause?: unknown }) {
    const checks = violations.map((v) => v.check)
    super('isolation', 'cliIsolation', { provider: providerId, checks: checks.join(',') }, {
      message: `${providerId}: CLI isolation check failed (${checks.join(', ') || 'unknown'})`,
      ...(options?.cause !== undefined ? { cause: options.cause } : {}),
    })
    this.name = 'CliIsolationError'
    this.providerId = providerId
    this.violations = violations.map((v) => ({ ...v }))
  }
}

const UNVERIFIED: IsolationStatus = { status: 'unverified', checks: [], runtime: null, checkedAt: null }

const statuses = new Map<string, IsolationStatus>()

function copy(status: IsolationStatus): IsolationStatus {
  return {
    status: status.status,
    checks: status.checks.map((c) => ({ ...c })),
    runtime: status.runtime ? { ...status.runtime } : null,
    checkedAt: status.checkedAt,
  }
}

/** Last known status of a provider; 'unverified' when never checked. */
export function getIsolationStatus(providerId: string): IsolationStatus {
  return copy(statuses.get(providerId) ?? UNVERIFIED)
}

/** Record a verification outcome. `checkedAt` defaults to now. */
export function setIsolationStatus(
  providerId: string,
  next: Omit<IsolationStatus, 'checkedAt'> & { checkedAt?: string },
): IsolationStatus {
  const status = copy({ ...next, checkedAt: next.checkedAt ?? new Date().toISOString() })
  statuses.set(providerId, status)
  return copy(status)
}

/** Forget every recorded status (tests, provider reload). */
export function resetIsolationStatuses(providerId?: string): void {
  if (providerId) statuses.delete(providerId)
  else statuses.clear()
}

// ─── Verify now ────────────────────────────────

/**
 * Re-runs a loaded provider's own isolation checks, without a model call,
 * and records the outcome in this store (the panel's Verify now). Only a
 * provider that can check itself without a turn registers one: the ACP CLIs
 * (preflight, then a zero-cost session start). Claude Code has none — its
 * checks read the init message of a real turn.
 */
export type IsolationVerifier = () => Promise<void>

const verifiers = new Map<string, IsolationVerifier>()
const verifying = new Map<string, Promise<IsolationStatus>>()

/** Register (or, with null, remove) the verifier of a loaded provider. */
export function registerIsolationVerifier(providerId: string, verify: IsolationVerifier | null): void {
  if (verify) verifiers.set(providerId, verify)
  else verifiers.delete(providerId)
}

/** Whether Verify now can run for this provider right now. */
export function canVerifyIsolation(providerId: string): boolean {
  return verifiers.has(providerId)
}

/**
 * Run the provider's verifier and resolve to the status it recorded; null
 * when none is registered. Concurrent calls share one run. A verifier that
 * throws leaves the status it recorded (it is logged by its owner).
 */
export function verifyIsolationNow(providerId: string): Promise<IsolationStatus> | null {
  const running = verifying.get(providerId)
  if (running) return running
  const verify = verifiers.get(providerId)
  if (!verify) return null
  const run = (async () => {
    try {
      await verify()
    } catch {
      // The verifier records its own outcome; nothing more to add here.
    }
    return getIsolationStatus(providerId)
  })().finally(() => verifying.delete(providerId))
  verifying.set(providerId, run)
  return run
}
