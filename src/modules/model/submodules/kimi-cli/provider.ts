// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { AIProvider, ModelInfo, ModelRequest, ModelResponse, StreamEvent } from '../../types.js'
import { runAcpProbe, runGrokAcpPrompt, type AcpProbeResult } from '../grok-cli/acp-client.js'
import type { AcpSessionModels } from '../grok-cli/acp-events.js'
import { buildAcpPrompt, type AcpPromptCapabilities } from '../grok-cli/acp-prompt.js'
import { createAcpProfile, type AcpCliProfile } from '../grok-cli/acp-profiles.js'
import { resolveCliCwd, runScratchCwd } from '../../cli-runtime/workspaces.js'
import { CliModelIdError, CliModelNameSchema, resolveCliModel, type CliModelMetadataLookup } from '../../cli-model-id.js'
import { resolvedModelField } from '../../helpers.js'
import { readbackOutcome } from '../../reasoning/outcome.js'
import type { EffortPlan } from '../../reasoning/resolve.js'
import type { DiscoveredReasoning } from '../../reasoning/schemas.js'
import { asCliSignInFailure, cliSignInError } from '../../cli-runtime/sign-in.js'
import { getIsolationStatus } from '../../cli-runtime/isolation.js'
import { isAutonomousRequest, type GateDecision } from '../../permission-bridge.js'
import {
  acpMemoryPathCheckFrom,
  createAcpCanUseTool,
  resolveAcpRoots,
  type AcpCanUseTool,
  type GateMemoryPathCheck,
} from '../grok-cli/acp-governance.js'
import { acpRunUsage, createAcpBridgeOutcomes } from '../grok-cli/acp-stream.js'
import { createAcpVerifier, type AcpVerifier } from '../grok-cli/acp-verify.js'
import { planCliSandboxTurn, type CliSandboxDeps } from '../../cli-runtime/sandbox/index.js'
import type { OrchestrationSink } from '@shared/orchestration-events.js'
import { DEFAULT_AGENT_MAX_TURNS } from '@shared/turn-budget.js'
import { createAcpPlanEmitter } from '../grok-cli/acp-plan.js'
import { resolveCliTurnTimeouts, type CliTurnTimeoutsSource } from '../../cli-turn-watchdog.js'
import {
  bridgeBindingFromMetadata,
  buildAcpMcpServerConfig,
  issueBridgeSecret,
  revokeBridgeSecret,
  type BridgeToolOutcome,
} from '../../cli-mcp/bridge-routes.js'
import { nativeCapabilitiesFor, requestToolScope } from '@modules/agent/tool-scope.js'

/** Lazily-resolved governance deps (ordering-safe — read at stream() time). */
export interface KimiCliGovernance {
  securityGate?: {
    validateToolCall(toolName: string, input: Record<string, unknown>, ctx?: { conversationId?: string; agentId?: string; workingDirectories?: readonly string[] }): GateDecision | Promise<GateDecision>
    autonomyPolicy?: {
      categoryForTool(name: string): string | null
      resolve(category: string): { level: number; locked: boolean; maxLevel: number }
      createApproval(rec: { category: string; toolName: string; agentId?: string; conversationId?: string; reason: string }): void
    }
    /** The gate's deterministic, audited memory-path check (see GrokCliGovernance). */
    checkMemoryPath?: GateMemoryPathCheck
  }
  /**
   * Where the CLI's own plan steps go (ctx.orchestration). The rest of the
   * run tree is the agent runner's, emitted for every provider.
   */
  orchestrationSink?: OrchestrationSink
}

/** The CLI's own turn cap when a request names none: the interactive turn budget every provider shares. */
const DEFAULT_MAX_TURNS = DEFAULT_AGENT_MAX_TURNS

/** EYAS ids of Kimi models are `kimi-cli-<Kimi model key>`. */
const KIMI_MODEL_PREFIX = 'kimi-cli-'
/** The row that runs whatever model the CLI itself runs (no session/set_model). */
const KIMI_DEFAULT_MODEL_ID = 'kimi-cli-default'
/**
 * kimi-cli 1.52.0 (acp/server.py _ModelIDConv): the ACP id of a model's
 * thinking variant is `<model key>,thinking`; the plain id is the key itself.
 */
const THINKING_SUFFIX = ',thinking'
/** Kimi's ACP models state names no context window or output cap. */
const DEFAULT_CONTEXT_WINDOW = 256_000
const DEFAULT_MAX_OUTPUT_TOKENS = 64_000

/**
 * Known models — returned instantly on listModels() without CLI calls: the
 * CLI's own default only. Which models the CLI offers, and under which keys,
 * is the CLI's to say (its config's [models] table): fetchModels() reads them
 * from the ACP session (runAcpProbe) and the session picks one with
 * session/set_model — `kimi acp` ignores --model.
 */
const KNOWN_MODELS: ModelInfo[] = [
  {
    id: KIMI_DEFAULT_MODEL_ID,
    name: 'Kimi Code CLI',
    provider: 'kimi-cli',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    supportsTools: true,
    supportsImages: true,
    supportsStreaming: true,
    metadata: { alias: 'default' },
  },
]

/** An ACP model id split into the Kimi model key and whether it is the thinking variant. */
export function parseKimiModelId(modelId: string): { key: string; thinking: boolean } {
  return modelId.endsWith(THINKING_SUFFIX)
    ? { key: modelId.slice(0, -THINKING_SUFFIX.length), thinking: true }
    : { key: modelId, thinking: false }
}

/** One Kimi model and the variants its ACP session lists for it. */
export interface KimiModelVariants {
  key: string
  /** The CLI's name for the model (its plain variant's, else the thinking variant's). */
  name?: string
  /** The plain id (`<key>`) is listed: the model runs without thinking. */
  plain: boolean
  /** The thinking id (`<key>,thinking`) is listed: the model runs with thinking. */
  thinking: boolean
}

/**
 * Group the models state of a session by model key, in the CLI's order.
 * kimi-cli 1.52.0 lists, per [models] entry: both ids for a model that can
 * think on request (a toggle), only the thinking id for an always-thinking
 * model, only the plain id for one that cannot think.
 */
export function groupKimiModels(models: ReadonlyArray<{ modelId: string; name?: string }>): KimiModelVariants[] {
  const groups = new Map<string, KimiModelVariants>()
  for (const model of models) {
    const { key, thinking } = parseKimiModelId(model.modelId)
    if (!key) continue
    const group = groups.get(key) ?? { key, plain: false, thinking: false }
    if (thinking) {
      group.thinking = true
      group.name ??= model.name?.replace(/\s*\(thinking\)$/, '') || undefined
    } else {
      group.plain = true
      if (model.name) group.name = model.name
    }
    groups.set(key, group)
  }
  return [...groups.values()]
}

/**
 * What discovery learned about a Kimi model's thinking, in THE
 * discovered-reasoning shape (reasoning/schemas.ts): a toggle ('none'/'high')
 * when the CLI lists both variants, always on ('high' only) when it lists the
 * thinking variant only, no control when it lists the plain one only.
 */
export function kimiReasoningOf(model: KimiModelVariants, facts: { cliVersion: string | null; discoveredAt: string }): DiscoveredReasoning {
  const base = { source: 'acp' as const, ...(facts.cliVersion ? { runtime: facts.cliVersion } : {}), discoveredAt: facts.discoveredAt }
  if (model.plain && model.thinking) return { ...base, param: 'toggle', levels: ['none', 'high'] }
  if (model.thinking) return { ...base, param: 'toggle', levels: ['high'], defaultLevel: 'high' }
  return { ...base, param: 'none', levels: [] }
}

/**
 * The model catalog from one discovery probe: `kimi-cli-default` (the model
 * the CLI runs when EYAS selects none) plus `kimi-cli-<key>` for every model
 * the CLI offers, each naming its Kimi model key (realModelId), the CLI
 * version and its thinking control. Throws when the CLI offered nothing, so a
 * failed discovery is never mistaken for "these are all the models".
 */
export function kimiModelsFromProbe(probe: AcpProbeResult, discoveredAt: string): ModelInfo[] {
  const cliVersion = probe.cliVersion
  // The CLI is untrusted: a key no session may be switched to is not a model row.
  const models = groupKimiModels(probe.models).filter((m) => CliModelNameSchema.safeParse(m.key).success)
  if (models.length === 0) throw new Error('Kimi Code CLI offered no model')
  const currentKey = probe.defaultModelId ? parseKimiModelId(probe.defaultModelId).key : undefined
  const defaultModel = models.find((m) => m.key === currentKey) ?? models[0]

  const row = (id: string, model: KimiModelVariants, extra: Record<string, unknown>): ModelInfo => ({
    id,
    name: `Kimi Code CLI (${model.name ?? model.key})`,
    provider: 'kimi-cli',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    supportsTools: true,
    supportsImages: true,
    supportsStreaming: true,
    metadata: {
      ...extra,
      realModelId: model.key,
      ...(cliVersion ? { cliVersion } : {}),
      reasoning: kimiReasoningOf(model, { cliVersion, discoveredAt }),
      discoveredAt,
    },
  })
  // The default row selects nothing; its realModelId records which model the
  // CLI ran when this discovery ran.
  return [
    row(KIMI_DEFAULT_MODEL_ID, defaultModel, { alias: 'default' }),
    ...models
      .filter((m) => `${KIMI_MODEL_PREFIX}${m.key}` !== KIMI_DEFAULT_MODEL_ID)
      .map((m) => row(`${KIMI_MODEL_PREFIX}${m.key}`, m, {})),
  ]
}

/** Thinking as the effort plan asks for it: on, off, or whatever the session runs ('auto'). */
export type KimiThinking = 'on' | 'off' | 'keep'

export function kimiThinkingFor(plan: EffortPlan | undefined): KimiThinking {
  if (!plan || plan.level === 'auto') return 'keep'
  return plan.level === 'none' ? 'off' : 'on'
}

/**
 * The ACP model id a Kimi session should run (session/set_model), or
 * undefined to keep the session's own. `key` is the Kimi model key EYAS pins
 * (undefined: the CLI's current model). A toggle model gets its thinking or
 * plain variant as asked ('keep' keeps the current variant); a model with one
 * variant always gets that one. A pinned key the session does not offer throws
 * CliModelIdError — it never turns into another model.
 */
export function kimiSessionModelId(models: AcpSessionModels | null, key: string | undefined, thinking: KimiThinking): string | undefined {
  const current = models?.currentModelId ? parseKimiModelId(models.currentModelId) : undefined
  const target = key ?? current?.key
  if (!target) return undefined
  const listed = models?.availableModels ?? []
  const variants = groupKimiModels(listed).find((m) => m.key === target)
  if (!variants) {
    if (key) {
      const reason = listed.length === 0
        ? 'Kimi Code CLI lists no models, so EYAS cannot select it'
        : `Kimi Code CLI does not offer it${models?.currentModelId ? ` (the session would run ${models.currentModelId})` : ''}`
      throw new CliModelIdError(key, reason)
    }
    // The CLI's own model is not in its list: nothing to switch between.
    return undefined
  }
  // Auto keeps whether the session thinks now, also across a model switch.
  const wanted = thinking === 'keep' ? current?.thinking ?? false : thinking === 'on'
  const on = variants.plain && variants.thinking ? wanted : variants.thinking
  return on ? `${target}${THINKING_SUFFIX}` : target
}

/**
 * The thinking a Kimi session really ran, from the model id it ran: 'high'
 * for the thinking variant, 'none' for the plain variant of a model that also
 * offers thinking, undefined when there was nothing to choose (a model that
 * cannot think) or the model is not in the session's list.
 */
export function kimiThinkingApplied(models: AcpSessionModels | null, resolvedModelId: string): 'high' | 'none' | undefined {
  const { key, thinking } = parseKimiModelId(resolvedModelId)
  const variants = groupKimiModels(models?.availableModels ?? []).find((m) => m.key === key)
  if (!variants) return undefined
  if (thinking) return 'high'
  return variants.thinking ? 'none' : undefined
}

export interface KimiCliProviderOptions {
  logger?: import('pino').Logger
  /** Tool-call cap per turn (default: 25); reaching it ends the turn with stopReason 'max_turns'. */
  maxTurns?: number
  /**
   * How kimi is launched: executable, argv ['acp'], env and the EYAS-owned
   * home (grok-cli/acp-profiles.ts). Default: the kimi-cli profile under the
   * instance's CLI homes.
   */
  profile?: AcpCliProfile
  runPrompt?: typeof runGrokAcpPrompt
  /**
   * The fail-closed session checks (preflight, session/new, tripwire).
   * Default: the profile's verifier.
   */
  verifier?: AcpVerifier
  getGovernance?: () => KimiCliGovernance | undefined
  /**
   * Same MCP bridge as Grok CLI — exposes EYAS tools to Kimi ACP sessions
   * under a per-turn secret bound server-side to the turn.
   */
  mcpBridge?: {
    /** Loopback base URL of the running EYAS HTTP server. */
    baseUrl: string
  }
  /**
   * Whether the EYAS-owned home is signed in (cli-runtime/sign-in.ts). When
   * it returns false a turn fails at once, before anything is spawned, with
   * the 'cliSignIn' error; an auth failure the CLI itself reports maps to
   * the same error. Absent: no pre-check.
   */
  isSignedIn?: () => boolean
  /**
   * What the CLI said, on every turn, it accepts in a prompt (ACP initialize
   * promptCapabilities). The manifest writes it to the model catalog so the
   * Vision flag shows what the installed CLI really does.
   */
  onPromptCapabilities?: (caps: AcpPromptCapabilities) => void
  /**
   * The kernel file sandbox decision (B5). Kimi documents no kernel sandbox
   * ('unsupported'): with security.cliSandbox 'required' a turn with tools is
   * refused; with 'auto' it runs and says so once per conversation. Default:
   * the configured mode.
   */
  sandbox?: CliSandboxDeps
  /**
   * How long a turn may go quiet (model.cli: idle, and while a tool runs),
   * read at the start of every stream() — the manifest passes a getter over
   * the live config. Default: the documented defaults (cli-turn-watchdog.ts).
   */
  turnTimeouts?: CliTurnTimeoutsSource
  /**
   * The persisted model_config metadata of one kimi-cli model id (the
   * manifest reads ctx.providerConfig): a discovered model keeps selecting the
   * Kimi model key it names after a restart; without it the id itself says
   * which key (kimi-cli-<key>).
   */
  lookupModelMetadata?: CliModelMetadataLookup
  /** Optional override for the discovery probe (tests). */
  runProbe?: typeof runAcpProbe
  /** Where the discovery probe runs (default: the 'model-probe' EYAS scratch folder). */
  probeCwd?: () => string
}

export function createKimiCliProvider(options: KimiCliProviderOptions = {}): AIProvider {
  const {
    logger: providerLogger,
    maxTurns = DEFAULT_MAX_TURNS,
    runPrompt = runGrokAcpPrompt,
    getGovernance,
    mcpBridge,
    isSignedIn,
    onPromptCapabilities,
    sandbox,
    turnTimeouts,
    lookupModelMetadata,
    runProbe = runAcpProbe,
    probeCwd = () => runScratchCwd('model-probe'),
  } = options
  const profile = options.profile ?? createAcpProfile('kimi-cli')
  const verifier = options.verifier ?? createAcpVerifier(profile, { logger: providerLogger })

  /**
   * Image input as the CLI last reported it; undefined until the first turn.
   * Kimi's own answer is unverified on a real binary, so the catalog keeps
   * its defaults until a turn reports.
   */
  let reportedImages: boolean | undefined
  const reportCapabilities = (caps: AcpPromptCapabilities): void => {
    reportedImages = caps.image
    onPromptCapabilities?.(caps)
  }
  /** The catalog as the CLI reported it: a models refresh keeps the reported Vision flag. */
  const withReportedImages = (models: ModelInfo[]): ModelInfo[] =>
    reportedImages === undefined ? models : models.map((m) => ({ ...m, supportsImages: reportedImages! }))

  /**
   * Build the ACP gate callback from the shared Cap 7 permission bridge.
   * `roots` are the folders the turn works in (resolveAcpRoots: cwd included),
   * so the gate's memory-path policy knows which workspace is this turn's.
   */
  const buildCanUseTool = (request: ModelRequest, roots: readonly string[]): AcpCanUseTool | undefined => {
    const gov = getGovernance?.()
    if (!gov?.securityGate) return undefined
    // The shared permission bridge; each refusal carries its outcome (denied,
    // waiting on a human, skipped) back to the tool row (acp-governance.ts).
    return createAcpCanUseTool({
      validateToolCall: gov.securityGate.validateToolCall,
      autonomy: gov.securityGate.autonomyPolicy,
      autonomous: isAutonomousRequest(request.metadata),
      ctx: {
        conversationId: request.metadata?.conversationId,
        agentId: request.metadata?.agentId,
        runId: request.metadata?.runId,
        workingDirectories: roots,
        // The CLI's tools run under its EYAS-owned HOME: the gate expands
        // `~`/`$HOME` there too, so `~/../..` cannot reach EYAS's data.
        homeDir: profile.home,
      },
      onEscalatedApproval: request.metadata?.onEscalatedApproval,
      // A resumed run's do-not-repeat ledger: the CLI runs its tools itself,
      // so the bridge is where a repeat is refused.
      ledger: request.metadata?.idempotencyLedger,
      logger: providerLogger,
    }, request.signal ?? new AbortController().signal)
  }

  return {
    id: 'kimi-cli',
    name: 'Kimi Code CLI',
    // How Kimi names MCP tools is unverified (no host binary in the A1 spike),
    // so prompts name the `eyas` server rather than guess a qualified name.
    toolAddressing: { kind: 'mcp-server', server: 'eyas' },

    /**
     * The isolated-completion contract holds only while EYAS has verified
     * Kimi's isolation on this host (a passed preflight and session start,
     * acp-verify.ts). Until then Kimi is not eligible for background work.
     */
    get supportsIsolatedCompletion(): boolean {
      return getIsolationStatus('kimi-cli').status === 'verified'
    },

    async listModels() {
      return withReportedImages(KNOWN_MODELS)
    },

    /**
     * Zero-cost discovery over ACP through the isolated profile: the models
     * the CLI's session offers (session/new only) and each one's thinking
     * variants — no prompt, no model call. Throws when the CLI cannot be run,
     * fails its checks or offers no model; the stored rows then stand.
     */
    async fetchModels() {
      const probe = await runProbe({
        profile,
        providerLabel: 'Kimi Code CLI',
        cwd: probeCwd(),
        verifier,
        enumerate: 'none',
        logger: providerLogger,
      })
      return withReportedImages(kimiModelsFromProbe(probe, new Date().toISOString()))
    },

    async complete(request: ModelRequest): Promise<ModelResponse> {
      let fullText = ''
      let response: ModelResponse | null = null
      for await (const event of this.stream(request)) {
        if (event.type === 'text') fullText += event.text
        if (event.type === 'done') response = event.response
      }
      return response ?? {
        id: `kimi-cli-${Date.now()}`,
        provider: 'kimi-cli',
        model: request.model || 'kimi-cli-default',
        content: [{ type: 'text', text: fullText }],
        stopReason: 'end',
        usage: { inputTokens: 0, outputTokens: 0, reported: false },
      }
    },

    async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
      // Process isolation (EYAS-owned HOME/KIMI_SHARE_DIR, allowlisted env,
      // EYAS's keys in config.toml, no MCP servers of Kimi's own) is the
      // profile's job: grok-cli/acp-profiles.ts; the runner proves it before
      // and during the session (grok-cli/acp-verify.ts). Kimi's behaviour is
      // derived from its source, so it counts as verified only once a
      // session started on this host. An isolated completion gets no bridge,
      // every permission and file request refused, and no tool call.
      const isolated = request.isolated === true
      //
      // The argv is exactly ['acp']: the model is not on it (kimi would
      // ignore it and the argv would misreport the model). The model and its
      // thinking are selected inside the session with session/set_model: the
      // persisted Kimi model key (realModelId), else the id minus its prefix;
      // the default row (or no model) keeps the CLI's own. An id naming no
      // model throws here — never a silent default.
      const modelKey = resolveCliModel({
        prefix: KIMI_MODEL_PREFIX,
        defaultId: KIMI_DEFAULT_MODEL_ID,
        eyasModelId: request.model,
        lookup: lookupModelMetadata,
      })
      // Thinking as the gateway's effort plan resolved it for this model: on
      // or off for a toggle; Auto keeps the variant the session runs.
      const thinking = kimiThinkingFor(request.effortPlan)
      // The session's models state, as the runner handed it to the selection.
      let sessionModels: AcpSessionModels | null = null
      const sessionModel = (models: AcpSessionModels | null): string | undefined => {
        sessionModels = models
        return kimiSessionModelId(models, modelKey, thinking)
      }
      // The whole EYAS conversation, images inline, on every turn.
      const prompt = buildAcpPrompt(request.messages)

      // The CLI's own plan (todo list) as plan steps on the run tree. The run,
      // its root node and the tool calls are the agent runner's to emit.
      const conversationId = request.metadata?.conversationId
      const onPlan = createAcpPlanEmitter({
        sink: getGovernance?.()?.orchestrationSink,
        conversationId,
        teamSessionId: request.metadata?.teamSessionId,
        logger: providerLogger,
      })

      let bridgeSecret: string | undefined
      try {
        // Nothing to spawn for a CLI whose EYAS home is not signed in.
        if (isSignedIn && !isSignedIn()) throw cliSignInError('kimi-cli')

        // The first valid conversation folder, else the conversation's EYAS
        // workspace, else a run scratch folder — never process.cwd().
        const sessionCwd = resolveCliCwd(request, { logger: providerLogger })
        // The folders EYAS serves the CLI's file requests from (the jail);
        // also the bridge binding's and the gate's working folders.
        const roots = resolveAcpRoots(request, sessionCwd)

        // Kimi has no kernel file sandbox (B5): a turn with tools is refused
        // under security.cliSandbox 'required', before the spawn, and runs
        // with a one-time notice under 'auto'. EYAS still decides every call
        // Kimi asks about and serves its file reads itself.
        if (!isolated) {
          const plan = await planCliSandboxTurn('kimi-cli', { conversationId, mode: sandbox?.mode?.(), host: sandbox?.host })
          if (!plan.sandboxed && plan.notice) yield plan.notice
        }

        // The turn's tool scope (the names the request offers) bounds both
        // the EYAS bridge and the CLI's own tools: a native write, shell or
        // web call the agent's tool list does not grant is refused before
        // the gate is asked (acp-governance.ts, tools/cli-exposure.ts).
        const toolScope = requestToolScope(request)

        // EYAS tools via the ACP MCP stdio child; identity is bound to the
        // secret server-side and the secret is revoked in `finally` below.
        let mcpServers: import('../grok-cli/acp-client.js').AcpMcpServerConfig[] | undefined
        // What the bridge refuses (denied, waiting on a human) reaches this
        // turn's tool rows; an approval also reaches the runner's park sink,
        // as one raised by the CLI's own tools does.
        const bridgeOutcomes = createAcpBridgeOutcomes()
        const onToolOutcome = (outcome: BridgeToolOutcome): void => {
          if (outcome.outcome === 'approval_required' && outcome.approvalId !== undefined) {
            request.metadata?.onEscalatedApproval?.(outcome.approvalId, outcome.toolName)
          }
          bridgeOutcomes.emit(outcome)
        }
        if (!isolated && mcpBridge?.baseUrl) {
          try {
            // The bridge offers the tools this request offers (its tool
            // scope, Solo's delegation family removed) and nothing else.
            bridgeSecret = issueBridgeSecret({
              ...bridgeBindingFromMetadata(request.metadata, roots),
              toolScope,
              onToolOutcome,
            })
            mcpServers = [buildAcpMcpServerConfig({ baseUrl: mcpBridge.baseUrl, secret: bridgeSecret })]
          } catch (err) {
            if (bridgeSecret) revokeBridgeSecret(bridgeSecret)
            bridgeSecret = undefined
            providerLogger?.warn?.({ err: String(err) }, 'kimi-cli: MCP bridge config failed — continuing without EYAS tools')
          }
        }

        const gen = runPrompt({
          profile,
          providerLabel: 'Kimi Code CLI',
          cwd: sessionCwd,
          roots,
          isolated,
          verifier,
          prompt,
          // Kimi's handling of the _meta override is untested: the system
          // prompt goes fenced into the first text block, which it reads.
          systemPrompt: request.system,
          systemPromptChannel: 'prompt',
          maxTurns: request.maxTurns ?? maxTurns,
          // An isolated completion's answer stops at maxTokens × 4 characters
          // ('max_tokens'); a turn with tools is not capped by it.
          maxTokens: request.maxTokens,
          signal: request.signal,
          // Stopped only when kimi goes quiet, never after a fixed time.
          turnTimeouts: resolveCliTurnTimeouts(turnTimeouts),
          logger: providerLogger,
          canUseTool: isolated ? undefined : buildCanUseTool(request, roots),
          nativeCapabilities: nativeCapabilitiesFor(toolScope),
          checkMemoryPath: acpMemoryPathCheckFrom(getGovernance?.()?.securityGate?.checkMemoryPath, {
            conversationId: request.metadata?.conversationId,
            agentId: request.metadata?.agentId,
            homeDir: profile.home,
          }),
          onPlan,
          mcpServers,
          bridgeOutcomes,
          onPromptCapabilities: reportCapabilities,
          // The model and thinking variant, selected after the session check.
          sessionModel,
        })

        let result = await gen.next()
        while (!result.done) {
          yield result.value
          result = await gen.next()
        }

        const final = result.value
        // What the session really ran, as it reports it: the Kimi model key,
        // and whether its thinking variant ran — never what EYAS asked for.
        const ran = final.resolvedModelId ? parseKimiModelId(final.resolvedModelId) : undefined
        if (modelKey && ran && ran.key !== modelKey) {
          providerLogger?.warn?.({ requested: modelKey, resolved: ran.key }, 'kimi-cli: the session reports another model than the one requested')
        }
        const applied = final.resolvedModelId ? kimiThinkingApplied(sessionModels, final.resolvedModelId) : undefined
        const effortOutcome = applied !== undefined ? readbackOutcome(request.effortPlan, applied) : undefined
        yield {
          type: 'done',
          response: {
            id: `kimi-cli-${Date.now()}`,
            provider: 'kimi-cli',
            model: request.model || KIMI_DEFAULT_MODEL_ID,
            content: [{ type: 'text', text: final.text }],
            // 'max_turns' when the tool-call cap ended the turn, 'max_tokens'
            // when an isolated completion's output cap did: outcomes, not errors.
            stopReason: final.stopReason,
            // Canonical usage; a turn the CLI reported none for says so.
            usage: acpRunUsage(final),
            ...resolvedModelField(ran?.key),
            ...(effortOutcome ? { effortOutcome } : {}),
            ...(request.system?.trim() ? { systemPromptChannel: 'prompt' as const } : {}),
          },
        }
      } catch (err) {
        // A missing or rejected login becomes the one localized sign-in error.
        const error = asCliSignInFailure('kimi-cli', err instanceof Error ? err : new Error(String(err)), isSignedIn)
        providerLogger?.warn?.({ err: error }, 'kimi-cli ACP stream failed')
        yield { type: 'error', error }
        throw error
      } finally {
        // The turn is over: its bridge secret stops working now, not at the TTL.
        if (bridgeSecret) revokeBridgeSecret(bridgeSecret)
      }
    },
  }
}

export { KNOWN_MODELS as KIMI_CLI_KNOWN_MODELS }
