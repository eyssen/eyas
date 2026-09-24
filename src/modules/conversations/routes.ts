// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import { requirePermission } from '@modules/permissions/middleware'
import type { ConversationService, ConversationWithMessages } from './conversation-service.js'
import {
  GodModeBusyError,
  GodModeCeilingError,
  GodModeConfigError,
  type GodModeOrchestrator,
  type StartGodModeInput,
} from '@modules/agent/god-mode/orchestrator.js'
import { WS_TOPICS } from '@shared/ws-topics.js'
import type { ModelGateway, ContentBlock, ToolDefinition } from '@modules/model/types'
import type { ProviderConfigService } from '@modules/model/provider-config-service'
import type { AuxiliaryModelService } from '@modules/model/auxiliary'
import type { DocumentService } from '@modules/documents/document-service'
import type { createAgentRunner } from '@modules/agent/agent-runner'
import type { ToolRegistry } from '@modules/tools/tool-registry'
import type { DecisionEngine } from '@modules/model/routing/decision-engine'
import type { RoutingTier } from '@modules/model/routing/types'
import {
  agentModelPreference,
  BindingUnavailableError,
  catalogBindingDeps,
  conversationBindingInput,
  createBindingResolver,
  MODEL_BINDING_MODES,
  type BindingConversationRow,
  type BindingInput,
  type BindingResolver,
  type ModelBindingMode,
  type ModelPair,
  type ResolvedBinding,
} from '@modules/model/binding.js'
import type { TurnBinding } from '@shared/chat-stream.js'
import type { EffortLevel } from '@modules/model/reasoning/ladder.js'
import type { ReasoningRegistry } from '@modules/model/reasoning/registry.js'
import { EffortSettingSchema } from '@modules/model/reasoning/schemas.js'
import { effortUnsupportedBody, unsupportedEffort } from '@modules/model/reasoning/validate.js'
import { effortTargetFor } from './effort-target.js'
import { describeEffortOptions, type ConversationEffortOptions } from '@modules/model/reasoning/options.js'
import { normalizeEffortSetting } from '@modules/model/reasoning/ladder.js'
import { readTiers } from '@modules/model/routing/tier-store.js'
import type { ContextRecorder } from '@modules/observability/context-recorder'
import { registerPromptEnhancerRoute } from './prompt-enhancer-route.js'
import { registerPromptCoachRoute } from './prompt-coach-route.js'
import { generatePlan, PLAN_TEMPERATURE } from '@modules/agent/planning.js'
import {
  beginConversationRun,
  cancelConversationRun,
  endConversationRun,
} from './run-abort.js'
import { dropPlan, parkPlan, peekPlan, takePlan, planToSystemSection } from './plan-gate.js'
import { resolveConversationSystemPrompt } from './system-prompt.js'
import { attachTurnContext, deliveryRecordFields } from '@modules/prompt-wizard/assemble-system'
import { stubUnsupportedImages } from '@modules/model/helpers.js'
import { resolveToolScope, scopedToolDefinitions } from '@modules/agent/tool-scope.js'
import type { ContextSection } from '@modules/prompt-wizard/types'
import { estimateMessagesTokens, estimateTokens } from '@modules/prompt-wizard/token-budget'
import { loadEffortIntent, type EffortIntentDb } from './effort-intent.js'
import { turnEffortOf } from './turn-meta.js'
import { buildOrchestrationDirective } from './orchestration-directive.js'
import {
  buildTeamNudgeDirective,
  buildTeamProposeInFlightDirective,
  decideTeamAutoPropose,
  estimateMessageComplexity,
  fireTeamProposal,
  isActiveTeamStatus,
} from './team-auto-propose.js'
import type { PricingTable } from '@shared/model-pricing.js'
import { resolveMaxTurns } from '@shared/turn-budget.js'
import type { Logger } from 'pino'
import {
  inheritWorkingDirectories,
  parseWorkingDirectories,
  serializeWorkingDirectories,
  toolWorkspaceFields,
  checkWorkingDirectoriesBody,
  conversationWorkspaceAccess,
  folderRefusedNotice,
  screenToolWorkspaceFields,
} from '@modules/tools/working-directories.js'
import { listDirectories } from '@modules/tools/filesystem-browse.js'
import {
  generateConversationTitle,
  isUntitledTitle,
  planAutoTitle,
} from './auto-title.js'
import { effectiveProjectId } from '@modules/memory/types.js'
import { ensureConversationWorkspace } from '@modules/model/cli-runtime/workspaces.js'
import type { Locality } from '@modules/privacy/service.js'
import {
  PRIVACY_INBOUND_MASKED_EVENT,
  PRIVACY_INBOUND_REFUSED_EVENT,
  privacyRefusal,
  privacyRefusalBody,
  type PrivacyInboundEvent,
} from '@modules/privacy/errors.js'
import { MessagePrivacySchema, preflightUserText, type ChatInboundPrivacy } from './privacy-preflight.js'

/**
 * The conversation's own EYAS workspace as its folder list. Null when the
 * workspaces root cannot be written: that is no reason to refuse a
 * conversation, and the CLI cwd resolver still gives the model a private
 * scratch folder instead of choosing one itself.
 */
function ownWorkspaceFolders(conversationId: string): string[] | null {
  try {
    return [ensureConversationWorkspace(conversationId)]
  } catch {
    return null
  }
}

function pinWorkingDirectoriesFromProject(
  project: { typeId?: string | null; workingDirectories?: unknown } | null | undefined,
  projectTypes?: { get(id: string): { workingDirectories?: unknown } | null },
): ReturnType<typeof serializeWorkingDirectories> | null {
  const type = project?.typeId ? projectTypes?.get(project.typeId) : null
  const inherited = inheritWorkingDirectories(project?.workingDirectories, type?.workingDirectories)
  if (inherited.length === 0) return null
  return serializeWorkingDirectories(inherited)
}

/** Lightweight callback for memory lifecycle events during conversation turns */
export interface ConversationMemoryHooks {
  /** Called after a full assistant turn — extract implicit facts from the exchange */
  onTurnComplete?(conversationId: string, userMessage: string, assistantMessage: string): void
  /** Called when episodic memories are accessed from a conversation — track cross-conversation usage */
  onMemoryAccessed?(conversationId: string, memoryIds: string[]): void
}

// D6 (F2 T2): PATCH validates the dangerous and the model-facing fields — a
// client-settable `status` whitelist, the model binding, the effort ladder and
// the orchestration mode — plus the totalCostUsd strip below. Every other
// UPDATE_FIELD_MAP field keeps passing through unvalidated (matching the
// existing permissive style); `.passthrough()` is deliberate — adding
// `.strict()` here would reject those unrelated fields with 400.
// 'waiting_approval' is runner-owned (run-supervisor's park()) and every
// other conversation status is either system-driven or not client-facing —
// only the three a human legitimately sets from the UI are allowed.
const ProviderIdSchema = z.string().min(1).max(200)
const ModelIdSchema = z.string().min(1).max(300)

/** A stored effort: a ladder rung, or 'auto' / null for Auto (stored as NULL). */
const EffortFieldSchema = EffortSettingSchema.nullable().optional()
  .transform((v): EffortLevel | null | undefined => (v === 'auto' ? null : v))

const PatchConversationSchema = z.object({
  status: z.enum(['idle', 'waiting', 'archived']).optional(),
  // The model binding (model/binding.ts). A pair is sent as both ids.
  modelBinding: z.enum(MODEL_BINDING_MODES).optional(),
  providerId: ProviderIdSchema.optional(),
  modelId: ModelIdSchema.optional(),
  effort: EffortFieldSchema,
  orchestration: z.enum(['solo', 'auto', 'deep']).optional(),
}).passthrough()

/** POST /conversations: an optional starting binding and effort. */
const CreateBindingSchema = z.object({
  modelBinding: z.enum(MODEL_BINDING_MODES).optional(),
  providerId: ProviderIdSchema.optional(),
  modelId: ModelIdSchema.optional(),
  effort: EffortFieldSchema,
})

/** A one-turn provider/model override on the message: both ids, or neither. */
const TurnOverrideSchema = z.object({
  provider: ProviderIdSchema.optional(),
  model: ModelIdSchema.optional(),
}).refine((v) => !!v.provider === !!v.model, { message: 'provider and model must be sent together' })

/** The binding as the stream and the UI carry it (the resolver's bookkeeping stripped). */
function toTurnBinding(binding: ResolvedBinding): TurnBinding {
  return {
    providerId: binding.providerId,
    modelId: binding.modelId,
    source: binding.source,
    ...(binding.tier ? { tier: binding.tier } : {}),
    ...(binding.note ? { note: binding.note } : {}),
  }
}

/** A binding that cannot be served, as a coded 400 the UI localizes. */
function bindingErrorResponse(c: any, err: BindingUnavailableError): Response {
  return c.json({
    error: err.message,
    message: err.message,
    code: err.code,
    ...(err.providerId ? { providerId: err.providerId } : {}),
    ...(err.modelId ? { modelId: err.modelId } : {}),
  }, 400)
}

export interface ConversationRouteDeps {
  chatService: ConversationService
  gateway: ModelGateway
  configService?: ProviderConfigService
  getDocuments?: () => DocumentService | undefined
  getAgentRunner?: () => ReturnType<typeof createAgentRunner> | undefined
  getToolRegistry?: () => ToolRegistry | undefined
}

/** Lazy God Mode send-path deps — agent module may start after conversations. */
export interface GodModeSendDeps {
  orchestrator: GodModeOrchestrator
  enabled: boolean
  limits: { min: number; max: number }
  getLiveKeys: () => Set<string> | Promise<Set<string>>
  pricing?: PricingTable
  broadcast?: (topic: string, message: unknown) => void
  /**
   * The roster's provider/model pairs: a God Mode message goes to every one
   * of them, so the privacy ingress check weighs all their destinations.
   * Absent or empty: the destinations are unknown and count as remote.
   */
  participants?: () => ReadonlyArray<ModelPair>
}

function mapGodModeHttpError(err: unknown): { status: 400 | 409; code: string; message: string } | null {
  if (err instanceof GodModeBusyError) {
    return { status: 409, code: err.name, message: err.message }
  }
  if (err instanceof GodModeConfigError || err instanceof GodModeCeilingError) {
    return { status: 400, code: err.name, message: err.message }
  }
  return null
}

async function startGodModeTurn(opts: {
  c: any
  chatService: ConversationService
  conversationId: string
  userMessageId: number
  userText: string
  fullConv: ConversationWithMessages
  god: GodModeSendDeps | undefined
}): Promise<Response> {
  const { c, chatService, conversationId, userMessageId, userText, fullConv, god } = opts
  const resetIdle = () => {
    try { chatService.update(conversationId, { status: 'idle' }) } catch { /* best effort */ }
  }

  if (!god?.orchestrator) {
    resetIdle()
    return c.json({
      code: 'GodModeUnavailable',
      message: 'God Mode orchestrator is not available',
      error: 'God Mode orchestrator is not available',
    }, 409)
  }
  const orch = god.orchestrator

  if (orch.hasActiveRun(conversationId)) {
    resetIdle()
    const busy = new GodModeBusyError()
    return c.json({ code: 'GodModeBusyError', message: busy.message, error: busy.message }, 409)
  }

  const fallbackTitle = planAutoTitle(fullConv.title, userText)
  if (fallbackTitle) {
    try { chatService.update(conversationId, { title: fallbackTitle }) } catch { /* non-fatal */ }
  }

  const liveKeys = await Promise.resolve(god.getLiveKeys())
  const input: StartGodModeInput = {
    conversationId,
    userMessageId,
    userText,
    sourceWorkingDirectory: parseWorkingDirectories(fullConv.workingDirectories)[0] ?? null,
    orchestration: fullConv.orchestration ?? 'auto',
    liveKeys,
    limits: god.limits,
    pricing: god.pricing,
  }

  // Validation (busy/config/ceiling) throws before the first await inside start().
  // Yield one microtask so those become HTTP 409/400 instead of a 200 SSE envelope.
  // Swallow rejection here so an HTTP short-circuit cannot leave an unhandled promise.
  type GodRun = Awaited<ReturnType<GodModeOrchestrator['start']>>
  let earlyError: unknown
  const startPromise: Promise<GodRun | undefined> = orch.start(input).then(
    (run) => run,
    (err) => {
      earlyError = err
      return undefined
    },
  )
  await Promise.resolve()
  const early = mapGodModeHttpError(earlyError)
  if (early) {
    resetIdle()
    return c.json({ code: early.code, message: early.message, error: early.message }, early.status)
  }

  // The race can run for minutes. Do not hold this HTTP/SSE open for it —
  // browsers abort long POSTs with "Load failed" and would cancel workers.
  // Start stays in-process; the winner lands via addMessage + chat WS.
  void startPromise.then((run) => {
    resetIdle()
    const failed = !run || run.status === 'failed' || run.status === 'cancelled'
    god.broadcast?.(WS_TOPICS.chat(conversationId), {
      event: 'eyas.conversation.updated',
      data: {
        conversationId,
        status: 'idle',
        error: failed ? (run?.error ?? (earlyError instanceof Error ? earlyError.message : undefined)) : undefined,
      },
    })
  })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => controller.enqueue(encoder.encode(`data: ${data}\n\n`))
      if (fallbackTitle) {
        send(JSON.stringify({ type: 'title', title: fallbackTitle }))
      }
      // god_started opens the progress panel; there is no agent_start.
      send(JSON.stringify({ type: 'god_started' }))
      controller.close()
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
}

import {
  createSkillDecisionStore, ensureSkillDecisionSchema, resolveSkillForTurn,
  type SkillMatchSummary,
} from './skill-gate.js'
import { recallableSkills } from '@modules/skills/recallable.js'
import { SECRETS_TAG } from '@modules/memory/memory-index.js'
import { createTurnSink } from './turn-sink.js'
import { captureRunEnd, type MemoryCaptureFn } from '@modules/memory/capture/run-end.js'

function occupancyFrame(conv: {
  tokensUsed: number
  status: string
  estimatedTokens: number | null
  contextWindow: number
  measured: boolean
}) {
  return {
    tokensUsed: conv.tokensUsed,
    status: 'idle' as const,
    estimatedTokens: conv.estimatedTokens,
    contextWindow: conv.contextWindow,
    measured: conv.measured,
  }
}

export function createConversationRoutes(
  app: Hono,
  chatService: ConversationService,
  gateway: ModelGateway,
  configService?: ProviderConfigService,
  getDocuments?: () => DocumentService | undefined,
  getAgentRunner?: () => ReturnType<typeof createAgentRunner> | undefined,
  getToolRegistry?: () => ToolRegistry | undefined,
  getDecisionEngine?: () => DecisionEngine | undefined,
  getAssembler?: () => import('@modules/prompt-wizard/assembler').PromptAssembler | undefined,
  getSkills?: () => {
    loader: {
      list(enabled?: boolean): any[]
      setEnabled?(id: string, enabled: boolean, reason?: string, by?: string): void
    }
    matcher: { match(query: string, skills: any[], maxResults?: number): { skill: { id: string; content: string; name: string; capabilities?: string[] }; matchScore: number }[] }
    /** `memory.recall.includeSecrets` (D-7 / P-19), published by the skills module. */
    recall?: () => { includeSecrets: boolean }
  } | undefined,
  memoryHooks?: ConversationMemoryHooks,
  getBoard?: () => {
    projects: {
      get?(id: string): {
        defaultAgentId: string | null
        typeId?: string | null
        indexedSources?: string[] | null
        workingDirectories?: unknown
      } | null
      getWithStages(id: string): {
        defaultAgentId: string | null
        typeId?: string | null
        indexedSources?: string[] | null
        workingDirectories?: unknown
        stages: { id: string; isClosed: boolean; sortOrder: number }[]
      } | null
    }
    projectTypes?: {
      get(id: string): { workingDirectories?: unknown } | null
    }
  } | undefined,
  /** F2 T9 — config `model.pricing` override for the interactive turn's cost estimate. */
  getPricingOverrides?: () => PricingTable | undefined,
  /**
   * Optional team auto-propose deps (agent orchestrator + team sessions).
   * Lazy: agent module may start after conversations route registration.
   */
  getTeamPropose?: () => import('./team-auto-propose.js').TeamProposeDeps | undefined,
  /**
   * Lazy God Mode orchestrator — agent module may start after conversations.
   */
  getGodMode?: () => GodModeSendDeps | undefined,
  /** Task 10 — records every assembled system prompt for the context inspector. Optional everywhere: a missing recorder must never break a model call. Appended last so existing positional call sites are unaffected. */
  getContextRecorder?: () => ContextRecorder | undefined,
  /** Lazy design service — the design module starts after conversations. Appended last so existing positional call sites are unaffected. */
  getDesigns?: () => import('@modules/design/design-service.js').DesignService | undefined,
  /**
   * Records whether a matched skill was accepted for a conversation. Appended
   * last so existing positional call sites are unaffected. WITHOUT it no skill
   * is applied at all: a decision that cannot be recorded would be asked for
   * again on every turn, and silently injecting instead is the bug this gate
   * exists to close.
   */
  skillDecisions?: import('./skill-gate.js').SkillDecisionStore,
  /**
   * Lazy durable-memory capture (the write side; recall is the assembler's
   * turn block). The parameters are positional: a new one is appended, never
   * inserted, or an existing call site's arguments would shift.
   */
  getMemoryCapture?: () => MemoryCaptureFn | undefined,
  /**
   * Lazy media gateway — merge ingested media documentIds onto the assistant
   * turn's attachmentIds. Optional last arg so existing positional call sites
   * are unaffected.
   */
  getMedia?: () => { listJobs(filter: { conversationId?: string; since?: number }): Array<{ documentIds: string[] }> } | undefined,
  /**
   * Lazy studio gateway — merge ingested render documentIds onto the assistant
   * turn. Appended after getMedia so existing positional call sites are unaffected.
   */
  getStudio?: () => { listJobs(filter: { conversationId?: string; since?: number }): Array<{ documentIds: string[] }> } | undefined,
  /**
   * Lazy background model service (first-turn title refinement). Absent: the
   * deterministic snippet stays the title. Appended last so existing
   * positional call sites are unaffected.
   */
  getAuxiliaryModel?: () => AuxiliaryModelService | undefined,
  /**
   * The model binding resolver (ctx.modelBinding, model/binding.ts). Absent:
   * the same resolver over this factory's own gateway, catalog and decision
   * engine. Appended last so existing positional call sites are unaffected.
   */
  getBindingResolver?: () => BindingResolver | undefined,
  /**
   * Lazy agent registry: an agent-bound conversation follows its colleague's
   * model, and its turns are offered the colleague's tool scope.
   */
  getAgentRegistry?: () => { get(id: string): { provider?: string | null; model?: string | null; tools?: readonly string[] | null; maxTurns?: number | null; effort?: string | null } | undefined } | undefined,
  /**
   * The reasoning capability registry (ctx.reasoningRegistry): an effort
   * written for a conversation on a known model must be one of its levels.
   * Absent: every model counts as unknown and any rung is accepted (the
   * gateway still clamps). Appended last so existing positional call sites
   * are unaffected.
   */
  getReasoningRegistry?: () => Pick<ReasoningRegistry, 'get'> | undefined,
  /** The module logger (turn failures, turn-metadata issues). Appended last. */
  logger?: Pick<Logger, 'warn' | 'error'>,
  /**
   * Lazy privacy ingress check (privacy-preflight.ts): a new message with a
   * block-class value bound for a remote model is refused with a 422 before
   * anything is stored. Absent: no check. Appended last.
   */
  getInboundPrivacy?: () => ChatInboundPrivacy | undefined,
  /**
   * The database, for the turn's effort intent (effort-intent.ts): a
   * sub-conversation without its own level inherits its delegating parent's.
   * Absent: the conversation's own settings and its agent's effort still
   * apply; only the parent walk is skipped. Appended last.
   */
  effortDb?: EffortIntentDb,
): void {
  const router = app as any

  // ─── Model binding (D3) ─────────────────────────
  let localResolver: BindingResolver | null = null
  function bindingResolver(): BindingResolver {
    const published = getBindingResolver?.()
    if (published) return published
    localResolver ??= createBindingResolver(catalogBindingDeps({
      isRegistered: (providerId) => !!gateway.getProvider(providerId),
      getCatalog: () => configService,
      getRouter: () => getDecisionEngine?.(),
    }))
    return localResolver
  }

  /** The resolver input for a conversation, with its colleague's model preference. */
  function bindingInput(
    conv: BindingConversationRow,
    extra: { request?: ModelPair | null; text?: string } = {},
  ): BindingInput {
    // The colleague's provider+model pair (H4), or a legacy bare model id.
    let agent: BindingInput['agent'] = null
    if (conv.agentId) {
      try { agent = agentModelPreference(getAgentRegistry?.()?.get(conv.agentId)) } catch { agent = null }
    }
    return conversationBindingInput(conv, { ...extra, agent })
  }

  /**
   * The 400 response for an effort rung the conversation's model does not
   * accept, or null when it fits: Auto, an Auto-routed conversation (its
   * model is picked per message), or a model EYAS has no verified facts about
   * (the gateway resolves those to Auto). `conv` is the conversation as it
   * will be after the write, so a PATCH that also changes the model is judged
   * against the new one.
   */
  function effortRejection(c: any, conv: BindingConversationRow, effort: EffortLevel | null | undefined): Response | null {
    if (effort === undefined || effort === null) return null
    const target = effortTargetFor({ conversation: conv, agent: bindingInput(conv).agent }, bindingResolver())
    if (target.mode !== 'pinned') return null
    let capability: ReturnType<ReasoningRegistry['get']> | undefined
    try {
      capability = getReasoningRegistry?.()?.get(target.providerId, target.modelId)
    } catch {
      capability = undefined
    }
    const rejection = unsupportedEffort(effort, capability)
    return rejection ? c.json(effortUnsupportedBody(rejection, target), 400) : null
  }

  function modelSupportsImages(pair: ModelPair): boolean | null {
    try {
      const row = configService?.listModels(pair.providerId).find((m) => m.modelId === pair.modelId)
      return row ? row.supportsImages : null
    } catch {
      return null
    }
  }

  /**
   * The pair the conversation's next turn runs on, without triage (an Auto
   * conversation shows its Standard tier; `materialize` marks a default not
   * fixed yet). Null with the error code when its fixed model is unavailable.
   */
  function effectiveBindingOf(conv: Parameters<typeof bindingInput>[0]): {
    effectiveBinding: (ResolvedBinding & { supportsImages: boolean | null }) | null
    bindingError?: string
  } {
    try {
      const binding = bindingResolver().resolveStatic(bindingInput(conv))
      return { effectiveBinding: { ...binding, supportsImages: modelSupportsImages(binding) } }
    } catch (err) {
      if (err instanceof BindingUnavailableError) return { effectiveBinding: null, bindingError: err.code }
      return { effectiveBinding: null }
    }
  }

  /** The done frame's conversation payload: occupancy sized for the effective pair, and that pair. */
  function doneConversationPayload(id: string) {
    const conv = chatService.get(id)!
    const { effectiveBinding } = effectiveBindingOf(conv)
    return { ...occupancyFrame(chatService.withContext(conv, effectiveBinding)), effectiveBinding }
  }

  // ─── Privacy ingress (D6) ───────────────────────

  function providerLocality(privacy: ChatInboundPrivacy, providerId: string): Locality {
    let provider: ReturnType<ModelGateway['getProvider']>
    try {
      provider = gateway.getProvider(providerId)
    } catch {
      provider = undefined
    }
    return privacy.service.localityOf(provider ?? null)
  }

  /**
   * Where a new message goes, for the ingress check — decided without triage
   * and without writing anything. God Mode: every roster participant (none
   * known → unknown → remote). Otherwise the pair the turn will run on: a
   * one-turn override, a pinned or inherited pair. An Auto conversation picks
   * its model per message after this check, so any tier may answer → remote;
   * a pair that cannot be resolved → remote.
   */
  function messageLocalities(
    privacy: ChatInboundPrivacy,
    conv: BindingConversationRow,
    request: ModelPair | null,
    godParticipants: ReadonlyArray<ModelPair> | null,
  ): Locality[] {
    if (godParticipants) return godParticipants.map((p) => providerLocality(privacy, p.providerId))
    let binding: ResolvedBinding
    try {
      binding = bindingResolver().resolveStatic(bindingInput(conv, { request }))
    } catch {
      return ['remote']
    }
    if (binding.source === 'auto') return ['remote']
    // Only a switched-off Auto-routing makes an Auto conversation's model
    // known in advance (its stored pair); any other fallback may still route.
    if (conv.modelBinding === 'auto' && !request && binding.note !== 'auto-routing-disabled') return ['remote']
    return [providerLocality(privacy, binding.providerId)]
  }

  function emitInbound(privacy: ChatInboundPrivacy, event: string, payload: PrivacyInboundEvent): void {
    try {
      privacy.emit?.(event, payload)
    } catch (err) {
      logger?.warn({ err: err instanceof Error ? err.message : String(err), event }, 'Privacy: inbound event not emitted')
    }
  }


  /**
   * Answer a skill proposal. Three buttons, no typing: accept, decline for
   * this conversation, or disable the skill globally. Disable records a
   * decline here and flips the skill off so it will not match again —
   * "Not this time" stays per-conversation. The client re-sends the turn
   * with `resume: true` afterwards — the user's message is already stored,
   * so the re-run must not add it again.
   */
  router.post('/api/v1/conversations/:id/skill-decision', requirePermission('update', 'Conversation'), async (c: any) => {
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => ({}))
    const parsed = z.object({
      skillId: z.string().min(1),
      accept: z.boolean(),
      disable: z.boolean().optional(),
    }).safeParse(body)
    if (!parsed.success) {
      throw new HTTPException(400, { message: 'skillId and accept are required' })
    }
    const { skillId, accept, disable } = parsed.data
    if (accept && disable) {
      throw new HTTPException(400, { message: 'cannot accept and disable the same skill' })
    }
    if (!skillDecisions) {
      throw new HTTPException(503, { message: 'Skill decisions cannot be recorded on this instance' })
    }
    if (!chatService.get(id)) throw new HTTPException(404, { message: 'Conversation not found' })
    if (disable) {
      const ability = c.get('ability') as { can(action: string, subject: string): boolean } | undefined
      if (!ability?.can('update', 'Skill')) {
        throw new HTTPException(403, { message: 'Forbidden: cannot update Skill' })
      }
    }
    const decision = accept ? 'accepted' : 'declined'
    skillDecisions.set(id, skillId, decision)
    let disabled = false
    if (disable) {
      const setEnabled = getSkills?.()?.loader.setEnabled
      if (setEnabled) {
        setEnabled(skillId, false, 'proposal', (c.get('userId') as string | undefined) ?? 'user')
        disabled = true
      }
    }
    return c.json({ skillId, decision, ...(disable ? { disabled } : {}) })
  })

  router.post('/api/v1/conversations/:id/cancel', requirePermission('update', 'Conversation'), async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    const id = c.req.param('id')
    const conv = chatService.get(id)
    if (!conv || conv.userId !== userId) throw new HTTPException(404, { message: 'Conversation not found' })
    const cancelled = cancelConversationRun(id)
    if (cancelled) {
      try { chatService.update(id, { status: 'idle' }) } catch { /* status is cosmetic here */ }
    }
    return c.json({ cancelled })
  })

  router.post('/api/v1/conversations/:id/plan-decision', requirePermission('update', 'Conversation'), async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    const id = c.req.param('id')
    const conv = chatService.get(id)
    if (!conv || conv.userId !== userId) throw new HTTPException(404, { message: 'Conversation not found' })
    const parsed = z.object({
      accept: z.boolean(),
      skip: z.boolean().optional(),
    }).safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) throw new HTTPException(400, { message: 'accept is required' })
    if (!peekPlan(id)) throw new HTTPException(404, { message: 'No plan waiting' })
    if (parsed.data.accept && !parsed.data.skip) {
      try { chatService.update(id, { status: 'idle' }) } catch { /* cosmetic */ }
      return c.json({ decision: 'accepted' })
    }
    dropPlan(id)
    try { chatService.update(id, { status: 'idle' }) } catch { /* cosmetic */ }
    return c.json({ decision: parsed.data.skip ? 'skipped' : 'rejected' })
  })

  /** Which skills this conversation has accepted — the "active skill" chip. */
  router.get('/api/v1/conversations/:id/skills', requirePermission('read', 'Conversation'), (c: any) => {
    return c.json({ accepted: skillDecisions?.accepted(c.req.param('id')) ?? [] })
  })

  // Host directory picker for working-folder assignment (server-local paths).
  router.get('/api/v1/filesystem/browse', requirePermission('update', 'Conversation'), (c: any) => {
    try {
      return c.json(listDirectories(c.req.query('path')))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new HTTPException(400, { message })
    }
  })

  // ─── List Conversations ─────────────────────────
  router.get('/api/v1/conversations', requirePermission('read', 'Conversation'), async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })

    // If parentId is specified, return children of that conversation.
    // Verify the parent belongs to the requesting user first (mirrors the
    // ownership guard on GET /:id) so sub-conversations can't be read via IDOR.
    const parentId = c.req.query('parentId')
    if (parentId) {
      const parent = chatService.get(parentId)
      if (!parent || parent.userId !== userId) throw new HTTPException(404, { message: 'Conversation not found' })
      const conversations = chatService.getChildren(parentId)
      return c.json({ conversations })
    }

    const status = c.req.query('status')
    const excludeArchived = c.req.query('active') === 'true'
    const conversations = chatService.list(userId, { status, excludeArchived })
    return c.json({ conversations })
  })

  // ─── Create Conversation ────────────────────────
  router.post('/api/v1/conversations', requirePermission('create', 'Conversation'), async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    const body = await c.req.json().catch(() => ({}))

    // The model binding (D3). A pair is stored only when the caller names an
    // enabled model of an active provider; otherwise nothing is stamped here
    // and the conversation fixes the install default on its first turn, so a
    // default changed in between is the one it gets — and keeps.
    const bindingBody = CreateBindingSchema.safeParse({
      modelBinding: body.modelBinding ?? undefined,
      providerId: body.providerId ?? undefined,
      modelId: body.modelId ?? undefined,
      effort: body.effort,
    })
    if (!bindingBody.success) {
      const field = Object.keys(bindingBody.error.flatten().fieldErrors)[0]
      throw new HTTPException(400, { message: field === 'effort' ? 'Invalid effort' : 'Invalid model binding' })
    }
    const requested = bindingBody.data
    const pair: ModelPair | null = requested.providerId && requested.modelId &&
      bindingResolver().isSelectable({ providerId: requested.providerId, modelId: requested.modelId })
      ? { providerId: requested.providerId, modelId: requested.modelId }
      : null
    // Agent-bound (explicitly, or by the project's default colleague):
    // without a pair or an explicit mode it follows its colleague's model.
    const boundAgentId: string | null = body.agentId ||
      getBoard?.()?.projects.getWithStages(body.projectId || 'general-general')?.defaultAgentId || null
    const agentBound = !!boundAgentId
    if (requested.modelBinding === 'inherit' && !agentBound) {
      return bindingErrorResponse(c, new BindingUnavailableError('binding_inherit_needs_agent'))
    }
    const modelBinding: ModelBindingMode = requested.modelBinding ?? (pair ? 'pinned' : agentBound ? 'inherit' : 'pinned')
    // A starting effort must fit the model the conversation will run on;
    // checked before the row exists, so a rejection leaves nothing behind.
    const rejectedEffort = effortRejection(c, {
      modelBinding,
      providerId: pair?.providerId ?? null,
      modelId: pair?.modelId ?? null,
      agentId: boundAgentId,
      parentConversationId: null,
    }, requested.effort)
    if (rejectedEffort) return rejectedEffort
    // Folders sent with the request are validated before the row exists, so
    // a refused folder (400 {error, code, path}) leaves nothing behind. A
    // conversation workspace is a folder only when the caller owns that
    // conversation (otherWorkspace otherwise).
    const requestedFolders = body.workingDirectories === undefined ? null : checkWorkingDirectoriesBody(body.workingDirectories, {
      mayUseWorkspace: conversationWorkspaceAccess(null, userId, (cid, uid) => chatService.ownsConversation(cid, uid)),
    })
    if (requestedFolders && !requestedFolders.ok) return c.json(requestedFolders.body, 400)
    const conversation = chatService.create({
      userId,
      title: body.title,
      providerId: pair?.providerId,
      modelId: pair?.modelId,
      modelBinding,
    })

    // Auto-assign to project (default: general-general) and first open stage
    const projectId = body.projectId || 'general-general'
    const updateFields: Record<string, unknown> = { projectId }
    if (requested.effort) updateFields.effort = requested.effort

    // Resolve stage, agent, and code-search pin from project
    const board = getBoard?.()
    if (board) {
      const project = board.projects.getWithStages(projectId) as any
      if (project) {
        // Stage: use provided stageId, or first non-closed stage
        if (body.stageId) {
          updateFields.stageId = body.stageId
        } else if (project.stages.length) {
          const firstOpen = project.stages.find((s: any) => !s.isClosed) ?? project.stages[0]
          if (firstOpen) updateFields.stageId = firstOpen.id
        }
        // Agent: inherit from project default
        if (!body.agentId && project.defaultAgentId) {
          updateFields.agentId = project.defaultAgentId
        }
        // Code sources pin: project.indexedSources → conversation.searchContext
        if (body.searchContext === undefined) {
          const ids = project.indexedSources as string[] | null | undefined
          updateFields.searchContext = ids?.length ? { sourceIds: [...ids] } : null
        } else {
          updateFields.searchContext = body.searchContext
        }
        // Working directories: project list → conversation (first = primary
        // cwd). With neither, the conversation's own workspace is assigned
        // below, whatever the project.
        if (body.workingDirectories === undefined) {
          const pinned = pinWorkingDirectoriesFromProject(project, board.projectTypes)
          if (pinned?.length) updateFields.workingDirectories = pinned
        } else if (requestedFolders?.ok) {
          updateFields.workingDirectories = requestedFolders.stored
        }
        // Designs: the project's are copied onto the conversation, same shape
        // and same moment as the two above — at creation, once.
        try {
          getDesigns?.()?.adoptProjectDesigns(conversation.id, projectId)
        } catch {
          // A design copy failing must not block the project assignment.
        }
      }
    } else if (body.stageId) {
      updateFields.stageId = body.stageId
    }
    if (body.agentId) updateFields.agentId = body.agentId
    if (body.searchContext !== undefined && updateFields.searchContext === undefined) {
      updateFields.searchContext = body.searchContext
    }
    if (requestedFolders?.ok && updateFields.workingDirectories === undefined) {
      updateFields.workingDirectories = requestedFolders.stored
    }
    // Every conversation works in a folder. With no Folders from the request
    // or the project it gets its own EYAS workspace — otherwise the agent
    // chooses, and it chooses /tmp and the Desktop.
    if (parseWorkingDirectories(updateFields.workingDirectories).length === 0) {
      updateFields.workingDirectories = ownWorkspaceFolders(conversation.id)
    }

    chatService.update(conversation.id, updateFields)

    return c.json(chatService.get(conversation.id) ?? conversation, 201)
  })

  // ─── Get Conversation with Messages ─────────────
  router.get('/api/v1/conversations/:id', requirePermission('read', 'Conversation'), async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    const conv = chatService.get(c.req.param('id'))
    if (!conv || conv.userId !== userId) throw new HTTPException(404, { message: 'Conversation not found' })
    // effectiveBinding: the pair the next turn runs on and why (model/binding.ts).
    // autoRoutingEnabled: the global switch, so the model picker can offer
    // Auto-routing (or say why not) to a user who cannot read Settings.
    const { effectiveBinding, bindingError } = effectiveBindingOf(conv)
    let autoRoutingEnabled = false
    try { autoRoutingEnabled = bindingResolver().autoRoutingEnabled() } catch { autoRoutingEnabled = false }
    return c.json({
      ...chatService.withContext(conv, effectiveBinding),
      effectiveBinding,
      ...(bindingError ? { bindingError } : {}),
      autoRoutingEnabled,
    })
  })

  // ─── Effort options ─────────────────────────────
  // What the conversation's effort select offers: the rungs of the model its
  // next turn runs on (the same target write-time validation judges against,
  // effort-target.ts), the Auto-routing tier union for an Auto conversation,
  // plus the stored rung and what Auto resolves to here (Deep, the
  // colleague's effort, the nearest delegating conversation's) — the
  // chat route's own precedence (effort-intent.ts), minus the stored rung.
  router.get('/api/v1/conversations/:id/effort-options', requirePermission('read', 'Conversation'), (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    const conv = chatService.get(c.req.param('id'))
    if (!conv || conv.userId !== userId) throw new HTTPException(404, { message: 'Conversation not found' })

    const target = effortTargetFor({ conversation: conv, agent: bindingInput(conv).agent }, bindingResolver())
    const registry = getReasoningRegistry?.()
    const options = describeEffortOptions({
      getCapability: (providerId, modelId) => {
        if (!registry) throw new Error('no reasoning registry')
        return registry.get(providerId, modelId)
      },
      getTiers: () => (effortDb ? readTiers(effortDb as unknown as { all(query: unknown): unknown[] }) : []),
      modelName: (providerId, modelId) => configService?.listModels(providerId).find((m) => m.modelId === modelId)?.name ?? null,
      catalogVersion: (registry as { overlayVersion?: number } | undefined)?.overlayVersion,
    }, target.mode === 'pinned' ? target : { mode: 'auto' })

    // The agent a turn speaks as: the conversation's own, else its project's default.
    let agentId: string | null = conv.agentId ?? null
    if (!agentId) {
      try {
        agentId = getBoard?.()?.projects.getWithStages((conv as any).projectId ?? '')?.defaultAgentId ?? null
      } catch {
        agentId = null
      }
    }
    const inherited = loadEffortIntent(
      { db: effortDb, getAgent: (id) => getAgentRegistry?.()?.get(id) },
      conv.id,
      {
        agentId,
        self: {
          effort: null,
          orchestration: (conv as any).orchestration ?? 'auto',
          parentConversationId: conv.parentConversationId ?? null,
        },
      },
    )
    const body: ConversationEffortOptions = {
      ...options,
      current: normalizeEffortSetting((conv as any).effort) ?? null,
      inherited: inherited ?? null,
    }
    return c.json(body)
  })

  // ─── Update Conversation ────────────────────────
  router.patch('/api/v1/conversations/:id', requirePermission('update', 'Conversation'), async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    const id = c.req.param('id')
    const conv = chatService.get(id)
    if (!conv || conv.userId !== userId) throw new HTTPException(404, { message: 'Conversation not found' })
    const body = await c.req.json()
    const parsed = PatchConversationSchema.safeParse(body)
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>
      const field = Object.keys(fieldErrors)[0] ?? 'status'
      throw new HTTPException(400, { message: `Invalid ${field}: ${fieldErrors[field]?.join(', ') ?? 'validation failed'}` })
    }
    // teamSessionId is system-managed (stamped by teamSessionService.create() /
    // the orchestrator only) — strip any client-supplied value so a PATCH can't
    // forge a team-session association. totalCostUsd is likewise system-managed
    // (Task 9's cost producer) — a client PATCH must not be able to forge cost.
    delete body.teamSessionId
    delete body.totalCostUsd
    // modelUserChosen is set below, from the pair itself — never from the client.
    delete body.modelUserChosen

    // The model binding (D3). A pair is both ids of an enabled model on an
    // active provider; sending one fixes the conversation to it unless the
    // same PATCH names another mode, and marks it as the user's choice (the
    // model picker): unavailable later, the turn fails instead of answering
    // with another model. 'pinned' needs a pair (sent or stored); 'inherit'
    // only exists for a colleague's conversation or a sub-conversation — an
    // agentless conversation always shows a real model.
    {
      const { providerId, modelId, modelBinding } = parsed.data
      if ((providerId === undefined) !== (modelId === undefined)) {
        throw new HTTPException(400, { message: 'providerId and modelId must be sent together' })
      }
      const pair: ModelPair | null = providerId && modelId ? { providerId, modelId } : null
      if (pair && !bindingResolver().isSelectable(pair)) {
        return bindingErrorResponse(c, new BindingUnavailableError('model_binding_unavailable', pair))
      }
      const mode: ModelBindingMode | undefined = modelBinding ?? (pair ? 'pinned' : undefined)
      if (mode === 'pinned' && !pair && !(conv.providerId && conv.modelId)) {
        throw new HTTPException(400, { message: 'A fixed model needs providerId and modelId' })
      }
      if (mode === 'inherit') {
        const agentId = body.agentId === undefined ? conv.agentId : body.agentId
        if (!agentId && !conv.parentConversationId) {
          return bindingErrorResponse(c, new BindingUnavailableError('binding_inherit_needs_agent'))
        }
      }
      if (mode) body.modelBinding = mode
      else delete body.modelBinding
      if (pair) body.modelUserChosen = true
    }

    // Reasoning effort: a ladder rung ('auto' / null = Auto, stored as NULL)
    // the conversation's model accepts — judged against the model it runs on
    // after this PATCH. The legacy thinking fields are never written (the
    // boot migration folded them into effort).
    delete body.thinking
    delete body.thinkingBudget
    if (parsed.data.effort === undefined) {
      delete body.effort
    } else {
      body.effort = parsed.data.effort
      const rejectedEffort = effortRejection(c, {
        modelBinding: (body.modelBinding as ModelBindingMode | undefined) ?? conv.modelBinding,
        providerId: parsed.data.providerId ?? conv.providerId,
        modelId: parsed.data.modelId ?? conv.modelId,
        agentId: body.agentId === undefined ? conv.agentId : (body.agentId || null),
        parentConversationId: conv.parentConversationId,
      }, parsed.data.effort)
      if (rejectedEffort) return rejectedEffort
    }

    // When the project changes (and the client did not send an explicit
    // searchContext), adopt the project's default code-source pin.
    if (
      body.projectId !== undefined &&
      body.projectId !== conv.projectId &&
      body.searchContext === undefined
    ) {
      const board = getBoard?.()
      const project = body.projectId
        ? (board?.projects as any)?.get?.(body.projectId)
          ?? (board?.projects as any)?.getWithStages?.(body.projectId)
        : null
      const ids = project?.indexedSources as string[] | null | undefined
      body.searchContext = ids?.length ? { sourceIds: [...ids] } : null
    }

    // Project change always adopts the new project's working directories
    // unless the same PATCH sends an explicit list.
    if (
      body.projectId !== undefined &&
      body.projectId !== conv.projectId &&
      body.workingDirectories === undefined
    ) {
      const board = getBoard?.()
      const project = body.projectId
        ? (board?.projects as any)?.get?.(body.projectId)
          ?? (board?.projects as any)?.getWithStages?.(body.projectId)
        : null
      body.workingDirectories = pinWorkingDirectoriesFromProject(project, board?.projectTypes)
    } else if (body.workingDirectories !== undefined) {
      // Its own workspace, or one of the caller's own conversations' — never
      // another user's (otherWorkspace), as written or through a symlink.
      const folders = checkWorkingDirectoriesBody(body.workingDirectories, {
        mayUseWorkspace: conversationWorkspaceAccess(id, userId, (cid, uid) => chatService.ownsConversation(cid, uid)),
      })
      if (!folders.ok) return c.json(folders.body, 400)
      body.workingDirectories = folders.stored
    }

    chatService.update(id, body)
    return c.json(chatService.get(id))
  })

  // ─── Soft Delete ────────────────────────────────
  router.delete('/api/v1/conversations/:id', requirePermission('delete', 'Conversation'), async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    const id = c.req.param('id')
    const conv = chatService.get(id)
    if (!conv || conv.userId !== userId) throw new HTTPException(404, { message: 'Conversation not found' })
    chatService.softDelete(id)
    return c.json({ message: 'Conversation deleted' })
  })

  // ─── Send Message + Stream Response ─────────────
  router.post('/api/v1/conversations/:id/messages', requirePermission('create', 'ConversationMessage'), async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })

    const id = c.req.param('id')
    const conv = chatService.get(id)
    if (!conv || conv.userId !== userId) throw new HTTPException(404, { message: 'Conversation not found' })

    let body: any
    try {
      body = await c.req.json()
    } catch {
      throw new HTTPException(400, { message: 'Invalid JSON body' })
    }
    const attachmentIds: string[] = Array.isArray(body.attachmentIds) ? body.attachmentIds : []
    // A resume carries no new content on purpose: it re-runs a turn whose
    // message is already stored, after a skill proposal stopped it.
    if (!body.resume && !body.content && attachmentIds.length === 0) {
      throw new HTTPException(400, { message: 'content or attachmentIds required' })
    }

    // Privacy ingress (D6): a NEW message carrying a block-class value (the
    // policy's 'block' types) bound for a remote model is refused here, before
    // anything is written or started — no message row (so no L0 capture), no
    // workspace, no triage, no title, no God Mode race, no model call. The
    // client offers to re-send it with `privacy: 'mask'`: then exactly the
    // block-class values are masked and the masked text is what is stored and
    // sent. A resume re-runs a message that was checked and stored already.
    const privacyMode = MessagePrivacySchema.safeParse(body.privacy ?? undefined)
    if (!privacyMode.success) throw new HTTPException(400, { message: 'privacy must be "mask" when set' })
    const inboundPrivacy = !body.resume && typeof body.content === 'string' && body.content
      ? getInboundPrivacy?.()
      : undefined
    if (inboundPrivacy) {
      const godDeps = getGodMode?.()
      const godRace = !!conv.godMode && godDeps?.enabled !== false
      const early = TurnOverrideSchema.safeParse({ provider: body.provider ?? undefined, model: body.model ?? undefined })
      const request = early.success && early.data.provider && early.data.model
        ? { providerId: early.data.provider, modelId: early.data.model }
        : null
      let godParticipants: ReadonlyArray<ModelPair> | null = null
      if (godRace) {
        try { godParticipants = godDeps?.participants?.() ?? [] } catch { godParticipants = [] }
      }
      const checked = preflightUserText({
        privacy: inboundPrivacy.service,
        text: body.content,
        localities: messageLocalities(inboundPrivacy, conv, request, godParticipants),
        mode: privacyMode.data,
      })
      if (!checked.ok) {
        emitInbound(inboundPrivacy, PRIVACY_INBOUND_REFUSED_EVENT, {
          targetId: id, conversationId: id, source: 'chat', types: checked.types, userId, godMode: godRace,
        })
        return c.json(privacyRefusalBody(privacyRefusal(checked.types), checked.maskedText), 422)
      }
      if (checked.maskedTypes.length > 0) {
        body.content = checked.text
        emitInbound(inboundPrivacy, PRIVACY_INBOUND_MASKED_EVENT, {
          targetId: id, conversationId: id, source: 'chat', types: checked.maskedTypes, userId, godMode: godRace,
        })
      }
    }

    // A conversation created before every conversation got a workspace, or
    // one whose Folders were cleared, gets its own EYAS workspace now — the
    // model must never work in a folder it picked itself.
    if (parseWorkingDirectories(conv.workingDirectories).length === 0) {
      const own = ownWorkspaceFolders(id)
      if (own) {
        chatService.update(id, { workingDirectories: own })
        conv.workingDirectories = own
      }
    }

    // Resolve documents service lazily (may have started after conversations)
    const documents = getDocuments?.()

    // Link attachments to conversation via documents service
    if (documents && attachmentIds.length > 0) {
      for (const docId of attachmentIds) {
        try { documents.link(docId, 'conversations', id, 'user') } catch { /* ignore if already linked */ }
      }
    }

    // God Mode must not depend on the parent's solo provider/model being live.
    const god = getGodMode?.()
    if (conv.godMode && god?.enabled !== false) {
      const userMessage = chatService.addMessage(id, {
        role: 'user',
        content: body.content || '',
        attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
        // The owner typed it: the only author memory trusts as 'owner'.
        author: 'owner',
        entryPath: 'interactive',
      })
      chatService.update(id, { status: 'working' })
      const fullConv = chatService.get(id)!
      return startGodModeTurn({
        c,
        chatService,
        conversationId: id,
        userMessageId: userMessage.id,
        userText: typeof body.content === 'string' ? body.content : '',
        fullConv,
        god,
      })
    }

    // The turn's model (D3, model/binding.ts): a one-turn override, the
    // conversation's own pair, Auto-routing (only when the conversation is
    // set to Auto), or its colleague's pair. Resolved before anything is
    // stored, so a model that cannot be served costs nothing.
    const override = TurnOverrideSchema.safeParse({
      provider: body.provider ?? undefined,
      model: body.model ?? undefined,
    })
    if (!override.success) throw new HTTPException(400, { message: 'provider and model must be sent together' })
    let binding: ResolvedBinding
    try {
      binding = await bindingResolver().resolve(bindingInput(conv, {
        request: override.data.provider && override.data.model
          ? { providerId: override.data.provider, modelId: override.data.model }
          : null,
        text: typeof body.content === 'string' ? body.content : '',
      }))
    } catch (err) {
      if (err instanceof BindingUnavailableError) return bindingErrorResponse(c, err)
      throw err
    }
    // A conversation without a pair keeps the default it runs on now. The
    // guarded write settles two concurrent first turns on one pair.
    if (binding.materialize) {
      const fixed = chatService.materializeBinding(id, binding.providerId, binding.modelId)
      const { materialize: _fixedNow, ...rest } = binding
      binding = fixed ? { ...rest, ...fixed } : rest
    }
    const providerId = binding.providerId
    const modelId = binding.modelId
    // Set ONLY when Auto-routing picked the provider — it is the gateway's
    // licence to fail over to the tier's fallback provider (D10). A fixed or
    // colleague's model stays unstamped and is never swapped.
    const routedTier: RoutingTier | undefined = binding.source === 'auto' ? binding.tier : undefined

    // Save user message with attachments. A resume re-runs a turn whose
    // message is already stored — a skill proposal stopped it before the model
    // was called — so storing it again would duplicate it in the transcript.
    if (!body.resume) {
      chatService.addMessage(id, {
        role: 'user',
        content: body.content || '',
        attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
        author: 'owner',
        entryPath: 'interactive',
      })
      if (body.plan !== true) dropPlan(id)
    }
    chatService.update(id, { status: 'working' })
    const runSignal = beginConversationRun(id)

    // Build message history with multimodal content for attachments
    const fullConv = chatService.get(id)!

    // First-turn title: if still Untitled / Névtelen, name it from this request.
    // Persist the snippet immediately so a dropped stream still leaves a name;
    // the background model may refine it without blocking the turn.
    const userText = typeof body.content === 'string' ? body.content : ''
    const fallbackTitle = planAutoTitle(fullConv.title, userText)
    let refineTitle: Promise<string> | null = null
    if (fallbackTitle) {
      try { chatService.update(id, { title: fallbackTitle }) } catch { /* non-fatal */ }
      refineTitle = generateConversationTitle({ aux: getAuxiliaryModel?.(), userMessage: userText, conversationId: id })
    }

    const messages: Array<{ role: 'user' | 'assistant'; content: string | ContentBlock[] }> = []
    for (const m of fullConv.messages) {
      if (m.attachmentIds.length === 0 || !documents) {
        // Skip messages with empty content (Anthropic rejects empty text blocks with cache_control)
        if (m.content) {
          messages.push({ role: m.role as 'user' | 'assistant', content: m.content })
        }
        continue
      }

      // Build multimodal content blocks
      const blocks: ContentBlock[] = []

      for (const docId of m.attachmentIds) {
        const doc = documents.getById(docId)
        if (doc && doc.mimeType.startsWith('image/')) {
          try {
            const result = await documents.download(docId)
            if (result) {
              const chunks: Uint8Array[] = []
              const reader = result.data.getReader()
              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                if (value) chunks.push(value)
              }
              const buffer = Buffer.concat(chunks)
              blocks.push({
                type: 'image',
                source: { type: 'base64', mediaType: doc.mimeType, data: buffer.toString('base64') },
              })
            }
          } catch { /* skip unreadable attachments */ }
        }
      }

      if (m.content) {
        blocks.push({ type: 'text', text: m.content })
      }

      // Only push if we have actual content blocks (skip empty messages)
      if (blocks.length > 0) {
        messages.push({
          role: m.role as 'user' | 'assistant',
          content: blocks,
        })
      }
    }

    // Merge consecutive same-role messages (Anthropic requires alternating user/assistant)
    // Also filter out empty text blocks (Anthropic rejects cache_control on empty text)
    const mergedMessages: typeof messages = []
    for (const msg of messages) {
      const prev = mergedMessages[mergedMessages.length - 1]
      if (prev && prev.role === msg.role) {
        const prevBlocks: ContentBlock[] = typeof prev.content === 'string'
          ? [{ type: 'text', text: prev.content }]
          : prev.content
        const currBlocks: ContentBlock[] = typeof msg.content === 'string'
          ? [{ type: 'text', text: msg.content }]
          : msg.content
        prev.content = [...prevBlocks, ...currBlocks]
      } else {
        mergedMessages.push({ ...msg })
      }
    }
    // Strip empty text blocks from all messages
    for (const msg of mergedMessages) {
      if (Array.isArray(msg.content)) {
        msg.content = (msg.content as ContentBlock[]).filter(
          (b) => b.type !== 'text' || (b as any).text?.trim()
        )
        // If all blocks were empty, add a placeholder
        if (msg.content.length === 0) {
          msg.content = '...'
        }
      }
    }

    // Images the turn's model cannot see — its catalog row says it takes no
    // image input (a text-only model, a CLI that does not accept images) —
    // become a text stub at their place, so the model knows an image was
    // there, and the user gets a notice once the turn starts. A model with no
    // catalog row gets them as they are; its provider decides.
    const imageGate = modelSupportsImages(binding) === false
      ? stubUnsupportedImages(mergedMessages)
      : { messages: mergedMessages, count: 0 }
    const turnMessages = imageGate.messages

    // Stamped before the model runs: anything in the workspace newer than this
    // is what this turn produced.
    const turnStartedMs = Date.now()

    // Resolve agent runner and tools (lazy — may not be available yet)
    const agentRunner = getAgentRunner?.()
    const toolRegistry = getToolRegistry?.()

    // The agent this turn speaks as: the conversation's own, else its
    // project's default — the same one the prompt is assembled for.
    const projectDefaultAgentId = (): string | null =>
      getBoard?.()?.projects.getWithStages((conv as any).projectId ?? '')?.defaultAgentId ?? null
    let turnAgentId: string | null = null
    let turnAgent: { tools?: readonly string[] | null; maxTurns?: number | null } | undefined
    try {
      turnAgentId = (conv as any).agentId ?? projectDefaultAgentId()
      turnAgent = turnAgentId ? getAgentRegistry?.()?.get(turnAgentId) : undefined
    } catch {
      turnAgent = undefined
    }
    const turnAgentTools = turnAgent?.tools
    // The turn budget (model round trips): the agent's own Max turns, else
    // the default every provider shares (shared/turn-budget.ts).
    const maxTurns = resolveMaxTurns(turnAgent?.maxTurns)
    // The tool scope every EYAS run path applies (agent/tool-scope.ts): the
    // agent's allowlist plus the memory tools (all tools with no agent or an
    // empty list), minus the delegation family in Solo mode.
    const tools: ToolDefinition[] = scopedToolDefinitions(
      toolRegistry,
      resolveToolScope({ agentTools: turnAgentTools, orchestration: (conv as any).orchestration ?? null }),
      { agentId: turnAgentId, logger },
    )

    // Build system prompt via PromptAssembler (Task 29 wiring).
    // body.system still wins; otherwise assemble from the conversation's agent.
    // Either way the assembler builds the turn block: the clock and what EYAS
    // recalled for this message, attached to the message below.
    const resolved = await resolveConversationSystemPrompt({
      bodySystem: body.system,
      assembler: getAssembler?.(),
      agentId: (conv as any).agentId ?? null,
      projectId: (conv as any).projectId ?? null,
      conversationId: id,
      fallbackAgentId: projectDefaultAgentId,
      // I7: size the prompt for the model this turn runs on (the D3 binding).
      target: { providerId, modelId },
      // Recall's query starts from this message (empty on a resume: the
      // last stored user message).
      turnText: userText,
    })
    let system = resolved.system
    // Manifest of everything appended to `system` over the course of this turn
    // (assembler sections + every ad-hoc append below). Handed to the recorder
    // in Task 10 — kept in the enclosing scope so both the agentRunner branch
    // and the no-tools fallback branch below can see it.
    const contextSections: ContextSection[] = [...resolved.sections]
    const appendSection = (key: string, content: string, sourceRef?: string): void => {
      contextSections.push({
        zone: 'append',
        key,
        sourceRef,
        content,
        chars: content.length,
        estimatedTokens: estimateTokens(content),
        truncated: false,
        droppedChars: 0,
      })
    }

    // Skill injection — match conversation messages against skill trigger patterns
    // Check all user messages (not just current) so the skill stays active throughout
    // A matched skill is a PROPOSAL until someone accepts it. It used to be
    // injected silently, which is how google-drive-integration ended up in a
    // "what time is it" conversation with nobody able to see it.
    let pendingSkill: SkillMatchSummary | null = null
    let activeSkill = false
    try {
      const skillsService = getSkills?.()
      if (skillsService) {
        // D-7 / P-19 — a skill whose imported asset held a credential never
        // reaches the matcher unless the owner opened
        // `memory.recall.includeSecrets`. The accessor is the skills service's
        // own, so this call site and POST /skills/match read one flag.
        const enabledSkills = recallableSkills(
          skillsService.loader.list(true),
          skillsService.recall?.().includeSecrets ?? false,
        )
        // Combine all user messages for matching
        const allUserText = conv.messages
          .filter((m: any) => m.role === 'user')
          .map((m: any) => m.content)
          .join(' ')
        const combinedText = `${allUserText} ${body.content || ''}`
        const matches = skillsService.matcher.match(combinedText, enabledSkills, 1)
        const top = matches.length > 0 && matches[0].matchScore > 0.1 ? matches[0] : null
        const summary: SkillMatchSummary | null = top
          ? {
              skillId: top.skill.id,
              name: top.skill.name,
              score: top.matchScore,
              matchedPattern: (top as any).matchedPattern ?? 'match',
              containsSecrets: (top.skill.capabilities ?? []).includes(SECRETS_TAG),
            }
          : null
        const outcome = resolveSkillForTurn({
          match: summary,
          decision: summary && skillDecisions ? skillDecisions.get(id, summary.skillId) : null,
          canAsk: Boolean(skillDecisions),
        })
        if (outcome.action === 'propose') pendingSkill = outcome.match
        if (outcome.action === 'apply') {
          activeSkill = true
          const skillBlock = `## Active Skill: ${matches[0].skill.name}\n\n${matches[0].skill.content}`
          system = system ? `${system}\n\n${skillBlock}` : skillBlock
          appendSection('skill', skillBlock, matches[0].skill.id)
        }
      }
    } catch {
      // Skill matching failure is non-fatal
    }

    // Designs attached to this conversation. A project's designs were copied
    // onto it when it joined the project, so there is nothing to resolve here.
    // Per-turn rather than a
    // cache-prefix section: the reference belongs to the conversation, not to
    // every turn of every agent, and the prefix budget is fully allocated.
    // The key is 'design-context', NOT 'skill' — the recorder derives
    // skills.use_count from that key.
    try {
      const designService = getDesigns?.()
      if (designService) {
        const { buildDesignContext, DESIGN_SECTION_KEY } = await import('@modules/design/design-context.js')
        const designBlock = buildDesignContext(designService, id)
        if (designBlock) {
          system = system ? `${system}\n\n${designBlock.content}` : designBlock.content
          appendSection(DESIGN_SECTION_KEY, designBlock.content, designBlock.designIds.join(','))
        }
      }
    } catch {
      // A design reference failing must not cost the turn its answer.
    }

    if (body.resume) {
      const parked = takePlan(id)
      if (parked) {
        const planBlock = planToSystemSection(parked)
        if (planBlock) {
          system = system ? `${system}\n\n${planBlock}` : planBlock
          appendSection('plan', planBlock, parked.id)
        }
      }
    }

    // A skill used to empty the tool list here — "skills are pure conversation,
    // no tool use". Removed, and not narrowed to one skill type either.
    //
    // What it cost: a "make an HTML page showing the time" request matched the
    // google-drive-integration skill at score 0.9, and every tool vanished.
    // `design_read` was named in the prompt and in the tool inventory, and was
    // not callable — so the agent read a stale file off disk and produced the
    // wrong design. No skill type justifies the rule. An `integration` skill
    // exists precisely to be used WITH tools; a `tool` skill IS one; and a
    // `knowledge` skill is reference material, which is no reason an agent
    // should stop being able to read a file. Nothing tested it, and nothing
    // depended on it.
    //
    // The weak match that triggered it is a separate problem — a skill scoring
    // 0.9 on an unrelated request means the matcher needs work — but a bad
    // match should cost some wasted prompt, never every tool.
    void activeSkill

    // The turn's effort intent (effort-intent.ts: the conversation's own
    // level, else Max when Deep, else the effort of the agent the turn speaks
    // as, else the nearest delegating parent's) + orchestration mode. The
    // intent is resolved by the gateway per attempt, for the model that
    // answers; the reply records requested vs effective (TurnMeta.effort).
    const orchestrationMode = (((conv as any).orchestration ?? 'auto') as 'solo' | 'auto' | 'deep')
    const effortIntent = loadEffortIntent(
      { db: effortDb, getAgent: (agentId) => getAgentRegistry?.()?.get(agentId) },
      id,
      {
        agentId: turnAgentId,
        self: {
          effort: (conv as any).effort,
          orchestration: orchestrationMode,
          parentConversationId: (conv as any).parentConversationId ?? null,
        },
      },
    )
    const orchestrationDirective = buildOrchestrationDirective(orchestrationMode)
    if (orchestrationDirective) {
      system = system ? `${system}\n\n${orchestrationDirective}` : orchestrationDirective
      appendSection('orchestration-directive', orchestrationDirective, orchestrationMode)
    }

    // ── First-turn team auto-propose / soft nudge ──────────────────────────
    // Does not block the agent stream. Complex first messages (or deep mode)
    // fire analyzeAndPropose in the background → TeamProposalCard via WS.
    // User still must Approve. Solo orchestration is a hard no-op.
    {
      const messageText = body.content || ''
      const userMessageCount = fullConv.messages.filter((m: any) => m.role === 'user').length
      const complexity =
        ((conv as any).complexity as string | null | undefined) ||
        estimateMessageComplexity(messageText)

      // Persist triage complexity when the conversation has none yet.
      if (!(conv as any).complexity && complexity) {
        try {
          chatService.update(id, { complexity })
        } catch {
          /* non-fatal */
        }
      }

      const teamDeps = getTeamPropose?.()
      const hasActiveTeamSession = teamDeps
        ? teamDeps.teamSessions
            .listByConversation(id)
            .some((s) => isActiveTeamStatus(s.status))
        : !!(conv as any).teamSessionId

      const teamDecision = decideTeamAutoPropose({
        orchestration: orchestrationMode,
        userMessageCount,
        complexity,
        hasActiveTeamSession,
        message: messageText,
      })

      if (teamDecision.action === 'propose' && teamDeps) {
        void fireTeamProposal(teamDeps, id, messageText || 'User task', teamDecision.complexity)
        const inflight = buildTeamProposeInFlightDirective()
        system = system ? `${system}\n\n${inflight}` : inflight
        appendSection('team-nudge', inflight, id)
      } else if (teamDecision.action === 'nudge' || (teamDecision.action === 'propose' && !teamDeps)) {
        // Nudge path, or propose desired but agent module not ready → steer the model.
        const nudge = buildTeamNudgeDirective(teamDecision.complexity, teamDecision.reason)
        system = system ? `${system}\n\n${nudge}` : nudge
        appendSection('team-nudge', nudge, id)
      }
    }

    /**
     * What this turn produced, attached to its reply: files the agent wrote
     * in the workspace (a CLI provider writes with its own file tool, so there
     * is no write_file call to intercept), media jobs and studio renders. Run
     * once by the turn sink, BEFORE the reply is stored, so the artefact hangs
     * off the turn that produced it — visible in the stream and after a reload.
     */
    const collectTurnAttachments = async (): Promise<string[]> => {
      let producedIds: string[] = []
      const forOutputs = chatService.get(id)
      const workspace = parseWorkingDirectories(forOutputs?.workingDirectories)[0]
      const docs = getDocuments?.()
      if (workspace && docs) {
        try {
          const { collectWorkspaceOutputs, attachWorkspaceOutputs } = await import('./workspace-outputs.js')
          const outputs = await collectWorkspaceOutputs(workspace, turnStartedMs)
          if (outputs.length) {
            producedIds = await attachWorkspaceOutputs({ documents: docs as any }, id, outputs, userId)
          }
        } catch {
          // Surfacing an artefact must never cost the turn its answer.
        }
      }

      const media = getMedia?.()
      if (media?.listJobs) {
        try {
          const { collectMediaDocumentIds } = await import('@modules/media/turn-attach.js')
          const jobs = media.listJobs({ conversationId: id, since: turnStartedMs })
          producedIds = collectMediaDocumentIds(jobs, producedIds)
        } catch {
          // Attaching media must never cost the turn its answer.
        }
      }

      const studio = getStudio?.()
      if (studio?.listJobs) {
        try {
          const { collectStudioDocumentIds } = await import('@modules/studio/turn-attach.js')
          const jobs = studio.listJobs({ conversationId: id, since: turnStartedMs })
          producedIds = collectStudioDocumentIds(jobs, producedIds)
        } catch {
          // Attaching studio renders must never cost the turn its answer.
        }
      }
      return producedIds
    }

    /**
     * Post-turn memory: run once by the turn sink, after the reply is
     * delivered and only when it has text — never in the reply's critical
     * path, never throwing into the turn. The RAW project travels: capture
     * applies effectiveProjectId itself.
     */
    const capturePostTurnMemory = (assistantMessage: string): void => {
      const userContent = typeof body.content === 'string' ? body.content : ''
      try { memoryHooks?.onTurnComplete?.(id, userContent, assistantMessage) } catch { /* non-fatal */ }
      // A resume carries no `content` on purpose: its user message was stored
      // by the attempt a skill proposal stopped (see the `!body.resume` guard
      // above). Reading only the body gated those turns away as too-short —
      // and they are the substantive ones. The stored transcript is the same
      // source of truth the background runner reads. An attachment-only turn
      // stores an empty message and stays honestly empty: its substance is in
      // the attachment, not in text an extractor could read.
      let capturedUser = userContent
      if (!capturedUser.trim()) {
        const stored = chatService.get(id)?.messages ?? []
        for (let i = stored.length - 1; i >= 0; i--) {
          if (stored[i].role === 'user') { capturedUser = stored[i].content ?? ''; break }
        }
      }
      // The owner's own turn: the one entry every run path shares
      // (capture/run-end.ts), so the gate and the cap are the same everywhere.
      captureRunEnd(getMemoryCapture?.(), {
        conversationId: id,
        projectId: conv.projectId ?? null,
        userMessage: capturedUser,
        assistantMessage,
        author: 'owner',
        entryPath: 'interactive',
      })
    }

    // Continuity is EYAS replay only: every turn replays `turnMessages` from
    // EYAS's own store and no CLI provider resumes a session of its own. That
    // also keeps the Claude Code SDK's `total_cost_usd` per turn — it is only
    // session-cumulative on a resumed session, which no longer exists.

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        // A client that went away must not stop the turn: it still ends and
        // persists through the sink.
        const send = (data: string) => {
          try { controller.enqueue(encoder.encode(`data: ${data}\n\n`)) } catch { /* client gone */ }
        }

        // A skill is waiting on a human. Stop here: nothing has been streamed,
        // no assistant message exists, and the model has not been called. The
        // user's message stays stored — it was really sent — and the client
        // resumes with `resume: true` once the question is answered.
        if (pendingSkill) {
          endConversationRun(id, runSignal)
          try { chatService.update(id, { status: 'idle' }) } catch { /* status is cosmetic here */ }
          send(JSON.stringify({ type: 'skill_proposal', proposal: pendingSkill }))
          controller.close()
          return
        }

        if (body.plan === true && !body.resume) {
          try {
            const result = await generatePlan(
              { originalRequest: userText || '(attached files)' },
              {
                // The conversation's own model writes the plan, in one
                // isolated call: no tools, one turn, no tier (so no failover
                // to another provider). A plan runs nothing.
                complete: async ({ system, user }) => {
                  const response = await gateway.complete({
                    provider: providerId,
                    model: modelId,
                    system,
                    messages: [{ role: 'user', content: user }],
                    temperature: PLAN_TEMPERATURE,
                    isolated: true,
                    signal: runSignal,
                    metadata: { origin: 'interactive', conversationId: id, userId },
                  })
                  return { text: response.content.find((b) => b.type === 'text')?.text ?? '' }
                },
              },
            )
            if (runSignal.aborted) {
              endConversationRun(id, runSignal)
              try { chatService.update(id, { status: 'idle' }) } catch { /* cosmetic */ }
              send(JSON.stringify({ type: 'cancelled' }))
              controller.close()
              return
            }
            if (result.plan) {
              parkPlan(id, result.plan)
              endConversationRun(id, runSignal)
              chatService.update(id, { status: 'waiting_plan' })
              send(JSON.stringify({ type: 'plan_proposal', plan: result.plan }))
              controller.close()
              return
            }
          } catch {
            // Plan generation failed — run the turn without a plan.
          }
        }

        if (fallbackTitle) {
          send(JSON.stringify({ type: 'title', title: fallbackTitle }))
        }
        if (refineTitle) {
          void refineTitle.then((title) => {
            if (!title) return
            const latest = chatService.get(id)
            if (!latest) return
            const stillOurs = isUntitledTitle(latest.title) || latest.title === fallbackTitle
            if (!stillOurs) return
            if (title !== latest.title) {
              try { chatService.update(id, { title }) } catch { /* non-fatal */ }
            }
            try { send(JSON.stringify({ type: 'title', title })) } catch { /* stream already closed */ }
          })
        }
        // G7 — the ONE turn sink both branches feed. It maps every event to
        // its frame and ends the turn exactly once, whatever the outcome:
        // attachments, the reply (or the partial answer) with its TurnMeta,
        // status, cost, one terminal frame and the post-turn memory capture.
        // The turn's composition record (set once it is recorded below); the
        // sink reports the provider's measurements of the last model call to
        // it, before the done frame's occupancy is read.
        let compositionId: string | null = null
        const sink = createTurnSink({
          send: (frame) => send(JSON.stringify(frame)),
          chatService,
          conversationId: id,
          providerId,
          modelId,
          signal: runSignal,
          pricing: () => getPricingOverrides?.(),
          collectAttachments: collectTurnAttachments,
          memoryCapture: capturePostTurnMemory,
          conversationPayload: () => doneConversationPayload(id),
          observe: (observation) => getContextRecorder?.()?.observe?.(compositionId, observation),
          logger,
        })
        // Both branches end in one 'done' whose response carries the
        // gateway's effort outcome for the final call: the reply records it
        // (TurnMeta.effort, requested vs effective — a clamp is recorded as
        // clamped, never dropped).
        const feed = (event: Parameters<typeof sink.handle>[0]): void => {
          if (event.type === 'done') {
            const effort = turnEffortOf(event.response?.effortOutcome)
            if (effort) sink.annotate({ effort })
          }
          sink.handle(event)
        }
        try {
          // Task 10 — record what actually reached the model on this turn,
          // once, before the two invocation branches split. Both branches
          // stamp the returned id onto their request metadata so the trace
          // collector can correlate the ai_traces row back to this record.
          compositionId = getContextRecorder?.()?.record({
            sections: contextSections,
            entryPoint: resolved.entryPoint,
            conversationId: id,
            agentId: (conv as any).agentId ?? null,
            provider: providerId,
            model: modelId,
            assemblerError: resolved.assemblerError ?? null,
            ...deliveryRecordFields(resolved.delivery),
            // The replayed history this turn sends (the turn block is a section).
            historyEstimatedTokens: estimateMessagesTokens(turnMessages),
          }) ?? null

          // Arms the chat-rail agent progress panel, for every provider.
          sink.start({ agentId: turnAgentId, maxTurns, binding: toTurnBinding(binding) })
          // The images this model cannot see were stubbed above: said once,
          // under the turn, and recorded in its TurnMeta.
          if (imageGate.count > 0) sink.notice('imagesNotVisible', { providerId, modelId, count: imageGate.count })

          if (agentRunner) {
            // ── Full pipeline: tools + security gate (system prompt built by assembler above) ──
            const runOptions = {
              messages: turnMessages,
              tools,
              system: system || undefined,
              // I7: a tool-less model gets no tools; a resolved window goes out.
              delivery: resolved.delivery?.profile,
              // The clock and this message's recall: the runner attaches it
              // to the message it sends, never to the stored one.
              turn: resolved.turn,
              maxTurns,
              provider: providerId,
              model: modelId,
              effort: effortIntent,
              orchestration: orchestrationMode,
              conversationId: id,
              signal: runSignal,
              toolContext: {
                conversationId: id,
                userId,
                logger: undefined as any,
                teamSessionId: conv.teamSessionId ?? undefined,
                agentId: conv.agentId ?? undefined,
                projectId: effectiveProjectId((conv as any).projectId ?? (conv as any).project_id ?? null),
                ...toolWorkspaceFields(conv.workingDirectories),
                // The executor authorizes against this identity — forward the
                // real authenticated caller, not a fabricated one.
                actor: {
                  kind: 'user' as const,
                  role: (c.get('role') as string | undefined) ?? 'guest',
                  ability: c.get('ability') as { can(action: string, subject: string): boolean } | undefined,
                },
              },
              metadata: {
                conversationId: id,
                userId,
                agentId: conv.agentId ?? undefined,
                teamSessionId: conv.teamSessionId ?? undefined,
                // F0 R4 — a human is driving this conversation via the chat
                // route. teamSessionId (when present) still wins autonomous
                // classification, so do NOT add autonomous:false here.
                origin: 'interactive' as const,
                tier: routedTier,
                compositionId: compositionId ?? undefined,
              },
            }
            // The runner is the single outcome normalizer: one terminal
            // (done | cancelled | parked_for_approval) or a throw.
            for await (const event of agentRunner.run(runOptions)) feed(event)
          } else {
            // ── Fallback: direct gateway streaming (no tools) ──
            // The folder screen the runner applies (K2): a stored folder a
            // protection rule now refuses is left out, with a notice.
            const fallbackFolders = screenToolWorkspaceFields(toolWorkspaceFields(conv.workingDirectories), {
              mayUseWorkspace: conversationWorkspaceAccess(id, chatService.ownerOf(id), (cid, uid) => chatService.ownsConversation(cid, uid)),
            })
            for (const refused of fallbackFolders.refused) feed(folderRefusedNotice(refused))
            // Same turn block as the runner path: attached to the copy sent,
            // never to the stored user message.
            const streamRequest: any = {
              provider: providerId,
              model: modelId,
              messages: attachTurnContext(turnMessages, resolved.turn),
              // A provider with its own loop (a CLI) gets the same turn budget.
              maxTurns,
              effort: effortIntent,
              orchestration: orchestrationMode,
              metadata: {
                conversationId: id,
                userId,
                agentId: conv.agentId ?? undefined,
                teamSessionId: conv.teamSessionId ?? undefined,
                ...fallbackFolders.fields,
                // F0 R4 — same rationale as the full-pipeline branch above.
                origin: 'interactive' as const,
                tier: routedTier,
                compositionId: compositionId ?? undefined,
              },
            }
            if (system) streamRequest.system = system
            streamRequest.signal = runSignal

            for await (const event of gateway.stream(streamRequest)) feed(event)
          }
          await sink.finish()
        } catch (err) {
          await sink.finish({ error: err })
        } finally {
          endConversationRun(id, runSignal)
        }
        try { controller.close() } catch { /* client gone */ }
      },
    })

    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    })
  })

  // ─── Voice Scope Override ────────────────────────────
  router.put('/api/v1/conversations/:id/voice-scope', requirePermission('update', 'Conversation'), async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    const id = c.req.param('id')
    const conv = chatService.get(id)
    if (!conv || conv.userId !== userId) throw new HTTPException(404, { message: 'Conversation not found' })
    let body: { scope?: 'internal' | 'external' | null }
    try {
      body = await c.req.json()
    } catch {
      throw new HTTPException(400, { message: 'Invalid JSON body' })
    }
    const { scope } = body
    if (scope !== null && scope !== undefined && scope !== 'internal' && scope !== 'external') {
      throw new HTTPException(400, { message: 'scope must be "internal", "external", or null' })
    }
    chatService.update(id, { voiceScopeOverride: scope === undefined ? null : scope })
    return c.json({ ok: true })
  })

  // Prompt Enhancer sub-conversation bootstrap route.
  // The enhancer's default target is the parent's effective model (H4).
  registerPromptEnhancerRoute(app, chatService, getDecisionEngine, (conv) => {
    const binding = bindingResolver().resolveStatic(bindingInput(conv))
    return { providerId: binding.providerId, modelId: binding.modelId }
  })
  // Scoped coaches for project / project-type / agent system prompts.
  registerPromptCoachRoute(app, chatService, getDecisionEngine)
}
