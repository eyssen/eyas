// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Effort plans as the gateway would hand them to a provider, for provider
// tests that call a provider directly (no gateway in between).

import type { ReasoningCapability } from '@modules/model/reasoning/capability'
import type { EffortLevel, EffortSetting } from '@modules/model/reasoning/ladder'
import { resolveEffortPlan, type EffortPlan } from '@modules/model/reasoning/resolve'

/** A model with discrete levels low..max and adaptive thinking (an Opus-4.6-like record). */
export const ADAPTIVE_EFFORT_CAPABILITY: ReasoningCapability = {
  kind: 'effort',
  levels: ['none', 'low', 'medium', 'high', 'max'],
  defaultLevel: 'high',
  canDisable: true,
  thinking: 'default-off',
  thinkingParam: 'adaptive',
  samplingLocked: false,
  reasoningVisible: 'summary',
  displayParam: false,
  source: 'overlay',
}

/** A model with discrete levels and no thinking parameter (an OpenAI-reasoning-like record). */
export const PLAIN_EFFORT_CAPABILITY: ReasoningCapability = {
  ...ADAPTIVE_EFFORT_CAPABILITY,
  levels: ['low', 'medium', 'high'],
  defaultLevel: 'medium',
  canDisable: false,
  thinking: 'n/a',
  thinkingParam: 'none',
  reasoningVisible: 'hidden',
}

/** The plan the gateway resolves for `level` (source 'request') on a model with `capability`. */
export function effortPlanFor(
  level: EffortSetting,
  capability: ReasoningCapability = ADAPTIVE_EFFORT_CAPABILITY,
  options: { maxOutputTokens?: number; streaming?: boolean } = {},
): EffortPlan {
  return resolveEffortPlan({
    intent: { level, source: 'request' },
    capability,
    maxOutputTokens: options.maxOutputTokens ?? 64_000,
    streaming: options.streaming ?? true,
  }).plan
}

export type { EffortLevel }
