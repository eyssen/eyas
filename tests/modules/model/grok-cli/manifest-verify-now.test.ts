// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// K6 — Verify now for the Grok CLI: a loaded Grok registers the same check
// its load runs (`grok inspect --json` in an EYAS scratch folder, no model
// call), and the panel's Verify now re-runs it, bypassing the 10-minute
// reuse of a passed check. Recorded inspect reports from the A1 spike; no
// real CLI.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearExecutableCache } from '@modules/model/cli-runtime/executables.js'
import {
  canVerifyIsolation,
  getIsolationStatus,
  registerIsolationVerifier,
  resetIsolationStatuses,
  verifyIsolationNow,
} from '@modules/model/cli-runtime/isolation.js'
import { clearAcpPreflightCache } from '@modules/model/submodules/grok-cli/acp-verify.js'
import { grokCliManifest } from '@modules/model/submodules/grok-cli/manifest.js'
import type { ModuleContext } from '@core/types'

const FIXTURES = join(__dirname, '..', '..', '..', 'fixtures', 'cli', 'grok', '1.0.40')
const KEYS = ['EYAS_GROK_BIN', 'EYAS_DATA_DIR'] as const
const saved: Record<string, string | undefined> = {}
let root: string

/** A grok at a fixed path that answers --version and `inspect --json` with the given recorded report. */
function writeFakeGrok(report: 'isolated' | 'hostile'): string {
  const homes = join(root, 'data', 'cli-homes')
  const reportPath = join(root, `inspect-${report}.json`)
  writeFileSync(reportPath, readFileSync(join(FIXTURES, `inspect-${report}.json`), 'utf8')
    .replaceAll('<EYAS_HOMES>', homes)
    .replaceAll('<HOME>', join(root, 'host-home'))
    .replaceAll('<PROJECT>', join(root, 'project'))
    .replaceAll('<ROOT>/workspaces/conv-1', join(root, 'project')))
  const path = join(root, 'grok')
  writeFileSync(path, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "grok 1.0.40"; exit 0; fi',
    `if [ "$1" = "inspect" ]; then cat '${reportPath}'; exit 0; fi`,
    'exit 1',
  ].join('\n') + '\n')
  chmodSync(path, 0o755)
  return path
}

function ctx(enabled = true) {
  const registered: any[] = []
  const noop = () => {}
  const logger = { info: noop, warn: noop, error: noop, debug: noop, child: () => logger } as any
  const context = {
    logger,
    config: { server: { host: '127.0.0.1', port: 3999 } },
    providerReload: new Map(),
    // Signed out: the load and Verify now run the inspect check only (no session).
    cliSignIn: { refresh: async () => {}, isSignedIn: () => false, profileEnv: () => ({}) },
    providerConfig: {
      ensureProvider: noop,
      getProvider: () => ({ enabled, settings: {} }),
      listModels: () => [{ id: 'grok-cli-default' }],
      upsertModels: noop,
    },
    model: {
      registerProvider: (p: any) => registered.push(p),
      unregisterProvider: noop,
      getProvider: () => registered[0],
    },
  } as unknown as ModuleContext
  return context
}

async function settled(): Promise<void> {
  for (let i = 0; i < 100 && getIsolationStatus('grok-cli').status === 'unverified'; i++) {
    await new Promise((r) => setTimeout(r, 20))
  }
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-grok-verify-')))
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
  registerIsolationVerifier('grok-cli', null)
  clearExecutableCache()
  clearAcpPreflightCache()
  resetIsolationStatuses()
  rmSync(root, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('grok submodule — Verify now', () => {
  it('(+) re-runs the inspect check: a Grok that turned hostile since load is recorded as a violation', async () => {
    process.env.EYAS_GROK_BIN = writeFakeGrok('isolated')
    await grokCliManifest.onStart!(ctx())
    await settled()
    expect(getIsolationStatus('grok-cli').status).toBe('verified')
    expect(canVerifyIsolation('grok-cli')).toBe(true)

    // Same binary path, now reporting host config: a cached pass must not hide it.
    writeFakeGrok('hostile')
    const status = await verifyIsolationNow('grok-cli')
    expect(status?.status).toBe('violation')
    expect(status?.checks.length).toBeGreaterThan(0)
  })

  it('(+) a fixed Grok is verified again by Verify now', async () => {
    process.env.EYAS_GROK_BIN = writeFakeGrok('hostile')
    await grokCliManifest.onStart!(ctx())
    await settled()
    expect(getIsolationStatus('grok-cli').status).toBe('violation')

    writeFakeGrok('isolated')
    await expect(verifyIsolationNow('grok-cli')).resolves.toMatchObject({ status: 'verified', checks: [] })
  })

  it('(−) a disabled Grok registers no Verify now', async () => {
    process.env.EYAS_GROK_BIN = writeFakeGrok('isolated')
    await grokCliManifest.onStart!(ctx(false))
    expect(canVerifyIsolation('grok-cli')).toBe(false)
    expect(verifyIsolationNow('grok-cli')).toBeNull()
  })
})
