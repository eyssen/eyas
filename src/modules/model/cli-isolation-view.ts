// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// What the provider panel shows about a CLI provider's runtime and isolation
// (GET /api/v1/model/providers/:id/isolation): the binary EYAS runs (how it
// was found, its version, a host CLI an override shadows, version skew
// against the client library that drives it), whether it is signed in, the
// last isolation status EYAS recorded (cli-runtime/isolation.ts), the version
// the live isolation lane last proved (verified-versions.ts) and whether
// Verify now can run. Everything comes from the same resolver and store the
// turns use, so the panel cannot claim more than what runs.

import {
  findShadowedHostCli,
  resolveCliExecutable,
  type ExecutableResolution,
  type ExecutableSource,
  type ShadowedHostCli,
} from './cli-runtime/executables.js'
import { canVerifyIsolation, getIsolationStatus, type CliIsolationViolation, type IsolationState } from './cli-runtime/isolation.js'
import {
  CLI_VERIFIED_VERSIONS,
  ISOLATION_CLI_IDS,
  isolationDrift,
  type CliVerifiedVersion,
  type IsolationCliId,
  type IsolationDrift,
} from './cli-runtime/verified-versions.js'
import { isCliSignInProvider, type CliSignInService } from './cli-runtime/sign-in.js'
import { readClaudeAuthStatus } from './submodules/claude-code/runtime.js'

export function isIsolationCliId(id: string): id is IsolationCliId {
  return (ISOLATION_CLI_IDS as readonly string[]).includes(id)
}

export type CliRuntimeView =
  | {
      available: true
      path: string
      /** Null when the binary reported no readable version. */
      version: string | null
      source: ExecutableSource
      /** The CLI version the driving client library was built for (Claude Code only). */
      expectedVersion: string | null
      /** The binary reports another version than expectedVersion. */
      skew: boolean
    }
  | {
      available: false
      /** override-invalid: the override variable is set but unusable (no fallback runs). */
      error: 'no-policy' | 'override-invalid' | 'not-found'
    }

export interface CliIsolationView {
  providerId: IsolationCliId
  /** The last recorded isolation status; 'unverified' until a check ran. */
  status: IsolationState
  /** The failed checks of that status (stable ids, raw detail). */
  checks: CliIsolationViolation[]
  /** ISO time of the last check; null when none ran since EYAS started. */
  checkedAt: string | null
  runtime: CliRuntimeView
  /** A CLI on PATH the override shadows (EYAS does not run it). */
  hostCli: ShadowedHostCli | null
  /** Null when it could not be checked (no usable runtime, no sign-in service). */
  signedIn: boolean | null
  /** What the live isolation lane last proved, compared with the installed version. */
  proof: CliVerifiedVersion & { drift: IsolationDrift | null }
  /** Verify now can run (the provider is loaded and can check itself without a turn). */
  canVerify: boolean
}

export interface CliIsolationViewDeps {
  /** The executable resolution (default: the shared resolver, cached). */
  resolve?: (id: IsolationCliId) => Promise<ExecutableResolution>
  /** The host CLI an override shadows (default: findShadowedHostCli). */
  hostCli?: (resolution: ExecutableResolution) => Promise<ShadowedHostCli | null>
  /** The EYAS sign-in of Grok / Kimi (their homes are EYAS's own). Absent: null for them. */
  cliSignIn?: Pick<CliSignInService, 'isSignedIn'>
  /** Claude Code's sign-in (default: `auth status` of the resolved binary — local, no session). */
  claudeSignedIn?: (resolution: Extract<ExecutableResolution, { ok: true }>) => Promise<boolean>
  /** The lane's record (default: the shipped one). */
  verified?: Readonly<Record<IsolationCliId, Readonly<CliVerifiedVersion>>>
}

async function signedInOf(id: IsolationCliId, resolution: ExecutableResolution, deps: CliIsolationViewDeps): Promise<boolean | null> {
  if (isCliSignInProvider(id)) return deps.cliSignIn ? deps.cliSignIn.isSignedIn(id) : null
  if (!resolution.ok) return null
  return deps.claudeSignedIn ? deps.claudeSignedIn(resolution) : (await readClaudeAuthStatus(resolution)).loggedIn
}

function runtimeView(resolution: ExecutableResolution): CliRuntimeView {
  if (!resolution.ok) return { available: false, error: resolution.error }
  return {
    available: true,
    path: resolution.path,
    version: resolution.version,
    source: resolution.source,
    expectedVersion: resolution.expectedVersion,
    skew: Boolean(resolution.expectedVersion && resolution.version && resolution.version !== resolution.expectedVersion),
  }
}

/** The panel's view of one CLI provider. Never throws for a failed sub-check: that part reads as unknown. */
export async function describeCliIsolation(id: IsolationCliId, deps: CliIsolationViewDeps = {}): Promise<CliIsolationView> {
  const resolution = await (deps.resolve ?? ((p: IsolationCliId) => resolveCliExecutable(p)))(id)
  const [hostCli, signedIn] = await Promise.all([
    (deps.hostCli ?? ((r: ExecutableResolution) => findShadowedHostCli(r)))(resolution).catch(() => null),
    signedInOf(id, resolution, deps).catch(() => null),
  ])
  const status = getIsolationStatus(id)
  const record = (deps.verified ?? CLI_VERIFIED_VERSIONS)[id]
  return {
    providerId: id,
    status: status.status,
    checks: status.checks,
    checkedAt: status.checkedAt,
    runtime: runtimeView(resolution),
    hostCli,
    signedIn: signedIn ?? null,
    proof: {
      version: record.version,
      verifiedAt: record.verifiedAt,
      paidCanary: record.paidCanary,
      drift: resolution.ok ? isolationDrift(id, resolution.version, deps.verified ?? CLI_VERIFIED_VERSIONS) : null,
    },
    canVerify: canVerifyIsolation(id),
  }
}
