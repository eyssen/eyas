// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { existsSync } from 'node:fs'
import type { CliRunner } from '@modules/studio/cli-runner.js'
import type { OpencodeCheck, OpencodeDoctorStatus, OpencodeSettings } from './types.js'
import { isUnixPtyAvailable } from './unix-pty.js'
import { normalizeOpencodeSettings } from './settings-store.js'

const DOCTOR_TIMEOUT_MS = 8_000

export interface ResolvedOpencodeCli {
  command: string
  path: string | null
}

export async function resolveOpencodeCli(
  runner: CliRunner,
  settings: OpencodeSettings,
): Promise<ResolvedOpencodeCli> {
  const envBin = process.env.EYAS_OPENCODE_BIN?.trim()
  const configured = settings.cliPath?.trim() || envBin || null
  if (configured && existsSync(configured)) {
    return { command: configured, path: configured }
  }
  const onPath = await runner.which('opencode')
  if (onPath) return { command: onPath, path: onPath }
  return { command: 'opencode', path: null }
}

export async function doctorOpencode(
  runner: CliRunner,
  settings: OpencodeSettings,
  opts?: { serverUrl?: string | null; serverVersion?: string | null },
): Promise<OpencodeDoctorStatus> {
  const normalized = normalizeOpencodeSettings(settings)
  const checks: OpencodeCheck[] = []

  const cli = await resolveOpencodeCli(runner, normalized)
  if (cli.path) {
    checks.push({ id: 'cli', label: 'OpenCode CLI', status: 'ok', detail: cli.path })
    const ver = await runner.run(cli.command, ['--version'], { timeoutMs: DOCTOR_TIMEOUT_MS })
    const detail = (ver.stdout || ver.stderr).trim().slice(0, 200)
    if (ver.code === 0) {
      checks.push({ id: 'version', label: 'OpenCode version', status: 'ok', detail: detail || 'ok' })
    } else {
      checks.push({
        id: 'version',
        label: 'OpenCode version',
        status: 'warn',
        detail: detail || `exit ${ver.code}`,
        remedy: 'Reinstall from https://opencode.ai (MIT) or set EYAS_OPENCODE_BIN.',
      })
    }
  } else {
    checks.push({
      id: 'cli',
      label: 'OpenCode CLI',
      status: 'missing',
      remedy: 'Install OpenCode (MIT): `curl -fsSL https://opencode.ai/install | bash` or `npm i -g opencode-ai`, then set EYAS_OPENCODE_BIN if it is not on PATH.',
    })
  }

  const ptyOk = isUnixPtyAvailable()
  checks.push({
    id: 'pty',
    label: 'POSIX PTY',
    status: ptyOk ? 'ok' : 'missing',
    detail: `${process.platform}/${process.arch}`,
    remedy: ptyOk ? undefined : 'Interactive terminal needs a POSIX PTY (macOS/Linux). Windows is not supported.',
  })

  if (normalized.attachUrl) {
    // An external server keeps its own config, sign-in and permission rules.
    checks.push({
      id: 'attach',
      label: 'Server',
      status: 'warn',
      detail: `Attached to an external OpenCode server (${normalized.attachUrl}). EYAS does not start or isolate it: its own config, sign-in and permission rules apply.`,
      detailId: 'detailExternal',
      detailVars: { url: normalized.attachUrl },
    })
    checks.push({
      id: 'isolation',
      label: 'Isolation',
      status: 'warn',
      detail: 'Not isolated: an external server uses its own configuration and memory, not the EYAS-owned OpenCode home.',
      detailId: 'detailExternal',
    })
  } else {
    checks.push({
      id: 'attach',
      label: 'Server',
      status: 'ok',
      detail: 'EYAS starts its own password-protected OpenCode server on 127.0.0.1 when a session starts.',
      detailId: 'detailSpawn',
    })
    checks.push({
      id: 'isolation',
      label: 'Isolation',
      status: 'ok',
      detail: 'EYAS owns the OpenCode config, data, state and cache. Host Claude Code instructions and skills, other assistants\' skills and project config are not loaded. Headless tasks ask the EYAS security gate before every tool call.',
      detailId: 'detail',
    })
  }

  const available = normalized.enabled && checks.every((c) => c.status !== 'missing')
  return {
    available,
    enabled: normalized.enabled,
    checks,
    server: {
      running: Boolean(opts?.serverUrl),
      url: opts?.serverUrl ?? null,
      version: opts?.serverVersion ?? null,
    },
    pty: {
      available: ptyOk,
      platform: process.platform,
    },
  }
}
