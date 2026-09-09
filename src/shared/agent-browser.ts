// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Policy for the optional Vercel agent-browser CLI sidecar (Apache-2.0).
// Do not vendor the Rust crate. LLM stays the EYAS model module — never `chat`.
// Fail-closed doctor, like Hyperframes / Playwright MCP. Chrome 136: EYAS-owned
// --profile directory, never the daily Chrome profile.

import { existsSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve as resolvePath } from 'node:path'
import { resolveInstance } from '@core/instance.js'
import type { CliRunner } from '@modules/studio/cli-runner.js'
import { assertEyAsUserDataDir, isDailyBrowserProfile } from './playwright-loader.js'

export interface AgentBrowserMcpLaunch {
  name?: string | null
  command?: string | null
  args?: string[] | null
  env?: Record<string, string> | null
}

const DOCTOR_TIMEOUT_MS = 8_000
const SANDBOX_ARGS = new Set(['--no-sandbox', '--disable-setuid-sandbox'])

export const AGENT_BROWSER_BIN = 'agent-browser'
export const AGENT_BROWSER_REGISTRY_ID = 'agent-browser'
export const AGENT_BROWSER_CONNECTION_TYPE = 'agent-browser'
export const AGENT_BROWSER_MCP_TOOLS = 'core,state'

export const AGENT_BROWSER_INSTALL_REMEDY = [
  'Install with `npm i -g agent-browser` then `agent-browser install`,',
  'or `brew install agent-browser` then `agent-browser install`,',
  'or set EYAS_AGENT_BROWSER_BIN to the binary.',
].join(' ')

export const AGENT_BROWSER_CHAT_REMEDY =
  'agent-browser chat / dashboard AI / --tools all|debug are not allowed. EYAS owns the model. Use snapshot + @e1 refs (or MCP core,state).'

export const AGENT_BROWSER_WRAPPER_REMEDY =
  'The npm mcp-agent-browser wrapper is not allowed. Use the native CLI: `agent-browser mcp --tools core,state`.'

const FORBIDDEN_VERBS = new Set([
  'chat', 'dashboard', 'plugin', 'install', 'upgrade', 'auth', 'connect', 'mcp', 'profiles', 'doctor',
])

export const AGENT_BROWSER_VERBS = new Set([
  'open', 'snapshot', 'click', 'dblclick', 'fill', 'type', 'press', 'keyboard',
  'hover', 'select', 'check', 'uncheck', 'wait', 'screenshot', 'get', 'tab',
  'back', 'forward', 'reload', 'close', 'state', 'cookies', 'storage', 'eval',
  'upload', 'scroll', 'scrollintoview', 'focus', 'dialog', 'frame', 'is', 'find', 'read',
])

const FORBIDDEN_FLAGS = new Set([
  '--no-sandbox', '--disable-setuid-sandbox', '--auto-connect', '--cdp', '--engine', '--provider', '--model',
])

const GATEWAY_ENV_KEYS = ['AI_GATEWAY_API_KEY', 'AI_GATEWAY_URL', 'AI_GATEWAY_MODEL'] as const

export interface AgentBrowserCheck {
  id: string
  label: string
  status: 'ok' | 'missing' | 'warn'
  detail?: string
  remedy?: string
}

export interface AgentBrowserDoctorStatus {
  available: boolean
  enabled: boolean
  recommended: true
  checks: AgentBrowserCheck[]
}

export type ResolvedAgentBrowserCli =
  | { kind: 'found'; command: string; path: string }
  | { kind: 'missing-configured'; configured: string }
  | { kind: 'missing' }

export interface AgentBrowserSettingsSlice {
  enabled: boolean
  cliPath: string | null
  allowedDomains: string[]
}

export function defaultAgentBrowserSettings(): AgentBrowserSettingsSlice {
  return { enabled: true, cliPath: null, allowedDomains: [] }
}

export function defaultAgentBrowserProfileDir(dataDir: string): string {
  return join(dataDir, 'browser', 'agent-browser', 'profile')
}

export function defaultAgentBrowserStateDir(dataDir: string): string {
  return join(dataDir, 'browser', 'agent-browser', 'state')
}

export function defaultAgentBrowserDownloadDir(dataDir: string): string {
  return join(dataDir, 'browser', 'downloads')
}

export function resolveDataDir(): string {
  return resolveInstance({ ensureDirs: false }).dataDir
}

function existsPath(path: string, exists: (p: string) => boolean): boolean {
  return exists(path)
}

function envBin(env: NodeJS.ProcessEnv | Record<string, string | undefined>): string {
  return (env.EYAS_AGENT_BROWSER_BIN ?? '').trim()
}

export async function resolveAgentBrowserCli(opts: {
  runner: CliRunner
  cliPath?: string | null
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  exists?: (p: string) => boolean
}): Promise<ResolvedAgentBrowserCli> {
  const exists = opts.exists ?? existsSync
  const env = opts.env ?? process.env
  const configured = opts.cliPath?.trim() || null
  if (configured && existsPath(configured, exists)) {
    return { kind: 'found', command: configured, path: configured }
  }
  const fromEnv = envBin(env)
  if (fromEnv) {
    if (existsPath(fromEnv, exists)) {
      return { kind: 'found', command: fromEnv, path: fromEnv }
    }
    return { kind: 'missing-configured', configured: fromEnv }
  }
  const onPath = await opts.runner.which(AGENT_BROWSER_BIN)
  if (onPath) {
    return { kind: 'found', command: onPath, path: onPath }
  }
  return { kind: 'missing' }
}

function joinedLine(command?: string | null, args?: string[] | null): string {
  return [command ?? '', ...(args ?? [])].filter(Boolean).join(' ')
}

function commandBase(command?: string | null): string {
  const raw = (command ?? '').trim()
  if (!raw) return ''
  return basename(raw).toLowerCase().replace(/\.exe$/, '')
}

export function isAgentBrowserMcp(input: AgentBrowserMcpLaunch): boolean {
  if (isAgentBrowserNpmWrapper(input)) return false
  const base = commandBase(input.command)
  if (base === AGENT_BROWSER_BIN) return true
  const name = (input.name ?? '').toLowerCase()
  if (name === AGENT_BROWSER_REGISTRY_ID || name === AGENT_BROWSER_CONNECTION_TYPE) {
    return base === AGENT_BROWSER_BIN || base === '' || /(^|\/)agent-browser$/.test((input.command ?? '').toLowerCase())
  }
  const line = joinedLine(input.command, input.args).toLowerCase()
  return /\bagent-browser\b/.test(line) && /\bmcp\b/.test(line)
}

export function isAgentBrowserNpmWrapper(input: AgentBrowserMcpLaunch): boolean {
  const line = joinedLine(input.command, input.args).toLowerCase()
  const name = (input.name ?? '').toLowerCase()
  return line.includes('mcp-agent-browser') || name.includes('mcp-agent-browser')
}

export function parseAgentBrowserDoctorJson(stdout: string): {
  ok: boolean
  chromeMissing: boolean
  detail?: string
} {
  const text = stdout.trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, chromeMissing: false, detail: 'unparseable doctor JSON' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, chromeMissing: false, detail: 'doctor JSON is not an object' }
  }
  const obj = parsed as Record<string, unknown>
  const ok = obj.ok !== false && obj.success !== false && obj.error == null
  let chromeMissing = obj.chrome === false || obj.browser === false
  const checks = obj.checks
  if (Array.isArray(checks)) {
    for (const raw of checks) {
      if (!raw || typeof raw !== 'object') continue
      const c = raw as Record<string, unknown>
      const id = String(c.id ?? c.name ?? '').toLowerCase()
      const status = String(c.status ?? '').toLowerCase()
      if (
        (id.includes('chrome') || id.includes('browser'))
        && (status === 'fail' || status === 'missing' || status === 'error' || status === 'failed')
      ) {
        chromeMissing = true
      }
    }
  }
  const detail = typeof obj.message === 'string' ? obj.message : undefined
  return { ok, chromeMissing, detail }
}

function flagValue(args: string[], name: string): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === name) {
      const next = args[i + 1]
      if (next && !next.startsWith('-')) return next
      return null
    }
    if (a.startsWith(`${name}=`)) return a.slice(name.length + 1)
  }
  return null
}

function hasFlag(args: string[], name: string): boolean {
  return args.some((a) => a === name || a.startsWith(`${name}=`))
}

function looksLikeFilesystemPath(value: string): boolean {
  if (!value || value.startsWith('--') || value.startsWith('@')) return false
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false
  return value.includes('/') || value.includes('\\') || /^[A-Za-z]:/.test(value)
}

function hasDotDotSegment(value: string): boolean {
  return value.split(/[\\/]/).includes('..')
}

export function isUnderDir(file: string, root: string): boolean {
  const rel = relative(resolvePath(root), resolvePath(file))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

export function assertAgentBrowserProfile(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('agent-browser --profile is empty. Use the EYAS-owned directory under data/browser/agent-browser/profile.')
  }
  if (trimmed.toLowerCase() === 'default' || (!looksLikeFilesystemPath(trimmed) && !trimmed.startsWith('.'))) {
    throw new Error(
      `refusing Chrome profile name as --profile: ${trimmed}. Use an EYAS-owned directory, never Default or a named daily profile (Chrome 136+).`,
    )
  }
  return assertEyAsUserDataDir(trimmed)
}

export function assertAgentBrowserStatePath(value: string, dataDir: string): string {
  const trimmed = value.trim()
  if (!trimmed || hasDotDotSegment(trimmed)) {
    throw new Error('agent-browser --state path is rejected. Use a file under data/browser/agent-browser/.')
  }
  const abs = isAbsolute(trimmed) ? trimmed : resolvePath(defaultAgentBrowserStateDir(dataDir), trimmed)
  const root = join(dataDir, 'browser', 'agent-browser')
  if (!isUnderDir(abs, root) && resolvePath(abs) !== resolvePath(root)) {
    throw new Error(`refusing --state path outside ${root}`)
  }
  if (isDailyBrowserProfile(abs)) {
    throw new Error(`refusing daily browser profile as --state: ${abs}`)
  }
  return abs
}

export function assertAllowedUploadPath(value: string, dataDir: string, workspaceRoots: string[]): string {
  if (hasDotDotSegment(value)) {
    throw new Error(`refusing path with .. : ${value}`)
  }
  const abs = isAbsolute(value) ? value : resolvePath(workspaceRoots[0] || dataDir, value)
  const browserRoot = join(dataDir, 'browser')
  const allowed = [browserRoot, ...workspaceRoots]
  if (allowed.some((root) => isUnderDir(abs, root) || resolvePath(abs) === resolvePath(root))) {
    return abs
  }
  throw new Error(`upload path must be under the workspace or ${browserRoot}`)
}

function firstVerb(args: string[]): string | null {
  for (const a of args) {
    if (!a || a.startsWith('-')) continue
    return a.toLowerCase()
  }
  return null
}

export function validateAgentBrowserArgs(
  args: string[],
  opts: { dataDir: string; workspaceRoots?: string[] },
): void {
  const verb = firstVerb(args)
  if (!verb) throw new Error('agent-browser command is missing a verb (e.g. snapshot, click, open).')
  if (FORBIDDEN_VERBS.has(verb)) {
    throw new Error(`${AGENT_BROWSER_CHAT_REMEDY} Forbidden verb: ${verb}`)
  }
  if (!AGENT_BROWSER_VERBS.has(verb)) {
    throw new Error(`agent-browser verb "${verb}" is not on the allowlist. Use snapshot / click / fill / state / …`)
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    const flagName = a.includes('=') ? a.slice(0, a.indexOf('=')) : a
    if (FORBIDDEN_FLAGS.has(flagName) || SANDBOX_ARGS.has(flagName)) {
      throw new Error(`Forbidden agent-browser flag: ${flagName}. No --no-sandbox, --auto-connect, --cdp, --engine, --provider, or --model.`)
    }
    if (flagName === '--profile') {
      const value = a.startsWith('--profile=') ? a.slice('--profile='.length) : args[i + 1]
      if (!value || value.startsWith('-')) throw new Error('agent-browser --profile requires a directory path.')
      assertAgentBrowserProfile(value)
    }
    if (flagName === '--state') {
      const value = a.startsWith('--state=') ? a.slice('--state='.length) : args[i + 1]
      if (!value || value.startsWith('-')) throw new Error('agent-browser --state requires a file path.')
      assertAgentBrowserStatePath(value, opts.dataDir)
    }
    if (flagName === '--user-data-dir') {
      const value = a.startsWith('--user-data-dir=') ? a.slice('--user-data-dir='.length) : args[i + 1]
      if (value && !value.startsWith('-')) assertEyAsUserDataDir(value)
    }
    if (verb === 'upload' && !a.startsWith('-') && looksLikeFilesystemPath(a) && a !== verb) {
      assertAllowedUploadPath(a, opts.dataDir, opts.workspaceRoots ?? [])
    }
  }
}

export function injectAgentBrowserGlobals(
  args: string[],
  opts: { dataDir: string; allowedDomains?: string[] },
): string[] {
  const profile = defaultAgentBrowserProfileDir(opts.dataDir)
  const prefix: string[] = []
  if (!hasFlag(args, '--profile')) {
    prefix.push('--profile', profile)
  }
  if (!hasFlag(args, '--session') && !hasFlag(args, '--session-name')) {
    prefix.push('--session', 'eyas')
  }
  if (!hasFlag(args, '--content-boundaries')) {
    prefix.push('--content-boundaries')
  }
  const domains = (opts.allowedDomains ?? []).map((d) => d.trim()).filter(Boolean)
  if (domains.length > 0 && !hasFlag(args, '--allowed-domains')) {
    prefix.push('--allowed-domains', domains.join(','))
  }
  return [...prefix, ...args]
}

export function stripAgentBrowserGatewayEnv(env: Record<string, string | undefined>): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (v == null) continue
    if ((GATEWAY_ENV_KEYS as readonly string[]).includes(k)) continue
    if (k === 'BROWSER_USE_API_KEY') continue
    if (k === 'EYAS_CHROMIUM_PATH' || k === 'EYAS_CHROMIUM_NO_SANDBOX' || k === 'PLAYWRIGHT_MCP_NO_SANDBOX') continue
    next[k] = v
  }
  return next
}

export function agentBrowserPolicyEnv(opts: {
  dataDir: string
  allowedDomains?: string[]
}): Record<string, string> {
  const domains = (opts.allowedDomains ?? []).map((d) => d.trim()).filter(Boolean)
  const out: Record<string, string> = {
    DO_NOT_TRACK: '1',
    AGENT_BROWSER_PROFILE: defaultAgentBrowserProfileDir(opts.dataDir),
    AGENT_BROWSER_DOWNLOAD_PATH: defaultAgentBrowserDownloadDir(opts.dataDir),
    AGENT_BROWSER_CONTENT_BOUNDARIES: '1',
    AGENT_BROWSER_SESSION: 'eyas',
    // Empty overrides so `{ ...process.env, ...opts.env }` cannot keep a host AI Gateway key.
    AI_GATEWAY_API_KEY: '',
    AI_GATEWAY_URL: '',
    AI_GATEWAY_MODEL: '',
    BROWSER_USE_API_KEY: '',
    EYAS_CHROMIUM_NO_SANDBOX: '',
  }
  if (domains.length > 0) out.AGENT_BROWSER_ALLOWED_DOMAINS = domains.join(',')
  return out
}

export function agentBrowserSpawnEnv(opts: {
  dataDir: string
  allowedDomains?: string[]
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
}): Record<string, string | undefined> {
  const base = stripAgentBrowserGatewayEnv({ ...(opts.env ?? process.env) })
  return { ...base, ...agentBrowserPolicyEnv(opts) }
}

function rewriteToolsArg(args: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--tools') {
      const next = args[i + 1]
      out.push('--tools')
      if (next && !next.startsWith('-')) {
        out.push(rewriteToolsValue(next))
        i++
      } else {
        out.push(AGENT_BROWSER_MCP_TOOLS)
      }
      continue
    }
    if (a.startsWith('--tools=')) {
      out.push(`--tools=${rewriteToolsValue(a.slice('--tools='.length))}`)
      continue
    }
    if (a.toLowerCase() === 'chat') {
      continue
    }
    out.push(a)
  }
  return out
}

function rewriteToolsValue(value: string): string {
  const parts = value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (parts.includes('all') || parts.includes('debug')) return AGENT_BROWSER_MCP_TOOLS
  if (parts.length === 0) return AGENT_BROWSER_MCP_TOOLS
  const keep = parts.filter((p) => p !== 'all' && p !== 'debug' && p !== 'chat')
  if (!keep.includes('core')) keep.unshift('core')
  if (!keep.includes('state')) keep.push('state')
  return keep.join(',')
}

export function sanitizeAgentBrowserMcpLaunch(
  input: AgentBrowserMcpLaunch,
  opts?: { dataDir?: string },
): { args: string[]; env: Record<string, string> } {
  if (isAgentBrowserNpmWrapper(input)) {
    throw new Error(AGENT_BROWSER_WRAPPER_REMEDY)
  }
  const dataDir = opts?.dataDir ?? resolveDataDir()
  let args = rewriteToolsArg([...(input.args ?? [])].filter((a) => !SANDBOX_ARGS.has(a) && !a.startsWith('--no-sandbox=')))
  const profile = flagValue(args, '--profile')
  if (profile) assertAgentBrowserProfile(profile)
  const state = flagValue(args, '--state')
  if (state) assertAgentBrowserStatePath(state, dataDir)
  const userDataDir = flagValue(args, '--user-data-dir')
  if (userDataDir) assertEyAsUserDataDir(userDataDir)
  if (hasFlag(args, '--auto-connect') || hasFlag(args, '--cdp') || hasFlag(args, '--engine') || hasFlag(args, '--provider') || hasFlag(args, '--model')) {
    throw new Error('Forbidden agent-browser MCP flag (--auto-connect / --cdp / --engine / --provider / --model).')
  }
  if (!args.includes('mcp')) {
    args = ['mcp', '--tools', AGENT_BROWSER_MCP_TOOLS, ...args]
  } else if (!hasFlag(args, '--tools')) {
    const mcpAt = args.indexOf('mcp')
    args.splice(mcpAt + 1, 0, '--tools', AGENT_BROWSER_MCP_TOOLS)
  }
  const env = {
    ...stripAgentBrowserGatewayEnv(input.env ?? {}),
    ...agentBrowserPolicyEnv({ dataDir }),
  }
  return { args, env }
}

export function prepareAgentBrowserRun(opts: {
  argv?: string[]
  batch?: string[][]
  dataDir: string
  allowedDomains?: string[]
  workspaceRoots?: string[]
}): { args: string[]; stdin?: string } {
  const hasArgv = Array.isArray(opts.argv)
  const hasBatch = Array.isArray(opts.batch)
  if (hasArgv === hasBatch) {
    throw new Error('Pass exactly one of argv (string[]) or batch (string[][]).')
  }
  const ctx = { dataDir: opts.dataDir, workspaceRoots: opts.workspaceRoots ?? [] }
  if (hasBatch) {
    const batch = opts.batch!
    if (batch.length === 0) throw new Error('batch must not be empty')
    for (const row of batch) {
      if (!Array.isArray(row) || row.length === 0) throw new Error('each batch row must be a non-empty string array')
      validateAgentBrowserArgs(row, ctx)
    }
    const wrapped = injectAgentBrowserGlobals(['batch', '--json'], {
      dataDir: opts.dataDir,
      allowedDomains: opts.allowedDomains,
    })
    return { args: wrapped, stdin: JSON.stringify(batch) }
  }
  const argv = opts.argv!
  if (argv.length === 0) throw new Error('argv must not be empty')
  validateAgentBrowserArgs(argv, ctx)
  return {
    args: injectAgentBrowserGlobals(argv, {
      dataDir: opts.dataDir,
      allowedDomains: opts.allowedDomains,
    }),
  }
}

export async function doctorAgentBrowser(
  runner: CliRunner,
  settings: AgentBrowserSettingsSlice,
  opts?: {
    dataDir?: string
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>
    exists?: (p: string) => boolean
  },
): Promise<AgentBrowserDoctorStatus> {
  const checks: AgentBrowserCheck[] = []
  const dataDir = opts?.dataDir ?? resolveDataDir()
  const env = opts?.env ?? process.env
  const cli = await resolveAgentBrowserCli({
    runner,
    cliPath: settings.cliPath,
    env,
    exists: opts?.exists,
  })

  if (cli.kind === 'found') {
    checks.push({ id: 'cli', label: 'agent-browser CLI', status: 'ok', detail: cli.path })
  } else if (cli.kind === 'missing-configured') {
    checks.push({
      id: 'cli',
      label: 'agent-browser CLI',
      status: 'missing',
      detail: `EYAS_AGENT_BROWSER_BIN is set but missing: ${cli.configured}`,
      remedy: AGENT_BROWSER_INSTALL_REMEDY,
    })
  } else {
    checks.push({
      id: 'cli',
      label: 'agent-browser CLI',
      status: 'missing',
      remedy: AGENT_BROWSER_INSTALL_REMEDY,
    })
  }

  if (cli.kind === 'found') {
    const ver = await runner.run(cli.command, ['--version'], { timeoutMs: DOCTOR_TIMEOUT_MS, env: agentBrowserSpawnEnv({ dataDir, env }) })
    const versionText = (ver.stdout || ver.stderr).trim()
    if (ver.code === 0 && versionText) {
      checks.push({ id: 'version', label: 'agent-browser version', status: 'ok', detail: versionText.split('\n')[0] })
    } else {
      checks.push({
        id: 'version',
        label: 'agent-browser version',
        status: 'missing',
        detail: versionText || `exit ${ver.code}`,
        remedy: AGENT_BROWSER_INSTALL_REMEDY,
      })
    }

    const probe = await runner.run(cli.command, ['doctor', '--offline', '--quick', '--json'], {
      timeoutMs: DOCTOR_TIMEOUT_MS,
      env: agentBrowserSpawnEnv({ dataDir, env }),
    })
    const parsed = parseAgentBrowserDoctorJson(probe.stdout || probe.stderr)
    if (probe.code !== 0 || !parsed.ok) {
      checks.push({
        id: 'doctor',
        label: 'agent-browser doctor',
        status: 'missing',
        detail: parsed.detail || (probe.stderr || probe.stdout).trim().slice(0, 500) || `exit ${probe.code}`,
        remedy: AGENT_BROWSER_INSTALL_REMEDY,
      })
    } else {
      checks.push({
        id: 'doctor',
        label: 'agent-browser doctor',
        status: 'ok',
        detail: 'doctor --offline --quick --json ok:true',
      })
    }
    if (parsed.chromeMissing) {
      checks.push({
        id: 'browser',
        label: 'Chrome for Testing',
        status: 'missing',
        remedy: 'Run `agent-browser install` (operator), then retry. EYAS does not download Chrome itself.',
      })
    } else if (probe.code === 0 && parsed.ok) {
      checks.push({
        id: 'browser',
        label: 'Chrome for Testing',
        status: 'ok',
        detail: 'doctor did not report a missing Chrome',
      })
    } else {
      checks.push({
        id: 'browser',
        label: 'Chrome for Testing',
        status: 'warn',
        detail: 'doctor did not confirm Chrome; run `agent-browser install` if snapshots fail',
        remedy: 'Run `agent-browser install`.',
      })
    }
  } else {
    checks.push({
      id: 'version',
      label: 'agent-browser version',
      status: 'missing',
      remedy: AGENT_BROWSER_INSTALL_REMEDY,
    })
    checks.push({
      id: 'doctor',
      label: 'agent-browser doctor',
      status: 'missing',
      remedy: AGENT_BROWSER_INSTALL_REMEDY,
    })
    checks.push({
      id: 'browser',
      label: 'Chrome for Testing',
      status: 'missing',
      remedy: 'Install the CLI, then `agent-browser install`.',
    })
  }

  const profile = (env.AGENT_BROWSER_PROFILE ?? '').trim() || defaultAgentBrowserProfileDir(dataDir)
  try {
    assertEyAsUserDataDir(profile)
    checks.push({
      id: 'profile',
      label: 'EYAS-owned profile',
      status: 'ok',
      detail: profile,
    })
  } catch (err) {
    checks.push({
      id: 'profile',
      label: 'EYAS-owned profile',
      status: 'missing',
      detail: err instanceof Error ? err.message : String(err),
      remedy: `Point the profile at ${defaultAgentBrowserProfileDir(dataDir)}, never the daily Chrome profile (Chrome 136+).`,
    })
  }

  checks.push({
    id: 'telemetry',
    label: 'Telemetry / AI Gateway',
    status: 'ok',
    detail: 'DO_NOT_TRACK=1; AI_GATEWAY_API_KEY is stripped on every spawn; chat is refused',
  })

  const available = settings.enabled && checks.every((c) => c.status !== 'missing')
  return { available, enabled: settings.enabled, recommended: true, checks }
}
