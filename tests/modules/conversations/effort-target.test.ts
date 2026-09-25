// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// E3 — effortTargetFor: which model a conversation's effort is judged
// against. Pinned when the next turn's model is known; Auto when Auto-routing
// picks it per message (or no model can be resolved right now).

import { describe, it, expect, vi } from 'vitest'
import { effortTargetFor } from '@modules/conversations/effort-target'
import {
  BindingUnavailableError,
  type BindingConversationRow,
  type BindingResolver,
  type ModelBindingMode,
  type ResolvedBinding,
} from '@modules/model/binding'
import type { BindingSource } from '@shared/chat-stream'

function row(modelBinding: ModelBindingMode, extra: Partial<BindingConversationRow> = {}): BindingConversationRow {
  return { modelBinding, providerId: null, modelId: null, agentId: null, parentConversationId: null, ...extra }
}

function resolverReturning(binding: Partial<ResolvedBinding> | Error): Pick<BindingResolver, 'resolveStatic'> & { resolveStatic: ReturnType<typeof vi.fn> } {
  return {
    resolveStatic: vi.fn(() => {
      if (binding instanceof Error) throw binding
      return binding as ResolvedBinding
    }),
  }
}

const PAIR = { providerId: 'anthropic', modelId: 'claude-opus-4-8' }

describe('effortTargetFor', () => {
  // model_binding × binding.source → target mode
  const table: Array<[ModelBindingMode, BindingSource, 'pinned' | 'auto']> = [
    ['pinned', 'conversation', 'pinned'],
    ['pinned', 'request', 'pinned'],
    ['pinned', 'default', 'pinned'],
    ['auto', 'auto', 'auto'],
    ['auto', 'conversation', 'pinned'],
    ['auto', 'request', 'pinned'],
    ['auto', 'default', 'auto'],
    ['inherit', 'agent', 'pinned'],
    ['inherit', 'parent', 'pinned'],
    ['inherit', 'conversation', 'pinned'],
    ['inherit', 'default', 'pinned'],
  ]
  for (const [mode, source, expected] of table) {
    it(`model_binding '${mode}' with binding source '${source}' → ${expected}`, () => {
      const target = effortTargetFor({ conversation: row(mode) }, resolverReturning({ ...PAIR, source }))
      expect(target.mode).toBe(expected)
      if (expected === 'pinned') expect(target).toEqual({ mode: 'pinned', ...PAIR })
      else expect(target).toEqual({ mode: 'auto' })
    })
  }

  it('hands the resolver the conversation and the colleague preference, without triage (positive)', () => {
    const resolver = resolverReturning({ ...PAIR, source: 'agent' })
    effortTargetFor({ conversation: row('inherit', { agentId: 'a1' }), agent: { model: 'opus' } }, resolver)
    const input = resolver.resolveStatic.mock.calls[0][0]
    expect(input.conversation).toEqual(expect.objectContaining({ mode: 'inherit', agentId: 'a1' }))
    expect(input.agent).toEqual({ model: 'opus' })
    expect(input.request).toBeNull()
  })

  it('a resolveStatic without a modelId → auto (negative)', () => {
    expect(effortTargetFor({ conversation: row('pinned') }, resolverReturning({ providerId: 'anthropic', modelId: '', source: 'conversation' })))
      .toEqual({ mode: 'auto' })
  })

  it('an unavailable binding → auto: nothing to validate against (negative)', () => {
    const resolver = resolverReturning(new BindingUnavailableError('model_binding_unavailable', PAIR))
    expect(effortTargetFor({ conversation: row('pinned', PAIR) }, resolver)).toEqual({ mode: 'auto' })
  })

  it('no resolver → auto (negative)', () => {
    expect(effortTargetFor({ conversation: row('pinned', PAIR) }, undefined)).toEqual({ mode: 'auto' })
  })
})
