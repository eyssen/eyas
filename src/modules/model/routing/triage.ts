// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ModelGateway } from '../types.js'
import type {
  TriageResult, TaskCategory, TaskComplexity, RoutingTier,
  TierConfig, COMPLEXITY_TO_TIER, CATEGORY_TIER_OVERRIDE,
} from './types.js'

// ─── Keyword-based triage (zero cost) ──────────────────

interface KeywordRule {
  patterns: RegExp[]
  category: TaskCategory
  complexity: TaskComplexity
}

const KEYWORD_RULES: KeywordRule[] = [
  // Odoo-specific
  { patterns: [/odoo/i, /\bres\.\w+/i, /\bmodule\b.*odoo/i, /\b__manifest__/i], category: 'odoo_development', complexity: 'moderate' },

  // Code generation
  { patterns: [/(?:write|create|implement|add)\s+(?:a\s+)?(?:function|class|component|module|api)/i, /kód(?:ot)?\s+(?:ír|készít|generál)/i], category: 'code_generation', complexity: 'moderate' },

  // Code review
  { patterns: [/review|audit|check.*code|nézd.*át|ellenőriz/i], category: 'code_review', complexity: 'moderate' },

  // Architecture
  { patterns: [/architect|design.*system|tervez.*rendszer|infrastruktúr/i], category: 'architecture', complexity: 'complex' },

  // Security
  { patterns: [/security|vulnerability|biztonság|sérülékenység/i], category: 'security_audit', complexity: 'complex' },

  // Translation
  { patterns: [/translat|fordít|locali[sz]/i], category: 'translation', complexity: 'trivial' },

  // Summarization
  { patterns: [/summar|összefoglal|kivonat/i], category: 'summarization', complexity: 'simple' },

  // Debugging
  { patterns: [/debug|fix.*bug|hiba.*javít|error.*fix|nem.*működik/i], category: 'debugging', complexity: 'moderate' },

  // Documentation
  { patterns: [/document|docs|readme|leírás.*készít/i], category: 'documentation', complexity: 'simple' },

  // Research
  { patterns: [/research|investigate|kutat|vizsgál/i], category: 'research', complexity: 'moderate' },

  // Data analysis
  { patterns: [/analy[sz]|statistic|elemz|adat.*elemz/i], category: 'data_analysis', complexity: 'moderate' },

  // Creative
  { patterns: [/creative|brainstorm|ötlet|design.*ui|frontend.*design/i], category: 'creative', complexity: 'moderate' },
]

// Complexity signals from message structure
const COMPLEXITY_SIGNALS = {
  simple: [/^.{0,100}$/s, /^(?:mi|what|how|why|mikor|hol)\s/i, /\?$/],
  complex: [/(?:and|és|továbbá|moreover|additionally).+(?:and|és|továbbá)/i, /\d+\.\s/m, /step|lépés|phase|fázis/i],
}

/**
 * Zero-cost keyword-based triage — analyzes the message locally without LLM calls.
 * Falls back to LLM-based triage if confidence is too low.
 */
export function keywordTriage(message: string): TriageResult {
  const text = message.trim()

  // Check keyword rules
  for (const rule of KEYWORD_RULES) {
    const matched = rule.patterns.filter(p => p.test(text))
    if (matched.length > 0) {
      const confidence = Math.min(0.9, 0.5 + matched.length * 0.15)

      // Adjust complexity based on message length and structure
      let complexity = rule.complexity
      if (text.length > 500 && complexity === 'simple') complexity = 'moderate'
      if (text.length > 1000) complexity = complexity === 'trivial' ? 'moderate' : complexity === 'simple' ? 'moderate' : complexity
      if (COMPLEXITY_SIGNALS.complex.some(p => p.test(text)) && complexity !== 'expert') {
        const levels: TaskComplexity[] = ['trivial', 'simple', 'moderate', 'complex', 'expert']
        const idx = levels.indexOf(complexity)
        if (idx < levels.length - 1) complexity = levels[idx + 1]
      }

      // Map complexity to tier, with category overrides
      const { COMPLEXITY_TO_TIER: ctt, CATEGORY_TIER_OVERRIDE: cto } = require('./types.js')
      const tier: RoutingTier = (cto as any)[rule.category] ?? (ctt as any)[complexity] ?? 'standard'

      return {
        tier,
        category: rule.category,
        complexity,
        confidence,
        reason: `Keyword match: ${rule.category} (${matched.length} pattern${matched.length > 1 ? 's' : ''})`,
      }
    }
  }

  // No keyword match — estimate from message structure
  let complexity: TaskComplexity = 'moderate'
  if (text.length < 50 && COMPLEXITY_SIGNALS.simple.some(p => p.test(text))) {
    complexity = 'simple'
  } else if (text.length > 500 || COMPLEXITY_SIGNALS.complex.some(p => p.test(text))) {
    complexity = 'complex'
  }

  const { COMPLEXITY_TO_TIER: ctt } = require('./types.js')
  const tier: RoutingTier = (ctt as any)[complexity] ?? 'standard'

  return {
    tier,
    category: 'chat',
    complexity,
    confidence: 0.3,
    reason: 'No keyword match — defaulting by message complexity',
  }
}

/**
 * LLM-based triage — uses a cheap/fast model to classify the message.
 * Only called when keyword triage confidence is below threshold.
 */
export async function llmTriage(
  message: string,
  gateway: ModelGateway,
  triageTier: TierConfig,
): Promise<TriageResult> {
  const triagePrompt = `Classify this user message into exactly one category and complexity level.

Categories: chat, code_generation, code_review, debugging, architecture, documentation, translation, summarization, data_analysis, research, security_audit, odoo_development, system_admin, creative
Complexity: trivial, simple, moderate, complex, expert

Respond with ONLY a JSON object, no other text:
{"category": "...", "complexity": "..."}

Message:
${message.slice(0, 500)}`

  try {
    const response = await gateway.complete({
      provider: triageTier.providerId,
      model: triageTier.modelId,
      messages: [{ role: 'user', content: triagePrompt }],
      system: 'You are a message classifier. Respond with only JSON.',
    })

    const text = response.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('')

    const jsonMatch = text.match(/\{[^}]+\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { category: string; complexity: string }
      const category = parsed.category as TaskCategory
      const complexity = parsed.complexity as TaskComplexity

      const { COMPLEXITY_TO_TIER: ctt, CATEGORY_TIER_OVERRIDE: cto } = require('./types.js')
      const tier: RoutingTier = (cto as any)[category] ?? (ctt as any)[complexity] ?? 'standard'

      return {
        tier,
        category,
        complexity,
        confidence: 0.85,
        reason: `LLM triage: ${category} / ${complexity}`,
      }
    }
  } catch {
    // LLM triage failed — fall back to keyword result
  }

  return keywordTriage(message)
}

/**
 * Full triage pipeline: keyword first (free), LLM if low confidence.
 */
export async function triage(
  message: string,
  gateway: ModelGateway,
  triageTier: TierConfig,
  confidenceThreshold = 0.6,
): Promise<TriageResult> {
  const keywordResult = keywordTriage(message)

  if (keywordResult.confidence >= confidenceThreshold) {
    return keywordResult
  }

  // Low confidence — try LLM triage if tier is enabled and provider exists
  if (triageTier.enabled && gateway.getProvider(triageTier.providerId)) {
    return llmTriage(message, gateway, triageTier)
  }

  // Fallback provider
  if (triageTier.fallbackProviderId && gateway.getProvider(triageTier.fallbackProviderId)) {
    return llmTriage(message, gateway, {
      ...triageTier,
      providerId: triageTier.fallbackProviderId!,
      modelId: triageTier.fallbackModelId!,
    })
  }

  return keywordResult
}
