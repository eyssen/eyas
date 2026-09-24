#!/usr/bin/env bun
// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * A1 spike: record what the installed CLI binaries REALLY do about isolation,
 * as fixtures that A5, A6, A7, A10, A14, B5 and I8 hard-code against.
 *
 *   bun scripts/cli-isolation-spike.ts [--out tests/fixtures/cli] [--only grok,claude-code,opencode,kimi] [--keep] [--summary <file>]
 *
 * Safety contract:
 * - Every CLI runs with a HOSTILE temp HOME (tests/live/hostile-home.ts) or an
 *   EYAS-owned temp home under it. The real home directory is never a target;
 *   binaries are only executed from where they are installed.
 * - ZERO paid calls by default. Model traffic is pointed at a local fake model
 *   server on 127.0.0.1 with a dummy API key, so a full agent turn (tool calls,
 *   permission prompts, host writes) is observed without reaching any model
 *   provider. Claude Code's secure storage is redirected
 *   (CLAUDE_SECURESTORAGE_CONFIG_DIR) so the operator's keychain login is never
 *   read or refreshed.
 * - The paid canary runs only with EYAS_SPIKE_ALLOW_PAID=1 AND an explicit key
 *   in EYAS_SPIKE_XAI_API_KEY / EYAS_SPIKE_ANTHROPIC_API_KEY.
 * - Fixtures are redacted (temp paths, real home, host name, machine ids,
 *   device codes) and scanned for leaks before the run reports success.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { createInterface } from 'node:readline'
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { hostname, userInfo } from 'node:os'
import { delimiter, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import pino from 'pino'
import {
  buildHostileHome,
  claudeProjectSlug,
  diffSnapshots,
  firedMarkers,
  realHomeDirs,
  snapshotTree,
  tomlString,
  type HostileHome,
} from '../tests/live/hostile-home.js'

const log = pino({ name: 'cli-isolation-spike', level: process.env.EYAS_SPIKE_LOG_LEVEL ?? 'info' })

// ── Plan: which steps run ─────────────────────────────────────────────────────

export const PAID_FLAG = 'EYAS_SPIKE_ALLOW_PAID'

export type SpikeCli = 'grok' | 'claude-code' | 'opencode' | 'kimi'

export interface SpikeStep {
  id: string
  cli: SpikeCli
  /** True when the step makes a real (billable) model call. */
  paid: boolean
  /** True when the step contacts a vendor server (never a model call). */
  network?: boolean
  description: string
}

export const SPIKE_STEPS: readonly SpikeStep[] = [
  { id: 'grok.version', cli: 'grok', paid: false, description: 'grok --version' },
  { id: 'grok.inspect', cli: 'grok', paid: false, description: 'grok inspect --json: hostile, isolated, in-root project, MCP allowlist' },
  { id: 'grok.acp', cli: 'grok', paid: false, description: 'ACP initialize/session/new/prompt against the local fake model (tool routing, fs calls, subagent, session store, system_prompt.txt)' },
  { id: 'grok.acp-in-root', cli: 'grok', paid: false, description: 'ACP run with the conversation cwd on the hostile project fixture' },
  { id: 'grok.always-approve-lock', cli: 'grok', paid: false, description: '"/always-approve on" with and without the requirements.toml lock' },
  { id: 'grok.mcp-allowlist', cli: 'grok', paid: false, description: 'ACP-supplied MCP servers under [[allowed_mcp_servers]]' },
  { id: 'grok.git-ceiling', cli: 'grok', paid: false, description: 'GIT_CEILING_DIRECTORIES effect on project root discovery' },
  { id: 'grok.hostile-control', cli: 'grok', paid: false, description: 'Same ACP script under the hostile host config (proves the probe detects a bypass)' },
  { id: 'grok.device-auth', cli: 'grok', paid: false, network: true, description: 'Non-TTY output of grok login --device-auth (requests a device code, never completes it)' },
  { id: 'grok.binary-facts', cli: 'grok', paid: false, description: 'Env and profile names present in the binary' },
  { id: 'grok.paid-canary', cli: 'grok', paid: true, description: 'Real model turn with the isolated home (EYAS_SPIKE_XAI_API_KEY)' },
  { id: 'claude-code.version', cli: 'claude-code', paid: false, description: 'claude --version and the SDK client version' },
  { id: 'claude-code.init-only', cli: 'claude-code', paid: false, description: 'Init-only SDK query with the planned isolated options; host-write diff' },
  { id: 'claude-code.full-turn', cli: 'claude-code', paid: false, description: 'One isolated turn (Bash tool + answer) against the local fake model; host-write diff' },
  { id: 'claude-code.control', cli: 'claude-code', paid: false, description: 'Same turn without isolation options (proves the diff detects transcripts and leaks)' },
  { id: 'claude-code.paid-canary', cli: 'claude-code', paid: true, description: 'Real model turn with the isolated options (EYAS_SPIKE_ANTHROPIC_API_KEY)' },
  { id: 'opencode.version', cli: 'opencode', paid: false, description: 'opencode --version' },
  { id: 'opencode.api', cli: 'opencode', paid: false, description: 'OpenAPI permission surface, auth location, permission.asked capture against the local fake model' },
  { id: 'opencode.binary-facts', cli: 'opencode', paid: false, description: 'OPENCODE_* env names present in the binary' },
  { id: 'kimi.source-facts', cli: 'kimi', paid: false, description: 'kimi-cli 1.52.0 facts derived from source (unverified on this host)' },
]

export interface PlannedStep extends SpikeStep {
  run: boolean
  skipReason?: string
}

export function paidLaneEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[PAID_FLAG] === '1'
}

/** Decides which steps run. Paid steps never run without EYAS_SPIKE_ALLOW_PAID=1. */
export function planSpike(env: NodeJS.ProcessEnv = process.env, only?: readonly SpikeCli[]): PlannedStep[] {
  const paid = paidLaneEnabled(env)
  const noNetwork = env.EYAS_SPIKE_SKIP_NETWORK === '1'
  return SPIKE_STEPS.map((step) => {
    if (only && only.length > 0 && !only.includes(step.cli)) return { ...step, run: false, skipReason: 'not selected (--only)' }
    if (step.paid && !paid) return { ...step, run: false, skipReason: `paid step: set ${PAID_FLAG}=1 to run it (the paid canaries of the release gate live in tests/live/cli-isolation.live.test.ts, EYAS_LIVE_CLI_PAID)` }
    if (step.network && noNetwork) return { ...step, run: false, skipReason: 'EYAS_SPIKE_SKIP_NETWORK=1' }
    return { ...step, run: true }
  })
}

// ── Fixture writing and redaction ─────────────────────────────────────────────

export interface RedactionRule {
  from: string | RegExp
  to: string
}

/** Object keys whose values identify a machine or install; always replaced. */
export const DEFAULT_REDACT_KEYS: readonly string[] = ['agentId', 'agentInstanceId', 'machineID', 'userID', 'hostname', 'agent_id']

/**
 * Deep-redacts every string (and object key) in a JSON-like value, and
 * replaces the value of every key listed in `redactKeys` with '<REDACTED>'.
 */
export function redact<T>(value: T, rules: readonly RedactionRule[], redactKeys: readonly string[] = DEFAULT_REDACT_KEYS): T {
  const apply = (s: string): string => {
    let out = s
    for (const rule of rules) {
      if (typeof rule.from === 'string') {
        if (rule.from.length > 0) out = out.split(rule.from).join(rule.to)
      } else {
        out = out.replace(rule.from, rule.to)
      }
    }
    return out
  }
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return apply(v)
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, inner] of Object.entries(v as Record<string, unknown>)) {
        out[apply(k)] = redactKeys.includes(k) && inner != null ? '<REDACTED>' : walk(inner)
      }
      return out
    }
    return v
  }
  return walk(value) as T
}

/**
 * Writes one fixture. `.json` files are pretty JSON with a trailing newline;
 * anything else is written as text. Returns the absolute path.
 */
export function writeFixture(dir: string, name: string, data: unknown): string {
  const path = join(dir, name)
  mkdirSync(dirname(path), { recursive: true })
  if (extname(name) === '.json') {
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n')
  } else {
    const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
    writeFileSync(path, text.endsWith('\n') ? text : text + '\n')
  }
  return path
}

/** Returns `file: needle` for every fixture file under `dir` that contains a forbidden string. */
export function findFixtureLeaks(dir: string, forbidden: readonly string[]): string[] {
  const offenders: string[] = []
  const needles = forbidden.filter((s) => s.length >= 4)
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name)
      if (statSync(full).isDirectory()) walk(full)
      else {
        const text = readFileSync(full, 'utf8')
        for (const needle of needles) if (text.includes(needle)) offenders.push(`${relative(dir, full)}: ${needle}`)
      }
    }
  }
  if (existsSync(dir)) walk(dir)
  return offenders
}

// ── Process helpers ───────────────────────────────────────────────────────────

const SYSTEM_PATH = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(delimiter)

function isExecutable(path: string): boolean {
  try {
    accessSync(path, fsConstants.X_OK)
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function findOnPath(name: string, pathEnv = process.env.PATH ?? ''): string | null {
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, name)
    if (isExecutable(candidate)) return candidate
  }
  return null
}

export interface SpikeBinary {
  path: string
  source: 'override' | 'path' | 'installer-default'
}

/** Resolves a CLI binary: explicit override, then PATH, then the installer's default location. */
export function resolveSpikeBinary(cli: SpikeCli, env: NodeJS.ProcessEnv = process.env): SpikeBinary | null {
  const table: Record<SpikeCli, { override: string; names: string[]; installerRel?: string[] }> = {
    grok: { override: 'EYAS_SPIKE_GROK_BIN', names: ['grok'], installerRel: ['.grok', 'bin', 'grok'] },
    'claude-code': { override: 'EYAS_SPIKE_CLAUDE_BIN', names: ['claude'] },
    opencode: { override: 'EYAS_SPIKE_OPENCODE_BIN', names: ['opencode'], installerRel: ['.opencode', 'bin', 'opencode'] },
    kimi: { override: 'EYAS_SPIKE_KIMI_BIN', names: ['kimi'] },
  }
  const spec = table[cli]
  const override = env[spec.override]
  if (override) return isExecutable(override) ? { path: override, source: 'override' } : null
  for (const name of spec.names) {
    const found = findOnPath(name, env.PATH)
    if (found) return { path: found, source: 'path' }
  }
  if (spec.installerRel) {
    // Executing an installed binary from its install location; nothing under the real home is read or written.
    const home = realHomeDirs()[0]
    if (home) {
      const candidate = join(home, ...spec.installerRel)
      if (isExecutable(candidate)) return { path: candidate, source: 'installer-default' }
    }
  }
  return null
}

function runSync(bin: string, args: string[], opts: { cwd: string; env: Record<string, string>; timeoutMs?: number }) {
  const r = spawnSync(bin, args, { cwd: opts.cwd, env: opts.env, encoding: 'utf8', timeout: opts.timeoutMs ?? 60_000 })
  return { status: r.status, signal: r.signal, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createNetServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolvePort(port))
    })
  })
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function binaryMentions(bin: string, tokens: readonly string[]): Record<string, boolean> {
  const buf = readFileSync(bin)
  const out: Record<string, boolean> = {}
  for (const token of tokens) out[token] = buf.indexOf(Buffer.from(token, 'utf8')) >= 0
  return out
}

function clearMarkers(h: HostileHome): void {
  for (const name of readdirSync(h.markers)) rmSync(join(h.markers, name), { force: true })
}

// ── Local fake model server ──────────────────────────────────────────────────

interface FakeRequest {
  method: string
  path: string
  body: string
  json: any
}

interface FakeReply {
  status?: number
  headers?: Record<string, string>
  body: string
}

type FakeHandler = (req: FakeRequest) => FakeReply

interface FakeServer {
  url: string
  requests: FakeRequest[]
  /** Called synchronously before the handler, e.g. to inspect CLI state at the moment of a model call. */
  onRequest?: (req: FakeRequest) => void
  close(): Promise<void>
}

async function startFakeServer(handler: FakeHandler): Promise<FakeServer> {
  const requests: FakeRequest[] = []
  const fake: FakeServer = { url: '', requests, close: async () => {} }
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      let json: any = null
      try {
        json = body ? JSON.parse(body) : null
      } catch {
        json = null
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const entry: FakeRequest = { method: req.method ?? 'GET', path: url.pathname, body, json }
      requests.push(entry)
      let reply: FakeReply
      try {
        fake.onRequest?.(entry)
        reply = handler(entry)
      } catch (err) {
        reply = { status: 500, body: JSON.stringify({ error: { message: String(err) } }) }
      }
      res.writeHead(reply.status ?? 200, { 'content-type': 'application/json', ...reply.headers })
      res.end(reply.body)
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  fake.url = `http://127.0.0.1:${port}`
  fake.close = () => new Promise<void>((r) => server.close(() => r()))
  return fake
}

const SSE_HEADERS = { 'content-type': 'text/event-stream' }

function openAiChatSse(delta: Record<string, unknown>, finish: string): FakeReply {
  const base = { id: 'chatcmpl-eyas-spike', object: 'chat.completion.chunk', created: 0, model: 'eyas-spike' }
  const frames = [
    { ...base, choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: finish }] },
    { ...base, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
  ]
  return { headers: SSE_HEADERS, body: frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('') + 'data: [DONE]\n\n' }
}

function openAiToolCall(id: string, name: string, args: Record<string, unknown>): FakeReply {
  return openAiChatSse(
    { content: null, tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] },
    'tool_calls',
  )
}

function openAiText(text: string): FakeReply {
  return openAiChatSse({ content: text }, 'stop')
}

/** Concatenated text of every user message in an OpenAI chat request. */
function openAiUserText(json: any): string {
  const msgs: any[] = Array.isArray(json?.messages) ? json.messages : []
  return msgs
    .filter((m) => m?.role === 'user')
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n')
}

function openAiToolResultCount(json: any): number {
  const msgs: any[] = Array.isArray(json?.messages) ? json.messages : []
  return msgs.filter((m) => m?.role === 'tool').length
}

// ── ACP driver ────────────────────────────────────────────────────────────────

interface AcpTraceEntry {
  dir: 'out' | 'in'
  msg: any
}

type AcpServerRequestHandler = (msg: any) => { result?: unknown; error?: string }

class AcpProcess {
  readonly trace: AcpTraceEntry[] = []
  readonly stderr: string[] = []
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (v: any) => void; reject: (e: unknown) => void }>()
  private readonly exited: Promise<number | null>

  private constructor(private readonly proc: ChildProcess, private readonly onServerRequest: AcpServerRequestHandler) {
    this.exited = new Promise((r) => proc.on('exit', (code) => r(code)))
    createInterface({ input: proc.stdout! }).on('line', (line) => this.onLine(line))
    proc.stderr?.on('data', (c: Buffer) => this.stderr.push(c.toString('utf8')))
  }

  static start(bin: string, args: string[], cwd: string, env: Record<string, string>, onServerRequest: AcpServerRequestHandler): AcpProcess {
    const proc = spawn(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    return new AcpProcess(proc, onServerRequest)
  }

  private write(msg: Record<string, unknown>): void {
    this.trace.push({ dir: 'out', msg })
    if (this.proc.stdin && !this.proc.stdin.destroyed) this.proc.stdin.write(JSON.stringify(msg) + '\n')
  }

  private onLine(line: string): void {
    let msg: any
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    this.trace.push({ dir: 'in', msg })
    if (msg.id != null && !msg.method) {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.error) p.reject(msg.error)
      else p.resolve(msg.result)
      return
    }
    if (msg.method && msg.id != null) {
      const reply = this.onServerRequest(msg)
      if (reply.error !== undefined) this.write({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: reply.error } })
      else this.write({ jsonrpc: '2.0', id: msg.id, result: reply.result ?? null })
    }
  }

  request(method: string, params: Record<string, unknown>, timeoutMs = 60_000): Promise<any> {
    const id = this.nextId++
    return new Promise((resolveReq, reject) => {
      this.pending.set(id, { resolve: resolveReq, reject })
      this.write({ jsonrpc: '2.0', id, method, params })
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`ACP ${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    })
  }

  inbound(method: string): any[] {
    return this.trace.filter((t) => t.dir === 'in' && t.msg.method === method).map((t) => t.msg)
  }

  async stop(): Promise<number | null> {
    try {
      this.proc.stdin?.end()
    } catch {
      /* already closed */
    }
    const timer = setTimeout(() => this.proc.kill('SIGKILL'), 5_000)
    this.proc.kill('SIGTERM')
    const code = await this.exited
    clearTimeout(timer)
    return code
  }
}

/** EYAS-style client answers: allow_once only (never allow_always), fs served inside the temp root only. */
function spikeAcpClient(root: string): AcpServerRequestHandler {
  const inside = (p: unknown) => typeof p === 'string' && resolve(p).startsWith(root + sep)
  return (msg) => {
    const params = msg.params ?? {}
    if (msg.method === 'session/request_permission') {
      const options: any[] = Array.isArray(params.options) ? params.options : []
      const once = options.find((o) => o?.kind === 'allow_once')
      return { result: once ? { outcome: { outcome: 'selected', optionId: once.optionId } } : { outcome: { outcome: 'cancelled' } } }
    }
    if (msg.method === 'fs/read_text_file') {
      if (!inside(params.path)) return { error: 'outside the spike root' }
      try {
        const text = readFileSync(params.path, 'utf8')
        const lines = text.split('\n')
        const start = typeof params.line === 'number' ? Math.max(params.line - 1, 0) : 0
        const end = typeof params.limit === 'number' ? start + params.limit : lines.length
        return { result: { content: lines.slice(start, end).join('\n') } }
      } catch (err) {
        return { error: String(err) }
      }
    }
    if (msg.method === 'fs/write_text_file') {
      if (!inside(params.path)) return { error: 'outside the spike root' }
      try {
        writeFileSync(params.path, String(params.content ?? ''))
        return { result: null }
      } catch (err) {
        return { error: String(err) }
      }
    }
    return { error: `unsupported ${msg.method}` }
  }
}

/** Compact ordered trace of the governance-relevant ACP traffic. */
function governanceTrace(acp: AcpProcess): unknown[] {
  const out: unknown[] = []
  for (const t of acp.trace) {
    const m = t.msg
    if (t.dir === 'in' && m.method === 'session/update') {
      const u = m.params?.update ?? {}
      if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') {
        out.push({
          event: u.sessionUpdate,
          sessionId: m.params?.sessionId,
          toolCallId: u.toolCallId,
          title: u.title,
          kind: u.kind,
          status: u.status,
          locations: u.locations,
          rawInputKeys: u.rawInput && typeof u.rawInput === 'object' ? Object.keys(u.rawInput) : undefined,
        })
      }
    } else if (t.dir === 'in' && typeof m.method === 'string' && (m.method === 'session/request_permission' || m.method.startsWith('fs/'))) {
      out.push({
        event: m.method,
        sessionId: m.params?.sessionId,
        toolCallId: m.params?.toolCall?.toolCallId,
        kind: m.params?.toolCall?.kind,
        title: m.params?.toolCall?.title,
        path: m.params?.path,
        options: Array.isArray(m.params?.options) ? m.params.options.map((o: any) => ({ kind: o.kind, name: o.name, optionId: o.optionId })) : undefined,
      })
    }
  }
  return out
}

// ── Grok ──────────────────────────────────────────────────────────────────────

const GROK_MAIN_MARKER = 'EYAS-SPIKE-MAIN'
const GROK_SUB_MARKER = 'EYAS-SPIKE-SUBAGENT'
const SYSTEM_NONCE = 'EYAS-SPIKE-NONCE-7f3a'

/** The candidate EYAS-owned GROK_HOME config (A5's template, minus keys 1.0.40 rejects). */
export function candidateGrokConfigToml(): string {
  return [
    '# EYAS-managed candidate (A1 spike). Keys grok 1.0.40 reports as unknown are dropped.',
    '[ui]',
    'permission_mode = "ask"',
    'remember_tool_approvals = false',
    '',
    '[memory]',
    'enabled = false',
    '',
    '[memory_v2]',
    'enabled = false',
    'capture_enabled = false',
    'file_writes_enabled = false',
    'automatic_dream_enabled = false',
    '',
    '[storage]',
    'cleanup_ttl_days = 1',
    '',
    '[cli]',
    'auto_update = false',
    'use_leader = false',
    'session_registry = false',
    '',
    '[features]',
    'session_search = false',
    'telemetry = false',
    '',
    '[telemetry]',
    'trace_upload = false',
    '',
    '[compat.claude]',
    'skills = false',
    'rules = false',
    'agents = false',
    'mcps = false',
    'hooks = false',
    'sessions = false',
    '',
    '[compat.cursor]',
    'skills = false',
    'rules = false',
    'agents = false',
    'mcps = false',
    'hooks = false',
    'sessions = false',
    '',
    '[compat.codex]',
    'hooks = false',
    'skills = false',
    'sessions = false',
    '',
    '[permission]',
    'ask = ["Read", "Edit", "Grep", "Bash", "WebFetch", "WebSearch"]',
    'allow = ["MCPTool(eyas__*)"]',
    '',
  ].join('\n')
}

export function candidateGrokRequirementsToml(opts: { mcpAllowlist?: string[] } = {}): string {
  const lines = [
    '# EYAS-managed candidate requirements (A1 spike).',
    '[ui]',
    'disable_bypass_permissions_mode = true',
    '',
    '[memory]',
    'enabled = false',
    '',
    '[memory_v2]',
    'enabled = false',
    '',
    '[telemetry]',
    'trace_upload = false',
    '',
    '[cli]',
    'use_leader = false',
    '',
    '[features]',
    'session_search = false',
    '',
  ]
  if (opts.mcpAllowlist) {
    lines.splice(1, 0, 'enable_all_project_mcp_servers = false', '')
    for (const name of opts.mcpAllowlist) lines.push('[[allowed_mcp_servers]]', `server_name = ${tomlString(name)}`, '')
  }
  return lines.join('\n')
}

/** A5's candidate grok env (spike-only extras are passed separately). */
export function candidateGrokEnv(home: string, tmp: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: SYSTEM_PATH,
    HOME: home,
    GROK_HOME: join(home, '.grok'),
    TMPDIR: tmp,
    GROK_MEMORY: '0',
    GROK_CLAUDE_SKILLS_ENABLED: 'false',
    GROK_CLAUDE_RULES_ENABLED: 'false',
    GROK_CLAUDE_AGENTS_ENABLED: 'false',
    GROK_CLAUDE_MCPS_ENABLED: 'false',
    GROK_CLAUDE_HOOKS_ENABLED: 'false',
    GROK_CLAUDE_SESSIONS_ENABLED: 'false',
    GROK_CURSOR_SKILLS_ENABLED: 'false',
    GROK_CURSOR_RULES_ENABLED: 'false',
    GROK_CURSOR_AGENTS_ENABLED: 'false',
    GROK_CURSOR_MCPS_ENABLED: 'false',
    GROK_CURSOR_HOOKS_ENABLED: 'false',
    GROK_TELEMETRY_ENABLED: '0',
    GROK_TELEMETRY_TRACE_UPLOAD: '0',
    GROK_SESSION_SEARCH: '0',
    GROK_REMEMBER_TOOL_APPROVALS: 'false',
    GROK_DISABLE_AUTOUPDATER: '1',
    ...extra,
  }
}

function writeGrokHome(home: string, opts: { requirements: boolean; mcpAllowlist?: string[] }): Record<string, string> {
  const grokHome = join(home, '.grok')
  mkdirSync(grokHome, { recursive: true, mode: 0o700 })
  const files: Record<string, string> = {
    'config.toml': candidateGrokConfigToml(),
    'trusted_folders.toml': '',
  }
  if (opts.requirements) files['requirements.toml'] = candidateGrokRequirementsToml({ mcpAllowlist: opts.mcpAllowlist })
  for (const [name, content] of Object.entries(files)) writeFileSync(join(grokHome, name), content, { mode: 0o600 })
  return files
}

interface GrokStep {
  name: string
  args: Record<string, unknown>
}

/** xAI-compatible fake: API-key probe, model list, chat completions replaying a tool script. */
function grokFakeHandler(script: { main: GrokStep[]; sub?: GrokStep[] }): FakeHandler {
  return (req) => {
    if (req.path.endsWith('/api-key')) {
      return {
        body: JSON.stringify({
          redacted_api_key: 'xai-...spike', user_id: 'spike', name: 'eyas-spike', team_id: 'spike', api_key_id: 'spike',
          acls: ['api-key:model:*', 'api-key:endpoint:*'], api_key_blocked: false, team_blocked: false, api_key_disabled: false,
        }),
      }
    }
    if (req.path.endsWith('/models')) return { body: JSON.stringify({ object: 'list', data: [{ id: 'grok-4.6', object: 'model', owned_by: 'xai' }] }) }
    if (req.path.endsWith('/chat/completions')) {
      const forced = req.json?.tool_choice?.function?.name
      if (typeof forced === 'string') return openAiToolCall('call_forced', forced, { session_title: 'EYAS spike' })
      const text = openAiUserText(req.json)
      const done = openAiToolResultCount(req.json)
      const isSub = text.includes(GROK_SUB_MARKER) && !text.includes(GROK_MAIN_MARKER)
      const steps = isSub ? script.sub ?? [] : text.includes(GROK_MAIN_MARKER) ? script.main : []
      const step = steps[done]
      if (!step) return openAiText(isSub ? 'SUB-DONE' : 'NONE')
      return openAiToolCall(`call_${isSub ? 'sub' : 'main'}_${done}`, step.name, step.args)
    }
    if (req.path === '/' || req.path === '') return { body: '{}' }
    return { status: 404, body: JSON.stringify({ error: { message: 'eyas spike fake: not implemented' } }) }
  }
}

function sinkArgs(url: string): string[] {
  return ['--xai-api-base-url', url, '--cli-chat-proxy-base-url', url]
}

function sinkEnv(url: string): Record<string, string> {
  return {
    XAI_API_KEY: 'eyas-spike-dummy-key',
    GROK_XAI_API_BASE_URL: url,
    GROK_CLI_CHAT_PROXY_BASE_URL: url,
    GROK_MODELS_BASE_URL: url,
  }
}

/** A tiny MCP stdio server (run by the current JS runtime) that records its start and exposes one tool. */
function markerMcpServer(name: string, marker: string): { name: string; command: string; args: string[]; env: Array<{ name: string; value: string }> } {
  const script = [
    "const fs=require('fs');fs.appendFileSync(process.env.EYAS_SPIKE_MARKER,'start\\n');",
    "const rl=require('readline').createInterface({input:process.stdin});",
    'const out=(o)=>process.stdout.write(JSON.stringify(o)+"\\n");',
    "rl.on('line',(l)=>{let m;try{m=JSON.parse(l)}catch{return}",
    "if(m.method==='initialize'){out({jsonrpc:'2.0',id:m.id,result:{protocolVersion:(m.params&&m.params.protocolVersion)||'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'eyas-spike',version:'0'}}})}",
    "else if(m.method==='tools/list'){out({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'spike_ping',description:'EYAS spike ping',inputSchema:{type:'object',properties:{}}}]}})}",
    "else if(m.method==='tools/call'){out({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'pong'}]}})}",
    "else if(m.id!=null){out({jsonrpc:'2.0',id:m.id,result:{}})}});",
  ].join('')
  return { name, command: process.execPath, args: ['-e', script], env: [{ name: 'EYAS_SPIKE_MARKER', value: marker }] }
}

function sessionStoreLayout(grokHome: string, cwd: string, sessionIds: string[]): string[] {
  const sessions = join(grokHome, 'sessions')
  if (!existsSync(sessions)) return []
  const enc = encodeURIComponent(cwd)
  const out: string[] = []
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name)
      let rel = relative(grokHome, full).split(sep).join('/')
      rel = rel.split(enc).join('<ENC_CWD>')
      for (const id of sessionIds) rel = rel.split(id).join('<SESSION_ID>')
      rel = rel.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<OTHER_SESSION_ID>')
      out.push(statSync(full).isDirectory() ? rel + '/' : rel)
      if (statSync(full).isDirectory()) walk(full)
    }
  }
  walk(sessions)
  return [...new Set(out)]
}

function findSystemPromptFile(grokHome: string, sessionId: string): string | null {
  const sessions = join(grokHome, 'sessions')
  if (!existsSync(sessions)) return null
  for (const group of readdirSync(sessions)) {
    const candidate = join(sessions, group, sessionId, 'system_prompt.txt')
    if (existsSync(candidate)) return candidate
  }
  return null
}

interface SystemPromptFileState {
  exists: boolean
  bytes: number
  containsNonce: boolean
}

function systemPromptFileState(grokHome: string, sessionId: string): SystemPromptFileState {
  const file = findSystemPromptFile(grokHome, sessionId)
  if (!file) return { exists: false, bytes: 0, containsNonce: false }
  const text = readFileSync(file, 'utf8')
  return { exists: true, bytes: Buffer.byteLength(text), containsNonce: text.includes(SYSTEM_NONCE) }
}

/** MCP lifecycle events grok records in <GROK_HOME>/sessions/<enc-cwd>/<id>/events.jsonl. */
function sessionMcpEvents(grokHome: string, sessionId: string): unknown[] {
  const sessions = join(grokHome, 'sessions')
  if (!existsSync(sessions)) return []
  for (const group of readdirSync(sessions)) {
    const file = join(sessions, group, sessionId, 'events.jsonl')
    if (!existsSync(file)) continue
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter((e) => e && typeof e.type === 'string' && e.type.startsWith('mcp_'))
      .map((e) => ({ type: e.type, server: e.server_name, servers: e.servers, tools: e.tools, succeeded: e.succeeded, failed: e.failed }))
  }
  return []
}

function sentinelsIn(text: string): string[] {
  return [...new Set(text.match(/EYAS-SENTINEL-[a-z-]+-[0-9a-f]{12}/g) ?? [])].map((s) => s.replace(/-[0-9a-f]{12}$/, ''))
}

interface GrokAcpRun {
  initialize: any
  sessionNew: any
  sessionNewError?: unknown
  prompts: Array<{ text: string; result?: any; error?: unknown; updates?: any[]; permissionRequests?: number }>
  systemPromptFile?: { atSessionNew: SystemPromptFileState; atFirstModelRequest: SystemPromptFileState; afterPrompts: SystemPromptFileState }
  mcpEvents: unknown[]
  trace: unknown[]
  permissionRequests: any[]
  fsCalls: any[]
  updates: any[]
  modelRequests: FakeRequest[]
  sessionIds: string[]
  stderrTail: string
}

async function runGrokAcp(opts: {
  bin: string
  env: Record<string, string>
  cwd: string
  root: string
  fake: FakeServer
  prompts: string[]
  mcpServers?: unknown[]
  checkSystemPromptFile?: string
  settleMs?: number
}): Promise<GrokAcpRun> {
  const firstRequest = opts.fake.requests.length
  const acp = AcpProcess.start(opts.bin, ['agent', '--no-leader', ...sinkArgs(opts.fake.url), 'stdio'], opts.cwd, opts.env, spikeAcpClient(opts.root))
  const run: GrokAcpRun = {
    initialize: null,
    sessionNew: null,
    prompts: [],
    trace: [],
    permissionRequests: [],
    fsCalls: [],
    updates: [],
    mcpEvents: [],
    modelRequests: [],
    sessionIds: [],
    stderrTail: '',
  }
  try {
    run.initialize = await acp.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      clientInfo: { name: 'EYAS', version: '1.0.0' },
    })
    try {
      run.sessionNew = await acp.request('session/new', {
        cwd: opts.cwd,
        mcpServers: opts.mcpServers ?? [],
        _meta: { systemPromptOverride: `${SYSTEM_NONCE} EYAS spike system prompt.` },
      })
    } catch (err) {
      run.sessionNewError = err
    }
    const sessionId: string | undefined = run.sessionNew?.sessionId
    if (sessionId) {
      run.sessionIds.push(sessionId)
      const atSessionNew = opts.checkSystemPromptFile ? systemPromptFileState(opts.checkSystemPromptFile, sessionId) : undefined
      let atFirstModelRequest: SystemPromptFileState | undefined
      if (opts.checkSystemPromptFile) {
        const grokHome = opts.checkSystemPromptFile
        opts.fake.onRequest = (req) => {
          if (!atFirstModelRequest && req.path.endsWith('/chat/completions') && openAiUserText(req.json).includes(GROK_MAIN_MARKER)) {
            atFirstModelRequest = systemPromptFileState(grokHome, sessionId)
          }
        }
      }
      for (const text of opts.prompts) {
        const entry: GrokAcpRun['prompts'][number] = { text }
        const traceStart = acp.trace.length
        try {
          entry.result = await acp.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }, 180_000)
        } catch (err) {
          entry.error = err
        }
        const slice = acp.trace.slice(traceStart).filter((t) => t.dir === 'in')
        entry.updates = slice
          .filter((t) => t.msg.method === 'session/update')
          .map((t) => t.msg.params?.update)
          .filter((u) => u && u.sessionUpdate !== 'agent_message_chunk' && u.sessionUpdate !== 'available_commands_update')
          .map((u) => ({ sessionUpdate: u.sessionUpdate, toolCallId: u.toolCallId, title: u.title, kind: u.kind, status: u.status, currentModeId: u.currentModeId }))
        entry.permissionRequests = slice.filter((t) => t.msg.method === 'session/request_permission').length
        run.prompts.push(entry)
      }
      opts.fake.onRequest = undefined
      if (opts.checkSystemPromptFile && atSessionNew) {
        run.systemPromptFile = {
          atSessionNew,
          atFirstModelRequest: atFirstModelRequest ?? { exists: false, bytes: 0, containsNonce: false },
          afterPrompts: systemPromptFileState(opts.checkSystemPromptFile, sessionId),
        }
        run.mcpEvents = sessionMcpEvents(opts.checkSystemPromptFile, sessionId)
      }
    }
    await sleep(opts.settleMs ?? 1_000)
  } finally {
    await acp.stop()
  }
  run.trace = governanceTrace(acp)
  run.permissionRequests = acp.inbound('session/request_permission').map((m) => m.params)
  run.fsCalls = acp.trace
    .filter((t) => t.dir === 'in' && typeof t.msg.method === 'string' && t.msg.method.startsWith('fs/'))
    .map((t) => ({ method: t.msg.method, path: t.msg.params?.path, line: t.msg.params?.line, limit: t.msg.params?.limit }))
  run.updates = acp.inbound('session/update').map((m) => m.params?.update).filter((u) => u && u.sessionUpdate !== 'agent_message_chunk')
  for (const u of acp.inbound('session/update')) {
    const sid = u.params?.sessionId
    if (typeof sid === 'string' && !run.sessionIds.includes(sid)) run.sessionIds.push(sid)
  }
  run.modelRequests = opts.fake.requests.slice(firstRequest)
  run.stderrTail = acp.stderr.join('').slice(-2000)
  return run
}

function mainModelRequest(reqs: FakeRequest[]): any {
  return reqs.find((r) => r.path.endsWith('/chat/completions') && !r.json?.tool_choice && openAiUserText(r.json).includes(GROK_MAIN_MARKER))?.json ?? null
}

function summarizeInspect(inspect: any) {
  if (!inspect || typeof inspect !== 'object') return null
  return {
    projectRoot: inspect.projectRoot ?? null,
    projectTrusted: inspect.projectTrusted,
    projectInstructions: (inspect.projectInstructions ?? []).map((p: any) => ({ scope: p.scope, fileType: p.fileType, vendor: p.vendor })),
    permissionSources: inspect.permissions?.sources?.length ?? 0,
    permissionEnforced: inspect.permissions?.enforced ?? [],
    mcpServerAllowlist: inspect.permissions?.mcpServerAllowlist ?? [],
    hooks: (inspect.hooks ?? []).map((h: any) => ({ event: h.event, source: h.source?.type, vendor: h.vendor })),
    skills: (inspect.skills ?? []).map((s: any) => ({ source: s.source?.type, vendor: s.vendor })),
    agents: (inspect.agents ?? []).filter((a: any) => a.source?.type !== 'builtin').map((a: any) => a.source?.type),
    mcpServers: (inspect.mcpServers ?? []).map((m: any) => ({ name: m.name, source: m.source?.type, blocked: m.blocked ?? m.policy ?? undefined })),
    configLayers: (inspect.configSources?.layers ?? []).map((l: any) => l.role),
    compatEnabled: (inspect.externalCompat?.cells ?? []).filter((c: any) => c.enabled).map((c: any) => `${c.vendor}.${c.surface}`),
    configWarnings: (inspect.configWarnings ?? []).map((w: any) => ({ path: w.path, kind: w.kind })),
    topLevelKeys: Object.keys(inspect),
  }
}

interface SpikeContext {
  h: HostileHome
  fixtures: string
  rules: RedactionRule[]
  steps: Map<string, PlannedStep>
  results: Record<string, unknown>
}

function shouldRun(ctx: SpikeContext, id: string): boolean {
  const step = ctx.steps.get(id)
  if (!step) return false
  if (!step.run) {
    ctx.results[id] = { skipped: true, reason: step.skipReason }
    log.info({ step: id, reason: step.skipReason }, 'step skipped')
  } else {
    log.info({ step: id }, 'step')
  }
  return step.run
}

function fixture(ctx: SpikeContext, dir: string, name: string, data: unknown): void {
  writeFixture(join(ctx.fixtures, dir), name, redact(data, ctx.rules))
}

const GROK_ENV_NAMES = [
  'GROK_HOME', 'GROK_MEMORY', 'GROK_CLAUDE_SKILLS_ENABLED', 'GROK_CLAUDE_RULES_ENABLED', 'GROK_CLAUDE_AGENTS_ENABLED',
  'GROK_CLAUDE_MCPS_ENABLED', 'GROK_CLAUDE_HOOKS_ENABLED', 'GROK_CLAUDE_SESSIONS_ENABLED', 'GROK_CURSOR_SKILLS_ENABLED',
  'GROK_CURSOR_RULES_ENABLED', 'GROK_CURSOR_AGENTS_ENABLED', 'GROK_CURSOR_MCPS_ENABLED', 'GROK_CURSOR_HOOKS_ENABLED',
  'GROK_TELEMETRY_ENABLED', 'GROK_TELEMETRY_TRACE_UPLOAD', 'GROK_SESSION_SEARCH', 'GROK_REMEMBER_TOOL_APPROVALS',
  'GROK_DISABLE_AUTOUPDATER', 'GROK_STORAGE_MODE', 'GROK_FOLDER_TRUST', 'GROK_SANDBOX', 'GROK_SANDBOX_AUTO_ALLOW_BASH',
  'GROK_SUBAGENTS', 'GROK_WEB_FETCH', 'GROK_CONFIG', 'GROK_CONFIG_PATH', 'GROK_XAI_API_BASE_URL', 'GROK_CLI_CHAT_PROXY_BASE_URL',
  'GROK_MODELS_BASE_URL', 'GROK_DEFAULT_SELECTED_PERMISSION', 'XAI_API_KEY',
] as const

async function runGrok(ctx: SpikeContext): Promise<void> {
  const bin = resolveSpikeBinary('grok')
  if (!bin) {
    ctx.results.grok = { available: false, reason: 'grok binary not found (EYAS_SPIKE_GROK_BIN, PATH, installer default)' }
    return
  }
  const { h } = ctx
  ctx.rules.unshift({ from: bin.path, to: '<GROK_BIN>' })
  const tmp = join(h.root, 'tmp')
  mkdirSync(tmp, { recursive: true })
  const eyasHome = (name: string) => join(h.eyasHomes, name)
  const probeHome = eyasHome('grok-cli-version')
  mkdirSync(probeHome, { recursive: true })
  const versionOut = runSync(bin.path, ['--version'], { cwd: h.root, env: candidateGrokEnv(probeHome, tmp) })
  const version = /grok\s+(\d+\.\d+\.\d+)/.exec(versionOut.stdout)?.[1] ?? 'unknown'
  const dir = join('grok', version)
  if (shouldRun(ctx, 'grok.version')) {
    fixture(ctx, dir, 'version.json', { version, raw: versionOut.stdout.trim(), binarySource: bin.source })
  }

  const workspace = join(h.root, 'workspaces', 'conv-1')
  mkdirSync(workspace, { recursive: true })
  writeFileSync(join(workspace, 'probe.txt'), 'PROBE line 1\nline 2\nline 3\nline 4\n')
  writeFileSync(join(h.project, 'probe.txt'), 'PROBE project line\n')

  const isolatedHome = eyasHome('grok-cli')
  const managed = writeGrokHome(isolatedHome, { requirements: true })

  // ── inspect ──
  if (shouldRun(ctx, 'grok.inspect')) {
    const inspect = (env: Record<string, string>, cwd: string) => {
      const r = runSync(bin.path, ['inspect', '--json'], { cwd, env })
      try {
        return { exit: r.status, json: JSON.parse(r.stdout) }
      } catch {
        return { exit: r.status, json: null, stdout: r.stdout.slice(0, 2000), stderr: r.stderr.slice(0, 2000) }
      }
    }
    const hostileEnv = { PATH: SYSTEM_PATH, HOME: h.home, TMPDIR: tmp, GROK_DISABLE_AUTOUPDATER: '1' }
    const cases = {
      hostile: inspect(hostileEnv, h.project),
      isolated: inspect(candidateGrokEnv(isolatedHome, tmp), workspace),
      'in-root-project': inspect(candidateGrokEnv(isolatedHome, tmp), h.project),
    }
    const allowHome = eyasHome('grok-cli-allowlist')
    writeGrokHome(allowHome, { requirements: true, mcpAllowlist: ['eyas'] })
    const allowlisted = inspect(candidateGrokEnv(allowHome, tmp), h.project)
    for (const [name, r] of Object.entries(cases)) fixture(ctx, dir, `inspect-${name}.json`, r.json ?? r)
    fixture(ctx, dir, 'inspect-mcp-allowlist.json', allowlisted.json ?? allowlisted)
    fixture(ctx, dir, 'managed-files.json', {
      note: 'Candidate EYAS-owned GROK_HOME files used for the isolated runs. [folder_trust] and [session] save_on_end are omitted: grok 1.0.40 reports them as unknown config keys (see configWarningsWithA5Template).',
      files: managed,
      requirementsWithMcpAllowlist: candidateGrokRequirementsToml({ mcpAllowlist: ['eyas'] }),
      env: Object.keys(candidateGrokEnv(isolatedHome, tmp)).sort(),
      configWarningsWithA5Template: [
        { path: 'folder_trust', kind: 'unknown-field' },
        { path: 'session.save_on_end', kind: 'unknown-field' },
        { path: 'ui.disable_bypass_permissions_mode', kind: 'unknown-field', note: 'only valid in requirements.toml' },
      ],
    })
    ctx.results['grok.inspect'] = {
      hostile: summarizeInspect(cases.hostile.json),
      isolated: summarizeInspect(cases.isolated.json),
      inRootProject: summarizeInspect(cases['in-root-project'].json),
      mcpAllowlist: summarizeInspect(allowlisted.json),
    }
  }

  // Taken after the hostile inspect (which legitimately writes into the hostile ~/.grok).
  const hostileBefore = snapshotTree(h.home)
  const fake = await startFakeServer(
    grokFakeHandler({
      main: [
        { name: 'read_file', args: { target_file: join(workspace, 'probe.txt'), offset: 2, limit: 2 } },
        { name: 'list_dir', args: { target_directory: workspace } },
        { name: 'grep', args: { pattern: 'PROBE', path: workspace } },
        { name: 'run_terminal_command', args: { command: 'ls', description: 'List files' } },
        { name: 'write', args: { file_path: join(workspace, 'spike-out.txt'), content: 'spike\n' } },
        { name: 'search_tool', args: { query: 'eyas spike ping' } },
        { name: 'use_tool', args: { tool_name: 'eyas__spike_ping', tool_input: {} } },
        { name: 'spawn_subagent', args: { prompt: `${GROK_SUB_MARKER}: read probe.txt`, description: 'Spike subagent', background: false } },
      ],
      sub: [{ name: 'read_file', args: { target_file: join(workspace, 'probe.txt') } }],
    }),
  )
  ctx.rules.unshift({ from: fake.url, to: '<FAKE_MODEL_URL>' })
  try {
    // ── main isolated ACP run ──
    if (shouldRun(ctx, 'grok.acp')) {
      clearMarkers(h)
      const acpMarker = join(h.markers, 'acp-eyas')
      const run = await runGrokAcp({
        bin: bin.path,
        env: candidateGrokEnv(isolatedHome, tmp, sinkEnv(fake.url)),
        cwd: workspace,
        root: h.root,
        fake,
        prompts: [`${GROK_MAIN_MARKER} run the probe`],
        mcpServers: [markerMcpServer('eyas', acpMarker)],
        checkSystemPromptFile: join(isolatedHome, '.grok'),
      })
      const main = mainModelRequest(run.modelRequests)
      const mainText = JSON.stringify(main ?? {})
      const layout = sessionStoreLayout(join(isolatedHome, '.grok'), workspace, run.sessionIds)
      fixture(ctx, dir, 'initialize.json', run.initialize)
      fixture(ctx, dir, 'session-new.json', run.sessionNew ?? { error: run.sessionNewError })
      fixture(ctx, dir, 'permission-requests.json', run.permissionRequests)
      fixture(ctx, dir, 'fs-call-trace.json', run.trace)
      fixture(ctx, dir, 'session-prompt-result.json', run.prompts)
      fixture(ctx, dir, 'session-store-layout.json', {
        note: 'Files under the EYAS GROK_HOME after one isolated turn (session ids and the URL-encoded cwd replaced).',
        paths: layout,
      })
      fixture(ctx, dir, 'system-prompt-file.json', {
        path: 'sessions/<ENC_CWD>/<SESSION_ID>/system_prompt.txt',
        systemPromptOverride: `${SYSTEM_NONCE} EYAS spike system prompt.`,
        ...run.systemPromptFile,
        note: 'atSessionNew: read immediately after session/new returned. atFirstModelRequest: read by the fake model server when the first turn request arrived. afterPrompts: after the turn finished.',
      })
      fixture(ctx, dir, 'acp-mcp-events.json', {
        note: 'MCP lifecycle for the ACP-supplied "eyas" server, from <GROK_HOME>/sessions/<ENC_CWD>/<SESSION_ID>/events.jsonl.',
        events: run.mcpEvents,
      })
      const toolResults = run.modelRequests
        .filter((r) => r.path.endsWith('/chat/completions') && openAiUserText(r.json).includes(GROK_MAIN_MARKER))
        .flatMap((r) => (Array.isArray(r.json?.messages) ? r.json.messages : []))
        .filter((m: any) => m?.role === 'tool')
      const toolResultFor = (id: string) => {
        const m = toolResults.find((t: any) => t.tool_call_id === id)
        return m ? (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)) : null
      }
      const searchResult = toolResultFor('call_main_5')
      const useResult = toolResultFor('call_main_6')
      const mcpViaDispatchers = {
        note: 'MCP tools of the ACP-supplied server are not in the model function list; the model reaches them through search_tool, then use_tool.',
        searchToolResultMentionsTool: searchResult?.includes('spike_ping') ?? false,
        searchToolResultExcerpt: searchResult?.slice(0, 600) ?? null,
        useToolPermissionAsked: run.permissionRequests.some((p) => p.toolCall?.toolCallId === 'call_main_6'),
        useToolResultExcerpt: useResult?.slice(0, 300) ?? null,
      }
      fixture(ctx, dir, 'mcp-dispatch.json', mcpViaDispatchers)
      fixture(ctx, dir, 'model-requests.json', {
        note: 'Every HTTP request the CLI made during the isolated run. All went to the local fake on 127.0.0.1; none reached a model provider.',
        requests: run.modelRequests.map((r) => `${r.method} ${r.path}`),
        mainTurnTools: (main?.tools ?? []).map((t: any) => t.function?.name),
        mainTurnSystemIsOverride: typeof main?.messages?.[0]?.content === 'string' && main.messages[0].content.includes(SYSTEM_NONCE),
        acpMcpToolInModelToolList: (main?.tools ?? []).some((t: any) => String(t.function?.name ?? '').includes('spike_ping')),
        acpMcpToolMentionedInAnyModelRequest: run.modelRequests.some((r) => r.body.includes('spike_ping')),
        sentinelsInModelRequests: sentinelsIn(run.modelRequests.map((r) => r.body).join('\n')),
      })
      ctx.results['grok.acp'] = {
        sessionNewOk: Boolean(run.sessionNew?.sessionId),
        sessionNewHasModes: Boolean(run.sessionNew && 'modes' in run.sessionNew),
        memoryMode: run.sessionNew?._meta?.['x.ai/memoryMode'],
        permissionRequests: run.permissionRequests.map((p) => ({ kind: p.toolCall?.kind, title: p.toolCall?.title, optionKinds: (p.options ?? []).map((o: any) => o.kind) })),
        fsCalls: run.fsCalls.map((f) => f.method),
        subagentSessionIds: run.sessionIds.length,
        systemPromptFile: run.systemPromptFile,
        acpEyasServerStarted: existsSync(acpMarker),
        acpMcpEvents: run.mcpEvents,
        acpMcpToolInModelToolList: mainText.includes('spike_ping'),
        mcpViaDispatchers,
        markersFired: firedMarkers(h).filter((m) => m !== 'acp-eyas'),
        sentinelsInModelRequests: sentinelsIn(run.modelRequests.map((r) => r.body).join('\n')),
        stopReason: run.prompts[0]?.result?.stopReason,
        usageMeta: run.prompts[0]?.result?._meta?.usage ? Object.keys(run.prompts[0].result._meta.usage) : [],
        sessionStoreFiles: layout.length,
        promptError: run.prompts[0]?.error,
      }
    }

    // ── in-root project ──
    if (shouldRun(ctx, 'grok.acp-in-root')) {
      clearMarkers(h)
      const inRootFake = await startFakeServer(
        grokFakeHandler({ main: [{ name: 'read_file', args: { target_file: join(h.project, 'probe.txt') } }] }),
      )
      ctx.rules.unshift({ from: inRootFake.url, to: '<FAKE_MODEL_URL>' })
      try {
        const run = await runGrokAcp({
          bin: bin.path,
          env: candidateGrokEnv(isolatedHome, tmp, sinkEnv(inRootFake.url)),
          cwd: h.project,
          root: h.root,
          fake: inRootFake,
          prompts: [`${GROK_MAIN_MARKER} read`],
          settleMs: 2_000,
        })
        const result = {
          projectMcpOrHookRan: firedMarkers(h),
          permissionRequests: run.permissionRequests.length,
          sentinelsInModelRequests: sentinelsIn(run.modelRequests.map((r) => r.body).join('\n')),
          note: 'cwd = in-root project with AGENTS.md, CLAUDE.md, .grok/config.toml (MCP + allow rules), .grok/hooks and .mcp.json. The folder is never trusted.',
        }
        fixture(ctx, dir, 'in-root-project-run.json', result)
        ctx.results['grok.acp-in-root'] = result
      } finally {
        await inRootFake.close()
      }
    }

    // ── always-approve lock ──
    if (shouldRun(ctx, 'grok.always-approve-lock')) {
      const lockFake = await startFakeServer(
        grokFakeHandler({ main: [{ name: 'read_file', args: { target_file: join(workspace, 'probe.txt') } }] }),
      )
      ctx.rules.unshift({ from: lockFake.url, to: '<FAKE_MODEL_URL>' })
      const variants: Record<string, unknown> = {}
      try {
        const cases = [
          ['control-no-command', true, 'hello'],
          ['without-requirements-lock', false, '/always-approve on'],
          ['with-requirements-lock', true, '/always-approve on'],
          ['command-not-leading', true, 'Please note: /always-approve on'],
        ] as const
        for (const [variant, requirements, first] of cases) {
          const home = eyasHome(`grok-cli-lock-${variant}`)
          writeGrokHome(home, { requirements })
          const run = await runGrokAcp({
            bin: bin.path,
            env: candidateGrokEnv(home, tmp, sinkEnv(lockFake.url)),
            cwd: workspace,
            root: h.root,
            fake: lockFake,
            prompts: [first, `${GROK_MAIN_MARKER} read`],
          })
          const [command, probe] = run.prompts
          variants[variant] = {
            commandPromptResult: command?.result ?? { error: command?.error },
            commandPromptModelCalls: command?.result?._meta?.totalTokens === 0 ? 0 : 'unknown',
            commandUpdates: command?.updates ?? [],
            probeUpdates: probe?.updates ?? [],
            probePermissionRequests: probe?.permissionRequests ?? 0,
            readRanWithoutPermission: (probe?.updates ?? []).some((u: any) => u.status === 'completed') && (probe?.permissionRequests ?? 0) === 0,
          }
        }
      } finally {
        await lockFake.close()
      }
      fixture(ctx, dir, 'always-approve-lock.json', {
        note: 'Prompt 1 is plain text or the ACP slash command text "/always-approve on"; prompt 2 makes the fake model call read_file (a non-shell tool: shell ask rules still prompt under always-approve, so a shell probe cannot show the bypass). The requirements lock is [ui] disable_bypass_permissions_mode = true in <GROK_HOME>/requirements.toml.',
        ...variants,
      })
      ctx.results['grok.always-approve-lock'] = variants
    }

    // ── MCP allowlist ──
    if (shouldRun(ctx, 'grok.mcp-allowlist')) {
      const variants: Record<string, unknown> = {}
      for (const [variant, allow] of [['no-allowlist', undefined], ['allowlist-eyas', ['eyas']]] as const) {
        clearMarkers(h)
        const home = eyasHome(`grok-cli-mcp-${allow ? 'allow' : 'open'}`)
        writeGrokHome(home, { requirements: true, mcpAllowlist: allow ? [...allow] : undefined })
        const run = await runGrokAcp({
          bin: bin.path,
          env: candidateGrokEnv(home, tmp, sinkEnv(fake.url)),
          cwd: h.project,
          root: h.root,
          fake,
          prompts: [],
          mcpServers: [markerMcpServer('eyas', join(h.markers, 'acp-eyas')), markerMcpServer('intruder', join(h.markers, 'acp-intruder'))],
          settleMs: 3_000,
        })
        variants[variant] = { sessionNewOk: Boolean(run.sessionNew?.sessionId), started: firedMarkers(h), sessionNewError: run.sessionNewError }
      }
      fixture(ctx, dir, 'mcp-allowlist.json', {
        note: 'ACP session/new supplied two MCP servers (eyas, intruder); cwd = in-root project with its own .grok/config.toml and .mcp.json servers. `started` lists which ones actually spawned.',
        ...variants,
      })
      ctx.results['grok.mcp-allowlist'] = variants
    }

    // ── GIT_CEILING_DIRECTORIES ──
    if (shouldRun(ctx, 'grok.git-ceiling')) {
      const gitParent = join(h.root, 'gitparent')
      const nested = join(gitParent, 'workspaces', 'conv-2')
      mkdirSync(join(gitParent, '.git', 'objects'), { recursive: true })
      mkdirSync(join(gitParent, '.git', 'refs', 'heads'), { recursive: true })
      writeFileSync(join(gitParent, '.git', 'HEAD'), 'ref: refs/heads/main\n')
      mkdirSync(nested, { recursive: true })
      const variants: Record<string, unknown> = {}
      for (const [variant, ceiling] of [['without-ceiling', undefined], ['with-ceiling', join(gitParent, 'workspaces')]] as const) {
        const env = candidateGrokEnv(isolatedHome, tmp, { ...sinkEnv(fake.url), ...(ceiling ? { GIT_CEILING_DIRECTORIES: ceiling } : {}) })
        const insp = runSync(bin.path, ['inspect', '--json'], { cwd: nested, env })
        let projectRoot: unknown = null
        try {
          projectRoot = JSON.parse(insp.stdout).projectRoot
        } catch {
          projectRoot = 'unparseable'
        }
        const run = await runGrokAcp({ bin: bin.path, env, cwd: nested, root: h.root, fake, prompts: [] })
        variants[variant] = {
          inspectProjectRoot: projectRoot,
          sessionIsGitRepo: run.sessionNew?._meta?.isGitRepo,
          sessionGitRoot: run.sessionNew?._meta?.gitRoot,
        }
      }
      fixture(ctx, dir, 'git-ceiling.json', {
        note: 'cwd = <ROOT>/gitparent/workspaces/conv-2 inside a git work tree at <ROOT>/gitparent; the ceiling is <ROOT>/gitparent/workspaces.',
        ...variants,
      })
      ctx.results['grok.git-ceiling'] = variants
    }

    // ── hostile control ──
    if (shouldRun(ctx, 'grok.hostile-control')) {
      const hostileAfterIsolated = snapshotTree(h.home)
      ctx.results['grok.hostileHomeUntouchedByIsolatedRuns'] = diffSnapshots(hostileBefore, hostileAfterIsolated)
      clearMarkers(h)
      const run = await runGrokAcp({
        bin: bin.path,
        env: { PATH: SYSTEM_PATH, HOME: h.home, TMPDIR: tmp, GROK_DISABLE_AUTOUPDATER: '1', ...sinkEnv(fake.url) },
        cwd: h.project,
        root: h.root,
        fake,
        prompts: [`${GROK_MAIN_MARKER} run the probe`],
      })
      const result = {
        note: 'HOME = hostile home (always-approve, memory, Claude/Cursor compat, host hooks and MCP). Proves the probe detects a bypass.',
        permissionRequests: run.permissionRequests.length,
        fsCalls: run.fsCalls.map((f) => f.method),
        toolCallsCompleted: run.trace.filter((t: any) => t.event === 'tool_call_update' && t.status === 'completed').length,
        markersFired: firedMarkers(h),
        sentinelsInModelRequests: sentinelsIn(run.modelRequests.map((r) => r.body).join('\n')),
        memoryMode: run.sessionNew?._meta?.['x.ai/memoryMode'],
        sessionNewHasModes: Boolean(run.sessionNew && 'modes' in run.sessionNew),
        hostileHomeWrites: diffSnapshots(hostileAfterIsolated, snapshotTree(h.home)),
      }
      fixture(ctx, dir, 'hostile-control.json', result)
      fixture(ctx, dir, 'hostile-home-untouched.json', {
        note: 'Diff of the hostile HOME across every isolated grok run (must be empty).',
        ...(ctx.results['grok.hostileHomeUntouchedByIsolatedRuns'] as object),
      })
      ctx.results['grok.hostile-control'] = result
    }
  } finally {
    await fake.close()
  }

  // ── device auth ──
  if (shouldRun(ctx, 'grok.device-auth')) {
    const home = eyasHome('grok-cli-device-auth')
    const emptyBin = join(h.root, 'empty-bin')
    mkdirSync(join(home, '.grok'), { recursive: true })
    mkdirSync(emptyBin, { recursive: true })
    const env = { PATH: emptyBin, HOME: home, GROK_HOME: join(home, '.grok'), TMPDIR: tmp, BROWSER: '/usr/bin/false', GROK_DISABLE_AUTOUPDATER: '1' }
    const proc = spawn(bin.path, ['login', '--device-auth'], { cwd: home, env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (c: Buffer) => { stdout += c.toString('utf8') })
    proc.stderr?.on('data', (c: Buffer) => { stderr += c.toString('utf8') })
    const exit = new Promise<[number | null, string | null]>((r) => proc.on('exit', (code, sig) => r([code, sig])))
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline && !/Waiting for authorization/i.test(stdout + stderr)) await sleep(250)
    await sleep(500)
    proc.kill('SIGTERM')
    const [code, signal] = await exit
    const codePattern = /\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/g
    const redactCodes = (s: string) => s.replace(/user_code=[^\s&]+/g, 'user_code=XXXX-XXXX').replace(codePattern, 'XXXX-XXXX')
    const credentialFiles = readdirSync(join(home, '.grok')).filter((n) => /auth|cred|token/i.test(n))
    fixture(ctx, dir, 'device-auth-stderr.txt', redactCodes(stderr))
    fixture(ctx, dir, 'device-auth.json', {
      argv: ['login', '--device-auth'],
      stdoutBytes: stdout.length,
      stderrBytes: stderr.length,
      promptStream: stdout.trim() ? 'stdout' : 'stderr',
      containsAnsi: /\x1b\[/.test(stderr + stdout),
      urlPattern: 'https://accounts.x.ai/oauth2/device?user_code=<CODE>',
      verificationUrlSeen: /https:\/\/\S+user_code=/.test(stderr + stdout),
      userCodeLineSeen: codePattern.test(stderr + stdout),
      waitingLine: /Waiting for authorization/i.test(stderr + stdout),
      exit: { code, signal, note: 'killed by the spike after the code was printed; the device code was never confirmed' },
      credentialFilesAfterKill: credentialFiles,
    })
    ctx.results['grok.device-auth'] = { promptStream: stdout.trim() ? 'stdout' : 'stderr', credentialFilesAfterKill: credentialFiles }
  }

  if (shouldRun(ctx, 'grok.binary-facts')) {
    const mentions = binaryMentions(bin.path, [...GROK_ENV_NAMES, 'strict', 'read-only', 'workspace', 'devbox'])
    const docsDir = join(isolatedHome, '.grok', 'docs', 'user-guide')
    fixture(ctx, dir, 'binary-facts.json', {
      note: 'Present = the literal string occurs in the binary. Presence is not proof of behaviour; documented names are in docsExtractedTo.',
      envNamesPresent: Object.fromEntries(GROK_ENV_NAMES.map((n) => [n, mentions[n]])),
      sandbox: {
        env: ['GROK_SANDBOX', 'GROK_SANDBOX_AUTO_ALLOW_BASH'],
        config: ['sandbox.profile', 'sandbox.auto_allow_bash'],
        builtInProfiles: ['off', 'workspace', 'devbox', 'read-only', 'strict'],
        customProfiles: '<GROK_HOME>/sandbox.toml [profiles.<name>] extends/deny/read_write (docs 18-sandbox.md)',
        refusesSymlinkedGrokHome: true,
      },
      docsExtractedTo: existsSync(docsDir) ? '<GROK_HOME>/docs/user-guide (written on first launch)' : null,
      storageMode: {
        env: 'GROK_STORAGE_MODE',
        documented: false,
        observed: 'With API-key auth against the local fake and the variable unset, grok made no sync or writeback request (see model-requests.json). Its effect under grok.com sign-in is unverified: the live lane signs grok in with an API key only (a grok.com device sign-in cannot run unattended).',
      },
      folderTrust: {
        env: 'GROK_FOLDER_TRUST',
        configKey: 'none: [folder_trust] in config.toml is an unknown key in 1.0.40; trust is on by default and recorded in <GROK_HOME>/trusted_folders.toml',
      },
    })
  }

  if (shouldRun(ctx, 'grok.paid-canary')) {
    const key = process.env.EYAS_SPIKE_XAI_API_KEY
    if (!key) {
      ctx.results['grok.paid-canary'] = { skipped: true, reason: 'EYAS_SPIKE_XAI_API_KEY not set' }
    } else {
      const before = snapshotTree(h.home)
      const env = candidateGrokEnv(isolatedHome, tmp, { XAI_API_KEY: key })
      const acp = AcpProcess.start(bin.path, ['agent', '--no-leader', 'stdio'], workspace, env, spikeAcpClient(h.root))
      let answer = ''
      try {
        await acp.request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } }, clientInfo: { name: 'EYAS', version: '1.0.0' } })
        const s = await acp.request('session/new', { cwd: workspace, mcpServers: [] })
        await acp.request('session/prompt', { sessionId: s.sessionId, prompt: [{ type: 'text', text: 'If any instructions, rules or memories mention EYAS-SENTINEL, quote them; otherwise reply with the single word NONE.' }] }, 180_000)
        answer = acp.inbound('session/update').map((m) => m.params?.update).filter((u) => u?.sessionUpdate === 'agent_message_chunk').map((u) => u.content?.text ?? '').join('')
      } finally {
        await acp.stop()
      }
      ctx.results['grok.paid-canary'] = { answer: answer.trim().slice(0, 200), sentinels: sentinelsIn(answer), hostileHomeWrites: diffSnapshots(before, snapshotTree(h.home)) }
      fixture(ctx, dir, 'paid-canary.json', ctx.results['grok.paid-canary'])
    }
  }
}

// ── Claude Code ───────────────────────────────────────────────────────────────

const CLAUDE_CANARY = 'EYAS-SPIKE-CANARY'

function anthropicSse(content: Array<{ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }>, stopReason: string): FakeReply {
  const events: Array<[string, unknown]> = [
    ['message_start', { type: 'message_start', message: { id: 'msg_eyas_spike', type: 'message', role: 'assistant', model: 'eyas-spike', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }],
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

function anthropicFakeHandler(): FakeHandler {
  return (req) => {
    if (req.path.endsWith('/count_tokens')) return { body: JSON.stringify({ input_tokens: 10 }) }
    if (req.path.startsWith('/v1/messages')) {
      const msgs: any[] = Array.isArray(req.json?.messages) ? req.json.messages : []
      const hasTools = Array.isArray(req.json?.tools) && req.json.tools.some((t: any) => t?.name === 'Bash')
      const toolResults = msgs.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b: any) => b?.type === 'tool_result').length
      const userText = JSON.stringify(msgs)
      const content =
        hasTools && toolResults === 0 && userText.includes(GROK_MAIN_MARKER)
          ? [{ type: 'tool_use' as const, id: 'toolu_eyas_spike', name: 'Bash', input: { command: `echo ${CLAUDE_CANARY}`, description: 'Print the spike canary' } }]
          : [{ type: 'text' as const, text: 'NONE' }]
      const stop = content[0]?.type === 'tool_use' ? 'tool_use' : 'end_turn'
      if (req.json?.stream) return anthropicSse(content, stop)
      return { body: JSON.stringify({ id: 'msg_eyas_spike', type: 'message', role: 'assistant', model: 'eyas-spike', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } }) }
    }
    if (req.method === 'HEAD' || req.path.startsWith('/api/hello')) return { body: '{}' }
    return { status: 404, body: JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'eyas spike fake' } }) }
  }
}

function isEmptyDir(path: string): boolean {
  try {
    return statSync(path).isDirectory() && readdirSync(path).length === 0
  } catch {
    return false
  }
}

function claudeJsonKeyChanges(home: string, before: Record<string, unknown>): { added: string[]; changed: string[]; removed: string[] } {
  let after: Record<string, unknown> = {}
  try {
    after = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'))
  } catch {
    after = {}
  }
  const added = Object.keys(after).filter((k) => !(k in before)).sort()
  const changed = Object.keys(after).filter((k) => k in before && JSON.stringify(after[k]) !== JSON.stringify(before[k])).sort()
  const removed = Object.keys(before).filter((k) => !(k in after)).sort()
  return { added, changed, removed }
}

const CONTENT_BEARING = [/^\.claude\/projects\/.+\.jsonl$/, /^\.claude\/todos\//, /^\.claude\/file-history\//, /^\.claude\/plans\//, /^\.claude\/history\.jsonl$/, /^\.claude\/session-env\//]

/** Type and size of every added or modified host path (directories have size 0). */
function hostWriteDetails(home: string, diff: { added: string[]; modified: string[] }): Array<{ path: string; change: 'added' | 'modified'; type: string; bytes: number }> {
  const out: Array<{ path: string; change: 'added' | 'modified'; type: string; bytes: number }> = []
  for (const [change, list] of [['added', diff.added], ['modified', diff.modified]] as const) {
    for (const p of list) {
      let type = 'missing'
      let bytes = 0
      try {
        const st = statSync(join(home, p))
        type = st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'other'
        bytes = st.isFile() ? st.size : 0
      } catch {
        /* removed again before we looked */
      }
      out.push({ path: p, change, type, bytes })
    }
  }
  return out
}

function firstShell(): string {
  for (const s of ['/bin/zsh', '/bin/bash', '/usr/bin/bash', '/bin/sh']) if (isExecutable(s)) return s
  return '/bin/sh'
}

async function runClaude(ctx: SpikeContext): Promise<void> {
  const bin = resolveSpikeBinary('claude-code')
  if (!bin) {
    ctx.results['claude-code'] = { available: false, reason: 'claude binary not found (EYAS_SPIKE_CLAUDE_BIN or PATH)' }
    return
  }
  const { h } = ctx
  ctx.rules.unshift({ from: bin.path, to: '<CLAUDE_BIN>' })
  const secure = join(h.root, 'claude-secure-storage')
  const tmp = join(h.root, 'tmp')
  mkdirSync(secure, { recursive: true })
  mkdirSync(tmp, { recursive: true })
  const baseEnv: Record<string, string> = {
    PATH: [dirname(bin.path), SYSTEM_PATH].join(delimiter),
    HOME: h.home,
    TMPDIR: tmp,
    USER: 'eyas-spike',
    SHELL: firstShell(),
    // Redirects the macOS keychain service name so the operator's login is never read or refreshed.
    CLAUDE_SECURESTORAGE_CONFIG_DIR: secure,
    DISABLE_AUTOUPDATER: '1',
  }
  const versionOut = runSync(bin.path, ['--version'], { cwd: h.root, env: baseEnv })
  const version = /(\d+\.\d+\.\d+)/.exec(versionOut.stdout)?.[1] ?? 'unknown'
  const dir = join('claude-code', version)
  const sdkPkg = JSON.parse(readFileSync(join(repoRoot(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json'), 'utf8'))
  if (shouldRun(ctx, 'claude-code.version')) {
    fixture(ctx, dir, 'version.json', { cliVersion: version, raw: versionOut.stdout.trim(), binarySource: bin.source, sdkVersion: sdkPkg.version, sdkBundledCliVersion: sdkPkg.claudeCodeVersion })
  }

  const sdk: any = await import('@anthropic-ai/claude-agent-sdk')
  const isolatedEnv = (fakeUrl: string): Record<string, string> => ({
    ...baseEnv,
    ANTHROPIC_API_KEY: 'sk-ant-eyas-spike-dummy',
    ANTHROPIC_BASE_URL: fakeUrl,
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
    CLAUDE_AGENT_SDK_CLIENT_APP: 'eyas',
  })
  const isolatedOptions = { persistSession: false, settingSources: [], strictMcpConfig: true, enableFileCheckpointing: false, mcpServers: {} }
  const readClaudeJson = (): Record<string, unknown> => {
    try {
      return JSON.parse(readFileSync(join(h.home, '.claude.json'), 'utf8'))
    } catch {
      return {}
    }
  }

  // ── init-only ──
  if (shouldRun(ctx, 'claude-code.init-only')) {
    clearMarkers(h)
    const fake = await startFakeServer(anthropicFakeHandler())
    ctx.rules.unshift({ from: fake.url, to: '<FAKE_MODEL_URL>' })
    const before = snapshotTree(h.home)
    const claudeJsonBefore = readClaudeJson()
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    async function* idle(): AsyncGenerator<never> {
      await gate
    }
    const q = sdk.query({ prompt: idle(), options: { cwd: h.project, pathToClaudeCodeExecutable: bin.path, env: isolatedEnv(fake.url), ...isolatedOptions } })
    const init: Record<string, unknown> = {}
    try {
      init.initialization = await q.initializationResult()
      init.mcpServerStatus = await q.mcpServerStatus()
    } catch (err) {
      init.error = String(err)
    }
    await sleep(1_500)
    release()
    try {
      q.close?.()
    } catch {
      /* already closed */
    }
    await sleep(1_500)
    await fake.close()
    const i = init.initialization as any
    const diff = diffSnapshots(before, snapshotTree(h.home))
    const result = {
      binaryVersion: version,
      sdkVersion: sdkPkg.version,
      verifiedAt: new Date().toISOString().slice(0, 10),
      scope: 'init-only (no user message): query() in streaming-input mode, initializationResult() + mcpServerStatus(), then close',
      options: isolatedOptions,
      envKeys: Object.keys(isolatedEnv('x')).sort(),
      authMode: 'dummy ANTHROPIC_API_KEY against the local fake; secure storage redirected (the operator keychain login is not used)',
      modelRequestSent: fake.requests.some((r) => r.path.startsWith('/v1/messages') && !r.path.endsWith('/count_tokens')),
      sinkRequests: fake.requests.map((r) => `${r.method} ${r.path}`),
      hostWrites: diff,
      hostWriteDetails: hostWriteDetails(h.home, diff),
      claudeJsonTopLevelKeys: claudeJsonKeyChanges(h.home, claudeJsonBefore),
      contentBearingWrites: [...diff.added, ...diff.modified].filter((p) => CONTENT_BEARING.some((re) => re.test(p))),
      markersFired: firedMarkers(h),
      init: i
        ? {
            currentPermissionMode: i.current_permission_mode,
            commands: (i.commands ?? []).map((c: any) => c.name).filter((n: string) => /sentinel/i.test(n)),
            agents: (i.agents ?? []).map((a: any) => a.name),
            account: i.account,
            analyticsDisabled: i.analytics_disabled,
            mcpServerStatus: init.mcpServerStatus,
          }
        : { error: init.error },
    }
    fixture(ctx, dir, 'host-writes.json', result)
    ctx.results['claude-code.init-only'] = { modelRequestSent: result.modelRequestSent, hostWrites: diff, claudeJsonTopLevelKeys: result.claudeJsonTopLevelKeys, markersFired: result.markersFired, init: result.init }
  }

  const runTurn = async (variant: 'isolated' | 'control') => {
    clearMarkers(h)
    const fake = await startFakeServer(anthropicFakeHandler())
    ctx.rules.unshift({ from: fake.url, to: '<FAKE_MODEL_URL>' })
    const before = snapshotTree(h.home)
    const claudeJsonBefore = readClaudeJson()
    const options =
      variant === 'isolated'
        ? { cwd: h.project, pathToClaudeCodeExecutable: bin.path, env: isolatedEnv(fake.url), ...isolatedOptions }
        : { cwd: h.project, pathToClaudeCodeExecutable: bin.path, env: { ...baseEnv, ANTHROPIC_API_KEY: 'sk-ant-eyas-spike-dummy', ANTHROPIC_BASE_URL: fake.url }, settingSources: ['user', 'project', 'local'] }
    const permissionAsks: string[] = []
    const messages: string[] = []
    let error: string | undefined
    try {
      const q = sdk.query({
        prompt: `${GROK_MAIN_MARKER} run the canary`,
        options: {
          ...options,
          canUseTool: async (name: string, input: Record<string, unknown>) => {
            permissionAsks.push(name)
            return { behavior: 'allow', updatedInput: input }
          },
        },
      })
      for await (const m of q) messages.push(`${m.type}${m.subtype ? ':' + m.subtype : ''}`)
    } catch (err) {
      error = String(err)
    }
    await sleep(1_500)
    await fake.close()
    const diff = diffSnapshots(before, snapshotTree(h.home))
    const bodies = fake.requests.map((r) => r.body).join('\n')
    return {
      binaryVersion: version,
      sdkVersion: sdkPkg.version,
      verifiedAt: new Date().toISOString().slice(0, 10),
      variant,
      localFakeModel: true,
      options: variant === 'isolated' ? isolatedOptions : { settingSources: ['user', 'project', 'local'] },
      turn: `user prompt -> Bash tool_use (echo ${CLAUDE_CANARY}) -> text "NONE" (canUseTool allows; Claude Code auto-approves a read-only echo without asking)`,
      nonModelEgress: 'cachedGrowthBookFeatures in ~/.claude.json was refreshed from the vendor feature-flag service (not a model call, not routed through ANTHROPIC_BASE_URL)',
      permissionAsks,
      messageTypes: [...new Set(messages)],
      error,
      sinkRequests: fake.requests.map((r) => `${r.method} ${r.path}`),
      hostWrites: diff,
      hostWriteDetails: hostWriteDetails(h.home, diff),
      claudeJsonTopLevelKeys: claudeJsonKeyChanges(h.home, claudeJsonBefore),
      contentBearingWrites: [...diff.added, ...diff.modified].filter((p) => CONTENT_BEARING.some((re) => re.test(p)) && !isEmptyDir(join(h.home, p))),
      canaryInHostFiles: [...diff.added, ...diff.modified].filter((p) => {
        try {
          const full = join(h.home, p)
          return statSync(full).isFile() && readFileSync(full, 'utf8').includes(CLAUDE_CANARY)
        } catch {
          return false
        }
      }),
      markersFired: firedMarkers(h),
      sentinelsInModelRequests: sentinelsIn(bodies),
    }
  }

  if (shouldRun(ctx, 'claude-code.full-turn')) {
    const r = await runTurn('isolated')
    fixture(ctx, dir, 'host-writes-full-turn.json', r)
    ctx.results['claude-code.full-turn'] = r
  }
  if (shouldRun(ctx, 'claude-code.control')) {
    const r = await runTurn('control')
    fixture(ctx, dir, 'control-unisolated.json', r)
    ctx.results['claude-code.control'] = r
  }
  if (shouldRun(ctx, 'claude-code.paid-canary')) {
    ctx.results['claude-code.paid-canary'] = {
      skipped: true,
      reason: 'The paid Claude canary needs the operator login, which this spike never reads; it is a paid case of the live lane (tests/live/cli-isolation.live.test.ts, EYAS_LIVE_CLI_PAID).',
    }
  }
}

// ── OpenCode ──────────────────────────────────────────────────────────────────

const OPENCODE_ENV_NAMES = [
  'OPENCODE_CONFIG', 'OPENCODE_CONFIG_CONTENT', 'OPENCODE_CONFIG_DIR', 'OPENCODE_PERMISSION', 'OPENCODE_DISABLE_CLAUDE_CODE',
  'OPENCODE_DISABLE_CLAUDE_CODE_PROMPT', 'OPENCODE_DISABLE_CLAUDE_CODE_SKILLS', 'OPENCODE_DISABLE_EXTERNAL_SKILLS',
  'OPENCODE_DISABLE_PROJECT_CONFIG', 'OPENCODE_DISABLE_AUTOUPDATE', 'OPENCODE_DISABLE_SHARE', 'OPENCODE_DISABLE_MODELS_FETCH',
  'OPENCODE_DISABLE_DEFAULT_PLUGINS', 'OPENCODE_DISABLE_LSP_DOWNLOAD', 'OPENCODE_AUTH_CONTENT', 'OPENCODE_SERVER_PASSWORD',
  'OPENCODE_SERVER_USERNAME', 'OPENCODE_PURE', 'OPENCODE_DB', 'OPENCODE_MODELS_PATH', 'OPENCODE_MODELS_URL',
] as const

function opencodeEnv(home: string, eyasHome: string, tmp: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: SYSTEM_PATH,
    HOME: home,
    TMPDIR: tmp,
    XDG_CONFIG_HOME: join(eyasHome, 'config'),
    XDG_DATA_HOME: join(eyasHome, 'data'),
    XDG_STATE_HOME: join(eyasHome, 'state'),
    XDG_CACHE_HOME: join(eyasHome, 'cache'),
    OPENCODE_DISABLE_CLAUDE_CODE: '1',
    OPENCODE_DISABLE_CLAUDE_CODE_PROMPT: '1',
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1',
    OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_DISABLE_SHARE: '1',
    OPENCODE_DISABLE_MODELS_FETCH: '1',
    ...extra,
  }
}

async function runOpencode(ctx: SpikeContext): Promise<void> {
  const bin = resolveSpikeBinary('opencode')
  if (!bin) {
    ctx.results.opencode = { available: false, reason: 'opencode binary not found (EYAS_SPIKE_OPENCODE_BIN, PATH, installer default)' }
    return
  }
  const { h } = ctx
  ctx.rules.unshift({ from: bin.path, to: '<OPENCODE_BIN>' })
  const tmp = join(h.root, 'tmp')
  const eyasHome = join(h.eyasHomes, 'opencode')
  mkdirSync(eyasHome, { recursive: true, mode: 0o700 })
  mkdirSync(tmp, { recursive: true })
  const versionOut = runSync(bin.path, ['--version'], { cwd: h.root, env: opencodeEnv(h.home, eyasHome, tmp) })
  const version = /(\d+\.\d+\.\d+)/.exec(versionOut.stdout)?.[1] ?? 'unknown'
  const dir = join('opencode', version)
  if (shouldRun(ctx, 'opencode.version')) fixture(ctx, dir, 'version.json', { version, binarySource: bin.source })

  if (shouldRun(ctx, 'opencode.binary-facts')) {
    const mentions = binaryMentions(bin.path, OPENCODE_ENV_NAMES)
    fixture(ctx, dir, 'env-flags.json', { note: 'Present = the literal name occurs in the binary.', envNamesPresent: mentions })
  }

  if (!shouldRun(ctx, 'opencode.api')) return
  clearMarkers(h)
  // The hostile project fixture (AGENTS.md, CLAUDE.md, .claude/, .mcp.json) is the workspace.
  const workspace = h.project
  writeFileSync(join(workspace, 'probe-opencode.txt'), 'PROBE opencode\n')
  const hostileBefore = snapshotTree(h.home)
  const fake = await startFakeServer((req) => {
    if (req.path.endsWith('/chat/completions')) {
      const tools: string[] = (req.json?.tools ?? []).map((t: any) => t?.function?.name)
      if (!tools.includes('bash')) return openAiText('EYAS spike')
      const done = openAiToolResultCount(req.json)
      const steps: GrokStep[] = [
        { name: 'read', args: { filePath: join(workspace, 'probe-opencode.txt') } },
        { name: 'bash', args: { command: 'ls', description: 'List files' } },
        { name: 'read', args: { filePath: join(h.vault, '99_Meta', 'ai-memory', 'MEMORY.md') } },
      ]
      const step = steps[done]
      return step ? openAiToolCall(`call_oc_${done}`, step.name, step.args) : openAiText('NONE')
    }
    if (req.path.endsWith('/models')) return { body: JSON.stringify({ object: 'list', data: [{ id: 'fake', object: 'model' }] }) }
    return { status: 404, body: '{}' }
  })
  ctx.rules.unshift({ from: fake.url, to: '<FAKE_MODEL_URL>' })
  const port = await freePort()
  const config = {
    $schema: 'https://opencode.ai/config.json',
    model: 'eyasfake/fake',
    provider: { eyasfake: { npm: '@ai-sdk/openai-compatible', name: 'EYAS spike fake', options: { baseURL: `${fake.url}/v1`, apiKey: 'eyas-spike-dummy' }, models: { fake: { name: 'fake' } } } },
  }
  const permission = { read: 'ask', edit: 'ask', bash: 'ask', list: 'ask', glob: 'ask', grep: 'ask', webfetch: 'ask', external_directory: 'ask' }
  const env = opencodeEnv(h.home, eyasHome, tmp, { OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_PERMISSION: JSON.stringify(permission) })
  const proc = spawn(bin.path, ['serve', '--port', String(port), '--hostname', '127.0.0.1'], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let boot = ''
  proc.stdout?.on('data', (c: Buffer) => { boot += c.toString('utf8') })
  proc.stderr?.on('data', (c: Buffer) => { boot += c.toString('utf8') })
  const base = `http://127.0.0.1:${port}`
  const result: Record<string, unknown> = {}
  const asked: any[] = []
  const events: string[] = []
  const abort = new AbortController()
  try {
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline && !boot.includes(`127.0.0.1:${port}`)) await sleep(250)
    result.serverUnsecuredWarning = /OPENCODE_SERVER_PASSWORD is not set/.test(boot)
    const doc = await (await fetch(`${base}/doc`)).json() as any
    const paths: Record<string, unknown> = {}
    for (const [p, ops] of Object.entries<any>(doc.paths ?? {})) {
      if (/permission/i.test(p) || p === '/event' || p === '/session' || p === '/session/{sessionID}' || p === '/session/{sessionID}/message') {
        paths[p] = Object.fromEntries(Object.entries<any>(ops).map(([m, o]) => [m, { operationId: o.operationId, requestBody: o.requestBody?.content?.['application/json']?.schema ?? null }]))
      }
    }
    const schemas = doc.components?.schemas ?? {}
    const schemaSubset = Object.fromEntries(
      Object.entries(schemas).filter(([k]) => /^(Permission|EventPermission)/.test(k)),
    )
    fixture(ctx, dir, 'openapi-permission.json', { note: 'Subset of GET /doc (OpenAPI) for the permission, session and event surface.', paths, schemas: schemaSubset })
    const permConfig = schemas.PermissionConfig?.anyOf?.find((a: any) => a.type === 'object')
    fixture(ctx, dir, 'permission-config-keys.json', {
      envVar: 'OPENCODE_PERMISSION',
      value: 'JSON; a PermissionConfig: "ask" | "allow" | "deny" for everything, or an object per permission key',
      keys: Object.keys(permConfig?.properties ?? {}),
      additionalKeysAllowed: Boolean(permConfig?.additionalProperties),
      patternKeys: Object.entries<any>(permConfig?.properties ?? {}).filter(([, v]) => JSON.stringify(v).includes('PermissionRuleConfig')).map(([k]) => k),
      patternForm: '{ "<glob pattern>": "ask" | "allow" | "deny" } (PermissionObjectConfig; wildcard patterns such as "*" or "git *")',
    })
    fixture(ctx, dir, 'reply-endpoint.json', {
      current: { method: 'POST', path: '/permission/{requestID}/reply', body: { reply: 'once | always | reject', message: 'optional string' } },
      legacy: { method: 'POST', path: '/session/{sessionID}/permissions/{permissionID}', body: { response: 'once | always | reject' } },
      v2: { method: 'POST', path: '/api/session/{sessionID}/permission/{requestID}/reply', body: { reply: 'once | always | reject', message: 'optional string' } },
      list: { method: 'GET', path: '/permission' },
      deleteSession: { method: 'DELETE', path: '/session/{sessionID}' },
      eventStream: { method: 'GET', path: '/event', askedEvent: 'permission.asked', repliedEvent: 'permission.replied' },
    })

    // Event stream + one prompt.
    const eventsRes = await fetch(`${base}/event`, { signal: abort.signal })
    const reader = eventsRes.body?.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const pump = (async () => {
      if (!reader) return
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let idx: number
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('')
          if (!data) continue
          let ev: any
          try {
            ev = JSON.parse(data)
          } catch {
            continue
          }
          events.push(ev.type)
          if (ev.type === 'permission.asked') {
            asked.push(ev)
            void fetch(`${base}/permission/${ev.properties?.id}/reply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reply: 'once' }) })
          }
        }
      }
    })().catch(() => undefined)
    const session = await (await fetch(`${base}/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json() as any
    const msgRes = await fetch(`${base}/session/${session.id}/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: { providerID: 'eyasfake', modelID: 'fake' }, parts: [{ type: 'text', text: `${GROK_MAIN_MARKER} run the probe` }] }),
      signal: AbortSignal.timeout(120_000),
    })
    result.messageStatus = msgRes.status
    await sleep(1_000)
    const del = await fetch(`${base}/session/${session.id}`, { method: 'DELETE' })
    result.deleteSessionStatus = del.status
    abort.abort()
    await pump
  } catch (err) {
    result.error = String(err)
  } finally {
    abort.abort()
    proc.kill('SIGTERM')
    await fake.close()
  }
  const auth = runSync(bin.path, ['auth', 'list'], { cwd: workspace, env: opencodeEnv(h.home, eyasHome, tmp) })
  // eslint-disable-next-line no-control-regex
  const authText = (auth.stdout + auth.stderr).replace(/\x1b\[[0-9;]*m/g, '')
  fixture(ctx, dir, 'permission-asked.json', {
    note: 'permission.asked events captured from GET /event while the local fake model called read (in-root), bash (ls) and read (a vault file outside the workspace). Each was answered "once". Read patterns are the absolute path without its leading slash.',
    events: asked,
    eventTypesSeen: [...new Set(events)].sort(),
    ...result,
  })
  fixture(ctx, dir, 'auth-location.json', {
    command: 'opencode auth list',
    credentialsFile: /Credentials\s+(\S+)/.exec(authText)?.[1] ?? null,
    resolvesTo: '$XDG_DATA_HOME/opencode/auth.json',
  })
  const writes = diffSnapshots(hostileBefore, snapshotTree(h.home))
  const npmIndex = join(h.home, '.npm', '_cacache', 'index-v5')
  const npmKeys: string[] = []
  if (existsSync(npmIndex)) {
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        const full = join(d, name)
        if (statSync(full).isDirectory()) walk(full)
        else for (const m of readFileSync(full, 'utf8').matchAll(/"key":"make-fetch-happen:request-cache:([^"]+)"/g)) npmKeys.push(m[1] ?? '')
      }
    }
    walk(npmIndex)
  }
  ctx.results['opencode.api'] = {
    note: 'The spike answered "once" to every permission.asked, so the vault sentinel reaching the fake model is expected; what matters is that each read, bash and out-of-workspace access asked first.',
    permissionAsked: asked.map((e) => ({ permission: e.properties?.permission, patterns: e.properties?.patterns, always: e.properties?.always })),
    markersFired: firedMarkers(h),
    sentinelsInModelRequests: sentinelsIn(fake.requests.map((r) => r.body).join('\n')),
    hostileHomeWrites: {
      topLevel: [...new Set([...writes.added, ...writes.modified].map((p) => p.split('/')[0]))].sort(),
      count: writes.added.length + writes.modified.length,
      npmRegistryRequests: [...new Set(npmKeys)].sort(),
      note: 'Written into HOME although every XDG_* dir points into the EYAS home.',
    },
    ...result,
  }
  fixture(ctx, dir, 'isolation-run.json', ctx.results['opencode.api'])
}

// ── Kimi (source-derived) ─────────────────────────────────────────────────────

/** Facts read from the kimi-cli 1.52.0 wheel source (PyPI). Not executed on this host. */
export const KIMI_SOURCE_FACTS = {
  version: '1.52.0',
  verified: false,
  derivedFrom: 'kimi-cli 1.52.0 wheel (PyPI) source; the kimi binary is not installed on the spike host',
  shareDir: { env: 'KIMI_SHARE_DIR', default: '~/.kimi', source: 'kimi_cli/share.py get_share_dir()' },
  configFile: { path: '<share>/config.toml', source: 'kimi_cli/config.py get_config_file()' },
  configKeys: {
    default_model: { type: 'string', default: '', note: 'must name an entry of [models] (validator), else load fails' },
    default_thinking: { type: 'boolean', default: false },
    default_yolo: { type: 'boolean', default: false, note: 'auto-approve; app.py: yolo = flag or config.default_yolo' },
    merge_all_available_skills: { type: 'boolean', default: true, note: 'merges ~/.kimi, ~/.claude and ~/.codex skill dirs' },
    telemetry: { type: 'boolean', default: true },
    hooks: { type: 'list', note: 'hook definitions live in config.toml' },
    extra_skill_dirs: { type: 'list' },
  },
  acpEntry: {
    argv: ['acp'],
    earlyReturn: 'kimi_cli/cli/__init__.py main callback: `if ctx.invoked_subcommand is not None: return`, so options before `acp` (--model, --thinking) are ignored',
    configLocation: 'set_model asserts the default config location and rewrites <share>/config.toml via save_config (default_model, default_thinking)',
  },
  sessionNew: {
    modes: 'always [{id:"default"}], currentModeId "default" (not a yolo signal)',
    authCheck: 'session/new calls _check_auth() first',
  },
  permissions: {
    requestPermissionOptions: [
      { optionId: 'approve', kind: 'allow_once' },
      { optionId: 'approve_for_session', kind: 'allow_always' },
      { optionId: 'reject', kind: 'reject_once' },
    ],
    toolCallInRequest: 'ToolCallUpdate {toolCallId, title, content}; no kind',
    toolsThatAsk: ['file write', 'file replace', 'shell', 'background task'],
    toolsThatNeverAsk: 'file read, glob, grep, web search/fetch (no ask rules exist)',
    fsDelegation: 'with client fs capabilities, reads go to fs/read_text_file and writes to fs/write_text_file (ACPKaos)',
    terminalDelegation: 'shell runs through the client terminal only when the client advertises terminal',
  },
  sessionDir: { path: '<share>/sessions/<md5(work_dir)>/', source: 'kimi_cli/metadata.py WorkDirMeta.sessions_dir' },
  projectInstructions: 'AGENTS.md (or agents.md) and .kimi/AGENTS.md from the nearest .git root down to the work dir are ALWAYS loaded (no trust gate); without .git only the work dir itself',
  skills: {
    user: ['~/.config/agents/skills', '~/.agents/skills', '~/.kimi/skills', '~/.claude/skills', '~/.codex/skills'],
    project: ['<work_dir>/.agents/skills', '<work_dir>/.kimi/skills', '<work_dir>/.claude/skills', '<work_dir>/.codex/skills'],
  },
  mcpConfig: { path: '<share>/mcp.json' },
  login: {
    argv: ['login', '--json'],
    flow: 'device authorization: POST <oauth host>/api/oauth/device_authorization; polls the token endpoint every interval seconds; restarts when the code expires',
    jsonEvents: ['{"type":"info",...}', '{"type":"verification_url","message":"Verification URL: <url>","data":{"verification_url":"<url>","user_code":"<code>"}}', '{"type":"waiting",...}', '{"type":"error",...}'],
    opensBrowser: 'webbrowser.open(url) unless it fails; set BROWSER to a no-op on a server',
    credentials: '<share>/credentials/<key>.json (file storage; keyring is deprecated)',
    deviceId: '<share>/device_id',
  },
  autoUpdate: { env: 'KIMI_CLI_NO_AUTO_UPDATE', note: 'checked by the shell UI' },
} as const

function runKimi(ctx: SpikeContext): void {
  if (!shouldRun(ctx, 'kimi.source-facts')) return
  const bin = resolveSpikeBinary('kimi')
  fixture(ctx, join('kimi', KIMI_SOURCE_FACTS.version), 'source-facts.json', {
    ...KIMI_SOURCE_FACTS,
    hostBinary: bin ? 'present (run the live lane on this host to verify: bun run test:live-cli)' : 'not installed',
  })
  ctx.results['kimi.source-facts'] = { written: true, hostBinary: Boolean(bin) }
}

// ── Main ──────────────────────────────────────────────────────────────────────

function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..')
}

export interface RunSpikeOptions {
  outDir: string
  only?: SpikeCli[]
  keep?: boolean
  /** Where to write the redacted run summary (plan + per-step results); not written when absent. */
  summaryFile?: string
  env?: NodeJS.ProcessEnv
}

export async function runSpike(opts: RunSpikeOptions): Promise<Record<string, unknown>> {
  const env = opts.env ?? process.env
  const plan = planSpike(env, opts.only)
  const h = buildHostileHome()
  log.info({ root: h.root }, 'hostile home built')
  const user = (() => {
    try {
      return userInfo().username
    } catch {
      return ''
    }
  })()
  const host = hostname()
  // macOS temp dirs resolve under /private; CLIs print either spelling, and
  // OpenCode prints absolute paths without their leading slash. Most specific first.
  const named: Array<[string, string]> = [
    [h.project, '<PROJECT>'],
    [h.eyasHomes, '<EYAS_HOMES>'],
    [h.home, '<HOME>'],
    [h.root, '<ROOT>'],
  ]
  const unprivate = (p: string) => (p.startsWith('/private/') ? p.slice('/private'.length) : null)
  const rules: RedactionRule[] = [
    ...named.map(([from, to]) => ({ from, to })),
    { from: h.root.slice(1), to: '<ROOT_WITHOUT_LEADING_SLASH>' },
    ...named.flatMap(([from, to]) => (unprivate(from) ? [{ from: unprivate(from) as string, to }] : [])),
    { from: encodeURIComponent(h.root), to: '<ENC_ROOT>' },
    ...(unprivate(h.root) ? [{ from: encodeURIComponent(unprivate(h.root) as string), to: '<ENC_ROOT>' }] : []),
    // Claude Code names per-project dirs after the path with every non-alphanumeric replaced.
    { from: claudeProjectSlug(h.project), to: '<PROJECT_SLUG>' },
    { from: claudeProjectSlug(h.root), to: '<ROOT_SLUG>' },
    ...(unprivate(h.root) ? [{ from: claudeProjectSlug(unprivate(h.root) as string), to: '<ROOT_SLUG>' }] : []),
    ...realHomeDirs().map((d) => ({ from: d, to: '<REAL_HOME>' })),
    ...(host ? [{ from: host, to: '<HOSTNAME>' }] : []),
  ]
  const ctx: SpikeContext = { h, fixtures: opts.outDir, rules, steps: new Map(plan.map((s) => [s.id, s])), results: {} }
  try {
    const want = (cli: SpikeCli) => plan.some((s) => s.cli === cli && s.run)
    if (want('grok')) await runGrok(ctx)
    if (want('claude-code')) await runClaude(ctx)
    if (want('opencode')) await runOpencode(ctx)
    runKimi(ctx)
  } finally {
    if (!opts.keep) h.cleanup()
  }
  // Keys like "hostname" are redacted by value above; this catches anything the rules missed.
  const leaks = findFixtureLeaks(opts.outDir, [
    h.root,
    ...(unprivate(h.root) ? [unprivate(h.root) as string] : []),
    claudeProjectSlug(h.root),
    ...realHomeDirs(),
    ...(host ? [host] : []),
    ...(user.length >= 4 ? [`/${user}/`] : []),
  ])
  if (leaks.length > 0) throw new Error(`fixture leak check failed:\n${leaks.join('\n')}`)
  return { plan: plan.map((s) => ({ id: s.id, run: s.run, skipReason: s.skipReason })), results: redact(ctx.results, rules) }
}

function parseArgs(argv: string[]): RunSpikeOptions {
  const opts: RunSpikeOptions = { outDir: join(repoRoot(), 'tests', 'fixtures', 'cli') }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') opts.outDir = resolve(argv[++i] ?? opts.outDir)
    else if (a === '--only') opts.only = (argv[++i] ?? '').split(',').filter(Boolean) as SpikeCli[]
    else if (a === '--keep') opts.keep = true
    else if (a === '--summary') opts.summaryFile = resolve(argv[++i] ?? 'spike-summary.json')
  }
  return opts
}

if (import.meta.main) {
  const opts = parseArgs(process.argv.slice(2))
  runSpike(opts)
    .then((summary) => {
      if (opts.summaryFile) writeFileSync(opts.summaryFile, JSON.stringify(summary, null, 2) + '\n')
      log.info({ summaryFile: opts.summaryFile ?? null }, 'spike finished')
    })
    .catch((err) => {
      log.error({ err }, 'spike failed')
      process.exitCode = 1
    })
}
