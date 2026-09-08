// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { AIProvider, ModelInfo, ModelRequest, ModelResponse, StreamEvent, ContentBlock } from '../../types.js'
import { runGrokAcpPrompt, buildKimiCliArgs } from '../grok-cli/acp-client.js'
import { createPermissionBridge, isAutonomousRequest, type GateDecision } from '../../permission-bridge.js'
import type { AcpCanUseTool, AcpPermissionDecision } from '../grok-cli/acp-governance.js'
import { createRunSeq, type OrchestrationEvent } from '@shared/orchestration-events.js'

/** Lazily-resolved governance deps (ordering-safe — read at stream() time). */
export interface KimiCliGovernance {
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

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_MAX_TURNS = 25

/**
 * Known models — listModels() without CLI calls.
 * realModelId is passed as `kimi --model <id> acp`.
 */
const KNOWN_MODELS: ModelInfo[] = [
  {
    id: 'kimi-cli-default',
    name: 'Kimi Code CLI',
    provider: 'kimi-cli',
    contextWindow: 256_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsImages: true,
    supportsStreaming: true,
    metadata: { realModelId: 'kimi-k2.7-code', alias: 'default' },
  },
  {
    id: 'kimi-cli-k3',
    name: 'Kimi Code CLI (K3)',
    provider: 'kimi-cli',
    contextWindow: 1_048_576,
    maxOutputTokens: 131_072,
    supportsTools: true,
    supportsImages: true,
    supportsStreaming: true,
    metadata: { realModelId: 'kimi-k3', alias: 'k3' },
  },
  {
    id: 'kimi-cli-k2.7-code',
    name: 'Kimi Code CLI (K2.7 Code)',
    provider: 'kimi-cli',
    contextWindow: 256_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsImages: true,
    supportsStreaming: true,
    metadata: { realModelId: 'kimi-k2.7-code', alias: 'k2.7-code' },
  },
  {
    id: 'kimi-cli-k2.6',
    name: 'Kimi Code CLI (K2.6)',
    provider: 'kimi-cli',
    contextWindow: 256_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsImages: true,
    supportsStreaming: true,
    metadata: { realModelId: 'kimi-k2.6', alias: 'k2.6' },
  },
]

const MODEL_TO_CLI: Record<string, string> = {
  'kimi-cli-default': 'kimi-k2.7-code',
  'kimi-cli-k3': 'kimi-k3',
  'kimi-cli-k2.7-code': 'kimi-k2.7-code',
  'kimi-cli-k2.6': 'kimi-k2.6',
}

export interface KimiCliProviderOptions {
  logger?: import('pino').Logger
  maxTurns?: number
  cwd?: string
  runPrompt?: typeof runGrokAcpPrompt
  getGovernance?: () => KimiCliGovernance | undefined
  /** Same MCP bridge as Grok CLI — exposes EYAS tools to Kimi ACP sessions. */
  mcpBridge?: {
    baseUrl: string
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

export function createKimiCliProvider(options: KimiCliProviderOptions = {}): AIProvider {
  const {
    logger: providerLogger,
    maxTurns = DEFAULT_MAX_TURNS,
    cwd = process.cwd(),
    runPrompt = runGrokAcpPrompt,
    getGovernance,
    mcpBridge,
  } = options

  const buildCanUseTool = (request: ModelRequest): AcpCanUseTool | undefined => {
    const gov = getGovernance?.()
    if (!gov?.securityGate) return undefined
    const bridge = createPermissionBridge({
      validateToolCall: gov.securityGate.validateToolCall,
      autonomy: gov.securityGate.autonomyPolicy,
      autonomous: isAutonomousRequest(request.metadata),
      ctx: { conversationId: request.metadata?.conversationId, agentId: request.metadata?.agentId, runId: request.metadata?.runId },
      onEscalatedApproval: request.metadata?.onEscalatedApproval,
      logger: providerLogger,
    })
    const signal = request.signal ?? new AbortController().signal
    return async (toolName, input): Promise<AcpPermissionDecision> =>
      bridge(toolName, input, { toolUseID: 'acp', signal })
  }

  return {
    id: 'kimi-cli',
    name: 'Kimi Code CLI',

    async listModels() {
      return KNOWN_MODELS
    },

    async fetchModels() {
      return KNOWN_MODELS
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
        usage: { inputTokens: 0, outputTokens: 0 },
      }
    },

    async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
      // NOTE (mirrors grok-cli): `ModelRequest.isolated` is deliberately NOT
      // honoured here, and this provider does not advertise
      // supportsIsolatedCompletion. ACP `session/new` accepts `cwd`,
      // `mcpServers` and a `_meta` carrying systemPromptOverride/maxTurns —
      // and nothing that stops the CLI loading its OWN machine-level config
      // and memory into the session. The kimi CLI's baseline is additionally
      // UNVERIFIED (unlike grok, which demonstrably loads ~/.grok and even
      // ~/.claude globally). Honouring the flag halfway would claim an
      // isolation this cannot deliver — revisit if kimi gains a real
      // suppression switch; do not fabricate one.
      const cliModel =
        (request.model && MODEL_TO_CLI[request.model]) ||
        (request.model && !request.model.startsWith('kimi-cli') ? request.model : undefined) ||
        MODEL_TO_CLI['kimi-cli-default'] ||
        'kimi-k2.7-code'

      const sessionValid = Boolean(request.sessionId)
      const prompt = buildPrompt(request, sessionValid)

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
            payload: { type: 'node_started', kind: 'root', label: request.model ?? 'kimi-cli', agentId: request.metadata?.agentId, conversationId },
          })
        }

        let mcpServers: import('../grok-cli/acp-client.js').AcpMcpServerConfig[] | undefined
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
            request.signal?.addEventListener?.('abort', () => {
              if (bridgeSecret) revokeBridgeSecret(bridgeSecret)
            })
          } catch (err) {
            providerLogger?.warn?.({ err: String(err) }, 'kimi-cli: MCP bridge config failed — continuing without EYAS tools')
          }
        }

        const sessionCwd = request.metadata?.workingDirectory || cwd

        const gen = runPrompt({
          command: 'kimi',
          buildArgs: buildKimiCliArgs,
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
            id: final.sessionId ?? `kimi-cli-${Date.now()}`,
            provider: 'kimi-cli',
            model: request.model || 'kimi-cli-default',
            content: [{ type: 'text', text: final.text }],
            stopReason: final.stopReason,
            usage: { inputTokens: final.inputTokens, outputTokens: final.outputTokens },
            sessionId: final.sessionId,
          },
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        providerLogger?.warn?.({ err: error }, 'kimi-cli ACP stream failed')
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
        yield { type: 'error', error }
        throw error
      }
    },
  }
}

export { KNOWN_MODELS as KIMI_CLI_KNOWN_MODELS, MODEL_TO_CLI as KIMI_CLI_MODEL_TO_CLI }
