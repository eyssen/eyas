// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Which model a conversation's effort setting is judged against. One helper,
// shared by write-time validation (routes.ts) and the effort options the UI
// offers, so both always agree on the target.
//
// It reads the binding resolver (model/binding.ts resolveStatic: no triage,
// never writes) and maps the result:
// - pinned: the next turn's model is known — the pair the user fixed (or a
//   one-turn override), the colleague's model, a sub-conversation's stored
//   pair, or the install default that will be fixed on the first turn;
// - auto: Auto-routing picks a tier's model per message, so no single model's
//   levels apply (and a binding that cannot be resolved right now is treated
//   the same way: the runtime clamps).

import {
  conversationBindingInput,
  type BindingConversationRow,
  type BindingInput,
  type BindingResolver,
} from '@modules/model/binding.js'

export type EffortTarget =
  | { mode: 'pinned'; providerId: string; modelId: string }
  | { mode: 'auto' }

export interface EffortTargetInput {
  /** The conversation as it is (or will be after the write being validated). */
  conversation: BindingConversationRow
  /** The bound colleague's model preference (agent-bound conversations only). */
  agent?: BindingInput['agent']
}

const AUTO: EffortTarget = { mode: 'auto' }

export function effortTargetFor(
  input: EffortTargetInput,
  resolver: Pick<BindingResolver, 'resolveStatic'> | null | undefined,
): EffortTarget {
  if (!resolver) return AUTO
  let binding: ReturnType<BindingResolver['resolveStatic']>
  try {
    binding = resolver.resolveStatic(conversationBindingInput(input.conversation, { agent: input.agent ?? null }))
  } catch {
    // No model can serve the conversation now (unavailable pair, nothing
    // configured): nothing to validate against.
    return AUTO
  }
  if (!binding?.providerId || !binding.modelId) return AUTO
  const pinned: EffortTarget = { mode: 'pinned', providerId: binding.providerId, modelId: binding.modelId }
  // A pair the conversation itself holds (or a one-turn override) is the model.
  if (binding.source === 'request' || binding.source === 'conversation') return pinned
  // Auto-routing: the tier's model is picked per message.
  if (input.conversation.modelBinding === 'auto') return AUTO
  // Pinned (default about to be fixed) and inherit (colleague / parent / default).
  return pinned
}
