// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Email triage agent template — Phase 4C.
 *
 * This barrel only re-exports; nothing here has side effects so importing
 * from the module is safe before the bootstrap sequence has finished.
 */

export { EmailClassifier } from './classifier.js'
export { routeAction } from './action-router.js'
export { RuleCompiler, parseCompiledRule } from './rule-compiler.js'
export {
  NaturalLanguageFilters,
  InMemoryRuleStore,
} from './natural-language-filters.js'
export {
  TRIAGE_SYSTEM_PROMPT,
  BUCKETS,
  buildClassifierPrompt,
  parseClassifierResponse,
  buildRuleCompilerPrompt,
  RULE_COMPILER_SYSTEM_PROMPT,
} from './prompt-sections.js'
export { emailTriageTemplate } from './template.js'
export type { EmailTriageTemplate } from './template.js'
export { emailTriageManifest } from './manifest.js'
export type { EmailTriageManifest } from './manifest.js'

export type {
  ClassificationResult,
  CompiledRule,
  CompiledRuleAction,
  CompiledRuleMatcher,
  EmailReceivedEvent,
  InboundEmail,
  LLMClient,
  RuleMatcherClause,
  RuleStore,
  TriageAction,
  TriageBucket,
} from './types.js'
export { RuleCompilationError } from './types.js'
