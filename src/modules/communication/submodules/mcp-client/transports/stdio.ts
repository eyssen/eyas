// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { McpTransport, JsonRpcRequest, JsonRpcResponse } from '../types.js'

// Allowlist: command names must contain only safe characters (no shell metacharacters)
const SAFE_COMMAND_RE = /^[a-zA-Z0-9._/@-]+$/

/**
 * stdio transport — spawns a child process via Bun.spawn and communicates
 * via JSON-RPC over stdin/stdout. Each message is a JSON line terminated by newline.
 *
 * Security:
 * - Command validated against strict character allowlist before spawn
 * - Arguments checked for null bytes
 * - Bun.spawn does not use a shell (no shell injection)
 * - Only admin users can configure MCP servers (CASL enforced at API layer)
 */
export function createStdioTransport(opts: {
  command: string
  args?: string[]
  env?: Record<string, string>
}): McpTransport {
  // Validate command at construction time
  if (!SAFE_COMMAND_RE.test(opts.command)) {
    throw new Error(`Invalid MCP command: "${opts.command}" — only alphanumeric, dots, slashes, @ and hyphens allowed`)
  }
  const spawnCmd = [opts.command, ...(opts.args ?? [])]
  for (const arg of spawnCmd) {
    if (arg.includes('\0')) throw new Error('Invalid MCP argument: null byte not allowed')
  }
  // Resolve ${VAR} and ${VAR:-default} patterns in env values from process.env
  const resolvedEnv: Record<string, string> = {}
  for (const [key, val] of Object.entries(opts.env ?? {})) {
    resolvedEnv[key] = val.replace(/\$\{([^}]+)\}/g, (_, expr: string) => {
      const [varName, fallback] = expr.split(':-')
      return process.env[varName] ?? fallback ?? ''
    })
  }
  const spawnEnv = { ...process.env, ...resolvedEnv }

  let proc: ReturnType<typeof Bun.spawn> | null = null
  let isConnected = false
  let requestId = 0
  const pending = new Map<number | string, {
    resolve: (v: JsonRpcResponse) => void
    reject: (e: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()

  function rejectAll(reason: Error) {
    for (const [, p] of pending) {
      clearTimeout(p.timer)
      p.reject(reason)
    }
    pending.clear()
  }

  /** Read stdout stream line-by-line and resolve pending requests */
  async function readLoop(stdout: ReadableStream<Uint8Array>) {
    const reader = stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()!

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const msg = JSON.parse(line) as JsonRpcResponse
            if (msg.id != null && pending.has(msg.id)) {
              const p = pending.get(msg.id)!
              clearTimeout(p.timer)
              pending.delete(msg.id)
              p.resolve(msg)
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
    } catch {
      // Stream closed
    }
  }

  return {
    get connected() { return isConnected },

    async connect() {
      if (proc) return

      proc = Bun.spawn(spawnCmd, {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        env: spawnEnv,
      })

      // Start reading stdout in background
      const stdout = proc.stdout
      if (stdout && typeof stdout !== 'number') {
        readLoop(stdout as ReadableStream<Uint8Array>).catch(() => {})
      }

      // Watch for process exit
      proc.exited.then((code) => {
        isConnected = false
        rejectAll(new Error(`MCP process exited with code ${code}`))
        proc = null
      })

      // MCP initialize handshake
      const initResp = await this.send({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'EYAS', version: '1.0.0' },
        },
        id: ++requestId,
      })

      if (initResp.error) {
        throw new Error(`MCP initialize failed: ${initResp.error.message}`)
      }

      // Send initialized notification
      const stdin = proc.stdin as import('bun').FileSink
      stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
      stdin.flush()

      isConnected = true
    },

    async disconnect() {
      if (proc) {
        proc.kill()
        proc = null
      }
      isConnected = false
      rejectAll(new Error('Transport disconnected'))
    },

    async send(request: JsonRpcRequest): Promise<JsonRpcResponse> {
      const sink = proc?.stdin as import('bun').FileSink | undefined
      if (!sink) {
        throw new Error('stdio transport not connected')
      }

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(request.id)
          reject(new Error(`MCP request timed out: ${request.method}`))
        }, 30_000)

        pending.set(request.id, { resolve, reject, timer })
        sink.write(JSON.stringify(request) + '\n')
        sink.flush()
      })
    },
  }
}
