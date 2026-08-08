// Part of eYssen. See LICENSE file for full copyright and licensing details.

export type RiskTier = 'green' | 'yellow' | 'red'

export type SecurityDecision = 'allow' | 'deny' | 'escalate' | 'judge_error'

export type SecurityGateMode = 'enforcing' | 'permissive'

export interface SecurityCheckResult {
  decision: SecurityDecision
  checkpoint: 'deterministic' | 'llm_judge' | 'runtime_monitor'
  reason: string
  riskTier: RiskTier
  timestamp: string
  /** Set when decision === 'judge_error' to capture the underlying error for logs */
  errorDetail?: string
}

export interface SecurityEvent {
  id?: number
  toolName: string
  input: string           // JSON
  decision: SecurityDecision
  checkpoint: string
  reason: string
  riskTier: RiskTier
  conversationId?: string
  agentId?: string
  sessionRiskScore: number
  createdAt: string
}

export interface SecurityGateConfig {
  enabled: boolean
  riskTiers: {
    green: string[]       // Tool names
    yellow: string[]
    red: string[]
  }
  rateLimits: {
    streak: number        // Max consecutive denials
    hour: number
    day: number
    /** A quiet period (ms) since the last denial that clears the streak
     * lockout. Without this, a legitimate agent that trips the streak limit
     * once (e.g. 3 denied probes) is denied every green-tier call for the
     * rest of the process lifetime — recordDenial()/resetStreak() only run
     * on the LLM-judge path, which the streak-denied deterministic checkpoint
     * never reaches. Denials arriving within the window keep compounding it,
     * so rapid probing still trips the limit. */
    streakCooldownMs: number
  }
  blocklist: string[]      // Regex patterns for input blocking
  goalDriftThreshold: number   // 0-1
  tokenWasteThreshold: number  // 0-1
  cumulativeRiskCap: number    // Max session risk before escalation
}

export const DEFAULT_CONFIG: SecurityGateConfig = {
  enabled: true,
  // `yellow`/`red`/`green` also list Claude Code SDK builtin tools (PascalCase)
  // so the claude-code provider's canUseTool bridge classifies them instead of
  // falling through to the fail-closed unclassified path. PascalCase names
  // don't collide with EYAS snake_case tools.
  riskTiers: {
    green: [
      'search_memory', 'search_indexed', 'list_search_sources', 'search_knowledge', 'get_page', 'list_documents', 'read_document', 'list_projects', 'get_conversation_status',
      // Intra-run agent coordination — in-process, session-scoped, no egress.
      // The registry fallback already classifies these from their `riskTier`;
      // listing them here is defence in depth for a boot order where the
      // registry is not yet reachable from the gate.
      'send_agent_message', 'read_agent_messages',
      // Claude Code SDK read-only builtins (PascalCase). Explicitly green so
      // every file read does not invoke the LLM judge; the deterministic
      // sensitive-path denylist still guards them. Task spawns a subagent
      // whose own tool calls are individually gated via canUseTool.
      'Read', 'Grep', 'Glob', 'Task',
    ],
    yellow: [
      'save_memory', 'create_page', 'move_to_stage', 'create_sub_conversation', 'upload_document', 'Write', 'Edit', 'NotebookEdit',
      // Network egress builtins — potential exfiltration channel, judge-reviewed.
      // `research` performs web search + source fetching, so it belongs here
      // with WebFetch/WebSearch rather than in the deterministically-allowed set.
      'WebFetch', 'WebSearch', 'research',
      // Spends another agent's budget on an unattended background run — same
      // posture as delegate_to_agent, which the registry fallback already
      // classifies yellow. Listed here as defence in depth (D3/D11).
      'assign_task',
    ],
    red: ['run_command', 'browser_navigate', 'Bash'],
  },
  rateLimits: { streak: 3, hour: 5, day: 10, streakCooldownMs: 600_000 },
  blocklist: [
    'rm\\s+-rf', 'DROP\\s+TABLE', 'DELETE\\s+FROM', '\\bsudo\\b',
    'curl.*\\|.*sh', 'wget.*\\|.*sh',
  ],
  goalDriftThreshold: 0.3,
  tokenWasteThreshold: 0.5,
  cumulativeRiskCap: 10,
}
