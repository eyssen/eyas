// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Policy for the optional Google chrome-devtools-mcp sidecar (Apache-2.0).
// Coding/debug lane: live Chrome, network, console, Lighthouse, WebMCP.
// Not form-filling — that stays native browser_* / Playwright MCP / agent-browser.
// Agent tools arrive through the existing MCP bridge. Never vendored.
// Never --autoConnect (daily Chrome). Never --no-sandbox. Telemetry off.
// WebMCP tools only if the sidecar advertises them (fail-closed).

import {
  assertEyAsUserDataDir,
  firstExistingChromium,
  resolveConfiguredChromium,
  type ResolveDeps,
} from './playwright-loader.js'
import type { CliRunner } from '@modules/studio/cli-runner.js'

export interface ChromeDevtoolsMcpLaunch {
  name?: string | null
  command?: string | null
  args?: string[] | null
  env?: Record<string, string> | null
}

const DOCTOR_TIMEOUT_MS = 8_000
const NODE_MIN_MAJOR = 18

export const CHROME_DEVTOOLS_MCP_PACKAGE = 'chrome-devtools-mcp'
export const CHROME_DEVTOOLS_MCP_REGISTRY_ID = 'chrome-devtools'
export const CHROME_DEVTOOLS_MCP_CONNECTION_TYPE = 'chrome-devtools-mcp'

export const CHROME_DEVTOOLS_MCP_CATALOG_ARGS = [
  '-y',
  'chrome-devtools-mcp@latest',
  '--isolated',
  '--no-usage-statistics',
  '--no-performance-crux',
  '--categoryExperimentalWebmcp=true',
] as const

export const CHROME_DEVTOOLS_MCP_WEBMCP_TOOLS = ['list_webmcp_tools', 'execute_webmcp_tool'] as const

export const CHROME_DEVTOOLS_AUTOCONNECT_REMEDY = [
  '--autoConnect attaches to the operator daily Chrome profile (Chrome 136+).',
  'Use --isolated (catalog default) or an EYAS-owned --user-data-dir. Never the daily Chrome profile.',
].join(' ')

const SANDBOX_ARGS = new Set(['--no-sandbox', '--disable-setuid-sandbox'])
const AUTOCONNECT_FLAGS = ['--autoConnect', '--auto-connect']
const ISOLATED_FLAGS = ['--isolated']
const USER_DATA_DIR_FLAGS = ['--user-data-dir', '--userDataDir']
const LIVE_ATTACH_FLAGS = ['--browser-url', '--browserUrl', '--ws-endpoint', '--wsEndpoint']
const WEBMCP_FLAGS = ['--categoryExperimentalWebmcp', '--category-experimental-webmcp']
const USAGE_STATS_OFF_FLAGS = ['--no-usage-statistics']
const CRUX_OFF_FLAGS = ['--no-performance-crux']

function joinedLine(command?: string | null, args?: string[] | null): string {
  return [command ?? '', ...(args ?? [])].filter(Boolean).join(' ')
}

function parseNodeMajor(stdout: string): number | null {
  const m = stdout.trim().match(/^v?(\d+)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

function hasNamedFlag(args: string[], names: readonly string[]): boolean {
  return args.some((a) => names.some((n) => a === n || a.startsWith(`${n}=`)))
}

function flagIsEnabled(args: string[], names: readonly string[]): boolean {
  for (const a of args) {
    for (const n of names) {
      if (a === n) return true
      if (a.startsWith(`${n}=`)) {
        const v = a.slice(n.length + 1).toLowerCase()
        return v !== 'false' && v !== '0'
      }
    }
  }
  return false
}

export function isChromeDevtoolsMcp(input: ChromeDevtoolsMcpLaunch): boolean {
  const line = joinedLine(input.command, input.args).toLowerCase()
  if (line.includes('chrome-devtools-mcp')) return true
  const name = (input.name ?? '').toLowerCase()
  if (name === CHROME_DEVTOOLS_MCP_REGISTRY_ID || name === CHROME_DEVTOOLS_MCP_CONNECTION_TYPE) {
    const cmd = (input.command ?? '').toLowerCase()
    return cmd.includes('npx') || line.includes('chrome-devtools')
  }
  return false
}

export function extractChromeDevtoolsUserDataDir(
  args: string[],
  env?: Record<string, string> | null,
): string | null {
  const fromEnv = env?.CHROME_DEVTOOLS_MCP_USER_DATA_DIR?.trim()
  if (fromEnv) return fromEnv
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    for (const flag of USER_DATA_DIR_FLAGS) {
      if (a === flag) {
        const next = args[i + 1]
        if (next && !next.startsWith('-')) return next
      }
      if (a.startsWith(`${flag}=`)) return a.slice(flag.length + 1)
    }
  }
  return null
}

function isChromeArgSandbox(value: string): boolean {
  const v = value.trim()
  return SANDBOX_ARGS.has(v) || v.startsWith('--no-sandbox=')
}

/** Drop --chrome-arg/--chromeArg values that disable the Chromium sandbox. */
export function stripChromeArgSandbox(args: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--chrome-arg' || a === '--chromeArg') {
      const next = args[i + 1]
      if (next && isChromeArgSandbox(next)) {
        i += 1
        continue
      }
      out.push(a)
      continue
    }
    if (a.startsWith('--chrome-arg=') && isChromeArgSandbox(a.slice('--chrome-arg='.length))) continue
    if (a.startsWith('--chromeArg=') && isChromeArgSandbox(a.slice('--chromeArg='.length))) continue
    out.push(a)
  }
  return out
}

export function chromeArgSandboxPresent(args: string[]): string[] {
  const hits: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if ((a === '--chrome-arg' || a === '--chromeArg') && args[i + 1] && isChromeArgSandbox(args[i + 1]!)) {
      hits.push(`${a} ${args[i + 1]}`)
    }
    if (a.startsWith('--chrome-arg=') && isChromeArgSandbox(a.slice('--chrome-arg='.length))) hits.push(a)
    if (a.startsWith('--chromeArg=') && isChromeArgSandbox(a.slice('--chromeArg='.length))) hits.push(a)
  }
  return hits
}

export function telemetryOffChromeDevtoolsEnv(): Record<string, string> {
  return {
    DO_NOT_TRACK: '1',
    CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: '1',
    CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1',
  }
}

export function sanitizeChromeDevtoolsMcpLaunch(
  input: ChromeDevtoolsMcpLaunch,
): { args: string[]; env: Record<string, string> } {
  let args = stripChromeArgSandbox([...(input.args ?? [])])
  if (flagIsEnabled(args, AUTOCONNECT_FLAGS)) {
    throw new Error(CHROME_DEVTOOLS_AUTOCONNECT_REMEDY)
  }

  const userDataDir = extractChromeDevtoolsUserDataDir(args, input.env)
  if (userDataDir) assertEyAsUserDataDir(userDataDir)

  const isolated = hasNamedFlag(args, ISOLATED_FLAGS)
  const liveAttach = hasNamedFlag(args, LIVE_ATTACH_FLAGS)
  if (!isolated && !userDataDir && !liveAttach) {
    args.push('--isolated')
  }
  if (!hasNamedFlag(args, USAGE_STATS_OFF_FLAGS) && !hasNamedFlag(args, ['--usageStatistics', '--usage-statistics'])) {
    args.push('--no-usage-statistics')
  }
  if (!hasNamedFlag(args, CRUX_OFF_FLAGS) && !hasNamedFlag(args, ['--performanceCrux', '--performance-crux'])) {
    args.push('--no-performance-crux')
  }
  if (!hasNamedFlag(args, WEBMCP_FLAGS)) {
    args.push('--categoryExperimentalWebmcp=true')
  }

  const env = {
    ...telemetryOffChromeDevtoolsEnv(),
    ...(input.env ?? {}),
  }
  delete env.PLAYWRIGHT_MCP_NO_SANDBOX
  env.CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS = '1'
  env.CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS = '1'
  if (!env.DO_NOT_TRACK) env.DO_NOT_TRACK = '1'

  return { args, env }
}

export interface ChromeDevtoolsMcpCheck {
  id: string
  label: string
  status: 'ok' | 'missing' | 'warn'
  detail?: string
  remedy?: string
}

export interface ChromeDevtoolsMcpDoctorStatus {
  available: boolean
  checks: ChromeDevtoolsMcpCheck[]
}

export async function doctorChromeDevtoolsMcp(
  runner: CliRunner,
  input: ChromeDevtoolsMcpLaunch = {},
  chromiumDeps?: ResolveDeps,
): Promise<ChromeDevtoolsMcpDoctorStatus> {
  const checks: ChromeDevtoolsMcpCheck[] = []

  const nodeBin = await runner.which('node')
  if (!nodeBin) {
    checks.push({
      id: 'node',
      label: `Node.js ${NODE_MIN_MAJOR}+`,
      status: 'missing',
      remedy: `Install Node.js ${NODE_MIN_MAJOR} or newer. chrome-devtools-mcp is an npx sidecar, not Bun-first.`,
    })
  } else {
    const ver = await runner.run(nodeBin, ['-v'], { timeoutMs: DOCTOR_TIMEOUT_MS })
    const major = parseNodeMajor(ver.stdout || ver.stderr)
    if (major != null && major >= NODE_MIN_MAJOR) {
      checks.push({
        id: 'node',
        label: `Node.js ${NODE_MIN_MAJOR}+`,
        status: 'ok',
        detail: (ver.stdout || ver.stderr).trim(),
      })
    } else {
      checks.push({
        id: 'node',
        label: `Node.js ${NODE_MIN_MAJOR}+`,
        status: 'missing',
        detail: (ver.stdout || ver.stderr).trim() || 'unknown version',
        remedy: `Install Node.js ${NODE_MIN_MAJOR} or newer.`,
      })
    }
  }

  const npx = await runner.which('npx')
  if (npx) {
    checks.push({ id: 'npx', label: 'npx', status: 'ok', detail: npx })
  } else {
    checks.push({
      id: 'npx',
      label: 'npx',
      status: 'missing',
      remedy: 'Install Node.js (includes npx) or set PATH so npx is available. Catalog install is `npx -y chrome-devtools-mcp@latest`.',
    })
  }

  const sandboxArgs = (input.args ?? []).filter((a) => SANDBOX_ARGS.has(a) || a.startsWith('--no-sandbox='))
  const chromeArgSandbox = chromeArgSandboxPresent(input.args ?? [])
  const sandboxEnv = Boolean(input.env?.PLAYWRIGHT_MCP_NO_SANDBOX)
  if (sandboxArgs.length > 0 || chromeArgSandbox.length > 0 || sandboxEnv) {
    checks.push({
      id: 'sandbox',
      label: 'Chromium sandbox',
      status: 'missing',
      detail: [...sandboxArgs, ...chromeArgSandbox].join(' ') || 'PLAYWRIGHT_MCP_NO_SANDBOX is set',
      remedy: 'Remove --no-sandbox / --disable-setuid-sandbox and --chrome-arg values that disable the sandbox. EYAS never auto-retries unsandboxed.',
    })
  } else {
    checks.push({
      id: 'sandbox',
      label: 'Chromium sandbox',
      status: 'ok',
      detail: '--no-sandbox and --chrome-arg=--no-sandbox are forbidden',
    })
  }

  if (flagIsEnabled(input.args ?? [], AUTOCONNECT_FLAGS)) {
    checks.push({
      id: 'autoconnect',
      label: 'Daily Chrome attach',
      status: 'missing',
      detail: '--autoConnect is set',
      remedy: CHROME_DEVTOOLS_AUTOCONNECT_REMEDY,
    })
  } else {
    checks.push({
      id: 'autoconnect',
      label: 'Daily Chrome attach',
      status: 'ok',
      detail: '--autoConnect is refused; catalog uses --isolated',
    })
  }

  checks.push({
    id: 'telemetry',
    label: 'Telemetry',
    status: 'ok',
    detail: 'DO_NOT_TRACK=1, CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS, --no-usage-statistics, --no-performance-crux',
  })

  if (hasNamedFlag(input.args ?? [], WEBMCP_FLAGS)) {
    checks.push({
      id: 'webmcp',
      label: 'WebMCP category',
      status: 'ok',
      detail: `${CHROME_DEVTOOLS_MCP_WEBMCP_TOOLS.join(' / ')} are offered only if the sidecar advertises them (Chrome 150+, --enable-features=WebMCP)`,
    })
  } else {
    checks.push({
      id: 'webmcp',
      label: 'WebMCP category',
      status: 'warn',
      detail: '--categoryExperimentalWebmcp is off — WebMCP tools will not appear',
      remedy: 'Keep the catalog flag --categoryExperimentalWebmcp=true. If the tools are still missing, they are not invented — Chrome 150+ with --enable-features=WebMCP is required.',
    })
  }

  try {
    const configured = resolveConfiguredChromium(chromiumDeps)
    const system = firstExistingChromium(chromiumDeps)
    const detail = configured || system
    if (detail) {
      checks.push({
        id: 'chromium',
        label: 'Chrome / Chromium',
        status: 'ok',
        detail,
      })
    } else {
      checks.push({
        id: 'chromium',
        label: 'Chrome / Chromium',
        status: 'warn',
        detail: 'No EYAS_CHROMIUM_PATH or system Chrome — npx chrome-devtools-mcp launches Google Chrome itself',
        remedy: 'Install Google Chrome (stable or newer). Never the daily Chrome profile as --user-data-dir.',
      })
    }
  } catch (err) {
    checks.push({
      id: 'chromium',
      label: 'Chrome / Chromium',
      status: 'missing',
      detail: err instanceof Error ? err.message : String(err),
      remedy: 'Correct EYAS_CHROMIUM_PATH, or unset it.',
    })
  }

  const available = checks.every((c) => c.status !== 'missing')
  return { available, checks }
}
