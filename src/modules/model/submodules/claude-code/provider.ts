// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { query, getSessionInfo } from '@anthropic-ai/claude-agent-sdk'
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { AIProvider, ModelInfo, ModelRequest, ModelResponse, StreamEvent, ContentBlock } from '../../types.js'
import type { ToolRegistry } from '@modules/tools/tool-registry.js'
import type { BridgeToolExecutor } from './mcp-bridge.js'
import { buildMcpBridge } from './mcp-bridge.js'
import { createPermissionBridge, isAutonomousRequest, type GateDecision } from './permission-bridge.js'
import { buildOrchestrationHooks } from './orchestration-hooks.js'
import { createRunSeq, type OrchestrationEvent } from '@shared/orchestration-events.js'
import { ProviderRunError } from '@shared/classify-model-error.js'

/** Lazily-resolved governance + orchestration deps (ordering-safe — read at stream() time). */
export interface ClaudeCodeGovernance {
  securityGate?: {
    validateToolCall(toolName: string, input: Record<string, unknown>, ctx?: { conversationId?: string; agentId?: string }): GateDecision | Promise<GateDecision>
    autonomyPolicy?: {
      categoryForTool(name: string): string | null
      resolve(category: string): { level: number; locked: boolean; maxLevel: number }
      /** Returns the (possibly deduped) approval row id — see permission-bridge's park sink. */
      createApproval(rec: { category: string; toolName: string; agentId?: string; conversationId?: string; reason: string }): number | void
    }
  }
  agentRegistry?: { list(filter?: { enabled?: boolean }): Array<{ id: string; name: string; role?: string; goal?: string; systemPrompt?: string; tools?: string[]; model?: string; effort?: string }> }
  orchestrationSink?: (event: OrchestrationEvent) => void
}

/** Map EYAS agent definitions → SDK subagent definitions for `options.agents`. */
const AGENT_EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'max'])

function mapAgentDefinitions(
  agents: Array<{ id: string; name: string; role?: string; goal?: string; systemPrompt?: string; tools?: string[]; model?: string; effort?: string }>,
): Record<string, AgentDefinition> {
  const out: Record<string, AgentDefinition> = {}
  for (const a of agents) {
    out[a.id] = {
      description: a.goal || a.role || a.name || a.id,
      prompt: a.systemPrompt || a.goal || a.name || a.id,
      ...(a.tools && a.tools.length > 0 ? { tools: a.tools } : {}),
      ...(a.model && MODEL_TO_CLI_ALIAS[a.model] ? { model: MODEL_TO_CLI_ALIAS[a.model] } : {}),
      ...(a.effort && AGENT_EFFORT_LEVELS.has(a.effort) ? { effort: a.effort as 'low' | 'medium' | 'high' | 'max' } : {}),
    }
  }
  return out
}

/** Default timeout for Claude Code SDK queries (10 minutes) */
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

/** Default max agentic tool-use turns */
const DEFAULT_MAX_TURNS = 25

/** SDK built-in tools to keep active alongside EYAS MCP tools */
const SDK_BUILTIN_TOOLS = [
  'Bash',           // Shell command execution
  'Read',           // File reading
  'Write',          // File writing
  'Edit',           // File editing (search-and-replace)
  'Glob',           // File pattern matching
  'Grep',           // Content search
  'NotebookEdit',   // Jupyter notebook editing
  'WebFetch',       // HTTP requests
  'WebSearch',      // Web search
  'Task',           // Native subagent spawn — governed via canUseTool (P1)
]

/** Model aliases the CLI supports — we probe these to discover real model IDs */
const CLI_MODEL_ALIASES = ['fable', 'opus', 'sonnet', 'haiku']

/**
 * Known models — returned instantly on listModels() without CLI calls.
 * Caps are accurate; metadata.realModelId is the concrete model id.
 * Use "Refresh from CLI" to confirm/update realModelId from actual probe.
 */
const KNOWN_MODELS: ModelInfo[] = [
  { id: 'claude-code-fable', name: 'Claude Code (Fable)', provider: 'claude-code', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsImages: true, supportsStreaming: true, metadata: { alias: 'fable', realModelId: 'claude-fable-5' } },
  { id: 'claude-code-opus', name: 'Claude Code (Opus)', provider: 'claude-code', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, supportsImages: true, supportsStreaming: true, metadata: { alias: 'opus', realModelId: 'claude-opus-4-8' } },
  { id: 'claude-code-sonnet', name: 'Claude Code (Sonnet)', provider: 'claude-code', contextWindow: 1_000_000, maxOutputTokens: 64_000, supportsTools: true, supportsImages: true, supportsStreaming: true, metadata: { alias: 'sonnet', realModelId: 'claude-sonnet-4-6' } },
  { id: 'claude-code-haiku', name: 'Claude Code (Haiku)', provider: 'claude-code', contextWindow: 200_000, maxOutputTokens: 64_000, supportsTools: true, supportsImages: true, supportsStreaming: true, metadata: { alias: 'haiku', realModelId: 'claude-haiku-4-5' } },
]

/** Async CLI runner — MUST stay non-blocking (see probeCliModels). */
const execFileAsync = promisify(execFile)

/** Map our model id → the CLI `--model` / SDK alias. */
const MODEL_TO_CLI_ALIAS: Record<string, string> = {
  'claude-code-fable': 'fable',
  'claude-code-opus': 'opus',
  'claude-code-sonnet': 'sonnet',
  'claude-code-haiku': 'haiku',
}

/**
 * Probe the CLI to discover exact model IDs and capabilities.
 * Only called on explicit "Refresh from CLI" — never on startup.
 * Caps come from the accurate KNOWN_MODELS table; only name/realModelId are updated from probe.
 *
 * MUST be asynchronous (execFile, not execFileSync): manifest.ts backgrounds it
 * via `void provider.fetchModels!()`, which only truly backgrounds if we don't
 * block the event loop. A synchronous probe stalls boot ~14s while firing paid
 * LLM calls before the server can accept connections.
 */
async function probeCliModels(): Promise<ModelInfo[]> {
  const byAlias = new Map(KNOWN_MODELS.map((m) => [(m.metadata as any).alias as string, m]))
  const models: ModelInfo[] = []

  for (const alias of CLI_MODEL_ALIASES) {
    const base = byAlias.get(alias)
    if (!base) continue
    try {
      const { stdout } = await execFileAsync('claude', [
        '--model', alias,
        '-p', 'respond ONLY with OK',
        '--output-format', 'json',
      ], { timeout: 30_000, encoding: 'utf-8' })

      const parsed = JSON.parse(stdout)
      const realModelId = Object.keys(parsed.modelUsage ?? {})[0]
      const display = alias.charAt(0).toUpperCase() + alias.slice(1)
      models.push({
        ...base,
        name: realModelId ? `Claude Code (${display}) — ${realModelId}` : base.name,
        metadata: { ...(base.metadata as Record<string, unknown>), ...(realModelId ? { realModelId } : {}) },
      })
    } catch {
      models.push(base) // probe failed — keep accurate known caps
    }
  }

  return models.length > 0 ? models : KNOWN_MODELS
}

/**
 * Build the latest user message content for the Claude Code SDK.
 * Only extracts the LAST message — used when session is valid and SDK
 * already has the full conversation history internally.
 */
function buildLastMessageContent(request: ModelRequest): string | Array<{ type: string; [key: string]: any }> {
  const lastMsg = request.messages[request.messages.length - 1]
  if (!lastMsg) return ''
  return extractContent(lastMsg)
}

/**
 * Build prompt content with conversation history prepended.
 * Used when the SDK session is invalid — the SDK starts fresh and needs
 * the full conversation context injected into the prompt.
 */
function buildPromptWithHistory(request: ModelRequest): string | Array<{ type: string; [key: string]: any }> {
  const msgs = request.messages
  if (msgs.length <= 1) return buildLastMessageContent(request)

  const historyParts: string[] = []
  for (let i = 0; i < msgs.length - 1; i++) {
    const m = msgs[i]
    const role = m.role === 'user' ? 'User' : 'Assistant'
    const text = extractTextContent(m)
    if (text.trim()) {
      historyParts.push(`${role}: ${text}`)
    }
  }

  const lastContent = extractContent(msgs[msgs.length - 1])

  if (historyParts.length === 0) return lastContent

  const historyBlock = `<conversation-history>\n${historyParts.join('\n\n')}\n</conversation-history>\n\n`

  if (typeof lastContent !== 'string') {
    return [{ type: 'text', text: historyBlock }, ...lastContent]
  }

  return `${historyBlock}${lastContent}`
}

/** Extract plain text from a message (for history serialization) */
function extractTextContent(msg: { role: string; content: string | ContentBlock[] }): string {
  if (typeof msg.content === 'string') return msg.content
  return msg.content
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n')
}

/** Extract content in SDK-compatible format from a single message */
function extractContent(msg: { role: string; content: string | ContentBlock[] }): string | Array<{ type: string; [key: string]: any }> {
  if (typeof msg.content === 'string') return msg.content

  const blocks: Array<{ type: string; [key: string]: any }> = []
  for (const block of msg.content) {
    if (block.type === 'text' && block.text?.trim()) {
      blocks.push({ type: 'text', text: block.text })
    } else if (block.type === 'image') {
      blocks.push({
        type: 'image',
        source: {
          type: block.source.type,
          media_type: block.source.mediaType,
          data: block.source.data,
        },
      })
    }
  }

  if (blocks.length === 0) return ''
  if (blocks.length === 1 && blocks[0].type === 'text') return blocks[0].text
  return blocks
}

export interface ClaudeCodeProviderOptions {
  /** Load CLAUDE.md files from the project directory (default: true) */
  loadClaudeMd?: boolean
  /** Tool executor for MCP bridge — when provided, EYAS tools are bridged to SDK */
  toolExecutor?: BridgeToolExecutor
  /** Tool registry for dynamic tool listing */
  toolRegistry?: ToolRegistry
  /** Logger instance */
  logger?: import('pino').Logger
  /** Maximum agentic tool-use turns (default: 25) */
  maxTurns?: number
  /**
   * Lazily-resolved governance + orchestration deps. Called at stream() time
   * (not construction) so module-init ordering doesn't matter. When it returns
   * a securityGate, Claude's own subagents (Task) run fully governed via
   * canUseTool; when absent, the provider fail-closes (default permissionMode).
   */
  getGovernance?: () => ClaudeCodeGovernance | undefined
}

export function createClaudeCodeProvider(options: ClaudeCodeProviderOptions = {}): AIProvider {
  const { loadClaudeMd = true, toolExecutor, toolRegistry, logger: providerLogger, maxTurns = DEFAULT_MAX_TURNS, getGovernance } = options
  return {
    id: 'claude-code',
    name: 'Claude Code CLI',

    async listModels() {
      return KNOWN_MODELS
    },

    /** Probe the CLI for real model details — called by "Refresh from CLI" button */
    async fetchModels() {
      return probeCliModels()
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
        model: request.model || 'claude-code-sonnet',
        content: [{ type: 'text', text: fullText }],
        stopReason: 'end',
        usage: { inputTokens: 0, outputTokens: 0 },
      }
    },

    async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
      // Timeout via AbortController — prevents runaway queries. Also honor the
      // caller's cancellation signal (RunSupervisor / operator cancel) so the
      // SDK's internal agentic loop is interrupted, not just EYAS turn boundaries.
      const abortController = new AbortController()
      const timeoutId = setTimeout(() => abortController.abort(), DEFAULT_TIMEOUT_MS)
      if (request.signal) {
        if (request.signal.aborted) abortController.abort()
        else request.signal.addEventListener('abort', () => abortController.abort(), { once: true })
      }

      // Build SDK query options. NOTE: permissionMode is NOT set here — it is
      // decided by the governance block below (canUseTool when governed, else
      // fail-closed default mode).
      const queryOptions: Record<string, unknown> = {
        // Per-agent turn budget (agent.maxTurns) when the caller sets it, else
        // the provider-wide default.
        maxTurns: request.maxTurns ?? maxTurns,
        systemPrompt: request.system ?? '',
        cwd: process.cwd(),
        abortController,
      }

      // Solo mode: the conversation owner opted out of provider-native
      // fan-out — no Task tool, no subagent roster.
      const soloMode = request.orchestration === 'solo'

      // Governance + Claude-driven subagents (P1). Resolved lazily so module
      // init ordering is irrelevant. Resolved BEFORE the MCP bridge because the
      // bridge's tool context needs to know whether canUseTool will gate the
      // calls it forwards to the EYAS executor.
      const gov = getGovernance?.()

      // MCP bridge: expose EYAS tools to the SDK's agentic loop
      if (toolExecutor && toolRegistry) {
        const bridgeTools = toolRegistry.list().filter(t => !['shell', 'browser'].includes(t.category))
        if (bridgeTools.length > 0) {
          const ctx = {
            conversationId: request.metadata?.conversationId ?? '',
            userId: request.metadata?.userId ?? '',
            agentId: request.metadata?.agentId,
            teamSessionId: request.metadata?.teamSessionId,
            logger: providerLogger ?? (console as any),
            // The EYAS executor authorizes every bridged call. When governance
            // is wired, canUseTool below already gated this call — mark it so
            // the executor enforces CASL without re-judging.
            actor: { kind: 'agent' as const, role: 'agent' as const },
            securityPipelineHandled: Boolean(gov?.securityGate),
          }
          const mcpServer = buildMcpBridge(bridgeTools, toolExecutor, ctx)
          queryOptions['mcpServers'] = { eyas: mcpServer }
          queryOptions['tools'] = soloMode ? SDK_BUILTIN_TOOLS.filter((t) => t !== 'Task') : SDK_BUILTIN_TOOLS
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
          ctx: { conversationId: request.metadata?.conversationId, agentId: request.metadata?.agentId, runId: request.metadata?.runId },
          // F2 T5 — per-request park sink: the SDK's loop denies the escalated
          // call in-session, this is how the runner learns what to park on.
          onEscalatedApproval: request.metadata?.onEscalatedApproval,
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

      if (gov?.agentRegistry && !soloMode) {
        const defs = mapAgentDefinitions(gov.agentRegistry.list({ enabled: true }))
        if (Object.keys(defs).length > 0) queryOptions['agents'] = defs
      }

      // Orchestration visibility for EVERY governed run: team runs join the
      // team tree (runId = teamSessionId, root owned by routes-team); plain
      // conversations get their own run (runId = conversationId) with a root
      // node emitted here.
      const conversationId = request.metadata?.conversationId
      const isTeamRun = Boolean(request.metadata?.teamSessionId)
      const runId = request.metadata?.teamSessionId ?? conversationId
      const rootNodeId = conversationId ? `conv:${conversationId}` : null
      let orchestrate: { emit: (e: OrchestrationEvent) => void; seq: () => number } | null = null
      if (gov?.orchestrationSink && runId) {
        const sink = gov.orchestrationSink
        const seq = createRunSeq()
        const emit = (e: OrchestrationEvent) => {
          try {
            sink(e)
          } catch {
            /* observers must never break streaming */
          }
        }
        orchestrate = { emit, seq }
        const { hooks } = buildOrchestrationHooks({ runId, parentNodeId: rootNodeId, emit, seq })
        queryOptions['hooks'] = hooks
        queryOptions['includeHookEvents'] = true
      }
      // Root/run frame only for plain runs — routes-team owns the team tree.
      const ownRun = !isTeamRun && runId && rootNodeId && orchestrate ? { runId, rootNodeId, ...orchestrate } : null

      // Pass the selected model through to the SDK so the agent's model choice
      // actually steers the CLI (previously the CLI used the user's default).
      const cliAlias = request.model ? MODEL_TO_CLI_ALIAS[request.model] : undefined
      if (cliAlias) queryOptions['model'] = cliAlias

      // When loadClaudeMd is disabled, use SDK isolation mode — no filesystem
      // settings loaded at all. This prevents both project CLAUDE.md files and
      // user-level ~/.claude/ configs from leaking into EYAS conversations.
      // When enabled, include 'project' to load CLAUDE.md + 'user' for user prefs.
      if (!loadClaudeMd) {
        queryOptions['settingSources'] = []
      }

      // Reasoning effort + Extended Thinking. With an effort level the SDK's
      // adaptive thinking is the correct pair (budgets are the legacy knob);
      // without one, the legacy budget behavior is preserved unchanged.
      if (request.effort) queryOptions['effort'] = request.effort
      if (request.thinking?.enabled) {
        queryOptions['thinking'] = request.effort
          ? { type: 'adaptive' }
          : { type: 'enabled', budgetTokens: request.thinking.budgetTokens ?? 10000 }
        providerLogger?.debug({ thinking: queryOptions['thinking'], effort: request.effort }, 'Claude Code SDK: thinking enabled')
      } else {
        // Explicitly disable thinking when not requested
        queryOptions['thinking'] = { type: 'disabled' }
      }

      // Smart session validation: check if session is still valid before resuming.
      // When valid, only send the latest message (SDK has internal history).
      // When invalid, inject full conversation history from DB into the prompt.
      let sessionValid = false
      if (request.sessionId) {
        try {
          const info = await getSessionInfo(request.sessionId)
          if (info) {
            queryOptions['resume'] = request.sessionId
            sessionValid = true
          }
        } catch {
          // getSessionInfo failed — treat session as invalid
        }
      }

      const promptContent = sessionValid
        ? buildLastMessageContent(request)
        : buildPromptWithHistory(request)

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

      let conversation: AsyncIterable<any>
      try {
        conversation = query({
          prompt: promptArg,
          options: queryOptions as any,
        })
      } catch (err) {
        clearTimeout(timeoutId)
        throw err
      }

      let fullText = ''
      let inputTokens = 0
      let outputTokens = 0
      // F2 T9 — the SDK's own authoritative billed total + cache-token
      // breakdown, when the 'result' message carries them (cacheCreation/
      // cacheRead are Anthropic-only concepts; costUsd wins over any
      // table-based estimate downstream).
      let costUsd: number | undefined
      let cacheReadTokens: number | undefined
      let cacheCreationTokens: number | undefined
      let capturedSessionId: string | null = null
      let toolCount = 0

      if (ownRun) {
        ownRun.emit({ runId: ownRun.runId, nodeId: ownRun.runId, parentId: null, seq: ownRun.seq(), payload: { type: 'run_started', goal: '' } })
        ownRun.emit({
          runId: ownRun.runId,
          nodeId: ownRun.rootNodeId,
          parentId: null,
          seq: ownRun.seq(),
          payload: { type: 'node_started', kind: 'root', label: request.model ?? 'claude-code', agentId: request.metadata?.agentId, conversationId },
        })
      }

      try {
      for await (const msg of conversation) {
        if (msg.type === 'assistant') {
          // Capture session ID from assistant messages
          capturedSessionId = (msg as any).session_id ?? capturedSessionId

          // Subagent-originated content (parent_tool_use_id set) belongs to the
          // run tree, not the main answer stream — orchestration hooks already
          // surface it as sub:<agent_id> node activity.
          if ((msg as any).parent_tool_use_id) continue

          for (const block of (msg as any).message?.content ?? []) {
            if (block.type === 'thinking' && block.thinking) {
              yield { type: 'thinking', text: block.thinking }
            } else if (block.type === 'text' && block.text) {
              fullText += block.text
              yield { type: 'text', text: block.text }
            } else if (block.type === 'tool_use') {
              toolCount++
              const toolName = block.name?.replace(/^mcp__eyas__/, '') ?? block.name
              yield { type: 'tool_use_start', id: block.id ?? `tool-${toolCount}`, name: toolName }
              yield { type: 'tool_use_end' }
            }
          }
        } else if (msg.type === 'system') {
          // Claude Code SDK emits system events for context compaction
          capturedSessionId = (msg as any).session_id ?? capturedSessionId
          const subtype = (msg as any).subtype
          if (subtype === 'compact' || subtype === 'init') {
            // On context compaction, emit summary so memory module can persist it
            const summary = (msg as any).summary ?? (msg as any).result ?? ''
            if (summary) {
              yield { type: 'context_compact', summary }
            }
          }
        } else if (msg.type === 'result') {
          capturedSessionId = (msg as any).session_id ?? capturedSessionId

          const subtype = (msg as any).subtype
          if (subtype === 'success' && (msg as any).result?.trim()) {
            const resultText = (msg as any).result
            if (resultText !== fullText) {
              fullText = resultText
            }
          }

          const usage = (msg as any).usage
          if (usage) {
            inputTokens = usage.input_tokens ?? usage.inputTokens ?? 0
            outputTokens = usage.output_tokens ?? usage.outputTokens ?? 0
            cacheReadTokens = usage.cache_read_input_tokens ?? usage.cacheReadInputTokens ?? undefined
            cacheCreationTokens = usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens ?? undefined
          }
          // F2 T9 — the SDK reports the run's real billed cost on both the
          // success and error result subtypes; prefer it wholesale over any
          // downstream table estimate (R3: CLI providers are authoritative).
          if (typeof (msg as any).total_cost_usd === 'number') {
            costUsd = (msg as any).total_cost_usd
          }

          // A non-success subtype (error_max_turns, error_during_execution) is
          // how the SDK reports a failed run. Ignoring it emitted a clean
          // 'done' with partial text, so the gateway recorded the provider as
          // healthy and the run as successful (D9). No 'done' event is emitted
          // for a failed run, so the answer so far and the resumable session
          // ride on the error instead of being lost.
          if (typeof subtype === 'string' && subtype !== 'success') {
            throw new ProviderRunError(subtype, {
              partialText: fullText,
              sessionId: capturedSessionId,
              usage: { inputTokens, outputTokens },
            })
          }
        }
      }
      if (ownRun) {
        ownRun.emit({
          runId: ownRun.runId, nodeId: ownRun.rootNodeId, parentId: null, seq: ownRun.seq(),
          payload: { type: 'node_completed', status: 'completed', tokens: outputTokens, conversationId },
        })
        ownRun.emit({
          runId: ownRun.runId, nodeId: ownRun.runId, parentId: null, seq: ownRun.seq(),
          payload: { type: 'run_completed', status: 'completed', totalTokens: inputTokens + outputTokens, totalCostUsd: costUsd ?? 0 },
        })
      }
      } catch (err) {
        if (ownRun) {
          ownRun.emit({
            runId: ownRun.runId, nodeId: ownRun.rootNodeId, parentId: null, seq: ownRun.seq(),
            payload: { type: 'node_completed', status: 'failed', conversationId },
          })
          ownRun.emit({
            runId: ownRun.runId, nodeId: ownRun.runId, parentId: null, seq: ownRun.seq(),
            // F2 T9 — a failed run may have already billed real tokens/cost
            // (a non-success 'result' subtype still carries the SDK's usage +
            // total_cost_usd before the throw below) — report them instead of
            // a hardcoded 0.
            payload: { type: 'run_completed', status: 'failed', totalTokens: inputTokens + outputTokens, totalCostUsd: costUsd ?? 0 },
          })
        }
        throw err
      } finally {
        clearTimeout(timeoutId)
      }

      yield {
        type: 'done',
        response: {
          id: capturedSessionId ?? `cc-${Date.now()}`,
          provider: 'claude-code',
          model: request.model || 'claude-code-sonnet',
          content: [{ type: 'text', text: fullText }],
          stopReason: 'end',
          usage: {
            inputTokens,
            outputTokens,
            ...(cacheReadTokens ? { cacheReadTokens } : {}),
            ...(cacheCreationTokens ? { cacheCreationTokens } : {}),
            ...(costUsd !== undefined ? { costUsd } : {}),
          },
          sessionId: capturedSessionId,
        },
      }
    },
  }
}
