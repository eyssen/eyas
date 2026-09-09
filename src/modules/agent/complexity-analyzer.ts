// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ConversationComplexity, ConversationMode } from './types.js'

// ─── Input / Output ───────────────────────────

interface AnalysisInput {
  userMessage: string
  conversationHistory?: { role: string; content: string }[]
  hasProject?: boolean
  hasAgent?: boolean
}

interface ComplexityResult {
  complexity: ConversationComplexity
  suggestedMode: ConversationMode
  reasoning: string
  needsClarification: boolean
  clarificationQuestion?: string
}

// ─── Heuristic indicators ─────────────────────

const COMPLEX_INDICATORS = [
  'create a module', 'build', 'implement', 'develop', 'design',
  'refactor', 'migrate', 'upgrade', 'review and fix',
  'modul', 'fejlessz', 'tervezz', 'építs', 'készíts',
]

const MULTI_FILE_INDICATORS = [
  'module', 'modul', 'system', 'rendszer', 'workflow', 'pipeline',
]

const QUICK_QUESTION_PREFIXES = [
  'mi ', 'what ', 'how ', 'why ', 'who ', 'where ', 'when ',
  'which ', 'is ', 'can ', 'does ', 'do ', 'are ',
  'hány ', 'mennyi ', 'melyik ', 'hol ', 'mikor ',
]

// ─── Analyzer ─────────────────────────────────

/**
 * Heuristic-based complexity analysis for incoming user messages.
 * Determines conversation mode and whether clarification is needed.
 * Can be enhanced with LLM-based analysis later.
 */
export function analyzeComplexity(input: AnalysisInput): ComplexityResult {
  const msg = input.userMessage.toLowerCase()
  const wordCount = msg.split(/\s+/).length

  // Quick questions — trivial
  const isQuestion = msg.includes('?') || QUICK_QUESTION_PREFIXES.some(p => msg.startsWith(p))
  if (wordCount < 15 && isQuestion) {
    return {
      complexity: 'trivial',
      suggestedMode: 'simple',
      reasoning: 'Short question',
      needsClarification: false,
    }
  }

  const hasComplexIndicator = COMPLEX_INDICATORS.some(i => msg.includes(i))
  const isMultiFile = MULTI_FILE_INDICATORS.some(i => msg.includes(i))

  // Multi-file + complex → autonomous mode with clarification
  if (hasComplexIndicator && isMultiFile) {
    return {
      complexity: 'complex',
      suggestedMode: 'autonomous',
      reasoning: 'Multi-file development task detected',
      needsClarification: true,
      clarificationQuestion:
        'This looks like a complex task. Should I help you refine the requirements first with the Prompt Wizard?',
    }
  }

  // Development task → managed mode
  if (hasComplexIndicator) {
    return {
      complexity: 'moderate',
      suggestedMode: 'managed',
      reasoning: 'Development task with tool use needed',
      needsClarification: false,
    }
  }

  // Default: simple conversation
  return {
    complexity: 'simple',
    suggestedMode: 'simple',
    reasoning: 'Standard interaction',
    needsClarification: false,
  }
}

export type { AnalysisInput, ComplexityResult }
