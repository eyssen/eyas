// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface ExecutionInsight {
  type: 'success_rate' | 'prompt_effectiveness' | 'model_routing' | 'constraint_tuning' | 'agent_recommendation'
  agentId?: string
  metric: number                    // 0-1 score
  currentValue: string
  suggestedValue: string
  confidence: number                // 0-1
  dataPoints: number
  reasoning: string
  createdAt: string
}

export interface ActivityPattern {
  type: 'recurring_task' | 'error_pattern' | 'cost_anomaly' | 'usage_trend'
  description: string
  frequency: number                 // Times observed
  lastSeen: string
  suggestion?: string
}

export interface EfficiencyReport {
  period: 'daily' | 'weekly' | 'monthly'
  totalTokens: number
  totalCostUsd: number
  totalSessions: number
  successRate: number               // 0-1
  avgTokensPerSession: number
  topAgents: { agentId: string; sessions: number; tokens: number; successRate: number }[]
  topTools: { toolName: string; calls: number; avgDurationMs: number; errorRate: number }[]
  insights: ExecutionInsight[]
  generatedAt: string
}

export interface SkillSuggestion {
  name: string
  description: string
  triggerPatterns: string[]
  reasoning: string
  basedOnTasks: number
  confidence: number
}
