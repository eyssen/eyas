// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Minimal Agent Client Protocol (ACP) client for `grok agent stdio`.
 *
 * Implements only the JSON-RPC methods EYAS needs over NDJSON stdio.
 * Intentionally does NOT depend on @agentclientprotocol/sdk (that package
 * pulls zod/v4, which conflicts with EYAS's zod 3 pin).
 *
 * Protocol reference: https://agentclientprotocol.com
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { StreamEvent } from '../../types.js'
import { createAcpServerHandler, type AcpCanUseTool } from './acp-governance.js'

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
const PROTOCOL_VERSION = 1

/** ACP session/new mcpServers entry (stdio transport). */
export interface AcpMcpServerConfig {
  name: string
  command: string
  args: string[]
  env?: Array<{ name: string; value: string }>
}

export interface GrokAcpRunOptions {
  cwd: string
  model?: string
  sessionId?: string | null
  prompt: string
  systemPrompt?: string
  maxTurns?: number
  signal?: AbortSignal
  timeoutMs?: number
  logger?: { debug?: (o: unknown, msg?: string) => void; warn?: (o: unknown, msg?: string) => void }
  /**
   * EYAS governance gate for ACP permission requests and fs servicing.
   * Absent = fail-closed (every permission/fs request is refused).
   */
  canUseTool?: AcpCanUseTool
  /** ACP `plan` session updates (agent todo list) — fed to the orchestration tree. */
  onPlan?: (entries: Array<{ content?: string; status?: string }>) => void
  /**
   * Host CLI binary (default `grok`). Shared ACP runner also used by Kimi Code CLI
   * (`kimi`) and any future host agent that speaks Agent Client Protocol over stdio.
   */
  command?: string
  /** Override argv builder (default: Grok `agent … stdio`). */
  buildArgs?: (model?: string) => string[]
  /**
   * EYAS tools exposed to the host CLI via MCP stdio children.
   * When omitted, session/new still sends `mcpServers: []` (protocol-required).
   */
  mcpServers?: AcpMcpServerConfig[]
}

/**
 * CLI argv for `grok agent ... stdio`. Deliberately WITHOUT --always-approve:
 * permission requests must reach EYAS over ACP so the security gate decides.
 */
export function buildGrokCliArgs(model?: string): string[] {
  const args = ['agent']
  if (model) args.push('--model', model)
  args.push('stdio')
  return args
}

/** CLI argv for `kimi [--model X] acp` (Moonshot Kimi Code CLI). */
export function buildKimiCliArgs(model?: string): string[] {
  const args: string[] = []
  if (model) args.push('--model', model)
  args.push('acp')
  return args
}

export interface GrokAcpRunResult {
  text: string
  sessionId: string | null
  inputTokens: number
  outputTokens: number
  stopReason: 'end' | 'max_tokens' | 'stop_sequence'
}

type JsonRpcId = number | string

interface Pending {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
}

/**
 * Run one Grok ACP prompt turn, yielding EYAS StreamEvents.
 * Final return value carries usage + sessionId; the provider wraps it into `done`.
 */
export async function* runGrokAcpPrompt(opts: GrokAcpRunOptions): AsyncGenerator<StreamEvent, GrokAcpRunResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const command = opts.command ?? 'grok'
  const args = (opts.buildArgs ?? buildGrokCliArgs)(opts.model)

  const proc: ChildProcess = spawn(command, args, {
    cwd: opts.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  })

  if (!proc.stdin || !proc.stdout) {
    proc.kill()
    throw new Error(`Failed to open stdio pipes for \`${command} ${args.join(' ')}\``)
  }

  proc.stderr?.on('data', (chunk: Buffer) => {
    opts.logger?.debug?.({ stderr: chunk.toString('utf8').slice(0, 500) }, `${command} ACP stderr`)
  })

  const abortController = new AbortController()
  const onAbort = () => abortController.abort()
  if (opts.signal) {
    if (opts.signal.aborted) abortController.abort()
    else opts.signal.addEventListener('abort', onAbort, { once: true })
  }
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs)

  type QueueItem =
    | { kind: 'event'; event: StreamEvent }
    | { kind: 'end'; result: GrokAcpRunResult }
    | { kind: 'error'; error: Error }

  const queue: QueueItem[] = []
  let wake: (() => void) | null = null
  let closed = false
  const notifyWaiters = () => {
    const w = wake
    wake = null
    if (w) w()
  }
  const push = (item: QueueItem) => {
    if (closed) return
    queue.push(item)
    notifyWaiters()
  }
  const wait = () =>
    new Promise<void>((resolve) => {
      if (queue.length > 0 || closed) resolve()
      else wake = resolve
    })

  let fullText = ''
  let capturedSessionId: string | null = opts.sessionId ?? null
  let inputTokens = 0
  let outputTokens = 0
  let stopReason: GrokAcpRunResult['stopReason'] = 'end'
  let toolCount = 0
  let nextId = 1
  const pending = new Map<JsonRpcId, Pending>()

  const killProc = () => {
    try {
      if (!proc.killed) proc.kill('SIGTERM')
    } catch { /* ignore */ }
  }
  abortController.signal.addEventListener('abort', killProc, { once: true })

  const write = (msg: Record<string, unknown>) => {
    if (!proc.stdin || proc.stdin.destroyed) return
    proc.stdin.write(JSON.stringify(msg) + '\n')
  }

  const request = <T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> => {
    const id = nextId++
    return new Promise<T>((resolve, reject) => {
      if (abortController.signal.aborted) {
        reject(new Error('aborted'))
        return
      }
      pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      })
      write({ jsonrpc: '2.0', id, method, params: params ?? {} })
    })
  }

  const respond = (id: JsonRpcId, result: unknown) => {
    write({ jsonrpc: '2.0', id, result })
  }

  const respondError = (id: JsonRpcId, message: string) => {
    write({ jsonrpc: '2.0', id, error: { code: -32000, message } })
  }

  // Permission + fs server requests carry authority — governed, fail-closed.
  const handleServerRequest = createAcpServerHandler({
    canUseTool: opts.canUseTool,
    respond,
    respondError,
    logger: opts.logger,
  })

  const handleSessionUpdate = (params: { sessionId?: string; update?: Record<string, unknown> }) => {
    if (params.sessionId) capturedSessionId = params.sessionId
    const update = params.update ?? {}
    const kind = update.sessionUpdate as string | undefined

    if (kind === 'agent_message_chunk') {
      const content = update.content as { type?: string; text?: string } | undefined
      const text = content?.text ?? ''
      if (text) {
        fullText += text
        push({ kind: 'event', event: { type: 'text', text } })
      }
      return
    }

    if (kind === 'agent_thought_chunk') {
      const content = update.content as { type?: string; text?: string } | undefined
      const text = content?.text ?? ''
      if (text) push({ kind: 'event', event: { type: 'thinking', text } })
      return
    }

    if (kind === 'plan') {
      opts.onPlan?.(((update.entries as Array<{ content?: string; status?: string }>) ?? []))
      return
    }

    if (kind === 'tool_call') {
      toolCount++
      const id = (update.toolCallId as string) ?? `tool-${toolCount}`
      const name = (update.title as string) ?? (update.kind as string) ?? 'tool'
      push({ kind: 'event', event: { type: 'tool_use_start', id, name } })
      const initial = update.status as string | undefined
      if (initial === 'completed' || initial === 'failed') {
        push({ kind: 'event', event: { type: 'tool_use_end', id, status: initial === 'failed' ? 'error' : 'success' } })
      }
      return
    }

    if (kind === 'tool_call_update') {
      const status = update.status as string | undefined
      if (status === 'completed' || status === 'failed') {
        // The id was being dropped here. ACP names the call it is updating, and
        // without that name the UI has nothing to settle: a completed run left
        // every tool row spinning.
        const id = update.toolCallId as string | undefined
        push({ kind: 'event', event: { type: 'tool_use_end', ...(id ? { id } : {}), status: status === 'failed' ? 'error' : 'success' } })
      }
    }
  }

  const handleIncoming = async (raw: string) => {
    let msg: any
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }

    // Response to our request
    if (msg.id != null && (msg.result !== undefined || msg.error !== undefined) && !msg.method) {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.error) {
        p.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)))
      } else {
        p.resolve(msg.result)
      }
      return
    }

    // Server request or notification
    const method = msg.method as string | undefined
    if (!method) return

    if (method === 'session/update') {
      handleSessionUpdate(msg.params ?? {})
      return
    }

    if (await handleServerRequest(method, msg.id ?? null, msg.params)) return

    // Unknown server request — reject so the agent doesn't hang
    if (msg.id != null) {
      respondError(msg.id, `Unsupported method: ${method}`)
    }
  }

  const rl = createInterface({ input: proc.stdout })
  rl.on('line', (line) => {
    void handleIncoming(line)
  })

  const runPromise = (async () => {
    try {
      if (abortController.signal.aborted) throw new Error('aborted')

      await request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
        },
        clientInfo: { name: 'EYAS', version: '1.0.0' },
      })

      // Some agents expect an explicit initialized notification.
      write({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })

      let sessionId = opts.sessionId ?? null
      if (sessionId) {
        try {
          await request('session/load', { sessionId, cwd: opts.cwd })
          capturedSessionId = sessionId
        } catch {
          sessionId = null
        }
      }

      if (!sessionId) {
        // Grok CLI ≥0.2.x requires `mcpServers` on session/new (JSON-RPC -32602
        // "Invalid params" / "missing field mcpServers" if omitted). Empty list
        // is valid; when tool bridge is wired we pass the eyas stdio MCP server.
        const newParams: Record<string, unknown> = {
          cwd: opts.cwd,
          mcpServers: opts.mcpServers ?? [],
        }
        const meta: Record<string, unknown> = {}
        if (opts.systemPrompt) meta.systemPromptOverride = opts.systemPrompt
        if (opts.maxTurns != null) meta.maxTurns = opts.maxTurns
        if (Object.keys(meta).length > 0) newParams._meta = meta
        const created = await request<{ sessionId: string }>('session/new', newParams)
        sessionId = created.sessionId
        capturedSessionId = sessionId
      }

      const response = await request<{
        stopReason?: string
        usage?: Record<string, number>
        _meta?: { usage?: Record<string, number> }
      }>('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: opts.prompt }],
      })

      const reason = response?.stopReason
      if (reason === 'max_tokens' || reason === 'max_turn_requests') stopReason = 'max_tokens'
      else if (reason === 'stop_sequence') stopReason = 'stop_sequence'
      else stopReason = 'end'

      const usage = response?.usage ?? response?._meta?.usage
      if (usage) {
        inputTokens = Number(usage.input_tokens ?? usage.inputTokens ?? 0)
        outputTokens = Number(usage.output_tokens ?? usage.outputTokens ?? 0)
      }

      push({
        kind: 'end',
        result: {
          text: fullText,
          sessionId: capturedSessionId,
          inputTokens,
          outputTokens,
          stopReason,
        },
      })
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      if (abortController.signal.aborted) {
        push({ kind: 'error', error: new Error('Grok CLI ACP request aborted') })
      } else {
        push({ kind: 'error', error })
      }
    } finally {
      closed = true
      notifyWaiters()
      for (const [, p] of pending) p.reject(new Error('ACP connection closed'))
      pending.clear()
      try { rl.close() } catch { /* ignore */ }
      try { proc.stdin?.end() } catch { /* ignore */ }
      killProc()
    }
  })()

  try {
    while (true) {
      if (queue.length === 0) await wait()
      const item = queue.shift()
      if (!item) {
        if (closed) break
        continue
      }
      if (item.kind === 'event') {
        yield item.event
      } else if (item.kind === 'error') {
        yield { type: 'error', error: item.error }
        throw item.error
      } else {
        return item.result
      }
    }
    return {
      text: fullText,
      sessionId: capturedSessionId,
      inputTokens,
      outputTokens,
      stopReason,
    }
  } finally {
    clearTimeout(timeoutId)
    opts.signal?.removeEventListener('abort', onAbort)
    closed = true
    killProc()
    await runPromise.catch(() => {})
  }
}
