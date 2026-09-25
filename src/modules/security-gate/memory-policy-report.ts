// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The Security page's 'Memory outside EYAS' card (GET /api/v1/security/
// memory-policy): what the memory-sovereignty path policy protects on this
// host, whether each switched-on CLI provider's own tools run in the kernel
// file sandbox, and how often in the last 24 hours the policy refused a tool
// call or a shell command asked to leave the sandbox. It carries absolute
// host paths, so the route is for roles that read security events (owner,
// admin).

import { sql, type SQL } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { getPathPolicy, type PathPolicy, type PathPolicyDescription } from '@shared/memory-sovereignty/path-policy.js'
import { MEMORY_PATH_REASON_MARKERS } from '@shared/memory-sovereignty/deny-reason.js'
import { UNSANDBOXED_SHELL_REASON_TAG } from '@shared/cli-sandbox.js'
import {
  describeFileSandbox,
  getCliSandboxMode,
  type CliSandboxMode,
  type FileSandboxInfo,
  type SandboxCli,
} from '@modules/model/cli-runtime/sandbox/index.js'
import { providerDisplayName } from '@modules/model/provider-display.js'

/** The CLI providers whose own tools a kernel file sandbox may wrap, in display order. */
export const SANDBOX_CLIS: readonly SandboxCli[] = ['claude-code', 'grok-cli', 'kimi-cli']

/** How far back the refusal counts reach. */
export const REFUSAL_WINDOW_HOURS = 24

export interface MemoryPolicyCliSandbox {
  id: SandboxCli
  name: string
  /** Null when detection itself failed — shown as unavailable, never as active. */
  fileSandbox: FileSandboxInfo | null
}

export interface MemoryPolicyReport {
  /** What the path policy protects (PathPolicy.describe()). */
  policy: PathPolicyDescription
  sandbox: {
    /** security.cliSandbox as the CLI providers read it. */
    mode: CliSandboxMode
    /** Switched-on CLI providers only. */
    providers: MemoryPolicyCliSandbox[]
  }
  refusals: {
    windowHours: number
    /** ISO start of the window. */
    since: string
    /** Tool calls the memory-path policy refused (every channel that logs through the gate). */
    memoryPathDenials: number
    /** Shell commands that asked to run outside the kernel sandbox and went to a human. */
    unsandboxedEscalations: number
  }
}

export interface MemoryPolicyReportDeps {
  /** Default: the process-wide policy (the one the security gate installed). */
  policy?: () => Pick<PathPolicy, 'describe'>
  /**
   * Ids of the switched-on providers. Null (or absent) when unknown: every
   * CLI is listed.
   */
  enabledProviders?: () => readonly string[] | null | undefined
  /** Default: the model module's kernel sandbox detection. */
  fileSandbox?: (cli: SandboxCli, mode: CliSandboxMode) => Promise<FileSandboxInfo>
  /** Default: security.cliSandbox as configured. */
  mode?: () => CliSandboxMode
  now?: () => number
}

interface CountRow {
  count: number
}

function count(db: EyasDb, query: SQL): number {
  return Number((db.all(query) as CountRow[])[0]?.count ?? 0)
}

/** WHERE fragment: the reason carries one of the memory-path refusal markers. */
function memoryPathReasonMatch(): SQL {
  return sql.join(MEMORY_PATH_REASON_MARKERS.map((m) => sql`instr(reason, ${m}) > 0`), sql` OR `)
}

/**
 * Refusals since `since` (ISO). security_events.created_at is the ISO
 * timestamp the gate wrote, so a string comparison with an ISO cutoff is a
 * time comparison.
 */
export function countMemoryPolicyRefusals(db: EyasDb, since: string): { memoryPathDenials: number; unsandboxedEscalations: number } {
  return {
    memoryPathDenials: count(db, sql`SELECT COUNT(*) as count FROM security_events
      WHERE decision = 'deny' AND checkpoint = 'deterministic' AND created_at >= ${since}
        AND (${memoryPathReasonMatch()})`),
    unsandboxedEscalations: count(db, sql`SELECT COUNT(*) as count FROM security_events
      WHERE decision = 'escalate' AND created_at >= ${since}
        AND instr(reason, ${UNSANDBOXED_SHELL_REASON_TAG}) > 0`),
  }
}

async function sandboxOf(
  cli: SandboxCli,
  mode: CliSandboxMode,
  fileSandbox: NonNullable<MemoryPolicyReportDeps['fileSandbox']>,
): Promise<FileSandboxInfo | null> {
  try {
    return await fileSandbox(cli, mode)
  } catch {
    return null
  }
}

export async function buildMemoryPolicyReport(db: EyasDb, deps: MemoryPolicyReportDeps = {}): Promise<MemoryPolicyReport> {
  const policy = (deps.policy ?? getPathPolicy)().describe()
  const mode = (deps.mode ?? getCliSandboxMode)()
  const fileSandbox = deps.fileSandbox ?? ((cli: SandboxCli, m: CliSandboxMode) => describeFileSandbox(cli, { mode: m }))

  let enabled: readonly string[] | null | undefined
  try {
    enabled = deps.enabledProviders?.()
  } catch {
    enabled = null
  }
  const clis = enabled ? SANDBOX_CLIS.filter((cli) => enabled.includes(cli)) : [...SANDBOX_CLIS]
  const providers = await Promise.all(clis.map(async (cli) => ({
    id: cli,
    name: providerDisplayName(cli),
    fileSandbox: await sandboxOf(cli, mode, fileSandbox),
  })))

  const since = new Date((deps.now ?? Date.now)() - REFUSAL_WINDOW_HOURS * 3_600_000).toISOString()
  return {
    policy,
    sandbox: { mode, providers },
    refusals: { windowHours: REFUSAL_WINDOW_HOURS, since, ...countMemoryPolicyRefusals(db, since) },
  }
}
