// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Curated, model-family prompt profiles used by the Prompt Enhancer coach.
 * Technique cards are short digests of official provider guidance — not full docs.
 */

export type PromptFamily =
  | 'claude'
  | 'openai'
  | 'gemini'
  | 'grok'
  | 'kimi'
  | 'generic'

export type PromptTaskType =
  | 'coding'
  | 'research'
  | 'analysis'
  | 'writing'
  | 'agentic'
  | 'multimodal'
  | 'general'

export interface PromptProfile {
  family: PromptFamily
  /** Short human label for UI badge, e.g. "Claude". */
  displayName: string
  /** Preferred structure for the refined prompt. */
  structureHint: string
  /** Techniques the coach should apply when writing the final prompt. */
  techniques: string[]
  /** Anti-patterns / pitfalls for this family. */
  antiPatterns: string[]
  /** Optional skeleton the refined prompt should roughly follow. */
  skeleton: string
}

export interface ResolveProfileInput {
  providerId?: string | null
  modelId?: string | null
}

export interface BuildEnhancerPromptInput extends ResolveProfileInput {
  taskType?: PromptTaskType | null
  /** ISO language hint for coach replies (user-facing). */
  replyLanguage?: string | null
}
