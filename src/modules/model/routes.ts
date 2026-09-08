// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono, MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requirePermission } from '@modules/permissions/middleware'
import { applyAgentModelAssignments } from './ai-models-step.js'
import type { ModelGateway, ProviderListItem, ModelConfigItem, ModelInfo } from './types.js'
import type { ProviderConfigService } from './provider-config-service.js'
import { providerDisplayName } from './provider-display.js'
import { compatProviderIdsRequiringKey } from './submodules/openai-compat/catalog.js'
import { ANTHROPIC_COMPAT_CATALOG } from './submodules/anthropic-compat/catalog.js'

// Exported so other modules can port the same "is this provider considered
// active" logic without duplicating the list (see home/routes.ts's
// setup-status 'models' check).
export const PROVIDERS_NEEDING_API_KEY = new Set([
  'anthropic',
  'openai',
  'openrouter',
  'gemini',
  'kimi',
  ...compatProviderIdsRequiringKey(),
  ...ANTHROPIC_COMPAT_CATALOG.map((p) => p.id),
])

export function createModelRoutes(
  app: Hono,
  gateway: ModelGateway,
  authenticate?: MiddlewareHandler,
  configService?: ProviderConfigService,
  reloadHandlers?: Map<string, () => Promise<void>>,
  reauthHealer?: { getHealth(id: string): import('./types.js').ProviderHealthInfo },
  db?: any,
): void {
  const router = app as any

  if (authenticate) {
    router.use('/api/v1/model/*', authenticate)
  }

  // ─── Enhanced Provider List ─────────────────────
  router.get('/api/v1/model/providers', requirePermission('read', 'Model'), async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })

    if (!configService) {
      const providers = gateway.listProviders()
      const result = await Promise.all(providers.map(async p => {
        const models = await p.listModels()
        return { id: p.id, name: p.name, modelCount: models.length, health: reauthHealer?.getHealth(p.id) }
      }))
      return c.json({ providers: result })
    }

    const configs = configService.listProviders()
    const providers: ProviderListItem[] = configs.map(cfg => {
      const provider = gateway.getProvider(cfg.id)
      const models = configService.listModels(cfg.id)
      const enabledModels = models.filter(m => m.enabled)
      return {
        id: cfg.id,
        name: providerDisplayName(cfg.id, provider?.name),
        enabled: cfg.enabled,
        active: cfg.enabled && !!provider,
        hasApiKey: PROVIDERS_NEEDING_API_KEY.has(cfg.id) ? !!provider : null,
        modelCount: models.length,
        enabledModelCount: enabledModels.length,
        health: reauthHealer?.getHealth(cfg.id),
      }
    })
    return c.json({ providers })
  })

  // ─── Provider Detail ────────────────────────────
  router.get('/api/v1/model/providers/:id', requirePermission('read', 'Model'), async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })

    const id = c.req.param('id')

    if (!configService) {
      const provider = gateway.getProvider(id)
      if (!provider) throw new HTTPException(404, { message: 'Provider not found' })
      const models = await provider.listModels()
      return c.json({ id: provider.id, name: provider.name, models })
    }

    const cfg = configService.getProvider(id)
    if (!cfg) throw new HTTPException(404, { message: 'Provider not found' })
    const provider = gateway.getProvider(id)
    const modelRows = configService.listModels(id)
    const models: ModelConfigItem[] = modelRows.map(m => ({
      id: m.id,
      modelId: m.modelId,
      name: m.name,
      enabled: m.enabled,
      contextWindow: m.contextWindow,
      maxOutputTokens: m.maxOutputTokens,
      supportsTools: m.supportsTools,
      supportsImages: m.supportsImages,
      supportsStreaming: m.supportsStreaming,
    }))

    return c.json({
      id: cfg.id,
      name: providerDisplayName(cfg.id, provider?.name),
      enabled: cfg.enabled,
      active: cfg.enabled && !!provider,
      hasApiKey: PROVIDERS_NEEDING_API_KEY.has(id) ? !!provider : null,
      isDefault: cfg.isDefault,
      defaultModel: cfg.defaultModel,
      settings: cfg.settings,
      models,
    })
  })

  // ─── Update Provider Config ─────────────────────
  router.patch('/api/v1/model/providers/:id', requirePermission('manage', 'Model'), async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    if (!configService) throw new HTTPException(501, { message: 'Config service not available' })

    const id = c.req.param('id')
    const body = await c.req.json()
    configService.updateProvider(id, body)
    const updated = configService.getProvider(id)
    return c.json(updated)
  })

  // ─── Hot-Reload Provider ────────────────────────
  router.post('/api/v1/model/providers/:id/reload', requirePermission('manage', 'Model'), async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })

    const id = c.req.param('id')
    const reloadFn = reloadHandlers?.get(id)
    if (reloadFn) {
      await reloadFn()
    } else {
      gateway.unregisterProvider(id)
    }
    const cfg = configService?.getProvider(id)
    const provider = gateway.getProvider(id)
    return c.json({
      id,
      enabled: cfg?.enabled ?? false,
      active: !!provider,
    })
  })

  // ─── Refresh Models from API ────────────────────
  router.post('/api/v1/model/providers/:id/models/refresh', requirePermission('manage', 'Model'), async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    if (!configService) throw new HTTPException(501, { message: 'Config service not available' })

    const id = c.req.param('id')
    const provider = gateway.getProvider(id)
    if (!provider) throw new HTTPException(404, { message: 'Provider not active' })

    let models
    if (provider.fetchModels) {
      models = await provider.fetchModels()
    } else {
      models = await provider.listModels()
    }
    configService.upsertModels(id, models)
    return c.json({ modelCount: models.length, models: configService.listModels(id) })
  })

  // ─── Update Model Config ────────────────────────
  router.patch('/api/v1/model/providers/:id/models/:modelId', requirePermission('manage', 'Model'), async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    if (!configService) throw new HTTPException(501, { message: 'Config service not available' })

    const modelId = c.req.param('modelId')
    const body = await c.req.json()
    configService.updateModel(modelId, body)
    const models = configService.listModels(c.req.param('id'))
    const updated = models.find(m => m.id === modelId)
    return c.json(updated)
  })

  // ─── Default Provider/Model ─────────────────────
  router.get('/api/v1/model/defaults', requirePermission('read', 'Model'), async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    if (!configService) throw new HTTPException(501, { message: 'Config service not available' })
    const def = configService.getDefault()
    return c.json(def ?? { providerId: null, modelId: null })
  })

  router.put('/api/v1/model/defaults', requirePermission('manage', 'Model'), async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    if (!configService) throw new HTTPException(501, { message: 'Config service not available' })
    const { providerId, modelId } = await c.req.json()
    if (!providerId || !modelId) throw new HTTPException(400, { message: 'providerId and modelId required' })
    configService.setDefault(providerId, modelId)
    return c.json({ providerId, modelId })
  })

  // ─── All Models ─────────────────────────────────
  router.get('/api/v1/model/models', requirePermission('read', 'Model'), async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    // Prefer config service (DB) which has refreshed models; fall back to gateway hardcoded lists
    if (configService) {
      const allModels: ModelInfo[] = []
      for (const cfg of configService.listProviders()) {
        if (!cfg.enabled) continue
        const models = configService.listEnabledModels(cfg.id)
        allModels.push(...models)
      }
      return c.json({ models: allModels })
    }
    const models = await gateway.listAllModels()
    return c.json({ models })
  })

  // ─── Complete / Stream (unchanged) ──────────────
  router.post('/api/v1/model/complete', requirePermission('use', 'Model'), async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    const body = await c.req.json()
    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      throw new HTTPException(400, { message: 'messages array is required' })
    }
    const response = await gateway.complete(body)
    return c.json(response)
  })

  router.post('/api/v1/model/stream', requirePermission('use', 'Model'), async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    const body = await c.req.json()
    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      throw new HTTPException(400, { message: 'messages array is required' })
    }
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of gateway.stream(body)) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          }
        } catch (err: any) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`))
        }
        controller.close()
      },
    })
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    })
  })

  // ─── Post-setup: assign models to seed agents ───────
  // Authenticated replacement for the first-run wizard's optional 'ai-models'
  // step. Once required setup is complete the public /api/v1/setup/steps/*
  // writes fail closed, so ongoing model (re)assignment happens here behind
  // authenticate + CSRF + requirePermission('manage','Model').
  router.put('/api/v1/model/agent-assignments', requirePermission('manage', 'Model'), async (c: any) => {
    if (!db) throw new HTTPException(503, { message: 'Model assignments unavailable' })
    const body = await c.req.json().catch(() => null)
    const assignments = body?.assignments
    if (!assignments || typeof assignments !== 'object' || Array.isArray(assignments)) {
      throw new HTTPException(400, { message: 'assignments must be an object of { agentId: modelId }' })
    }
    for (const [agentId, modelId] of Object.entries(assignments)) {
      if (typeof agentId !== 'string' || typeof modelId !== 'string') {
        throw new HTTPException(400, { message: 'assignments values must be strings' })
      }
    }
    const applied = applyAgentModelAssignments(db, assignments as Record<string, string>)
    return c.json({ ok: true, applied })
  })
}
