// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// H4 — the prompt enhancer's default target is the model the parent
// conversation actually runs on (its effective binding), not the parent's raw
// row, which is empty until the first turn and knows nothing of a colleague's
// model. The coach sub-conversation stores that pair (or the prompt_enhancer
// tier's) as its own.

import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { registerPromptEnhancerRoute } from '@modules/conversations/prompt-enhancer-route'
import { createConversationService } from '@modules/conversations/conversation-service'
import { createProductionConversationsDb } from '../../helpers/production-conversations-db'

vi.mock('@modules/permissions/middleware', () => ({
  requirePermission: () => async (_c: any, next: any) => next(),
}))

async function setup(opts: { effective?: { providerId: string; modelId: string } | null; tier?: { provider: string; model: string } | null } = {}) {
  const chat = createConversationService(await createProductionConversationsDb())
  const app = new Hono()
  app.use('*', async (c: any, next) => { c.set('userId', 'u1'); await next() })
  const effectiveBindingOf = vi.fn(() => opts.effective ?? null)
  registerPromptEnhancerRoute(
    app,
    chat,
    () => ({ resolveForTier: () => opts.tier ?? null }) as any,
    effectiveBindingOf,
  )
  // An agent-bound parent with no stored pair: its raw row says nothing.
  const parent = chat.create({ userId: 'u1', modelBinding: 'inherit' })
  chat.update(parent.id, { agentId: 'colleague' })
  const post = async (body: Record<string, unknown> = {}) => {
    const res = await app.request(`/api/v1/conversations/${parent.id}/prompt-enhancer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    return { status: res.status, body: await res.json() as any }
  }
  return { chat, post, effectiveBindingOf }
}

describe('prompt enhancer target (H4)', () => {
  it("(+) defaults to the parent's effective model, and the coach runs on it", async () => {
    const effective = { providerId: 'claude-code', modelId: 'claude-code-sonnet' }
    const { chat, post } = await setup({ effective })
    const res = await post({ draft: 'make it better' })
    expect(res.status).toBe(201)
    expect(res.body.target).toMatchObject(effective)
    expect(chat.get(res.body.id)).toMatchObject({ providerId: 'claude-code', modelId: 'claude-code-sonnet' })
  })

  it('(+) the prompt_enhancer tier picks the coach; the target stays the parent\'s model', async () => {
    const { chat, post } = await setup({
      effective: { providerId: 'claude-code', modelId: 'claude-code-sonnet' },
      tier: { provider: 'grok-cli', model: 'grok-cli-default' },
    })
    const res = await post()
    expect(res.body.target).toMatchObject({ providerId: 'claude-code', modelId: 'claude-code-sonnet' })
    expect(chat.get(res.body.id)).toMatchObject({ providerId: 'grok-cli', modelId: 'grok-cli-default' })
  })

  it('(−) no model can serve the parent: no default target, and the coach stores no pair', async () => {
    const { chat, post } = await setup({ effective: null })
    const res = await post()
    expect(res.body.target).toMatchObject({ providerId: null, modelId: null })
    expect(chat.get(res.body.id)).toMatchObject({ providerId: null, modelId: null })
  })

  it('an explicit target in the body wins', async () => {
    const { post } = await setup({ effective: { providerId: 'claude-code', modelId: 'claude-code-sonnet' } })
    const res = await post({ targetProviderId: 'openai', targetModelId: 'gpt-x' })
    expect(res.body.target).toMatchObject({ providerId: 'openai', modelId: 'gpt-x' })
  })
})
