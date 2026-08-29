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

// Memory surfaces that belong to another tool (F1.1). EYAS manages memory
// model-independently in its OWN memory; an agent backed by a CLI provider
// inherits that CLI's conventions and writes to these instead, where EYAS can
// neither scope, sanitise nor version what it wrote.
//
// Deliberately NARROW — each entry names a memory-bearing surface, not a whole
// dot-directory. A workspace's `.claude/settings.json` and `.claude/agents/*`
// are ordinary project config an agent may legitimately edit, and rule 8 itself
// says a workspace CLAUDE.md is fine, so the gate must agree or every repo
// carrying one trips a denial and then the streak lockout.
//
// MEMORY.md is absent for the same reason: the gate is handed a path, not a
// workspace root, so it cannot tell the owner's global index from a
// repository's own docs/MEMORY.md.
//
// Boundaries are a separator, whitespace, a quote or the end of the VALUE (not
// of the serialized input — these run against path-bearing fields only).
const MEMORY_PATH_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // An ai-memory directory anywhere — the name is unambiguous on its own.
  [/(?:^|[\\/\s'"])ai-memory(?=[\\/\s'"]|$)/i, 'an ai-memory directory'],
  // The owner's home-directory config for another tool: ~, $HOME, /Users/<u>,
  // /home/<u>, /root. Whole-directory, because at HOME it is that tool's own
  // state, never this workspace's.
  [
    /(?:~|\$\{?HOME\}?|[\\/](?:root|(?:Users|home)[\\/][^\\/\s'"]+))[\\/]\.(?:claude|grok)(?=[\\/\s'"]|$)/i,
    'another tool\'s home-directory state',
  ],
  // A memory directory under either dot-dir, at any depth — including a
  // workspace-relative one, which is the same machine-global convention
  // wearing a relative path.
  [/(?:^|[\\/\s'"])\.(?:claude|grok)[\\/](?:[^\s'"]*[\\/])?memory(?=[\\/\s'"]|$)/i, 'another tool\'s memory directory'],
] as const

// Input fields that carry a PATH, taken from the real tool schemas: `file_path`
// (Read/Write/Edit), `notebook_path` (NotebookEdit), `path` (Grep/Glob and the
// EYAS read_file/write_file/edit_file/grep/glob surface), and `command`/`args`/
// `workingDir` (Bash, run_command).
//
// MEMORY_PATH_PATTERNS are matched against these values only — never against
// the whole serialized input the way the pre-existing sensitive-path list is.
// Matching the blob denied writing any file whose CONTENT merely mentions these
// paths, which includes this repository's own CHANGELOG and the memory rule
// itself: self-blocking, and three in a row would hit the streak lockout.
const PATH_FIELDS: ReadonlySet<string> = new Set([
  'file_path', 'filePath', 'notebook_path', 'notebookPath',
  'path', 'paths', 'command', 'args', 'workingDir', 'cwd',
])

/** Every string sitting under a path-bearing key, at any nesting depth. */
function pathValues(value: unknown, keyIsPath: boolean, depth: number, out: string[]): void {
  if (depth > 4) return
  if (typeof value === 'string') {
    if (keyIsPath) out.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) pathValues(item, keyIsPath, depth + 1, out)
    return
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) pathValues(v, keyIsPath || PATH_FIELDS.has(k), depth + 1, out)
  }
}

// Tools that touch the filesystem or run shell commands — SDK builtins
// (PascalCase), ACP-mapped names, and the EYAS shell tool.
const FILE_ACCESS_TOOLS: ReadonlySet<string> = new Set([
  // Claude Code SDK builtins (PascalCase)
  'Read', 'Write', 'Edit', 'NotebookEdit', 'Grep', 'Glob', 'Bash',
  // EYAS model-agnostic coding surface (snake_case)
  'run_command', 'read_file', 'write_file', 'edit_file', 'grep', 'glob',
  'git_status', 'git_diff',
])

// Where MEMORY_PATH_PATTERNS applies: the tools that can CHANGE a file, plus
// the shell. Reading another tool's memory is something EYAS does on purpose —
// the data-port importer carries an owner's existing notes INTO EYAS — so the
// non-shell read tools (Read/Grep/Glob and their snake_case twins) are left
// open. The shell is NOT: `cat` is one character from `>>`, and no inspection
// of a command string can prove which one it is, so Bash and run_command are
// blocked here in both directions.
const FILE_WRITE_TOOLS: ReadonlySet<string> = new Set([
  'Write', 'Edit', 'NotebookEdit', 'Bash',
  'write_file', 'edit_file', 'run_command',
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
        if (FILE_WRITE_TOOLS.has(toolName)) {
          const paths: string[] = []
          pathValues(input, false, 0, paths)
          for (const [pattern, label] of MEMORY_PATH_PATTERNS) {
            if (paths.some((p) => pattern.test(p))) {
              bumpStreak(nowMs)
              return { decision: 'deny', checkpoint: 'deterministic', reason: `Path is memory outside EYAS: ${label}`, riskTier, timestamp: now }
            }
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
