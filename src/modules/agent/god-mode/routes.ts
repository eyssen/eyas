// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requirePermission } from '@modules/permissions/middleware'
import type { ConversationService } from '@modules/conversations/conversation-service.js'
import type { PricingTable } from '@shared/model-pricing.js'
import { estimateGodModeCost } from './estimate.js'
import { RosterValidationError, type GodModeStore } from './store.js'
import type { GodModeOrchestrator } from './orchestrator.js'
import { presentGodRun } from './present.js'

export interface GodModeRouteDeps {
  getLimits: () => { min: number; max: number }
  getLiveKeys: () => Set<string> | Promise<Set<string>>
  conversations?: Pick<ConversationService, 'get' | 'ownsConversation'>
  orchestrator?: GodModeOrchestrator
  getPricing?: () => PricingTable | undefined
}

/** Enabled provider/model pairs as `"${providerId}/${modelId}"`. */
export async function collectGodModeLiveKeys(ctx: {
  providerConfig?: {
    listProviders(): Array<{ id: string; enabled?: boolean }>
    listModels(id: string): Array<{ modelId: string; enabled?: boolean }>
  }
  model?: {
    listProviders(): Array<{ id: string; listModels(): Promise<Array<{ id: string }>> }>
  }
}): Promise<Set<string>> {
  const keys = new Set<string>()
  const pc = ctx.providerConfig
  if (pc?.listProviders && pc.listModels) {
    for (const cfg of pc.listProviders()) {
      if (cfg.enabled === false) continue
      for (const m of pc.listModels(cfg.id)) {
        if (m.enabled === false) continue
        keys.add(`${cfg.id}/${m.modelId}`)
      }
    }
    return keys
  }
  const gateway = ctx.model
  if (gateway?.listProviders) {
    for (const p of gateway.listProviders()) {
      const models = await p.listModels().catch(() => [])
      for (const m of models) keys.add(`${p.id}/${m.id}`)
    }
  }
  return keys
}

function assertOwnsConversation(
  c: { get(key: string): unknown },
  conversationId: string,
  conversations: Pick<ConversationService, 'get' | 'ownsConversation'> | undefined,
): void {
  if (!conversations) return
  const userId = c.get('userId') as string | undefined
  if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
  const conv = conversations.get(conversationId)
  if (!conv || !conversations.ownsConversation(conversationId, userId)) {
    throw new HTTPException(404, { message: 'Conversation not found' })
  }
}

function requireOrchestrator(orch: GodModeOrchestrator | undefined): GodModeOrchestrator {
  if (!orch) throw new HTTPException(503, { message: 'God Mode orchestrator is not available' })
  return orch
}

export function createGodModeRoutes(app: Hono, store: GodModeStore, deps: GodModeRouteDeps): void {
  app.get('/api/v1/god-mode/config', requirePermission('manage', 'Model'), (c) => {
    const limits = deps.getLimits()
    return c.json({ ...store.getConfig(), limits })
  })

  app.put('/api/v1/god-mode/config', requirePermission('manage', 'Model'), async (c) => {
    const limits = deps.getLimits()
    const liveKeys = await deps.getLiveKeys()
    const body = await c.req.json().catch(() => null)
    try {
      const config = store.saveConfig(body, liveKeys, limits)
      return c.json({ ...config, limits })
    } catch (err) {
      if (err instanceof RosterValidationError) {
        throw new HTTPException(400, { message: err.message })
      }
      throw err
    }
  })

  app.get('/api/v1/god-mode/estimate', requirePermission('read', 'Conversation'), (c) => {
    const conversationId = c.req.query('conversationId')
    if (!conversationId) throw new HTTPException(400, { message: 'conversationId is required' })
    assertOwnsConversation(c, conversationId, deps.conversations)
    const config = store.getConfig()
    const usd = estimateGodModeCost(config.participants, { pricing: deps.getPricing?.() })
    return c.json({
      usd,
      ceilingUsd: config.costCeilingUsd,
      participants: config.participants,
    })
  })

  app.get('/api/v1/conversations/:id/god-mode/runs', requirePermission('read', 'Conversation'), (c) => {
    const conversationId = c.req.param('id')
    assertOwnsConversation(c, conversationId, deps.conversations)
    const orch = requireOrchestrator(deps.orchestrator)
    const runs = orch.listForConversation(conversationId).map((run) => {
      const participants = store.listParticipants(run.id)
      return {
        ...presentGodRun(run, participants),
        participants,
      }
    })
    return c.json({ runs })
  })

  app.get('/api/v1/god-mode/runs/:id', requirePermission('read', 'Conversation'), (c) => {
    const orch = requireOrchestrator(deps.orchestrator)
    const run = orch.get(c.req.param('id'))
    if (!run) throw new HTTPException(404, { message: 'Run not found' })
    assertOwnsConversation(c, run.conversationId, deps.conversations)
    const participants = store.listParticipants(run.id)
    const presented = presentGodRun(run, participants)
    return c.json({
      run: presented,
      participants,
      insights: presented.insights ?? [],
    })
  })

  app.post('/api/v1/god-mode/runs/:id/cancel', requirePermission('update', 'Conversation'), async (c) => {
    const orch = requireOrchestrator(deps.orchestrator)
    const run = orch.get(c.req.param('id'))
    if (!run) throw new HTTPException(404, { message: 'Run not found' })
    assertOwnsConversation(c, run.conversationId, deps.conversations)
    await orch.cancel(run.id)
    return c.json({ run: orch.get(run.id) })
  })

  app.post('/api/v1/conversations/:id/god-mode/cancel', requirePermission('update', 'Conversation'), async (c) => {
    const conversationId = c.req.param('id')
    assertOwnsConversation(c, conversationId, deps.conversations)
    const orch = requireOrchestrator(deps.orchestrator)
    const run = await orch.cancelActive(conversationId)
    return c.json({ run })
  })

  app.post('/api/v1/god-mode/runs/:id/promote', requirePermission('update', 'Conversation'), async (c) => {
    const orch = requireOrchestrator(deps.orchestrator)
    const run = orch.get(c.req.param('id'))
    if (!run) throw new HTTPException(404, { message: 'Run not found' })
    assertOwnsConversation(c, run.conversationId, deps.conversations)
    try {
      await orch.retryPromote(run.id)
    } catch (err) {
      throw new HTTPException(500, {
        message: err instanceof Error ? err.message : 'promote failed',
      })
    }
    return c.json({ run: orch.get(run.id) })
  })
}
