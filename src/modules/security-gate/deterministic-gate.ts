// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SecurityCheckResult, RiskTier, SecurityGateConfig } from './types.js'

/**
 * Checkpoint 1: Deterministic security gate.
 * Pattern matching, blocklists, rate limiting. No LLM, <5ms.
 */
// Pre-compiled blocklist patterns — hardcoded to avoid ReDoS risk (CWE-1333)
const BLOCKLIST_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/rm\s+-rf/i, 'rm -rf'],
  [/DROP\s+TABLE/i, 'DROP TABLE'],
  [/DELETE\s+FROM/i, 'DELETE FROM'],
  [/\bsudo\b/i, 'sudo'],
  [/curl.*\|.*sh/i, 'curl pipe to sh'],
  [/wget.*\|.*sh/i, 'wget pipe to sh'],
] as const

// Sensitive-path denylist — basename-anchored, so `data/../data/master.key`
// traversal cannot dodge it. Hardcoded like BLOCKLIST_PATTERNS (no ReDoS).
const SENSITIVE_PATH_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/master\.key/i, 'secrets master key'],
  [/data[\\/]sqlite/i, 'EYAS database directory'],
  [/\.env(rc)?(\.[A-Za-z0-9_-]+)?(?=["'\s\\/]|$)/i, '.env file'],
  [/\.ssh[\\/]/i, 'SSH directory'],
  [/id_(rsa|ed25519|ecdsa|dsa)/i, 'SSH private key'],
] as const

// Tools that touch the filesystem or run shell commands — SDK builtins
// (PascalCase), ACP-mapped names, and the EYAS shell tool.
const FILE_ACCESS_TOOLS: ReadonlySet<string> = new Set([
  // Claude Code SDK builtins (PascalCase)
  'Read', 'Write', 'Edit', 'NotebookEdit', 'Grep', 'Glob', 'Bash',
  // EYAS model-agnostic coding surface (snake_case)
  'run_command', 'read_file', 'write_file', 'edit_file', 'grep', 'glob',
  'git_status', 'git_diff',
])

export interface DeterministicGateDeps {
  /** Lazy per-tool risk-tier lookup backed by the tools module's registry
   * (ToolImplementation.riskTier). Resolved at call time so module init
   * ordering does not matter and no import cycle exists. */
  getRegistryTier?: (toolName: string) => RiskTier | undefined
  /** Extra literal path fragments denied for file-access tools (e.g. the
   * configured database path). Case-insensitive substring match. */
  sensitivePathLiterals?: string[]
}

export function createDeterministicGate(config: SecurityGateConfig, deps: DeterministicGateDeps = {}) {
  const denialCounts = { streak: 0, hourly: [] as number[], daily: [] as number[] }
  // Timestamp of the most recent streak-incrementing denial — lets the streak
  // limit recover after a quiet cooldown instead of locking out every
  // green-tier call for the rest of the process lifetime (recordDenial /
  // resetStreak are only reachable via the LLM-judge path, which a
  // streak-denied deterministic checkpoint never reaches).
  let lastDenialAt = 0

  function bumpStreak(atMs: number): void {
    denialCounts.streak++
    lastDenialAt = atMs
  }

  // Tier order: config red → yellow → green → registry tier → unclassified
  // (yellow, but flagged so the caller escalates with a fail-closed reason
  // instead of silently allowing).
  function resolveTier(toolName: string): { tier: RiskTier; classified: boolean } {
    if (config.riskTiers.red.includes(toolName)) return { tier: 'red', classified: true }
    if (config.riskTiers.yellow.includes(toolName)) return { tier: 'yellow', classified: true }
    if (config.riskTiers.green.includes(toolName)) return { tier: 'green', classified: true }
    const registryTier = deps.getRegistryTier?.(toolName)
    if (registryTier) return { tier: registryTier, classified: true }
    return { tier: 'yellow', classified: false }
  }

  function getRiskTier(toolName: string): RiskTier {
    return resolveTier(toolName).tier
  }

  function cleanOldEntries(arr: number[], windowMs: number): number[] {
    const cutoff = Date.now() - windowMs
    return arr.filter(t => t > cutoff)
  }

  return {
    check(toolName: string, input: Record<string, unknown>): SecurityCheckResult {
      const { tier: riskTier, classified } = resolveTier(toolName)
      const inputStr = JSON.stringify(input)
      const nowMs = Date.now()
      const now = new Date(nowMs).toISOString()

      // Check hardcoded blocklist patterns against input
      for (const [pattern, label] of BLOCKLIST_PATTERNS) {
        if (pattern.test(inputStr)) {
          bumpStreak(nowMs)
          return { decision: 'deny', checkpoint: 'deterministic', reason: `Input matches blocked pattern: ${label}`, riskTier, timestamp: now }
        }
      }

      // Sensitive-path denylist (F0) — file-access tools only, checked against
      // the serialized input regardless of risk tier (a green-tier `Read` of
      // the secrets master key is exactly the case this guards against).
      if (FILE_ACCESS_TOOLS.has(toolName)) {
        for (const [pattern, label] of SENSITIVE_PATH_PATTERNS) {
          if (pattern.test(inputStr)) {
            bumpStreak(nowMs)
            return { decision: 'deny', checkpoint: 'deterministic', reason: `Input touches a sensitive path: ${label}`, riskTier, timestamp: now }
          }
        }
        for (const literal of deps.sensitivePathLiterals ?? []) {
          if (literal && inputStr.toLowerCase().includes(literal.toLowerCase())) {
            bumpStreak(nowMs)
            return { decision: 'deny', checkpoint: 'deterministic', reason: 'Input touches a sensitive path: configured database path', riskTier, timestamp: now }
          }
        }
      }

      // Rate limit check
      denialCounts.hourly = cleanOldEntries(denialCounts.hourly, 3600_000)
      denialCounts.daily = cleanOldEntries(denialCounts.daily, 86400_000)

      // Streak cooldown: a quiet period since the last denial clears the
      // lockout; denials arriving within the window keep compounding it, so
      // rapid probing still trips the limit.
      if (denialCounts.streak > 0 && nowMs - lastDenialAt > config.rateLimits.streakCooldownMs) {
        denialCounts.streak = 0
      }

      if (denialCounts.streak >= config.rateLimits.streak) {
        return { decision: 'deny', checkpoint: 'deterministic', reason: `Rate limit: ${denialCounts.streak} consecutive denials`, riskTier, timestamp: now }
      }
      if (denialCounts.hourly.length >= config.rateLimits.hour) {
        return { decision: 'deny', checkpoint: 'deterministic', reason: `Rate limit: ${denialCounts.hourly.length} denials this hour`, riskTier, timestamp: now }
      }
      if (denialCounts.daily.length >= config.rateLimits.day) {
        return { decision: 'deny', checkpoint: 'deterministic', reason: `Rate limit: ${denialCounts.daily.length} denials today`, riskTier, timestamp: now }
      }

      // Reset streak on success
      denialCounts.streak = 0

      // Green tier: allow immediately — but ONLY for positively classified tools.
      if (classified && riskTier === 'green') {
        return { decision: 'allow', checkpoint: 'deterministic', reason: 'Green tier — allowed', riskTier, timestamp: now }
      }

      // Yellow/Red (classified) or unclassified: escalate to next checkpoint.
      return {
        decision: 'escalate',
        checkpoint: 'deterministic',
        reason: classified
          ? `${riskTier} tier — escalating to LLM judge`
          : `unclassified tool "${toolName}" — escalating to LLM judge (fail-closed)`,
        riskTier,
        timestamp: now,
      }
    },

    recordDenial(): void {
      const now = Date.now()
      bumpStreak(now)
      denialCounts.hourly.push(now)
      denialCounts.daily.push(now)
    },

    resetStreak(): void {
      denialCounts.streak = 0
    },

    getRiskTier,
  }
}
