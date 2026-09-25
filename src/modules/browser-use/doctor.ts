// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { existsSync } from 'node:fs'
import type { CliRunner } from '@modules/studio/cli-runner.js'
import {
  doctorAgentBrowser,
  resolveDataDir,
  type AgentBrowserDoctorStatus,
} from '@shared/agent-browser.js'
import { normalizeBrowserUseSettings, type BrowserUseSettings } from './settings-store.js'

const DOCTOR_TIMEOUT_MS = 8_000

export interface BrowserUseCheck {
  id: string
  label: string
  status: 'ok' | 'missing' | 'warn'
  detail?: string
  remedy?: string
}

export interface BrowserUseStatus {
  available: boolean
  enabled: boolean
  checks: BrowserUseCheck[]
  agentBrowser: AgentBrowserDoctorStatus
}

export interface ResolvedCli {
  command: string
  prefixArgs: string[]
  path: string | null
  viaUvx: boolean
}

export function telemetryOffEnv(allowCloud: boolean): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ANONYMIZED_TELEMETRY: 'false',
    BROWSER_USE_LOGGING_LEVEL: 'warning',
    DO_NOT_TRACK: '1',
  }
  if (!allowCloud) {
    env.BROWSER_USE_API_KEY = ''
  }
  return env
}

export async function resolveBrowserUseCli(
  runner: CliRunner,
  settings: BrowserUseSettings,
): Promise<ResolvedCli> {
  const envBin = process.env.EYAS_BROWSER_USE_BIN?.trim()
  const configured = settings.cliPath?.trim() || envBin || null
  if (configured && existsSync(configured)) {
    return { command: configured, prefixArgs: [], path: configured, viaUvx: false }
  }
  const onPath = await runner.which('browser-use')
  if (onPath) {
    return { command: onPath, prefixArgs: [], path: onPath, viaUvx: false }
  }
  const uvx = await runner.which('uvx')
  if (uvx && settings.allowUvx) {
    return { command: uvx, prefixArgs: ['--python', '3.12', 'browser-use'], path: null, viaUvx: true }
  }
  return { command: 'browser-use', prefixArgs: [], path: null, viaUvx: false }
}

function parsePythonMajorMinor(stdout: string): { major: number; minor: number } | null {
  const m = stdout.trim().match(/Python\s+(\d+)\.(\d+)/i) || stdout.trim().match(/^(\d+)\.(\d+)/)
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]) }
}

export async function doctorBrowserUse(
  runner: CliRunner,
  settings: BrowserUseSettings,
  opts?: { dataDir?: string; env?: NodeJS.ProcessEnv | Record<string, string | undefined> },
): Promise<BrowserUseStatus> {
  const normalized = normalizeBrowserUseSettings(settings)
  const checks: BrowserUseCheck[] = []

  const python = (await runner.which('python3')) || (await runner.which('python'))
  if (!python) {
    checks.push({
      id: 'python',
      label: 'Python 3.11+',
      status: 'missing',
      remedy: 'Install Python 3.11 or newer. The Browser Use CLI is Python, not Bun.',
    })
  } else {
    const ver = await runner.run(python, ['--version'], { timeoutMs: DOCTOR_TIMEOUT_MS })
    const parsed = parsePythonMajorMinor(`${ver.stdout} ${ver.stderr}`)
    if (parsed && (parsed.major > 3 || (parsed.major === 3 && parsed.minor >= 11))) {
      checks.push({ id: 'python', label: 'Python 3.11+', status: 'ok', detail: (ver.stdout || ver.stderr).trim() })
    } else {
      checks.push({
        id: 'python',
        label: 'Python 3.11+',
        status: 'missing',
        detail: (ver.stdout || ver.stderr).trim() || 'unknown version',
        remedy: 'Install Python 3.11 or newer.',
      })
    }
  }

  const cli = await resolveBrowserUseCli(runner, normalized)
  if (cli.path) {
    checks.push({ id: 'cli', label: 'browser-use CLI', status: 'ok', detail: cli.path })
  } else if (cli.viaUvx) {
    checks.push({
      id: 'cli',
      label: 'browser-use CLI',
      status: 'warn',
      detail: 'not on PATH; exec will use uvx --python 3.12 browser-use',
      remedy: 'Install with `uv tool install browser-use` or set EYAS_BROWSER_USE_BIN.',
    })
  } else {
    checks.push({
      id: 'cli',
      label: 'browser-use CLI',
      status: 'missing',
      remedy: 'Install with `uv tool install browser-use` (Python 3.12) or set EYAS_BROWSER_USE_BIN.',
    })
  }

  checks.push({
    id: 'telemetry',
    label: 'Telemetry',
    status: 'ok',
    detail: 'ANONYMIZED_TELEMETRY=false is always set on exec',
  })
  checks.push({
    id: 'cloud',
    label: 'Browser Use Cloud',
    status: normalized.allowCloud ? 'warn' : 'ok',
    detail: normalized.allowCloud
      ? 'Cloud API key may be forwarded — local Chrome is the default'
      : 'Cloud key is stripped; the CLI talks to local Chrome via CDP',
  })

  const available = normalized.enabled && checks.every((c) => c.status !== 'missing')
  const agentBrowser = await doctorAgentBrowser(runner, normalized.agentBrowser, {
    dataDir: opts?.dataDir ?? resolveDataDir(),
    env: opts?.env,
  })
  return { available, enabled: normalized.enabled, checks, agentBrowser }
}
