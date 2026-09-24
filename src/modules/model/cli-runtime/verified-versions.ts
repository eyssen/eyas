// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The CLI versions EYAS's isolation was last proven on. The proof is the
// live CLI lane (tests/live/cli-isolation.live.test.ts, `bun run
// test:live-cli`): the real binary under a hostile temporary HOME, driven
// through EYAS's own providers, must load none of the host's configuration,
// run none of its hooks or MCP servers, leave no session store behind and —
// for Claude Code, which keeps the host HOME — write nothing to the host but
// the bookkeeping files listed in tests/live/claude-host-writes.allowlist.json.
//
// This record is the release gate's memory: `eyas doctor` compares the
// installed binary with it and warns on drift, and the lane itself fails
// until the record names the binary it just proved. Update it (and, for
// Claude Code, the allowlist's binaryVersion) only after the lane passed on
// that version.
//
// The runtime checks do not depend on it: every turn still runs its preflight
// and init tripwire whatever version is installed.

import type { CliEnvProfile } from './env.js'

/** The CLI providers the isolation lane proves. */
export type IsolationCliId = Extract<CliEnvProfile, 'claude-code' | 'grok-cli' | 'kimi-cli'>

export const ISOLATION_CLI_IDS: readonly IsolationCliId[] = ['claude-code', 'grok-cli', 'kimi-cli']

export interface CliVerifiedVersion {
  /** The version the lane last passed on; null when it never ran on a host with this CLI. */
  version: string | null
  /** Day of that pass (YYYY-MM-DD); null when never. */
  verifiedAt: string | null
  /**
   * Whether the paid canary (a real model turn on the operator's own
   * sign-in) passed on that version too, or only the free cases (a local
   * fake model with a dummy key, no model call).
   */
  paidCanary: boolean
}

export const CLI_VERIFIED_VERSIONS: Readonly<Record<IsolationCliId, Readonly<CliVerifiedVersion>>> = Object.freeze({
  'claude-code': Object.freeze({ version: '2.1.281', verifiedAt: '2026-09-24', paidCanary: false }),
  'grok-cli': Object.freeze({ version: '1.0.41', verifiedAt: '2026-09-24', paidCanary: false }),
  // Derived from the kimi-cli 1.52.0 source only; no host with the binary has run the lane.
  'kimi-cli': Object.freeze({ version: null, verifiedAt: null, paidCanary: false }),
})

export type IsolationDrift =
  /** The installed version is the one the lane proved. */
  | 'match'
  /** Another version is installed than the one the lane proved. */
  | 'drift'
  /** The lane never ran on this CLI. */
  | 'never-verified'
  /** The installed binary did not report a readable version. */
  | 'unknown-version'

/** Compare an installed version with the last proven one. */
export function isolationDrift(
  id: IsolationCliId,
  installedVersion: string | null,
  record: Readonly<Record<IsolationCliId, Readonly<CliVerifiedVersion>>> = CLI_VERIFIED_VERSIONS,
): IsolationDrift {
  const verified = record[id]?.version ?? null
  if (!verified) return 'never-verified'
  if (!installedVersion) return 'unknown-version'
  return installedVersion === verified ? 'match' : 'drift'
}
