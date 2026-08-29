// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface EvolutionCandidate {
  id: string
  name: string
  description: string
  triggerPatterns: string[]
  content: string
  reasoning: string
  confidence: number
  basedOnSessions: number
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
  reviewedAt?: string
}

export interface EvolutionCandidateInput {
  name: string
  description: string
  triggerPatterns: string[]
  content: string
  reasoning: string
  confidence: number
  basedOnSessions: number
}

export interface EvolutionConfig {
  minSessionsForPattern: number
  minConfidence: number
  analysisWindowDays: number
  autoApproveThreshold: number
}

export interface DetectedPattern {
  title: string
  occurrences: number
  confidence: number
  avgTokens: number
  sampleConversationIds: string[]
}
