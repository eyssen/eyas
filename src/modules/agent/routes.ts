// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Hono } from 'hono'
import { z } from 'zod'
import { requirePermission } from '@modules/permissions/middleware'
import { listTeamTemplates, applyTeamAgentSelection } from './team-bootstrap.js'
import type { AgentRegistry } from './agent-registry.js'
import type { ReasoningCapability } from '@modules/model/reasoning/capability.js'
import type { EffortLevel } from '@modules/model/reasoning/ladder.js'
import { EffortSettingSchema } from '@modules/model/reasoning/schemas.js'
import { effortUnsupportedBody, unsupportedEffort } from '@modules/model/reasoning/validate.js'
import type { ModelPair } from '@modules/model/binding.js'

/** A colleague's effort: a ladder rung, or 'auto' / null for Auto (stored as NULL). */
const AgentEffortSchema = EffortSettingSchema.nullable().optional()
  .transform((v): EffortLevel | null | undefined => (v === 'auto' ? null : v))

// Validate the create-agent body. `id`/`name` are required; array fields and
// text fields default so the registry INSERT never binds undefined against a
// NOT NULL / PRIMARY KEY column. `source` is intentionally omitted — the route
// forces 'user'; any client-supplied source is stripped by Zod.
const CreateAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().default(''),
  description: z.string().default(''),
  goal: z.string().default(''),
  backstory: z.string().default(''),
  tier: z.enum(['primary', 'team', 'specialist']).optional(),
  agentType: z.enum([
    'assistant', 'engineer', 'developer', 'reviewer', 'critic',
    'researcher', 'planner', 'coordinator', 'observer',
  ]).optional(),
  systemPrompt: z.string().default(''),
  capabilities: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  // The colleague's model binding: provider+model together (H4). A model
  // alone is the legacy shape (its provider is looked up); null or '' clears
  // both — the colleague then runs on the conversation's own model.
  provider: z.string().trim().min(1).nullable().optional(),
  model: z.string().trim().nullable().optional(),
  maxTurns: z.number().int().positive().optional(),
  effort: AgentEffortSchema,
  enabled: z.boolean().optional(),
  avatar: z.string().optional(),
  tags: z.array(z.string()).default([]),
  monthlyTokenBudget: z.number().min(0).optional(),
})

/**
 * PATCH body: every create field optional and without its default (an absent
 * field keeps the stored value), `id` immutable. Unknown keys — `source`,
 * `id`, anything else — are stripped, so a PATCH can only write what the
 * editor can.
 */
const UpdateAgentSchema = CreateAgentSchema.omit({ id: true }).partial()

/** A colleague's model (a model id or tier alias) resolved to its owner and reasoning capability. */
export interface AgentEffortTarget {
  providerId: string
  modelId: string
  capability: ReasoningCapability
}

/** The model catalog a colleague's model is written against. */
export interface AgentModelCatalog {
  /** An enabled model of an active provider (ctx.modelBinding.isSelectable). */
  isSelectable(pair: ModelPair): boolean
  /** The one active provider whose catalog lists this exact model id enabled; null when none or several. */
  ownerOf(modelId: string): string | null
}

/** A colleague's model binding as written: both set, both cleared, or a legacy model without a provider. */
type AgentModelWrite = { provider: string | null; model: string | null }

/**
 * The provider+model a create/PATCH body writes, or undefined when it names
 * neither. A pair must be an enabled model of an active provider; a bare
 * model id gets its provider when exactly one catalog lists it, and is kept
 * provider-less otherwise (a tier alias, an id several providers list: the
 * resolver binds those at run time). Without a catalog the body is stored as
 * sent.
 */
function agentModelWrite(
  body: { provider?: string | null; model?: string | null },
  catalog: AgentModelCatalog | undefined,
): { ok: true; write: AgentModelWrite | undefined } | { ok: false; status: 400; body: Record<string, unknown> } {
  const model = body.model === undefined ? undefined : (body.model || null)
  const provider = body.provider === undefined ? undefined : (body.provider || null)
  if (model === undefined) {
    if (provider) return { ok: false, status: 400, body: { error: 'provider and model must be sent together' } }
    return { ok: true, write: provider === null ? { provider: null, model: null } : undefined }
  }
  if (model === null) return { ok: true, write: { provider: null, model: null } }
  if (provider) {
    let selectable = true
    try {
      selectable = catalog ? catalog.isSelectable({ providerId: provider, modelId: model }) : true
    } catch {
      selectable = false
    }
    if (!selectable) {
      return {
        ok: false,
        status: 400,
        body: {
          error: `The model ${provider} / ${model} is not available: it is not an enabled model of an active provider`,
          code: 'model_binding_unavailable',
          providerId: provider,
          modelId: model,
        },
      }
    }
    return { ok: true, write: { provider, model } }
  }
  let owner: string | null = null
  try {
    owner = catalog?.ownerOf(model) ?? null
  } catch {
    owner = null
  }
  return { ok: true, write: { provider: owner, model } }
}

export function createAgentRoutes(app: Hono, registry: AgentRegistry, deps?: {
  db: any
  dataDir: string
  /**
   * Resolve a colleague's model (its pair, or a bare id / tier alias bound to
   * its owner) to the model it runs on and that model's reasoning
   * capability; null when EYAS cannot tell (no owner, an ambiguous id).
   * Absent or null: any rung is accepted (the gateway clamps).
   */
  effortTargetFor?: (model: string, providerId?: string | null) => AgentEffortTarget | null
  /** Where a written provider+model is checked (and a bare model's provider found). */
  modelCatalog?: AgentModelCatalog
  getConversations?: () => {
    getOrCreateHomeThread(input: {
      userId: string
      agentId: string
      title: string
    }): { id: string; [k: string]: unknown }
    get(id: string): unknown
  } | undefined
}) {
  // `userId` is set by the auth middleware for every /api/v1 request.
  const api = new Hono<{ Variables: { userId?: string } }>()

  /**
   * The 400 body for an effort rung the colleague's model does not accept,
   * or null when it fits: Auto, no model, or a model EYAS has no verified
   * facts about (the runtime resolves those to Auto).
   */
  function effortRejection(effort: EffortLevel | null | undefined, model: string | null | undefined, providerId?: string | null) {
    if (!effort || !model) return null
    let target: AgentEffortTarget | null = null
    try {
      target = deps?.effortTargetFor?.(model, providerId ?? null) ?? null
    } catch {
      target = null
    }
    if (!target) return null
    const rejection = unsupportedEffort(effort, target.capability)
    return rejection ? effortUnsupportedBody(rejection, target) : null
  }

  api.post('/agents/:id/home-thread', requirePermission('create', 'Conversation'), (c) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) return c.json({ error: 'Authentication required' }, 401)
    const agent = registry.get(c.req.param('id'))
    if (!agent || !agent.enabled) return c.json({ error: 'Agent not found' }, 404)
    if (agent.tier !== 'primary' && agent.tier !== 'team') {
      return c.json({ error: 'Only colleagues (primary or team) have a home thread' }, 400)
    }
    const conversations = deps?.getConversations?.()
    if (!conversations) return c.json({ error: 'Conversations module not ready' }, 503)
    const home = conversations.getOrCreateHomeThread({
      userId,
      agentId: agent.id,
      title: agent.name,
    })
    const full = conversations.get(home.id) ?? home
    return c.json(full, 201)
  })

  // List agents
  api.get('/agents', requirePermission('read', 'Agent'), (c) => {
    const enabled = c.req.query('enabled')
    const source = c.req.query('source')
    const tier = c.req.query('tier')
    const agentType = c.req.query('agentType')
    const filter: any = {}
    if (enabled !== undefined) filter.enabled = enabled === 'true'
    if (source) filter.source = source
    if (tier) filter.tier = tier
    if (agentType) filter.agentType = agentType
    const agents = registry.list(Object.keys(filter).length > 0 ? filter : undefined)
    return c.json({ agents })
  })

  // Team template catalog + bulk create — the authenticated post-setup
  // replacement for the first-run wizard's optional 'team-agents' step.
  // Registered BEFORE '/agents/:id' so 'templates' is not swallowed as an id.
  api.get('/agents/templates', requirePermission('read', 'Agent'), (c) => {
    return c.json({ templates: listTeamTemplates() })
  })

  api.post('/agents/team-bootstrap', requirePermission('create', 'Agent'), async (c) => {
    if (!deps?.db) return c.json({ error: 'Team bootstrap unavailable' }, 503)
    const body = (await c.req.json().catch(() => ({}))) as { agentIds?: unknown }
    const ids = Array.isArray(body.agentIds)
      ? body.agentIds.filter((x): x is string => typeof x === 'string')
      : []
    const result = await applyTeamAgentSelection({ db: deps.db, dataDir: deps.dataDir }, ids)
    return c.json({ ok: true, created: result.created })
  })

  // Get single agent
  api.get('/agents/:id', requirePermission('read', 'Agent'), (c) => {
    const agent = registry.get(c.req.param('id'))
    if (!agent) return c.json({ error: 'Agent not found' }, 404)
    return c.json({ agent })
  })

  // Create agent
  api.post('/agents', requirePermission('create', 'Agent'), async (c) => {
    let rawBody: unknown
    try {
      rawBody = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }
    const parsed = CreateAgentSchema.safeParse(rawBody)
    if (!parsed.success) {
      return c.json({ error: 'Invalid agent', details: parsed.error.flatten() }, 400)
    }
    // Reject primary-key collisions with a 409 instead of surfacing the raw
    // driver error as an opaque 500.
    if (registry.get(parsed.data.id)) {
      return c.json({ error: `Agent already exists: ${parsed.data.id}` }, 409)
    }
    const modelWrite = agentModelWrite(parsed.data, deps?.modelCatalog)
    if (!modelWrite.ok) return c.json(modelWrite.body, modelWrite.status)
    const binding = modelWrite.write ?? { provider: null, model: null }
    const rejectedEffort = effortRejection(parsed.data.effort, binding.model, binding.provider)
    if (rejectedEffort) return c.json(rejectedEffort, 400)
    const agent = registry.create({ ...parsed.data, provider: binding.provider, model: binding.model, source: 'user' })
    return c.json({ agent }, 201)
  })

  // Update agent — Zod-validated partial; an effort must fit the (patched) model.
  api.patch('/agents/:id', requirePermission('update', 'Agent'), async (c) => {
    const id = c.req.param('id')
    let rawBody: unknown
    try {
      rawBody = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }
    const parsed = UpdateAgentSchema.safeParse(rawBody)
    if (!parsed.success) {
      return c.json({ error: 'Invalid agent', details: parsed.error.flatten() }, 400)
    }
    const existing = registry.get(id)
    if (!existing) return c.json({ error: 'Agent not found' }, 404)
    const modelWrite = agentModelWrite(parsed.data, deps?.modelCatalog)
    if (!modelWrite.ok) return c.json(modelWrite.body, modelWrite.status)
    const binding: AgentModelWrite = modelWrite.write ?? { provider: existing.provider ?? null, model: existing.model ?? null }
    // A rung is judged when it changes, or when the model it runs on changes.
    // The editor sends the whole form on every save, so a stored rung sent
    // back unchanged on the same model is accepted — a name or prompt edit
    // never fails on an effort the model has since stopped offering (the
    // runtime clamps it).
    const { effort } = parsed.data
    const modelChanged = modelWrite.write !== undefined &&
      (binding.model !== (existing.model ?? null) || binding.provider !== (existing.provider ?? null))
    const effortChanged = effort !== undefined && (effort ?? undefined) !== (existing.effort ?? undefined)
    const effortToJudge = effortChanged ? effort : modelChanged ? (effort !== undefined ? effort : existing.effort) : undefined
    const rejectedEffort = effortRejection(effortToJudge, binding.model, binding.provider)
    if (rejectedEffort) return c.json(rejectedEffort, 400)
    const { provider: _provider, model: _model, ...rest } = parsed.data
    registry.update(id, modelWrite.write ? { ...rest, provider: binding.provider, model: binding.model } : rest)
    const agent = registry.get(id)
    return c.json({ agent })
  })

  // Delete agent (only user-created)
  api.delete('/agents/:id', requirePermission('delete', 'Agent'), (c) => {
    try {
      registry.delete(c.req.param('id'))
      return c.json({ message: 'Agent deleted' })
    } catch (err: any) {
      return c.json({ error: err.message }, 400)
    }
  })

  // Toggle agent enabled/disabled
  api.post('/agents/:id/toggle', requirePermission('update', 'Agent'), (c) => {
    registry.toggle(c.req.param('id'))
    const agent = registry.get(c.req.param('id'))
    return c.json({ agent })
  })

  app.route('/api/v1', api)
}
