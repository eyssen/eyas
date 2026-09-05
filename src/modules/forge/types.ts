// Part of eYssen. See LICENSE file for full copyright and licensing details.

export type ForgeTarget = 'skill' | 'tool'
export type ForgeScope = 'description' | 'schema' | 'prompt' | 'behavior' | 'code'

export interface ForgeFeedback {
  id: string
  target: ForgeTarget
  targetId: string
  conversationId: string
  agentId: string | null
  useful: boolean
  friction: string | null
  betterApproach: string | null
  createdAt: string
}

export interface CreateFeedbackInput {
  target: ForgeTarget
  targetId: string
  conversationId: string
  agentId?: string
  useful: boolean
  friction?: string
  betterApproach?: string
}

export interface FrictionPattern {
  targetId: string
  target: ForgeTarget
  frictionCount: number
  totalUsages: number
  frictionRate: number
  topFrictions: string[]
  topSuggestions: string[]
  sampleFeedbackIds: string[]
}

export interface ForgeProposal {
  id: string
  target: ForgeTarget
  targetId: string
  scope: ForgeScope
  title: string
  description: string
  currentValue: string
  proposedValue: string
  reasoning: string
  confidence: number
  basedOnFeedbacks: number
  status: 'pending' | 'testing' | 'approved' | 'rejected' | 'applied'
  experimentId: string | null
  createdAt: string
  reviewedAt: string | null
}

export interface CreateProposalInput {
  target: ForgeTarget
  targetId: string
  scope: ForgeScope
  title: string
  description: string
  currentValue: string
  proposedValue: string
  reasoning: string
  confidence: number
  basedOnFeedbacks: number
}

export interface ForgeExperiment {
  id: string
  proposalId: string
  conversationId: string
  status: 'running' | 'passed' | 'failed'
  result: string | null
  startedAt: string
  completedAt: string | null
}

export interface ForgeConfig {
  minFeedbacksForAnalysis: number
  frictionRateThreshold: number
  autoApproveConfidence: number
  analysisWindowDays: number
  maxProposalsPerRun: number
}
