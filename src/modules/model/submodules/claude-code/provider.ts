// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { query } from '@anthropic-ai/claude-agent-sdk'
import type { AIProvider, ModelInfo, ModelRequest, ModelResponse, ContractStreamEvent, ContentBlock, ImageBlock, ToolAddressing } from '../../types.js'
import type { ClaudeRuntime } from './runtime.js'
import type { ToolRegistry } from '@modules/tools/tool-registry.js'
import type { ToolContext } from '@modules/tools/types.js'
import { nativeCapabilitiesFor, requestToolScope, scopeAllowlist } from '@modules/agent/tool-scope.js'
import { claudeCodeBuiltins, selectBridgeTools } from '@modules/tools/cli-exposure.js'
import type { BridgeToolExecutor } from './mcp-bridge.js'
import { buildMcpBridge } from './mcp-bridge.js'
import { createPermissionBridge, isAutonomousRequest, type GateDecision } from './permission-bridge.js'
import { applyHooks, type ClaudeHookSet } from './hooks.js'
import { buildMemoryPathHook, memoryPathHookCheckFor, type MemoryPathHookCheck } from './memory-path-hook.js'
import { buildClaudeIsolationOptions, checkClaudeInit, initMissingViolation } from './isolation-options.js'
import { cliQueryTmp, resolveCliCwd, resolveCliRoots } from '../../cli-runtime/workspaces.js'
import { resolveCliModel } from '../../cli-model-id.js'
import type { ModelConfigMetadata } from '../../provider-config-service.js'
import { readbackOutcome } from '../../reasoning/outcome.js'
import { createEffortReadback, toClaudeCodeReasoningOptions } from './reasoning.js'
import { CLAUDE_CODE_MODEL_PREFIX, claudeCodeWindowFor, claudeModelsFromDiscovery, probeClaudeRuntime, type ClaudeProbeOptions } from './discovery.js'
import { CliIsolationError, setIsolationStatus, type CliIsolationViolation } from '../../cli-runtime/isolation.js'
import { createClaudeStreamNormalizer } from './stream-normalizer.js'
import { currentHomeDir, getPathPolicy } from '@shared/memory-sovereignty/path-policy.js'
import { DEFAULT_AGENT_MAX_TURNS } from '@shared/turn-budget.js'
import { exemptableDirs, planCliSandboxTurn, type CliSandboxDeps, type CliSandboxTurn } from '../../cli-runtime/sandbox/index.js'
import { buildClaudeSandboxSettings, claudeSandboxKeeps } from './sandbox-options.js'
import { createTurnWatchdog, resolveCliTurnTimeouts, type CliTurnTimeoutsSource } from '../../cli-turn-watchdog.js'
import { cliOutputCapFor } from '../../cli-output-cap.js'

/**
 * Lazily-resolved governance deps (ordering-safe — read at stream() time).
 * The run tree is not the provider's: the agent runner emits it for every
 * provider from the events this stream yields.
 */
export interface ClaudeCodeGovernance {
  securityGate?: {
    validateToolCall(toolName: string, input: Record<string, unknown>, ctx?: { conversationId?: string; agentId?: string; workingDirectories?: readonly string[] }): GateDecision | Promise<GateDecision>
    /**
     * The gate's deterministic, audited memory-path check (one
     * security_events row per deny). The memory-policy PreToolUse hook asks
     * it; without it the hook asks the process-wide path policy (same
     * verdict, no audit row).
     */
    checkMemoryPath?: MemoryPathHookCheck
    autonomyPolicy?: {
      categoryForTool(name: string): string | null
      resolve(category: string): { level: number; locked: boolean; maxLevel: number }
      /** Returns the (possibly deduped) approval row id — see permission-bridge's park sink. */
      createApproval(rec: { category: string; toolName: string; agentId?: string; conversationId?: string; reason: string }): number | void
    }
  }
}

/** Default max agentic tool-use turns: the interactive turn budget every provider shares. */
const DEFAULT_MAX_TURNS = DEFAULT_AGENT_MAX_TURNS

/**
 * SDK message types that carry model output (or a tool result the model will
 * read). None of them may arrive before the CLI's system/init message was
 * checked: with partial messages on, a `stream_event` delta is the first
 * token of the answer.
 */
const MODEL_OUTPUT_MESSAGES: ReadonlySet<string> = new Set(['stream_event', 'assistant', 'user', 'result'])

/**
 * How a Claude Code model names an EYAS tool: the runtime lists the tools of
 * the in-process MCP server `eyas` (mcpServers.eyas in stream()) as
 * `mcp__eyas__<name>`. Prompts render EYAS tool names through it
 * (model/tool-addressing.ts), so they name the tool the model actually has.
 */
const CLAUDE_CODE_TOOL_ADDRESSING: ToolAddressing = { kind: 'mcp-prefix', prefix: 'mcp__eyas__' }

/**
 * The ToolContext every bridged EYAS call of one query runs with. Built from
 * the request metadata alone (the CLI never says who it acts for) and carrying
 * the turn's identity: projectId locks memory drill-down to the
 * conversation's project, turnId keys the per-turn drill budget, runId
 * attributes tool_executions to the supervised run. A request with no
 * conversation carries no conversationId at all rather than '': an empty
 * string is a real value to the executor's log and to tools that default with
 * `??`, while every consumer reads a missing id as "no conversation".
 */
function bridgeToolContext(
  request: ModelRequest,
  opts: { cwd: string; roots: string[]; logger: ToolContext['logger']; gated: boolean; allowedTools: ReadonlySet<string> },
): ToolContext {
  const md = request.metadata
  const ctx: Omit<ToolContext, 'conversationId'> & { conversationId?: string } = {
    ...(md?.conversationId ? { conversationId: md.conversationId } : {}),
    userId: md?.userId ?? '',
    agentId: md?.agentId,
    teamSessionId: md?.teamSessionId,
    ...(md?.projectId !== undefined ? { projectId: md.projectId } : {}),
    ...(md?.turnId ? { turnId: md.turnId } : {}),
    ...(md?.runId ? { runId: md.runId } : {}),
    // The turn's model: a sub-conversation a bridged tool creates stores it.
    ...(md?.modelBinding ? { modelBinding: { ...md.modelBinding } } : {}),
    // Bridged file tools work in the same folders as the CLI itself.
    workingDirectory: opts.cwd,
    workingDirectories: opts.roots,
    logger: opts.logger,
    // The EYAS executor authorizes every bridged call. When governance is
    // wired, canUseTool already gated this call — marked so the executor
    // enforces CASL without re-judging.
    actor: { kind: 'agent', role: 'agent' },
    securityPipelineHandled: opts.gated,
    // The bridged set is all the query may run: the executor refuses any
    // other name, trusted pipeline or not.
    allowedTools: opts.allowedTools,
  }
  return ctx as ToolContext
}

/**
 * Known models — the first-boot seed listModels() returns, with no CLI call.
 * Each row names a CLI alias only: which concrete model an alias resolves to
 * is decided by the Claude Code runtime that runs it, so no realModelId and
 * no effort levels are claimed here. Nor a larger window than the runtime
 * gives the bare alias: the window comes from the one function discovery uses
 * (claudeCodeWindowFor, backed by THE window resolver in model-window.ts), so
 * the seed, the context bar and prompt sizing agree before any discovery has
 * run. fetchModels() (zero-cost discovery on the resolved runtime,
 * discovery.ts) replaces them with what the runtime offers: the concrete
 * model and its effort levels per alias.
 */
const KNOWN_MODELS: readonly ModelInfo[] = [
  seedModel('fable', 'Fable', 128_000),
  seedModel('opus', 'Opus', 128_000),
  seedModel('sonnet', 'Sonnet', 64_000),
  seedModel('haiku', 'Haiku', 64_000),
]

/** One seed row: `claude-code-<alias>`, selected by the alias, windowed as discovery would window it. */
function seedModel(alias: string, label: string, maxOutputTokens: number): ModelInfo {
  return {
    id: `${CLAUDE_CODE_MODEL_PREFIX}${alias}`,
    name: `Claude Code (${label})`,
    provider: 'claude-code',
    contextWindow: claudeCodeWindowFor(alias),
    maxOutputTokens,
    supportsTools: true,
    supportsImages: true,
    supportsStreaming: true,
    metadata: { alias },
  }
}

/** The id that runs whatever model the runtime itself defaults to (no model option). */
const CLAUDE_CODE_DEFAULT_MODEL_ID = 'claude-code-default'

/**
 * The persisted model_config metadata of one claude-code model id: the alias
 * selects the model, the discovered reasoning bounds the effort sent.
 */
export type ClaudeModelMetadataLookup = (eyasModelId: string) => Pick<ModelConfigMetadata, 'alias' | 'realModelId' | 'reasoning'> | null | undefined

/**
 * The model option for an EYAS id: the persisted alias, else the seed's alias
 * (KNOWN_MODELS metadata — the only id → alias table), else the id minus its
 * prefix, else the id itself (a full model name such as 'claude-opus-4-8').
 * Undefined runs the runtime's default; an id naming no model throws.
 */
function claudeModelFor(modelId: string | undefined, lookup?: ClaudeModelMetadataLookup): string | undefined {
  return resolveCliModel({
    prefix: CLAUDE_CODE_MODEL_PREFIX,
    defaultId: CLAUDE_CODE_DEFAULT_MODEL_ID,
    eyasModelId: modelId,
    field: 'alias',
    lookup: (id) => {
      let persisted: string | undefined
      try { persisted = lookup?.(id)?.alias } catch { persisted = undefined }
      const seeded = KNOWN_MODELS.find((m) => m.id === id)?.metadata?.alias
      const alias = persisted ?? (typeof seeded === 'string' ? seeded : undefined)
      return alias ? { alias } : null
    },
  })
}

/** A prompt content block in the SDK's (Anthropic Messages) shape. */
type SdkPromptBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string } }

/** A query prompt: plain text, or content blocks when it carries images. */
type SdkPrompt = string | SdkPromptBlock[]

/** One image in the SDK's shape: its base64 bytes, or a URL the API fetches. */
function sdkImage(block: ImageBlock): SdkPromptBlock {
  return block.source.type === 'url'
    ? { type: 'image', source: { type: 'url', url: block.source.data } }
    : { type: 'image', source: { type: 'base64', media_type: block.source.mediaType, data: block.source.data } }
}

/**
 * One message's text and images as SDK blocks, in their own order. Adjacent
 * text is joined with a newline and blank text is dropped; tool and thinking
 * blocks carry no conversation content here.
 */
function messageBlocks(content: string | ContentBlock[]): SdkPromptBlock[] {
  if (typeof content === 'string') return content.trim() ? [{ type: 'text', text: content }] : []
  const blocks: SdkPromptBlock[] = []
  for (const block of content) {
    if (block.type === 'text') {
      if (!block.text?.trim()) continue
      const last = blocks[blocks.length - 1]
      if (last?.type === 'text') last.text += `\n${block.text}`
      else blocks.push({ type: 'text', text: block.text })
    } else if (block.type === 'image') {
      blocks.push(sdkImage(block))
    }
  }
  return blocks
}

/** Blocks as a prompt: nothing is '', a single text block is its plain text. */
function asPrompt(blocks: SdkPromptBlock[]): SdkPrompt {
  if (blocks.length === 0) return ''
  if (blocks.length === 1 && blocks[0].type === 'text') return blocks[0].text
  return blocks
}

/**
 * The prompt of one query. EYAS replays the conversation from its own store
 * every turn and the CLI never resumes a session of its own, so the earlier
 * turns travel in a <conversation-history> frame ahead of the latest message
 * (a turn with neither text nor an image is left out). An image from an
 * earlier turn keeps its place in that frame, the text split around it, so
 * the model sees every image of the conversation the way an API provider
 * does, not only the latest message's. A text-only conversation stays one
 * plain string.
 */
function buildPromptWithHistory(request: ModelRequest): SdkPrompt {
  const msgs = request.messages
  const lastMsg = msgs[msgs.length - 1]
  if (!lastMsg) return ''
  const latest = messageBlocks(lastMsg.content)

  const history: SdkPromptBlock[] = []
  const write = (text: string): void => {
    const tail = history[history.length - 1]
    if (tail?.type === 'text') tail.text += text
    else history.push({ type: 'text', text })
  }
  let turns = 0
  for (const m of msgs.slice(0, -1)) {
    const blocks = messageBlocks(m.content)
    if (blocks.length === 0) continue
    write(turns === 0 ? '<conversation-history>\n' : '\n\n')
    write(`${m.role === 'user' ? 'User' : 'Assistant'}: `)
    for (const block of blocks) {
      if (block.type === 'text') write(block.text)
      else history.push(block)
    }
    turns++
  }
  if (turns === 0) return asPrompt(latest)
  write('\n</conversation-history>\n\n')

  const prompt = asPrompt(latest)
  if (history.length === 1 && history[0].type === 'text' && typeof prompt === 'string') return history[0].text + prompt
  return [...history, ...latest]
}

export interface ClaudeCodeProviderOptions {
  /**
   * The Claude Code binary every query() runs (pathToClaudeCodeExecutable),
   * from resolveClaudeRuntime() — the same one the sign-in check and doctor
   * see. Without it stream() refuses to run rather than let the SDK pick a
   * binary of its own.
   */
  runtime?: ClaudeRuntime
  /** Tool executor for MCP bridge — when provided, EYAS tools are bridged to SDK */
  toolExecutor?: BridgeToolExecutor
  /** Tool registry for dynamic tool listing */
  toolRegistry?: ToolRegistry
  /** Logger instance */
  logger?: import('pino').Logger
  /** Maximum agentic tool-use turns (default: 25) */
  maxTurns?: number
  /**
   * Lazily-resolved governance deps. Called at stream() time
   * (not construction) so module-init ordering doesn't matter. When it returns
   * a securityGate, every tool call (builtins and bridged EYAS tools) runs
   * governed via canUseTool; when absent, the provider fail-closes (default
   * permissionMode).
   */
  getGovernance?: () => ClaudeCodeGovernance | undefined
  /**
   * The persisted model_config metadata of one claude-code model id (the
   * manifest reads ctx.providerConfig): its alias selects the model, its
   * discovered reasoning bounds the effort sent.
   */
  lookupModelMetadata?: ClaudeModelMetadataLookup
  /** How fetchModels() runs the discovery probe (tests inject the query). */
  discovery?: Omit<ClaudeProbeOptions, 'logger'>
  /**
   * The kernel file sandbox decision for queries with tools (B5). Default:
   * the configured security.cliSandbox and this host's detection.
   */
  sandbox?: CliSandboxDeps
  /**
   * How long a query may go quiet (model.cli: idle, and while a tool runs),
   * read at the start of every stream() — the manifest passes a getter over
   * the live config. Default: the documented defaults (cli-turn-watchdog.ts).
   */
  turnTimeouts?: CliTurnTimeoutsSource
}

export function createClaudeCodeProvider(options: ClaudeCodeProviderOptions = {}): AIProvider {
  const { runtime, toolExecutor, toolRegistry, logger: providerLogger, maxTurns = DEFAULT_MAX_TURNS, getGovernance, lookupModelMetadata, sandbox, turnTimeouts, discovery } = options
  const modelFor = (modelId: string | undefined) => claudeModelFor(modelId, lookupModelMetadata)
  /** What discovery on the runtime stored for a model (the default id when none is named). */
  const discoveredReasoningFor = (modelId: string | undefined) => {
    try {
      return lookupModelMetadata?.(modelId || CLAUDE_CODE_DEFAULT_MODEL_ID)?.reasoning ?? null
    } catch {
      return null
    }
  }
  return {
    id: 'claude-code',
    name: 'Claude Code CLI',
    // Every query runs on the isolated options (buildClaudeIsolationOptions):
    // no host settings, CLAUDE.md, skills, filesystem MCP or auto-memory. An
    // isolated request additionally gets no tools, a single turn and an
    // answer bounded by its maxTokens. (The CLI's enterprise-managed policy
    // tier always applies.)
    supportsIsolatedCompletion: true,
    toolAddressing: CLAUDE_CODE_TOOL_ADDRESSING,

    async listModels() {
      return [...KNOWN_MODELS]
    },

    /**
     * Zero-cost discovery on the resolved runtime (discovery.ts): the models
     * it offers, the concrete model each alias runs and its effort levels —
     * from the runtime's `initialize` answer, with no prompt and no model
     * call. Throws when nothing usable came back, so a failed discovery never
     * reads as "no models".
     */
    async fetchModels() {
      if (!runtime) {
        throw new Error('claude-code: no resolved Claude Code runtime — build the provider with the runtime from resolveClaudeRuntime()')
      }
      const probe = await probeClaudeRuntime(runtime, { ...discovery, logger: providerLogger })
      return claudeModelsFromDiscovery(probe, new Date().toISOString())
    },

    async complete(request: ModelRequest): Promise<ModelResponse> {
      // Delegate to stream and collect
      let fullText = ''
      let response: ModelResponse | null = null
      for await (const event of this.stream(request)) {
        if (event.type === 'text') fullText += event.text
        if (event.type === 'done') response = event.response
      }
      return response ?? {
        id: `cc-${Date.now()}`,
        provider: 'claude-code',
        model: request.model || CLAUDE_CODE_DEFAULT_MODEL_ID,
        content: [{ type: 'text', text: fullText }],
        stopReason: 'end',
        usage: { inputTokens: 0, outputTokens: 0 },
      }
    },

    // Typed as the contract: this provider emits no deprecated event (no
    // tool_use_end, no context_compact).
    async *stream(request: ModelRequest): AsyncIterable<ContractStreamEvent> {
      if (!runtime) {
        throw new Error('claude-code: no resolved Claude Code runtime — build the provider with the runtime from resolveClaudeRuntime()')
      }
      // One AbortController ends the SDK's internal agentic loop, not just an
      // EYAS turn boundary: the caller's cancellation (RunSupervisor / operator
      // Stop) and the turn watchdog. The watchdog stops a query only when the
      // CLI goes quiet — idle with no tool in flight, or past the tool budget
      // while one runs — never after a fixed whole-turn time, and its
      // TimeoutError is what the turn then fails with ('timeout', not
      // 'aborted').
      const abortController = new AbortController()
      const watchdog = createTurnWatchdog({
        ...resolveCliTurnTimeouts(turnTimeouts),
        label: 'Claude Code',
        abort: (reason) => abortController.abort(reason),
      })
      if (request.signal) {
        if (request.signal.aborted) abortController.abort()
        else request.signal.addEventListener('abort', () => abortController.abort(), { once: true })
      }

      // Build SDK query options. NOTE: permissionMode is NOT set here — it is
      // decided by the governance block below (canUseTool when governed, else
      // fail-closed default mode).
      // An ISOLATED request is EYAS asking this CLI's model a question, not
      // asking the CLI to be an agent: one turn, no tools. See
      // ModelRequest.isolated.
      const isolated = request.isolated === true

      // The CLI treats its cwd as the project it may read without asking, so
      // it is never the server's own cwd (the EYAS home holds master.key, the
      // vault and the database): a stored folder that still validates, else
      // the conversation's workspace, else a run scratch folder.
      //
      // The isolation contract — identical for chat, background and isolated
      // queries: the resolved runtime (never the SDK's own default lookup), no
      // CLI transcript, no host settings/CLAUDE.md/skills, no filesystem MCP,
      // no checkpoints, an allowlisted env with the auto-memory and CLAUDE.md
      // kill switches.
      //
      // The turn's folders (roots) — the cwd plus every stored folder that
      // still validates — are what the memory-path policy judges "this
      // conversation's workspace" against, in the hook and in canUseTool
      // alike. Built here from the request, never from the CLI's report.
      // The query's own temp folder (the CLI's CLAUDE_CODE_TMPDIR) is one of
      // them: the CLI writes its background command output there and the
      // model may read it back; it is created right before the CLI starts
      // and removed when the query ends.
      const queryTmp = cliQueryTmp()
      let cwd: string
      let roots: string[]
      let isolation: ReturnType<typeof buildClaudeIsolationOptions>
      // The model the runtime runs (claudeModelFor); undefined = its default.
      let cliModel: string | undefined
      try {
        cliModel = modelFor(request.model)
        cwd = resolveCliCwd(request, { logger: providerLogger })
        roots = [...resolveCliRoots(request, cwd), queryTmp.dir]
        isolation = buildClaudeIsolationOptions({ cwd, executable: runtime.path, tmpDir: queryTmp.dir })
      } catch (err) {
        watchdog.dispose()
        throw err
      }

      const queryOptions: Record<string, unknown> = {
        ...isolation,
        // Per-agent turn budget (agent.maxTurns) when the caller sets it, else
        // the provider-wide default. An isolated call answers in one turn by
        // construction — there is nothing for a second turn to do.
        maxTurns: isolated ? 1 : (request.maxTurns ?? maxTurns),
        systemPrompt: request.system ?? '',
        abortController,
        // Text and thinking stream live (stream_event deltas), like every
        // other provider; the normalizer de-duplicates the complete assistant
        // message that follows each streamed one.
        includePartialMessages: true,
      }

      // The stream contract (G1) for this query: SDK messages in, the same
      // events every provider emits out. EYAS's own refusals (the permission
      // bridge's and the memory-policy hook's) are recorded on it, so a
      // refused call's row settles as denied / approval_required — never as a
      // plain tool error or a green row.
      const normalizer = createClaudeStreamNormalizer({
        // The EYAS id asked for; no id means the runtime's own default.
        model: request.model || CLAUDE_CODE_DEFAULT_MODEL_ID,
        logger: providerLogger,
        // An isolated completion's answer stops at maxTokens × 4 characters
        // (cli-output-cap.ts): the runtime takes no output limit from EYAS.
        outputCap: cliOutputCapFor(request),
      })

      // Governance (P1). Resolved lazily so module init ordering is
      // irrelevant. Resolved BEFORE the MCP bridge because the bridge's tool
      // context needs to know whether canUseTool will gate the calls it
      // forwards to the EYAS executor.
      const gov = getGovernance?.()

      // The turn's tool scope (the names the request offers, Solo's
      // delegation family removed) bounds both the EYAS bridge and the CLI's
      // own built-ins (tools/cli-exposure.ts): no write_file/edit_file in it,
      // no Write/Edit; no run_command, no Bash; no web tool, no
      // WebFetch/WebSearch. Reading always stays.
      const toolScope = requestToolScope(request)
      const nativeCapabilities = nativeCapabilitiesFor(toolScope)

      // The built-in tools are always an explicit list, whatever the
      // orchestration mode and whether or not a bridge is wired: an unset
      // `tools` would hand the model the runtime's full default set, its
      // native subagent spawner included. The ones the scope does not grant
      // are also disallowed, so the runtime refuses them outright. An
      // isolated call gets no tools at all — not the EYAS bridge, and not the
      // builtins. A one-shot extraction has no business reading a filesystem.
      const builtins = claudeCodeBuiltins(nativeCapabilities)
      queryOptions['tools'] = isolated ? [] : builtins.tools
      if (!isolated && builtins.disallowed.length > 0) queryOptions['disallowedTools'] = builtins.disallowed

      // Kernel file sandbox for the CLI's shell (B5), on every query with
      // tools: the memory-sovereignty deny list for reads and writes, the
      // turn's folders writable (sandbox-options.ts). None on this host:
      // 'auto' runs and says so once per conversation, 'required' refuses
      // here, before the CLI starts. A query without tools needs none.
      let sandboxTurn: CliSandboxTurn | null = null
      if (!isolated) {
        try {
          sandboxTurn = await planCliSandboxTurn('claude-code', {
            conversationId: request.metadata?.conversationId,
            mode: sandbox?.mode?.(),
            host: sandbox?.host,
          })
          if (sandboxTurn.sandboxed) {
            const homeDir = currentHomeDir()
            const denyPaths = getPathPolicy().kernelDenyList({ workingDirectories: roots })
            queryOptions['sandbox'] = buildClaudeSandboxSettings({
              mode: sandboxTurn.mode,
              denyPaths,
              writableDirectories: roots,
              readableDirectories: exemptableDirs(claudeSandboxKeeps({ homeDir, executable: runtime.path }), homeDir, denyPaths),
            })
          }
        } catch (err) {
          watchdog.dispose()
          throw err
        }
        if (!sandboxTurn.sandboxed && sandboxTurn.notice) yield sandboxTurn.notice
      }

      // MCP bridge: expose EYAS tools to the SDK's agentic loop — the
      // request's tool scope, minus the tools Claude Code's granted built-ins
      // stand in for. Never a tool the caller did not offer.
      if (!isolated && toolExecutor && toolRegistry) {
        const registered = toolRegistry.list()
        const bridgeTools = selectBridgeTools(
          registered,
          scopeAllowlist(toolScope, registered.map((t) => t.name)),
          nativeCapabilities,
        )
        if (bridgeTools.length > 0) {
          const ctx = bridgeToolContext(request, {
            cwd,
            roots,
            logger: providerLogger ?? (console as any),
            gated: Boolean(gov?.securityGate),
            allowedTools: new Set(bridgeTools.map((t) => t.name)),
          })
          const mcpServer = buildMcpBridge(bridgeTools, toolExecutor, ctx)
          queryOptions['mcpServers'] = { eyas: mcpServer }
        }
      }

      if (gov?.securityGate) {
        // Every tool call (SDK builtins + mcp__eyas__*) routes through the EYAS
        // gate. Classification is fail-closed (F0 R4): only a construction
        // site that explicitly labels its metadata as human-attended
        // (origin: interactive/channel, no team session) is treated as
        // interactive; everything else — including absent metadata — is
        // autonomous and governed by the graduated-autonomy ladder.
        queryOptions['canUseTool'] = createPermissionBridge({
          validateToolCall: gov.securityGate.validateToolCall,
          autonomy: gov.securityGate.autonomyPolicy,
          autonomous: isAutonomousRequest(request.metadata),
          // runId stamps every enqueued approval with the run that must be
          // woken when an operator decides — a CLI-path park is unresumable
          // without it.
          // workingDirectories: the turn's folders, so the gate's memory-path
          // policy also refuses another conversation's workspace.
          ctx: { conversationId: request.metadata?.conversationId, agentId: request.metadata?.agentId, runId: request.metadata?.runId, workingDirectories: roots },
          // F2 T5 — per-request park sink: the SDK's loop denies the escalated
          // call in-session, this is how the runner learns what to park on.
          onEscalatedApproval: request.metadata?.onEscalatedApproval,
          // A resumed run's do-not-repeat ledger: the SDK runs its tools
          // itself, so the bridge is where a repeat is refused.
          ledger: request.metadata?.idempotencyLedger,
          // Every non-allow verdict settles its tool row with the real
          // outcome and announces a call that waits on a human.
          onDecision: (decision) => normalizer.recordDecision(decision),
          // A command that asks to leave the sandbox ('auto') waits on a human.
          ...(sandboxTurn?.sandboxed ? { cliSandboxMode: sandboxTurn.mode } : {}),
          logger: providerLogger,
        })
      } else {
        // No governance wired — fail closed. bypassPermissions is deliberately
        // NOT used (design 2026-07-08 Decision 2): an ungoverned run must not
        // silently gain full tool access. Headless 'default' mode denies
        // permission-gated tools instead.
        queryOptions['permissionMode'] = 'default'
        providerLogger?.warn('claude-code: no security gate wired — running fail-closed (default permissionMode)')
      }

      // Memory sovereignty for Claude Code's own tools: one deterministic
      // PreToolUse hook on every query that has tools, so reads the CLI would
      // allow without asking (and never route to canUseTool) are checked too.
      // Only a query with no tools at all (`tools: []`, the isolated call)
      // goes without it. The gate's audited check when a gate is wired, else
      // the process-wide path policy — never "no policy".
      const hasTools = !(Array.isArray(queryOptions['tools']) && (queryOptions['tools'] as unknown[]).length === 0)
      const gate = gov?.securityGate
      const gateMemoryCheck: MemoryPathHookCheck | undefined = gate?.checkMemoryPath
        ? (toolName, input, hookCtx) => gate.checkMemoryPath!(toolName, input, hookCtx)
        : undefined
      const sovereigntyHooks: ClaudeHookSet | undefined = hasTools
        ? {
            hooks: {
              PreToolUse: [buildMemoryPathHook({
                check: memoryPathHookCheckFor(gateMemoryCheck),
                ctx: { workingDirectories: roots, conversationId: request.metadata?.conversationId, agentId: request.metadata?.agentId },
                logger: providerLogger,
                onDeny: ({ toolUseId, toolName, reason }) => normalizer.recordDecision({ toolUseId, toolName, outcome: 'denied', reason }),
              })],
            },
          }
        : undefined

      // The effective effort, read back from the runtime's own hook inputs
      // (reasoning.ts) — on every query, isolated ones included.
      const effortReadback = createEffortReadback()

      // The one write of queryOptions.hooks: every contributor goes through
      // mergeHooks' fixed slot order (the policy hook first, the readback after).
      applyHooks(queryOptions, { sovereignty: sovereigntyHooks, readback: effortReadback.hooks })

      // The selected model steers the runtime; only "no model" (or the
      // default id) leaves the choice to the runtime's own default.
      if (cliModel) queryOptions['model'] = cliModel

      // Reasoning: the gateway's plan for THIS model, mapped to what the
      // running binary accepts (reasoning.ts). Nothing requested → nothing
      // sent, and the runtime applies the model's own default; a level goes
      // on the wire only when this binary reported it for the model.
      const reasoning = toClaudeCodeReasoningOptions({
        plan: request.effortPlan,
        discovered: discoveredReasoningFor(request.model),
        runtimeVersion: runtime.version,
      })
      if (reasoning.effort) queryOptions['effort'] = reasoning.effort
      if (reasoning.thinking) queryOptions['thinking'] = reasoning.thinking
      if (reasoning.extraArgs) queryOptions['extraArgs'] = reasoning.extraArgs
      if (request.effortPlan && request.effortPlan.level !== reasoning.sent) {
        providerLogger?.debug({ planned: request.effortPlan.level, sent: reasoning.sent, model: request.model }, 'claude-code: effort limited to what the runtime reported for the model')
      }

      // Continuity is EYAS replay only: the prompt always carries the
      // conversation history, and no query ever resumes a CLI session.
      const promptContent = buildPromptWithHistory(request)

      // Use SDKUserMessage format for multimodal content
      let promptArg: string | AsyncIterable<any>
      if (typeof promptContent === 'string') {
        promptArg = promptContent
      } else {
        promptArg = (async function* () {
          yield {
            type: 'user' as const,
            message: { role: 'user' as const, content: promptContent },
            parent_tool_use_id: null,
          }
        })()
      }

      // close(): the SDK's documented way to end a running query (below).
      let conversation: AsyncIterable<any> & { close?: () => void }
      try {
        queryTmp.create()
        conversation = query({
          prompt: promptArg,
          options: queryOptions as any,
        })
      } catch (err) {
        queryTmp.release()
        watchdog.dispose()
        throw err
      }

      // The turn's end. The SDK's result message decides it (normalizer
      // finish()); a stream that stops without one ends on what it streamed.
      let response: ModelResponse | null = null

      // Isolation tripwire. The CLI reports what it actually loaded in its
      // system/init message, before any model output; anything outside the
      // contract (an MCP server EYAS did not pass, a plugin, a permission mode
      // other than 'default', another cwd) aborts the query before a single
      // token of the answer is used. An answer with no init before it fails
      // the same way: an unverified run is never treated as isolated.
      const cliRuntime = runtime
      const expectedMcpServers = Object.keys((queryOptions['mcpServers'] as Record<string, unknown> | undefined) ?? {})
      let initVerified = false
      const tripwire = (violations: CliIsolationViolation[], version?: string): never => {
        abortController.abort()
        setIsolationStatus('claude-code', {
          status: 'violation',
          checks: violations,
          runtime: { path: cliRuntime.path, version: version ?? cliRuntime.version, source: cliRuntime.source },
        })
        providerLogger?.error({ violations }, 'claude-code: isolation tripwire fired — query aborted')
        throw new CliIsolationError('claude-code', violations)
      }

      try {
        for await (const msg of conversation) {
          // Every SDK message is activity: the watchdog's silence clock starts over.
          watchdog.touch()
          // Calls EYAS refused while the SDK waited on canUseTool: their
          // approval cards go out before whatever the runtime says next.
          for (const event of normalizer.drainApprovals()) yield event

          if (msg.type === 'system' && (msg as any).subtype === 'init') {
            const verdict = checkClaudeInit(msg, { cwd, mcpServers: expectedMcpServers })
            if (!verdict.ok) tripwire(verdict.violations, verdict.snapshot.version)
            setIsolationStatus('claude-code', {
              status: 'verified',
              checks: [],
              runtime: { path: cliRuntime.path, version: verdict.snapshot.version ?? cliRuntime.version, source: cliRuntime.source },
            })
            initVerified = true
            normalizer.observeInit(msg)
            continue
          }
          // Anything that carries model output (a streamed delta included)
          // before a verified init is an unverified run.
          if (!initVerified && MODEL_OUTPUT_MESSAGES.has(String(msg.type))) {
            tripwire([initMissingViolation(String(msg.type))])
          }

          if (msg.type === 'result') {
            // Success and the runtime's own turn limit end the turn with an
            // answer (the partial one for the limit); any other subtype is a
            // failed run whose partial answer and usage (with the cost it
            // billed) ride on the error.
            const end = normalizer.finish(msg)
            if (end.kind === 'failed') throw end.error
            response = end.response
            continue
          }

          for (const event of normalizer.push(msg)) {
            // A tool row that opens puts the watchdog on the tool budget
            // until it settles (a bridged specialist may run for minutes
            // without a single SDK message).
            watchdog.observe(event)
            yield event
            // A refusal recorded before its row opened is announced right after it.
            if (event.type === 'tool_use_start') {
              for (const approval of normalizer.drainApprovals()) yield approval
            }
          }
          // The answer passed an isolated completion's output cap: the CLI
          // is stopped now, and the turn ends with what fit ('max_tokens').
          if (normalizer.outputCapped) {
            // close() first: it ends the query the documented way and drops a
            // control request still in flight (a hook callback answered after
            // a bare abort rejects unhandled inside the SDK). The abort then
            // stops anything close() left running.
            try {
              conversation.close?.()
            } catch {
              // The abort below still stops the CLI.
            }
            abortController.abort()
            break
          }
        }
        // A query the watchdog stopped before its result is a timeout even
        // when the SDK wound down quietly instead of throwing: never a 'done'
        // on a cut-off answer.
        if (watchdog.timedOut && !response) throw watchdog.errorFor(undefined)
        for (const event of normalizer.drainApprovals({ final: true })) yield event
        for (const event of normalizer.settleRefused()) yield event
        response ??= normalizer.finishWithoutResult()
      } catch (err) {
        // An interrupting deny (a call parked for approval) ends the SDK's
        // loop before it reports the refusal: the card is still announced and
        // the row settled with its real outcome before the failure surfaces.
        for (const event of normalizer.drainApprovals({ final: true })) yield event
        for (const event of normalizer.settleRefused()) yield event
        // Stopped by the watchdog: the turn fails with its TimeoutError, not
        // with the SDK's "aborted by user" (classified 'aborted').
        if (!normalizer.outputCapped || watchdog.timedOut) throw watchdog.errorFor(err)
        // Stopped for the output cap, and the SDK threw on its way out: the
        // turn still ends with what fit, as an outcome.
        response = normalizer.finishWithoutResult()
      } finally {
        watchdog.dispose()
        // The CLI has exited (or is being stopped): its temp root goes with it.
        queryTmp.release()
      }

      // The level the runtime reports it ran at (after any silent downgrade
      // of its own) confirms the effective effort; without a report nothing
      // is claimed and the gateway's outcome stands.
      const effortOutcome = readbackOutcome(request.effortPlan, effortReadback.effective())
      if (effortOutcome) response = { ...response, effortOutcome }

      yield { type: 'done', response }
    },
  }
}
