// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Policy for the optional Microsoft @playwright/mcp sidecar (Apache-2.0).
// The EYAS agent receives those tools through the existing MCP bridge.
// Never the Python browser-use MCP (LLM key + retry_with_browser_use_agent).
// Never --no-sandbox. Telemetry off. Fail-closed doctor, like Hyperframes CLI.

import {
  assertEyAsUserDataDir,
  firstExistingChromium,
  resolveConfiguredChromium,
  type ResolveDeps,
} from './playwright-loader.js'
import type { CliRunner } from '@modules/studio/cli-runner.js'
import {
  AGENT_BROWSER_WRAPPER_REMEDY,
  isAgentBrowserMcp,
  isAgentBrowserNpmWrapper,
  sanitizeAgentBrowserMcpLaunch,
} from './agent-browser.js'
import { isChromeDevtoolsMcp, sanitizeChromeDevtoolsMcpLaunch } from './chrome-devtools-mcp.js'

const DOCTOR_TIMEOUT_MS = 8_000
const NODE_MIN_MAJOR = 18

export const PLAYWRIGHT_MCP_PACKAGE = '@playwright/mcp'
export const PLAYWRIGHT_MCP_REGISTRY_ID = 'playwright'
export const PLAYWRIGHT_MCP_CONNECTION_TYPE = 'playwright-mcp'

export const BROWSER_USE_PYTHON_MCP_REMEDY = [
  'The Python browser-use MCP is not allowed: it requests an LLM API key and',
  'exposes retry_with_browser_use_agent. Install Microsoft @playwright/mcp from',
  'Settings → MCP Servers → Catalog, or use native browser_* / the Browser Use CLI sidecar.',
].join(' ')

const SANDBOX_ARGS = new Set(['--no-sandbox', '--disable-setuid-sandbox'])

export interface PlaywrightMcpCheck {
  id: string
  label: string
  status: 'ok' | 'missing' | 'warn'
  detail?: string
  remedy?: string
}

export interface PlaywrightMcpDoctorStatus {
  available: boolean
  checks: PlaywrightMcpCheck[]
}

export interface McpStdioLaunch {
  name?: string | null
  command?: string | null
  args?: string[] | null
  env?: Record<string, string> | null
}

function joinedLine(command?: string | null, args?: string[] | null): string {
  return [command ?? '', ...(args ?? [])].filter(Boolean).join(' ')
}

export function isPlaywrightMcp(input: McpStdioLaunch): boolean {
  const line = joinedLine(input.command, input.args).toLowerCase()
  if (line.includes('@playwright/mcp')) return true
  const name = (input.name ?? '').toLowerCase()
  if (name === PLAYWRIGHT_MCP_REGISTRY_ID || name === PLAYWRIGHT_MCP_CONNECTION_TYPE) {
    const cmd = (input.command ?? '').toLowerCase()
    return cmd.includes('npx') || line.includes('playwright')
  }
  return false
}

export function isBrowserUsePythonMcp(input: McpStdioLaunch): boolean {
  if (isPlaywrightMcp(input)) return false
  const line = joinedLine(input.command, input.args).toLowerCase()
  const name = (input.name ?? '').toLowerCase()
  const mentions = /browser[-_]?use/.test(line) || /browser[-_]?use/.test(name)
  if (!mentions) return false
  const command = (input.command ?? '').trim()
  const base = command.split(/[/\\]/).pop()?.toLowerCase() ?? ''
  const pythonish = /^(python|python3|uvx|uv|pipx|browser-use)$/.test(base)
    || (input.args ?? []).some((a) => /browser[-_]?use/.test(a))
    || /--mcp|--cli-mcp/.test(line)
    || /(^|\s)-m(\s|$)/.test(line)
  return pythonish
}

export function stripSandboxArgs(args: string[]): string[] {
  return args.filter((a) => !SANDBOX_ARGS.has(a) && !a.startsWith('--no-sandbox='))
}

export function envWithoutSandbox(env: Record<string, string> | undefined): Record<string, string> {
  const next = { ...(env ?? {}) }
  delete next.PLAYWRIGHT_MCP_NO_SANDBOX
  return next
}

export function telemetryOffEnv(): Record<string, string> {
  return { DO_NOT_TRACK: '1' }
}

export function extractUserDataDir(args: string[], env?: Record<string, string> | null): string | null {
  const fromEnv = env?.PLAYWRIGHT_MCP_USER_DATA_DIR?.trim()
  if (fromEnv) return fromEnv
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--user-data-dir') {
      const next = args[i + 1]
      if (next && !next.startsWith('-')) return next
    }
    if (a.startsWith('--user-data-dir=')) return a.slice('--user-data-dir='.length)
  }
  return null
}

function hasFlag(args: string[], flag: string): boolean {
  return args.some((a) => a === flag || a.startsWith(`${flag}=`))
}

export function assertAllowedMcpBrowserSidecar(input: McpStdioLaunch): void {
  if (isBrowserUsePythonMcp(input)) {
    throw new Error(BROWSER_USE_PYTHON_MCP_REMEDY)
  }
  if (isAgentBrowserNpmWrapper(input)) {
    throw new Error(AGENT_BROWSER_WRAPPER_REMEDY)
  }
}

export function sanitizeMcpStdioLaunch(input: McpStdioLaunch): { args: string[]; env: Record<string, string> } {
  assertAllowedMcpBrowserSidecar(input)
  const args = stripSandboxArgs([...(input.args ?? [])])
  let env = envWithoutSandbox(input.env ?? undefined)

  if (isPlaywrightMcp({ ...input, args })) {
    env = envWithoutSandbox({ ...telemetryOffEnv(), ...env })
    const userDataDir = extractUserDataDir(args, env)
    if (userDataDir) assertEyAsUserDataDir(userDataDir)
    const extension = hasFlag(args, '--extension')
    const isolated = hasFlag(args, '--isolated')
    if (!extension && !userDataDir && !isolated) {
      args.push('--isolated')
    }
  }

  if (isAgentBrowserMcp({ ...input, args }) || isAgentBrowserNpmWrapper(input)) {
    const sanitized = sanitizeAgentBrowserMcpLaunch({ ...input, args, env })
    return { args: sanitized.args, env: sanitized.env }
  }

  if (isChromeDevtoolsMcp({ ...input, args })) {
    return sanitizeChromeDevtoolsMcpLaunch({ ...input, args, env })
  }

  return { args, env }
}

export function parseNodeMajor(stdout: string): number | null {
  const m = stdout.trim().match(/^v?(\d+)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

export async function doctorPlaywrightMcp(
  runner: CliRunner,
  input: McpStdioLaunch = {},
  chromiumDeps?: ResolveDeps,
): Promise<PlaywrightMcpDoctorStatus> {
  const checks: PlaywrightMcpCheck[] = []

  if (isBrowserUsePythonMcp(input)) {
    checks.push({
      id: 'python-mcp',
      label: 'Python browser-use MCP',
      status: 'missing',
      remedy: BROWSER_USE_PYTHON_MCP_REMEDY,
    })
  } else {
    checks.push({
      id: 'python-mcp',
      label: 'Python browser-use MCP',
      status: 'ok',
      detail: 'not this sidecar — Microsoft @playwright/mcp only',
    })
  }

  const nodeBin = await runner.which('node')
  if (!nodeBin) {
    checks.push({
      id: 'node',
      label: `Node.js ${NODE_MIN_MAJOR}+`,
      status: 'missing',
      remedy: `Install Node.js ${NODE_MIN_MAJOR} or newer. @playwright/mcp is an npx sidecar, not Bun-first.`,
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
      remedy: 'Install Node.js (includes npx) or set PATH so npx is available. Catalog install is `npx -y @playwright/mcp@latest`.',
    })
  }

  const sandboxArgs = (input.args ?? []).filter((a) => SANDBOX_ARGS.has(a) || a.startsWith('--no-sandbox='))
  const sandboxEnv = Boolean(input.env?.PLAYWRIGHT_MCP_NO_SANDBOX)
  if (sandboxArgs.length > 0 || sandboxEnv) {
    checks.push({
      id: 'sandbox',
      label: 'Chromium sandbox',
      status: 'missing',
      detail: sandboxArgs.length ? sandboxArgs.join(' ') : 'PLAYWRIGHT_MCP_NO_SANDBOX is set',
      remedy: 'Remove --no-sandbox / --disable-setuid-sandbox and unset PLAYWRIGHT_MCP_NO_SANDBOX. EYAS never auto-retries unsandboxed.',
    })
  } else {
    checks.push({
      id: 'sandbox',
      label: 'Chromium sandbox',
      status: 'ok',
      detail: '--no-sandbox is forbidden; PLAYWRIGHT_MCP_NO_SANDBOX is stripped on spawn',
    })
  }

  checks.push({
    id: 'telemetry',
    label: 'Telemetry',
    status: 'ok',
    detail: 'DO_NOT_TRACK=1 is always set on the Playwright MCP sidecar',
  })

  try {
    const configured = resolveConfiguredChromium(chromiumDeps)
    const system = firstExistingChromium(chromiumDeps)
    const detail = configured || system
    if (detail) {
      checks.push({
        id: 'chromium',
        label: 'Chromium',
        status: 'ok',
        detail,
      })
    } else {
      checks.push({
        id: 'chromium',
        label: 'Chromium',
        status: 'warn',
        detail: 'No EYAS_CHROMIUM_PATH or system Chrome — npx @playwright/mcp may download its own browser',
        remedy: 'Set EYAS_CHROMIUM_PATH, or run `bunx playwright-core install chromium`. Never the daily Chrome profile.',
      })
    }
  } catch (err) {
    checks.push({
      id: 'chromium',
      label: 'Chromium',
      status: 'missing',
      detail: err instanceof Error ? err.message : String(err),
      remedy: 'Correct EYAS_CHROMIUM_PATH, or unset it.',
    })
  }

  const available = checks.every((c) => c.status !== 'missing')
  return { available, checks }
}

export function parseJsonStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((x): x is string => typeof x === 'string')
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  }
  return []
}

export function parseJsonStringMap(value: unknown): Record<string, string> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v
    }
    return out
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      return parseJsonStringMap(JSON.parse(value))
    } catch {
      return {}
    }
  }
  return {}
}
