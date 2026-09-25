// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { AIProvider, ModelInfo, ModelRequest, ModelResponse, StreamEvent, SystemPromptDelivery } from '../../types.js'
import { runAcpProbe, runGrokAcpPrompt, type AcpProbeResult, type AcpSpawnSandbox } from './acp-client.js'
import { findAcpConfigOption, type AcpConfigOption } from './acp-events.js'
import { buildAcpPrompt, type AcpPromptCapabilities } from './acp-prompt.js'
import { createGrokSystemPromptChannel, type AcpSessionClosedInfo } from './acp-system-prompt.js'
import { createAcpProfile, type AcpCliProfile } from './acp-profiles.js'
import { resolveCliCwd, runScratchCwd } from '../../cli-runtime/workspaces.js'
import { CliModelNameSchema, resolveCliModel, type CliModelMetadataLookup } from '../../cli-model-id.js'
import { resolvedModelField } from '../../helpers.js'
import { sortEffortLevels } from '../../reasoning/ladder.js'
import { readbackOutcome } from '../../reasoning/outcome.js'
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
} from './acp-governance.js'
import { acpRunUsage, createAcpBridgeOutcomes } from './acp-stream.js'
import { createAcpVerifier, type AcpVerifier } from './acp-verify.js'
import { createGrokSandboxProfiles, grokBinaryDirs, type GrokSandboxProfiles } from './sandbox-profile.js'
import { planCliSandboxTurn, sandboxDenyList, type CliSandboxDeps } from '../../cli-runtime/sandbox/index.js'
import { currentHomeDir, getPathPolicy } from '@shared/memory-sovereignty/path-policy.js'
import type { OrchestrationSink } from '@shared/orchestration-events.js'
import { DEFAULT_AGENT_MAX_TURNS } from '@shared/turn-budget.js'
import { createAcpPlanEmitter } from './acp-plan.js'
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
export interface GrokCliGovernance {
  securityGate?: {
    validateToolCall(toolName: string, input: Record<string, unknown>, ctx?: { conversationId?: string; agentId?: string; workingDirectories?: readonly string[] }): GateDecision | Promise<GateDecision>
    autonomyPolicy?: {
      categoryForTool(name: string): string | null
      resolve(category: string): { level: number; locked: boolean; maxLevel: number }
      createApproval(rec: { category: string; toolName: string; agentId?: string; conversationId?: string; reason: string }): void
    }
    /**
     * The gate's deterministic, audited memory-path check. Used for the files
     * the CLI reads and writes through EYAS; without it the process-wide path
     * policy answers (same verdict, no audit row).
     */
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

/**
 * Whether a Grok model takes images before the CLI has said so: grok 1.0.40
 * advertises promptCapabilities.image false (A1 fixture initialize.json). The
 * first turn reports what the installed CLI really accepts, and the catalog
 * follows it from then on (onPromptCapabilities).
 */
const IMAGES_BEFORE_REPORT = false

/** EYAS ids of Grok models are `grok-cli-<grok model>`. */
const GROK_MODEL_PREFIX = 'grok-cli-'
/** The row that runs whatever model the CLI itself defaults to (no --model). */
const GROK_DEFAULT_MODEL_ID = 'grok-cli-default'

/**
 * Grok's reasoning-effort session option (ACP configOptions, category
 * thought_level): set per turn with session/set_config_option, read back
 * from the answer (grok 1.0.41 fixture acp-config-options.json).
 */
const GROK_EFFORT_OPTION = { id: 'reasoning_effort', category: 'thought_level' } as const

/** Context window of a model whose CLI reports none. */
const DEFAULT_CONTEXT_WINDOW = 500_000

/**
 * Known models — returned instantly on listModels() without CLI calls: the
 * CLI's own default only. Which concrete model that is, is the CLI's to say
 * (discovery records it), so no realModelId is claimed here. fetchModels()
 * adds every model the CLI offers over ACP (runAcpProbe).
 */
const KNOWN_MODELS: ModelInfo[] = [
  {
    id: GROK_DEFAULT_MODEL_ID,
    name: 'Grok CLI',
    provider: 'grok-cli',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsImages: IMAGES_BEFORE_REPORT,
    supportsStreaming: true,
    metadata: { alias: 'default' },
  },
]

export interface GrokCliProviderOptions {
  /** Logger instance */
  logger?: import('pino').Logger
  /** Tool-call cap per turn (default: 25); reaching it ends the turn with stopReason 'max_turns'. */
  maxTurns?: number
  /**
   * How grok is launched: executable, argv, env and the EYAS-owned home
   * (acp-profiles.ts). Default: the grok-cli profile under the instance's
   * CLI homes.
   */
  profile?: AcpCliProfile
  /** Optional override for the ACP runner (tests). */
  runPrompt?: typeof runGrokAcpPrompt
  /**
   * The fail-closed session checks (preflight, session/new, tripwire).
   * Default: the profile's verifier; the manifest passes one that knows the
   * resolved binary.
   */
  verifier?: AcpVerifier
  /**
   * Lazily-resolved governance deps. When it returns a securityGate, every ACP
   * permission request and fs access is bridged through the EYAS gate (same
   * Cap 7 policy as the claude-code provider); when absent, the ACP layer
   * fail-closes (permission/fs requests are refused).
   */
  getGovernance?: () => GrokCliGovernance | undefined
  /**
   * When set, stream() issues a bridge secret bound server-side to the turn
   * (conversation, agent, project, turn, run) and injects the EYAS stdio MCP
   * server into ACP session/new so the CLI can call EYAS tools (memory, board,
   * search, …) under the same ToolExecutor + security gate path as Claude
   * Code. The secret is revoked when the turn ends.
   */
  mcpBridge?: {
    /** Loopback base URL of the running EYAS HTTP server (e.g. http://127.0.0.1:3100). */
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
   * The persisted model_config metadata of one grok-cli model id (the
   * manifest reads ctx.providerConfig). A model a refresh discovered keeps
   * running the model it names after a restart; without it the id itself
   * says which model (grok-cli-<model>).
   */
  lookupModelMetadata?: CliModelMetadataLookup
  /** Optional override for the discovery probe (tests). */
  runProbe?: typeof runAcpProbe
  /** Where the discovery probe runs (default: the 'model-probe' EYAS scratch folder). */
  probeCwd?: () => string
  /**
   * The kernel file sandbox decision for turns with tools (B5). Default: the
   * configured security.cliSandbox and this host's detection.
   */
  sandbox?: CliSandboxDeps
  /** The sandbox profiles in the profile's GROK_HOME (default: built from the profile). */
  sandboxProfiles?: GrokSandboxProfiles
  /**
   * How long a turn may go quiet (model.cli: idle, and while a tool runs),
   * read at the start of every stream() — the manifest passes a getter over
   * the live config. Default: the documented defaults (cli-turn-watchdog.ts).
   */
  turnTimeouts?: CliTurnTimeoutsSource
}

/**
 * What discovery learned about one model's reasoning effort, in THE
 * discovered-reasoning shape (reasoning/schemas.ts). The levels are the
 * values the CLI's reasoning_effort option offers with that model selected;
 * a model without the option has no reasoning control ('none'). Unknown
 * (undefined) when the model could not be selected, or when the option
 * offers no value on the effort ladder — the stored facts then stand.
 */
function grokReasoningOf(
  options: readonly AcpConfigOption[] | null,
  facts: { defaultEffort?: string; isDefaultModel: boolean; cliVersion: string | null; discoveredAt: string },
): DiscoveredReasoning | undefined {
  if (!options) return undefined
  const runtime = facts.cliVersion ? { runtime: facts.cliVersion } : {}
  const effort = findAcpConfigOption(options, GROK_EFFORT_OPTION)
  if (!effort) return { source: 'acp', param: 'none', levels: [], ...runtime, discoveredAt: facts.discoveredAt }
  const levels = sortEffortLevels(effort.values)
  if (levels.length === 0) return undefined
  // The model's own default: the CLI's models state names it; a fresh
  // session on the default model also starts on it (the EYAS config sets no
  // default effort). Otherwise unknown — the verified overlay supplies it.
  const named = [facts.defaultEffort, facts.isDefaultModel ? effort.currentValue : undefined]
    .find((level) => level !== undefined && (levels as string[]).includes(level))
  return {
    source: 'acp',
    param: 'effort',
    levels,
    ...(named ? { defaultLevel: named as DiscoveredReasoning['defaultLevel'] } : {}),
    ...runtime,
    discoveredAt: facts.discoveredAt,
  }
}

/**
 * The model catalog from one discovery probe: `grok-cli-default` (the CLI's
 * own default, run without --model) plus `grok-cli-<model>` for every model
 * the CLI offers, each naming its concrete model (realModelId), the CLI
 * version, and its reasoning levels. Throws when the CLI offered nothing, so
 * a failed discovery is never mistaken for "these are all the models".
 */
export function grokModelsFromProbe(probe: AcpProbeResult, discoveredAt: string): ModelInfo[] {
  const cliVersion = probe.cliVersion
  // The CLI is untrusted: a name no --model may carry is not a model row.
  const models = probe.models.filter((m) => CliModelNameSchema.safeParse(m.modelId).success)
  if (models.length === 0) throw new Error('Grok CLI offered no model')
  const defaultModel = models.find((m) => m.modelId === probe.defaultModelId) ?? models[0]

  const row = (id: string, name: string, model: typeof models[number], extra: Record<string, unknown>): ModelInfo => {
    const reasoning = grokReasoningOf(model.configOptions, {
      defaultEffort: model.defaultEffort,
      isDefaultModel: model === defaultModel,
      cliVersion,
      discoveredAt,
    })
    return {
      id,
      name,
      provider: 'grok-cli',
      contextWindow: model.contextTokens ?? DEFAULT_CONTEXT_WINDOW,
      maxOutputTokens: 64_000,
      supportsTools: true,
      supportsImages: IMAGES_BEFORE_REPORT,
      supportsStreaming: true,
      metadata: {
        ...extra,
        realModelId: model.modelId,
        ...(cliVersion ? { cliVersion } : {}),
        ...(reasoning ? { reasoning } : {}),
        discoveredAt,
      },
    }
  }
  // The default row runs the CLI's default (no --model); its realModelId
  // records which model that was when this discovery ran.
  return [
    row(GROK_DEFAULT_MODEL_ID, `Grok CLI (${defaultModel.modelId})`, defaultModel, { alias: 'default' }),
    ...models.map((m) => row(`${GROK_MODEL_PREFIX}${m.modelId}`, `Grok CLI (${m.modelId})`, m, {})),
  ]
}

export function createGrokCliProvider(options: GrokCliProviderOptions = {}): AIProvider {
  const {
    logger: providerLogger,
    maxTurns = DEFAULT_MAX_TURNS,
    runPrompt = runGrokAcpPrompt,
    getGovernance,
    mcpBridge,
    isSignedIn,
    onPromptCapabilities,
    lookupModelMetadata,
    runProbe = runAcpProbe,
    probeCwd = () => runScratchCwd('model-probe'),
    sandbox,
    turnTimeouts,
  } = options
  const profile = options.profile ?? createAcpProfile('grok-cli')
  const verifier = options.verifier ?? createAcpVerifier(profile, { logger: providerLogger })
  const sandboxProfiles = options.sandboxProfiles
    ?? createGrokSandboxProfiles({ home: profile.home, configDir: profile.configDir, logger: providerLogger })
  // How the EYAS system prompt reaches grok's model, proven after each turn
  // from grok's own session record (acp-system-prompt.ts).
  const systemPromptChannel = createGrokSystemPromptChannel({
    sessionStorePath: profile.sessionStorePath,
    resolveExecutable: () => profile.resolveExecutable(),
    logger: providerLogger,
  })

  /** Image input as the CLI last reported it; undefined until the first turn. */
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
    // Classification is fail-closed (F0 R4): only a construction site that
    // explicitly labels its metadata as human-attended (origin:
    // interactive/channel, no team session) is treated as interactive;
    // everything else — including absent metadata — is autonomous and
    // governed by the graduated-autonomy ladder.
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
      // F2 T5 — the ACP bridge is the SAME bridge, so the park sink works
      // identically here; ACP's own reject_once is the interrupt mechanism.
      onEscalatedApproval: request.metadata?.onEscalatedApproval,
      // A resumed run's do-not-repeat ledger: the CLI runs its tools itself,
      // so the bridge is where a repeat is refused.
      ledger: request.metadata?.idempotencyLedger,
      logger: providerLogger,
    }, request.signal ?? new AbortController().signal)
  }

  return {
    id: 'grok-cli',
    name: 'Grok CLI',
    // Grok keeps MCP tools out of the function list: the model finds them with
    // search_tool and calls them through use_tool as `eyas__<name>` (grok
    // 1.0.40 fixture mcp-dispatch.json). A bare `memory_search` is Grok's own
    // memory tool, so prompts must never name EYAS tools bare here.
    toolAddressing: { kind: 'meta-tool', via: 'use_tool', qualify: 'eyas__' },

    /**
     * The isolated-completion contract holds only while EYAS has verified
     * this CLI's isolation (acp-verify.ts): before the first verification and
     * after a violation, Grok is not eligible for background work.
     */
    get supportsIsolatedCompletion(): boolean {
      return getIsolationStatus('grok-cli').status === 'verified'
    },

    async listModels() {
      return withReportedImages(KNOWN_MODELS)
    },

    /**
     * Zero-cost discovery over ACP through the isolated profile: the models
     * the CLI offers and each one's reasoning-effort levels, read from the
     * session's own config options — no prompt, no model call.
     */
    async fetchModels() {
      const probe = await runProbe({
        profile,
        providerLabel: 'Grok CLI',
        cwd: probeCwd(),
        verifier,
        enumerate: 'model',
        logger: providerLogger,
      })
      return withReportedImages(grokModelsFromProbe(probe, new Date().toISOString()))
    },

    async complete(request: ModelRequest): Promise<ModelResponse> {
      let fullText = ''
      let response: ModelResponse | null = null
      for await (const event of this.stream(request)) {
        if (event.type === 'text') fullText += event.text
        if (event.type === 'done') response = event.response
      }
      return response ?? {
        id: `grok-${Date.now()}`,
        provider: 'grok-cli',
        model: request.model || 'grok-cli-default',
        content: [{ type: 'text', text: fullText }],
        stopReason: 'end',
        usage: { inputTokens: 0, outputTokens: 0, reported: false },
      }
    },

    async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
      // The model the CLI runs: the persisted realModelId, else the id minus
      // its prefix; the default row (or no model) sends no --model at all.
      // An id naming no model throws here — never a silent default.
      const cliModel = resolveCliModel({
        prefix: GROK_MODEL_PREFIX,
        defaultId: GROK_DEFAULT_MODEL_ID,
        eyasModelId: request.model,
        lookup: lookupModelMetadata,
      })

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
        if (isSignedIn && !isSignedIn()) throw cliSignInError('grok-cli')

        // Process isolation (EYAS-owned HOME/GROK_HOME, allowlisted env, ask
        // mode, no host config, memory, compat imports or leader) is the
        // profile's job: acp-profiles.ts; the runner proves it before and
        // during the session (acp-verify.ts). An isolated completion gets no
        // bridge, every permission and file request refused, and no tool call.
        const isolated = request.isolated === true

        // The first valid conversation folder, else the conversation's EYAS
        // workspace, else a run scratch folder — never process.cwd().
        const sessionCwd = resolveCliCwd(request, { logger: providerLogger })
        // The folders EYAS serves the CLI's file requests from (the jail);
        // also the bridge binding's and the gate's working folders.
        const roots = resolveAcpRoots(request, sessionCwd)

        // Kernel file sandbox for grok's own tools (B5): a turn with tools
        // runs under a custom profile in its GROK_HOME — the memory-
        // sovereignty deny list, the turn's folders and the CLI HOME writable
        // (sandbox-profile.ts), written by the runner right before the spawn
        // and pruned once the CLI exited. None on this host: 'auto' runs and
        // says so once per conversation, 'required' refuses here, before
        // anything is spawned. An isolated completion runs no tool and needs
        // none.
        let prepareSandbox: ((ctx: { executable: string }) => AcpSpawnSandbox) | undefined
        if (!isolated) {
          const plan = await planCliSandboxTurn('grok-cli', { conversationId, mode: sandbox?.mode?.(), host: sandbox?.host })
          if (plan.sandboxed) {
            prepareSandbox = ({ executable }) => sandboxProfiles.acquire({
              deny: sandboxDenyList(getPathPolicy(), {
                workingDirectories: roots,
                // The whole EYAS-owned CLI HOME (GROK_HOME and the shell's
                // ~/.cache live there) and grok's own install stay usable.
                keep: [profile.home, ...grokBinaryDirs(executable)],
                homeDir: currentHomeDir(),
              }),
              readWrite: [profile.home, ...roots],
            })
          } else if (plan.notice) {
            yield plan.notice
          }
        }

        // The turn's tool scope (the names the request offers) bounds both
        // the EYAS bridge and the CLI's own tools: a native write, shell or
        // web call the agent's tool list does not grant is refused before
        // the gate is asked (acp-governance.ts, tools/cli-exposure.ts).
        const toolScope = requestToolScope(request)

        // EYAS tools via the ACP MCP stdio child (parity with the Claude Code
        // bridge). The turn's identity is bound to the secret server-side;
        // the child only carries the secret, revoked in `finally` below.
        let mcpServers: import('./acp-client.js').AcpMcpServerConfig[] | undefined
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
            providerLogger?.warn?.({ err: String(err) }, 'grok-cli: MCP bridge config failed — continuing without EYAS tools')
          }
        }

        // The system prompt's channel for this turn: the override once grok
        // has proven it honours it, both while unproven, the prompt after a
        // failed proof. The proof is grok's own record of the session, read
        // when the session closes and before the runner purges it — for a
        // failed turn too, whose verdict still decides the next turns.
        const channelPlan = request.system?.trim() ? await systemPromptChannel.plan() : null
        let delivered: SystemPromptDelivery | undefined

        // The effort the gateway resolved for this model, set on the session
        // before the prompt; Auto sends nothing and the model's default runs.
        const effortLevel = request.effortPlan && request.effortPlan.level !== 'auto' ? request.effortPlan.level : undefined

        const gen = runPrompt({
          profile,
          providerLabel: 'Grok CLI',
          cwd: sessionCwd,
          roots,
          isolated,
          verifier,
          model: cliModel,
          prompt,
          systemPrompt: request.system,
          systemPromptChannel: channelPlan?.channel ?? 'prompt',
          systemPromptMarker: channelPlan?.marker,
          onSessionClosed: channelPlan
            ? (info: AcpSessionClosedInfo) => { delivered = systemPromptChannel.settle(channelPlan, info) }
            : undefined,
          maxTurns: request.maxTurns ?? maxTurns,
          // An isolated completion's answer stops at maxTokens × 4 characters
          // ('max_tokens'); a turn with tools is not capped by it.
          maxTokens: request.maxTokens,
          signal: request.signal,
          // Stopped only when grok goes quiet, never after a fixed time.
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
          ...(effortLevel ? { sessionConfig: { [GROK_EFFORT_OPTION.id]: effortLevel } } : {}),
          ...(prepareSandbox ? { prepareSandbox } : {}),
        })

        let result = await gen.next()
        while (!result.done) {
          yield result.value
          result = await gen.next()
        }

        const final = result.value
        // No session was opened: nothing was checked.
        if (channelPlan && !delivered) delivered = systemPromptChannel.settle(channelPlan, null)
        // What the session really ran: the model and the effort, as read back
        // from grok's own config options — never the ids EYAS asked for.
        if (cliModel && final.resolvedModelId && final.resolvedModelId !== cliModel) {
          providerLogger?.warn?.({ requested: cliModel, resolved: final.resolvedModelId }, 'grok-cli: the session reports another model than the one requested')
        }
        const appliedEffort = final.appliedConfig?.[GROK_EFFORT_OPTION.id]
        const effortOutcome = appliedEffort !== undefined ? readbackOutcome(request.effortPlan, appliedEffort) : undefined
        yield {
          type: 'done',
          response: {
            id: `grok-${Date.now()}`,
            provider: 'grok-cli',
            model: request.model || 'grok-cli-default',
            content: [{ type: 'text', text: final.text }],
            // 'max_turns' when the tool-call cap ended the turn, 'max_tokens'
            // when an isolated completion's output cap did: outcomes, not errors.
            stopReason: final.stopReason,
            // Canonical usage; a turn the CLI reported none for says so.
            usage: acpRunUsage(final),
            ...resolvedModelField(final.resolvedModelId),
            ...(effortOutcome ? { effortOutcome } : {}),
            ...(delivered ? { systemPromptChannel: delivered } : {}),
          },
        }
      } catch (err) {
        // A missing or rejected login becomes the one localized sign-in error.
        const error = asCliSignInFailure('grok-cli', err instanceof Error ? err : new Error(String(err)), isSignedIn)
        providerLogger?.warn?.({ err: error }, 'grok-cli ACP stream failed')
        // Yield the frame so the chat route can still render the failure, then
        // rethrow: a provider that swallows its own failure makes the gateway
        // record the call as healthy and the run as successful (D9).
        yield { type: 'error', error }
        throw error
      } finally {
        // The turn is over (done, failed, aborted or abandoned by the
        // consumer): its bridge secret stops working now, not at the TTL.
        if (bridgeSecret) revokeBridgeSecret(bridgeSecret)
      }
    },
  }
}

/** Exported for onboarding / tests. */
export { KNOWN_MODELS as GROK_CLI_KNOWN_MODELS }
