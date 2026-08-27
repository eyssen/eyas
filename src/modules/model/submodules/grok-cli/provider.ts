// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AIProvider, ModelInfo, ModelRequest, ModelResponse, StreamEvent, ContentBlock } from '../../types.js'
import { runGrokAcpPrompt } from './acp-client.js'
import { createPermissionBridge, isAutonomousRequest, type GateDecision } from '../../permission-bridge.js'
import type { AcpCanUseTool, AcpPermissionDecision } from './acp-governance.js'
import { createRunSeq, type OrchestrationEvent } from '@shared/orchestration-events.js'

/** Lazily-resolved governance deps (ordering-safe — read at stream() time). */
export interface GrokCliGovernance {
  securityGate?: {
    validateToolCall(toolName: string, input: Record<string, unknown>, ctx?: { conversationId?: string; agentId?: string }): GateDecision | Promise<GateDecision>
    autonomyPolicy?: {
      categoryForTool(name: string): string | null
      resolve(category: string): { level: number; locked: boolean; maxLevel: number }
      createApproval(rec: { category: string; toolName: string; agentId?: string; conversationId?: string; reason: string }): void
    }
  }
  orchestrationSink?: (event: OrchestrationEvent) => void
}

const execFileAsync = promisify(execFile)

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_MAX_TURNS = 25

/**
 * Known models — returned instantly on listModels() without CLI calls.
 * Currently Grok CLI exposes a single primary model; fetchModels() enriches
 * from `grok models` when the user hits "Refresh from CLI".
 */
const KNOWN_MODELS: ModelInfo[] = [
  {
    id: 'grok-cli-default',
    name: 'Grok CLI',
    provider: 'grok-cli',
    contextWindow: 500_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsImages: true,
    supportsStreaming: true,
    metadata: { realModelId: 'grok-4.5', alias: 'default' },
  },
]

/** Map EYAS model id → CLI `--model` id. */
const MODEL_TO_CLI: Record<string, string> = {
  'grok-cli-default': 'grok-4.5',
}

export interface GrokCliProviderOptions {
  /** Logger instance */
  logger?: import('pino').Logger
  /** Maximum agentic tool-use turns (default: 25) */
  maxTurns?: number
  /** Working directory for agent sessions (default: process.cwd()) */
  cwd?: string
  /** Optional override for the ACP runner (tests). */
  runPrompt?: typeof runGrokAcpPrompt
  /**
   * Lazily-resolved governance deps. When it returns a securityGate, every ACP
   * permission request and fs access is bridged through the EYAS gate (same
   * Cap 7 policy as the claude-code provider); when absent, the ACP layer
   * fail-closes (permission/fs requests are refused).
   */
  getGovernance?: () => GrokCliGovernance | undefined
  /**
   * When set, stream() issues a bridge secret and injects the EYAS stdio MCP
   * server into ACP session/new so the CLI can call EYAS tools (memory, board,
   * search, …) under the same ToolExecutor + security gate path as Claude Code.
   */
  mcpBridge?: {
    /** Base URL of the running EYAS HTTP server (e.g. http://127.0.0.1:3100). */
    baseUrl: string
    /** Absolute path to the EYAS install root (repo / package root). */
    installRoot: string
  }
}

function extractTextContent(msg: { role: string; content: string | ContentBlock[] }): string {
  if (typeof msg.content === 'string') return msg.content
  return msg.content
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n')
}

/**
 * Build the prompt for ACP. When session is resumed the agent has history;
 * still prepend recent turns when session is new so multi-turn works without resume.
 */
function buildPrompt(request: ModelRequest, sessionValid: boolean): string {
  const msgs = request.messages
  if (msgs.length === 0) return ''

  if (sessionValid) {
    return extractTextContent(msgs[msgs.length - 1])
  }

  if (msgs.length === 1) return extractTextContent(msgs[0])

  const historyParts: string[] = []
  for (let i = 0; i < msgs.length - 1; i++) {
    const m = msgs[i]
    const role = m.role === 'user' ? 'User' : 'Assistant'
    const text = extractTextContent(m)
    if (text.trim()) historyParts.push(`${role}: ${text}`)
  }
  const last = extractTextContent(msgs[msgs.length - 1])
  if (historyParts.length === 0) return last
  return `<conversation-history>\n${historyParts.join('\n\n')}\n</conversation-history>\n\n${last}`
}

/**
 * Probe `grok models` for available model ids. Best-effort; falls back to known.
 */
async function probeCliModels(): Promise<ModelInfo[]> {
  try {
    const { stdout } = await execFileAsync('grok', ['models'], {
      timeout: 15_000,
      encoding: 'utf-8',
    })
    // Lines like: "  * grok-4.5 (default)" or "  grok-4.5"
    const ids = new Set<string>()
    for (const line of stdout.split('\n')) {
      const m = line.match(/^\s*\*?\s*([a-zA-Z0-9._-]+)/)
      if (!m) continue
      const id = m[1]
      if (id === 'Available' || id === 'Default' || id === 'models') continue
      if (/^[a-zA-Z]/.test(id) && id.includes('grok')) ids.add(id)
    }
    if (ids.size === 0) return KNOWN_MODELS

    const models: ModelInfo[] = []
    let i = 0
    for (const realId of ids) {
      const isDefault = i === 0 || realId.includes('4.5') || realId.includes('default')
      const eyasId = isDefault && models.length === 0 ? 'grok-cli-default' : `grok-cli-${realId}`
      models.push({
        id: eyasId,
        name: `Grok CLI (${realId})`,
        provider: 'grok-cli',
        contextWindow: 500_000,
        maxOutputTokens: 64_000,
        supportsTools: true,
        supportsImages: true,
        supportsStreaming: true,
        metadata: { realModelId: realId, alias: isDefault ? 'default' : realId },
      })
      // Keep alias map warm for the primary model.
      MODEL_TO_CLI[eyasId] = realId
      i++
    }
    // Ensure the stable default id always exists.
    if (!models.some((m) => m.id === 'grok-cli-default') && models[0]) {
      models.unshift({ ...models[0], id: 'grok-cli-default', name: `Grok CLI (${(models[0].metadata as any).realModelId})` })
      MODEL_TO_CLI['grok-cli-default'] = (models[0].metadata as any).realModelId as string
    }
    return models
  } catch {
    return KNOWN_MODELS
  }
}

export function createGrokCliProvider(options: GrokCliProviderOptions = {}): AIProvider {
  const {
    logger: providerLogger,
    maxTurns = DEFAULT_MAX_TURNS,
    cwd = process.cwd(),
    runPrompt = runGrokAcpPrompt,
    getGovernance,
    mcpBridge,
  } = options

  /** Build the ACP gate callback from the shared Cap 7 permission bridge. */
  const buildCanUseTool = (request: ModelRequest): AcpCanUseTool | undefined => {
    const gov = getGovernance?.()
    if (!gov?.securityGate) return undefined
    // Classification is fail-closed (F0 R4): only a construction site that
    // explicitly labels its metadata as human-attended (origin:
    // interactive/channel, no team session) is treated as interactive;
    // everything else — including absent metadata — is autonomous and
    // governed by the graduated-autonomy ladder.
    const bridge = createPermissionBridge({
      validateToolCall: gov.securityGate.validateToolCall,
      autonomy: gov.securityGate.autonomyPolicy,
      autonomous: isAutonomousRequest(request.metadata),
      ctx: { conversationId: request.metadata?.conversationId, agentId: request.metadata?.agentId, runId: request.metadata?.runId },
      // F2 T5 — the ACP bridge is the SAME bridge, so the park sink works
      // identically here; ACP's own reject_once is the interrupt mechanism.
      onEscalatedApproval: request.metadata?.onEscalatedApproval,
      logger: providerLogger,
    })
    const signal = request.signal ?? new AbortController().signal
    return async (toolName, input): Promise<AcpPermissionDecision> =>
      bridge(toolName, input, { toolUseID: 'acp', signal })
  }

  return {
    id: 'grok-cli',
    name: 'Grok CLI',

    async listModels() {
      return KNOWN_MODELS
    },

    async fetchModels() {
      return probeCliModels()
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
        usage: { inputTokens: 0, outputTokens: 0 },
      }
    },

    async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
      const cliModel =
        (request.model && MODEL_TO_CLI[request.model]) ||
        (request.model && !request.model.startsWith('grok-cli') ? request.model : undefined) ||
        MODEL_TO_CLI['grok-cli-default'] ||
        'grok-4.5'

      const sessionValid = Boolean(request.sessionId)
      const prompt = buildPrompt(request, sessionValid)

      // Orchestration visibility: ACP has no subagent concept, but the plan
      // (todo list) + tool calls give the run tree an honest live view. Team
      // runs join the team tree; plain conversations get their own run frame.
      const conversationId = request.metadata?.conversationId
      const runId = request.metadata?.teamSessionId ?? conversationId
      const rootNodeId = conversationId ? `conv:${conversationId}` : null
      const isTeamRun = Boolean(request.metadata?.teamSessionId)
      const sink = getGovernance?.()?.orchestrationSink
      let orch: { emit: (e: OrchestrationEvent) => void; seq: () => number } | null = null
      if (sink && runId && rootNodeId) {
        const seq = createRunSeq()
        orch = {
          seq,
          emit: (e) => {
            try {
              sink(e)
            } catch {
              /* observers must never break streaming */
            }
          },
        }
      }
      const ownRun = orch && !isTeamRun

      const planStatus = new Map<number, string>()
      const onPlan = orch
        ? (entries: Array<{ content?: string; status?: string }>) => {
            entries.forEach((entry, i) => {
              const status = entry.status ?? 'pending'
              if (planStatus.get(i) === status) return
              planStatus.set(i, status)
              const nodeId = `plan:${conversationId}:${i}`
              const label = (entry.content ?? `step ${i + 1}`).slice(0, 120)
              orch!.emit({
                runId: runId!, nodeId, parentId: rootNodeId, seq: orch!.seq(),
                payload: { type: 'node_started', kind: 'subagent', label },
              })
              if (status === 'completed') {
                orch!.emit({
                  runId: runId!, nodeId, parentId: rootNodeId, seq: orch!.seq(),
                  payload: { type: 'node_completed', status: 'completed' },
                })
              }
            })
          }
        : undefined

      let lastToolId: string | null = null
      try {
        if (ownRun) {
          orch!.emit({ runId: runId!, nodeId: runId!, parentId: null, seq: orch!.seq(), payload: { type: 'run_started', goal: '' } })
          orch!.emit({
            runId: runId!, nodeId: rootNodeId!, parentId: null, seq: orch!.seq(),
            payload: { type: 'node_started', kind: 'root', label: request.model ?? 'grok-cli', agentId: request.metadata?.agentId, conversationId },
          })
        }

        // Wave 1 — EYAS tools via ACP MCP stdio child (parity with Claude Code bridge).
        let mcpServers: import('./acp-client.js').AcpMcpServerConfig[] | undefined
        let bridgeSecret: string | undefined
        if (mcpBridge?.baseUrl && mcpBridge?.installRoot) {
          try {
            const { issueBridgeSecret, buildAcpMcpServerConfig, revokeBridgeSecret } =
              await import('../../cli-mcp/bridge-routes.js')
            bridgeSecret = issueBridgeSecret()
            mcpServers = [
              buildAcpMcpServerConfig({
                baseUrl: mcpBridge.baseUrl,
                secret: bridgeSecret,
                installRoot: mcpBridge.installRoot,
                context: {
                  conversationId: request.metadata?.conversationId,
                  agentId: request.metadata?.agentId,
                  teamSessionId: request.metadata?.teamSessionId,
                  userId: request.metadata?.userId,
                },
              }),
            ]
            // Revoke after the stream ends (best-effort; also TTL-purged).
            request.signal?.addEventListener?.('abort', () => {
              if (bridgeSecret) revokeBridgeSecret(bridgeSecret)
            })
          } catch (err) {
            providerLogger?.warn?.({ err: String(err) }, 'grok-cli: MCP bridge config failed — continuing without EYAS tools')
          }
        }

        // Conversation Folders (first = primary cwd). Constructor `cwd` is
        // only the install-time default — without this, grok agent stdio
        // starts in the EYAS process directory and answers about src/modules.
        const sessionCwd = request.metadata?.workingDirectory || cwd

        const gen = runPrompt({
          cwd: sessionCwd,
          model: cliModel,
          sessionId: request.sessionId,
          prompt,
          systemPrompt: request.system,
          maxTurns: request.maxTurns ?? maxTurns,
          signal: request.signal,
          timeoutMs: DEFAULT_TIMEOUT_MS,
          logger: providerLogger,
          canUseTool: buildCanUseTool(request),
          onPlan,
          mcpServers,
        })

        let result = await gen.next()
        while (!result.done) {
          const event = result.value
          if (orch && rootNodeId && event.type === 'tool_use_start') {
            lastToolId = event.id
            orch.emit({
              runId: runId!, nodeId: rootNodeId, parentId: null, seq: orch.seq(),
              payload: { type: 'tool_started', toolId: event.id, name: event.name },
            })
          } else if (orch && rootNodeId && event.type === 'tool_use_end') {
            orch.emit({
              runId: runId!, nodeId: rootNodeId, parentId: null, seq: orch.seq(),
              payload: { type: 'tool_result', toolId: event.id ?? lastToolId ?? 'tool', status: event.status ?? 'success' },
            })
          }
          yield event
          result = await gen.next()
        }

        const final = result.value
        if (ownRun) {
          orch!.emit({
            runId: runId!, nodeId: rootNodeId!, parentId: null, seq: orch!.seq(),
            payload: { type: 'node_completed', status: 'completed', tokens: final.outputTokens, conversationId },
          })
          orch!.emit({
            runId: runId!, nodeId: runId!, parentId: null, seq: orch!.seq(),
            payload: { type: 'run_completed', status: 'completed', totalTokens: final.inputTokens + final.outputTokens, totalCostUsd: 0 },
          })
        }
        yield {
          type: 'done',
          response: {
            id: final.sessionId ?? `grok-${Date.now()}`,
            provider: 'grok-cli',
            model: request.model || 'grok-cli-default',
            content: [{ type: 'text', text: final.text }],
            stopReason: final.stopReason,
            usage: { inputTokens: final.inputTokens, outputTokens: final.outputTokens },
            sessionId: final.sessionId,
          },
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        providerLogger?.warn?.({ err: error }, 'grok-cli ACP stream failed')
        if (ownRun) {
          orch!.emit({
            runId: runId!, nodeId: rootNodeId!, parentId: null, seq: orch!.seq(),
            payload: { type: 'node_completed', status: 'failed', conversationId },
          })
          orch!.emit({
            runId: runId!, nodeId: runId!, parentId: null, seq: orch!.seq(),
            payload: { type: 'run_completed', status: 'failed', totalTokens: 0, totalCostUsd: 0 },
          })
        }
        // Yield the frame so the chat route can still render the failure, then
        // rethrow: a provider that swallows its own failure makes the gateway
        // record the call as healthy and the run as successful (D9).
        yield { type: 'error', error }
        throw error
      }
    },
  }
}

/** Exported for onboarding / tests. */
export { KNOWN_MODELS as GROK_CLI_KNOWN_MODELS, MODEL_TO_CLI as GROK_CLI_MODEL_TO_CLI }
