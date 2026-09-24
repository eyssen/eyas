// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Model binding: which provider+model answers a call. Defined HERE, once:
//   - resolveDefault — the install default for a call nobody pinned (the
//     gateway's unpinned fallback and the auxiliary model service read it);
//   - createBindingResolver — the conversation/agent binding (D3): a pinned
//     pair, Auto-routing only when the conversation asks for it, or the
//     colleague's pair with the stored pair behind it. It reads the same
//     resolveDefault ladder; nothing keeps a second one.

import type { BindingNote, BindingSource, TurnBinding } from '@shared/chat-stream.js'
import { CodedModelError } from '@shared/classify-model-error.js'
import { isCliProviderId } from './onboarding-reconcile.js'
import type { ProviderConfigService } from './provider-config-service.js'
import type { RoutingTier, TierConfig } from './routing/types.js'
import { normalizeModelAlias, type ProviderModels } from './tier-resolver.js'

export type { BindingNote, BindingSource } from '@shared/chat-stream.js'

/** What a provider must expose for the isolation check — an AIProvider satisfies it. */
export interface IsolationCapable {
  id: string
  supportsIsolatedCompletion?: boolean
}

/**
 * True when the provider can answer a request with `isolated: true` without
 * its own loaded context: every API provider (it loads none), and a CLI only
 * when it advertises supportsIsolatedCompletion. The single eligibility rule
 * for background work and for an isolated failover hop.
 */
export function canRunIsolated(provider: IsolationCapable): boolean {
  return !isCliProviderId(provider.id) || provider.supportsIsolatedCompletion === true
}

/** The provider_config lookups resolveDefault needs; a ProviderConfigService satisfies it. */
export type BindingProviderConfig = Pick<ProviderConfigService, 'getProvider' | 'getDefault' | 'listProviders' | 'listEnabledModels'>

export interface ResolveDefaultDeps {
  getTiers(): TierConfig[]
  providerConfig: BindingProviderConfig
  isRegistered(id: string): boolean
}

export type DefaultBindingSource = 'tier' | 'default' | 'first'

export interface DefaultBinding {
  providerId: string
  modelId: string
  source: DefaultBindingSource
}

/**
 * The install default, in this order:
 *   1. the enabled 'standard' routing tier, when its provider is registered
 *      and enabled;
 *   2. the provider_config default, when registered and enabled;
 *   3. the alphabetically first registered+enabled provider that has an
 *      enabled model, with its first enabled model.
 * No provider is preferred by id and registration order never matters.
 * Null when nothing qualifies. A lookup that throws counts as "not this rung".
 */
export function resolveDefault(deps: ResolveDefaultDeps): DefaultBinding | null {
  const usable = (id: string | null | undefined): id is string => {
    if (!id) return false
    try {
      return deps.isRegistered(id) && deps.providerConfig.getProvider(id)?.enabled === true
    } catch {
      return false
    }
  }

  const standard = attempt(() => deps.getTiers().find((t) => t.tier === 'standard' && t.enabled))
  if (standard && standard.modelId && usable(standard.providerId)) {
    return { providerId: standard.providerId, modelId: standard.modelId, source: 'tier' }
  }

  const configured = attempt(() => deps.providerConfig.getDefault())
  if (configured && configured.modelId && usable(configured.providerId)) {
    return { providerId: configured.providerId, modelId: configured.modelId, source: 'default' }
  }

  const rows = attempt(() => deps.providerConfig.listProviders()) ?? []
  const ids = rows.map((r) => r.id).filter((id) => typeof id === 'string').sort()
  for (const id of ids) {
    if (!usable(id)) continue
    const model = attempt(() => deps.providerConfig.listEnabledModels(id)[0]?.id)
    if (model) return { providerId: id, modelId: model, source: 'first' }
  }
  return null
}

/** The provider_config lookups findModelOwner needs; a ProviderConfigService satisfies it. */
export type ModelOwnerProviderConfig = Pick<ProviderConfigService, 'getProvider' | 'listProviders' | 'listEnabledModels'>

/**
 * The provider that answers a request naming only `modelId`: the registered,
 * enabled provider whose catalog lists that model enabled — the same id → owner
 * map the gateway's model cache routes by. A bare tier alias ('sonnet', …) is
 * normalized the way the gateway normalizes it, unless `exact` is set (the
 * gateway's own lookup: it normalizes aliases itself, and must forward the
 * concrete id). Null when no provider owns the model, or when more than one
 * does (the caller must not guess).
 */
export function findModelOwner(
  deps: { providerConfig: ModelOwnerProviderConfig; isRegistered(id: string): boolean },
  modelId: string,
  opts: { exact?: boolean } = {},
): string | null {
  return resolveModelRef(deps, modelId, opts)?.providerId ?? null
}

/**
 * findModelOwner with the concrete model id as well: a bare tier alias
 * ('sonnet') comes back as the listed id it normalizes to, so the pair can be
 * sent to a pinned provider as-is.
 */
export function resolveModelRef(
  deps: { providerConfig: ModelOwnerProviderConfig; isRegistered(id: string): boolean },
  modelId: string,
  opts: { exact?: boolean } = {},
): ModelPair | null {
  if (!modelId) return null
  const rows = attempt(() => deps.providerConfig.listProviders()) ?? []
  const catalog: ProviderModels[] = []
  for (const id of rows.map((r) => r.id).filter((v): v is string => typeof v === 'string').sort()) {
    const usable = attempt(() => deps.isRegistered(id) && deps.providerConfig.getProvider(id)?.enabled === true)
    if (!usable) continue
    const modelIds = (attempt(() => deps.providerConfig.listEnabledModels(id)) ?? []).map((m) => m.id)
    catalog.push({ providerId: id, modelIds })
  }
  const concrete = opts.exact ? modelId : (attempt(() => normalizeModelAlias(modelId, catalog)) ?? null)
  if (!concrete) return null
  const owners = catalog.filter((p) => p.modelIds.includes(concrete))
  return owners.length === 1 ? { providerId: owners[0].providerId, modelId: concrete } : null
}

// ─── Conversation / agent binding (D3) ─────────

export interface ModelPair {
  providerId: string
  modelId: string
}

/**
 * How a conversation picks its model:
 * - pinned: its own pair; an agentless conversation without one fixes the
 *   install default on its first turn and keeps it from then on;
 * - auto: Auto-routing (triage) per turn — only while the global
 *   "Allow Auto-routing" switch is on, otherwise its stored pair;
 * - inherit: agent-bound conversations and sub-conversations — the agent's
 *   pair, else the stored pair (a sub-conversation's is the delegating turn's),
 *   else the install default, fixed on first use.
 */
export const MODEL_BINDING_MODES = ['pinned', 'auto', 'inherit'] as const
export type ModelBindingMode = typeof MODEL_BINDING_MODES[number]

export function isModelBindingMode(value: unknown): value is ModelBindingMode {
  return typeof value === 'string' && (MODEL_BINDING_MODES as readonly string[]).includes(value)
}

/** The mode a row has when nothing was stored: the migration's rule (agent-bound or a child → inherit). */
export function defaultBindingMode(row: { agentId?: string | null; parentConversationId?: string | null }): ModelBindingMode {
  return row.agentId || row.parentConversationId ? 'inherit' : 'pinned'
}

export interface ResolvedBinding extends ModelPair {
  source: BindingSource
  /** The routing tier, set only when Auto-routing picked the pair (the gateway's failover licence). */
  tier?: RoutingTier
  /** Why this is not the pair the mode asked for; shown with the turn. */
  note?: BindingNote
  /**
   * The pair is the install default and the conversation has none stored yet:
   * the caller stores it (materializeBinding) before the provider call, so the
   * conversation keeps it when the default changes later.
   */
  materialize?: boolean
}

export type BindingErrorCode = 'model_binding_unavailable' | 'no_model_configured' | 'binding_inherit_needs_agent'

/**
 * A binding that cannot be served; `code` is the stable, localizable reason.
 * A CodedModelError, so a run that fails on it — thrown by the resolver on an
 * entry path, or by the gateway for an unpinned call with no default — is
 * classified ('invalid-request': terminal, never retried) and reaches the UI
 * as conversations.errors.<code> with the pair as params, like the 400 the
 * chat route answers with.
 */
export class BindingUnavailableError extends CodedModelError {
  declare readonly code: BindingErrorCode
  readonly providerId?: string
  readonly modelId?: string

  constructor(code: BindingErrorCode, pair?: Partial<ModelPair>) {
    const params: Record<string, string> = {}
    if (pair?.providerId) params.provider = pair.providerId
    if (pair?.modelId) params.model = pair.modelId
    super('invalid-request', code, Object.keys(params).length > 0 ? params : undefined, { message: bindingErrorMessage(code, pair) })
    this.name = 'BindingUnavailableError'
    if (pair?.providerId) this.providerId = pair.providerId
    if (pair?.modelId) this.modelId = pair.modelId
  }
}

function bindingErrorMessage(code: BindingErrorCode, pair?: Partial<ModelPair>): string {
  switch (code) {
    case 'model_binding_unavailable':
      return `The model this conversation uses (${pair?.providerId ?? '?'} / ${pair?.modelId ?? '?'}) is not available — choose another model`
    case 'no_model_configured':
      return 'No model is configured: enable a provider with at least one model, or set the Standard tier or a default provider'
    case 'binding_inherit_needs_agent':
      return 'Only a conversation with a colleague, or a sub-conversation, can follow its colleague\'s model'
  }
}

/** A model's catalog state: enabled, switched off, or not in the catalog at all. */
export type ModelCatalogState = 'enabled' | 'disabled' | 'unknown'

export interface BindingResolverDeps {
  /** The provider can answer now: registered with the gateway and not switched off. */
  isProviderActive(providerId: string): boolean
  modelState(providerId: string, modelId: string): ModelCatalogState
  /** A bare model id or tier alias (an agent's model preference) → owning provider + concrete id. */
  resolveModelRef(modelId: string): ModelPair | null
  /** A tier's pair without triage (null when the tier is off or absent). */
  resolveForTier(tier: RoutingTier): ModelPair | null
  /**
   * Auto-routing: triage the message and pick a tier's pair. May throw (no
   * tiers). `conversationId` attributes the classifier call in traces.
   */
  route(text: string, options?: { conversationId?: string }): Promise<ModelPair & { tier: RoutingTier }>
  /** The global "Allow Auto-routing" switch. */
  autoRoutingEnabled(): boolean
  /** The install default ladder (resolveDefault). */
  resolveDefault(): ModelPair | null
}

export interface BindingConversation {
  mode: ModelBindingMode
  providerId: string | null
  modelId: string | null
  agentId: string | null
  parentConversationId: string | null
  /**
   * The user chose the stored pair in the model picker. A pinned
   * conversation then never runs on another model: when that pair cannot be
   * served the turn fails ('model_binding_unavailable') instead of falling
   * back to the install default.
   */
  userChosen?: boolean
}

export interface BindingInput {
  /** A one-turn override sent with the message (both ids, or none). */
  request?: ModelPair | null
  conversation: BindingConversation
  /** The bound colleague's model preference (agent-bound conversations only). */
  agent?: { providerId?: string | null; model?: string | null } | null
  /** The user's message — what Auto-routing triages. */
  text?: string
  /** The conversation this turn belongs to (attributes the triage call). */
  conversationId?: string
}

/** The conversation fields the resolver reads (a conversations Conversation satisfies it). */
export interface BindingConversationRow {
  /** The conversation's id, when the row has one (a stored conversation). */
  id?: string
  modelBinding: ModelBindingMode
  providerId: string | null
  modelId: string | null
  agentId: string | null
  parentConversationId: string | null
  /** The stored pair was chosen in the model picker (conversations.model_user_chosen). */
  modelUserChosen?: boolean
}

/**
 * A resolver input from a conversation row: the one mapping every entry path
 * uses (the chat route today; effort validation and the other entry paths
 * next), so none of them re-derives which fields matter.
 */
export function conversationBindingInput(
  conv: BindingConversationRow,
  extra: { agent?: BindingInput['agent']; request?: ModelPair | null; text?: string } = {},
): BindingInput {
  return {
    request: extra.request ?? null,
    conversation: {
      mode: conv.modelBinding,
      providerId: conv.providerId,
      modelId: conv.modelId,
      agentId: conv.agentId,
      parentConversationId: conv.parentConversationId,
      ...(conv.modelUserChosen === true ? { userChosen: true } : {}),
    },
    agent: conv.agentId ? (extra.agent ?? null) : null,
    text: extra.text,
    ...(conv.id ? { conversationId: conv.id } : {}),
  }
}

/** The conversation fields runConversationRow reads (a conversations Conversation satisfies it). */
export interface RunConversationSource {
  id?: string | null
  modelBinding?: unknown
  providerId?: string | null
  modelId?: string | null
  agentId?: string | null
  parentConversationId?: string | null
  modelUserChosen?: unknown
}

/**
 * The binding row of the conversation an agent run belongs to. The run's
 * agent counts as its colleague when the row names none, and a row without a
 * readable mode gets the migration's rule (agent-bound or a child: inherit).
 * No stored conversation (a pipeline stage): the agent's model, else the
 * install default — and nothing is fixed, as there is no row to fix it on.
 */
export function runConversationRow(
  conv: RunConversationSource | null | undefined,
  agentId: string | null,
  conversationId?: string,
): BindingConversationRow {
  if (!conv) return { modelBinding: 'inherit', providerId: null, modelId: null, agentId, parentConversationId: null }
  const identity = { agentId: conv.agentId ?? agentId, parentConversationId: conv.parentConversationId ?? null }
  const id = conv.id ?? conversationId
  return {
    ...(id ? { id } : {}),
    modelBinding: isModelBindingMode(conv.modelBinding) ? conv.modelBinding : defaultBindingMode(identity),
    providerId: conv.providerId ?? null,
    modelId: conv.modelId ?? null,
    ...identity,
    ...(conv.modelUserChosen === true ? { modelUserChosen: true } : {}),
  }
}

/** A colleague's model setting (AgentDefinition provider + model) as the resolver reads it. */
export interface AgentModelSetting {
  provider?: string | null
  model?: string | null
}

/**
 * The colleague's model preference for the resolver: its provider+model
 * pair, or a bare model id / tier alias (a row the backfill could not bind
 * to one provider) that the resolver binds to its owner. None without a model.
 */
export function agentModelPreference(agent: AgentModelSetting | null | undefined): BindingInput['agent'] {
  if (!agent?.model) return null
  return { providerId: agent.provider || null, model: agent.model }
}

/** A resolved binding as a turn records it (TurnMeta.binding, the agent_start frame). */
export function turnBindingOf(binding: ResolvedBinding): TurnBinding {
  return {
    providerId: binding.providerId,
    modelId: binding.modelId,
    source: binding.source,
    ...(binding.tier ? { tier: binding.tier } : {}),
    ...(binding.note ? { note: binding.note } : {}),
  }
}

/** The pair one run calls. `resolved` is what the resolver decided (absent without a resolver). */
export interface RunBinding {
  providerId?: string
  modelId?: string
  resolved?: ResolvedBinding
}

export interface RunBindingInput {
  /** ctx.modelBinding. Absent (a unit test, a build without the model module): see resolveRunBinding. */
  resolver?: Pick<BindingResolver, 'resolve'> | null
  /** The conversation the run belongs to (a stored row, or the shape one would have). */
  conversation: BindingConversationRow
  /** The colleague the run executes. */
  agent?: AgentModelSetting | null
  /** The run's message (what Auto-routing would triage). */
  text?: string
  /**
   * Fixes a default the conversation had no pair for (conversation-service
   * materializeBinding); returns the pair the row holds afterwards. Absent,
   * or a conversation without an id: nothing is written.
   */
  materialize?: (conversationId: string, pair: ModelPair) => ModelPair | null
}

/**
 * The pair a run that is not an interactive chat turn calls — a specialist
 * (executeAgent), a team member, a background card, a channel reply. The
 * same resolution the chat route makes: the conversation's binding through
 * the resolver (a colleague's or a sub-conversation's: the agent's pair, else
 * the stored pair — the delegating turn's — else the install default), with a
 * default the conversation had no pair for fixed on it before the call, so a
 * later default change does not move it. Provider and model always come from
 * one binding. Throws BindingUnavailableError when nothing can serve the run.
 *
 * Without a resolver the same precedence applies with no catalog checks: the
 * colleague's model (for an inherit conversation), else the stored pair, else
 * nothing — the gateway's install default.
 */
export async function resolveRunBinding(input: RunBindingInput): Promise<RunBinding> {
  if (!input.resolver) return unresolvedRunBinding(input)
  return settleRunBinding(await input.resolver.resolve(runBindingInput(input)), input)
}

/**
 * resolveRunBinding without triage (resolveStatic), for a run whose
 * conversation is never Auto-routed — a team member's is always 'inherit' —
 * so the answer is the same and no await separates the caller from its run.
 */
export function resolveRunBindingStatic(
  input: Omit<RunBindingInput, 'resolver'> & { resolver?: Pick<BindingResolver, 'resolveStatic'> | null },
): RunBinding {
  if (!input.resolver) return unresolvedRunBinding(input)
  return settleRunBinding(input.resolver.resolveStatic(runBindingInput(input)), input)
}

function runBindingInput(input: Pick<RunBindingInput, 'conversation' | 'agent' | 'text'>): BindingInput {
  return conversationBindingInput(input.conversation, {
    agent: agentModelPreference(input.agent),
    ...(input.text !== undefined ? { text: input.text } : {}),
  })
}

/** A default the conversation had no pair for is fixed on it (the pair the row holds afterwards wins). */
function settleRunBinding(resolved: ResolvedBinding, input: Pick<RunBindingInput, 'conversation' | 'materialize'>): RunBinding {
  let binding = resolved
  if (binding.materialize) {
    const { materialize: _fixedNow, ...rest } = binding
    const id = input.conversation.id
    const fixed = id && input.materialize ? input.materialize(id, { providerId: rest.providerId, modelId: rest.modelId }) : null
    binding = fixed ? { ...rest, ...fixed } : rest
  }
  return { providerId: binding.providerId, modelId: binding.modelId, resolved: binding }
}

/** No resolver: the colleague's model for an inherit conversation, else the stored pair, else nothing. */
function unresolvedRunBinding(input: Pick<RunBindingInput, 'conversation' | 'agent'>): RunBinding {
  const conv = input.conversation
  if (conv.modelBinding === 'inherit' && input.agent?.model) {
    return { ...(input.agent.provider ? { providerId: input.agent.provider } : {}), modelId: input.agent.model }
  }
  return conv.providerId && conv.modelId ? { providerId: conv.providerId, modelId: conv.modelId } : {}
}

export interface BindingResolver {
  /** The pair for this turn. Triage runs only for an Auto conversation. */
  resolve(input: BindingInput): Promise<ResolvedBinding>
  /**
   * The pair without triage (display, context window, effort validation):
   * Auto shows the Standard tier. Never writes anything.
   */
  resolveStatic(input: BindingInput): ResolvedBinding
  /** The install default as a binding, or null when nothing is configured. */
  resolveDefault(): ResolvedBinding | null
  /** A pair a user may fix a conversation to: an enabled model of an active provider. */
  isSelectable(pair: ModelPair): boolean
  /** The global "Allow Auto-routing" switch: whether an Auto conversation triages now. */
  autoRoutingEnabled(): boolean
}

/**
 * The one binding resolver. Precedence: request override > pinned pair >
 * Auto-routing (only on an Auto conversation, only while the switch is on) >
 * inherit chain (agent pair > stored pair > install default). The model is
 * picked here; the gateway resolves effort against it afterwards.
 *
 * A one-turn request override that cannot be served fails with
 * 'model_binding_unavailable', and so does a pinned pair the user chose in
 * the model picker. Any other stored pair that cannot be served runs on the
 * install default with a note (storedOrDefault) — never silently; with no
 * default either, it fails. An unavailable agent pair falls back to the stored
 * or default pair with a note.
 */
export function createBindingResolver(deps: BindingResolverDeps): BindingResolver {
  const usable = (pair: ModelPair): boolean =>
    (attempt(() => deps.isProviderActive(pair.providerId)) ?? false) &&
    (attempt(() => deps.modelState(pair.providerId, pair.modelId)) ?? 'unknown') !== 'disabled'
  const autoRoutingOn = (): boolean => attempt(() => deps.autoRoutingEnabled()) ?? false

  function storedPair(conv: BindingConversation): ModelPair | null {
    return conv.providerId && conv.modelId ? { providerId: conv.providerId, modelId: conv.modelId } : null
  }

  function defaultBinding(): ResolvedBinding | null {
    const pair = attempt(() => deps.resolveDefault()) ?? null
    return pair ? { providerId: pair.providerId, modelId: pair.modelId, source: 'default' } : null
  }

  /**
   * The stored pair, else the install default to be fixed now. A stored pair
   * that can no longer be served (its model switched off — e.g. by a CLI's
   * discovery reconcile — or its provider off):
   * - `failClosed` (a pinned pair the user chose in the model picker): the
   *   turn fails with 'model_binding_unavailable' — it never runs on a model
   *   the user did not pick; the picker next to the error recovers it;
   * - otherwise (a pair the system stamped: the install default fixed on the
   *   first turn, a pre-D3 row, a delegating turn's pair): this turn runs on
   *   the install default with the note 'stored-binding-unavailable', and the
   *   pair stays stored — it answers again once it is back.
   */
  function storedOrDefault(conv: BindingConversation, source: BindingSource, failClosed = false): ResolvedBinding {
    const stored = storedPair(conv)
    if (stored) {
      if (usable(stored)) return { ...stored, source }
      if (failClosed) throw new BindingUnavailableError('model_binding_unavailable', stored)
      const fallback = defaultBinding()
      if (!fallback) throw new BindingUnavailableError('model_binding_unavailable', stored)
      return { ...fallback, note: 'stored-binding-unavailable' }
    }
    const def = defaultBinding()
    if (!def) throw new BindingUnavailableError('no_model_configured')
    return { ...def, materialize: true }
  }

  /** Adds the note unless the binding already carries one (the more specific, inner reason wins). */
  function withNote(binding: ResolvedBinding, note: BindingNote): ResolvedBinding {
    return binding.note ? binding : { ...binding, note }
  }

  function requestBinding(input: BindingInput): ResolvedBinding | null {
    const req = input.request
    if (!req?.providerId || !req.modelId) return null
    if (!usable(req)) throw new BindingUnavailableError('model_binding_unavailable', req)
    return { providerId: req.providerId, modelId: req.modelId, source: 'request' }
  }

  function inheritBinding(input: BindingInput): ResolvedBinding {
    const conv = input.conversation
    const model = input.agent?.model
    let note: BindingNote | undefined
    if (model) {
      const ref = input.agent?.providerId
        ? { providerId: input.agent.providerId, modelId: model }
        : (attempt(() => deps.resolveModelRef(model)) ?? null)
      if (ref && usable(ref)) return { ...ref, source: 'agent' }
      note = 'agent-binding-unavailable'
    }
    const binding = storedOrDefault(conv, conv.parentConversationId ? 'parent' : 'conversation')
    return note ? withNote(binding, note) : binding
  }

  function resolveWith(input: BindingInput, auto: () => (ModelPair & { tier: RoutingTier }) | null): ResolvedBinding {
    const req = requestBinding(input)
    if (req) return req
    const conv = input.conversation
    if (conv.mode === 'inherit') return inheritBinding(input)
    if (conv.mode === 'auto') {
      if (!autoRoutingOn()) {
        return withNote(storedOrDefault(conv, 'conversation'), 'auto-routing-disabled')
      }
      const routed = auto()
      if (routed && usable(routed)) {
        return { providerId: routed.providerId, modelId: routed.modelId, source: 'auto', tier: routed.tier }
      }
      return withNote(storedOrDefault(conv, 'conversation'), 'auto-routing-unavailable')
    }
    return storedOrDefault(conv, 'conversation', conv.userChosen === true)
  }

  return {
    async resolve(input) {
      // Triage is awaited only on the Auto path; its result is handed to the
      // same synchronous precedence as resolveStatic.
      let routed: (ModelPair & { tier: RoutingTier }) | null = null
      const conv = input.conversation
      const wantsTriage = conv.mode === 'auto' && !(input.request?.providerId && input.request.modelId) && autoRoutingOn()
      if (wantsTriage) {
        try {
          routed = input.conversationId
            ? await deps.route(input.text ?? '', { conversationId: input.conversationId })
            : await deps.route(input.text ?? '')
        } catch {
          routed = null
        }
      }
      return resolveWith(input, () => routed)
    },

    resolveStatic(input) {
      return resolveWith(input, () => {
        const pair = attempt(() => deps.resolveForTier('standard')) ?? null
        return pair ? { ...pair, tier: 'standard' as RoutingTier } : null
      })
    },

    resolveDefault: defaultBinding,

    isSelectable(pair) {
      return (attempt(() => deps.isProviderActive(pair.providerId)) ?? false) &&
        attempt(() => deps.modelState(pair.providerId, pair.modelId)) === 'enabled'
    },

    autoRoutingEnabled: autoRoutingOn,
  }
}

/** The catalog lookups catalogBindingDeps needs; a ProviderConfigService satisfies it. */
export type BindingCatalog = Pick<ProviderConfigService, 'getProvider' | 'getDefault' | 'listProviders' | 'listEnabledModels' | 'listModels'>

/** The decision engine surface the binding resolver uses (routing/decision-engine.ts). */
export interface BindingRouter {
  route(message: string, options?: { conversationId?: string }): Promise<{ provider: string; model: string; tier: RoutingTier }>
  resolveForTier(tier: RoutingTier): { provider: string; model: string } | null
}

/**
 * BindingResolverDeps from the live catalog: the gateway's registrations,
 * provider_config/model_config, the routing tiers and the decision engine —
 * every input read per call. The one wiring of the resolver; the model module
 * publishes the result as ctx.modelBinding.
 */
export function catalogBindingDeps(input: {
  isRegistered(id: string): boolean
  getCatalog(): BindingCatalog | undefined
  getTiers?(): TierConfig[]
  getRouter?(): BindingRouter | undefined
  autoRoutingEnabled?(): boolean
}): BindingResolverDeps {
  const catalog = (): BindingCatalog | undefined => attempt(() => input.getCatalog())
  return {
    isProviderActive(id) {
      if (!input.isRegistered(id)) return false
      // A registered provider answers unless provider_config switched it off.
      return catalog()?.getProvider(id)?.enabled !== false
    },
    modelState(providerId, modelId) {
      const row = catalog()?.listModels(providerId).find((m) => m.modelId === modelId)
      if (!row) return 'unknown'
      return row.enabled ? 'enabled' : 'disabled'
    },
    resolveModelRef(modelId) {
      const providerConfig = catalog()
      return providerConfig ? resolveModelRef({ providerConfig, isRegistered: input.isRegistered }, modelId) : null
    },
    resolveForTier(tier) {
      const pair = input.getRouter?.()?.resolveForTier(tier)
      return pair ? { providerId: pair.provider, modelId: pair.model } : null
    },
    async route(text, options) {
      const router = input.getRouter?.()
      if (!router) throw new Error('Auto-routing is not available')
      const decision = options?.conversationId
        ? await router.route(text, { conversationId: options.conversationId })
        : await router.route(text)
      return { providerId: decision.provider, modelId: decision.model, tier: decision.tier }
    },
    autoRoutingEnabled: () => input.autoRoutingEnabled?.() ?? true,
    resolveDefault() {
      const providerConfig = catalog()
      if (!providerConfig) return null
      const def = resolveDefault({
        getTiers: () => input.getTiers?.() ?? [],
        providerConfig,
        isRegistered: input.isRegistered,
      })
      return def ? { providerId: def.providerId, modelId: def.modelId } : null
    },
  }
}

function attempt<T>(fn: () => T): T | undefined {
  try {
    return fn()
  } catch {
    return undefined
  }
}
