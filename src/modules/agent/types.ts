// Part of eYssen. See LICENSE file for full copyright and licensing details.

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
  model?: string               // Model preference (e.g., 'opus', 'sonnet')
  maxTurns?: number            // Max tool-use loop iterations
  effort?: 'low' | 'medium' | 'high' | 'max'  // Reasoning effort override (undefined = auto)
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
  model?: string
  maxTurns?: number
  effort?: 'low' | 'medium' | 'high' | 'max' | null
  enabled?: boolean
  source?: 'seed' | 'user' | 'generated'
  avatar?: string
  tags?: string[]
  monthlyTokenBudget?: number
}

export interface AgentFilter {
  enabled?: boolean
  source?: 'seed' | 'user'
  capability?: string
  tag?: string
  tier?: AgentTier
  agentType?: AgentType
}
