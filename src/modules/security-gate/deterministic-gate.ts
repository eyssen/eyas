// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { isAbsolute } from 'node:path'
import { getPathPolicy as processPathPolicy, type PathPolicy, type PathViolation } from '@shared/memory-sovereignty/path-policy.js'
import { memoryPathFailClosedReason, memoryPathReason } from '@shared/memory-sovereignty/deny-reason.js'
import type { SecurityCheckResult, RiskTier, SecurityGateConfig, SecurityCallContext } from './types.js'
import { dedicatedReadOnlyCommand } from './read-only-command.js'

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

const EYAS_MCP_PREFIX = 'mcp__eyas__'

/** The caller's working directories as the policy wants them: absolute paths, or undefined when none are known. */
function knownWorkingDirectories(ctx?: SecurityCallContext): string[] | undefined {
  const dirs = (ctx?.workingDirectories ?? []).filter((d): d is string => typeof d === 'string' && isAbsolute(d))
  return dirs.length > 0 ? dirs : undefined
}

export interface DeterministicGateDeps {
  /** Lazy per-tool risk-tier lookup backed by the tools module's registry
   * (ToolImplementation.riskTier). Resolved at call time so module init
   * ordering does not matter and no import cycle exists. */
  getRegistryTier?: (toolName: string) => RiskTier | undefined
  /**
   * The memory-sovereignty path policy, read per call (default: the
   * process-wide one the security gate installs, with its lazy default
   * before that — there is never "no policy").
   */
  getPathPolicy?: () => PathPolicy
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

  /**
   * Memory sovereignty: a model reads and writes memory only through EYAS.
   * Every path-bearing field of EVERY tool's input — not only the file tools:
   * ACP ListDir's target_directory, a Task cwd and EYAS MCP tools carry paths
   * too — is judged by the one path policy (src/shared/memory-sovereignty).
   * A CLI's own search (Grep, Glob, list_dir, a recursive shell command) is
   * judged by what it can reach below its folder: one whose folder contains
   * a protected place is refused as "search too broad" (search-scope.ts).
   * Reads are refused exactly like writes: the data-port importer reads other
   * tools' stores with its own file access and never through a model tool
   * call, so nothing legitimate needs this door open.
   *
   * A violation is a hard deny: never escalated (no judge, no approval, no
   * grant can open it) and never counted toward the denial streak — a model
   * retrying a forbidden path must not lock the green tools out for the
   * cooldown. A policy that cannot answer denies (fail-closed).
   */
  function checkMemoryPath(toolName: string, input: Record<string, unknown>, ctx?: SecurityCallContext): SecurityCheckResult | null {
    const name = toolName.startsWith(EYAS_MCP_PREFIX) ? toolName.slice(EYAS_MCP_PREFIX.length) : toolName
    let violation: PathViolation | null
    try {
      const policy = (deps.getPathPolicy ?? processPathPolicy)()
      violation = policy.evaluateToolInput(name, input, {
        workingDirectories: knownWorkingDirectories(ctx),
        ...(typeof ctx?.homeDir === 'string' && isAbsolute(ctx.homeDir) ? { homeDir: ctx.homeDir } : {}),
      })
    } catch (err) {
      return {
        decision: 'deny',
        checkpoint: 'deterministic',
        reason: memoryPathFailClosedReason(err),
        riskTier: resolveTier(name).tier,
        timestamp: new Date().toISOString(),
      }
    }
    if (!violation) return null
    return {
      decision: 'deny',
      checkpoint: 'deterministic',
      reason: memoryPathReason(violation),
      riskTier: resolveTier(name).tier,
      timestamp: new Date().toISOString(),
    }
  }

  return {
    check(toolName: string, input: Record<string, unknown>, ctx?: SecurityCallContext): SecurityCheckResult {
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
      }

      // Memory outside EYAS, EYAS's own data (database included, wherever it
      // lives) and another conversation's workspace: hard deny, no streak
      // bump (see checkMemoryPath). After the blocklist and the sensitive
      // paths, which stay streak-counting probe signals.
      const memory = checkMemoryPath(toolName, input, ctx)
      if (memory) return memory

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

      // CLI providers send git status / git diff through Bash or run_command
      // (red). When the argv is exactly a dedicated green-tool equivalent,
      // allow it here so a coding conversation does not stall on a click.
      // Blocklist + sensitive-path checks above still apply.
      if (toolName === 'Bash' || toolName === 'run_command') {
        const dedicated = dedicatedReadOnlyCommand(input)
        if (dedicated) {
          return {
            decision: 'allow',
            checkpoint: 'deterministic',
            reason: `Read-only command matching ${dedicated}`,
            riskTier: 'green',
            timestamp: now,
          }
        }
      }

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

    checkMemoryPath,

    getRiskTier,
  }
}
