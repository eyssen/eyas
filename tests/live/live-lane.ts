// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Shared plumbing of the live CLI lane (cli-isolation.live.test.ts).
 *
 * The FREE cases run the real CLI binaries through EYAS's real providers, but
 * every model request goes to a local fake on 127.0.0.1 answering with a
 * scripted tool sequence, under a dummy key — no provider account, no token
 * spent (the method of the A1 spike, scripts/cli-isolation-spike.ts). The
 * fake records every request body, so a case can prove what reached "the
 * model" and what did not.
 *
 * Claude Code on macOS would still read the operator's keychain login under
 * a redirected HOME. The free cases therefore run it through a shim — the
 * resolved binary as far as EYAS knows (EYAS_CLAUDE_CODE_BIN) — that points
 * the CLI's secure storage at a folder of the hostile root and then execs the
 * real binary, logging every spawn. The operator's login is never read or
 * refreshed. The paid cases run the real binary with the real login.
 */

import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { join, relative, sep } from 'node:path'

// ── Environment ───────────────────────────────────────────────────────────────

/**
 * Set (string) or delete (undefined) process environment variables; returns
 * the function that restores every one of them.
 */
export function patchEnv(patch: Record<string, string | undefined>): () => void {
  const saved = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(patch)) {
    saved.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

/**
 * Variables that would send a Claude Code child to a real account instead of
 * the local fake (the claude-code env allowlist passes them). Cleared for the
 * free cases.
 */
export const CLAUDE_REAL_AUTH_ENV = [
  'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_CUSTOM_HEADERS', 'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_VERTEX_BASE_URL', 'ANTHROPIC_VERTEX_PROJECT_ID',
] as const

// ── Local fake model ──────────────────────────────────────────────────────────

export interface FakeRequest {
  method: string
  path: string
  body: string
  json: any
}

export interface FakeReply {
  status?: number
  headers?: Record<string, string>
  body: string
}

export type FakeHandler = (req: FakeRequest) => FakeReply

export interface FakeModel {
  url: string
  requests: FakeRequest[]
  /** Every request body, concatenated: what reached "the model". */
  bodies(): string
  /** Requests that asked for a model answer (not probes, not token counts). */
  modelCalls(): FakeRequest[]
  /** Answer from now on with another script (the URL stays, so the CLI env does too). */
  setHandler(next: FakeHandler): void
  close(): Promise<void>
}

export async function startFakeModel(initial: FakeHandler): Promise<FakeModel> {
  const requests: FakeRequest[] = []
  let handler = initial
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8')
      let json: any = null
      try {
        json = body ? JSON.parse(body) : null
      } catch {
        json = null
      }
      const entry: FakeRequest = { method: req.method ?? 'GET', path: new URL(req.url ?? '/', 'http://127.0.0.1').pathname, body, json }
      requests.push(entry)
      let reply: FakeReply
      try {
        reply = handler(entry)
      } catch (err) {
        reply = { status: 500, body: JSON.stringify({ error: { message: String(err) } }) }
      }
      res.writeHead(reply.status ?? 200, { 'content-type': 'application/json', ...reply.headers })
      res.end(reply.body)
    })
  })
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen()))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    bodies: () => requests.map((r) => r.body).join('\n'),
    modelCalls: () => requests.filter((r) => (r.path.endsWith('/v1/messages') || r.path.endsWith('/chat/completions')) && r.method === 'POST'),
    setHandler: (next) => {
      handler = next
    },
    close: () => new Promise<void>((resolveClose) => {
      server.closeAllConnections?.()
      server.close(() => resolveClose())
    }),
  }
}

const SSE_HEADERS = { 'content-type': 'text/event-stream' }

/** One scripted model step: call a tool, or answer with text. */
export type ScriptStep =
  | { tool: string; input: Record<string, unknown> }
  | { text: string }

// ── Anthropic Messages (Claude Code) ──────────────────────────────────────────

function anthropicSse(content: Array<{ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }>, stopReason: string): FakeReply {
  const events: Array<[string, unknown]> = [
    ['message_start', { type: 'message_start', message: { id: 'msg_eyas_lane', type: 'message', role: 'assistant', model: 'eyas-lane', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }],
  ]
  content.forEach((block, index) => {
    if (block.type === 'text') {
      events.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }])
      events.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } }])
    } else {
      events.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } }])
      events.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } }])
    }
    events.push(['content_block_stop', { type: 'content_block_stop', index }])
  })
  events.push(['message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 5 } }])
  events.push(['message_stop', { type: 'message_stop' }])
  return { headers: SSE_HEADERS, body: events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('') }
}

/** tool_result blocks already in an Anthropic request: how far the script has run. */
function anthropicToolResults(json: any): number {
  const msgs: any[] = Array.isArray(json?.messages) ? json.messages : []
  return msgs.flatMap((m) => (Array.isArray(m?.content) ? m.content : [])).filter((b: any) => b?.type === 'tool_result').length
}

/**
 * A Claude Code-compatible fake. A request whose messages carry `marker`
 * plays `steps` in order, one per round trip (indexed by the tool results it
 * already carries); anything else — a title or summary side call — gets
 * `fallback`. The call of step n has the id `toolu_eyas_lane_<n>`.
 */
export function anthropicScript(marker: string, steps: readonly ScriptStep[], fallback = 'NONE'): FakeHandler {
  return (req) => {
    if (req.path.endsWith('/count_tokens')) return { body: JSON.stringify({ input_tokens: 10 }) }
    if (req.path.endsWith('/v1/messages')) {
      const main = JSON.stringify(req.json?.messages ?? []).includes(marker)
      const step = main ? steps[anthropicToolResults(req.json)] : undefined
      const content = step && 'tool' in step
        ? [{ type: 'tool_use' as const, id: `toolu_eyas_lane_${anthropicToolResults(req.json)}`, name: step.tool, input: step.input }]
        : [{ type: 'text' as const, text: step && 'text' in step ? step.text : fallback }]
      const stop = content[0].type === 'tool_use' ? 'tool_use' : 'end_turn'
      if (req.json?.stream) return anthropicSse(content, stop)
      return { body: JSON.stringify({ id: 'msg_eyas_lane', type: 'message', role: 'assistant', model: 'eyas-lane', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } }) }
    }
    if (req.method === 'HEAD' || req.path.startsWith('/api/hello')) return { body: '{}' }
    return { status: 404, body: JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'eyas live lane fake' } }) }
  }
}

// ── xAI-compatible (Grok CLI) ─────────────────────────────────────────────────

function openAiChatSse(delta: Record<string, unknown>, finish: string): FakeReply {
  const base = { id: 'chatcmpl-eyas-lane', object: 'chat.completion.chunk', created: 0, model: 'eyas-lane' }
  // The frame layout the A1 spike ran grok 1.0.40 against.
  const chunks = [
    { ...base, choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: finish }] },
    { ...base, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
  ]
  return { headers: SSE_HEADERS, body: chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n' }
}

function userText(json: any): string {
  const msgs: any[] = Array.isArray(json?.messages) ? json.messages : []
  return msgs.filter((m) => m?.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n')
}

/**
 * An xAI-compatible fake for grok: the API-key probe, the model list and
 * chat completions. A request whose user messages carry `marker` plays
 * `steps` (indexed by the tool messages it already carries); a forced tool
 * call (grok's session-title side call) and anything else get a plain answer.
 */
export function xaiScript(marker: string, steps: readonly ScriptStep[], opts: { models?: string[]; fallback?: string } = {}): FakeHandler {
  const models = opts.models ?? ['grok-4.6']
  return (req) => {
    if (req.path.endsWith('/api-key')) {
      return {
        body: JSON.stringify({
          redacted_api_key: 'xai-...lane', user_id: 'lane', name: 'eyas-lane', team_id: 'lane', api_key_id: 'lane',
          acls: ['api-key:model:*', 'api-key:endpoint:*'], api_key_blocked: false, team_blocked: false, api_key_disabled: false,
        }),
      }
    }
    if (req.path.endsWith('/models')) return { body: JSON.stringify({ object: 'list', data: models.map((id) => ({ id, object: 'model', owned_by: 'xai' })) }) }
    if (req.path.endsWith('/chat/completions')) {
      const forced = req.json?.tool_choice?.function?.name
      if (typeof forced === 'string') {
        return openAiChatSse({ content: null, tool_calls: [{ index: 0, id: 'call_forced', type: 'function', function: { name: forced, arguments: JSON.stringify({ session_title: 'EYAS live lane' }) } }] }, 'tool_calls')
      }
      const msgs: any[] = Array.isArray(req.json?.messages) ? req.json.messages : []
      const done = msgs.filter((m) => m?.role === 'tool').length
      const step = userText(req.json).includes(marker) ? steps[done] : undefined
      if (step && 'tool' in step) {
        return openAiChatSse({ content: null, tool_calls: [{ index: 0, id: `call_lane_${done}`, type: 'function', function: { name: step.tool, arguments: JSON.stringify(step.input) } }] }, 'tool_calls')
      }
      return openAiChatSse({ content: step && 'text' in step ? step.text : opts.fallback ?? 'NONE' }, 'stop')
    }
    if (req.path === '/' || req.path === '') return { body: '{}' }
    return { status: 404, body: JSON.stringify({ error: { message: 'eyas live lane fake: not implemented' } }) }
  }
}

/** Environment that points grok at the fake with a dummy key (A1 spike names). */
export function grokFakeEnv(url: string): Record<string, string> {
  return {
    XAI_API_KEY: 'eyas-live-lane-dummy-key',
    GROK_XAI_API_BASE_URL: url,
    GROK_CLI_CHAT_PROXY_BASE_URL: url,
    GROK_MODELS_BASE_URL: url,
  }
}

// ── Claude Code keychain shim ─────────────────────────────────────────────────

export interface ClaudeShim {
  /** Absolute path of the shim: what EYAS_CLAUDE_CODE_BIN names for the free cases. */
  path: string
  /** The real runtime the shim execs (its path as the resolver found it). */
  target: string
  /** Number of processes started through the shim so far. */
  spawns(): number
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Write the free-lane Claude Code shim under `root`: it redirects the CLI's
 * secure storage (the macOS keychain service) into `<root>/claude-secure-
 * storage`, logs the spawn and execs the real runtime with the arguments
 * unchanged. `launch` is how that runtime starts (claudeCommand(): the
 * SDK-bundled cli.js runs through the JS runtime, a binary runs directly).
 */
export function writeClaudeShim(root: string, target: string, launch: { command: string; args: readonly string[] }): ClaudeShim {
  const dir = join(root, 'bin')
  const secure = join(root, 'claude-secure-storage')
  const log = join(root, 'claude-spawns.log')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  mkdirSync(secure, { recursive: true, mode: 0o700 })
  const path = join(dir, 'claude')
  writeFileSync(path, [
    '#!/bin/sh',
    '# EYAS live lane: the operator keychain login is never read (free cases only).',
    `echo spawn >> ${shellQuote(log)}`,
    `CLAUDE_SECURESTORAGE_CONFIG_DIR=${shellQuote(secure)}`,
    'export CLAUDE_SECURESTORAGE_CONFIG_DIR',
    `exec ${[launch.command, ...launch.args].map(shellQuote).join(' ')} "$@"`,
    '',
  ].join('\n'), { mode: 0o700 })
  chmodSync(path, 0o700)
  return {
    path,
    target,
    spawns: () => {
      try {
        return readFileSync(log, 'utf-8').split('\n').filter(Boolean).length
      } catch {
        return 0
      }
    },
  }
}

// ── Looking at trees ──────────────────────────────────────────────────────────

/** Every regular file under `dir` (relative POSIX paths); symlinks are not followed. */
export function listFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (abs: string) => {
    let names: string[]
    try {
      names = readdirSync(abs)
    } catch {
      return
    }
    for (const name of names) {
      const full = join(abs, name)
      let st
      try {
        st = lstatSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(full)
      else if (st.isFile()) out.push(relative(dir, full).split(sep).join('/'))
    }
  }
  walk(dir)
  return out.sort()
}

/** Files under `dir` whose content contains any of `needles` (relative paths). */
export function filesContaining(dir: string, needles: readonly string[]): string[] {
  const wanted = needles.filter((n) => n.length > 0)
  if (wanted.length === 0 || !existsSync(dir)) return []
  return listFiles(dir).filter((rel) => {
    try {
      const text = readFileSync(join(dir, rel), 'utf-8')
      return wanted.some((n) => text.includes(n))
    } catch {
      return false
    }
  })
}

/** Entries of a folder; [] when it does not exist. */
export function entriesOf(dir: string): string[] {
  try {
    return readdirSync(dir).sort()
  } catch {
    return []
  }
}

/** ~/.claude.json of a HOME, parsed; null when absent or unreadable. */
export function readClaudeJson(home: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf-8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

// ── Serving an EYAS HTTP app on loopback ──────────────────────────────────────

export interface LoopbackServer {
  url: string
  close(): Promise<void>
}

/**
 * Serve a fetch handler (a Hono app's `fetch`) on 127.0.0.1 with node:http,
 * so a CLI's MCP child can reach EYAS routes exactly as it does in
 * production.
 */
export async function serveOnLoopback(fetchHandler: (req: Request) => Response | Promise<Response>): Promise<LoopbackServer> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      void (async () => {
        const headers = new Headers()
        for (const [key, value] of Object.entries(req.headers)) {
          if (Array.isArray(value)) for (const v of value) headers.append(key, v)
          else if (typeof value === 'string') headers.set(key, value)
        }
        const method = req.method ?? 'GET'
        const body = chunks.length && method !== 'GET' && method !== 'HEAD' ? Buffer.concat(chunks) : undefined
        try {
          const response = await fetchHandler(new Request(`http://127.0.0.1${req.url ?? '/'}`, { method, headers, body }))
          const out = Buffer.from(await response.arrayBuffer())
          res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
          res.end(out)
        } catch (err) {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: String(err) }))
        }
      })()
    })
  })
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen()))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolveClose) => {
      server.closeAllConnections?.()
      server.close(() => resolveClose())
    }),
  }
}
