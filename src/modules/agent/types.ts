// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EffortLevel } from '@modules/model/reasoning/ladder.js'

export type AgentTier = 'primary' | 'team' | 'specialist'
export type AgentType = 'assistant' | 'engineer' | 'developer' | 'reviewer' | 'critic' | 'researcher' | 'planner' | 'coordinator' | 'observer'

export interface AgentDefinition {
  id: string
  name: string
  role: string
  description: string
  goal: string
  backstory: string
  tier: AgentTier
  agentType: AgentType
  systemPrompt: string
  capabilities: string[]
  tools: string[]              // Tool names from ToolRegistry
  constraints: string[]
  /**
   * The provider of `model`: together they are the colleague's model binding
   * (model/binding.ts). Absent with a model only for a legacy row whose model
   * id (or tier alias, e.g. 'sonnet') no single provider owns; the resolver
   * binds that to its owner at run time.
   */
  provider?: string
  model?: string               // Model id (or a legacy tier alias); none = the conversation's own model
  maxTurns?: number            // Max tool-use loop iterations
  effort?: EffortLevel          // A rung of the canonical effort ladder (undefined = Auto)
  enabled: boolean
  source: 'seed' | 'user' | 'generated'
  avatar?: string
  tags?: string[]
  monthlyTokenBudget?: number  // 0 = unlimited
  tokensUsedThisMonth?: number
  budgetResetAt?: string
  createdAt?: string
  updatedAt?: string
}

export interface AgentSession {
  id: string
  conversationId: string
  agentId: string
  status: 'running' | 'waiting_approval' | 'completed' | 'max_turns' | 'failed' | 'stuck' | 'cancelled'
  turnsUsed: number
  tokensUsed: number
  costUsd: number
  toolCalls: AgentToolCall[]
  startedAt: string
  completedAt?: string
  error?: string
}

export interface AgentToolCall {
  toolName: string
  input: Record<string, unknown>
  output?: Record<string, unknown>
  error?: string
  durationMs: number
  timestamp: string
}

export interface AgentMessage {
  id: number
  sessionId: string
  fromAgent: string
  toAgent?: string
  content: string
  timestamp: string
}

export type ConversationMode = 'simple' | 'managed' | 'autonomous' | 'wizard'
export type ConversationComplexity = 'trivial' | 'simple' | 'moderate' | 'complex' | 'epic'

export interface CreateAgentInput {
  id: string
  name: string
  role: string
  description: string
  goal: string
  backstory: string
  tier?: AgentTier
  agentType?: AgentType
  systemPrompt: string
  capabilities: string[]
  tools: string[]
  constraints: string[]
  /** The provider of `model` (null clears it). Written with the model. */
  provider?: string | null
  /** null clears it: the colleague then runs on the conversation's own model. */
  model?: string | null
  maxTurns?: number
  effort?: EffortLevel | null
  enabled?: boolean
  source?: 'seed' | 'user' | 'generated'
  avatar?: string
  tags?: string[]
  monthlyTokenBudget?: number
  /**
   * Free-form JSON kept on the row (`agent_definitions.config`). An import puts
   * the source file's own frontmatter here, so a field EYAS has no column for —
   * `model`, `color`, `permissionMode` — is not lost when the persona lands.
   */
  config?: string
}

export interface AgentFilter {
  enabled?: boolean
  source?: 'seed' | 'user'
  capability?: string
  tag?: string
  tier?: AgentTier
  agentType?: AgentType
}
