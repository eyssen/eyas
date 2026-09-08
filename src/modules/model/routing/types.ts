// Part of eYssen. See LICENSE file for full copyright and licensing details.

/** Routing tiers — each tier maps to a preferred provider + model for a class of tasks. */
export type RoutingTier =
  | 'triage'          // First message analysis — complexity + category detection
  | 'quick'           // Simple questions, translations, FAQs
  | 'standard'        // Normal tasks — code writing, analysis, planning
  | 'complex'         // Deep reasoning, architecture, security audit
  | 'code'            // File operations, git, shell execution (Claude Code SDK)
  | 'heartbeat'       // Background — proactive checks, self-learning, scheduler
  | 'embedding'       // Vector search, semantic indexing
  | 'prompt_enhancer' // Iterative prompt refinement coach (sub-conversations)

/** Persisted tier configuration */
export interface TierConfig {
  tier: RoutingTier
  providerId: string
  modelId: string
  fallbackProviderId: string | null
  fallbackModelId: string | null
  description: string
  enabled: boolean
  updatedAt: string
}

/** Tier config for create/update API */
export interface TierConfigInput {
  providerId: string
  modelId: string
  fallbackProviderId?: string | null
  fallbackModelId?: string | null
  description?: string
  enabled?: boolean
}

/** Task category determined by triage */
export type TaskCategory =
  | 'chat'           // General conversation
  | 'code_generation'
  | 'code_review'
  | 'debugging'
  | 'architecture'
  | 'documentation'
  | 'translation'
  | 'summarization'
  | 'data_analysis'
  | 'research'
  | 'security_audit'
  | 'odoo_development'
  | 'system_admin'
  | 'creative'
  | 'unknown'

/** Task complexity level */
export type TaskComplexity = 'trivial' | 'simple' | 'moderate' | 'complex' | 'expert'

/** Triage result — determines which tier to use */
export interface TriageResult {
  tier: RoutingTier
  category: TaskCategory
  complexity: TaskComplexity
  confidence: number
  reason: string
}

/** Routing decision — final output of the decision engine */
export interface RoutingDecision {
  provider: string
  model: string
  tier: RoutingTier
  strategy: 'triage' | 'explicit' | 'fallback' | 'default' | 'budget_downgrade'
  confidence: number
  reason: string
  downgraded?: boolean
  fallback?: boolean
}

/** Budget status for cost control */
export interface BudgetStatus {
  daily: { spent: number; limit: number; action: 'ok' | 'warn' | 'downgrade' | 'stop' }
  weekly: { spent: number; limit: number; action: 'ok' | 'warn' | 'downgrade' | 'stop' }
  monthly: { spent: number; limit: number; action: 'ok' | 'warn' | 'downgrade' | 'stop' }
}

/** Budget configuration */
export interface BudgetConfig {
  dailyLimit: number | null
  weeklyLimit: number | null
  monthlyLimit: number | null
  warnAt: number        // percentage (e.g. 0.8 = 80%)
  downgradeAt: number   // percentage (e.g. 1.0 = 100%)
  hardStopAt: number    // percentage (e.g. 1.2 = 120%)
}

/** Global routing configuration */
export interface RoutingConfig {
  autoRoutingEnabled: boolean
  tiers: TierConfig[]
  budget: BudgetConfig
}

/** Tier complexity mapping — which tier handles which complexity */
export const COMPLEXITY_TO_TIER: Record<TaskComplexity, RoutingTier> = {
  trivial: 'quick',
  simple: 'quick',
  moderate: 'standard',
  complex: 'complex',
  expert: 'complex',
}

/** Category overrides — some categories always use a specific tier */
export const CATEGORY_TIER_OVERRIDE: Partial<Record<TaskCategory, RoutingTier>> = {
  translation: 'quick',
  summarization: 'quick',
  architecture: 'complex',
  security_audit: 'complex',
}

/**
 * Model downgrade path — cheaper alternatives.
 * Keys MUST match the ids the providers actually serve (see each provider's
 * *_MODELS table), otherwise a budget downgrade is a silent no-op.
 */
export const MODEL_DOWNGRADE_PATH: Record<string, string> = {
  // Anthropic API (submodules/anthropic/provider.ts ANTHROPIC_MODELS)
  'claude-fable-5': 'claude-opus-4-8',
  'claude-opus-4-8': 'claude-sonnet-4-6',
  'claude-opus-4-7': 'claude-sonnet-4-6',
  'claude-opus-4-6': 'claude-sonnet-4-6',
  'claude-sonnet-4-6': 'claude-haiku-4-5',
  // Claude Code CLI (submodules/claude-code/provider.ts KNOWN_MODELS)
  'claude-code-fable': 'claude-code-opus',
  'claude-code-opus': 'claude-code-sonnet',
  'claude-code-sonnet': 'claude-code-haiku',
  // Grok CLI — single model today; no cheaper alias (maps to itself if present)
  'grok-cli-default': 'grok-cli-default',
  // Kimi API (submodules/kimi/provider.ts)
  'kimi-k3': 'kimi-k2.7-code',
  'kimi-k2.7-code': 'kimi-k2.6',
  'kimi-k2.7-code-highspeed': 'kimi-k2.6',
  'kimi-k2.6': 'kimi-k2.5',
  // Kimi Code CLI
  'kimi-cli-k3': 'kimi-cli-default',
  'kimi-cli-k2.7-code': 'kimi-cli-k2.6',
  'kimi-cli-default': 'kimi-cli-k2.6',

  // OpenAI (submodules/openai/provider.ts OPENAI_MODELS)
  'gpt-4o': 'gpt-4o-mini',
  'gpt-4-turbo': 'gpt-4o-mini',
  'o3-mini': 'gpt-4o-mini',
}

/** Default tier configurations — no provider/model defaults, user configures in Settings */
export const DEFAULT_TIERS: TierConfig[] = [
  { tier: 'triage', providerId: '', modelId: '', fallbackProviderId: '', fallbackModelId: '', description: 'First message analysis — complexity and category detection', enabled: true, updatedAt: '' },
  { tier: 'quick', providerId: '', modelId: '', fallbackProviderId: '', fallbackModelId: '', description: 'Simple questions, translations, FAQs', enabled: true, updatedAt: '' },
  { tier: 'standard', providerId: '', modelId: '', fallbackProviderId: '', fallbackModelId: '', description: 'Normal tasks — code, analysis, planning', enabled: true, updatedAt: '' },
  { tier: 'complex', providerId: '', modelId: '', fallbackProviderId: '', fallbackModelId: '', description: 'Deep reasoning, architecture, security audit', enabled: true, updatedAt: '' },
  { tier: 'code', providerId: '', modelId: '', fallbackProviderId: '', fallbackModelId: '', description: 'File operations, git, shell execution', enabled: true, updatedAt: '' },
  { tier: 'heartbeat', providerId: '', modelId: '', fallbackProviderId: '', fallbackModelId: '', description: 'Background — proactive checks, self-learning', enabled: true, updatedAt: '' },
  { tier: 'embedding', providerId: '', modelId: '', fallbackProviderId: '', fallbackModelId: '', description: 'Vector search, semantic indexing', enabled: true, updatedAt: '' },
  { tier: 'prompt_enhancer', providerId: '', modelId: '', fallbackProviderId: '', fallbackModelId: '', description: 'Iterative prompt refinement coach (sub-conversations)', enabled: true, updatedAt: '' },
]
