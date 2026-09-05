// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { PROFILES, TASK_TYPE_HINTS } from './profiles.js'
import type {
  BuildEnhancerPromptInput,
  PromptFamily,
  PromptProfile,
  PromptTaskType,
  ResolveProfileInput,
} from './types.js'

export type {
  BuildEnhancerPromptInput,
  PromptFamily,
  PromptProfile,
  PromptTaskType,
  ResolveProfileInput,
} from './types.js'
export { PROFILES, TASK_TYPE_HINTS } from './profiles.js'
export {
  extractFinalPrompt,
  extractFinalPrompts,
  extractQualityCheck,
  type ParsedFinalPrompt,
  type QualityCheck,
} from './final-prompt-parse.js'
export {
  buildAgentSystemCoachSystemPrompt,
  buildProjectCoachSystemPrompt,
  buildProjectTypeCoachSystemPrompt,
  buildScopedCoachSystemPrompt,
  coachGoalDescription,
  coachSessionTitle,
  isPromptCoachScope,
  type AgentSystemCoachContext,
  type ProjectCoachContext,
  type ProjectTypeCoachContext,
  type PromptCoachContext,
  type PromptCoachScope,
} from './scope-profiles.js'

const OPENAI_COMPAT_HINTS = [
  'openai',
  'lmstudio',
  'ollama',
  'vllm',
  'together',
  'groq',
  'mistral',
  'deepseek',
  'fireworks',
  'perplexity',
]

/**
 * Map providerId + modelId to a prompt family.
 * Model id wins when it clearly signals a family (e.g. openrouter/claude-…).
 */
export function resolvePromptFamily(input: ResolveProfileInput): PromptFamily {
  const provider = (input.providerId ?? '').toLowerCase()
  const model = (input.modelId ?? '').toLowerCase()
  const hay = `${provider} ${model}`

  // Model-string signals first (router / compat providers)
  if (/(^|[^a-z])(claude|anthropic|sonnet|opus|haiku|fable|mythos)/.test(hay)) return 'claude'
  if (/(^|[^a-z])(gpt-|o1|o3|o4|chatgpt)/.test(hay) || /\bgpt\b/.test(model)) return 'openai'
  if (/(^|[^a-z])(gemini|gemma)/.test(hay)) return 'gemini'
  if (/(^|[^a-z])(grok|xai)/.test(hay)) return 'grok'
  if (/(^|[^a-z])(kimi|moonshot)/.test(hay)) return 'kimi'

  // Provider id
  if (
    provider === 'anthropic' ||
    provider === 'claude-code' ||
    provider === 'claude-code-sdk' ||
    provider.startsWith('anthropic')
  ) {
    return 'claude'
  }
  if (provider === 'openai' || provider.startsWith('openai')) return 'openai'
  if (provider === 'gemini' || provider.startsWith('google')) return 'gemini'
  if (provider === 'grok-cli' || provider === 'xai') return 'grok'
  if (provider === 'kimi' || provider === 'kimi-cli' || provider.includes('moonshot')) return 'kimi'
  if (provider === 'openrouter') {
    // already checked model string above
    return 'generic'
  }
  if (OPENAI_COMPAT_HINTS.some((p) => provider === p || provider.includes(p))) {
    return 'openai'
  }

  return 'generic'
}

export function resolvePromptProfile(input: ResolveProfileInput): PromptProfile {
  return PROFILES[resolvePromptFamily(input)]
}

export function isPromptTaskType(value: unknown): value is PromptTaskType {
  return (
    typeof value === 'string' &&
    (value === 'coding' ||
      value === 'research' ||
      value === 'analysis' ||
      value === 'writing' ||
      value === 'agentic' ||
      value === 'multimodal' ||
      value === 'general')
  )
}

/**
 * Build the coach system prompt for the Prompt Enhancer sub-conversation.
 * Target model family shapes the refined user prompt, not the coach's own model.
 */
export function buildEnhancerSystemPrompt(input: BuildEnhancerPromptInput = {}): string {
  const profile = resolvePromptProfile(input)
  const taskType: PromptTaskType = isPromptTaskType(input.taskType) ? input.taskType : 'general'
  const taskHints = TASK_TYPE_HINTS[taskType]
  const targetLabel = formatTargetLabel(input, profile)

  const techniques = [...profile.techniques, ...taskHints]
    .map((t) => `- ${t}`)
    .join('\n')
  const anti = profile.antiPatterns.map((t) => `- ${t}`).join('\n')

  return `You are a prompt-refinement coach. The user is drafting a prompt for another AI assistant in a parent conversation. Your job is to make that prompt clearer, more concrete, and more effective for the TARGET model family.

## Target model
- Family: ${profile.family} (${profile.displayName})
- Target label: ${targetLabel}
- Task type hint: ${taskType}

The refined prompt will be executed by the TARGET model above — optimize for THAT family, not for yourself.

## Structure preference for this family
${profile.structureHint}

## Techniques to apply
${techniques}

## Anti-patterns to avoid in the refined prompt
${anti}

## Skeleton (adapt, do not force blindly)
\`\`\`
${profile.skeleton}
\`\`\`

## Prompt anatomy checklist
Before finalizing, ensure the refined prompt covers as many as apply:
1. Role / persona (who the assistant is)
2. Goal (one clear outcome)
3. Context (only what is needed)
4. Instructions / steps
5. Output format (schema, length, sections)
6. Constraints / out-of-scope
7. Success criteria
8. Examples (when format/tone is non-obvious)
9. Attachment roles (if files are present)

## Quality gate (mandatory before final-prompt)
Silently score the candidate refined prompt 1–10 on: clarity, completeness (checklist), family fit, no contradictions, actionable success criteria.
- If score < 8: revise once to fix the gaps, then re-score.
- Then emit a quality-check tag (always, once you have a usable draft):

<quality-check score="8" missing="examples, success criteria">
Optional one-line note
</quality-check>

- \`missing\` is a comma-separated list of checklist gaps still weak (or empty if none).
- Do not emit final-prompt until score ≥ 8, unless the user explicitly accepts a weaker draft.

## Workflow
1. If the goal is still ambiguous, ask at most 1–2 clarifying questions — never flood the user.
2. Propose a concrete, ready-to-run prompt using the family structure and checklist.
3. Run the quality gate above.
4. End every convergent reply with quality-check + final-prompt block(s):

<quality-check score="9" missing="">
…
</quality-check>
<final-prompt carry-attachments="all|none" variant="recommended">
…ready-to-paste prompt only…
</final-prompt>

## Alternatives (when the user asks for variants / alternatives)
Emit exactly two final-prompt blocks with different trade-offs:
- variant="concise" — shorter, tighter constraints, faster to run
- variant="thorough" — fuller context, steps, examples when useful
Share one quality-check (score the better of the two, or average if close). Still optimize both for the TARGET family.

## File handling
- If the user attached files (images, PDFs, docs), decide whether the TARGET prompt needs them.
- If the prompt references or must process those files: carry-attachments="all".
- If attachments were only context for refining: carry-attachments="none".
- If no attachments, the attribute is optional (default none).

## Style
- When the user requests changes, iterate; always include updated quality-check + final-prompt once you have a usable draft.
- Be short. Value is the refined prompt, not long lectures.
- Reply in the user's language (default: follow the user's latest message).
- Do not wrap the final prompt in markdown fences inside the <final-prompt> block unless the prompt itself requires fences.`
}

function formatTargetLabel(input: ResolveProfileInput, profile: PromptProfile): string {
  const provider = input.providerId?.trim()
  const model = input.modelId?.trim()
  if (provider && model) return `${provider} / ${model}`
  if (model) return model
  if (provider) return provider
  return `${profile.displayName} (unspecified model — use family defaults)`
}
