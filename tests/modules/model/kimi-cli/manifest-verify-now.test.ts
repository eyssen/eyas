// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// K6 — Verify now for the Kimi Code CLI. A loaded Kimi registers the same
// check sequence its load runs (the EYAS home read-back, then — signed in —
// a session start without a prompt); the panel's Verify now re-runs it. Kimi
// counts as verified only once a session has started on this host, so a
// signed-out install stays "not verified yet" honestly. Fake ACP binary in a
// temp dir: no real CLI, no model call.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearExecutableCache } from '@modules/model/cli-runtime/executables.js'
import { clearAcpPreflightCache } from '@modules/model/submodules/grok-cli/acp-verify.js'
import {
  canVerifyIsolation,
  getIsolationStatus,
  registerIsolationVerifier,
  resetIsolationStatuses,
  verifyIsolationNow,
} from '@modules/model/cli-runtime/isolation.js'
import { kimiCliManifest } from '@modules/model/submodules/kimi-cli/manifest.js'
import type { ModuleContext } from '@core/types'
import { readFakeAcpLog, writeFakeAcpExecutable } from '../../../helpers/fake-acp.js'

const KEYS = ['EYAS_KIMI_BIN', 'EYAS_DATA_DIR'] as const
const saved: Record<string, string | undefined> = {}
let root: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-kimi-verify-')))
  for (const k of KEYS) saved[k] = process.env[k]
  process.env.EYAS_DATA_DIR = join(root, 'data')
  clearExecutableCache()
  clearAcpPreflightCache()
  resetIsolationStatuses()
})

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  registerIsolationVerifier('kimi-cli', null)
  clearExecutableCache()
  clearAcpPreflightCache()
  resetIsolationStatuses()
  rmSync(root, { recursive: true, force: true })
})

function context(signIn: { signedIn: boolean }, enabled = true) {
  const registered: any[] = []
  const noop = () => {}
  const logger = { info: noop, warn: noop, error: noop, debug: noop, child: () => logger } as any
  const ctx = {
    logger,
    config: { server: { host: '127.0.0.1', port: 3999 } },
    providerReload: new Map(),
    cliSignIn: { refresh: async () => {}, isSignedIn: () => signIn.signedIn, profileEnv: () => ({}) },
    providerConfig: {
      ensureProvider: noop,
      getProvider: () => ({ enabled, settings: {} }),
      listModels: () => [{ modelId: 'kimi-cli-default' }],
      upsertModels: noop,
      reconcileDiscoveredModels: () => ({ missing: [], restored: [] }),
      getModelMetadata: () => null,
      setImageSupport: noop,
    },
    model: {
      registerProvider: (p: any) => registered.push(p),
      unregisterProvider: noop,
      getProvider: () => registered[0],
    },
  } as unknown as ModuleContext
  return { ctx, registered }
}

async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 250 && !cond(); i++) await new Promise((r) => setTimeout(r, 20))
}

describe.skipIf(process.platform === 'win32')('kimi submodule — Verify now', () => {
  it('(+) signed out, Kimi stays not verified; once signed in, Verify now starts a session and records verified', async () => {
    const log = join(root, 'kimi.log')
    process.env.EYAS_KIMI_BIN = writeFakeAcpExecutable(root, { log, dialect: 'kimi' })
    const signIn = { signedIn: false }
    const { ctx } = context(signIn)
    await kimiCliManifest.onStart!(ctx)
    expect(canVerifyIsolation('kimi-cli')).toBe(true)
    await new Promise((r) => setTimeout(r, 150))
    // The home checks passed, but no session started on this host yet.
    expect(getIsolationStatus('kimi-cli').status).toBe('unverified')
    expect(readFakeAcpLog(log).received.some((m) => m.method === 'session/new')).toBe(false)

    signIn.signedIn = true
    const status = await verifyIsolationNow('kimi-cli')
    expect(status).toMatchObject({ status: 'verified', checks: [] })
    const methods = readFakeAcpLog(log).received.map((m) => m.method)
    expect(methods).toContain('session/new')
    // Verify now never prompts the model.
    expect(methods).not.toContain('session/prompt')
  })

  it('(−) a skill planted in the EYAS Kimi home turns Verify now into a violation', async () => {
    process.env.EYAS_KIMI_BIN = writeFakeAcpExecutable(root, { log: join(root, 'planted.log'), dialect: 'kimi' })
    const { ctx } = context({ signedIn: true })
    await kimiCliManifest.onStart!(ctx)
    await until(() => getIsolationStatus('kimi-cli').status === 'verified')

    const skill = join(root, 'data', 'cli-homes', 'kimi-cli', '.agents', 'skills', 'planted')
    mkdirSync(skill, { recursive: true })
    writeFileSync(join(skill, 'SKILL.md'), '# planted\n')
    const status = await verifyIsolationNow('kimi-cli')
    expect(status?.status).toBe('violation')
    expect(status?.checks.map((c) => c.check)).toContain('rules')
  })

  it('(−) a disabled Kimi registers no Verify now', async () => {
    process.env.EYAS_KIMI_BIN = writeFakeAcpExecutable(root, { log: join(root, 'off.log'), dialect: 'kimi' })
    const { ctx } = context({ signedIn: true }, false)
    await kimiCliManifest.onStart!(ctx)
    expect(canVerifyIsolation('kimi-cli')).toBe(false)
    expect(verifyIsolationNow('kimi-cli')).toBeNull()
  })
})
