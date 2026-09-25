// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'
import type { AuxiliaryModelService } from '../auxiliary.js'
import type {
  TriageResult, TaskCategory, TaskComplexity, RoutingTier,
} from './types.js'
// Values, not types. They used to sit in the `import type` above, which erases
// them, and three call sites below reached for `require('./types.js')` to get
// them back — a CJS call in an ESM codebase that resolves only once something
// else has already loaded the module. The symptom was a route throwing
// "Cannot find module './types.js'" when its test ran on its own and passing
// in a warm suite.
import { COMPLEXITY_TO_TIER, CATEGORY_TIER_OVERRIDE } from './types.js'

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
      const tier: RoutingTier = (CATEGORY_TIER_OVERRIDE as any)[rule.category] ?? (COMPLEXITY_TO_TIER as any)[complexity] ?? 'standard'

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

  const tier: RoutingTier = (COMPLEXITY_TO_TIER as any)[complexity] ?? 'standard'

  return {
    tier,
    category: 'chat',
    complexity,
    confidence: 0.3,
    reason: 'No keyword match — defaulting by message complexity',
  }
}

// ─── Model triage (the Triage tier, through the auxiliary service) ──────

/** Keyword confidence below this asks the Triage tier's model. */
export const TRIAGE_CONFIDENCE_THRESHOLD = 0.6

/** The categories the classifier may answer with. */
export const LLM_TRIAGE_CATEGORIES = [
  'chat', 'code_generation', 'code_review', 'debugging', 'architecture', 'documentation', 'translation',
  'summarization', 'data_analysis', 'research', 'security_audit', 'odoo_development', 'system_admin', 'creative',
] as const satisfies readonly TaskCategory[]

export const TRIAGE_COMPLEXITIES = ['trivial', 'simple', 'moderate', 'complex', 'expert'] as const satisfies readonly TaskComplexity[]

const TRIAGE_SYSTEM = 'You are a message classifier. Respond with only JSON.'

/** Only this much of the message is classified. */
const TRIAGE_MESSAGE_CHARS = 500

const normalized = (s: unknown) => (typeof s === 'string' ? s.trim().toLowerCase() : s)

/** The classifier's answer is model output: validated, never cast. */
const TriageVerdictSchema = z.object({
  category: z.preprocess(normalized, z.enum(LLM_TRIAGE_CATEGORIES)),
  complexity: z.preprocess(normalized, z.enum(TRIAGE_COMPLEXITIES)),
})

export interface TriageOptions {
  /** Default TRIAGE_CONFIDENCE_THRESHOLD. */
  confidenceThreshold?: number
  /** The conversation being routed, for trace attribution. */
  conversationId?: string
}

function triagePrompt(message: string): string {
  return `Classify this user message into exactly one category and complexity level.

Categories: ${LLM_TRIAGE_CATEGORIES.join(', ')}
Complexity: ${TRIAGE_COMPLEXITIES.join(', ')}

Respond with ONLY a JSON object, no other text:
{"category": "...", "complexity": "..."}

Message:
${message.slice(0, TRIAGE_MESSAGE_CHARS)}`
}

/** The first JSON object in the answer, validated; null when there is none or it does not fit. */
function parseVerdict(text: string): { category: TaskCategory; complexity: TaskComplexity } | null {
  const match = text.match(/\{[^}]+\}/)
  if (!match) return null
  try {
    const parsed = TriageVerdictSchema.safeParse(JSON.parse(match[0]))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * Model triage: the Triage tier's model classifies the message through the
 * auxiliary model service — an isolated one-shot on the tier's primary or
 * fallback row, only when that provider can run isolated calls, through the
 * current (privacy- and trace-wrapped) gateway. No eligible model, an error,
 * a refusal or an answer that does not validate gives the keyword result.
 */
export async function llmTriage(
  message: string,
  aux: AuxiliaryModelService | undefined,
  options: TriageOptions = {},
): Promise<TriageResult> {
  if (!aux) return keywordTriage(message)
  try {
    const result = await aux.complete({
      purpose: 'triage',
      system: TRIAGE_SYSTEM,
      user: triagePrompt(message),
      maxTokens: 60,
      temperature: 0,
      origin: 'interactive',
      ...(options.conversationId ? { conversationId: options.conversationId } : {}),
    })
    const verdict = result.ok && result.stopReason !== 'refusal' ? parseVerdict(result.text) : null
    if (verdict) {
      const { category, complexity } = verdict
      const tier: RoutingTier = CATEGORY_TIER_OVERRIDE[category] ?? COMPLEXITY_TO_TIER[complexity] ?? 'standard'
      return {
        tier,
        category,
        complexity,
        confidence: 0.85,
        reason: `LLM triage: ${category} / ${complexity}`,
      }
    }
  } catch {
    // The service never throws; a broken stand-in still costs only the classification.
  }
  return keywordTriage(message)
}

/**
 * Full triage pipeline: keyword rules first (free); the Triage tier's model
 * only when they cannot place the message.
 */
export async function triage(
  message: string,
  aux: AuxiliaryModelService | undefined,
  options: TriageOptions = {},
): Promise<TriageResult> {
  const keywordResult = keywordTriage(message)
  if (keywordResult.confidence >= (options.confidenceThreshold ?? TRIAGE_CONFIDENCE_THRESHOLD)) {
    return keywordResult
  }
  return llmTriage(message, aux, options)
}
