// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono, MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { requirePermission } from '@modules/permissions/middleware'
import { AgentModelAssignmentsSchema, applyAgentModelAssignments, resolveAgentModelAssignment } from './ai-models-step.js'
import type { ModelGateway, ModelRequest, ProviderListItem, ModelConfigItem, ModelInfo } from './types.js'
import { EffortSettingSchema } from './reasoning/schemas.js'
import type { ModelConfigRow, ProviderConfigService } from './provider-config-service.js'
import { providerDisplayName, providerKind } from './provider-display.js'
import { compatProviderIdsRequiringKey } from './submodules/openai-compat/catalog.js'
import { ANTHROPIC_COMPAT_CATALOG } from './submodules/anthropic-compat/catalog.js'
import {
  CliSignInRequestError,
  CliSignInRequestSchema,
  isCliSignInProvider,
  type CliSignInService,
  type CliSignInStatus,
} from './cli-runtime/sign-in.js'
import { ScopeDeniedError, type Requester } from '@modules/secrets/types.js'
import { describeFileSandbox, type FileSandboxInfo, type SandboxCli } from './cli-runtime/sandbox/index.js'
import { verifyIsolationNow } from './cli-runtime/isolation.js'
import { describeCliIsolation, isIsolationCliId, type CliIsolationViewDeps } from './cli-isolation-view.js'
import type { IsolationCliId } from './cli-runtime/verified-versions.js'
import { describeEffortOptions, type EffortOptionsRequest } from './reasoning/options.js'
import { resolveModelRef } from './binding.js'
import { readTiers } from './routing/tier-store.js'

/** The CLI providers whose own tools a kernel file sandbox may wrap (B5). */
const FILE_SANDBOX_PROVIDERS: ReadonlySet<string> = new Set<SandboxCli>(['claude-code', 'grok-cli', 'kimi-cli'])

/**
 * The provider's kernel file sandbox status ({status, reason, mode}), for a
 * CLI provider only. A detection that fails is reported as unavailable,
 * never as active.
 */
async function fileSandboxOf(providerId: string): Promise<{ fileSandbox?: FileSandboxInfo }> {
  if (!FILE_SANDBOX_PROVIDERS.has(providerId)) return {}
  try {
    return { fileSandbox: await describeFileSandbox(providerId as SandboxCli) }
  } catch {
    return {}
  }
}

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

/**
 * The body of the raw POST /api/v1/model/complete|stream endpoints — the only
 * shape a client can hand the gateway directly. Everything that could steer a
 * provider beyond "answer these messages" is absent, and unknown keys are
 * STRIPPED (not rejected), so a body carrying sessionId, metadata, cwd,
 * isolated, tools or thinking still works but none of them reach the gateway.
 * Without metadata the request is classified autonomous; without a session id
 * nothing can resume a provider-native session (EYAS replay is the only
 * continuity). Only text and image blocks: tool blocks need tools, which a raw
 * caller cannot supply. `effort` is a ladder rung or 'auto'; it reaches the
 * gateway as an intent with source 'request', and the gateway resolves it
 * against the model the call goes to (the response's effortOutcome says what
 * was requested and what was sent).
 */
const RawTextBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string().max(1_000_000),
})

const RawImageBlockSchema = z.object({
  type: z.literal('image'),
  source: z.object({
    type: z.enum(['base64', 'url']),
    mediaType: z.string().min(1).max(128),
    data: z.string().min(1).max(30_000_000),
  }),
})

const RawMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.union([
    z.string().max(1_000_000),
    z.array(z.discriminatedUnion('type', [RawTextBlockSchema, RawImageBlockSchema])).min(1).max(64),
  ]),
})

export const RawModelRequestSchema = z.object({
  provider: z.string().min(1).max(128).optional(),
  model: z.string().min(1).max(256).optional(),
  messages: z.array(RawMessageSchema).min(1).max(1000),
  system: z.string().max(1_000_000).optional(),
  maxTokens: z.number().int().positive().max(1_000_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  stopSequences: z.array(z.string().min(1).max(256)).max(16).optional(),
  effort: EffortSettingSchema.optional(),
})

export type RawModelRequest = z.infer<typeof RawModelRequestSchema>

/** GET /model/effort-options: a pair, a bare model id (or tier alias), or nothing (the Auto tier union). */
export const EffortOptionsQuerySchema = z.object({
  providerId: z.string().min(1).max(200).optional(),
  modelId: z.string().min(1).max(300).optional(),
}).strict().refine((q) => !q.providerId || !!q.modelId, { message: 'providerId needs modelId', path: ['modelId'] })

/** A validated raw body → the gateway request: the effort becomes an intent from the request itself. */
export function rawModelRequest(raw: RawModelRequest): ModelRequest {
  const { effort, ...rest } = raw
  return effort === undefined ? rest : { ...rest, effort: { level: effort, source: 'request' } }
}


/**
 * A sign-in status without what would let its reader finish someone else's
 * device sign-in: the verification link, the user code, the CLI's raw prompt
 * (which carries both when no link was parsed) and its last output.
 */
export function redactSignInStatus(status: CliSignInStatus): CliSignInStatus {
  if (!status.session) return status
  return { ...status, session: { ...status.session, verificationUrl: null, userCode: null, rawPrompt: null, error: null } }
}

export function createModelRoutes(
  app: Hono,
  gateway: ModelGateway,
  authenticate?: MiddlewareHandler,
  configService?: ProviderConfigService,
  reloadHandlers?: Map<string, () => Promise<void>>,
  reauthHealer?: { getHealth(id: string): import('./types.js').ProviderHealthInfo },
  db?: any,
  reasoningRegistry?: Pick<import('./reasoning/registry.js').ReasoningRegistry, 'invalidate'> & Partial<Pick<import('./reasoning/registry.js').ReasoningRegistry, 'get' | 'overlayVersion'>>,
  cliSignIn?: CliSignInService,
): void {
  const router = app as any

  /**
   * What a stored row says about identity beyond the catalog columns: the
   * concrete model it runs, whether the last discovery still offered it, and
   * its effective reasoning capability (computed, never stored).
   */
  const rowIdentity = (row: ModelConfigRow): Pick<ModelConfigItem, 'realModelId' | 'missing' | 'reasoning' | 'runtimeReasoning'> => {
    const realModelId = row.metadata?.realModelId
    const runtimeReasoning = row.metadata?.runtimeReasoning
    let reasoning: ModelConfigItem['reasoning']
    try {
      reasoning = reasoningRegistry?.get?.(row.providerId, row.modelId, realModelId)
    } catch {
      reasoning = undefined
    }
    return {
      ...(realModelId ? { realModelId } : {}),
      ...(row.metadata?.missingSince ? { missing: true } : {}),
      ...(reasoning ? { reasoning } : {}),
      // Display only (LM Studio's own setting): never part of the effort resolution.
      ...(runtimeReasoning ? { runtimeReasoning } : {}),
    }
  }

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
        return { id: p.id, name: providerDisplayName(p.id, p.name), kind: providerKind(p.id), modelCount: models.length, health: reauthHealer?.getHealth(p.id) }
      }))
      return c.json({ providers: result })
    }

    const configs = configService.listProviders()
    const providers: ProviderListItem[] = await Promise.all(configs.map(async cfg => {
      const provider = gateway.getProvider(cfg.id)
      const models = configService.listModels(cfg.id)
      const enabledModels = models.filter(m => m.enabled)
      return {
        id: cfg.id,
        name: providerDisplayName(cfg.id, provider?.name),
        kind: providerKind(cfg.id),
        enabled: cfg.enabled,
        active: cfg.enabled && !!provider,
        hasApiKey: PROVIDERS_NEEDING_API_KEY.has(cfg.id) ? !!provider : null,
        modelCount: models.length,
        enabledModelCount: enabledModels.length,
        health: reauthHealer?.getHealth(cfg.id),
        ...(await fileSandboxOf(cfg.id)),
      }
    }))
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
      return c.json({ id: provider.id, name: providerDisplayName(provider.id, provider.name), kind: providerKind(provider.id), models })
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
      ...rowIdentity(m),
    }))

    return c.json({
      id: cfg.id,
      name: providerDisplayName(cfg.id, provider?.name),
      kind: providerKind(cfg.id),
      enabled: cfg.enabled,
      active: cfg.enabled && !!provider,
      hasApiKey: PROVIDERS_NEEDING_API_KEY.has(id) ? !!provider : null,
      isDefault: cfg.isDefault,
      defaultModel: cfg.defaultModel,
      settings: cfg.settings,
      models,
      ...(await fileSandboxOf(id)),
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

    // Only a successful discovery may change the stored rows: a failed or
    // empty one leaves every row (and every binding to it) as it was.
    let models: ModelInfo[]
    try {
      models = provider.fetchModels ? await provider.fetchModels() : await provider.listModels()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: 'ModelDiscoveryFailed', message: message.slice(0, 300) }, 502)
    }
    if (models.length === 0) {
      return c.json({ error: 'ModelDiscoveryEmpty', message: 'The provider listed no models; nothing was changed' }, 502)
    }
    // Offered rows are upserted; rows it no longer offers are switched off
    // and flagged, never deleted.
    const outcome = configService.reconcileDiscoveredModels(id, models)
    // A refresh can change what discovery knows about these models.
    reasoningRegistry?.invalidate(id)
    return c.json({
      modelCount: models.length,
      missing: outcome.missing,
      restored: outcome.restored,
      models: configService.listModels(id).map((m) => ({ ...m, ...rowIdentity(m) })),
    })
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

  // ─── Sign-in into the EYAS-owned CLI homes ──────
  // Grok / Kimi run in their own EYAS home and never see the host login:
  // device code (the CLI's login through the provider's launch profile) or an
  // EYAS-stored API key (Grok). GET reads, POST starts or stores, DELETE signs
  // out (?target=session only cancels a pending device sign-in).
  const signInProvider = (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    if (!cliSignIn) throw new HTTPException(503, { message: 'CLI sign-in unavailable' })
    const id = c.req.param('id') as string
    if (!isCliSignInProvider(id)) throw new HTTPException(404, { message: 'This provider has no EYAS sign-in' })
    return id
  }
  const signInRequester = (c: any): Requester => ({
    userId: c.get('userId') as string,
    role: (c.get('role') as string | undefined) ?? 'guest',
    isAgent: !!c.get('isAgent'),
  })
  const signInFailure = (err: unknown): never => {
    if (err instanceof CliSignInRequestError) {
      const status = err.code === 'unsupported' ? 404 : err.code === 'secretsUnavailable' ? 503 : 400
      throw new HTTPException(status, { message: err.message })
    }
    if (err instanceof ScopeDeniedError) throw new HTTPException(403, { message: 'Access denied to this scope' })
    throw err
  }

  // A pending device sign-in's link and code bind whoever confirms them to
  // the EYAS home: only a requester who may manage models sees them. Everyone
  // else who may read models (the Home banner) gets the state without them.
  router.get('/api/v1/model/providers/:id/sign-in', requirePermission('read', 'Model'), async (c: any) => {
    const id = signInProvider(c)
    const status = await cliSignIn!.status(id)
    const ability = c.get('ability') as { can(action: string, subject: string): boolean } | undefined
    return c.json(ability?.can('manage', 'Model') ? status : redactSignInStatus(status))
  })

  router.post('/api/v1/model/providers/:id/sign-in', requirePermission('manage', 'Model'), async (c: any) => {
    const id = signInProvider(c)
    const parsed = CliSignInRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.issues }, 400)
    try {
      const status = await cliSignIn!.start(id, parsed.data, signInRequester(c))
      // A device sign-in continues in the background: poll GET for it.
      return c.json(status, parsed.data.method === 'device' ? 202 : 200)
    } catch (err) {
      return signInFailure(err)
    }
  })

  const SignOutQuerySchema = z.object({ target: z.enum(['credentials', 'session']).default('credentials') })

  router.delete('/api/v1/model/providers/:id/sign-in', requirePermission('manage', 'Model'), async (c: any) => {
    const id = signInProvider(c)
    const query = SignOutQuerySchema.safeParse({ target: c.req.query('target') ?? undefined })
    if (!query.success) return c.json({ error: 'ValidationError', issues: query.error.issues }, 400)
    try {
      const status = query.data.target === 'session'
        ? await cliSignIn!.cancel(id)
        : await cliSignIn!.signOut(id, signInRequester(c))
      return c.json(status)
    } catch (err) {
      return signInFailure(err)
    }
  })

  // ─── CLI runtime and isolation (provider panel) ─
  // One view per CLI provider: the binary EYAS runs, its sign-in, the last
  // isolation status EYAS recorded and the version the live lane proved.
  // Verify now re-runs a loaded provider's own checks without a model call;
  // a provider that can only be checked by a real turn (Claude Code) has no
  // verifier and gets 409.
  const isolationDeps: CliIsolationViewDeps = { cliSignIn }
  const isolationProvider = (c: any): IsolationCliId => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    const id = c.req.param('id') as string
    if (!isIsolationCliId(id)) throw new HTTPException(404, { message: 'This provider has no CLI isolation' })
    return id
  }

  router.get('/api/v1/model/providers/:id/isolation', requirePermission('read', 'Model'), async (c: any) => {
    const id = isolationProvider(c)
    return c.json(await describeCliIsolation(id, isolationDeps))
  })

  router.post('/api/v1/model/providers/:id/isolation/verify', requirePermission('manage', 'Model'), async (c: any) => {
    const id = isolationProvider(c)
    const run = verifyIsolationNow(id)
    if (!run) {
      return c.json({
        error: 'VerifyUnavailable',
        code: 'verifyUnavailable',
        message: 'This provider is not loaded, or it is checked only at the start of every turn',
      }, 409)
    }
    await run
    return c.json(await describeCliIsolation(id, isolationDeps))
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
      const allModels: Array<ModelInfo & Pick<ModelConfigItem, 'realModelId' | 'missing' | 'reasoning'>> = []
      for (const cfg of configService.listProviders()) {
        if (!cfg.enabled) continue
        for (const row of configService.listModels(cfg.id)) {
          if (!row.enabled) continue
          allModels.push({
            id: row.modelId,
            name: row.name,
            provider: row.providerId,
            contextWindow: row.contextWindow ?? 0,
            maxOutputTokens: row.maxOutputTokens ?? 0,
            supportsTools: row.supportsTools,
            supportsImages: row.supportsImages,
            supportsStreaming: row.supportsStreaming,
            ...rowIdentity(row),
          })
        }
      }
      return c.json({ models: allModels })
    }
    const models = await gateway.listAllModels()
    return c.json({ models })
  })

  // ─── Effort options ─────────────────────────────
  // The effort rungs a model accepts, for every effort select (agent editor,
  // routing-tier rows, scheduler). providerId+modelId → that model; a bare
  // modelId (or tier alias) → its single owning provider's model, else
  // 'unknown' (Auto only); no model → the Auto-routing tier union.
  router.get('/api/v1/model/effort-options', requirePermission('read', 'Model'), (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    const parsed = EffortOptionsQuerySchema.safeParse({
      providerId: c.req.query('providerId') || undefined,
      modelId: c.req.query('modelId') || undefined,
    })
    if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.issues }, 400)
    const { providerId, modelId } = parsed.data
    let request: EffortOptionsRequest = { mode: 'auto' }
    if (modelId && providerId) {
      request = { mode: 'pinned', providerId, modelId }
    } else if (modelId) {
      let ref: { providerId: string; modelId: string } | null = null
      try {
        ref = configService
          ? resolveModelRef({ providerConfig: configService, isRegistered: (id) => !!gateway.getProvider(id) }, modelId)
          : null
      } catch {
        ref = null
      }
      request = ref ? { mode: 'pinned', ...ref } : { mode: 'unknown', modelId }
    }
    return c.json(describeEffortOptions({
      getCapability: (p, m) => {
        const capability = reasoningRegistry?.get?.(p, m)
        if (!capability) throw new Error('no reasoning registry')
        return capability
      },
      getTiers: () => (db ? readTiers(db) : []),
      modelName: (p, m) => configService?.listModels(p).find((row) => row.modelId === m)?.name ?? null,
      catalogVersion: reasoningRegistry?.overlayVersion,
    }, request))
  })

  // ─── Complete / Stream (raw, Zod-validated) ─────
  router.post('/api/v1/model/complete', requirePermission('use', 'Model'), async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    const parsed = RawModelRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.issues }, 400)
    const response = await gateway.complete(rawModelRequest(parsed.data))
    return c.json(response)
  })

  router.post('/api/v1/model/stream', requirePermission('use', 'Model'), async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    const parsed = RawModelRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.issues }, 400)
    const request = rawModelRequest(parsed.data)
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of gateway.stream(request)) {
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
    // { agentId: {providerId, modelId} } — or the legacy { agentId: modelId },
    // whose provider is looked up in the model catalog.
    const parsed = z.object({ assignments: AgentModelAssignmentsSchema }).safeParse(body)
    if (!parsed.success) {
      throw new HTTPException(400, { message: 'assignments must be an object of { agentId: {providerId, modelId} | modelId }' })
    }
    // Every model must be known to the catalog before anything is written.
    const unknown = Object.entries(parsed.data.assignments)
      .filter(([, assignment]) => !resolveAgentModelAssignment(db, assignment))
      .map(([agentId]) => agentId)
    if (unknown.length > 0) {
      return c.json({ error: 'Unknown model for one or more agents', code: 'unknown_model', agents: unknown }, 400)
    }
    const { applied } = applyAgentModelAssignments(db, parsed.data.assignments)
    return c.json({ ok: true, applied })
  })
}
