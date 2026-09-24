// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Pure mapping from what GET /api/v1/model/providers/:id/isolation reports
// (model/cli-isolation-view.ts) to the providers.panel.* locale keys. No
// translation happens here; the panel resolves the keys with t().

/** The CLI providers whose runtime and isolation the panel shows. */
export type IsolationProviderId = 'claude-code' | 'grok-cli' | 'kimi-cli'

export const ISOLATION_PROVIDER_IDS: readonly IsolationProviderId[] = ['claude-code', 'grok-cli', 'kimi-cli']

export function isIsolationProvider(id: string): id is IsolationProviderId {
  return (ISOLATION_PROVIDER_IDS as readonly string[]).includes(id)
}

export type IsolationState = 'verified' | 'violation' | 'unverified' | 'auth-required'
export type RuntimeSource = 'override' | 'host' | 'sdk-bundled'
export type IsolationDrift = 'match' | 'drift' | 'never-verified' | 'unknown-version'

/**
 * Every check id the backend emits: the ACP preflight, session and tripwire
 * checks (grok-cli/acp-verify.ts ACP_ISOLATION_CHECKS) and Claude Code's init
 * tripwire (claude-code/isolation-options.ts).
 */
export const ISOLATION_CHECK_IDS = [
  'permissionMode',
  'mcpServers',
  'hooks',
  'plugins',
  'rules',
  'memory',
  'compat',
  'leader',
  'folderTrust',
  'ungovernedTool',
  'cwd',
  'initMissing',
  'unverified',
] as const

const CHECK_IDS: ReadonlySet<string> = new Set(ISOLATION_CHECK_IDS)

/** The label key of a check id; null for an id this build does not know (show the raw id). */
export function isolationCheckKey(id: string): string | null {
  return CHECK_IDS.has(id) ? `providers.panel.isolation.check.${id}` : null
}

export const ISOLATION_STATUS_KEY: Record<IsolationState, string> = {
  'verified': 'providers.panel.isolation.status.verified',
  'violation': 'providers.panel.isolation.status.violation',
  'unverified': 'providers.panel.isolation.status.unverified',
  'auth-required': 'providers.panel.isolation.status.authRequired',
}

/** The status key; an unknown state reads as unverified (fail closed, never "verified"). */
export function isolationStatusKey(status: string): string {
  return Object.prototype.hasOwnProperty.call(ISOLATION_STATUS_KEY, status)
    ? ISOLATION_STATUS_KEY[status as IsolationState]
    : ISOLATION_STATUS_KEY.unverified
}

export const RUNTIME_SOURCE_KEY: Record<RuntimeSource, string> = {
  'override': 'providers.panel.runtime.override',
  'host': 'providers.panel.runtime.hostCli',
  'sdk-bundled': 'providers.panel.runtime.bundled',
}

/** What the live isolation lane proved, compared with the installed version. */
export const PROOF_KEY: Record<IsolationDrift, string> = {
  'match': 'providers.panel.isolation.proof.match',
  'drift': 'providers.panel.isolation.proof.drift',
  'never-verified': 'providers.panel.isolation.proof.never',
  'unknown-version': 'providers.panel.isolation.proof.unknownVersion',
}

/** How EYAS keeps each CLI isolated and when it checks it. */
export const HOW_KEY: Record<IsolationProviderId, string> = {
  'claude-code': 'providers.panel.isolation.how.claudeCode',
  'grok-cli': 'providers.panel.isolation.how.grok',
  'kimi-cli': 'providers.panel.isolation.how.kimi',
}

/** The one residual-risk sentence per CLI (what the release check does not prove). */
export const RESIDUAL_KEY: Record<IsolationProviderId, string> = {
  'claude-code': 'providers.panel.isolation.residual.claudeCode',
  'grok-cli': 'providers.panel.isolation.residual.grok',
  'kimi-cli': 'providers.panel.isolation.residual.kimi',
}
